import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { Doc } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { defaultClubVisibility } from "../../convex/_clubModel";
import { getPublicCommunityTelemetry, getPublicGroupMembership } from "../../convex/_communityTelemetryPublic";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/migrations.ts": () => import("../../convex/migrations"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const migrate = makeFunctionReference<"mutation", { cursor: string | null; dryRun: boolean; oneBatchOnly: boolean }, { continueCursor: string; isDone: boolean; processed: number }>("migrations:backfillGroupObservationPolicies");
const backfillRollups = makeFunctionReference<"mutation", { cursor: string | null; dryRun: boolean; oneBatchOnly: boolean }, { continueCursor: string; isDone: boolean }>("migrations:backfillGroupTelemetryRollupIntegrations");
async function allPages(t: ReturnType<typeof convexTest>, ref = migrate) {
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result = await t.mutation(ref, { cursor, dryRun: false, oneBatchOnly: true });
    if (result.isDone) return;
    cursor = result.continueCursor;
  }
  assert.fail("migration did not finish");
}
async function seed(t: ReturnType<typeof convexTest>, key: string, overrides: Partial<Doc<"communityVrchatIntegrations">> = {}) {
  return t.run(async ctx => {
    const communityProfileId = await ctx.db.insert("profiles", { slug: key, displayName: key, sortName: key, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: 100, profileType: "community", community: { categoryTags: [] } });
    return ctx.db.insert("communityVrchatIntegrations", { communityProfileId, vrchatGroupId: key, groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 7, publicMetrics: { currentPopulation: true, populationHistory: false, groupMemberCount: true, groupMemberGrowth: false, eventRecaps: false }, enabledFeatures: ["analytics"], telemetryEpochStartedAt: 90, consecutiveFailures: 0, createdAt: 100, updatedAt: 101, ...overrides });
  });
}
it("collection identity normalizes legacy managed and ownerless automatic records and rejects mismatches", async () => {
  assert.ok("collectionScope" in schema.tables.communityVrchatIntegrations.validator.fields);
  const { readCollectionSubject } = await import("../../convex/_groupObservationPolicy");
  const t = convexTest({ schema, modules });
  const id = await seed(t, "identity");
  const legacy = await t.run(ctx => ctx.db.get(id));
  assert.ok(legacy?.communityProfileId);
  assert.deepEqual(readCollectionSubject(legacy), { kind: "managed", communityProfileId: legacy.communityProfileId });
  const automatic = { ...legacy, collectionScope: { kind: "automatic" as const }, communityProfileId: undefined };
  assert.deepEqual(readCollectionSubject(automatic), { kind: "automatic" });
  assert.equal("communityProfileId" in readCollectionSubject(automatic), false);
  assert.throws(() => readCollectionSubject({ ...automatic, communityProfileId: legacy.communityProfileId }), /collection scope/i);
  const otherId = await seed(t, "identity-other");
  const other = await t.run(ctx => ctx.db.get(otherId));
  assert.ok(other?.communityProfileId);
  assert.throws(() => readCollectionSubject({ ...legacy, collectionScope: { kind: "managed", communityProfileId: other.communityProfileId } }), /collection scope/i);
  assert.throws(() => readCollectionSubject({ ...legacy, communityProfileId: undefined }), /collection scope/i);
  await t.run(ctx => ctx.db.insert("communityVrchatIntegrations", (({ _id, _creationTime, ...values }) => values)(automatic)));
});
it("legacy migration preserves managed settings and canonicalizes historical records without reviving stopped groups", async () => {
  const t = convexTest({ schema, modules });
  const ids = await Promise.all([
    seed(t, "active"), seed(t, "disconnected", { state: "disconnected" }),
    seed(t, "disabled", { enabledFeatures: ["posts"] }), seed(t, "private", { groupVisibility: "private", joinPolicy: "invite" }),
    seed(t, "history-old", { vrchatGroupId: "history", state: "disconnected", createdAt: 50 }),
    seed(t, "history-new", { vrchatGroupId: "history", state: "disconnected", createdAt: 80 }),
    seed(t, "conflict-a", { vrchatGroupId: "conflict" }), seed(t, "conflict-b", { vrchatGroupId: "conflict" }),
  ]);
  const before = await t.run(async ctx => Promise.all(ids.map(id => ctx.db.get(id))));
  const visibilityId = await t.run(ctx => ctx.db.insert("communityDataVisibility", {
    communityProfileId: before[0]!.communityProfileId!,
    categories: { ...defaultClubVisibility(), current_population: { audience: "public", staffRoleIds: null } }, updatedAt: 55,
  }));
  const visibilityBefore = await t.run(ctx => ctx.db.get(visibilityId));
  await allPages(t);
  assert.deepEqual(await t.run(ctx => ctx.db.get(visibilityId)), visibilityBefore);
  const policies = await t.run(ctx => ctx.db.query("vrchatGroupObservationPolicies").collect());
  assert.equal(policies.length, 6);
  for (let index = 0; index < ids.length; index++) {
    const after = await t.run(ctx => ctx.db.get(ids[index]!));
    const original = before[index]!;
    assert.deepEqual(after, { ...original, collectionScope: { kind: "managed", communityProfileId: original?.communityProfileId } });
  }
  const policy = (group: string) => policies.find(p => p.vrchatGroupId === group)!;
  assert.equal(policy("active").decision.kind, "enabled");
  assert.equal(policy("private").decision.kind, "enabled");
  assert.equal(policy("disconnected").decision.kind, "stopped");
  assert.equal(policy("disabled").decision.kind, "admission_blocked");
  assert.equal(policy("history").integrationId, ids[5]);
  assert.equal(policy("history").decision.kind, "stopped");
  assert.equal(policy("conflict").integrationId, undefined);
  assert.deepEqual(policy("conflict").decision, { kind: "stopped", reason: "managed_conflict", actor: "migration", at: policy("conflict").decision.at });
  const audits = await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect());
  assert.equal(audits.filter(a => a.action === "group_observation.reconciliation_required").length, 1);
  await allPages(t);
  assert.deepEqual(await t.run(ctx => ctx.db.query("vrchatGroupObservationPolicies").collect()), policies);
  assert.deepEqual(await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect()), audits);
  await t.run(async ctx => { await ctx.db.delete(ids[1]!); await ctx.db.delete(before[1]!.communityProfileId!); });
  assert.equal((await t.run(ctx => ctx.db.get(policy("disconnected")._id)))?.decision.kind, "stopped");
});
it("legacy migration pages at fifty and backfills rollups only through an unambiguous managed mapping", async () => {
  const t = convexTest({ schema, modules });
  const ids = [];
  for (let i = 0; i < 51; i++) ids.push(await seed(t, `page-${i}`));
  const first = await t.mutation(migrate, { cursor: null, dryRun: false, oneBatchOnly: true });
  assert.equal(first.processed, 50);
  assert.equal(first.isDone, false);
  await allPages(t);
  const integration = await t.run(ctx => ctx.db.get(ids[0]!));
  assert.ok(integration?.communityProfileId);
  const rollup = await t.run(ctx => ctx.db.insert("communityTelemetryRollups", { communityProfileId: integration.communityProfileId!, grain: "hour", bucketStartAt: 100, bucketEndAt: 200, rollupVersion: "test", activeInstanceCount: 1, peakConcurrency: 5, playerMinutes: 4, coverageRatio: 1, worldDistribution: [], computedAt: 200 }));
  const before = await t.run(ctx => ctx.db.get(rollup));
  await allPages(t, backfillRollups);
  assert.deepEqual(await t.run(ctx => ctx.db.get(rollup)), { ...before, integrationId: integration._id });
  const after = await t.run(ctx => ctx.db.get(rollup));
  await allPages(t, backfillRollups);
  assert.deepEqual(await t.run(ctx => ctx.db.get(rollup)), after);
});

