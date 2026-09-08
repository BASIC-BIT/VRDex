import assert from "node:assert/strict";
import { test } from "node:test";

import { checkDestinationMetadata } from "./destination-jobs.mjs";
import { resolveProfileLinkDestination } from "./profile-link-destination.mjs";
import { RequestBudget, TelemetryControlClient } from "./runtime.mjs";
import { VrchatClient } from "./vrchat-client.mjs";

const groupId = "grp_11111111-1111-4111-8111-111111111111";
const job = { key: `vrchat_group:${groupId}`, kind: "vrchat_group", locator: groupId, leaseToken: "fresh-lease" };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

function scenario({ controlResponse, providerResponse, jobs = [job] } = {}) {
  const requests = [];
  const events = [];
  let stopping = false;
  const control = new TelemetryControlClient({
    endpoint: "https://control.test/telemetry/worker", collectorAccountId: "collector-id",
    workerApiKey: "worker-credential", vrchatUserId: "usr_service-account", workerId: "worker-id",
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ boundary: "control", ...body });
      const override = await controlResponse?.(body);
      if (override) return override;
      if (body.operation === "destination_claim") return json({ jobs });
      if (body.operation === "proof_budget") return json({ granted: true });
      return json({ accepted: true, recorded: true });
    },
  });
  const provider = new VrchatClient({
    authCookie: "cookie-value", userAgent: "VRDex/1.0 test@example.com",
    fetcher: async (url, init) => {
      requests.push({ boundary: "provider", url, init });
      return await providerResponse?.(url, init) ?? json({ id: groupId, name: "Sloth's Group", privacy: "default" });
    },
  });
  const accountBudget = new RequestBudget(30);
  const metadataBudget = new RequestBudget(15);
  return {
    requests, events, accountBudget, metadataBudget,
    stop() { stopping = true; },
    run: () => checkDestinationMetadata({
      control, provider, accountBudget, metadataBudget, resolve: resolveProfileLinkDestination,
      heartbeat: () => control.send("heartbeat"), isStopping: () => stopping,
      reportDeadSession: async () => { await control.send("proof_auth_failure"); stopping = true; },
      pauseWithHeartbeats: async ms => { events.push({ paused: ms }); },
      logEvent: event => events.push(event),
    }),
  };
}

test("metadata reaches the control plane with its lease and only after a shared request reservation", async () => {
  const run = scenario();
  await run.run();
  const providerIndex = run.requests.findIndex(entry => entry.boundary === "provider");
  assert.equal(run.requests[providerIndex - 1].operation, "proof_budget");
  const result = run.requests.find(entry => entry.operation === "destination_result");
  assert.equal(result.key, job.key);
  assert.equal(result.leaseToken, job.leaseToken);
  assert.equal(result.workerId, "worker-id");
  assert.deepEqual(result.result, { status: "resolved", entityId: groupId, displayName: "Sloth's Group" });
  assert.equal(run.requests[providerIndex].init.redirect, "error");
  assert.equal(run.accountBudget.remaining(), 29);
  assert.equal(run.metadataBudget.remaining(), 14);
});

test("a denied shared budget releases the lease without querying VRChat or consuming local allowance", async () => {
  const run = scenario({ controlResponse: body => body.operation === "proof_budget" ? json({ granted: false }) : undefined });
  await run.run();
  assert.equal(run.requests.some(entry => entry.boundary === "provider"), false);
  assert.equal(run.requests.at(-1).operation, "destination_release");
  assert.equal(run.requests.at(-1).leaseToken, job.leaseToken);
  assert.equal(run.accountBudget.remaining(), 30);
  assert.equal(run.metadataBudget.remaining(), 15);
});

test("local budget exhaustion never claims a new destination", async () => {
  const run = scenario();
  run.metadataBudget.tryConsume(15);
  assert.equal(await run.run(), 0);
  assert.deepEqual(run.requests, []);
});

test("shutdown after claiming releases the lease without a provider read", async () => {
  const run = scenario({ controlResponse: body => { if (body.operation === "heartbeat") run.stop(); } });
  await run.run();
  assert.equal(run.requests.some(entry => entry.boundary === "provider"), false);
  assert.equal(run.requests.at(-1).operation, "destination_release");
});

