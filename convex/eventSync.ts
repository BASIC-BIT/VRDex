import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type DatabaseReader, type MutationCtx } from "./_generated/server";
import { carriedFieldsHash, connectorsEnabled, pendingLinkDraft, userHasCommunityPermission } from "./_eventConnectors";
import { cancelPendingSchedule, enqueueSyncJob, eventIsPublic } from "./_eventSync";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { enqueueProductAnalytics } from "./_productAnalytics";
import { correctionFields } from "./eventCorrections";
import { syncKindHandlers } from "./eventSyncKinds/index";
import { AwaitingClubOperation, OPERATION_WAIT_MS } from "./eventSyncKinds/types";

export const MAX_ATTEMPTS = 5;
export const BACKOFF_MINUTES = [1, 2, 4, 8, 16];
export const LEASE_MS = 600_000;
export const RECOVERY_GRACE_MS = 300_000;
export const JOB_RETENTION_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
const RECONCILE_STAGGER_MS = 2_000;
const FAILURE_ALERT_THRESHOLD = 5;
const failureAlertKey = (connectorId: Id<"eventConnectors">) => "connector-failures:" + connectorId;

type Job = Doc<"eventSyncJobs">;
type Connector = Doc<"eventConnectors">;

// An event has at most one link per connector, and a community at most 50 connectors.
const linkFor = async (db: DatabaseReader, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  (await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).take(100)).find(link => link.connectorId === connectorId) ?? null;

// Other jobs for the same connector and event; connector-level jobs have none.
const siblings = async (db: DatabaseReader, job: Job, state: "pending" | "running") => {
  const eventId = job.eventId;
  if (!eventId) return [];
  const rows = await db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", job.connectorId).eq("eventId", eventId).eq("state", state)).take(10);
  return rows.filter(row => row._id !== job._id);
};

// Jobs for one connector and event run one at a time; when one finishes, the waiting one runs now instead of waiting out the lease.
async function wakePendingSibling(ctx: MutationCtx, job: Job) {
  const now = Date.now();
  for (const sibling of await siblings(ctx.db, job, "pending")) {
    await cancelPendingSchedule(ctx.db, ctx.scheduler, sibling.scheduledFunctionId);
    const scheduledFunctionId = await ctx.scheduler.runAt(now, internal.eventSync.runJob, { jobId: sibling._id });
    await ctx.db.patch(sibling._id, { dueAt: now, scheduledFunctionId, updatedAt: now });
  }
}

// Each job emits exactly one event_sync_job: on completion, final failure, or skip. Retries emit nothing.
async function recordJob(ctx: MutationCtx, job: Job, connector: Connector, outcome: "done" | "skipped" | "failed", durationMs: number, reason?: string) {
  await enqueueProductAnalytics(ctx.db, { event: "event_sync_job", distinctId: String(connector.authorityUserId), properties: {
    jobKind: job.kind, connectorKind: connector.kind, direction: connector.direction, outcome, attempts: job.attempts, durationMs, ...(reason ? { reason } : {}),
  } });
}

async function skipJob(ctx: MutationCtx, job: Job, connector: Connector | null, reason: string) {
  await ctx.db.patch(job._id, { state: "done", lastError: reason, leaseExpiresAt: undefined, updatedAt: Date.now() });
  if (connector) await recordJob(ctx, job, connector, "skipped", 0, reason);
  return null;
}

