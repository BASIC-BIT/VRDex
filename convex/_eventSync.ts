import type { Scheduler } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter, MutationCtx } from "./_generated/server";
import { connectorsEnabled, type SyncJobKind } from "./_eventConnectors";
import { resolveOps } from "./_opsAlerts";

export async function cancelPendingSchedule(db: DatabaseReader, scheduler: Scheduler, id: Id<"_scheduled_functions"> | undefined) {
  if (id && (await db.system.get(id))?.state.kind === "pending") await scheduler.cancel(id);
}

/** One pending job per connector per event: an event job replaces the pending one in place. Connector-level and series jobs never replace. */
export async function enqueueSyncJob(db: DatabaseWriter, scheduler: Scheduler, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: SyncJobKind; payload?: unknown; dueAt?: number }): Promise<Id<"eventSyncJobs">> {
  const now = Date.now();
  const dueAt = job.dueAt ?? now;
  const payload = job.payload ?? null;
  const { connectorId, eventId } = job;
  const existing = eventId
    ? await db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connectorId).eq("eventId", eventId).eq("state", "pending")).first()
    : null;
  await cancelPendingSchedule(db, scheduler, existing?.scheduledFunctionId);
  const jobId = existing?._id ?? await db.insert("eventSyncJobs", { connectorId, eventId, kind: job.kind, payload, dueAt, attempts: 0, state: "pending", createdAt: now, updatedAt: now });
  const scheduledFunctionId = await scheduler.runAt(dueAt, internal.eventSync.runJob, { jobId });
  await db.patch(jobId, { kind: job.kind, payload, dueAt, attempts: 0, lastError: undefined, scheduledFunctionId, updatedAt: now });
  return jobId;
}

/** The ops alert key for a connector's failure streak. */
export const failureAlertKey = (connectorId: Id<"eventConnectors">) => "connector-failures:" + connectorId;

/** The ops alert key for a Discord intake connector's failed runs. */
export const discordIntakeAlertKey = (connectorId: Id<"eventConnectors">) => "discord-intake:" + connectorId;

/** Every removal path. Links stay so a reconnect can match them; pending jobs close as connector_inactive when claimed. */
export async function removeConnector(ctx: MutationCtx, connector: Doc<"eventConnectors">): Promise<void> {
  if (connector.state !== "removed") await ctx.db.patch(connector._id, { state: "removed", updatedAt: Date.now() });
  // A removed connector cannot recover, so close any open failure alert for it.
  await resolveOps(ctx, failureAlertKey(connector._id));
  await resolveOps(ctx, discordIntakeAlertKey(connector._id));
}

export const eventIsPublic = (event: Doc<"events"> | null) => event?.publicationState === "published" && event.moderationRemovedAt === undefined;
/** Public and still on: the events a connector may export, or pair with an external copy. */
export const eventIsSyncable = (event: Doc<"events">) => eventIsPublic(event) && event.eventStatus === "scheduled";

/** The single hook every event write path calls. Cancel is an upsert; unpublish, retraction, and moderation removal are deletes. */
export async function enqueueEventSync(db: DatabaseWriter, scheduler: Scheduler, eventId: Id<"events">, change: "upsert" | "delete"): Promise<void> {
  if (!connectorsEnabled()) return;
  const event = await db.get(eventId);
  const communityProfileId = event?.communityProfileId;
  if (!communityProfileId) return;
  const upsert = change === "upsert" && eventIsPublic(event);
  const connectors = (await db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", communityProfileId)).take(50))
    .filter(connector => connector.state === "active" && (connector.direction === "export" || connector.direction === "bidirectional"));
  if (upsert) {
    for (const connector of connectors) await enqueueSyncJob(db, scheduler, { connectorId: connector._id, eventId, kind: "export_upsert" });
    return;
  }
  const linked = new Set((await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).take(100))
    .filter(link => link.state === "linked").map(link => link.connectorId));
  for (const connector of connectors) {
    if (linked.has(connector._id)) await enqueueSyncJob(db, scheduler, { connectorId: connector._id, eventId, kind: "export_delete" });
  }
}