test("an authenticated 401 releases the lease before quarantining the collector", async () => {
  const run = scenario({ providerResponse: () => json({}, 401) });
  await run.run();
  assert.deepEqual(run.requests.slice(-2).map(entry => entry.operation), ["destination_release", "proof_auth_failure"]);
  assert.equal(run.requests.some(entry => entry.operation === "destination_result"), false);
  const count = run.requests.length;
  await run.run();
  assert.equal(run.requests.length, count);
});

test("429 publishes an account-wide cooldown before making the lease available again", async () => {
  const run = scenario({ providerResponse: () => json({}, 429, { "retry-after": "120" }) });
  await run.run();
  assert.deepEqual(run.requests.slice(-2).map(entry => entry.operation), ["proof_rate_limit", "destination_release"]);
  assert.equal(run.requests.at(-2).retryAfterMs, 120_000);
  assert.ok(run.events.some(entry => entry.paused === 120_000));
});

test("a failed cooldown publication keeps the lease held while the worker backs off", async () => {
  const run = scenario({
    providerResponse: () => json({}, 429),
    controlResponse: body => body.operation === "proof_rate_limit" ? json({}, 503) : undefined,
  });
  await run.run();
  assert.equal(run.requests.some(entry => entry.operation === "destination_release"), false);
  assert.ok(run.events.some(entry => entry.paused === 60_000));
});

test("a control-plane budget failure is released and reported as a control failure", async () => {
  const run = scenario({ controlResponse: body => body.operation === "proof_budget" ? json({}, 503) : undefined });
  await assert.rejects(run.run(), /Control plane 503/);
  assert.equal(run.requests.at(-1).operation, "destination_release");
  assert.equal(run.requests.some(entry => entry.boundary === "provider"), false);
  assert.equal(run.requests.some(entry => entry.operation === "destination_result"), false);
});

test("oversized VRChat responses preserve cached data by reporting a transient outcome", async () => {
  const run = scenario({ providerResponse: () => json({ id: groupId, name: "x".repeat(300_000), privacy: "default" }) });
  await run.run();
  assert.deepEqual(run.requests.find(entry => entry.operation === "destination_result").result, { status: "transient" });
});

test("a result rejected by lease fencing is never logged as a successful cache update", async () => {
  const run = scenario({ controlResponse: body => body.operation === "destination_result" ? json({ accepted: false }) : undefined });
  await run.run();
  assert.deepEqual(run.events.at(-1), { event: "collector_destination_lookup", outcome: "discarded" });
});

test("short-code redirects and their subsequent authenticated lookup each require a shared budget slot", async t => {
  let redirectReads = 0;
  let reservations = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    redirectReads += 1;
    assert.equal(new Headers(options.headers).has("cookie"), false);
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: `https://vrchat.com/home/group/${groupId}` } });
  });
  const run = scenario({
    jobs: [{ ...job, key: "vrchat_group:SLOTH.1234", locator: "SLOTH.1234" }],
    controlResponse: body => body.operation === "proof_budget" ? json({ granted: ++reservations === 1 }) : undefined,
  });
  await run.run();
  assert.equal(redirectReads, 1);
  assert.equal(reservations, 2);
  assert.equal(run.requests.some(entry => entry.boundary === "provider"), false);
  assert.equal(run.requests.at(-1).operation, "destination_release");
  assert.equal(run.accountBudget.remaining(), 29);
});

test("a short-code redirect 429 applies the same account cooldown as an authenticated provider throttle", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "retry-after": "90" } }));
  const run = scenario({ jobs: [{ ...job, key: "vrchat_group:SLOTH.1234", locator: "SLOTH.1234" }] });
  await run.run();
  assert.deepEqual(run.requests.slice(-2).map(entry => entry.operation), ["proof_rate_limit", "destination_release"]);
  assert.equal(run.requests.at(-2).retryAfterMs, 90_000);
  assert.equal(run.requests.some(entry => entry.boundary === "provider"), false);
  assert.ok(run.events.some(entry => entry.paused === 90_000));
});
