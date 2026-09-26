import assert from "node:assert/strict";
import { test } from "node:test";
import { executeClubOperation } from "./club-operation-jobs.mjs";
import { RequestBudget } from "./runtime.mjs";
import { VrchatClient, VrchatProviderError } from "./vrchat-client.mjs";
const groupId = "grp_00000000-0000-0000-0000-000000000001";
const botId = "usr_00000000-0000-0000-0000-000000000001";
const targetId = "usr_00000000-0000-0000-0000-000000000003";
function setup({ authorized = true, uncertain = false, limit = 4 } = {}) {
  let now = 1000;
  const order = [], sends = [];
  const args = {
    assignment: { integrationId: "integration", fencingToken: 1, epochStartedAt: 1, vrchatGroupId: groupId },
    expectedUserId: botId, accountBudget: new RequestBudget(limit), integrationBudget: new RequestBudget(limit),
    clock: () => now, pause: async ms => { now += ms; },
    control: { async send(op, body) {
      order.push(op); sends.push({ op, body });
      if (op === "club_operation_claim") return { operationId: "op", nonce: "nonce", payload: { kind: "ban_member", targetUserId: targetId } };
      if (op === "budget") return { granted: true };
      if (op === "club_operation_authorize") { assert.ok(now - body.authority.observedAt <= 30000); return { authorized }; }
      return { recorded: true };
    } },
    provider: { async request(path, options) {
      if (options?.method) {
        order.push("provider-write");
        if (uncertain) throw new Error("connection lost");
        return { id: "gmem_00000000-0000-0000-0000-000000000001", userId: targetId, groupId };
      }
      order.push("provider-read");
      if (path === "/auth/user") return { id: botId };
      return { id: groupId, ownerId: "usr_00000000-0000-0000-0000-000000000002", roles: [], myMember: { userId: botId, groupId, membershipStatus: "member", permissions: ["*"], roleIds: [] } };
    } },
  };
  return { args, order, sends };
}
test("authorizes after budget reservation and immediately before the single provider write", async () => {
  const { args, order, sends } = setup();
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  const write = order.indexOf("provider-write");
  assert.equal(order[write - 1], "club_operation_authorize");
  assert.equal(order.filter(item => item === "provider-write").length, 1);
  assert.equal(sends.at(-1).body.status, "succeeded");
});
test("permission loss prevents a provider write", async () => {
  const { args, order } = setup({ authorized: false });
  assert.equal((await executeClubOperation(args)).status, "rejected");
  assert.equal(order.includes("provider-write"), false);
});
test("uncertain writes are recorded once and never retried", async () => {
  const { args, order, sends } = setup({ uncertain: true });
  assert.equal((await executeClubOperation(args)).status, "indeterminate");
  assert.equal(order.filter(item => item === "provider-write").length, 1);
  assert.equal(sends.at(-1).body.status, "indeterminate");
});
for (const guard of ["shutdown", "local_capacity"]) {
  test(`authorization followed by ${guard} records a definite unsent rejection`, async () => {
    const { args, order, sends } = setup();
    let stop = false;
    args.shouldStop = () => stop;
    const send = args.control.send;
    args.control.send = async (op, body) => {
      const result = await send(op, body);
      if (op === "club_operation_authorize") {
        if (guard === "shutdown") stop = true;
        else while (args.accountBudget.tryConsume(1, args.clock())) { /* consume competing capacity */ }
      }
      return result;
    };
    assert.deepEqual(await executeClubOperation(args), {processed:true,status:"rejected",code:"submission_not_attempted"});
    assert.equal(order.includes("provider-write"), false);
    assert.equal(sends.at(-1).op, "club_operation_complete");
    assert.equal(sends.at(-1).body.status, "rejected");
    assert.equal(order.includes("club_operation_defer"), false);
  });
}
test("lost authorization response cannot claim a definite submitted outcome or replay", async () => {
  const {args,order,sends} = setup();
  const send = args.control.send;
  args.control.send = async (op, body) => {
    const result = await send(op,body);
    if (op === "club_operation_authorize") throw new Error("response lost after server committed");
    return result;
  };
  await executeClubOperation(args);
  assert.equal(order.includes("provider-write"),false);
  assert.equal(order.includes("club_operation_complete"),false);
  assert.equal(sends.at(-1).op,"club_operation_reject");
  // The backend claimed-state guard refuses this rejection for submitted work.
});
test("a two-request budget waits before the grant read and reserves its write", async () => {
  const { args, order } = setup({ limit: 2 });
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  assert.equal(order.filter(item => item === "provider-read").length, 2);
  assert.equal(args.clock(), 61000);
});