it("collection identity stores new rollups by integration without relabeling a different group's history", async () => {
  const t = convexTest({ schema, modules });
  const firstId = await seed(t, "rollup-first");
  const secondId = await seed(t, "rollup-second");
  const first = await t.run(ctx => ctx.db.get(firstId));
  assert.ok(first?.communityProfileId);
  const retainedId = await t.run(ctx => ctx.db.insert("communityTelemetryRollups", {
    integrationId: secondId, communityProfileId: first.communityProfileId!, grain: "hour", bucketStartAt: 100, bucketEndAt: 200,
    rollupVersion: "community-telemetry-v1", activeInstanceCount: 1, peakConcurrency: 5, playerMinutes: 4, coverageRatio: 1, worldDistribution: [], computedAt: 200,
  }));
  const retained = await t.run(ctx => ctx.db.get(retainedId));
  const id = await t.mutation(makeFunctionReference<"mutation">("communityTelemetry:recomputeRollup"), {
    communityProfileId: first.communityProfileId, grain: "hour", bucketStartAt: 100, bucketEndAt: 200, now: 201,
  });
  assert.notEqual(id, retainedId);
  assert.equal((await t.run(ctx => ctx.db.get(id)))?.integrationId, firstId);
  assert.deepEqual(await t.run(ctx => ctx.db.get(retainedId)), retained);
});
it("collection identity rejects a mismatched managed scope at an existing write boundary", async () => {
  const t = convexTest({ schema, modules });
  const id = await seed(t, "boundary");
  await t.run(ctx => ctx.db.patch(id, { collectionScope: { kind: "automatic" } }));
  const before = await t.run(ctx => ctx.db.get(id));
  await assert.rejects(t.mutation(makeFunctionReference<"mutation">("communityTelemetry:setIntegrationKillSwitch"), {
    integrationId: id, enabled: false, now: 400,
  }), /collection scope/i);
  assert.deepEqual(await t.run(ctx => ctx.db.get(id)), before);
});

