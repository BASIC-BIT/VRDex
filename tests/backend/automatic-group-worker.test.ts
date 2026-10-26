import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import httpModule from "../../convex/http";
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
const capability = "automatic_group_aggregates_v1";
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
  await h.heartbeat("worker", h.now - 120001);
  assert.equal((await claim("worker", [capability])).assignments.length, 0);
  await h.heartbeat();
  const result = (await claim("worker", [capability])).assignments[0];
  assert.equal(result.collectionMode, "automatic");
  assert.equal(result.enabledFeatures, undefined);
  assert.equal(result.communityProfileId, undefined);
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
