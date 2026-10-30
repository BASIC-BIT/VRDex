import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { calendarEventItem, type OperationPayload, type VrchatCalendarItem } from "./_clubOperations";
import { applyEventCandidate, candidateFromConnectorFields } from "./_eventCandidateApply";
import { enqueueSyncJob } from "./_eventSync";
import { eventPathForRecord } from "./_eventPaths";
import { getPublicEventBySlug } from "./_eventPublic";
import { eventDateForInstant } from "./_eventSchedule";
import { toPublicEventShareCard } from "./_eventShareCard";
import { enqueueConnectorOperation } from "./clubOperations";
import { exportPayloadFromEvent, fieldsFromVrchatEvent, truncateTitle, vrchatCalendarEnabled } from "./eventSyncKinds/vrchatCalendar";

// The VRChat calendar kind's state machine. Each advance runs one step: it enqueues a club operation and
// returns `await`, or settles the job. The operation's terminal callback re-runs the job to take the next step.
export type VrchatJobPayload = {
  operationId?: Id<"clubOperations">; step?: "match" | "write"; externalId?: string; imageUrl?: string; item?: VrchatCalendarItem;
  waitingSince?: number;
};

const advanceResult = v.union(
  v.object({ kind: v.literal("await"), operationId: v.id("clubOperations") }),
  v.object({ kind: v.literal("done"), externalId: v.string() }),
  v.object({ kind: v.literal("failed"), code: v.string() }),
);
type Advance = { kind: "await"; operationId: Id<"clubOperations"> } | { kind: "done"; externalId: string } | { kind: "failed"; code: string };
type Job = Doc<"eventSyncJobs">;
type Connector = Doc<"eventConnectors">;
type Link = Doc<"eventSyncLinks">;

const DAY_MS = 86_400_000;
// Plan 02 carry-forward: a step waiting this long on one collector fails visibly instead of waiting forever.
const STALL_MS = 6 * 3_600_000;
const done = (externalId: string): Advance => ({ kind: "done", externalId });
const failed = (code: string): Advance => ({ kind: "failed", code });
const none = (eventId: Id<"events">) => "none:" + eventId;
// A `none:` link records that nothing was written; only a cal_ ID names a VRChat entry.
const entryId = (link: Link | null) => link?.state === "linked" && link.externalId.startsWith("cal_") ? link.externalId : undefined;

const linkFor = async (ctx: MutationCtx, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  (await ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).take(100)).find(link => link.connectorId === connectorId) ?? null;

// Payloads are v.any(); JSON drops undefined fields, which Convex would reject.
const setPayload = (ctx: MutationCtx, job: Job, payload: VrchatJobPayload) =>
  ctx.db.patch(job._id, { payload: JSON.parse(JSON.stringify(payload)), updatedAt: Date.now() });

async function enqueue(ctx: MutationCtx, job: Job, connector: Connector, operation: OperationPayload,
  next: { step: "match" | "write"; externalId?: string }, waitingSince = Date.now()): Promise<Advance> {
  const out = await enqueueConnectorOperation(ctx, { connector, payload: operation, syncJobId: job._id });
  if ("refused" in out) {
    if (out.refused !== "staff_permission") return failed(out.refused);
    await ctx.db.patch(connector._id, { state: "paused", lastError: "authority_lost", updatedAt: Date.now() });
    return failed("authority_lost");
  }
  const imageUrl = "imageUrl" in operation ? operation.imageUrl : undefined;
  await setPayload(ctx, job, { operationId: out.operationId, ...next, imageUrl, waitingSince });
  return { kind: "await", operationId: out.operationId };
}

// Rule 1 plus the missed and stall rulings. Returns a result to hand back, the terminal operation, or null when nothing is in flight.
async function inFlight(ctx: MutationCtx, job: Job, connector: Connector, payload: VrchatJobPayload): Promise<Advance | Doc<"clubOperations"> | null> {
  if (!payload.operationId) return null;
  const operation = await ctx.db.get(payload.operationId);
  if (!operation) return await retry(ctx, job, payload, "vrchat_operation_missing");
  const waiting = operation.state === "pending" || operation.state === "claimed" || operation.state === "submitted";
  if (!waiting && operation.state !== "missed") return operation;
  // Keep the operation ID so the retry re-checks it and never enqueues a second write.
  if (payload.waitingSince !== undefined && Date.now() - payload.waitingSince > STALL_MS) return failed("vrchat_operation_stalled");
  if (waiting) return { kind: "await", operationId: operation._id };
  // Missed means never claimed, so never submitted: send the same operation again.
  return await enqueue(ctx, job, connector, operation.payload, { step: payload.step ?? "write", externalId: payload.externalId }, payload.waitingSince);
}

