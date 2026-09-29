import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type DatabaseReader, type DatabaseWriter, type MutationCtx } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull, requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { currentUserOrNull, requireUser } from "./_identity";
import type { AuthSubject } from "./_communityAuthority";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { sanitizeEventIntakePatch } from "./_eventIntake";
import { eventContributionFingerprint, preflightEventContribution } from "./_eventContributionPreflight";
import { eventDateForInstant, requireDateOnlyEventsEnabled } from "./_eventSchedule";
import { resolveEventLocalTime, type EventIntakePatch, type EventIntakeLocalTime } from "../packages/api-contracts/src/event-intake";
import { replaceEventLineup } from "./_eventLineup";
import { contributorStaffLock } from "./_eventContributorLock";
import { syncClubEventOperations } from "./_clubOperationEvents";
import { reindexEventSearchDocument } from "./_searchDocuments";
import { canReadProfile } from "./_profilePermissions";
import { getEventBySlug } from "./_eventSlugs";
import { canUpdateEvent, eventParticipantRoleLabels, linkedPublishedEventWorld, managedCommunitiesForBrowser, reconcileEventMediaScheduleChange, recordEventAuditEvent, replaceEventWorldLink, retireConfirmedEventInstanceAssociations, settleEventMediaForCancellation, syncPreservedEventAssociations } from "./events";

export const REMOVED_EVENT_SUPPRESSION_MS = 30 * 86_400_000;
const patchKeys = new Set(["title", "eventDate", "timeTba", "timezone", "start", "end", "doors", "venueLabel", "worldSlug", "sourceUrl", "summary", "lineup"]);
const updateArgs = { eventId: v.id("events"), expectedUpdatedAt: v.number(), patch: v.any(), duplicateAcknowledgements: v.optional(v.array(v.id("events"))) };

async function ownEvent(db: DatabaseReader, actorUserId: Id<"users">, eventId: Id<"events">) {
  const event = await db.get(eventId);
  if (!await db.get(actorUserId) || !event || event.contributorUserId !== actorUserId || event.sourceType !== "contributor") throw new ConvexError({ code: "CONTRIBUTOR_REQUIRED" });
  if (event.contributorEditsClosedAt !== undefined || event.moderationRemovedAt !== undefined) throw new ConvexError({ code: "CONTRIBUTOR_EDIT_CLOSED" });
  return event;
}

/** Reconstruct from canonical data, not the expiring private source draft. */
async function correctionFields(db: DatabaseReader, event: Doc<"events">): Promise<EventIntakePatch> {
  const community = event.communityProfileId ? await db.get(event.communityProfileId) : null;
  const date = event.eventDate ?? eventDateForInstant(event.startAt!, event.timezone);
  const timezone = event.timezone ?? "UTC";
  const local = (instant?: number): EventIntakeLocalTime | undefined => {
    if (instant === undefined) return undefined;
    const localDate = eventDateForInstant(instant, timezone);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
    const value: EventIntakeLocalTime = { time, dayOffset: (Date.parse(localDate) - Date.parse(date)) / 86_400_000 };
    const choices = resolveEventLocalTime(date, value, timezone);
    if (choices.length > 1) value.occurrence = choices[0] === instant ? "earlier" : "later";
    return value;
  };
  const [world, slots, untimed] = await Promise.all([
    linkedPublishedEventWorld(db, event._id, true),
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).take(81),
    db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).take(81),
  ]);
  if (slots.length + untimed.length > 80) throw new Error("Lineup exceeds correction limit.");
  const lineup = await Promise.all([...slots, ...untimed].map(async (row, position) => {
    const person = row.personProfileId ? await db.get(row.personProfileId) : null;
    return { clientKey: row.clientKey ?? row._id, position: row.position ?? position,
      performerLabel: "performerLabel" in row ? row.performerLabel : row.displayLabel ?? person?.displayName ?? "",
      personSlug: person && canReadProfile("public", person) ? person.slug : undefined, roleLabel: row.roleLabel,
      ...("startAt" in row ? { start: local(row.startAt), end: local(row.endAt) } : {}),
    };
  }));
  return { communitySlug: community?.slug, title: event.title, eventDate: date, timeTba: event.scheduleKind === "date_only",
    timezone, start: local(event.startAt), end: local(event.endAt), doors: local(event.doorsOpenAt),
    venueLabel: event.venueLabel, worldSlug: world?.slug, sourceUrl: event.sourceUrl, summary: event.summary, lineup };
}

