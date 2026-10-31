import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import httpModule from "../../convex/http";
import { VrchatClient } from "../../workers/group-telemetry/vrchat-client.mjs";
const schema = (schemaModule as unknown as {default?: typeof schemaModule}).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/groupObservations.ts": () => import("../../convex/groupObservations"),
  "../../convex/clubMembership.ts": () => import("../../convex/clubMembership"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/clubProviderReads.ts": () => import("../../convex/clubProviderReads"),
  "../../convex/clubConnection.ts": () => import("../../convex/clubConnection"),
};
const ref = (name: string) => makeFunctionReference<"mutation">(name);
const key = "automatic-worker-test-key-long-enough";
const workerKeyHash = createHash("sha256").update(key).digest("hex");
const capability = "automatic_group_aggregates_v2";
async function drainMonitoring(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    await t.finishAllScheduledFunctions(() => {});
    const jobs = await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(100));
    assert.deepEqual(jobs.filter(job => job.state.kind === "failed").map(job => job.state), []);
    if (!jobs.some(job => job.state.kind === "pending" || job.state.kind === "inProgress")) return;
  }
  assert.fail("monitoring did not finish");
}
async function setup() {
  const t = convexTest({schema, modules}); const now = Date.now();
  const ids = await t.run(async ctx => {
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {vrchatUserId: "usr_bot", accountAlias: "bot", state: "ready", capacity: 20, reservedHeadroom: 0, assignedGroupCount: 1, requestsPerMinute: 30, secretRef: "test", workerKeyHash, credentialGeneration: 1, killSwitchEnabled: false, createdAt: now, updatedAt: now});
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {collectionScope: {kind: "automatic"}, publicationPolicy: "automatic_aggregate", vrchatGroupId: "grp_test", groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1, publicMetrics: {currentPopulation: true, populationHistory: false, groupMemberCount: true, groupMemberGrowth: false, eventRecaps: false}, telemetryEpochStartedAt: now, consecutiveFailures: 0, assignedCollectorAccountId: collectorAccountId, createdAt: now, updatedAt: now});
    const policyId = await ctx.db.insert("vrchatGroupObservationPolicies", {vrchatGroupId: "grp_test", integrationId, decision: {kind: "enabled", at: now}, createdAt: now, updatedAt: now});
    await ctx.db.insert("collectorAccountLeases", {integrationId, collectorAccountId, workerId: "worker", fencingToken: 1, state: "active", claimedAt: now, expiresAt: now + 300000, updatedAt: now});
    return {collectorAccountId, integrationId, policyId};
  });
  const lease = {integrationId: ids.integrationId, collectorAccountId: ids.collectorAccountId, workerId: "worker", fencingToken: 1};
  const worker = {...lease, workerKeyHash, epochStartedAt: now};
  const heartbeat = (workerId = "worker", at = now) => t.mutation(ref("communityTelemetry:recordCollectorHeartbeat"), {collectorAccountId: ids.collectorAccountId, workerId, workerKeyHash, releaseSha: "a".repeat(40), collectorVersion: "test", capabilities: [capability], consecutiveControlFailures: 0, now: at});
  return {t, now, ...ids, lease, worker, heartbeat};
}
it("automatic assignments require request capability and exact fresh worker heartbeat", async () => {
  const h = await setup();
  const claim = (workerId: string, capabilities?: string[]) => h.t.mutation(ref("communityTelemetry:claimDueAssignments"), {collectorAccountId: h.collectorAccountId, workerId, capabilities, now: h.now});
  await h.heartbeat("new-worker");
  assert.equal((await claim("worker")).assignments.length, 0);
  assert.equal((await claim("worker", [capability])).assignments.length, 0);
  await h.t.mutation(ref("communityTelemetry:recordCollectorHeartbeat"), { collectorAccountId: h.collectorAccountId, workerId: "worker", workerKeyHash, releaseSha: "b".repeat(40), collectorVersion: "legacy", capabilities: ["telemetry_v1"], consecutiveControlFailures: 0, now: h.now });
  assert.equal((await claim("worker", [capability])).assignments.length, 0);
  await h.heartbeat("worker", h.now - 120001);
  assert.equal((await claim("worker", [capability])).assignments.length, 0);
  await h.heartbeat();
  const result = (await claim("worker", [capability])).assignments[0];
  assert.equal(result.collectionMode, "automatic");
  assert.equal(result.enabledFeatures, undefined);
  assert.equal(result.communityProfileId, undefined);
});
async function backlogFixture() {
  const h = await setup();
  const ids = await h.t.run(async ctx => {
    const fleetId = await ctx.db.insert("collectorFleetSettings", { key: "global", killSwitchEnabled: false, globalRequestsPerMinute: 30, automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 2, automaticEnrollmentScope: { kind: "pilot", vrchatGroupId: "grp_pending" }, updatedAt: h.now });
    const profileId = await ctx.db.insert("profiles", { slug: "pending", displayName: "Pending", sortName: "pending", aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: h.now, profileType: "community", community: { categoryTags: [] } });
    await ctx.db.insert("profileExternalLinks", { profileId, assetType: "vrchat_group", assetExternalId: "grp_pending", linkRole: "primary", state: "active", createdAt: h.now, updatedAt: h.now });
    for (let i = 0; i < 51; i++) await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: `outside-${i}`, decision: { kind: "enabled", at: h.now }, queuedAdmission: { priority: "automatic", queuedAt: 0, dueAt: 0 }, createdAt: 0, updatedAt: 0 });
    const policyId = await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: "grp_pending", eligibleProfileId: profileId, decision: { kind: "enabled", at: h.now }, queuedAdmission: { priority: "automatic", queuedAt: h.now - 900001, dueAt: h.now + 60000, reason: "capacity" }, createdAt: h.now, updatedAt: h.now });
    return { fleetId, policyId, profileId };
  });
  return { h, ids };
}
it("heartbeat reports only sustained actionable automatic backlog in the authorized scope", async () => {
  const { h, ids } = await backlogFixture();
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, true);
  for (const patch of [{ automaticEnrollmentEnabled: false }, { automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 0 }, { automaticEnrollmentLimit: 2, automaticEnrollmentScope: undefined }]) {
    await h.t.run(ctx => ctx.db.patch(ids.fleetId, patch));
    assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, false);
  }
  await h.t.run(ctx => ctx.db.patch(ids.fleetId, { automaticEnrollmentScope: { kind: "pilot", vrchatGroupId: "grp_pending" } }));
  const original = await h.t.run(ctx => ctx.db.get(ids.policyId)); assert.ok(original);
  for (const patch of [
    { decision: { kind: "stopped" as const, reason: "opt_out", actor: "verified_operator" as const, at: h.now } },
    { admissionRequired: true },
    { eligibleProfileId: undefined },
    { queuedAdmission: { priority: "automatic" as const, queuedAt: h.now, dueAt: h.now } },
  ]) {
    await h.t.run(ctx => ctx.db.patch(ids.policyId, { decision: original.decision, admissionRequired: undefined, eligibleProfileId: original.eligibleProfileId, queuedAdmission: original.queuedAdmission, ...patch }));
    assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, false);
  }
});
it("heartbeat detects an actionable all-eligible candidate beyond fifty unrelated queue entries", async () => {
  const { h, ids } = await backlogFixture();
  await h.t.run(ctx => ctx.db.patch(ids.fleetId, { automaticEnrollmentScope: { kind: "all_eligible" } }));
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, true);
  await h.t.mutation(ref("groupObservations:refreshAdmissionMonitoring"), {});
  await drainMonitoring(h.t);
  const fleet = await h.t.run(ctx => ctx.db.get(ids.fleetId));
  assert.equal(fleet?.admissionMonitoring?.automaticBacklog, true, "completed scan reaches the candidate beyond the first page");
  assert.equal((await h.heartbeat("worker", Date.now())).automaticEnrollmentBacklog, true);
  await h.t.run(ctx => ctx.db.patch(ids.policyId, { admissionRequired: true }));
  await h.t.mutation(ref("groupObservations:refreshAdmissionMonitoring"), {});
  await drainMonitoring(h.t);
  assert.equal((await h.heartbeat("worker", Date.now())).automaticEnrollmentBacklog, false, "a complete scan can establish absence");
  assert.equal((await h.heartbeat("worker", Date.now() + 360_001)).automaticEnrollmentBacklog, true, "expired monitoring cannot report healthy");
});

