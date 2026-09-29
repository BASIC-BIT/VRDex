import { readClubVisibility } from "./_clubAccess";
import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { CURRENT_FRESHNESS_MS, TELEMETRY_ROLLUP_VERSION } from "./_communityTelemetry";

export const PUBLIC_TELEMETRY_DEFINITIONS = {
  currentPopulation: { unit: "people", grain: "latest_poll", gapPolicy: "omitted_when_stale" },
  populationHistory: { unit: "people", grain: "hour", gapPolicy: "gaps_are_not_zero" },
  groupMemberCount: { unit: "members", grain: "latest_observation", gapPolicy: "last_observation_is_timestamped" },
  groupMemberGrowth: { unit: "members", grain: "retained_observation_range", gapPolicy: "observed_end_minus_observed_start" },
  instanceHistory: { unit: "instances", grain: "session", gapPolicy: "first_and_last_observation" },
  eventRecaps: { unit: "mixed", grain: "confirmed_event", gapPolicy: "coverage_ratio_is_explicit" },
} as const;

/** Group counts are shared; the profile's own Group size setting grants access. */
export async function getPublicGroupMembership(
  db: DatabaseReader,
  communityProfileId: Id<"profiles">,
) {
  const visibility = await readClubVisibility(db, communityProfileId);
  if (visibility.group_size.audience !== "public") return null;

  const primary = await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_state", (q) => q
      .eq("profileId", communityProfileId).eq("assetType", "vrchat_group").eq("state", "active"))
    .take(100);
  const integration = await db.query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) => q.eq("communityProfileId", communityProfileId))
    .first();
  const groupId = primary.find((link) => link.linkRole === "primary")?.assetExternalId
    ?? (integration?.state !== "disconnected" && integration?.state !== "disconnecting"
      ? integration?.vrchatGroupId : undefined);
  if (!groupId) return null;

  const groupQuery = () => db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", (q) => q.eq("vrchatGroupId", groupId));
  const [groupRecent, groupFirst, connectedRecent, connectedFirst] = await Promise.all([
    groupQuery().order("desc").take(500),
    groupQuery().order("asc").first(),
    integration?.vrchatGroupId === groupId
      ? db.query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id)
          .gte("observedAt", integration.telemetryEpochStartedAt ?? integration.createdAt))
        .order("desc").take(500)
      : Promise.resolve([]),
    integration?.vrchatGroupId === groupId
      ? db.query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id)
          .gte("observedAt", integration.telemetryEpochStartedAt ?? integration.createdAt))
        .order("asc").first()
      : Promise.resolve(null),
  ]);
  const observations = new Map<number, number>();
  for (const row of [...connectedRecent, ...(connectedFirst ? [connectedFirst] : [])]) {
    if (row.vrchatGroupId === groupId) observations.set(row.observedAt, row.memberCount);
  }
  for (const row of [...groupRecent, ...(groupFirst ? [groupFirst] : [])]) {
    observations.set(row.observedAt, row.memberCount);
  }
  const allPoints = [...observations].sort(([a], [b]) => a - b)
    .map(([observedAt, value]) => ({ observedAt, value }));
  if (allPoints.length === 0) return null;
  // ponytail: recent 500 rows per source plus the first; use range queries if deep drill-down is needed.
  const points = allPoints.length <= 500 ? allPoints : Array.from({ length: 500 }, (_, i) =>
    allPoints[Math.floor(i * (allPoints.length - 1) / 499)]!);
  const latest = allPoints[allPoints.length - 1]!;
  const groupCreatedAt = groupRecent.find((row) => row.groupCreatedAt !== undefined)?.groupCreatedAt
    ?? groupFirst?.groupCreatedAt;
  return {
    ...(groupCreatedAt === undefined ? {} : { groupCreatedAt }),
    latest,
    points,
  };
}

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
  if (!integration || (integration.enabledFeatures && !integration.enabledFeatures.includes("analytics"))) return null;
  const visibility = await readClubVisibility(db, communityProfileId);
  const publicMetrics = { currentPopulation: visibility.current_population.audience === "public", populationHistory: visibility.population_history.audience === "public", groupMemberCount: visibility.group_size.audience === "public", groupMemberGrowth: visibility.membership_movement.audience === "public", instanceHistory: visibility.instance_history.audience === "public", eventRecaps: visibility.event_recaps.audience === "public" };
  if (
    integration.state === "disconnecting" ||
    integration.state === "disconnected" ||
    !Object.values(publicMetrics).some(Boolean)
  ) {
    return null;
  }
  const epochStartedAt = integration.telemetryEpochStartedAt ?? integration.createdAt;

  const [latestPopulation, memberCounts, hourlyRollups, eventRollups] = await Promise.all([
    db.query("communityPopulationObservations")
      .withIndex("by_integrationId_observedAt", (query) =>
        query.eq("integrationId", integration._id).gte("observedAt", epochStartedAt),
      )
      .order("desc")
      .first(),
    db.query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (query) =>
        query.eq("integrationId", integration._id).gte("observedAt", epochStartedAt),
      )
      .order("desc")
      .take(500),
    db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query.eq("communityProfileId", communityProfileId).eq("grain", "hour").gte("bucketStartAt", epochStartedAt),
      )
      .order("desc")
      .take(168),
    db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query.eq("communityProfileId", communityProfileId).eq("grain", "event").gte("bucketStartAt", epochStartedAt),
      )
      .order("desc")
      .take(20),
  ]);
  const latestMember = memberCounts[0];
  const earliestMember = memberCounts[memberCounts.length - 1];
  const sessions = publicMetrics.instanceHistory
    ? await db.query("instanceSessions")
      .withIndex("by_integrationId_openedAt", (query) =>
        query.eq("integrationId", integration._id).gte("openedAt", epochStartedAt),
      )
      .order("desc")
      .take(20)
    : [];
  const instanceHistory = await Promise.all(sessions
    .map(async (session) => {
      const world = session.worldId ? await db.get(session.worldId) : null;
      return {
        world: world?.publicationState === "published"
          ? { slug: world.slug, displayName: world.displayName }
          : null,
        openedAt: session.openedAt,
        lastObservedAt: session.lastObservedAt,
        ...(session.closedAt === undefined ? {} : { closedAt: session.closedAt }),
      };
    }));
  const eventRecaps = (await Promise.all(eventRollups.map(async (rollup) => {
    const event = rollup.eventId ? await db.get(rollup.eventId) : null;
    if (!event || event.publicationState !== "published" || !event.slug || event.communityProfileId !== communityProfileId) return null;
    return {
      event: { slug: event.slug, title: event.title },
      ...publicRollup(rollup, publicMetrics),
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
    ...(publicMetrics.currentPopulation && freshness === "current" && latestPopulation
      ? { currentPopulation: {
          value: latestPopulation.totalPopulation,
          activeInstanceCount: latestPopulation.activeInstanceCount,
          observedAt: latestPopulation.observedAt,
          coverage: latestPopulation.coverageState,
        } }
      : {}),
    ...(publicMetrics.populationHistory
      ? { populationHistory: hourlyRollups.reverse().map((rollup) => publicRollup(rollup, publicMetrics)) }
      : {}),
    ...(publicMetrics.groupMemberCount && latestMember
      ? { groupMemberCount: { value: latestMember.memberCount, observedAt: latestMember.observedAt } }
      : {}),
    ...(publicMetrics.groupMemberGrowth && latestMember && earliestMember
      ? { groupMemberGrowth: {
          value: latestMember.memberCount - earliestMember.memberCount,
          startAt: earliestMember.observedAt,
          endAt: latestMember.observedAt,
        } }
      : {}),
    ...(publicMetrics.instanceHistory ? { instanceHistory } : {}),
    ...(publicMetrics.eventRecaps ? { eventRecaps } : {}),
  };
}