// failJob and recovery share this: superseded, final failure, or backoff retry.
async function failAttempt(ctx: MutationCtx, job: Job, error: string, durationMs: number) {
  const now = Date.now();
  await cancelPendingSchedule(ctx.db, ctx.scheduler, job.scheduledFunctionId);
  const connector = await ctx.db.get(job.connectorId);
  if ((await siblings(ctx.db, job, "pending")).length || (await siblings(ctx.db, job, "running")).length) {
    await skipJob(ctx, job, connector, "superseded");
    return await wakePendingSibling(ctx, job);
  }
  if (job.attempts >= MAX_ATTEMPTS) {
    await ctx.db.patch(job._id, { state: "failed", lastError: error, leaseExpiresAt: undefined, updatedAt: now });
    if (connector) {
      // Only final failures count; retries, skips, and superseded closes leave the count alone.
      const consecutiveFailures = (connector.consecutiveFailures ?? 0) + 1;
      await ctx.db.patch(connector._id, { lastError: error, consecutiveFailures, updatedAt: now });
      await recordJob(ctx, job, connector, "failed", durationMs, error);
      if (consecutiveFailures === FAILURE_ALERT_THRESHOLD) await notifyOps(ctx, {
        key: failureAlertKey(connector._id), subject: "Event connector failing",
        body: `Connector ${connector._id} (${connector.kind}) for community profile ${connector.communityProfileId} has failed ${consecutiveFailures} jobs in a row. Last error: ${error}`,
      });
    }
    return;
  }
  // A job awaiting a club operation on its first attempt holds attempts 0 until reclaimed; it still backs off one minute.
  const dueAt = now + BACKOFF_MINUTES[Math.max(job.attempts, 1) - 1]! * 60_000;
  const scheduledFunctionId = await ctx.scheduler.runAt(dueAt, internal.eventSync.runJob, { jobId: job._id });
  await ctx.db.patch(job._id, { state: "pending", dueAt, lastError: error, leaseExpiresAt: undefined, scheduledFunctionId, updatedAt: now });
}

// Generic reconcile: queue an export for every unlinked upcoming public event. The kind's exportUpsert links a matching external copy before creating one.
async function enqueueUnlinkedExports(ctx: MutationCtx, connector: Connector, now: number) {
  const events = await ctx.db.query("events").withIndex("by_communityProfileId_sortAt", q => q.eq("communityProfileId", connector.communityProfileId).gte("sortAt", now - DAY_MS).lte("sortAt", now + 90 * DAY_MS)).take(200);
  let index = 0;
  for (const event of events) {
    if (event.publicationState !== "published" || event.moderationRemovedAt !== undefined || event.eventStatus !== "scheduled") continue;
    if (await linkFor(ctx.db, connector._id, event._id)) continue;
    await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, eventId: event._id, kind: "export_upsert", dueAt: now + index++ * RECONCILE_STAGGER_MS });
  }
}

export const claimJob = internalMutation({
  args: { jobId: v.id("eventSyncJobs") },
  handler: async (ctx, { jobId }) => {
    const now = Date.now();
    const job = await ctx.db.get(jobId);
    // A running job with a live lease is never claimed; an expired one is (a crashed runner, or an elapsed club-operation wait).
    if (!job || !(job.state === "pending" || (job.state === "running" && (job.leaseExpiresAt ?? 0) <= now))) return null;
    const connector = await ctx.db.get(job.connectorId);
    if (!connectorsEnabled()) return await skipJob(ctx, job, connector, "connectors_disabled");
    if (!connector || connector.state !== "active") return await skipJob(ctx, job, connector, "connector_inactive");
    if (connector.direction === "off") return await skipJob(ctx, job, connector, "connector_off");
    if (!await userHasCommunityPermission(ctx.db, connector.communityProfileId, connector.authorityUserId, ["manage_integrations"])) {
      await ctx.db.patch(connector._id, { state: "paused", lastError: "authority_lost", updatedAt: now });
      return await skipJob(ctx, job, connector, "authority_lost");
    }
    // Serialise per connector and event: wait for an in-flight sibling without spending an attempt.
    const busy = (await siblings(ctx.db, job, "running")).find(row => (row.leaseExpiresAt ?? 0) > now);
    if (busy) {
      const dueAt = busy.leaseExpiresAt!;
      await cancelPendingSchedule(ctx.db, ctx.scheduler, job.scheduledFunctionId);
      const scheduledFunctionId = await ctx.scheduler.runAt(dueAt, internal.eventSync.runJob, { jobId });
      await ctx.db.patch(jobId, { state: "pending", dueAt, leaseExpiresAt: undefined, scheduledFunctionId, updatedAt: now });
      return null;
    }
    let kind = job.kind;
    let event: Doc<"events"> | null = null;
    let link: Doc<"eventSyncLinks"> | null = null;
    if (job.eventId && (kind === "export_upsert" || kind === "export_delete")) {
      event = await ctx.db.get(job.eventId);
      link = await linkFor(ctx.db, connector._id, job.eventId);
      if (kind === "export_upsert" && !eventIsPublic(event)) {
        if (!link) return await skipJob(ctx, job, connector, "event_not_public");
        kind = "export_delete";
      } else if (kind === "export_delete" && eventIsPublic(event)) return await skipJob(ctx, job, connector, "event_public");
      if (kind === "export_upsert" && await pendingLinkDraft(ctx.db, link, now)) return await skipJob(ctx, job, connector, "pending_draft");
      if (kind === "export_delete" && link?.state !== "linked") return await skipJob(ctx, job, connector, "no_link");
    }
    if (kind === "reconcile" && (connector.direction === "export" || connector.direction === "bidirectional")) await enqueueUnlinkedExports(ctx, connector, now);
    const fields = kind === "export_upsert" && event ? await correctionFields(ctx.db, event) : null;
    await ctx.db.patch(jobId, { state: "running", attempts: job.attempts + 1, leaseExpiresAt: now + LEASE_MS, kind, updatedAt: now });
    return { job: (await ctx.db.get(jobId))!, connector, event, link, fields };
  },
});