it("paged monitoring includes explicit processing failures beyond fifty automatic assignments", async () => {
  const { h, ids } = await backlogFixture();
  await h.t.run(async ctx => {
    await ctx.db.patch(ids.fleetId, { automaticEnrollmentEnabled: false });
    const { _id, _creationTime, ...base } = (await ctx.db.get(h.integrationId))!;
    for (let i = 0; i < 51; i++) await ctx.db.insert("communityVrchatIntegrations", { ...base, vrchatGroupId: `many-${i}` });
    await ctx.db.insert("communityVrchatIntegrations", { ...base, vrchatGroupId: "late-grant", statisticsAdmission: {
      authorizedAt: h.now - 960_000, actor: { issuer: "test", subject: "admin", tokenIdentifier: "test:admin" }, reason: "test",
      collectorAccountId: h.collectorAccountId, joinPolicy: "request", epochStartedAt: h.now,
      phase: "pending", membershipOrigin: "unknown",
    } });
  });
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, true);
  await h.t.mutation(ref("groupObservations:refreshAdmissionMonitoring"), {});
  await drainMonitoring(h.t);
  const heartbeat = await h.heartbeat("worker", Date.now());
  assert.equal(heartbeat.statisticsAdmissionDiagnostics.pending, 1);
  assert.equal(heartbeat.statisticsAdmissionDiagnostics.processingBacklog, 1);
  assert.equal(heartbeat.automaticEnrollmentBacklog, true);
});
it("heartbeat observes expired contributor quota after grace without consuming quota or advancing admission", async () => {
  const { h, ids } = await backlogFixture();
  const quotaId = await h.t.run(async ctx => {
    const contributorId = await ctx.db.insert("users", { clerkUserId: "quota-contributor" });
    await ctx.db.patch(ids.policyId, { candidateContributorId: contributorId, queuedAdmission: { priority: "automatic", queuedAt: h.now - 900001, dueAt: h.now + 60000, reason: "contributor_limit" } });
    return ctx.db.insert("groupObservationCandidateLimits", { key: `user:${contributorId}`, admittedAt: Array.from({ length: 5 }, () => h.now - 86400000 + 60000) });
  });
  const before = await h.t.run(async ctx => [await ctx.db.get(quotaId), await ctx.db.get(ids.policyId)]);
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, false);
  assert.equal((await h.heartbeat("worker", h.now + 60001)).automaticEnrollmentBacklog, false);
  assert.equal((await h.heartbeat("worker", h.now + 60000 + 900001)).automaticEnrollmentBacklog, true);
  assert.equal((await h.heartbeat("worker", h.now + 60000 + 960001)).automaticEnrollmentBacklog, true);
  assert.deepEqual(await h.t.run(async ctx => [await ctx.db.get(quotaId), await ctx.db.get(ids.policyId)]), before);
});
for (const release of ["occupancy", "authorized limit"] as const) it(`heartbeat observes a cleared automatic limit after ${release} changes without advancing admission`, async () => {
  const { h, ids } = await backlogFixture();
  await h.t.run(async ctx => {
    await ctx.db.patch(ids.fleetId, { automaticEnrollmentLimit: 1 });
    await ctx.db.patch(ids.policyId, { queuedAdmission: { priority: "automatic", queuedAt: h.now - 900001, dueAt: h.now + 60000, reason: "automatic_limit" } });
  });
  const policy = await h.t.run(ctx => ctx.db.get(ids.policyId));
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, false);
  await h.t.run(async ctx => {
    if (release === "occupancy") await ctx.db.patch(h.integrationId, { assignedCollectorAccountId: undefined });
    else await ctx.db.patch(ids.fleetId, { automaticEnrollmentLimit: 2 });
  });
  assert.equal((await h.heartbeat()).automaticEnrollmentBacklog, true);
  assert.deepEqual(await h.t.run(ctx => ctx.db.get(ids.policyId)), policy);
  assert.equal(await h.t.run(ctx => ctx.db.query("groupObservationCandidateLimits").first()), null);
});
it("automatic named scans and management mutations deny valid worker leases", async () => {
  const h = await setup();
  await assert.rejects(h.t.mutation(ref("clubMembership:beginScan"), {...h.worker, groupId: "grp_test", startAt: h.now, endAt: h.now + 1}), /Automatic operation denied/);
  await assert.rejects(h.t.mutation(ref("clubProviderReads:claim"), h.worker), /Automatic operation denied/);
  await assert.rejects(h.t.mutation(ref("clubOperations:claim"), h.worker), /Automatic operation denied/);
  await assert.rejects(h.t.mutation(ref("clubConnection:recordAuthority"), {...h.worker, authority: {
    groupId: "grp_test", userId: "usr_bot", membershipStatus: "member", permissions: [], observedAt: h.now,
  }}), /Automatic operation denied/);
});
it("admission rollback blocks allocated joins but keeps existing collection and cleanup available", async () => {
  const h = await setup();
  await h.heartbeat();
  const fleetId = await h.t.run(ctx => ctx.db.insert("collectorFleetSettings", { key: "global", killSwitchEnabled: false, globalRequestsPerMinute: 30, automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 1, automaticEnrollmentScope: { kind: "pilot", vrchatGroupId: "grp_test" }, updatedAt: h.now }));
  await h.t.run(ctx => ctx.db.patch(h.integrationId, { state: "connecting" }));
  const reserve = (automaticRequest = "metadata") => h.t.mutation(ref("communityTelemetry:reserveRequestBudget"), { ...h.lease, requestCount: 1, automaticRequest, now: h.now });
  assert.equal((await reserve()).granted, true);
  for (const patch of [
    { automaticEnrollmentEnabled: false },
    { automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 0 },
    { automaticEnrollmentLimit: 1, automaticEnrollmentScope: undefined },
    { automaticEnrollmentScope: { kind: "pilot" as const, vrchatGroupId: "another-group" } },
  ]) {
    await h.t.run(ctx => ctx.db.patch(fleetId, patch));
    assert.equal((await reserve()).granted, false);
    assert.equal((await h.t.mutation(ref("communityTelemetry:claimDueAssignments"), { collectorAccountId: h.collectorAccountId, workerId: "worker", capabilities: [capability], now: h.now })).assignments.length, 0);
  }
  await h.t.run(ctx => ctx.db.patch(h.integrationId, { state: "active" }));
  assert.equal((await reserve()).granted, true);
  await h.t.run(async ctx => {
    await ctx.db.patch(h.integrationId, { state: "disconnecting" });
    await ctx.db.patch(h.policyId, { decision: { kind: "stopped", reason: "operator_opt_out", actor: "verified_operator", at: h.now } });
    await ctx.db.insert("vrchatGroupMemberSnapshots", { vrchatGroupId: "grp_test", observedAt: h.now, memberCount: 42 });
  });
  assert.equal((await reserve()).granted, false);
  assert.equal((await reserve("leave")).granted, true);
  const policy = await h.t.run(ctx => ctx.db.get(h.policyId));
  await h.t.mutation(ref("communityTelemetry:recordMembershipResult"), { ...h.lease, state: "disconnected", groupVisibility: "public", joinPolicy: "free", now: h.now });
  assert.deepEqual(await h.t.run(ctx => ctx.db.get(h.policyId)), policy);
  assert.equal((await h.t.run(ctx => ctx.db.query("vrchatGroupMemberSnapshots").first()))?.memberCount, 42);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.state, "disconnected");
});
for (const operation of ["membership_scan_begin", "membership_scan_page", "membership_scan_resume", "membership_scan_finalize", "club_authority", "club_read_claim", "club_read_complete", "club_operation_claim", "club_operation_authorize", "club_operation_complete", "club_operation_reject", "club_operation_defer"])
it(`real HTTP handler denies automatic ${operation} with a valid worker key`, async () => {
  const h = await setup();
  const router = (httpModule as unknown as {default?: typeof httpModule}).default ?? httpModule;
  const [handler] = router.lookup("/telemetry/worker", "POST")!;
  const action = handler as unknown as {_handler: (ctx: unknown, request: Request) => Promise<Response>};
  const response = await action._handler({runQuery: h.t.query, runMutation: h.t.mutation}, new Request("https://test/telemetry/worker", {method: "POST", headers: {authorization: `Bearer ${key}`, "x-vrdex-collector-account": h.collectorAccountId}, body: JSON.stringify({...h.worker, vrchatUserId: "usr_bot", operation, groupId: "grp_test", startAt: h.now, endAt: h.now + 1})}));
  assert.equal(response.status, 403);
});
it("membership loss persists group stop and fences a late aggregate poll", async () => {
  const h = await setup();
  await h.t.mutation(ref("communityTelemetry:recordPollFailure"), {...h.lease, statusClass: "403", coverageState: "degraded", nextPollAt: h.now + 60000, detail: "membership", collectorVersion: "test", now: h.now});
  const policy = await h.t.run(ctx => ctx.db.get(h.policyId));
  assert.equal(policy?.decision.kind, "stopped");
  await assert.rejects(h.t.mutation(ref("communityTelemetry:ingestAggregatePoll"), {...h.lease, pollId: "late", observedAt: h.now, collectorVersion: "test", source: "first_party", groupMemberCount: 1, instances: [], nextPollAt: h.now + 60000, now: h.now}), /stale|unavailable/);
});
it("admission-required producer authenticates key, exact epoch and lease before releasing allocation", async () => {
  const h = await setup();
  await h.t.run(ctx => ctx.db.patch(h.integrationId, {state: "connecting"}));
  const args = {...h.worker, reason: "request", now: h.now};
  await assert.rejects(h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), {...args, workerKeyHash: "wrong"}), /Unauthorized/);
  await assert.rejects(h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), {...args, epochStartedAt: 0}), /stale|unavailable/);
  await assert.rejects(h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), {...args, workerId: "other-worker"}), /stale|unavailable/);
  await assert.rejects(h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), {...args, fencingToken: 0}), /stale|unavailable/);
  assert.equal(await h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), args), true);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.policyId)))?.admissionRequired, true);
  await assert.rejects(h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), args), /stale|unavailable/);
});
it("confirmed automatic membership cannot become a new admission-required allocation", async () => {
  const h = await setup();
  await h.t.run(ctx => ctx.db.patch(h.integrationId, {lastSuccessfulObservationAt: h.now}));
  assert.equal(await h.t.mutation(ref("communityTelemetry:recordAutomaticAdmissionRequired"), {...h.worker, reason: "invite", now: h.now}), false);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.assignedCollectorAccountId, h.collectorAccountId);
});
it("automatic account recovery verifies membership without reopening admission or rotating bots", async () => {
  const h = await setup();
  await h.t.run(ctx => ctx.db.patch(h.integrationId, {lastSuccessfulObservationAt: h.now}));
  await h.t.mutation(ref("communityTelemetry:setCollectorAccountState"), {collectorAccountId: h.collectorAccountId, state: "quarantined", now: h.now});
  const targetCollectorAccountId = await h.t.run(async ctx => {
    const {_id, _creationTime, ...account} = (await ctx.db.get(h.collectorAccountId))!;
    return ctx.db.insert("collectorAccounts", {...account, vrchatUserId: "usr_other", state: "ready", assignedGroupCount: 0});
  });
  await assert.rejects(h.t.mutation(ref("communityTelemetry:reassignIntegration"), {integrationId: h.integrationId, targetCollectorAccountId, reason: "recovery", now: h.now}), /Automatic operation denied/);
  await h.t.mutation(ref("communityTelemetry:setCollectorAccountState"), {collectorAccountId: h.collectorAccountId, state: "ready", now: h.now});
  const integration = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(integration?.state, "degraded");
  assert.equal(integration?.assignedCollectorAccountId, h.collectorAccountId);
});

