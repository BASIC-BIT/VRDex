import { notFound } from "next/navigation";

import { CommunityTelemetryDashboard, type TelemetryDashboardData } from "../../account/communities/[slug]/telemetry/community-telemetry-dashboard";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

const now = Date.parse("2026-07-21T20:00:00.000Z");
const population = Array.from({ length: 721 }, (_, index) => index)
  .filter((index) => index < 300 || index > 330)
  .map((index) => ({
    observedAt: now - (720 - index) * 2 * 60_000,
    totalPopulation: Math.max(0, Math.round(22 + Math.sin(index / 75) * 18 + (index > 450 ? 20 : 0))),
    activeInstanceCount: index > 450 ? 3 : 2,
    coverageState: index >= 420 && index <= 450 ? "estimated" as const : "observed" as const,
  }));
const fixture: TelemetryDashboardData = {
  community: { slug: "the-faceless", displayName: "The Faceless" },
  integration: {
    state: "active", groupVisibility: "private", joinPolicy: "request",
    vrchatGroupId: "grp_faceless", lastSuccessfulObservationAt: now, freshness: "current",
    publicMetrics: { currentPopulation: true, populationHistory: false, groupMemberCount: true, groupMemberGrowth: false, eventRecaps: false },
    collector: { accountAlias: "collector-east-1", vrchatUserId: "usr_service_account", state: "ready" },
  },
  summary: { currentPopulation: 54, activeInstanceCount: 3, peakConcurrency: 76, playerHours: 412.6, coverageRatio: 0.963, groupMemberCount: 1842, groupMemberGrowth: 67, worlds: [{ worldId: "wrld_faceless", samples: 3, population: 54 }] },
  population,
  instancePopulation: population.filter((point) => point.observedAt >= now - 5 * 60 * 60_000).map((point) => ({ sessionId: "session_1", observedAt: point.observedAt, population: Math.max(0, Math.round(point.totalPopulation * 0.7)), vrchatWorldId: "wrld_faceless", coverageState: point.coverageState })),
  memberCounts: Array.from({ length: 13 }, (_, index) => ({ observedAt: now - (12 - index) * 2 * 60 * 60_000, memberCount: 1775 + index * 6 })),
  rollups: [
    ...Array.from({ length: 168 }, (_, index) => ({ grain: "hour" as const, bucketStartAt: now - (167 - index) * 60 * 60_000, bucketEndAt: now - (166 - index) * 60 * 60_000, currentPopulation: 34 + (index % 11), activeInstanceCount: 2 + (index % 2), peakConcurrency: 52 + (index % 15), playerMinutes: 80, coverageRatio: 0.96, groupMemberCount: 1775 + Math.floor(index / 6), groupMemberGrowth: 1, worldDistribution: [{ vrchatWorldId: "wrld_faceless", samples: 2 }] })),
    ...Array.from({ length: 30 }, (_, index) => ({ grain: "day" as const, bucketStartAt: now - (29 - index) * 24 * 60 * 60_000, bucketEndAt: now - (28 - index) * 24 * 60 * 60_000, currentPopulation: 30 + (index % 9), activeInstanceCount: 2, peakConcurrency: 48 + (index % 12), playerMinutes: 1800, coverageRatio: 0.95, groupMemberCount: 1700 + index * 5, groupMemberGrowth: 5, worldDistribution: [{ vrchatWorldId: "wrld_faceless", samples: 2 }] })),
    { eventId: "event_1", grain: "event", bucketStartAt: now - 5 * 60 * 60_000, bucketEndAt: now - 60 * 60_000, currentPopulation: 54, activeInstanceCount: 3, peakConcurrency: 76, playerMinutes: 640, coverageRatio: 0.98, groupMemberCount: 1842, groupMemberGrowth: 8, worldDistribution: [{ vrchatWorldId: "wrld_faceless", samples: 3 }] },
  ],
  coverage: [
    { startedAt: now - 24 * 60 * 60_000, endedAt: now - 14 * 60 * 60_000, state: "observed" },
    { startedAt: now - 14 * 60 * 60_000, endedAt: now - 13 * 60 * 60_000, state: "degraded", reason: "Provider backoff" },
    { startedAt: now - 13 * 60 * 60_000, endedAt: now - 10 * 60 * 60_000, state: "observed" },
    { startedAt: now - 10 * 60 * 60_000, endedAt: now - 9 * 60 * 60_000, state: "estimated", reason: "Bounded interpolation" },
    { startedAt: now - 9 * 60 * 60_000, state: "observed" },
  ],
  sessions: [{ _id: "session_1", providerInstanceId: "12345~group(grp_faceless)", vrchatWorldId: "wrld_faceless", state: "open", openedAt: now - 5 * 60 * 60_000, lastObservedAt: now }],
  associations: [{ _id: "association_1", eventId: "event_1", sessionId: "session_1", state: "suggested", confidence: 0.75 }],
  events: [{ _id: "event_1", slug: "faceless-friday", title: "Faceless Friday", startAt: now - 5 * 60 * 60_000 }],
};

export default async function CommunityTelemetryPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") notFound();
  const { state } = await searchParams;
  const previewFixture = state === "disconnected"
    ? { ...fixture, integration: { ...fixture.integration, state: "disconnected" } }
    : fixture;
  return <PageShell><PageContainer max="6xl"><CommunityTelemetryDashboard communitySlug="the-faceless" fixtureData={previewFixture} /></PageContainer></PageShell>;
}