it("legacy migration and recomputation leave ambiguous or pre-epoch rollups unchanged", async () => {
  const t = convexTest({ schema, modules });
  const id = await seed(t, "ambiguous-current");
  const integration = await t.run(ctx => ctx.db.get(id));
  assert.ok(integration?.communityProfileId);
  await seed(t, "ambiguous-history", { communityProfileId: integration.communityProfileId, state: "disconnected", createdAt: 50 });
  const singleId = await seed(t, "pre-epoch");
  const single = await t.run(ctx => ctx.db.get(singleId));
  assert.ok(single?.communityProfileId);
  const legacy = { grain: "hour" as const, bucketStartAt: 100, bucketEndAt: 200, rollupVersion: "community-telemetry-v1", activeInstanceCount: 1, peakConcurrency: 5, playerMinutes: 4, coverageRatio: 1, worldDistribution: [], computedAt: 200 };
  const ambiguousId = await t.run(ctx => ctx.db.insert("communityTelemetryRollups", { ...legacy, communityProfileId: integration.communityProfileId! }));
  const oldId = await t.run(ctx => ctx.db.insert("communityTelemetryRollups", { ...legacy, communityProfileId: single.communityProfileId!, bucketStartAt: 0 }));
  const before = await t.run(async ctx => [await ctx.db.get(ambiguousId), await ctx.db.get(oldId)]);
  await allPages(t, backfillRollups);
  assert.deepEqual(await t.run(async ctx => [await ctx.db.get(ambiguousId), await ctx.db.get(oldId)]), before);
  const issues = await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect());
  assert.deepEqual(issues.map(issue => ({ rollupId: issue.rollupId, reason: issue.result })).sort((a, b) => a.reason.localeCompare(b.reason)), [
    { rollupId: ambiguousId, reason: "ambiguous_mapping" }, { rollupId: oldId, reason: "pre_epoch" },
  ]);
  await allPages(t, backfillRollups);
  assert.deepEqual(await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect()), issues);
  const resultId = await t.mutation(makeFunctionReference<"mutation">("communityTelemetry:recomputeRollup"), {
    communityProfileId: integration.communityProfileId, grain: "hour", bucketStartAt: 100, bucketEndAt: 200, now: 201,
  });
  assert.notEqual(resultId, ambiguousId);
  assert.deepEqual(await t.run(ctx => ctx.db.get(ambiguousId)), before[0]);
});