test("unsupported one-request budgets fail before provider calls or waits", async () => {
  const { args, order } = setup({ limit: 1 });
  const started = args.clock();
  const result = await executeClubOperation(args);
  assert.equal(result.code, "operation_budget_too_low");
  assert.equal(args.clock(), started);
  assert.equal(order.includes("provider-read"), false);
  assert.equal(order.includes("provider-write"), false);
});

test("transient preflight failures defer only work that has not been submitted", async () => {
  const { args, sends, order } = setup();
  args.provider.request = async () => { throw new VrchatProviderError("timeout", { category: "timeout" }); };
  await executeClubOperation(args);
  assert.equal(sends.at(-1).op, "club_operation_defer");
  assert.equal(sends.at(-1).body.retryAfterMs, 60000);
  assert.equal(order.includes("club_operation_authorize"), false);
  assert.equal(order.includes("provider-write"), false);
});

for (const minutes of [30, 60]) {
  test(`HTTP Retry-After of ${minutes} minutes survives the real operation wrapper`, async () => {
    const { args, sends, order } = setup();
    let requests = 0;
    args.provider = new VrchatClient({ authCookie: "fixture-cookie", userAgent: "VRDex/test",
      fetcher: async () => { requests++; return new Response(null, { status: 429, headers: { "retry-after": String(minutes * 60) } }); },
    });
    const result = await executeClubOperation(args);
    assert.equal(result.httpStatus, 429);
    assert.equal(result.retryAfterMs, minutes * 60_000);
    assert.equal(sends.at(-1).body.retryAfterMs, minutes * 60_000);
    assert.equal(requests, 1);
    assert.equal(order.includes("club_operation_authorize"), false);
  });
}

test("an instance that closes during a budget wait receives no invitation", async () => {
  const { args, order } = setup();
  const worldId = "wrld_00000000-0000-0000-0000-000000000001";
  const instanceId = `123~group(${groupId})~groupAccessType(members)`;
  const send = args.control.send;
  args.control.send = async (op, body) => {
    const value = await send(op, body);
    return op === "club_operation_claim" ? { ...value, payload: { kind: "invite_to_instance", targetUserId: targetId, worldId, instanceId, messageSlot: 0 } } : value;
  };
  let destinationReads = 0;
  const request = args.provider.request;
  args.provider.request = async (path, options) => {
    if (path.startsWith("/instances/")) { destinationReads++; return { worldId, instanceId, ownerId: groupId, type: "group", active: args.clock() < 61000, closedAt: null }; }
    if (path.endsWith("/friendStatus")) return { isFriend: true };
    return request(path, options);
  };
  const outcome = await executeClubOperation(args);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "destination_closed");
  assert.equal(order.includes("provider-write"), false);
  assert.equal(order.includes("club_operation_authorize"), false);
  assert.equal(destinationReads, 1);
});

function invitationSetup(limit) {
  const state = setup({ limit });
  const { args } = state;
  const worldId = "wrld_00000000-0000-0000-0000-000000000001";
  const instanceId = `123~group(${groupId})~groupAccessType(members)`;
  const send = args.control.send;
  args.control.send = async (op, body) => {
    const value = await send(op, body);
    return op === "club_operation_claim" ? { ...value, payload: { kind: "invite_to_instance", targetUserId: targetId, worldId, instanceId } } : value;
  };
  const request = args.provider.request;
  args.provider.request = async (path, options) => {
    if (path.startsWith("/instances/")) return { worldId, instanceId, ownerId: groupId, type: "group", active: true, closedAt: null };
    if (path.endsWith("/friendStatus")) return { isFriend: true };
    const value = await request(path, options);
    return options?.method ? { id: "not_00000000-0000-0000-0000-000000000001", type: "invite", receiverUserId: targetId, senderUserId: botId } : value;
  };
  return state;
}

for (const limit of [1, 2, 3, 4]) {
  test(`instance invitation at ${limit}/minute finishes or fails immediately without starvation`, async () => {
    const { args, order, sends } = invitationSetup(limit);
    const result = await executeClubOperation(args);
    if (limit < 4) {
      assert.equal(result.code, "operation_budget_too_low");
      assert.equal(args.clock(), 1000);
      assert.equal(order.includes("provider-read"), false);
      assert.equal(order.includes("provider-write"), false);
    } else {
      assert.equal(result.status, "succeeded");
      assert.equal(args.clock(), 61000);
      assert.equal(order.filter(x => x === "provider-write").length, 1);
      assert.deepEqual(sends.filter(x => x.op === "budget").map(x => x.body.requestCount), [1, 4]);
    }
  });
}

