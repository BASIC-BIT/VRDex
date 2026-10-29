import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { candidatePatch } from "../apps/web/src/lib/event-intake-source";
import type { EventIntakeCandidate, EventIntakeFields, EventIntakePatch } from "../packages/api-contracts/src/event-intake";
import { carriedFields, carriedFieldsHash, EventIntakeUpdatePatchSchema, pendingLinkDraft } from "./_eventConnectors";
import { getActorIntakeDraft, publishIntakeDraft, saveIntakeDraft } from "./_eventIntake";
import { getEventBySlug } from "./_eventSlugs";
import { patchCommunityEventFieldsAsStaffRecord } from "./events";
import { enqueueProductAnalytics } from "./_productAnalytics";

export type ApplyEventCandidateOutcome = "draft" | "published" | "updated" | "not_event" | "conflict" | "skipped_pending_draft" | "skipped_stale" | "skipped_echo";
type ApplyResult = { outcome: ApplyEventCandidateOutcome; eventId?: Id<"events">; draftId?: Id<"eventIntakeDrafts"> };

const UPDATE_KEYS = Object.keys(EventIntakeUpdatePatchSchema.shape) as Array<keyof EventIntakeFields>;
const HELD_PUBLISH_CODES = new Set(["NEAR_DUPLICATE", "REPOST_BLOCKED", "TARGET_QUOTA"]);
const errorCode = (error: unknown) => error instanceof ConvexError && typeof error.data === "object" && error.data !== null ? (error.data as { code?: unknown }).code : undefined;

// Evidence paths name candidate fields; map them to the intake field they set.
function evidenceKey(fieldPath: string): string {
  if (fieldPath === "event.startDate") return "start";
  if (fieldPath === "event.endDate") return "end";
  if (fieldPath.startsWith("lineup.")) return "lineup";
  return fieldPath.startsWith("event.") ? fieldPath.slice("event.".length) : fieldPath;
}

