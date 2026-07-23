import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { CURRENT_FRESHNESS_MS, TELEMETRY_ROLLUP_VERSION } from "./_communityTelemetry";

export const PUBLIC_TELEMETRY_DEFINITIONS = {
  currentPopulation: { unit: "people", grain: "latest_poll", gapPolicy: "omitted_when_stale" },
  populationHistory: { unit: "people", grain: "hour", gapPolicy: "gaps_are_not_zero" },
  groupMemberCount: { unit: "members", grain: "latest_observation", gapPolicy: "last_observation_is_timestamped" },
  groupMemberGrowth: { unit: "members", grain: "retained_observation_range", gapPolicy: "observed_end_minus_observed_start" },
  eventRecaps: { unit: "mixed", grain: "confirmed_event", gapPolicy: "coverage_ratio_is_explicit" },
} as const;

function publicRollup(rollup: {
  bucketStartAt: number;
  bucketEndAt: number;
  currentPopulation?: number;
  activeInstanceCount: number;
  peakConcurrency: number;
  playerMinutes: number;
  coverageRatio: number;
  groupMemberCount?: number;
  groupMemberGrowth?: number;
  worldDistribution: Array<{ vrchatWorldId: string; samples: number }>;
}, visibility: {
  groupMemberCount: boolean;
  groupMemberGrowth: boolean;
}) {
  return {
    startAt: rollup.bucketStartAt,
    endAt: rollup.bucketEndAt,
    durationMinutes: Math.max(0, (rollup.bucketEndAt - rollup.bucketStartAt) / 60_000),
    ...(rollup.currentPopulation === undefined ? {} : { currentPopulation: rollup.currentPopulation }),
    activeInstanceCount: rollup.activeInstanceCount,
    peakConcurrency: rollup.peakConcurrency,
    playerHours: rollup.playerMinutes / 60,
    coverageRatio: rollup.coverageRatio,
    ...(!visibility.groupMemberCount || rollup.groupMemberCount === undefined
      ? {}
      : { groupMemberCount: rollup.groupMemberCount }),
    ...(!visibility.groupMemberGrowth || rollup.groupMemberGrowth === undefined
      ? {}
      : { groupMemberGrowth: rollup.groupMemberGrowth }),
    worldDistribution: rollup.worldDistribution,
  };
}

export async function getPublicCommunityTelemetry(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
  now: number,
) {
  const integration = await db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (query) => query.eq("communityProfileId", communityProfileId))
    .first();
  if (
    !integration ||
    integration.state === "disconnecting" ||
    integration.state === "disconnected" ||
    !Object.values(integration.publicMetrics).some(Boolean)
  ) {
    return null;
  }

  const [latestPopulation, memberCounts, hourlyRollups, eventRollups] = await Promise.all([
    db.query("communityPopulationObservations")
      .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id))
      .order("desc")
      .first(),
    db.query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id))
      .order("desc")
      .take(500),
    db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query.eq("communityProfileId", communityProfileId).eq("grain", "hour"),
      )
      .order("desc")
      .take(168),
    db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query.eq("communityProfileId", communityProfileId).eq("grain", "event"),
      )
      .order("desc")
      .take(20),
  ]);
  const latestMember = memberCounts[0];
  const earliestMember = memberCounts[memberCounts.length - 1];
  const eventRecaps = (await Promise.all(eventRollups.map(async (rollup) => {
    const event = rollup.eventId ? await db.get(rollup.eventId) : null;
    if (!event || event.publicationState !== "published" || !event.slug || event.communityProfileId !== communityProfileId) return null;
    return {
      event: { slug: event.slug, title: event.title },
      ...publicRollup(rollup, integration.publicMetrics),
    };
  }))).filter((recap) => recap !== null);
  const freshness = integration.lastSuccessfulObservationAt !== undefined &&
    now - integration.lastSuccessfulObservationAt <= CURRENT_FRESHNESS_MS ? "current" as const : "stale" as const;

  return {
    schemaVersion: 1 as const,
    rollupVersion: TELEMETRY_ROLLUP_VERSION,
    freshness,
    observedAt: integration.lastSuccessfulObservationAt,
    definitions: PUBLIC_TELEMETRY_DEFINITIONS,
    ...(integration.publicMetrics.currentPopulation && freshness === "current" && latestPopulation
      ? { currentPopulation: {
          value: latestPopulation.totalPopulation,
          activeInstanceCount: latestPopulation.activeInstanceCount,
          observedAt: latestPopulation.observedAt,
          coverage: latestPopulation.coverageState,
        } }
      : {}),
    ...(integration.publicMetrics.populationHistory
      ? { populationHistory: hourlyRollups.reverse().map((rollup) => publicRollup(rollup, integration.publicMetrics)) }
      : {}),
    ...(integration.publicMetrics.groupMemberCount && latestMember
      ? { groupMemberCount: { value: latestMember.memberCount, observedAt: latestMember.observedAt } }
      : {}),
    ...(integration.publicMetrics.groupMemberGrowth && latestMember && earliestMember
      ? { groupMemberGrowth: {
          value: latestMember.memberCount - earliestMember.memberCount,
          startAt: earliestMember.observedAt,
          endAt: latestMember.observedAt,
        } }
      : {}),
    ...(integration.publicMetrics.eventRecaps ? { eventRecaps } : {}),
  };
}