it("collection identity rejects conflicting live managed assignments instead of selecting one", async () => {
  const t = convexTest({ schema, modules });
  const id = await seed(t, "live-first");
  const first = await t.run(ctx => ctx.db.get(id));
  assert.ok(first?.communityProfileId);
  await seed(t, "live-conflict", { communityProfileId: first.communityProfileId });
  const { readManagedIntegration } = await import("../../convex/_groupObservationPolicy");
  await assert.rejects(t.run(ctx => readManagedIntegration(ctx.db, first.communityProfileId!)), /reconciliation/);
});

it("legacy migration records missing mappings once without changing retained rollups", async () => {
  const t = convexTest({ schema, modules });
  const id = await seed(t, "missing-mapping");
  const integration = await t.run(ctx => ctx.db.get(id));
  assert.ok(integration?.communityProfileId);
  const ids = await t.run(async ctx => {
    await ctx.db.delete(id);
    const values = { grain: "hour" as const, bucketStartAt: 100, bucketEndAt: 200, rollupVersion: "test",
      activeInstanceCount: 1, peakConcurrency: 5, playerMinutes: 4, coverageRatio: 1, worldDistribution: [], computedAt: 200 };
    return [await ctx.db.insert("communityTelemetryRollups", values),
      await ctx.db.insert("communityTelemetryRollups", { ...values, communityProfileId: integration.communityProfileId })];
  });
  const before = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
  await allPages(t, backfillRollups);
  const issues = await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect());
  assert.equal(issues.length, 2);
  assert.deepEqual(new Set(issues.map(issue => issue.rollupId)), new Set(ids));
  assert.ok(issues.every(issue => issue.result === "missing_mapping" && issue.action === "group_observation.rollup_reconciliation_required"));
  await allPages(t, backfillRollups);
  assert.deepEqual(await t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect()), issues);
  assert.deepEqual(await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id)))), before);
});

it("collection identity merges safe legacy and scoped read pages with stable cursors and epoch bounds", async () => {
  const t = convexTest({ schema, modules });
  const id = await seed(t, "read-pages");
  const integration = await t.run(ctx => ctx.db.get(id));
  assert.ok(integration?.communityProfileId);
  await t.run(async ctx => {
    for (const [bucketStartAt, scoped] of [[80, false], [100, false], [100, true], [110, false], [120, true]] as const) {
      await ctx.db.insert("communityTelemetryRollups", {
        communityProfileId: integration.communityProfileId, ...(scoped ? { integrationId: id } : {}),
        grain: "event", bucketStartAt, bucketEndAt: bucketStartAt + 10, rollupVersion: "test",
        activeInstanceCount: 1, peakConcurrency: bucketStartAt, playerMinutes: 4, coverageRatio: 1, worldDistribution: [], computedAt: 200,
      });
    }
  });
  const { readIntegrationRollups } = await import("../../convex/_groupObservationPolicy");
  const first = await t.run(ctx => readIntegrationRollups(ctx.db, integration, { grain: "event", startAt: 0, endAt: 120, limit: 2 }));
  assert.deepEqual(first.map(row => row.bucketStartAt), [110, 100]);
  const last = first[1]!;
  const second = await t.run(ctx => readIntegrationRollups(ctx.db, integration, {
    grain: "event", startAt: 0, endAt: 120, limit: 2, before: { at: last.bucketStartAt, createdAt: last._creationTime, id: last._id },
  }));
  assert.deepEqual(second.map(row => row.bucketStartAt), [100]);
  assert.equal(new Set([...first, ...second].map(row => row._id)).size, 3);
});