test("shared contention delays the whole fresh invitation preflight", async () => {
  const { args, order, sends } = invitationSetup(4);
  const send = args.control.send;
  let denied = false;
  args.control.send = async (op, body) => {
    if (op === "budget" && body.requestCount === 4 && !denied) {
      denied = true;
      return { granted: false, retryAt: args.clock() + 60000 };
    }
    return send(op, body);
  };
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  assert.equal(args.clock(), 121000);
  assert.equal(order.filter(x => x === "provider-write").length, 1);
  assert.equal(sends.find(x => x.op === "club_operation_authorize").body.authority.observedAt, 121000);
});

test("slow invitation reads defer stale evidence without refreshing or writing", async () => {
  const { args, order, sends } = invitationSetup(4);
  const request = args.provider.request;
  args.provider.request = async (path, options) => {
    const value = await request(path, options);
    if (path.endsWith("/friendStatus")) await args.pause(31000);
    return value;
  };
  const result = await executeClubOperation(args);
  assert.equal(result.code, "rate_limit");
  assert.equal(sends.at(-1).op, "club_operation_defer");
  assert.equal(order.includes("club_operation_authorize"), false);
  assert.equal(order.includes("provider-write"), false);
  assert.deepEqual(sends.filter(x => x.op === "budget").map(x => x.body.requestCount), [1, 4]);
});

test("an expired invitation reservation cannot authorize or write in the next window", async () => {
  const { args, order, sends } = invitationSetup(4);
  const request = args.provider.request;
  args.provider.request = async (path, options) => {
    const value = await request(path, options);
    if (path.endsWith("/friendStatus")) await args.pause(60000);
    return value;
  };
  await executeClubOperation(args);
  assert.equal(sends.at(-1).op, "club_operation_defer");
  assert.equal(order.includes("club_operation_authorize"), false);
  assert.equal(order.includes("provider-write"), false);
});

for (const limit of [2, 3]) {
  test(`normal instance close requires three fresh request slots at limit ${limit}`, async () => {
    const { args, order } = invitationSetup(limit);
    const send = args.control.send;
    args.control.send = async (op, body) => {
      const result = await send(op, body);
      if (op !== "club_operation_claim") return result;
      const { worldId, instanceId } = result.payload;
      return { ...result, payload: { kind: "close_instance", worldId, instanceId } };
    };
    const request = args.provider.request;
    args.provider.request = async (path, options) => {
      if (options?.method === "DELETE") order.push("provider-write");
      return request(path, options);
    };
    const result = await executeClubOperation(args);
    assert.equal(result.status, limit === 3 ? "succeeded" : "rejected");
    assert.equal(order.includes("provider-write"), limit === 3);
    if (limit === 2) assert.equal(result.code, "operation_budget_too_low");
  });
}

test("all invitation requests fit the shared reservation and local sliding limits", async () => {
  const { args } = invitationSetup(4);
  const send = args.control.send;
  const windows = new Map();
  const actual = [];
  args.control.send = async (op, body) => {
    if (op === "budget") {
      const bucket = Math.floor(args.clock() / 60000);
      const count = (windows.get(bucket) ?? 0) + body.requestCount;
      assert.ok(count <= 4);
      windows.set(bucket, count);
    }
    return send(op, body);
  };
  const request = args.provider.request;
  args.provider.request = async (path, options) => {
    const now = args.clock();
    actual.push(now);
    assert.ok(actual.filter(time => time > now - 60000).length <= 4);
    assert.ok(actual.filter(time => Math.floor(time / 60000) === Math.floor(now / 60000)).length <= windows.get(Math.floor(now / 60000)));
    const result = await request(path, options);
    await args.pause(5);
    return result;
  };
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  assert.equal(actual.length, 5);
});

test("authorization that outlives the reserved window never causes a provider write", async () => {
  const { args, order, sends } = setup();
  const send = args.control.send;
  args.control.send = async (op, body) => {
    const result = await send(op, body);
    if (op === "club_operation_authorize") await args.pause(60000);
    return result;
  };
  assert.equal((await executeClubOperation(args)).status, "rejected");
  assert.equal(order.includes("provider-write"), false);
  assert.equal(sends.at(-1).op, "club_operation_complete");
  assert.equal(sends.at(-1).body.status, "rejected");
  assert.equal(sends.at(-1).body.code, "submission_not_attempted");
});

test("authorization that crosses the action's late deadline cannot write inside the same budget window", async () => {
  const { args, order, sends } = setup();
  const send = args.control.send;
  args.control.send = async (op, body) => {
    const result = await send(op, body);
    if (op === "club_operation_claim") return { ...result, executeBefore: 2000 };
    if (op === "club_operation_authorize") await args.pause(2000);
    return result;
  };
  assert.equal((await executeClubOperation(args)).status, "rejected");
  assert.equal(args.clock(), 3000);
  assert.equal(order.includes("provider-write"), false);
  assert.equal(sends.at(-1).op, "club_operation_complete");
});
