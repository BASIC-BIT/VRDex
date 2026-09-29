import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { RequestBudget, failureDisposition } from "./runtime.mjs";
import { executeClubOperation } from "./club-operation-jobs.mjs";
import { VrchatProviderError } from "./vrchat-client.mjs";
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
      assert.equal(assignment.state, "active");
      assert.ok(deadline > now);
      assert.ok(now < 1000000 + 15 * 60000, "work is reached before cutoff");
    },
    checkClubReads: async (assignment) => {
      assert.equal(assignment.state, "active");
      calls.push("read");
    },
    refreshClubAuthority: async ({ assignment }) => {
      assert.equal(assignment.state, "active");
      calls.push("authority");
      return {};
    },
    collectMembershipPage: async () => {
      calls.push("history");
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
for (const feature of ["posts", "membership_management", "instances"])
  for (const state of [
    "active",
    "connecting",
    "awaiting_approval",
    "awaiting_invite",
    "degraded",
  ]) {
    test(`${feature}-only ${state} skips analytics after effective connection`, async () => {
      const h = harness({ state, features: [feature] });
      await h.pass();
      for (const wanted of ["operation", "read", "authority"])
        assert.ok(h.calls.includes(wanted), wanted);
      for (const forbidden of ["aggregate", "ingest", "history"])
        assert.ok(!h.calls.includes(forbidden), forbidden);
    });
  }
test("repeated aggregate failure cannot starve management before cutoff or force reconnect", async () => {
  const h = harness({
    error: new VrchatProviderError("blocked", {
      status: 403,
      category: "visibility",
    }),
  });
  for (let i = 0; i < 5; i++) await h.pass();
  for (const op of ["operation", "read", "authority"])
    assert.equal(h.calls.filter((x) => x === op).length, 5);
  assert.ok(!h.calls.includes("connect"));
  assert.ok(h.calls.indexOf("operation") < h.calls.indexOf("aggregate"));
});
test("ingest failure occurs after independent management and readiness", async () => {
  const h = harness({ ingestError: true });
  await assert.rejects(h.pass(), /malformed snapshot/);
  for (const op of ["operation", "read", "authority"])
    assert.ok(h.calls.includes(op));
});
test("undefined features retain legacy analytics collection", async () => {
  const h = harness({ features: null });
  await h.pass();
  assert.ok(h.calls.includes("ingest"));
});
for (const category of ["authentication", "rate_limit"])
  test(`${category} remains a shared failure`, async () => {
    const h = harness({
      error: new VrchatProviderError("blocked", {
        status: category === "authentication" ? 401 : 429,
        category,
      }),
    });
    await h.pass();
    assert.ok(!h.failures[0].telemetryOnly);
    assert.equal(h.sandbox.stopping, category === "authentication");
  });
test("waiting membership never dispatches management or analytics", async () => {
  const h = harness({
    state: "connecting",
    membershipState: "awaiting_approval",
  });
  await h.pass();
  assert.ok(!h.calls.includes("operation"));
  assert.ok(!h.calls.includes("aggregate"));
});
test("disconnecting leaves without dispatch", async () => {
  const h = harness({ state: "disconnecting" });
  await h.pass();
  assert.ok(h.calls.includes("leave"));
  assert.ok(!h.calls.includes("operation"));
});

for (const authorized of [true, false])
  test(`actual dispatch after repeated telemetry failures still checks current authority: ${authorized}`, async () => {
    const h = harness({
      error: new VrchatProviderError("aggregate malformed", {
        category: "schema_drift",
      }),
    });
    for (let i = 0; i < 4; i++) await h.pass();
    h.advance(10 * 60000); // Reach the last minute of the original 15-minute window.
    const bot = "usr_00000000-0000-0000-0000-000000000001";
    const group = "grp_00000000-0000-0000-0000-000000000001";
    h.sandbox.secret.vrchatUserId = bot;
    const send = h.sandbox.control.send;
    h.sandbox.control.send = async (op, args) => {
      const result = await send(op, args);
      if (op === "club_operation_claim")
        return {
          operationId: "job",
          nonce: "nonce",
          executeBefore: 1000000 + 15 * 60000,
          payload: {
            kind: "publish_post",
            title: "Due now",
            text: "Reviewed post",
            visibility: "group",
            sendNotification: false,
          },
        };
      if (op === "club_operation_authorize") {
        assert.equal(args.authority.observedAt, h.sandbox.Date.now());
        return { authorized };
      }
      return result;
    };
    h.sandbox.provider.request = async (path, options) => {
      if (options?.method) {
        h.calls.push("provider-write");
        return { id: "post" };
      }
      if (path === "/auth/user") return { id: bot };
      return {
        id: group,
        ownerId: bot,
        roles: [],
        myMember: {
          userId: bot,
          groupId: group,
          membershipStatus: "member",
          permissions: ["*"],
          roleIds: [],
        },
      };
    };
    h.sandbox.checkClubOperations = (assignment, integrationBudget, deadline) =>
      executeClubOperation({
        assignment,
        integrationBudget,
        deadline,
        provider: h.sandbox.provider,
        control: h.sandbox.control,
        expectedUserId: bot,
        accountBudget: h.sandbox.accountBudget,
        pause: async (ms) => h.advance(ms),
        shouldStop: () => h.sandbox.stopping,
        clock: h.sandbox.Date.now,
      });
    await h.pass();
    assert.ok(h.calls.includes("club_operation_authorize"));
    assert.equal(h.calls.includes("provider-write"), authorized);
    if (authorized)
      assert.equal(
        h.calls[h.calls.indexOf("provider-write") - 1],
        "club_operation_authorize",
      );
  });
test("stopping after operation authentication failure prevents later reads", async () => {
  const h = harness();
  h.sandbox.checkClubOperations = async () => {
    h.sandbox.stopping = true;
  };
  await h.pass();
  for (const op of ["read", "authority", "aggregate"])
    assert.ok(!h.calls.includes(op));
});
test("membership failure in aggregate retains connection failure semantics", async () => {
  const h = harness({
    error: new VrchatProviderError("not a member", {
      status: 403,
      category: "membership",
    }),
  });
  await h.pass();
  assert.equal(h.failures[0].telemetryOnly, false);
});

for (const features of [null, ["analytics", "posts"]])
  test(`analytics still polls when readiness shares a two-request budget: ${features}`, async () => {
    const h = harness({ features, requestsPerMinute: 2 });
    h.sandbox.refreshClubAuthority = async ({ integrationBudget }) => {
      h.calls.push("authority");
      return {
        refreshed: integrationBudget.tryConsume(2, h.sandbox.Date.now()),
      };
    };
    await h.pass();
    assert.ok(h.calls.includes("ingest"));
  });

test("aggregate reservation uses time after management waits", async () => {
  const h = harness();
  const budgetTimes = [];
  h.sandbox.checkClubOperations = async () => h.advance(60000);
  const send = h.sandbox.control.send;
  h.sandbox.control.send = async (op, args) => {
    if (op === "budget") budgetTimes.push(args.now);
    return send(op, args);
  };
  await h.pass();
  assert.deepEqual(budgetTimes, [1060000]);
  assert.ok(h.calls.includes("aggregate"));
});
test("a reservation that outlives the bounded pass cannot start aggregate transport", async () => {
  const h = harness();
  const send = h.sandbox.control.send;
  h.sandbox.control.send = async (op, args) => {
    const result = await send(op, args);
    if (op === "budget") h.advance(240000);
    return result;
  };
  await h.pass();
  assert.ok(!h.calls.includes("aggregate"));
});

test("a readiness-only schema failure does not invalidate a successful aggregate poll", async () => {
  const h = harness();
  h.sandbox.refreshClubAuthority = async () => {
    throw new VrchatProviderError("malformed readiness", {
      category: "schema_drift",
    });
  };
  await h.pass();
  assert.ok(h.calls.includes("ingest"));
  assert.ok(!h.calls.includes("failure"));
});
