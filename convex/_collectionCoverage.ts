import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { QUIET_POLL_MAX_MS } from "./_communityTelemetry";

// Five-minute quiet cadence + four-minute management pass + one minute for
// dispatch/transport. This is a continuity inference, not a polling SLA.
export const MEMBERSHIP_POLL_GAP_MS = QUIET_POLL_MAX_MS + 240_000 + 60_000;

export async function transitionCoverage(
  ctx: MutationCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  state: "observed" | "estimated" | "stale" | "unknown" | "degraded",
  at: number,
  source: "first_party" | "vrcpop" | "vrcx",
  collectorVersion: string,
  reason?: string,
  requestStatusClass?: string,
) {
  const latest = await ctx.db
    .query("collectionCoverageWindows")
    .withIndex("by_integrationId_startedAt", (q) =>
      q.eq("integrationId", integrationId),
    )
    .order("desc")
    .first();
  // Retain late observations without rewriting newer collection-state evidence.
  if (latest && at < latest.updatedAt) return latest._id;
  const continuous =
    state !== "observed" ||
    (latest?.observedThroughAt !== undefined &&
      at >= latest.observedThroughAt &&
      at - latest.observedThroughAt <= MEMBERSHIP_POLL_GAP_MS);
  if (
    latest &&
    latest.endedAt === undefined &&
    latest.state === state &&
    latest.reason === reason &&
    continuous
  ) {
    await ctx.db.patch(latest._id, {
      updatedAt: at,
      ...(state === "observed" ? { observedThroughAt: at } : {}),
      ...(requestStatusClass ? { requestStatusClass } : {}),
    });
    return latest._id;
  }
  if (latest && latest.endedAt === undefined) {
    await ctx.db.patch(latest._id, {
      endedAt:
        latest.observedThroughAt === undefined
          ? at
          : Math.min(at, latest.observedThroughAt + MEMBERSHIP_POLL_GAP_MS),
      updatedAt: at,
    });
  }
  return ctx.db.insert("collectionCoverageWindows", {
    integrationId,
    state,
    source,
    collectorVersion,
    startedAt: at,
    ...(state === "observed" ? { observedThroughAt: at } : {}),
    updatedAt: at,
    ...(reason ? { reason: reason.slice(0, 160) } : {}),
    ...(requestStatusClass ? { requestStatusClass } : {}),
  });
}

/** Compact, category-safe coverage. Legacy windows have no internal gap proof.
 * Read at most 1001 small window rows plus one boundary row per local day.
 * Keep the inferred poll deadline, including its remaining allowance, so a
 * client can expire live continuity without waiting for a database write. */
export async function membershipCoverage(
  ctx: QueryCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  startAt: number,
  endAt: number,
  epochStartedAt: number,
) {
  const rows = await ctx.db
    .query("collectionCoverageWindows")
    .withIndex("by_integrationId_startedAt", (q) =>
      q
        .eq("integrationId", integrationId)
        .gte("startedAt", startAt)
        .lt("startedAt", endAt),
    )
    .take(1001);
  if (rows.length > 1000) return { complete: false, intervals: [] };
  const before = await ctx.db
    .query("collectionCoverageWindows")
    .withIndex("by_integrationId_startedAt", (q) =>
      q
        .eq("integrationId", integrationId)
        .gte("startedAt", epochStartedAt)
        .lt("startedAt", startAt),
    )
    .order("desc")
    .first();
  const intervals: Array<{ startAt: number; endAt: number }> = [];
  for (const row of [...(before ? [before] : []), ...rows]) {
    if (row.state !== "observed" || row.observedThroughAt === undefined)
      continue;
    const left = Math.max(startAt, row.startedAt);
    const right = Math.min(
      endAt,
      row.endedAt ?? Infinity,
      row.observedThroughAt + MEMBERSHIP_POLL_GAP_MS,
    );
    if (right <= left) continue;
    const previous = intervals[intervals.length - 1];
    if (previous && previous.endAt >= left)
      previous.endAt = Math.max(previous.endAt, right);
    else intervals.push({ startAt: left, endAt: right });
  }
  return { complete: true, intervals };
}