// Rule 4: forget the operation so the runner's backoff starts over from a read.
async function retry(ctx: MutationCtx, job: Job, payload: VrchatJobPayload, code: string): Promise<Advance> {
  const { operationId: _operationId, step: _step, waitingSince: _waitingSince, ...rest } = payload;
  await setPayload(ctx, job, rest);
  return failed(code);
}

const gone = (operation: Doc<"clubOperations">) => operation.state === "succeeded" || (operation.state === "rejected" && operation.code === "visibility");

function siteUrlOrThrow() {
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  if (!siteUrl) throw new Error("site_url_missing");
  return siteUrl;
}

async function exportWrite(ctx: MutationCtx, event: Doc<"events">, link: Link | null) {
  const community = event.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
  const siteUrl = siteUrlOrThrow();
  const artwork = community ? toPublicEventShareCard(event, community)?.artworkImageUrl : undefined;
  const write = exportPayloadFromEvent(event, {
    eventUrl: siteUrl + await eventPathForRecord(ctx.db, event),
    worldNames: (await getPublicEventBySlug(ctx.db, event))?.worlds.map(world => world.displayName) ?? [],
    ...(artwork ? { artworkUrl: new URL(artwork, siteUrl + "/").toString() } : {}),
  });
  return { write, artworkSent: write.imageUrl !== undefined && write.imageUrl !== link?.externalArtworkUrl };
}

// The kind owns the link's state and artwork; completeJob then writes the export fields on this same row.
async function upsertLink(ctx: MutationCtx, job: Job, eventId: Id<"events">, link: Link | null, patch: Pick<Link, "externalId" | "state"> & { externalArtworkUrl?: string }) {
  const now = Date.now();
  const row = link ?? await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", job.connectorId).eq("externalId", patch.externalId)).unique();
  if (row) await ctx.db.patch(row._id, { ...patch, eventId, updatedAt: now });
  else await ctx.db.insert("eventSyncLinks", { connectorId: job.connectorId, eventId, ...patch, createdAt: now, updatedAt: now });
}

async function load(ctx: MutationCtx, jobId: Id<"eventSyncJobs">) {
  const job = await ctx.db.get(jobId);
  const connector = job && await ctx.db.get(job.connectorId);
  if (!job || job.state !== "running" || !connector) return null;
  const link = job.eventId ? await linkFor(ctx, connector._id, job.eventId) : null;
  return { job, connector, link, payload: (job.payload ?? {}) as VrchatJobPayload };
}

export const advanceExport = internalMutation({
  args: { jobId: v.id("eventSyncJobs") },
  returns: advanceResult,
  handler: async (ctx, { jobId }): Promise<Advance> => {
    const loaded = await load(ctx, jobId);
    const event = loaded?.job.eventId ? await ctx.db.get(loaded.job.eventId) : null;
    if (!loaded || !event) return failed("vrchat_job_invalid");
    const { job, connector, link, payload } = loaded;
    const current = await inFlight(ctx, job, connector, payload);
    if (current && "kind" in current) return current;
    if (current) {
      const operation = current;
      const op = operation.payload;
      if (payload.step === "match" && operation.state === "succeeded") {
        const zone = event.timezone ?? "UTC";
        const eventDate = event.eventDate ?? eventDateForInstant(event.startAt ?? 0, zone);
        const title = truncateTitle(event.title).toLowerCase();
        const match = operation.result?.calendarEvents?.find(item =>
          eventDateForInstant(Date.parse(item.startsAt), zone) === eventDate && item.title.trim().toLowerCase() === title);
        const { write, artworkSent } = await exportWrite(ctx, event, link);
        if (!match) return await enqueue(ctx, job, connector, { kind: "create_calendar_event", ...write }, { step: "write" });
        if (!artworkSent) delete write.imageUrl;
        return await enqueue(ctx, job, connector, { kind: "update_calendar_event", calendarEventId: match.id, ...write }, { step: "write", externalId: match.id });
      }
      if (payload.step === "write" && op.kind === "delete_calendar_event" && gone(operation)) return done(none(event._id));
      if (payload.step === "write" && (op.kind === "create_calendar_event" || op.kind === "update_calendar_event")) {
        const externalId = op.kind === "create_calendar_event" ? operation.result?.calendarEventId : payload.externalId ?? link?.externalId;
        if (operation.state === "succeeded" && externalId) {
          await upsertLink(ctx, job, event._id, link, { externalId, state: "linked", externalArtworkUrl: payload.imageUrl ?? link?.externalArtworkUrl });
          return done(externalId);
        }
        // VRChat answers 404 for an entry the organiser deleted: flag it and never recreate it.
        if (op.kind === "update_calendar_event" && operation.state === "rejected" && operation.code === "visibility") {
          await upsertLink(ctx, job, event._id, link, { externalId: op.calendarEventId, state: "external_deleted" });
          return done(op.calendarEventId);
        }
      }
      return await retry(ctx, job, payload, operation.code ?? operation.state);
    }
    if (link?.state === "external_deleted") return done(link.externalId);
    const existing = entryId(link);
    // Date-only and cancelled events have no VRChat entry: delete one exported earlier, otherwise write nothing.
    if (event.scheduleKind === "date_only" || event.startAt === undefined || event.eventStatus === "cancelled") {
      if (!existing) return done(none(event._id));
      return await enqueue(ctx, job, connector, { kind: "delete_calendar_event", calendarEventId: existing }, { step: "write" });
    }
    if (existing) {
      const { write, artworkSent } = await exportWrite(ctx, event, link);
      if (!artworkSent) delete write.imageUrl;
      return await enqueue(ctx, job, connector, { kind: "update_calendar_event", calendarEventId: existing, ...write }, { step: "write", externalId: existing });
    }
    // No entry known: read the surrounding days first so a retry after an unknown create links what VRChat made.
    const day = Date.parse((event.eventDate ?? eventDateForInstant(event.startAt, event.timezone ?? "UTC")) + "T00:00:00.000Z");
    return await enqueue(ctx, job, connector, {
      kind: "list_calendar_events", from: new Date(day - DAY_MS).toISOString(), to: new Date(day + 2 * DAY_MS).toISOString(),
    }, { step: "match" });
  },
});