async function publicPolicyFixture() {
  const t = convexTest({ schema, modules });
  const integrationId = await seed(t, "policy-group", { lastSuccessfulObservationAt: 200 });
  const integration = await t.run(ctx => ctx.db.get(integrationId));
  assert.ok(integration?.communityProfileId);
  const ownerId = integration.communityProfileId;
  const duplicateId = await t.run(async ctx => {
    const profileId = await ctx.db.insert("profiles", {
      slug: "duplicate", displayName: "duplicate", sortName: "duplicate", aliases: [], tags: [],
      claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public",
      creationSource: "self", updatedAt: 100, profileType: "community", community: { categoryTags: [] },
    });
    for (const id of [ownerId, profileId]) await ctx.db.insert("profileExternalLinks", {
      profileId: id, assetType: "vrchat_group", assetExternalId: integration.vrchatGroupId,
      linkRole: "primary", state: "active", createdAt: 100, updatedAt: 100,
    });
    const categories = defaultClubVisibility();
    for (const category of Object.values(categories)) category.audience = "public";
    await ctx.db.insert("communityDataVisibility", { communityProfileId: profileId, categories, updatedAt: 100 });
    await ctx.db.insert("vrchatGroupMemberSnapshots", { vrchatGroupId: integration.vrchatGroupId, memberCount: 42, observedAt: 200 });
    return profileId;
  });
  return { t, integrationId, integration, ownerId, duplicateId };
}

it("duplicate privacy applies managed categories, analytics disablement and disconnect to public profiles", async () => {
  const s = await publicPolicyFixture();
  await s.t.run(ctx => ctx.db.insert("communityDataVisibility", {
    communityProfileId: s.ownerId, categories: defaultClubVisibility(), updatedAt: 100,
  }));
  const read = () => s.t.query(makeFunctionReference<"query">("profiles:getPublicBySlug"), { slug: "duplicate" });
  assert.equal((await read())?.groupMembership, undefined);
  assert.equal((await read())?.telemetry, undefined);
  await s.t.run(async ctx => {
    const visibility = await ctx.db.query("communityDataVisibility").withIndex("by_communityProfileId", q => q.eq("communityProfileId", s.ownerId)).unique();
    assert.ok(visibility);
    await ctx.db.patch(visibility._id, { categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } } });
    await ctx.db.patch(s.integrationId, { enabledFeatures: ["posts"] });
  });
  assert.equal((await read())?.telemetry, undefined);
  await s.t.run(ctx => ctx.db.patch(s.integrationId, { state: "disconnected" }));
  assert.equal((await read())?.groupMembership, undefined);
  assert.equal((await read())?.telemetry, undefined);
});

it("public policy group stop suppresses retained member snapshots and direct helper reads", async () => {
  const s = await publicPolicyFixture();
  await s.t.run(ctx => ctx.db.insert("vrchatGroupObservationPolicies", {
    vrchatGroupId: s.integration.vrchatGroupId, integrationId: s.integrationId,
    decision: { kind: "stopped", reason: "operator_opt_out", actor: "verified_operator", at: 201 }, createdAt: 100, updatedAt: 201,
  }));
  for (const id of [s.ownerId, s.duplicateId]) {
    assert.equal(await s.t.run(ctx => getPublicGroupMembership(ctx.db, id)), null);
    assert.equal(await s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, id, 202)), null);
  }
});

