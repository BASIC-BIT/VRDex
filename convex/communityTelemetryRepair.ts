import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { populationRollupValues } from "./communityTelemetry";
import {
  TELEMETRY_ROLLUP_VERSION,
  MAX_INTERPOLATION_GAP_MS,
  computePopulationMetrics,
} from "./_communityTelemetry";
import { populationPairHasGap } from "./_collectionCoverage";
import {
  readManagedIntegration,
  readLegacyRollupMapping,
} from "./_groupObservationPolicy";

const targetFields = {
  grain: v.union(v.literal("hour"), v.literal("day"), v.literal("event")),
  bucketStartAt: v.number(),
  bucketEndAt: v.number(),
  eventId: v.optional(v.id("events")),
};
type Target = Pick<
  Doc<"communityTelemetryRepairTargets">,
  "grain" | "bucketStartAt" | "bucketEndAt" | "eventId"
>;
const key = (t: Target) => `${t.grain}:${t.bucketStartAt}:${t.eventId ?? ""}`;
const scopeFields = {
  integrationId: v.id("communityVrchatIntegrations"),
  startAt: v.number(),
  endAt: v.number(),
};
function checkRange(start: number, end: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end - start > 93 * 86400_000 ||
    end > Date.now()
  )
    throw new Error(
      "Invalid repair scope: choose a past range of at most 93 days.",
    );
}
async function checkTarget(
  ctx: QueryCtx | MutationCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  t: Target,
) {
  const integration = await ctx.db.get(integrationId);
  if (!integration) throw new Error("Blocked: integration is missing.");
  const epoch = integration.telemetryEpochStartedAt ?? integration.createdAt;
  checkRange(t.bucketStartAt, t.bucketEndAt);
  if (t.bucketStartAt < epoch)
    throw new Error("Blocked: ambiguous historical epoch mapping.");
  if (t.grain === "event") {
    if (!t.eventId || !integration.communityProfileId)
      throw new Error("Blocked: missing event mapping.");
    const event = await ctx.db.get(t.eventId);
    const current = await readManagedIntegration(
      ctx.db,
      integration.communityProfileId,
    );
    if (
      event?.scheduleKind === "date_only" ||
      current?._id !== integrationId ||
      event?.communityProfileId !== integration.communityProfileId ||
      event.startAt !== t.bucketStartAt ||
      (event.endAt ?? event.startAt + 6 * 3600_000) !== t.bucketEndAt
    )
      throw new Error("Blocked: event scope changed.");
    const association = await ctx.db
      .query("eventInstanceAssociations")
      .withIndex("by_eventId_state", (q) =>
        q.eq("eventId", t.eventId!).eq("state", "confirmed"),
      )
      .first();
    if (!association)
      throw new Error("Blocked: event has no confirmed instance.");
  } else if (
    t.eventId ||
    t.bucketEndAt - t.bucketStartAt !==
      (t.grain === "hour" ? 3600_000 : 86400_000)
  ) {
    throw new Error("Blocked: invalid bucket identity.");
  }
  if (t.grain !== "event") {
    const raw = await ctx.db
      .query("communityPopulationObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q
          .eq("integrationId", integrationId)
          .gte(
            "observedAt",
            Math.max(epoch, t.bucketStartAt - MAX_INTERPOLATION_GAP_MS),
          )
          .lte("observedAt", t.bucketEndAt + MAX_INTERPOLATION_GAP_MS),
      )
      .first();
    if (!raw) throw new Error("Blocked: raw observations are missing.");
  }
  return integration;
}
async function existingRollup(
  ctx: QueryCtx | MutationCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  t: Target,
) {
  const rows = t.eventId
    ? await ctx.db
        .query("communityTelemetryRollups")
        .withIndex("by_integrationId_eventId_rollupVersion", (q) =>
          q.eq("integrationId", integrationId).eq("eventId", t.eventId),
        )
        .take(2)
    : await ctx.db
        .query("communityTelemetryRollups")
        .withIndex("by_integrationId_grain_bucketStartAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .eq("grain", t.grain)
            .eq("bucketStartAt", t.bucketStartAt),
        )
        .take(2);
  if (rows.length > 1) throw new Error("Blocked: duplicate rollup identity.");
  const integration = await ctx.db.get(integrationId);
  if (integration?.communityProfileId) {
    const legacy = t.eventId
      ? await ctx.db
          .query("communityTelemetryRollups")
          .withIndex("by_eventId_integrationId", (q) =>
            q.eq("eventId", t.eventId).eq("integrationId", undefined),
          )
          .take(2)
      : await ctx.db
          .query("communityTelemetryRollups")
          .withIndex(
            "by_communityProfileId_integrationId_grain_bucketStartAt",
            (q) =>
              q
                .eq("communityProfileId", integration.communityProfileId!)
                .eq("integrationId", undefined)
                .eq("grain", t.grain)
                .eq("bucketStartAt", t.bucketStartAt),
          )
          .take(2);
    if (legacy.length) {
      const mapping = await readLegacyRollupMapping(
        ctx.db,
        integration.communityProfileId,
      );
      if (
        rows.length ||
        legacy.length > 1 ||
        mapping.kind !== "resolved" ||
        mapping.integration._id !== integrationId
      )
        throw new Error("Blocked: ambiguous legacy rollup mapping.");
      return legacy[0];
    }
  }
  return rows[0] ?? null;
}