for (const lostReply of [false, true]) for (const removed of [false, true]) it(`durable pre-join reservation recovers a real provider attempt on the same account (lostReply=${lostReply}, removed=${removed})`, async () => {
  const h = await setup();
  await h.t.run(async ctx => {
    await ctx.db.patch(h.integrationId, { state: "connecting" });
    await ctx.db.insert("collectorFleetSettings", { key: "global", killSwitchEnabled: false, globalRequestsPerMinute: 30, automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 1, automaticEnrollmentScope: { kind: "pilot", vrchatGroupId: "grp_test" }, updatedAt: h.now });
  });
  const reserve = (automaticRequest: string) => h.t.mutation(ref("communityTelemetry:reserveRequestBudget"), { ...h.lease, automaticRequest, requestCount: 1, now: h.now });
  let member = false, joins = 0;
  const provider = new VrchatClient({ userId: "usr_bot", authCookie: "test-cookie", userAgent: "test/1", clock: () => h.now });
  provider.getGroup = async () => ({ membershipStatus: member ? "member" : "none", joinPolicy: "free", groupVisibility: "public", memberCount: 42 });
  provider.joinGroup = async () => { joins++; member = true; if (lostReply) throw new Error("join reply lost"); };
  provider.request = async () => ({ fetchedAt: new Date(h.now).toISOString(), instances: [] });
  const connect = () => provider.connectGroup("grp_test", { admissionMode: "automatic", authorizeRequest: async (operation: string) => (await reserve(operation)).granted });
  if (lostReply) await assert.rejects(connect(), /reply lost/);
  else assert.equal((await connect())?.state, "active");
  assert.equal((await reserve("join")).granted, false, "a lost join reply cannot authorize a second join");
  const counters = await h.t.run(ctx => ctx.db.query("collectorRequestBudgetCounters").collect());
  assert.deepEqual(counters.map(row => row.requestCount), lostReply ? [2, 2, 2] : [3, 3, 3], "each request is charged once");
  // Crash after the provider accepted join, before membership confirmation commits.
  await h.t.mutation(ref("communityTelemetry:releaseLease"), h.lease);
  await h.heartbeat();
  const claim = await h.t.mutation(ref("communityTelemetry:claimDueAssignments"), { collectorAccountId: h.collectorAccountId, workerId: "worker", capabilities: [capability], now: h.now });
  assert.equal(claim.assignments[0]?.state, "degraded");
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.assignedCollectorAccountId, h.collectorAccountId);
  member = !removed;
  const recoveredLease = { ...h.lease, fencingToken: claim.assignments[0].fencingToken };
  const read = () => provider.readAggregateSnapshot("grp_test", { admissionMode: "automatic", authorizeRequest: async (automaticRequest: string) => (await h.t.mutation(ref("communityTelemetry:reserveRequestBudget"), { ...recoveredLease, automaticRequest, requestCount: 1, now: h.now })).granted });
  if (removed) {
    await assert.rejects(read(), /membership/);
    await h.t.mutation(ref("communityTelemetry:recordPollFailure"), { ...recoveredLease, statusClass: "403", coverageState: "degraded", nextPollAt: h.now + 60000, detail: "membership", collectorVersion: "test", now: h.now });
    assert.equal((await h.t.run(ctx => ctx.db.get(h.policyId)))?.decision.kind, "stopped");
  } else assert.ok(await read());
  assert.equal(joins, 1);
});

