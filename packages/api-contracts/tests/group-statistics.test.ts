import assert from "node:assert/strict";
import { it } from "node:test";
import { PublicAutomaticGroupStatisticsSchema, PublicCommunityTelemetrySchema, PublicStatisticsRangeInputSchema } from "../src/schemas.js";
it("statistics range requires paired elapsed integer bounds and rejects a 25-hour DST day", () => {
  const end = Date.now() - 1000;
  assert.equal(PublicStatisticsRangeInputSchema.safeParse({}).success, true);
  assert.equal(PublicStatisticsRangeInputSchema.safeParse({ statisticsStartAt: end - 86_400_000, statisticsEndAt: end }).success, true);
  for (const range of [{statisticsStartAt: 1}, {statisticsEndAt: 1}, {statisticsStartAt: 2, statisticsEndAt: 1}, {statisticsStartAt: 0.5, statisticsEndAt: 1}, {statisticsStartAt: end - 90_000_000, statisticsEndAt: end}, {statisticsStartAt: end, statisticsEndAt: Date.now() + 60_000}]) assert.equal(PublicStatisticsRangeInputSchema.safeParse(range).success, false);
});
it("automatic statistics contract strictly rejects world, session, event and named data", () => {
  const safe = { schemaVersion: 1, publicationPolicy: "automatic_aggregate", rollupVersion: "v1", freshness: "stale", definitions: {}, populationHistory: [{ startAt: 0, endAt: 1, durationMinutes: 1/60_000, activeInstanceCount: 0, peakConcurrency: 0, playerHours: 0, coverageRatio: 0 }], groupMemberGrowth: { value: -3, startAt: 0, endAt: 1 } };
  assert.equal(PublicCommunityTelemetrySchema.safeParse(safe).success, true);
  assert.equal(PublicAutomaticGroupStatisticsSchema.safeParse(safe).success, true);
  for (const key of ["worldDistribution", "instanceHistory", "eventRecaps", "members"]) assert.equal(PublicCommunityTelemetrySchema.safeParse({ ...safe, [key]: [] }).success, false);
  assert.equal(PublicCommunityTelemetrySchema.safeParse({ ...safe, groupMemberGrowth: {...safe.groupMemberGrowth, members: ["name"]} }).success, false);
  assert.equal(PublicCommunityTelemetrySchema.safeParse({ ...safe, definitions: { privateName: {unit:"people",grain:"session",gapPolicy:"none"} } }).success, false);
  assert.equal(PublicCommunityTelemetrySchema.safeParse({ ...safe, populationHistory: [{...safe.populationHistory[0], worldDistribution: []}] }).success, false);
});