export const inventory = internalQuery({
  args: {
    ...scopeFields,
    grain: targetFields.grain,
    legacy: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    checkRange(args.startAt, args.endAt);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 50)
      throw new Error("Inventory page limit is 50.");
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Missing integration.");
    if (args.grain === "event") {
      if (!integration.communityProfileId)
        return { page: [], isDone: true, continueCursor: "" };
      const page = await ctx.db
        .query("events")
        .withIndex("by_communityProfileId_startAt", (q) =>
          q
            .eq("communityProfileId", integration.communityProfileId!)
            .gte("startAt", args.startAt)
            .lt("startAt", args.endAt),
        )
        .paginate(args.paginationOpts);
      const targets = [];
      for (const e of page.page) {
        const confirmed = await ctx.db
          .query("eventInstanceAssociations")
          .withIndex("by_eventId_state", (q) =>
            q.eq("eventId", e._id).eq("state", "confirmed"),
          )
          .first();
        if (
          confirmed &&
          e.startAt !== undefined &&
          (e.endAt ?? e.startAt + 6 * 3600_000) <= args.endAt
        )
          targets.push({
            grain: "event",
            bucketStartAt: e.startAt,
            bucketEndAt: e.endAt ?? e.startAt + 6 * 3600_000,
            eventId: e._id,
          });
      }
      return { ...page, page: targets };
    }
    if (args.legacy && !integration.communityProfileId)
      return { page: [], isDone: true, continueCursor: "" };
    const page = args.legacy
      ? await ctx.db
          .query("communityTelemetryRollups")
          .withIndex(
            "by_communityProfileId_integrationId_grain_bucketStartAt",
            (q) =>
              q
                .eq("communityProfileId", integration.communityProfileId!)
                .eq("integrationId", undefined)
                .eq("grain", args.grain)
                .gte("bucketStartAt", args.startAt)
                .lt("bucketStartAt", args.endAt),
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("communityTelemetryRollups")
          .withIndex("by_integrationId_grain_bucketStartAt", (q) =>
            q
              .eq("integrationId", args.integrationId)
              .eq("grain", args.grain)
              .gte("bucketStartAt", args.startAt)
              .lt("bucketStartAt", args.endAt),
          )
          .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page
        .filter((r) => r.bucketEndAt <= args.endAt)
        .map((r) => ({
          grain: r.grain,
          bucketStartAt: r.bucketStartAt,
          bucketEndAt: r.bucketEndAt,
        })),
    };
  },
});