async function refreshProjections(db: DatabaseWriter, event: Doc<"events">, now: number, authoredRoleLabels?: string[]) {
  await syncPreservedEventAssociations(db, event, now, { preserveParticipants: true, preserveWorld: true, preserveSlots: true });
  const [community, world, roleLabels] = await Promise.all([
    event.communityProfileId ? db.get(event.communityProfileId) : undefined,
    linkedPublishedEventWorld(db, event._id, true), eventParticipantRoleLabels(db, event._id),
  ]);
  await reindexEventSearchDocument(db, event, { community: community ?? undefined, world, roleLabels: authoredRoleLabels ?? roleLabels }, now);
}

export async function updateActorContribution(ctx: MutationCtx, actorUserId: Id<"users">, args: { eventId: Id<"events">; expectedUpdatedAt: number; patch: unknown; duplicateAcknowledgements?: Id<"events">[] }, actor?: AuthSubject, actorSurface: "api" | "mcp" = "api") {
  const db = ctx.db;
  const event = await ownEvent(db, actorUserId, args.eventId);
  if (event.updatedAt !== args.expectedUpdatedAt) throw new ConvexError({ code: "VERSION_CONFLICT" });
  if (event.publicationState !== "published" || event.eventStatus !== "scheduled") throw new ConvexError({ code: "CONTRIBUTOR_EDIT_CLOSED" });
  if (!args.patch || typeof args.patch !== "object" || Array.isArray(args.patch) || Object.keys(args.patch).some(key => !patchKeys.has(key))) throw new ConvexError({ code: "PATCH_FIELD" });
  const patch = sanitizeEventIntakePatch(args.patch);
  if (!Object.keys(patch).length) throw new ConvexError({ code: "PATCH_FIELD" });
  const fields = { ...await correctionFields(db, event), ...patch, duplicateAcknowledgements: args.duplicateAcknowledgements };
  const now = Math.max(Date.now(), event.updatedAt + 1);
  const checked = await preflightEventContribution(db, actorUserId, fields, now, event._id);
  if (checked.existing) throw new ConvexError({ code: "DUPLICATE_EVENT", eventId: checked.existing._id });
  if (checked.schedule.scheduleKind === "date_only") requireDateOnlyEventsEnabled();
  await db.patch(event._id, {
    title: checked.fields.title!, sortTitle: checked.fields.title!.toLowerCase(), ...checked.schedule,
    startAt: checked.schedule.startAt, timezone: checked.schedule.scheduleKind === "timed" ? checked.fields.timezone! : undefined,
    endAt: checked.endAt, doorsOpenAt: checked.doorsOpenAt, venueLabel: checked.fields.venueLabel || undefined,
    sourceUrl: checked.fields.sourceUrl || undefined, summary: checked.fields.summary || undefined,
    contributionFingerprint: checked.fingerprint, contributionVersion: (event.contributionVersion ?? 0) + 1, updatedAt: now,
  });
  const updated = (await db.get(event._id))!;
  const preserved = await Promise.all([
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
    db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(),
  ]);
  await replaceEventLineup(db, updated, checked.lineup, now, {
    preserveSlotAssociationIds: preserved[0].map(row => row._id),
    preserveParticipantAssociationIds: preserved[1].map(row => row._id),
    confirmPersonLinks: false,
  });
  if (updated.startAt !== event.startAt) {
    await syncClubEventOperations(ctx, event._id);
    await reconcileEventMediaScheduleChange(db, event, updated.startAt, actor, now);
  }
  if (updated.communityProfileId && (updated.startAt !== event.startAt || updated.endAt !== event.endAt)) {
    const rollupStartAt = updated.startAt ?? event.startAt;
    if (rollupStartAt !== undefined) {
      const confirmed = await db.query("eventInstanceAssociations")
        .withIndex("by_eventId_state", q => q.eq("eventId", event._id).eq("state", "confirmed")).first();
      if (confirmed?.communityProfileId === updated.communityProfileId) {
        await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
          communityProfileId: updated.communityProfileId, eventId: event._id, grain: "event",
          bucketStartAt: rollupStartAt, bucketEndAt: updated.endAt ?? event.endAt ?? rollupStartAt + 6 * 60 * 60_000, now,
        });
      }
    }
  }
  if (event.startAt !== undefined && updated.startAt === undefined) {
    await retireConfirmedEventInstanceAssociations(db, event._id, now);
  }
  if (patch.worldSlug !== undefined) await replaceEventWorldLink(db, updated, checked.world, now, { confirmationState: "unconfirmed" });
  await refreshProjections(db, updated, now, checked.lineup.flatMap(entry => entry.roleLabel ? [entry.roleLabel] : []));
  await recordEventAuditEvent(db, { eventId: event._id, actorUserId, actor, actorSurface: actor ? "browser" : actorSurface, action: "updated", changedFields: Object.keys(patch), now });
  return { eventId: event._id, updatedAt: now, contributionVersion: updated.contributionVersion };
}