it("v2 dispatch requires matching fresh request and heartbeat while legacy managed remains compatible", async () => {
  for (const kind of ["automatic", "adopted", "legacy"]) for (const [request, heartbeat, age, allowed] of [
    [capability, capability, 0, true], ["automatic_group_aggregates_v1", capability, 0, false],
    [capability, "automatic_group_aggregates_v1", 0, false], [capability, capability, 120001, false],
  ] as const) {
    const h = await setup();
    if (kind !== "automatic") await h.t.run(async ctx => {
      const communityProfileId = await ctx.db.insert("profiles", { slug: "capability", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: h.now, profileType: "community", community: { categoryTags: [] } });
      await ctx.db.patch(h.integrationId, { communityProfileId, collectionScope: { kind: "managed", communityProfileId }, namedMembershipCollectionEnabled: kind === "adopted" ? false : undefined });
    });
    await h.t.mutation(ref("communityTelemetry:recordCollectorHeartbeat"), { collectorAccountId: h.collectorAccountId, workerId: "worker", workerKeyHash, releaseSha: "a".repeat(40), collectorVersion: "test", capabilities: [heartbeat], consecutiveControlFailures: 0, now: h.now - age });
    assert.equal((await h.t.mutation(ref("communityTelemetry:claimDueAssignments"), { collectorAccountId: h.collectorAccountId, workerId: "worker", capabilities: [request], now: h.now })).assignments.length, kind === "legacy" || allowed ? 1 : 0, `${kind}/${request}/${heartbeat}/${age}`);
  }
});