export const preview = internalQuery({
  args: { integrationId: v.id("communityVrchatIntegrations"), ...targetFields },
  returns: v.any(),
  handler: async (ctx, args) => {
    try {
      const integration = await checkTarget(ctx, args.integrationId, args);
      const previous = await existingRollup(ctx, args.integrationId, args);
      if (args.grain === "event") return { status: "event", previous };
      const proposed = await populationRollupValues(ctx, integration, {
        ...args,
        grain: args.grain,
      });
      const raw = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integration._id)
            .gte("observedAt", args.bucketStartAt - MAX_INTERPOLATION_GAP_MS)
            .lte("observedAt", args.bucketEndAt + MAX_INTERPOLATION_GAP_MS),
        )
        .first();
      if (!raw) throw new Error("Blocked: raw observations are missing.");
      return { status: "ready", previous, proposed };
    } catch (error) {
      return {
        status: "blocked",
        error: error instanceof Error ? error.message : "Invalid target",
      };
    }
  },
});

export const eventPage = internalQuery({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    ...targetFields,
    cursor: v.union(v.string(), v.null()),
    previousAt: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const integration = await checkTarget(ctx, args.integrationId, args);
    const epoch = integration.telemetryEpochStartedAt ?? integration.createdAt;
    const page = await ctx.db
      .query("instancePopulationObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q
          .eq("integrationId", integration._id)
          .gte(
            "observedAt",
            Math.max(epoch, args.bucketStartAt - MAX_INTERPOLATION_GAP_MS),
          )
          .lte("observedAt", args.bucketEndAt + MAX_INTERPOLATION_GAP_MS),
      )
      .paginate({ cursor: args.cursor, numItems: 100 });
    const rows: Array<{
      at: number;
      value: number;
      coverage: string;
      sessionId: Id<"instanceSessions">;
      breakBefore?: boolean;
    }> = [];
    const associated = new Map<Id<"instanceSessions">, boolean>();
    for (const p of page.page) {
      let valid = associated.get(p.sessionId);
      if (valid === undefined) {
        const a = await ctx.db
          .query("eventInstanceAssociations")
          .withIndex("by_sessionId_state", (q) =>
            q.eq("sessionId", p.sessionId).eq("state", "confirmed"),
          )
          .first();
        const session = await ctx.db.get(p.sessionId);
        valid =
          a !== null &&
          a.eventId === args.eventId &&
          a.communityProfileId === integration.communityProfileId &&
          session?.integrationId === integration._id &&
          session.openedAt >= epoch;
        associated.set(p.sessionId, valid);
      }
      if (valid)
        rows.push({
          at: p.observedAt,
          value: p.population,
          coverage: p.coverageState,
          sessionId: p.sessionId,
        });
    }
    let previousAt = args.previousAt;
    for (const row of rows) {
      row.breakBefore =
        previousAt !== undefined &&
        row.at > previousAt &&
        row.at - previousAt <= MAX_INTERPOLATION_GAP_MS &&
        (await populationPairHasGap(ctx, {
          integrationId: integration._id,
          epochStartedAt: epoch,
          startAt: previousAt,
          endAt: row.at,
        }));
      previousAt = row.at;
    }
    return {
      rows,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      lastAt: previousAt,
    };
  },
});
export const previewEvent = internalAction({
  args: { integrationId: v.id("communityVrchatIntegrations"), ...targetFields },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    try {
      if (args.grain !== "event")
        throw new Error("Event preview requires an event target.");
      const previous = await ctx.runQuery(
        internal.communityTelemetryRepair.preview,
        args,
      );
      if (previous.status !== "event") return previous;
      let cursor: string | null = null,
        previousAt: number | undefined;
      const totals = new Map<
        number,
        {
          value: number;
          valid: boolean;
          sessions: Set<string>;
          breakBefore: boolean;
        }
      >();
      for (let n = 0; n < 10000; n++) {
        const page: {
          rows: Array<{
            at: number;
            value: number;
            coverage: string;
            breakBefore?: boolean;
            sessionId: string;
          }>;
          lastAt?: number;
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(internal.communityTelemetryRepair.eventPage, {
          ...args,
          cursor,
          ...(previousAt === undefined ? {} : { previousAt }),
        });
        for (const row of page.rows) {
          const total = totals.get(row.at) ?? {
            value: 0,
            valid: false,
            sessions: new Set<string>(),
            breakBefore: false,
          };
          total.sessions.add(row.sessionId);
          total.breakBefore ||= row.breakBefore === true;
          if (row.coverage === "observed" || row.coverage === "estimated") {
            total.value += row.value;
            total.valid = true;
          }
          totals.set(row.at, total);
        }
        if (page.lastAt !== undefined) previousAt = page.lastAt;
        if (page.isDone) {
          const points = [...totals].map(([at, t]) => ({
            at,
            value: t.value,
            coverage: t.valid ? "observed" : "unknown",
            breakBefore: t.breakBefore,
          }));
          const metrics = computePopulationMetrics(
            points.map((p) => ({
              observedAt: p.at,
              population: p.value,
              coverageState: p.coverage === "observed" ? "observed" : "unknown",
              breakBefore: p.breakBefore,
              instanceKey: "aggregate",
              worldId: "aggregate",
            })),
            args.bucketStartAt,
            args.bucketEndAt,
          );
          if (!points.length)
            throw new Error("Blocked: raw observations are missing.");
          return {
            status: "ready",
            previous: previous.previous,
            proposed: {
              peakConcurrency: metrics.peakConcurrency,
              playerMinutes: metrics.playerMinutes,
              coverageRatio: metrics.coverageRatio,
              rollupVersion: TELEMETRY_ROLLUP_VERSION,
              activeInstanceCount: Math.max(
                0,
                ...[...totals]
                  .filter(
                    ([at]) => at >= args.bucketStartAt && at < args.bucketEndAt,
                  )
                  .map(([, t]) => t.sessions.size),
              ),
            },
          };
        }
        cursor = page.continueCursor;
      }
      throw new Error("Event preview exceeded its page limit.");
    } catch (error) {
      return {
        status: "blocked",
        error: error instanceof Error ? error.message : "Event preview failed",
      };
    }
  },
});