export async function retractActorContribution(ctx: MutationCtx, actorUserId: Id<"users">, eventId: Id<"events">, actor?: AuthSubject, actorSurface: "api" | "mcp" = "api") {
  const db = ctx.db;
  const event = await ownEvent(db, actorUserId, eventId);
  if (event.publicationState !== "published") return { eventId, changed: false };
  const now = Math.max(Date.now(), event.updatedAt + 1);
  await db.patch(eventId, { publicationState: "draft_private", updatedAt: now, contributionVersion: (event.contributionVersion ?? 0) + 1 });
  await syncClubEventOperations(ctx, eventId, true);
  await settleEventMediaForCancellation(db, event, actor, now);
  await refreshProjections(db, (await db.get(eventId))!, now);
  await recordEventAuditEvent(db, { eventId, actorUserId, actor, actorSurface: actor ? "browser" : actorSurface, action: "retracted", changedFields: ["publicationState"], now });
  return { eventId, changed: true };
}

export const updateOwnContributedEvent = mutation({ args: updateArgs, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  return updateActorContribution(ctx, userId, args, subject);
} });
export const retractOwnContributedEvent = mutation({ args: { eventId: v.id("events") }, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  return retractActorContribution(ctx, userId, args.eventId, subject);
} });
export const updateActorContributedEvent = internalMutation({ args: { ...updateArgs, actorUserId: v.id("users"), actorSurface: v.optional(v.union(v.literal("api"), v.literal("mcp"))) }, handler: (ctx, args) => updateActorContribution(ctx, args.actorUserId, args, undefined, args.actorSurface) });
export const retractActorContributedEvent = internalMutation({ args: { eventId: v.id("events"), actorUserId: v.id("users"), actorSurface: v.optional(v.union(v.literal("api"), v.literal("mcp"))) }, handler: (ctx, args) => retractActorContribution(ctx, args.actorUserId, args.eventId, undefined, args.actorSurface) });

async function ownCorrectionView(db: DatabaseReader, actorUserId: Id<"users">, eventId: Id<"events">) {
  const event = await ownEvent(db, actorUserId, eventId);
  return { eventId, updatedAt: event.updatedAt, contributionVersion: event.contributionVersion, fields: await correctionFields(db, event) };
}
export const getOwnContributedEvent = query({ args: { eventId: v.id("events") }, handler: async (ctx, args) => ownCorrectionView(ctx.db, (await requireUser(ctx)).userId, args.eventId) });
export const getActorContributedEvent = internalQuery({ args: { eventId: v.id("events"), actorUserId: v.id("users") }, handler: (ctx, args) => ownCorrectionView(ctx.db, args.actorUserId, args.eventId) });
export const getActorContributedEventIdBySlug = internalQuery({ args: { slug: v.string(), actorUserId: v.id("users") }, handler: async (ctx, args) => {
  const event = await getEventBySlug(ctx.db, args.slug);
  if (!event) throw new ConvexError({ code: "CONTRIBUTOR_REQUIRED" });
  await ownEvent(ctx.db, args.actorUserId, event._id);
  return event._id;
} });

