import { readClubVisibility } from "./_clubAccess";
import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { CURRENT_FRESHNESS_MS, TELEMETRY_ROLLUP_VERSION } from "./_communityTelemetry";

export const PUBLIC_TELEMETRY_DEFINITIONS = {
  currentPopulation: { unit: "people", grain: "latest_poll", gapPolicy: "omitted_when_stale" },
  populationHistory: { unit: "people", grain: "hour", gapPolicy: "gaps_are_not_zero" },
  groupMemberCount: { unit: "members", grain: "latest_observation", gapPolicy: "last_observation_is_timestamped" },
  groupMemberGrowth: { unit: "members", grain: "founding_or_retained_observation_range", gapPolicy: "known_founding_or_observed_start" },
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
  const primaryGroupId = primary.find((link) => link.linkRole === "primary")?.assetExternalId;
  const integration = await db.query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) => q.eq("communityProfileId", communityProfileId))
    .first();
  const fallbackGroupId = !primaryGroupId && integration?.state !== "disconnected" &&
    integration?.state !== "disconnecting" ? integration?.vrchatGroupId : undefined;
  const removedFallback = fallbackGroupId ? (await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_assetExternalId", (q) => q
      .eq("profileId", communityProfileId).eq("assetType", "vrchat_group")
      .eq("assetExternalId", fallbackGroupId))
    .take(100)).some((link) => link.state === "removed") : false;
  const groupId = primaryGroupId ?? (removedFallback ? undefined : fallbackGroupId);
  if (!groupId) return null;

  const groupQuery = () => db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", (q) => q.eq("vrchatGroupId", groupId));
  const connected = integration?.vrchatGroupId === groupId ? integration : null;
  const epochStart = connected ? connected.telemetryEpochStartedAt ?? connected.createdAt : 0;
  const [groupRecent, groupFirst, connectedRecent, connectedFirst, groupMetadata] = await Promise.all([
    groupQuery().order("desc").take(500),
    groupQuery().order("asc").first(),
    connected
      ? db.query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", connected._id)
          .gte("observedAt", epochStart))
        .order("desc").take(500)
      : Promise.resolve([]),
    connected
      ? db.query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", connected._id)
          .gte("observedAt", epochStart))
        .order("asc").first()
      : Promise.resolve(null),
    db.query("vrchatGroupMemberMetadata")
      .withIndex("by_vrchatGroupId", (q) => q.eq("vrchatGroupId", groupId))
      .unique(),
  ]);
  const firstAt = Math.min(groupFirst?.observedAt ?? Infinity, connectedFirst?.observedAt ?? Infinity);
  const lastAt = Math.max(groupRecent[0]?.observedAt ?? -Infinity, connectedRecent[0]?.observedAt ?? -Infinity);
  if (!Number.isFinite(firstAt) || !Number.isFinite(lastAt)) return null;
  const sampleGroup = groupRecent.length === 500 && groupFirst?.observedAt !== groupRecent[499]?.observedAt;
  const sampleConnected = connectedRecent.length === 500 &&
    connectedFirst?.observedAt !== connectedRecent[499]?.observedAt;
  // Eight windows per saturated source keep long views useful without a read per day.
  const historicalWindows = 8;
  const width = Math.max(1, Math.ceil((lastAt - firstAt + 1) / historicalWindows));
  const historical = await Promise.all(Array.from({ length: sampleGroup || sampleConnected ? historicalWindows : 0 }, async (_, i) => {
    const start = firstAt + i * width;
    const end = Math.min(lastAt + 1, start + width);
    if (start >= end) return { group: null, member: null };
    const [group, member] = await Promise.all([
      sampleGroup ? db.query("vrchatGroupMemberSnapshots")
        .withIndex("by_vrchatGroupId_observedAt", (q) => q.eq("vrchatGroupId", groupId)
          .gte("observedAt", start).lt("observedAt", end))
        .first() : Promise.resolve(null),
      sampleConnected && connected && end > epochStart
        ? db.query("communityMemberCountObservations")
          .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", connected._id)
            .gte("observedAt", Math.max(start, epochStart)).lt("observedAt", end))
          .first()
        : Promise.resolve(null),
    ]);
    return { group, member };
  }));
  const observations = new Map<number, number>();
  for (const row of [...connectedRecent, ...(connectedFirst ? [connectedFirst] : []),
    ...historical.flatMap((sample) => sample.member ? [sample.member] : [])]) {
    if (row.vrchatGroupId === groupId) observations.set(row.observedAt, row.memberCount);
  }
  for (const row of [...groupRecent, ...(groupFirst ? [groupFirst] : []),
    ...historical.flatMap((sample) => sample.group ? [sample.group] : [])]) {
    observations.set(row.observedAt, row.memberCount);
  }
  const allPoints = [...observations].sort(([a], [b]) => a - b)
    .map(([observedAt, value]) => ({ observedAt, value }));
  if (allPoints.length === 0) return null;
  const historicalTimes = new Set(historical.flatMap(({ group, member }) =>
    [group?.observedAt, member?.vrchatGroupId === groupId ? member.observedAt : undefined]
      .filter((at): at is number => at !== undefined)));
  historicalTimes.add(allPoints[0]!.observedAt);
  historicalTimes.add(allPoints[allPoints.length - 1]!.observedAt);
  const required = allPoints.filter((point) => historicalTimes.has(point.observedAt));
  const optional = allPoints.filter((point) => !historicalTimes.has(point.observedAt));
  const remaining = Math.max(0, 500 - required.length);
  const sampled = optional.length <= remaining ? optional : Array.from({ length: remaining }, (_, i) =>
    optional[Math.floor(i * (optional.length - 1) / Math.max(1, remaining - 1))]!);
  let selected = [...required, ...sampled].sort((a, b) => a.observedAt - b.observedAt);
  const indexByTime = new Map(allPoints.map((point, index) => [point.observedAt, index]));
  type Probe = { index: number; source: "group" | "connected"; start: number; end: number };
  const probesFor = (points: typeof allPoints) => {
    const probes: Probe[] = [];
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!;
      const point = points[index]!;
      if (Math.floor(point.observedAt / 86_400_000) - Math.floor(previous.observedAt / 86_400_000) <= 1 ||
        indexByTime.get(point.observedAt)! - indexByTime.get(previous.observedAt)! > 1) continue;
      if (sampleGroup) {
        const start = Math.max(previous.observedAt + 1, groupFirst!.observedAt + 1);
        const end = Math.min(point.observedAt, groupRecent[499]!.observedAt);
        if (start < end) probes.push({ index, source: "group", start, end });
      }
      if (sampleConnected) {
        const start = Math.max(previous.observedAt + 1, connectedFirst!.observedAt + 1, epochStart);
        const end = Math.min(point.observedAt, connectedRecent[499]!.observedAt);
        if (start < end) probes.push({ index, source: "connected", start, end });
      }
    }
    return probes;
  };
  let probes = probesFor(selected);
  if (probes.length > 32) {
    // ponytail: cap pathological mixed-source reads with a coarse 17-point view; daily rollups can replace this later.
    selected = Array.from({ length: 17 }, (_, i) =>
      selected[Math.floor(i * (selected.length - 1) / 16)]!);
    probes = probesFor(selected);
  }
  const sampledIndices = new Set((await Promise.all(probes.map(async (probe) => {
    const row = probe.source === "group"
      ? await db.query("vrchatGroupMemberSnapshots")
        .withIndex("by_vrchatGroupId_observedAt", (q) => q.eq("vrchatGroupId", groupId)
          .gte("observedAt", probe.start).lt("observedAt", probe.end))
        .first()
      : await db.query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", connected!._id)
          .gte("observedAt", probe.start).lt("observedAt", probe.end))
        .first();
    return row && row.vrchatGroupId === groupId ? probe.index : null;
  }))).filter((index): index is number => index !== null));
  const points = selected.map((point, index) => {
    const previous = selected[index - 1];
    if (!previous) return point;
    const omittedKnownPoint = indexByTime.get(point.observedAt)! - indexByTime.get(previous.observedAt)! > 1;
    return omittedKnownPoint || sampledIndices.has(index) ? { ...point, sampledBefore: true as const } : point;
  });
  const latest = allPoints[allPoints.length - 1]!;
  const groupCreatedAt = groupMetadata?.groupCreatedAt
    ?? groupRecent.find((row) => row.groupCreatedAt !== undefined)?.groupCreatedAt
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
  const links = await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_state", (q) => q
      .eq("profileId", communityProfileId).eq("assetType", "vrchat_group").eq("state", "active"))
    .take(100);
  const primaryGroupId = links.find((link) => link.linkRole === "primary")?.assetExternalId;
  const removedFallback = !primaryGroupId && (await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_assetExternalId", (q) => q
      .eq("profileId", communityProfileId).eq("assetType", "vrchat_group")
      .eq("assetExternalId", integration.vrchatGroupId))
    .take(100)).some((link) => link.state === "removed");
  const memberGroupMatches = primaryGroupId
    ? primaryGroupId === integration.vrchatGroupId : !removedFallback;
  const publicMetrics = { currentPopulation: visibility.current_population.audience === "public", populationHistory: visibility.population_history.audience === "public", groupMemberCount: memberGroupMatches && visibility.group_size.audience === "public", groupMemberGrowth: memberGroupMatches && visibility.membership_movement.audience === "public", instanceHistory: visibility.instance_history.audience === "public", eventRecaps: visibility.event_recaps.audience === "public" };
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
  const groupMetadata = publicMetrics.groupMemberGrowth && latestMember
    ? await db.query("vrchatGroupMemberMetadata")
        .withIndex("by_vrchatGroupId", (query) => query.eq("vrchatGroupId", integration.vrchatGroupId))
        .unique()
    : null;
  const foundingAt = groupMetadata?.groupCreatedAt !== undefined && latestMember &&
    groupMetadata.groupCreatedAt <= latestMember.observedAt ? groupMetadata.groupCreatedAt : undefined;
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
          value: latestMember.memberCount - (foundingAt === undefined ? earliestMember.memberCount : 1),
          startAt: foundingAt ?? earliestMember.observedAt,
          endAt: latestMember.observedAt,
        } }
      : {}),
    ...(publicMetrics.instanceHistory ? { instanceHistory } : {}),
    ...(publicMetrics.eventRecaps ? { eventRecaps } : {}),
  };
}