export const completeJob = internalMutation({
  args: { jobId: v.id("eventSyncJobs"), externalId: v.optional(v.string()), exportedHash: v.optional(v.string()), durationMs: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (job?.state !== "running") return;
    await ctx.db.patch(job._id, { state: "done", leaseExpiresAt: undefined, lastError: undefined, updatedAt: now });
    const link = job.eventId ? await linkFor(ctx.db, job.connectorId, job.eventId) : null;
    if (job.eventId && job.kind === "export_upsert" && args.externalId) {
      const exported = { externalId: args.externalId, lastExportedAt: now, lastExportedHash: args.exportedHash, updatedAt: now };
      // Only the runner writes vrdex_retracted, so a re-export after a retraction relinks; other link states belong to the kinds.
      if (link) await ctx.db.patch(link._id, link.state === "vrdex_retracted" ? { ...exported, state: "linked" as const } : exported);
      else await ctx.db.insert("eventSyncLinks", { connectorId: job.connectorId, eventId: job.eventId, ...exported, state: "linked", createdAt: now });
      // The event went private while this export was in flight; enqueueEventSync saw no link then, so retract the copy now.
      if (!eventIsPublic(await ctx.db.get(job.eventId))) await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: job.connectorId, eventId: job.eventId, kind: "export_delete" });
    }
    if (job.kind === "export_delete" && link) await ctx.db.patch(link._id, { state: "vrdex_retracted", updatedAt: now });
    await wakePendingSibling(ctx, job);
    await resolveOps(ctx, failureAlertKey(job.connectorId));
    const connector = await ctx.db.get(job.connectorId);
    if (!connector) return;
    await ctx.db.patch(connector._id, { lastSyncedAt: now, lastError: undefined, consecutiveFailures: 0, updatedAt: now });
    await recordJob(ctx, job, connector, "done", args.durationMs);
  },
});

export const failJob = internalMutation({
  args: { jobId: v.id("eventSyncJobs"), error: v.string(), durationMs: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job?.state === "running") await failAttempt(ctx, job, args.error, args.durationMs);
  },
});