export const getEventContributionAccess = query({ args: { eventId: v.id("events") }, returns: v.object({ canCorrect: v.boolean(), canSuggest: v.boolean(), canTakeOver: v.boolean(), canRemove: v.boolean() }), handler: async (ctx, { eventId }) => {
  const denied = { canCorrect: false, canSuggest: false, canTakeOver: false, canRemove: false };
  const session = await activeBrowserSessionSubjectOrNull(ctx);
  if (!session) return denied;
  const { user, subject } = session;
  const event = await ctx.db.get(eventId);
  if (!event?.contributorUserId || event.publicationState !== "published" || event.moderationRemovedAt !== undefined) return denied;
  const own = event.contributorUserId === user._id;
  const open = event.contributorEditsClosedAt === undefined && event.eventStatus === "scheduled";
  return { canCorrect: own && open, canSuggest: own && !open,
    canTakeOver: open && await canUpdateEvent(ctx.db, event, subject, user._id),
    canRemove: (await getAccountFeatureAccess(ctx.db, user._id)).superAdmin };
} });

export const listOwnContributions = query({ args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, args) => {
  const { userId } = await requireUser(ctx);
  if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error("Invalid contribution page.");
  const events = await ctx.db.query("events").withIndex("by_contributorUserId", q => q.eq("contributorUserId", userId)).order("desc").paginate(args.paginationOpts);
  return { ...events, page: await Promise.all(events.page.map(async event => {
    const community = event.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
    return { eventId: event._id, title: event.title, published: event.publicationState === "published", eventPath: community && event.slug ? `/${community.slug}/events/${event.slug}` : null };
  })) };
} });

export const getEventReportAccess = query({ args: {}, returns: v.boolean(), handler: async ctx => {
  const user = await currentUserOrNull(ctx);
  return Boolean(user && ((await getAccountFeatureAccess(ctx.db, user._id)).superAdmin || (await managedCommunitiesForBrowser(ctx, { includeNonPublic: true })).length));
} });

export const takeOverContributedEvent = mutation({ args: { eventId: v.id("events") }, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  const event = await ctx.db.get(args.eventId);
  if (!event?.contributorUserId || !await canUpdateEvent(ctx.db, event, subject, userId)) throw new ConvexError({ code: "EVENT_STAFF_REQUIRED" });
  if (event.contributorEditsClosedAt !== undefined) return { eventId: event._id, changed: false };
  const now = Math.max(Date.now(), event.updatedAt + 1);
  await ctx.db.patch(event._id, contributorStaffLock(event, now));
  await recordEventAuditEvent(ctx.db, { eventId: event._id, actor: subject, actorSurface: "browser", action: "taken_over", changedFields: ["contributorEditsClosedAt", "contributorLockRevision"], now });
  return { eventId: event._id, changed: true };
} });

