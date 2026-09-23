import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { RequestBudget, failureDisposition } from "./runtime.mjs";
import { executeClubOperation } from "./club-operation-jobs.mjs";
import { readClubProviderJob } from "./club-read-jobs.mjs";
import { ClubProvider } from "./club-provider.mjs";
import { budgetedClubProvider } from "./club-request-budget.mjs";
import { VrchatProviderError } from "./vrchat-client.mjs";

const source = readFileSync(
  new URL("./worker.mjs", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const collector = source.slice(
  source.indexOf("async function checkClubReads("),
  source.indexOf("/**\n * Hands back"),
);
const bot = "usr_00000000-0000-0000-0000-000000000001";
const group = "grp_00000000-0000-0000-0000-000000000001";

async function run(jobKind, fault, stage = "preflight") {
  const calls = [],
    recorded = [];
  const startedAt = Date.now();
  const sandbox = {
    Date,
    RequestBudget,
    failureDisposition,
    executeClubOperation,
    readClubProviderJob,
    ClubProvider,
    budgetedClubProvider,
    VrchatProviderError,
    integrationBudgets: new Map(),
    accountBudget: new RequestBudget(100),
    attempts: new Map(),
    COLLECTOR_PROTOCOL_VERSION: "test",
    secret: { vrchatUserId: bot },
    stopping: false,
    provider: {
      request: async (path, options) => {
        calls.push(options?.method ? "provider-write" : path);
        const failHere =
          stage === "preflight" ||
          (stage === "write" && options?.method) ||
          (stage === "data" && path.includes("/posts?"));
        if (failHere && fault === "rate_limit")
          throw new VrchatProviderError("limited", {
            status: 429,
            category: "rate_limit",
            retryAfterMs: 300000,
          });
        if (fault === "authentication")
          throw new VrchatProviderError("expired", {
            status: 401,
            category: "authentication",
          });
        if (path === "/auth/user") return { id: bot };
        if (path.includes("/posts?")) return { posts: [], total: 0 };
        return {
          id: group,
          ownerId: bot,
          roles: [],
          myMember: {
            userId: bot,
            groupId: group,
            membershipStatus: fault === "membership" ? "inactive" : "member",
            permissions: fault === "provider_permissions" ? [] : ["*"],
            roleIds: [],
          },
        };
      },
      readAggregateSnapshot: async () => {
        calls.push("aggregate");
        return {
          observedAt: Date.now(),
          group: { memberCount: 1 },
          instances: [],
        };
      },
    },
    control: {
      send: async (op, args) => {
        calls.push(op);
        recorded.push({ op, args });
        if (op === "club_operation_claim")
          return jobKind === "operation"
            ? {
                operationId: "job",
                nonce: "nonce",
                executeBefore: Date.now() + 900000,
                payload: {
                  kind: "publish_post",
                  title: "Reviewed",
                  text: "Reviewed",
                  visibility: "group",
                  sendNotification: false,
                },
              }
            : null;
        if (op === "club_read_claim")
          return jobKind === "read"
            ? {
                requestId: "read",
                claimToken: "token",
                groupId: group,
                expectedUserId: bot,
                enabledFeatures: ["posts"],
                params: { kind: "posts", n: 10, offset: 0 },
              }
            : null;
        if (op === "budget") return { granted: true };
        if (op === "club_operation_authorize") return { authorized: true };
        if (op === "club_operation_defer")
          return { retryAt: Date.now() + 300000 };
        return { recorded: true };
      },
    },
    refreshClubAuthority: async () => {
      calls.push("readiness");
      return {};
    },
    collectMembershipPage: async () => {
      calls.push("history");
    },
    pauseWithHeartbeats: async () => {},
    randomPollDelayMs: () => 60000,
    pollId: () => "poll",
    boundedProviderCategory: (x) => x,
    logEvent: () => {},
    collectorAuthRequiredEvent: () => ({}),
    reportDeadSession: async () => {
      calls.push("auth-required");
      sandbox.stopping = true;
    },
  };
  const collect = runInNewContext(collector + "\ncollect;", sandbox);
  await collect({
    integrationId: "club",
    vrchatGroupId: group,
    state: "active",
    epochStartedAt: 1,
    fencingToken: 1,
    requestsPerMinute: 100,
    enabledFeatures: ["analytics", "posts"],
  });
  return { calls, recorded, startedAt };
}

for (const jobKind of ["operation", "read"]) {
  for (const fault of ["rate_limit", "membership"]) {
    test(`real ${jobKind} ${fault} records its outcome then stops subsequent transport`, async () => {
      const { calls, recorded, startedAt } = await run(jobKind, fault);
      const completion =
        jobKind === "read"
          ? "club_read_complete"
          : fault === "rate_limit"
            ? "club_operation_defer"
            : "club_operation_reject";
      assert.equal(calls.filter((x) => x === completion).length, 1);
      const result = recorded.find((x) => x.op === completion).args;
      assert.equal(jobKind === "read" ? result.errorCode : result.code, fault);
      if (jobKind === "read") {
        assert.equal(Object.hasOwn(result, "retryAfterMs"), false);
        assert.equal(Object.hasOwn(result, "httpStatus"), false);
      }
      assert.ok(!calls.includes("aggregate"));
      assert.ok(!calls.includes("readiness"));
      assert.ok(!calls.includes("history"));
      assert.ok(!calls.includes("provider-write"));
      if (jobKind === "operation")
        assert.ok(!calls.includes("club_read_claim"));
      const failure = recorded.find((x) => x.op === "failure");
      assert.ok(failure);
      assert.equal(failure.args.telemetryOnly, false);
      assert.equal(failure.args.detail, fault);
      assert.ok(calls.indexOf(completion) < calls.indexOf("failure"));
      assert.equal(calls.at(-1), "release");
      if (fault === "rate_limit") {
        assert.equal(failure.args.statusClass, "429");
        assert.ok(failure.args.backoffUntil >= startedAt + 300000);
      }
    });
  }
  test(`real ${jobKind} permission-only rejection leaves independent collection available`, async () => {
    const { calls, recorded } = await run(jobKind, "provider_permissions");
    const result = recorded.find(
      (x) =>
        x.op ===
        (jobKind === "read" ? "club_read_complete" : "club_operation_reject"),
    );
    assert.equal(
      jobKind === "read" ? result.args.errorCode : result.args.code,
      "provider_permissions",
    );
    assert.ok(calls.includes("aggregate"));
    assert.ok(calls.includes("readiness"));
    assert.ok(!calls.includes("failure"));
    assert.ok(!calls.includes("provider-write"));
  });
  test(`real ${jobKind} authentication outcome keeps the account stop`, async () => {
    const { calls } = await run(jobKind, "authentication");
    assert.ok(calls.includes("auth-required"));
    assert.ok(!calls.includes("aggregate"));
    assert.ok(!calls.includes("readiness"));
  });
}

test("a submitted operation 429 is completed once before shared backoff without replay", async () => {
  const { calls, recorded, startedAt } = await run(
    "operation",
    "rate_limit",
    "write",
  );
  assert.equal(calls.filter((x) => x === "provider-write").length, 1);
  assert.equal(calls.filter((x) => x === "club_operation_complete").length, 1);
  assert.equal(calls.includes("club_operation_defer"), false);
  const completion = recorded.find((x) => x.op === "club_operation_complete");
  assert.equal(completion.args.status, "rejected");
  assert.equal(completion.args.code, "rate_limit");
  assert.ok(
    calls.indexOf("club_operation_complete") < calls.indexOf("failure"),
  );
  assert.ok(!calls.includes("club_read_claim"));
  assert.ok(!calls.includes("aggregate"));
  assert.ok(
    recorded.find((x) => x.op === "failure").args.backoffUntil >=
      startedAt + 300000,
  );
});

test("a provider data-read 429 retains its retry window after recording the read failure", async () => {
  const { calls, recorded, startedAt } = await run(
    "read",
    "rate_limit",
    "data",
  );
  assert.equal(
    recorded.find((x) => x.op === "club_read_complete").args.errorCode,
    "rate_limit",
  );
  assert.ok(!calls.includes("aggregate"));
  assert.ok(
    recorded.find((x) => x.op === "failure").args.backoffUntil >=
      startedAt + 300000,
  );
});
