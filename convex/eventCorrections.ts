import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type DatabaseReader, type DatabaseWriter } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { currentUserOrNull, requireUser } from "./_identity";
import type { AuthSubject } from "./_communityAuthority";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { sanitizeEventIntakePatch } from "./_eventIntake";
import { eventContributionFingerprint, preflightEventContribution } from "./_eventContributionPreflight";
import { eventDateForInstant, requireDateOnlyEventsEnabled } from "./_eventSchedule";
import { resolveEventLocalTime, type EventIntakePatch, type EventIntakeLocalTime } from "../packages/api-contracts/src/event-intake";
import { replaceEventLineup } from "./_eventLineup";
import { contributorStaffLock } from "./_eventContributorLock";
import { reindexEventSearchDocument } from "./_searchDocuments";
import { canReadProfile } from "./_profilePermissions";
import { canUpdateEvent, eventParticipantRoleLabels, linkedPublishedEventWorld, managedCommunitiesForBrowser, recordEventAuditEvent, replaceEventWorldLink, syncPreservedEventAssociations } from "./events";

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
    linkedPublishedEventWorld(db, event._id),
    db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).take(81),
    db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).take(81),
  ]);
  if (slots.length + untimed.length > 80) throw new Error("Lineup exceeds correction limit.");
  const lineup = await Promise.all([...slots, ...untimed].map(async (row, position) => {
    const person = row.personProfileId ? await db.get(row.personProfileId) : null;
    return { clientKey: row.clientKey ?? row._id, position: row.position ?? position,
      performerLabel: "performerLabel" in row ? row.performerLabel : row.displayLabel ?? person?.displayName ?? "",
      personSlug: person?.slug, roleLabel: row.roleLabel,
      ...("startAt" in row ? { start: local(row.startAt), end: local(row.endAt) } : {}),
    };
  }));
  return { communitySlug: community?.slug, title: event.title, eventDate: date, timeTba: event.scheduleKind === "date_only",
    timezone, start: local(event.startAt), end: local(event.endAt), doors: local(event.doorsOpenAt),
    venueLabel: event.venueLabel, worldSlug: world?.slug, sourceUrl: event.sourceUrl, summary: event.summary, lineup };
}

async function refreshProjections(db: DatabaseWriter, event: Doc<"events">, now: number) {
  await syncPreservedEventAssociations(db, event, now, { preserveParticipants: true, preserveWorld: true, preserveSlots: true });
  const [community, world, roleLabels] = await Promise.all([
    event.communityProfileId ? db.get(event.communityProfileId) : undefined,
    linkedPublishedEventWorld(db, event._id), eventParticipantRoleLabels(db, event._id),
  ]);
  await reindexEventSearchDocument(db, event, { community: community ?? undefined, world, roleLabels }, now);
}

export async function updateActorContribution(db: DatabaseWriter, actorUserId: Id<"users">, args: { eventId: Id<"events">; expectedUpdatedAt: number; patch: unknown; duplicateAcknowledgements?: Id<"events">[] }, actor?: AuthSubject) {
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
  await replaceEventLineup(db, updated, checked.lineup, now);
  await replaceEventWorldLink(db, updated, checked.world, now);
  await refreshProjections(db, updated, now);
  await recordEventAuditEvent(db, { eventId: event._id, actorUserId, actor, actorSurface: actor ? "browser" : "api", action: "updated", changedFields: Object.keys(patch), now });
  return { eventId: event._id, updatedAt: now, contributionVersion: updated.contributionVersion };
}

export async function retractActorContribution(db: DatabaseWriter, actorUserId: Id<"users">, eventId: Id<"events">, actor?: AuthSubject) {
  const event = await ownEvent(db, actorUserId, eventId);
  if (event.publicationState !== "published") return { eventId, changed: false };
  const now = Math.max(Date.now(), event.updatedAt + 1);
  await db.patch(eventId, { publicationState: "draft_private", updatedAt: now, contributionVersion: (event.contributionVersion ?? 0) + 1 });
  await refreshProjections(db, (await db.get(eventId))!, now);
  await recordEventAuditEvent(db, { eventId, actorUserId, actor, actorSurface: actor ? "browser" : "api", action: "retracted", changedFields: ["publicationState"], now });
  return { eventId, changed: true };
}

export const updateOwnContributedEvent = mutation({ args: updateArgs, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  return updateActorContribution(ctx.db, userId, args, subject);
} });
export const retractOwnContributedEvent = mutation({ args: { eventId: v.id("events") }, handler: async (ctx, args) => {
  const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
  return retractActorContribution(ctx.db, userId, args.eventId, subject);
} });
export const updateActorContributedEvent = internalMutation({ args: { ...updateArgs, actorUserId: v.id("users") }, handler: (ctx, args) => updateActorContribution(ctx.db, args.actorUserId, args) });
export const retractActorContributedEvent = internalMutation({ args: { eventId: v.id("events"), actorUserId: v.id("users") }, handler: (ctx, args) => retractActorContribution(ctx.db, args.actorUserId, args.eventId) });

async function ownCorrectionView(db: DatabaseReader, actorUserId: Id<"users">, eventId: Id<"events">) {
  const event = await ownEvent(db, actorUserId, eventId);
  return { eventId, updatedAt: event.updatedAt, contributionVersion: event.contributionVersion, fields: await correctionFields(db, event) };
}
export const getOwnContributedEvent = query({ args: { eventId: v.id("events") }, handler: async (ctx, args) => ownCorrectionView(ctx.db, (await requireUser(ctx)).userId, args.eventId) });
export const getActorContributedEvent = internalQuery({ args: { eventId: v.id("events"), actorUserId: v.id("users") }, handler: (ctx, args) => ownCorrectionView(ctx.db, args.actorUserId, args.eventId) });

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
    ctx.db.query("eventReports").withIndex("by_createdAt", q => q.gte("createdAt", now - 3_600_000)).take(500),
    ctx.db.query("eventReports").withIndex("by_event_createdAt", q => q.eq("eventId", event._id).gte("createdAt", now - 86_400_000)).take(20),
    user ? ctx.db.query("eventReports").withIndex("by_actor_createdAt", q => q.eq("actorUserId", user._id).gte("createdAt", now - 86_400_000)).take(10) : Promise.resolve([]),
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
  const page = await ctx.db.query("eventReports").withIndex("by_createdAt").order("desc").paginate({ cursor: args.cursor, numItems: args.limit });
  const allowed = new Set(managed.map(item => item.profile._id));
  // Return the scan cursor, including empty pages. Never leak another community's reports.
  return { ...page, page: page.page.filter(row => moderator || (row.communityProfileId && allowed.has(row.communityProfileId))) };
} });

export const expireEventSuppressions = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query("eventContributionSuppressions").withIndex("by_expiresAt", q => q.lte("expiresAt", Date.now())).take(200);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
} });