export const removeContributedEvent = mutation({ args: { eventId: v.id("events"), reason: v.string() }, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  if (!(await getAccountFeatureAccess(ctx.db, userId)).superAdmin) throw new ConvexError({ code: "SUPER_ADMIN_REQUIRED" });
  const reason = args.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new Error("A removal reason of 5 to 500 characters is required.");
  const event = await ctx.db.get(args.eventId);
  if (!event?.contributorUserId || !event.communityProfileId) throw new Error("Contributed event not found.");
  if (event.moderationRemovedAt !== undefined) return { eventId: event._id, changed: false };
  const now = Math.max(Date.now(), event.updatedAt + 1);
  await ctx.db.patch(event._id, { publicationState: "draft_private", moderationRemovedAt: now, ...contributorStaffLock(event, now) });
  await syncClubEventOperations(ctx, event._id, true);
  await settleEventMediaForCancellation(ctx.db, event, subject, now);
  const fingerprint = eventContributionFingerprint(event.communityProfileId, event.eventDate ?? eventDateForInstant(event.startAt!, event.timezone), event.title);
  await ctx.db.insert("eventContributionSuppressions", { fingerprint, eventId: event._id, createdAt: now, expiresAt: now + REMOVED_EVENT_SUPPRESSION_MS });
  await refreshProjections(ctx.db, (await ctx.db.get(event._id))!, now);
  await recordEventAuditEvent(ctx.db, { eventId: event._id, actor: subject, actorSurface: "browser", action: "suppressed", changedFields: ["publicationState", "moderationRemovedAt"], reason, now });
  return { eventId: event._id, changed: true };
} });

export const reportEvent = mutation({ args: { eventId: v.id("events"), reason: v.string() }, handler: async (ctx, args) => {
  const reason = args.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new Error("A report reason of 5 to 500 characters is required.");
  const event = await ctx.db.get(args.eventId);
  const community = event?.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
  if (!event || event.publicationState !== "published" || !community || !canReadProfile("public", community)) throw new Error("Public event not found.");
  const user = await currentUserOrNull(ctx);
  const now = Date.now();
  // Anonymous callers cannot supply a reliable identity. Global and event caps
  // bound writes even if callers rotate credentials or provide forged client IDs.
  const [global, target, actor] = await Promise.all([
    ctx.db.query("eventReports").withIndex("by_kind_createdAt", q => q.eq("kind", "report").gte("createdAt", now - 3_600_000)).take(500),
    ctx.db.query("eventReports").withIndex("by_kind_event_createdAt", q => q.eq("kind", "report").eq("eventId", event._id).gte("createdAt", now - 86_400_000)).take(20),
    user ? ctx.db.query("eventReports").withIndex("by_kind_actor_createdAt", q => q.eq("kind", "report").eq("actorUserId", user._id).gte("createdAt", now - 86_400_000)).take(10) : Promise.resolve([]),
  ]);
  if (global.length >= 500 || target.length >= 20 || actor.length >= 10) throw new ConvexError({ code: "REPORT_QUOTA" });
  await ctx.db.insert("eventReports", { eventId: event._id, communityProfileId: community._id, actorUserId: user?._id, kind: "report", reason, createdAt: now });
  return { accepted: true };
} });

export const listEventReports = query({ args: { cursor: v.union(v.string(), v.null()), limit: v.number() }, handler: async (ctx, args) => {
  const { userId } = await requireUser(ctx);
  const moderator = (await getAccountFeatureAccess(ctx.db, userId)).superAdmin;
  const managed = moderator ? [] : await managedCommunitiesForBrowser(ctx, { includeNonPublic: true });
  if (!moderator && !managed.length) throw new ConvexError({ code: "EVENT_STAFF_REQUIRED" });
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new Error("Report limit must be 1 to 100.");
  const reports = ctx.db.query("eventReports").withIndex("by_createdAt").order("desc");
  const scoped = moderator ? reports : reports.filter(q => q.or(...managed.map(item => q.eq(q.field("communityProfileId"), item.profile._id))));
  const page = await scoped.paginate({ cursor: args.cursor, numItems: args.limit });
  return { ...page, page: await Promise.all(page.page.map(async row => {
    const event = await ctx.db.get(row.eventId);
    const community = row.communityProfileId ? await ctx.db.get(row.communityProfileId) : null;
    return { ...row, eventTitle: event?.title, eventPath: event?.slug && community ? `/${community.slug}/events/${event.slug}` : undefined };
  })) };
} });

export const expireEventSuppressions = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query("eventContributionSuppressions").withIndex("by_expiresAt", q => q.lte("expiresAt", Date.now())).take(200);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
} });
