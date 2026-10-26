import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { RequestBudget, failureDisposition } from "./runtime.mjs";
import { executeClubOperation } from "./club-operation-jobs.mjs";
import { VrchatClient, VrchatProviderError } from "./vrchat-client.mjs";
const source = readFileSync(
  new URL("./worker.mjs", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const collectSource = source.slice(
  source.indexOf("async function collect(assignment)"),
  source.indexOf(
    "/**\n * Hands back",
    source.indexOf("async function collect(assignment)"),
  ),
);
function harness({
  state = "active",
  collectionMode = "automatic",
  features = ["analytics", "posts"],
  error,
  ingestError,
  membershipState = "active",
  requestsPerMinute = 100,
} = {}) {
  const calls = [];
  const failures = [];
  let now = 1000000;
  let connection = state;
  const sandbox = {
    Date: { now: () => now },
    RequestBudget,
    failureDisposition,
    integrationBudgets: new Map(),
    attempts: new Map(),
    stopping: false,
    accountBudget: new RequestBudget(100),
    secret: { vrchatUserId: "bot" },
    COLLECTOR_PROTOCOL_VERSION: "test",
    randomPollDelayMs: () => 60000,
    pollId: () => "poll",
    boundedProviderCategory: (x) => x,
    collectorAuthRequiredEvent: () => ({}),
    logEvent: () => {},
    reportDeadSession: async () => {
      sandbox.stopping = true;
    },
    pauseWithHeartbeats: async () => {},
    budgetedClubProvider: () => ({}),
    control: {
      send: async (op, args) => {
        calls.push(op);
        if (op === "membership") connection = args.state;
        if (op === "ingest" && ingestError)
          throw new Error("Control plane 400: malformed snapshot");
        if (op === "failure") {
          failures.push(args);
          if (!args.telemetryOnly) connection = "degraded";
        }
        return { granted: true };
      },
    },
    provider: {
      connectGroup: async () => {
        calls.push("connect");
        return { state: membershipState };
      },
      leaveGroup: async () => {
        calls.push("leave");
      },
      readAggregateSnapshot: async () => {
        calls.push("aggregate");
        if (error) throw error;
        return { observedAt: now, group: { memberCount: 1 }, instances: [] };
      },
    },
    checkClubOperations: async (assignment, budget, deadline) => {
      calls.push("operation");
      assert.fail("Automatic assignment reached management");
      assert.equal(assignment.state, "active");
      assert.ok(deadline > now);
      assert.ok(now < 1000000 + 15 * 60000, "work is reached before cutoff");
    },
    checkClubReads: async (assignment) => {
      assert.equal(assignment.state, "active");
      calls.push("read");
      assert.fail("Automatic assignment reached provider reads");
    },
    refreshClubAuthority: async ({ assignment }) => {
      assert.equal(assignment.state, "active");
      calls.push("authority");
      assert.fail("Automatic assignment reached authority refresh");
      return {};
    },
    collectMembershipPage: async () => {
      calls.push("history");
      assert.fail("Automatic assignment reached named membership collection");
    },
  };
  const collect = runInNewContext(collectSource + "\ncollect;", sandbox);
  return {
    calls,
    failures,
    sandbox,
    advance: (ms) => {
      now += ms;
    },
    pass: async () => {
      await collect({
        collectionMode,
        integrationId: "club",
        vrchatGroupId: "grp_00000000-0000-0000-0000-000000000001",
        fencingToken: 1,
        epochStartedAt: 1,
        requestsPerMinute,
        state: connection,
        enabledFeatures: features ?? undefined,
      });
      now += 60000;
    },
  };
}

for (const state of ["active", "connecting", "degraded"]) test(`automatic ${state} only collects aggregates`, async () => {
  const h = harness({ state });
  await h.pass();
  assert.deepEqual(h.calls.filter(x => ["operation", "read", "authority", "history"].includes(x)), []);
  assert.ok(h.calls.includes("aggregate"));
  assert.ok(h.calls.includes("ingest"));
  if (state === "degraded") assert.ok(!h.calls.includes("connect"));
});
test("automatic membership loss reports stop without a reconnect", async () => {
  const h = harness({ state: "degraded", error: new VrchatProviderError("lost", {category: "membership", status: 403}) });
  await h.pass();
  assert.ok(!h.calls.includes("connect"));
  assert.equal(h.failures[0]?.detail, "membership");
});
for (const [joinPolicy, groupVisibility, membershipStatus] of [
  ["request", "public", "none"], ["invite", "public", "invited"], ["unknown", "public", "requested"], ["free", "private", "member"],
]) test(`automatic rejects ${joinPolicy}/${groupVisibility}/${membershipStatus} without joining`, async () => {
  const client = new VrchatClient({authCookie: "test-cookie", userAgent: "test/1"});
  let joins = 0;
  client.getGroup = async () => ({joinPolicy, groupVisibility, membershipStatus});
  client.joinGroup = async () => { joins++; };
  const result = await client.connectGroup("grp_00000000", { admissionMode: "automatic" });
  assert.equal(joins, 0);
  assert.ok(result.admissionRequired);
});
test("automatic free join confirms provider membership", async () => {
  const client = new VrchatClient({authCookie: "test-cookie", userAgent: "test/1"});
  let joins = 0, reads = 0;
  client.getGroup = async () => ({joinPolicy: "free", groupVisibility: "public", membershipStatus: reads++ ? "member" : "none"});
  client.joinGroup = async () => { joins++; };
  assert.equal((await client.connectGroup("grp_00000000", {admissionMode: "automatic"})).state, "active");
  assert.equal(joins, 1); assert.equal(reads, 2);
});

for (const status of [403, 404]) test(`automatic aggregate HTTP ${status} stops ambiguous membership loss`, async () => {
  const h = harness({error: new VrchatProviderError("lost access", {category: "visibility", status})});
  await h.pass();
  assert.equal(h.failures[0]?.detail, "membership");
});

for (const status of [403, 404]) test(`automatic initial HTTP ${status} cannot enter a join retry`, async () => {
  const client = new VrchatClient({authCookie: "test-cookie", userAgent: "test/1"});
  client.getGroup = async () => { throw new VrchatProviderError("unavailable", {status, category: "visibility"}); };
  client.joinGroup = async () => assert.fail("Unavailable group must not be joined");
  assert.equal((await client.connectGroup("grp_00000000", {admissionMode: "automatic"})).admissionRequired, "invalid");
});