it("public policy migration blocks analytics admission while preserving explicitly public managed metadata", async () => {
  const s = await publicPolicyFixture();
  await s.t.run(async ctx => {
    await ctx.db.patch(s.integrationId, { enabledFeatures: ["posts"] });
    await ctx.db.insert("communityDataVisibility", { communityProfileId: s.ownerId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } }, updatedAt: 100 });
  });
  await allPages(s.t);
  const policy = await s.t.run(ctx => ctx.db.query("vrchatGroupObservationPolicies").unique());
  assert.equal(policy?.decision.kind, "admission_blocked");
  for (const id of [s.ownerId, s.duplicateId]) {
    assert.equal((await s.t.run(ctx => getPublicGroupMembership(ctx.db, id)))?.latest.value, 42);
    assert.equal(await s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, id, 201)), null);
  }
  assert.ok(policy);
  await s.t.run(ctx => ctx.db.patch(policy._id, {
    decision: { kind: "stopped", reason: "operator_opt_out", actor: "verified_operator", at: 202 },
  }));
  assert.equal(await s.t.run(ctx => getPublicGroupMembership(ctx.db, s.duplicateId)), null);
});

it("projection uses canonical automatic history and never exposes private fields, including after adoption", async () => {
  const s = await publicPolicyFixture();
  const forbidden = ["wrld_private-world", "private-location", "private-instance", "usr_private-user", "Private Person"];
  const sessionId = await s.t.run(async ctx => {
    await ctx.db.patch(s.integrationId, { communityProfileId: undefined, collectionScope: { kind: "automatic" } });
    await ctx.db.insert("vrchatGroupObservationPolicies", {
      vrchatGroupId: s.integration.vrchatGroupId, integrationId: s.integrationId,
      decision: { kind: "enabled", at: 100 }, publicHistoryStartAt: 100, createdAt: 100, updatedAt: 100,
    });
    await ctx.db.insert("communityPopulationObservations", {
      integrationId: s.integrationId, idempotencyKey: "private-population", totalPopulation: 20, activeInstanceCount: 2,
      worldDistribution: [{ vrchatWorldId: forbidden[0]!, population: 20, instanceCount: 2 }], observedAt: 200,
      source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 1,
    });
    await ctx.db.insert("communityTelemetryRollups", {
      integrationId: s.integrationId, communityProfileId: s.ownerId, grain: "hour", bucketStartAt: 100, bucketEndAt: 200,
      rollupVersion: "test", currentPopulation: 20, activeInstanceCount: 2, peakConcurrency: 30,
      playerMinutes: 90, coverageRatio: 0.5, worldDistribution: [{ vrchatWorldId: forbidden[0]!, samples: 1 }], computedAt: 200,
    });
    await ctx.db.insert("communityMembershipEvents", { integrationId: s.integrationId, epochStartedAt: 90,
      groupId: s.integration.vrchatGroupId, auditId: "private-event", eventType: "join", occurredAt: 200,
      targetUserId: forbidden[3], targetDisplayName: forbidden[4], receivedAt: 200, verified: true });
    return ctx.db.insert("instanceSessions", { integrationId: s.integrationId, communityProfileId: s.ownerId,
      providerInstanceId: forbidden[2]!, providerLocation: forbidden[1]!, vrchatWorldId: forbidden[0]!,
      source: "first_party", state: "open", openedAt: 100, lastObservedAt: 200, consecutiveMisses: 0, updatedAt: 200 });
  });
  const read = () => s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, s.duplicateId, 201));
  const automatic = await read();
  assert.ok(automatic);
  assert.equal(automatic.publicationPolicy, "automatic_aggregate");
  assert.equal(automatic.currentPopulation?.value, 20);
  assert.equal(automatic.groupMemberCount?.value, 42);
  assert.equal(automatic.populationHistory?.[0]?.playerHours, 1.5);
  assert.equal(automatic.populationHistory?.[0]?.coverageRatio, 0.5);
  for (const value of [...forbidden, sessionId]) assert.equal(JSON.stringify(automatic).includes(value), false);
  assert.equal("instanceHistory" in automatic, false);
  assert.equal("eventRecaps" in automatic, false);
  assert.equal("worldDistribution" in automatic.populationHistory![0]!, false);
  assert.deepEqual(await s.t.query(makeFunctionReference<"query">("communityTelemetry:getPublicForCommunity"), {
    communitySlug: "duplicate", now: 201,
  }), automatic);
  const profile = await s.t.query(makeFunctionReference<"query">("profiles:getPublicBySlug"), { slug: "duplicate" });
  assert.equal(profile?.telemetry?.publicationPolicy, "automatic_aggregate");
  for (const value of [...forbidden, sessionId]) assert.equal(JSON.stringify(profile?.telemetry).includes(value), false);
  assert.ok("publicationPolicy" in schema.tables.communityVrchatIntegrations.validator.fields);
  await s.t.run(ctx => ctx.db.patch(s.integrationId, { communityProfileId: s.ownerId,
    collectionScope: { kind: "managed", communityProfileId: s.ownerId }, publicationPolicy: "automatic_aggregate" }));
  assert.deepEqual(await read(), automatic);
  const stale = await s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, s.duplicateId, 200 + 6 * 60_000 + 1));
  assert.equal(stale?.currentPopulation, undefined);
});

