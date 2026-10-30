import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { OperationPayload, VrchatCalendarItem } from "./_clubOperations";
import { eventPathForRecord } from "./_eventPaths";
import { getPublicEventBySlug } from "./_eventPublic";
import { eventDateForInstant } from "./_eventSchedule";
import { toPublicEventShareCard } from "./_eventShareCard";
import { enqueueConnectorOperation } from "./clubOperations";
import { exportPayloadFromEvent, truncateTitle } from "./eventSyncKinds/vrchatCalendar";

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

async function exportWrite(ctx: MutationCtx, event: Doc<"events">, link: Link | null) {
  const community = event.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
  const siteUrl = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  if (!siteUrl) throw new Error("site_url_missing");
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