// The runner calls this only with a linked link, and retracts the link itself on success.
export const advanceDelete = internalMutation({
  args: { jobId: v.id("eventSyncJobs") },
  returns: advanceResult,
  handler: async (ctx, { jobId }): Promise<Advance> => {
    const loaded = await load(ctx, jobId);
    if (!loaded?.link) return failed("vrchat_job_invalid");
    const { job, connector, link, payload } = loaded;
    const current = await inFlight(ctx, job, connector, payload);
    if (current && "kind" in current) return current;
    if (current) return gone(current) ? done(link.externalId) : await retry(ctx, job, payload, current.code ?? current.state);
    const existing = entryId(link);
    if (!existing) return done(link.externalId);
    return await enqueue(ctx, job, connector, { kind: "delete_calendar_event", calendarEventId: existing }, { step: "write" });
  },
});

// --- Import, poll, and reconcile ---

const POLL_DAYS = 90;
const importing = (connector: Connector) => connector.direction === "import" || connector.direction === "bidirectional";
// External input must not fail the job: an item whose times do not parse is skipped.
const readable = (item: VrchatCalendarItem) => Number.isFinite(Date.parse(item.startsAt)) && Number.isFinite(Date.parse(item.updatedAt));
const linkByExternalId = (ctx: MutationCtx, connectorId: Id<"eventConnectors">, externalId: string) =>
  ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).unique();

// A community event on the item's local date whose title matches, in full or as VRChat's truncated copy.
// An event this connector already links to another entry never matches.
async function matchEvent(ctx: MutationCtx, connector: Connector, item: VrchatCalendarItem) {
  const eventDate = eventDateForInstant(Date.parse(item.startsAt), connector.target.timezone ?? "UTC");
  const title = item.title.trim().toLowerCase();
  const events = await ctx.db.query("events").withIndex("by_communityProfileId_eventDate", q => q.eq("communityProfileId", connector.communityProfileId).eq("eventDate", eventDate)).take(50);
  for (const event of events) {
    if (event.title.trim().toLowerCase() !== title && truncateTitle(event.title).trim().toLowerCase() !== title) continue;
    if (!await linkFor(ctx, connector._id, event._id)) return event;
  }
  return null;
}

async function insertLink(ctx: MutationCtx, connectorId: Id<"eventConnectors">, eventId: Id<"events">, externalId: string) {
  const now = Date.now();
  return (await ctx.db.get(await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId, state: "linked", createdAt: now, updatedAt: now })))!;
}