it("public policy requires registry eligibility and active primary links and suppresses private profiles", async () => {
  const s = await publicPolicyFixture();
  await s.t.run(ctx => ctx.db.patch(s.integrationId, { communityProfileId: undefined, collectionScope: { kind: "automatic" } }));
  const read = () => s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, s.duplicateId, 201));
  assert.equal(await read(), null);
  await s.t.run(ctx => ctx.db.insert("vrchatGroupObservationPolicies", {
    vrchatGroupId: s.integration.vrchatGroupId, integrationId: s.integrationId, decision: { kind: "enabled", at: 100 }, createdAt: 100, updatedAt: 100,
  }));
  assert.ok(await read());
  for (const patch of [{ groupVisibility: "private" }, { joinPolicy: "request" }, { state: "disconnected" }, { killSwitchEnabled: true }] satisfies Partial<Doc<"communityVrchatIntegrations">>[]) {
    await s.t.run(ctx => ctx.db.patch(s.integrationId, patch));
    assert.equal(await read(), null);
    await s.t.run(ctx => ctx.db.patch(s.integrationId, { groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false }));
  }
  await s.t.run(ctx => ctx.db.patch(s.duplicateId, { publicSurfacingState: "suppressed" }));
  assert.equal(await read(), null);
  assert.equal(await s.t.run(ctx => getPublicGroupMembership(ctx.db, s.duplicateId)), null);
  await s.t.run(async ctx => {
    await ctx.db.patch(s.duplicateId, { publicSurfacingState: "public" });
    const link = await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q
      .eq("profileId", s.duplicateId).eq("assetType", "vrchat_group").eq("state", "active")).first();
    assert.ok(link);
    await ctx.db.patch(link._id, { assetExternalId: "replacement-group" });
  });
  assert.equal(await read(), null);
  assert.equal(await s.t.run(ctx => getPublicGroupMembership(ctx.db, s.duplicateId)), null);
});

it("public policy public-history boundary restricts managed member metadata and telemetry", async () => {
  const s = await publicPolicyFixture();
  await s.t.run(async ctx => {
    await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: s.integration.vrchatGroupId,
      integrationId: s.integrationId, decision: { kind: "enabled", at: 201 }, publicHistoryStartAt: 201, createdAt: 100, updatedAt: 201 });
    await ctx.db.insert("communityMemberCountObservations", { integrationId: s.integrationId, communityProfileId: s.ownerId,
      idempotencyKey: "pre-public-history", vrchatGroupId: s.integration.vrchatGroupId, memberCount: 42, observedAt: 200,
      source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 1 });
  });
  assert.equal(await s.t.run(ctx => getPublicGroupMembership(ctx.db, s.ownerId)), null);
  assert.equal((await s.t.run(ctx => getPublicCommunityTelemetry(ctx.db, s.ownerId, 202)))?.groupMemberCount, undefined);
});