/** The single entry point through which an inbound connector item becomes a held draft, an update, or a published event. */
export async function applyEventCandidate(ctx: MutationCtx, args: {
  connector: Doc<"eventConnectors">; candidate: EventIntakeCandidate; actorUserId: Id<"users">;
  draftId?: Id<"eventIntakeDrafts">;
  link?: Doc<"eventSyncLinks">; externalId?: string; externalUpdatedAt?: number; idempotencyKey: string;
  expectedUpdatedAt?: number;
}): Promise<ApplyResult> {
  const { db } = ctx;
  const { connector, candidate, actorUserId } = args;
  const now = Date.now();
  const finish = async (result: ApplyResult) => {
    await enqueueProductAnalytics(db, { event: "event_sync_apply", distinctId: String(actorUserId),
      properties: { connectorId: connector._id, connectorKind: connector.kind, mode: connector.mode, outcome: result.outcome } });
    return result;
  };

  // Rule 1: the connector's community, never the candidate's.
  const community = await db.get(connector.communityProfileId);
  if (!community?.slug) throw new Error("Connector community was not found.");
  const tentative = candidatePatch(candidate).tentative ?? {};
  const fields: EventIntakeFields = { ...tentative, communitySlug: community.slug, timeTba: !tentative.start };

  if (candidate.decision.kind === "not_event") return finish({ outcome: "not_event" });

  const link = args.link ?? (args.externalId === undefined ? null
    : await db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connector._id).eq("externalId", args.externalId!)).unique());
  if (await pendingLinkDraft(db, link, now)) return finish({ outcome: "skipped_pending_draft", eventId: link?.eventId, draftId: link?.draftId });

  let target = link?.eventId ? await db.get(link.eventId) : null;
  if (!target && candidate.decision.kind === "update") {
    const bySlug = await getEventBySlug(db, candidate.decision.slug);
    if (bySlug?.communityProfileId === connector.communityProfileId) target = bySlug;
  }

  const imported = { lastImportedAt: now, ...(args.externalUpdatedAt === undefined ? {} : { externalUpdatedAt: args.externalUpdatedAt }) };
  // Insert only when the item has an external id; otherwise there is nothing to key the link on.
  const upsertLink = async (values: { eventId?: Id<"events">; draftId?: Id<"eventIntakeDrafts"> }) => {
    if (link) { await db.patch(link._id, { ...values, ...imported, updatedAt: now }); return; }
    if (args.externalId === undefined) return;
    await db.insert("eventSyncLinks", { connectorId: connector._id, externalId: args.externalId, state: "linked", ...values, ...imported, createdAt: now, updatedAt: now });
  };
  // Saves into the caller's working draft when given; the patch never touches posterSourceId, so its poster survives.
  const saveWorkingDraft = async (patch: EventIntakePatch) => {
    const working = args.draftId ? await getActorIntakeDraft(db, actorUserId, args.draftId, now) : null;
    return saveIntakeDraft(db, actorUserId, working ? { draftId: working._id, expectedVersion: working.version, patch } : { patch }, now, { connectorId: connector._id });
  };
  // Rule 7: a held draft keeps the target's eventId on the link, so My events shows a proposed update.
  const hold = async (outcome: "draft" | "conflict") => {
    const patch = candidatePatch(candidate);
    const { draftId } = await saveWorkingDraft({ ...patch, tentative: { ...patch.tentative, communitySlug: community.slug } });
    await upsertLink({ draftId, ...(target ? { eventId: target._id } : {}) });
    return finish({ outcome, draftId, ...(target ? { eventId: target._id } : {}) });
  };

  if (target) {
    if (link?.lastExportedHash !== undefined && link.lastExportedHash === carriedFieldsHash(connector.kind, fields)) {
      await db.patch(link._id, { ...imported, updatedAt: now });
      return finish({ outcome: "skipped_echo", eventId: target._id });
    }
    // VRDex wins on a bidirectional connector; the export its edit enqueued overwrites the copy.
    if (connector.direction === "bidirectional" && args.externalUpdatedAt !== undefined && args.externalUpdatedAt <= target.updatedAt) {
      if (link) await db.patch(link._id, { ...imported, updatedAt: now });
      return finish({ outcome: "skipped_stale", eventId: target._id });
    }
  }

  if (connector.mode === "hold") return hold("draft");

  if (target) {
    const explicit = new Set(candidate.evidence.filter(entry => entry.assessment === "explicit").map(entry => evidenceKey(entry.fieldPath)));
    const carried = carriedFields(connector.kind);
    const keys = UPDATE_KEYS.filter(key => explicit.has(key) && carried.includes(key));
    // A start that appears or disappears also flips time TBA; timeTba is always a boolean here, never null.
    if (keys.includes("start") && !keys.includes("timeTba") && carried.includes("timeTba")) keys.push("timeTba");
    const patch = Object.fromEntries(keys.map(key => [key, fields[key] ?? null]));
    try {
      await patchCommunityEventFieldsAsStaffRecord(ctx, { actorUserId, slug: target.slug!, expectedUpdatedAt: args.expectedUpdatedAt ?? target.updatedAt, patch });
    } catch (error) {
      // Both codes are thrown before the staff patch writes anything, so the mutation can continue.
      const code = errorCode(error);
      if (code === "VERSION_CONFLICT") return hold("conflict");
      if (code === "INVALID_EVENT_PATCH") return hold("draft");
      throw error;
    }
    await upsertLink({ eventId: target._id });
    return finish({ outcome: "updated", eventId: target._id });
  }

  // A retried job replays its receipt instead of filing a second draft.
  const prior = await db.query("eventIntakePublishRequests").withIndex("by_actor_key", q => q.eq("actorUserId", actorUserId).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (prior) {
    const receipt = (await db.get(prior.receiptId))!;
    await upsertLink({ eventId: receipt.eventId, draftId: prior.draftId });
    return finish({ outcome: "published", eventId: receipt.eventId, draftId: prior.draftId });
  }
  const saved = await saveWorkingDraft({ ...fields, evidence: candidate.evidence });
  try {
    // Publishing the working draft carries its selected artwork through as the event poster.
    const published = await publishIntakeDraft(ctx, actorUserId, { draftId: saved.draftId, expectedVersion: saved.version, idempotencyKey: args.idempotencyKey }, now, "system", { connectorId: connector._id });
    await upsertLink({ eventId: published.eventId, draftId: saved.draftId });
    return finish({ outcome: "published", eventId: published.eventId, draftId: saved.draftId });
  } catch (error) {
    // These are thrown by the read-only preflight, before publish writes; the saved draft stays as a hold.
    if (!HELD_PUBLISH_CODES.has(errorCode(error) as string)) throw error;
    await upsertLink({ draftId: saved.draftId });
    return finish({ outcome: "draft", draftId: saved.draftId });
  }
}