export const begin = internalMutation({
  args: {
    ...scopeFields,
    inventoryId: v.string(),
    expectedTargets: v.number(),
  },
  returns: v.id("communityTelemetryRepairRuns"),
  handler: async (ctx, args) => {
    checkRange(args.startAt, args.endAt);
    if (
      !args.inventoryId ||
      args.inventoryId.length > 100 ||
      !Number.isSafeInteger(args.expectedTargets) ||
      args.expectedTargets < 1 ||
      args.expectedTargets > 100000
    )
      throw new Error("Invalid repair inventory.");
    const previous = await ctx.db
      .query("communityTelemetryRepairRuns")
      .withIndex("by_inventoryId", (q) => q.eq("inventoryId", args.inventoryId))
      .unique();
    if (previous) {
      if (
        previous.integrationId !== args.integrationId ||
        previous.startAt !== args.startAt ||
        previous.endAt !== args.endAt ||
        previous.expectedTargets !== args.expectedTargets
      )
        throw new Error("Inventory scope changed.");
      return previous._id;
    }
    for (const state of ["assembling", "active"] as const) {
      const active = await ctx.db
        .query("communityTelemetryRepairRuns")
        .withIndex("by_version_state", (q) =>
          q.eq("version", TELEMETRY_ROLLUP_VERSION).eq("state", state),
        )
        .first();
      if (active) throw new Error("Another repair is active; resume it first.");
    }
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Missing integration.");
    return ctx.db.insert("communityTelemetryRepairRuns", {
      ...args,
      epochStartedAt:
        integration.telemetryEpochStartedAt ?? integration.createdAt,
      version: TELEMETRY_ROLLUP_VERSION,
      registeredTargets: 0,
      state: "assembling",
      createdAt: Date.now(),
    });
  },
});
export const append = internalMutation({
  args: {
    runId: v.id("communityTelemetryRepairRuns"),
    targets: v.array(v.object(targetFields)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.state !== "assembling" || args.targets.length > 50)
      throw new Error("Invalid inventory assembly.");
    let added = 0;
    for (const target of args.targets) {
      if (target.bucketStartAt < run.startAt || target.bucketEndAt > run.endAt)
        throw new Error("Target exceeds inventory scope.");
      await checkTarget(ctx, run.integrationId, target);
      const previous = await ctx.db
        .query("communityTelemetryRepairTargets")
        .withIndex("by_runId_key", (q) =>
          q.eq("runId", run._id).eq("key", key(target)),
        )
        .unique();
      if (previous) {
        if (previous.bucketEndAt !== target.bucketEndAt)
          throw new Error("Target scope changed.");
        continue;
      }
      const rollup = await existingRollup(ctx, run.integrationId, target);
      await ctx.db.insert("communityTelemetryRepairTargets", {
        ...target,
        runId: run._id,
        key: key(target),
        ...(rollup ? { rollupId: rollup._id } : {}),
        state: "pending",
        updatedAt: Date.now(),
      });
      added++;
    }
    if (run.registeredTargets + added > run.expectedTargets)
      throw new Error("Inventory scope exceeds target count.");
    await ctx.db.patch(run._id, {
      registeredTargets: run.registeredTargets + added,
    });
    return null;
  },
});
export const seal = internalMutation({
  args: { runId: v.id("communityTelemetryRepairRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.registeredTargets !== run.expectedTargets)
      throw new Error("Inventory is incomplete.");
    if (run.state === "assembling")
      await ctx.db.patch(runId, { state: "active" });
    return null;
  },
});
export const getRun = internalQuery({
  args: { runId: v.id("communityTelemetryRepairRuns") },
  returns: v.any(),
  handler: (ctx, { runId }) => ctx.db.get(runId),
});
export const repairTarget = internalMutation({
  args: { targetId: v.id("communityTelemetryRepairTargets") },
  returns: v.null(),
  handler: async (ctx, { targetId }): Promise<null> => {
    const t = await ctx.db.get(targetId);
    if (!t || t.state === "corrected") return null;
    const run = await ctx.db.get(t.runId);
    if (
      !run ||
      run.state !== "active" ||
      run.version !== TELEMETRY_ROLLUP_VERSION
    )
      return null;
    try {
      const integration = await checkTarget(ctx, run.integrationId, t);
      if (
        (integration.telemetryEpochStartedAt ?? integration.createdAt) !==
        run.epochStartedAt
      )
        throw new Error("Blocked: presentation epoch changed.");
      await existingRollup(ctx, run.integrationId, t);
      if (t.jobId && await ctx.db.get(t.jobId)) {
        await ctx.runMutation(internal.communityTelemetry.continueEventRecapJob, { jobId: t.jobId });
      } else {
        await ctx.runMutation(internal.communityTelemetry.recomputeRollup, {
          integrationId: run.integrationId,
          ...(integration.communityProfileId ? { communityProfileId: integration.communityProfileId } : {}),
          grain: t.grain, bucketStartAt: t.bucketStartAt, bucketEndAt: t.bucketEndAt,
          ...(t.eventId ? { eventId: t.eventId } : {}),
        });
      }
      const job = t.eventId
        ? await ctx.db
            .query("communityTelemetryEventRecapJobs")
            .withIndex("by_eventId", (q) => q.eq("eventId", t.eventId!))
            .first()
        : null;
      if (job?.failure) throw new Error(job.failure);
      const output = await existingRollup(ctx, run.integrationId, t);
      if (!job && !matchingOutput(output, run, t))
        throw new Error("Recomputation produced no matching corrected rollup.");
      await ctx.db.patch(targetId, {
        ...(output ? { rollupId: output._id } : {}),
        ...(job ? { jobId: job._id } : {}),
        state: job ? "pending" : "corrected",
        error: undefined,
        updatedAt: Date.now(),
      });
    } catch (error) {
      await ctx.db.patch(targetId, {
        state: "failed",
        error: (error instanceof Error ? error.message : "Repair failed").slice(
          0,
          500,
        ),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
export const refresh = internalMutation({
  args: {
    runId: v.id("communityTelemetryRepairRuns"),
    cursor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { runId, cursor }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("Missing repair run.");
    const counts = { pending: 0, corrected: 0, failed: 0, blocked: 0 };
    const page = await ctx.db
      .query("communityTelemetryRepairTargets")
      .withIndex("by_runId_key", (q) => q.eq("runId", runId))
      .paginate({ cursor: cursor ?? null, numItems: 50 });
    for (const t of page.page) {
      let state = t.state;
      if (state === "pending" && t.eventId) {
        const job = await ctx.db
          .query("communityTelemetryEventRecapJobs")
          .withIndex("by_eventId", (q) => q.eq("eventId", t.eventId!))
          .unique();
        if (job) {
          if (job.failure) {
            state = "failed";
            await ctx.db.patch(t._id, {
              state,
              error: job.failure,
              jobId: job._id,
              updatedAt: Date.now(),
            });
          } else if (
            job.integrationId !== run.integrationId ||
            job.bucketStartAt !== t.bucketStartAt ||
            job.bucketEndAt !== t.bucketEndAt
          ) {
            state = "failed";
            await ctx.db.patch(t._id, {
              state,
              error: "Replacement recap scope differs from inventory",
              updatedAt: Date.now(),
            });
          } else if (t.jobId !== job._id)
            await ctx.db.patch(t._id, {
              jobId: job._id,
              updatedAt: Date.now(),
            });
        } else if (t.jobId) {
          const row = await existingRollup(ctx, run.integrationId, t);
          state = matchingOutput(row, run, t) ? "corrected" : "failed";
          await ctx.db.patch(t._id, {
            state,
            ...(row ? { rollupId: row._id } : {}),
            jobId: undefined,
            ...(state === "failed"
              ? { error: "Recap stopped without a corrected target" }
              : {}),
            updatedAt: Date.now(),
          });
        }
      }
      counts[state]++;
    }
    let outstanding = false;
    for (const state of ["pending", "failed", "blocked"] as const) {
      if (
        await ctx.db
          .query("communityTelemetryRepairTargets")
          .withIndex("by_runId_state", (q) =>
            q.eq("runId", runId).eq("state", state),
          )
          .first()
      )
        outstanding = true;
    }
    const complete =
      !outstanding &&
      run.registeredTargets === run.expectedTargets &&
      run.state !== "assembling";
    if (complete && run.state !== "complete")
      await ctx.db.patch(runId, { state: "complete" });
    return {
      ...counts,
      runId,
      complete,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      registeredTargets: run.registeredTargets,
      expectedTargets: run.expectedTargets,
    };
  },
});

function matchingOutput(
  row: Doc<"communityTelemetryRollups"> | null,
  run: Doc<"communityTelemetryRepairRuns">,
  target: Target,
) {
  return (
    row !== null &&
    row.integrationId === run.integrationId &&
    row.grain === target.grain &&
    row.eventId === target.eventId &&
    row.bucketStartAt === target.bucketStartAt &&
    row.bucketEndAt === target.bucketEndAt &&
    row.rollupVersion === run.version &&
    row.computedAt >= run.createdAt
  );
}
