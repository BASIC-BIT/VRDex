import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGroupMemberSnapshot } from "./group-member-jobs.mjs";

test("an unconnected linked group uses one reserved metadata read", async () => {
  const calls = [];
  const groupId = "grp_00000000-0000-4000-8000-000000000001";
  const control = { send: async (operation, value) => {
    calls.push({ operation, value });
    if (operation === "group_member_claim") return { linkId: "link", leaseToken: "token", vrchatGroupId: groupId };
    if (operation === "proof_budget") return { granted: true };
    if (operation === "group_member_complete") return true;
    throw new Error(operation);
  } };
  const budget = { retryAfterMs: () => 0, tryConsume: () => true };
  const result = await checkGroupMemberSnapshot({
    control, provider: { getGroup: async id => ({ groupId: id, memberCount: 42, groupCreatedAt: 123 }) },
    accountBudget: budget, metadataBudget: budget, heartbeat: async () => {}, isStopping: () => false,
    reportDeadSession: async () => {}, pauseWithHeartbeats: async () => {}, logEvent: () => {}, clock: () => 1_000,
  });
  assert.equal(result, 1);
  assert.deepEqual(calls.map(call => call.operation), ["group_member_claim", "proof_budget", "group_member_complete"]);
  assert.deepEqual(calls[2].value, { linkId: "link", leaseToken: "token", memberCount: 42, groupCreatedAt: 123, observedAt: 1_000 });
});

test("provider failure completes without a count", async () => {
  const calls = [];
  const control = { send: async (operation, value) => {
    calls.push({ operation, value });
    if (operation === "group_member_claim") return { linkId: "link", leaseToken: "token", vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001" };
    if (operation === "proof_budget") return { granted: true };
    if (operation === "group_member_complete") return true;
    throw new Error(operation);
  } };
  const budget = { retryAfterMs: () => 0, tryConsume: () => true };
  await checkGroupMemberSnapshot({
    control, provider: { getGroup: async () => { throw Object.assign(new Error("offline"), { category: "provider_error" }); } },
    accountBudget: budget, metadataBudget: budget, heartbeat: async () => {}, isStopping: () => false,
    reportDeadSession: async () => {}, pauseWithHeartbeats: async () => {}, logEvent: () => {}, clock: () => 1_000,
  });
  assert.equal(calls.at(-1).operation, "group_member_complete");
  assert.equal("memberCount" in calls.at(-1).value, false);
});

test("a control failure releases an unread claim and remains a loop failure", async () => {
  const calls = [];
  const control = { send: async operation => {
    calls.push(operation);
    if (operation === "group_member_claim") return { linkId: "link", leaseToken: "token", vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001" };
    if (operation === "group_member_release") return true;
    throw new Error(operation);
  } };
  const budget = { retryAfterMs: () => 0, tryConsume: () => true };
  await assert.rejects(checkGroupMemberSnapshot({
    control, provider: { getGroup: async () => { throw new Error("must not read"); } },
    accountBudget: budget, metadataBudget: budget, heartbeat: async () => { throw new Error("heartbeat failed"); },
    isStopping: () => false, reportDeadSession: async () => {}, pauseWithHeartbeats: async () => {},
    logEvent: () => {}, clock: () => 1_000,
  }), /heartbeat failed/);
  assert.deepEqual(calls, ["group_member_claim", "group_member_release"]);
});