// The handler returned AwaitingClubOperation: give back the claim's attempt and wait for the operation.
export const awaitJob = internalMutation({
  args: { jobId: v.id("eventSyncJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job?.state !== "running") return;
    const leaseExpiresAt = Date.now() + OPERATION_WAIT_MS;
    const scheduledFunctionId = await ctx.scheduler.runAt(leaseExpiresAt, internal.eventSync.runJob, { jobId });
    await ctx.db.patch(jobId, { attempts: Math.max(job.attempts - 1, 0), leaseExpiresAt, scheduledFunctionId, updatedAt: Date.now() });
  },
});

export const runJob = internalAction({
  args: { jobId: v.id("eventSyncJobs") },
  handler: async (ctx, { jobId }): Promise<void> => {
    const claimed = await ctx.runMutation(internal.eventSync.claimJob, { jobId });
    if (!claimed) return;
    const { job, connector, event, link, fields } = claimed;
    const started = Date.now();
    try {
      const handler = syncKindHandlers[connector.kind];
      const missing = () => new Error("No " + job.kind + " handler is registered for connector kind " + connector.kind + ".");
      let result: unknown;
      let exportedHash: string | undefined;
      switch (job.kind) {
        // A missing reconcile means the generic part in claimJob was the whole job.
        case "reconcile": result = await handler.reconcile?.(ctx, connector, job); break;
        case "export_upsert":
          if (!handler.exportUpsert) throw missing();
          if (!event || !fields) throw new Error("export_upsert job " + job._id + " has no event.");
          exportedHash = carriedFieldsHash(connector.kind, fields);
          result = await handler.exportUpsert(ctx, connector, event, link, job);
          break;
        case "export_delete":
          if (!handler.exportDelete) throw missing();
          if (!link) throw new Error("export_delete job " + job._id + " has no link.");
          result = await handler.exportDelete(ctx, connector, link, job);
          break;
        case "import_item":
          if (!handler.importItem) throw missing();
          result = await handler.importItem(ctx, connector, job.payload, job);
          break;
        case "import_poll":
          if (!handler.importPoll) throw missing();
          result = await handler.importPoll(ctx, connector, job);
          break;
        case "board_refresh":
          if (!handler.boardRefresh) throw missing();
          result = await handler.boardRefresh(ctx, connector, job);
          break;
      }
      if (result === AwaitingClubOperation) return void await ctx.runMutation(internal.eventSync.awaitJob, { jobId });
      const externalId = (result as { externalId?: string } | undefined)?.externalId;
      await ctx.runMutation(internal.eventSync.completeJob, { jobId, externalId, exportedHash, durationMs: Date.now() - started });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await ctx.runMutation(internal.eventSync.failJob, { jobId, error: message, durationMs: Date.now() - started });
    }
  },
});

export const recoverExpiredJobs = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    const cutoff = now - RECOVERY_GRACE_MS;
    // Scan running rows until 100 expired ones are found, so live running jobs cannot fill the page and hide expired ones.
    const expired: Job[] = [];
    for await (const job of ctx.db.query("eventSyncJobs").withIndex("by_state_dueAt", q => q.eq("state", "running"))) {
      if ((job.leaseExpiresAt ?? 0) <= cutoff) expired.push(job);
      if (expired.length >= 100) break;
    }
    for (const job of expired) await failAttempt(ctx, job, "lease_expired", 0);
    // A pending job this far past due means its run threw before or inside claimJob; count it as a failed attempt.
    const stalled = await ctx.db.query("eventSyncJobs").withIndex("by_state_dueAt", q => q.eq("state", "pending").lte("dueAt", cutoff)).take(100);
    for (const job of stalled) {
      const attempts = job.attempts + 1;
      await ctx.db.patch(job._id, { attempts });
      await failAttempt(ctx, { ...job, attempts }, "stalled", 0);
    }
    const retainAfter = now - JOB_RETENTION_MS;
    for (const state of ["done", "failed"] as const) {
      const old = await ctx.db.query("eventSyncJobs").withIndex("by_state_dueAt", q => q.eq("state", state).lt("dueAt", retainAfter)).take(200);
      for (const job of old) await ctx.db.delete(job._id);
    }
  },
});
