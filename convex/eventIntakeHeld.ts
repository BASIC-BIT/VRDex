import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getConnectorDraftForManager, publishIntakeDraft, sanitizeEventIntakePatch, saveIntakeDraft } from "./_eventIntake";
import { dismissHeldDraft, heldTarget, heldUpdatePatch, promoteHeldFields } from "./_eventIntakeHeld";
import { eventPathForRecord } from "./_eventPaths";
import { enqueueEventSync } from "./_eventSync";
import { canUpdateEvent, patchCommunityEventFieldsAsStaffRecord } from "./events";

/** Both publish branches end here: links and sources follow the event, and the exports skipped while the draft was pending run. */
async function settleHeldDraft(ctx: MutationCtx, draft: Doc<"eventIntakeDrafts">, eventId: Id<"events">, now: number) {
  const { db } = ctx;
  for (const link of await db.query("eventSyncLinks").withIndex("by_draftId", q => q.eq("draftId", draft._id)).collect()) await db.patch(link._id, { eventId, draftId: undefined, updatedAt: now });
  for (const source of await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draft._id)).collect()) await db.patch(source._id, { eventId });
  await db.patch(draft._id, { resolvedAt: now });
  await enqueueEventSync(db, ctx.scheduler, eventId, "upsert");
}

/** Row Publish takes the import as listed. The editor passes expectedVersion and publishes only what the staffer saved there. */
export const publish = mutation({
  args: { draftId: v.id("eventIntakeDrafts"), expectedVersion: v.optional(v.number()) },
  returns: v.object({ outcome: v.union(v.literal("published"), v.literal("updated")), eventId: v.id("events"), eventPath: v.string() }),
  handler: async (ctx, { draftId, expectedVersion }) => {
    const { user } = await requireActiveBrowserSessionSubject(ctx);
    const now = Date.now();
    const { draft, connector, community } = await getConnectorDraftForManager(ctx.db, user._id, draftId, now);
    if (expectedVersion !== undefined && expectedVersion !== draft.version) throw new ConvexError({ code: "VERSION_CONFLICT" });
    const fields = sanitizeEventIntakePatch(draft.fields);
    const target = await heldTarget(ctx.db, draft);
    if (target) {
      const { event } = target;
      // The editor reads a held draft with no start as Time TBA; that alone never clears the event's clock.
      const reviewed = expectedVersion === undefined ? fields : { ...fields, timeTba: fields.start ? fields.timeTba : null, tentative: null, evidence: null };
      await patchCommunityEventFieldsAsStaffRecord(ctx, { actorUserId: user._id, slug: event.slug!, expectedUpdatedAt: event.updatedAt, patch: heldUpdatePatch(reviewed, connector.kind) });
      await settleHeldDraft(ctx, draft, event._id, now);
      return { outcome: "updated" as const, eventId: event._id, eventPath: await eventPathForRecord(ctx.db, event) };
    }
    const patch = expectedVersion === undefined ? promoteHeldFields(fields, community.slug) : { communitySlug: community.slug };
    const saved = await saveIntakeDraft(ctx.db, user._id, { draftId, expectedVersion: draft.version, patch }, now);
    const { eventId, eventPath } = await publishIntakeDraft(ctx, user._id, { draftId, expectedVersion: saved.version, idempotencyKey: `held:${draftId}:${saved.version}` }, now, "browser", { connectorId: connector._id });
    await settleHeldDraft(ctx, draft, eventId, now);
    return { outcome: "published" as const, eventId, eventPath };
  },
});

export const dismiss = mutation({
  args: { draftId: v.id("eventIntakeDrafts") },
  returns: v.null(),
  handler: async (ctx, { draftId }) => {
    const { user } = await requireActiveBrowserSessionSubject(ctx);
    const now = Date.now();
    const { draft } = await getConnectorDraftForManager(ctx.db, user._id, draftId, now);
    await dismissHeldDraft(ctx, draft, now);
    return null;
  },
});

/** Keep: staff saw the deletion and leave the event up. The link stays external_deleted, so exports still never recreate the copy. */
export const dismissFlag = mutation({
  args: { eventId: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || !await canUpdateEvent(ctx.db, event, subject, user._id)) throw new Error("You do not have access to this action.");
    const now = Date.now();
    for (const link of await ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).collect()) {
      if (link.state === "external_deleted") await ctx.db.patch(link._id, { flagReviewedAt: now });
    }
    return null;
  },
});