export const advanceList = internalMutation({
  args: { jobId: v.id("eventSyncJobs"), purpose: v.union(v.literal("poll"), v.literal("reconcile")) },
  returns: advanceResult,
  handler: async (ctx, { jobId, purpose }): Promise<Advance> => {
    const loaded = await load(ctx, jobId);
    if (!loaded) return failed("vrchat_job_invalid");
    const { job, connector, payload } = loaded;
    const current = await inFlight(ctx, job, connector, payload);
    if (current && "kind" in current) return current;
    if (!current) {
      const from = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
      return await enqueue(ctx, job, connector, {
        kind: "list_calendar_events", from: new Date(from).toISOString(), to: new Date(from + POLL_DAYS * DAY_MS).toISOString(),
      }, { step: "match" });
    }
    const operation = current;
    if (operation.state !== "succeeded" || operation.payload.kind !== "list_calendar_events") return await retry(ctx, job, payload, operation.code ?? operation.state);
    const { from, to } = operation.payload;
    const items = (operation.result?.calendarEvents ?? []).filter(readable);
    const importItem = (item: VrchatCalendarItem) => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "import_item", payload: { item } });
    for (const item of items) {
      const link = await linkByExternalId(ctx, connector._id, item.id);
      if (purpose === "reconcile") {
        if (link) continue;
        const match = await matchEvent(ctx, connector, item);
        if (match) await insertLink(ctx, connector._id, match._id, item.id);
        else if (importing(connector)) await importItem(item);
      } else if (!link || (link.state === "linked" && (link.externalUpdatedAt === undefined || link.externalUpdatedAt < Date.parse(item.updatedAt)))) {
        await importItem(item);
      }
    }
    // A truncated list cannot prove an entry is gone, and a link exported after the list was read is newer than it.
    if (purpose === "poll" && operation.result?.calendarEventsTruncated !== true) {
      const listed = new Set(items.map(item => item.id));
      const readAt = operation.submittedAt ?? 0;
      const [start, end] = [Date.parse(from), Date.parse(to)];
      const events = await ctx.db.query("events").withIndex("by_communityProfileId_sortAt", q => q.eq("communityProfileId", connector.communityProfileId).gte("sortAt", start).lt("sortAt", end)).take(500);
      for (const event of events) {
        if (event.startAt === undefined || event.startAt < start || event.startAt >= end) continue;
        const link = await linkFor(ctx, connector._id, event._id);
        const externalId = entryId(link);
        if (!link || !externalId || listed.has(externalId) || (link.lastExportedAt ?? link.createdAt) >= readAt) continue;
        await ctx.db.patch(link._id, { state: "external_deleted", updatedAt: Date.now() });
      }
    }
    await ctx.db.patch(connector._id, { lastSyncedAt: Date.now(), updatedAt: Date.now() });
    return done("");
  },
});

export const applyImport = internalMutation({
  args: { connectorId: v.id("eventConnectors"), item: calendarEventItem },
  returns: v.string(),
  handler: async (ctx, { connectorId, item }): Promise<string> => {
    const connector = await ctx.db.get(connectorId);
    if (connector?.state !== "active" || !importing(connector) || !readable(item)) return "skipped";
    const updatedMs = Date.parse(item.updatedAt);
    let link = await linkByExternalId(ctx, connectorId, item.id);
    if (link?.externalUpdatedAt !== undefined && link.externalUpdatedAt >= updatedMs) return "unchanged";
    let event = link?.eventId ? await ctx.db.get(link.eventId) : null;
    const zone = event?.timezone ?? connector.target.timezone ?? "UTC";
    if (eventDateForInstant(Date.parse(item.startsAt), zone) < eventDateForInstant(Date.now(), zone)) return "skipped";
    if (!link) {
      event = await matchEvent(ctx, connector, item);
      if (event) link = await insertLink(ctx, connectorId, event._id, item.id);
    }
    // Reading through the event keeps its full title when VRChat holds the truncated one, and lets the echo hash match.
    const fields = fieldsFromVrchatEvent(item, zone, siteUrlOrThrow(), event);
    const { outcome } = await applyEventCandidate(ctx, {
      connector, candidate: candidateFromConnectorFields("vrchat_calendar", fields, event ? { kind: "update", slug: event.slug ?? "" } : { kind: "new" }),
      actorUserId: connector.authorityUserId, link: link ?? undefined, externalId: item.id, externalUpdatedAt: updatedMs,
      expectedUpdatedAt: event?.updatedAt, idempotencyKey: `vrchat_calendar:${connectorId}:${item.id}:${updatedMs}`,
    });
    // Every outcome records the item as seen, so an echo or a stale item is not re-enqueued by the next poll.
    const seen = await linkByExternalId(ctx, connectorId, item.id);
    if (seen) await ctx.db.patch(seen._id, { lastImportedAt: Date.now(), externalUpdatedAt: updatedMs, updatedAt: Date.now() });
    return outcome;
  },
});

// A poll already queued or running for a connector covers the next one. Connector-level jobs are few, so the scan stays small.
async function pollInFlight(ctx: MutationCtx, connectorId: Id<"eventConnectors">) {
  for (const state of ["pending", "running"] as const) {
    for await (const job of ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connectorId).eq("eventId", undefined).eq("state", state))) {
      if (job.kind === "import_poll") return true;
    }
  }
  return false;
}

export const enqueuePolls = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!vrchatCalendarEnabled()) return null;
    // ponytail: one mutation walks every VRChat connector; page it if connectors reach the thousands.
    for await (const connector of ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "vrchat_calendar"))) {
      if (connector.state !== "active" || !importing(connector) || await pollInFlight(ctx, connector._id)) continue;
      await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "import_poll" });
    }
    return null;
  },
});