for (const transition of ["stop before join", "rollback before join", "stop before instances"]) it(`real request authorization prevents ${transition}`, async () => {
  const h = await setup();
  const connecting = transition !== "stop before instances";
  const fleetId = await h.t.run(async ctx => {
    await ctx.db.patch(h.integrationId, { state: connecting ? "connecting" : "active" });
    return ctx.db.insert("collectorFleetSettings", { key: "global", killSwitchEnabled: false, globalRequestsPerMinute: 30, automaticEnrollmentEnabled: true, automaticEnrollmentLimit: 1, automaticEnrollmentScope: { kind: "pilot", vrchatGroupId: "grp_test" }, updatedAt: h.now });
  });
  const sent: string[] = [];
  const provider = new VrchatClient({ userId: "usr_bot", authCookie: "test-cookie", userAgent: "test/1", clock: () => h.now });
  provider.getGroup = async () => {
    sent.push("metadata");
    if (transition === "rollback before join") await h.t.run(ctx => ctx.db.patch(fleetId, { automaticEnrollmentEnabled: false }));
    else await h.t.mutation(ref("communityTelemetry:recordPollFailure"), { ...h.lease, statusClass: "403", coverageState: "degraded", nextPollAt: h.now + 60000, detail: "membership", collectorVersion: "test", now: h.now });
    return { membershipStatus: connecting ? "none" : "member", joinPolicy: "free", groupVisibility: "public", memberCount: 42 };
  };
  provider.joinGroup = async () => { sent.push("join"); };
  provider.request = async () => { sent.push("instances"); return []; };
  const options = { admissionMode: "automatic", authorizeRequest: async (automaticRequest: string) => (await h.t.mutation(ref("communityTelemetry:reserveRequestBudget"), { ...h.lease, automaticRequest, requestCount: 1, now: h.now })).granted };
  const collect = () => connecting ? provider.connectGroup("grp_test", options) : provider.readAggregateSnapshot("grp_test", options);
  if (transition === "rollback before join") assert.equal(await collect(), null);
  else await assert.rejects(collect(), /stale|unavailable/);
  assert.deepEqual(sent, ["metadata"]);
});
