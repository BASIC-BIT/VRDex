import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { RequestBudget, boundedProviderCategory } from "./runtime.mjs";
import { VrchatClient, VrchatProviderError } from "./vrchat-client.mjs";

const source = readFileSync(new URL("./worker.mjs", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const start = source.indexOf("async function checkProofs()");
const end = source.indexOf('\nlogEvent({\n  event: "collector_started",', start);
assert.ok(start >= 0, "proof handler start exists");
assert.ok(end > start, "proof handler end exists");

async function check(record, error) {
  const now = 1_000_000;
  const calls = [];
  const logs = [];
  const provider = new VrchatClient({
    authCookie: "fixture-cookie", userAgent: "VRDexFixture/1",
    fetcher: async () => Response.json(record),
  });
  // Throw after transport parsing so the handler receives the original sensitive error.
  if (error) provider.findProofCode = async () => { throw error; };
  const checkProofs = runInNewContext(source.slice(start, end) + "\ncheckProofs;", {
    Date: { now: () => now },
    accountBudget: new RequestBudget(30), proofBudget: new RequestBudget(15),
    stopping: false, provider, boundedProviderCategory,
    heartbeat: async () => {},
    logEvent: (entry) => logs.push(entry),
    control: {
      send: async (operation, args) => {
        calls.push([operation, args]);
        if (operation === "proof_claim") return { attempts: [{
          attemptId: "attempt-fixture", targetType: "vrchat_user",
          targetExternalId: "usr_fixture", proofCode: "VRDEX19825",
        }] };
        if (operation === "proof_budget") return { granted: true };
        if (operation === "proof_outcome" || operation === "proof_result") return { recorded: true };
        assert.fail(`Unexpected operation: ${operation}`);
      },
    },
  });
  assert.equal(await checkProofs(), 1);
  assert.deepEqual(calls.map(([op]) => op), ["proof_claim", "proof_budget",
    record?.bio === "" && !error ? "proof_result" : "proof_outcome"]);
  return { calls, logs };
}

test("missing bio produces unavailable without a negative verdict", async () => {
  const { calls, logs } = await check({ id: "usr_fixture", displayName: "private-bio-sentinel" });
  assert.equal(calls.filter(([op]) => op === "proof_result").length, 0);
  assert.equal(calls.find(([op]) => op === "proof_outcome")[1].outcome, "provider_unavailable");
  assert.ok(logs.some((entry) => entry.event === "collector_proof_check" && entry.category === "schema_drift"));
  assert.doesNotMatch(JSON.stringify(logs), /private-bio-sentinel|fixture-cookie|VRDEX19825/);
});

test("provider errors log only their bounded category", async () => {
  const { calls, logs } = await check(null, new VrchatProviderError(
    "private-bio-sentinel fixture-cookie VRDEX19825", { category: "schema_drift" },
  ));
  assert.equal(calls.filter(([op]) => op === "proof_result").length, 0);
  assert.equal(calls.find(([op]) => op === "proof_outcome")[1].outcome, "provider_unavailable");
  assert.ok(logs.some((entry) => entry.event === "collector_proof_check" && entry.category === "schema_drift"));
  assert.doesNotMatch(JSON.stringify(logs), /private-bio-sentinel|fixture-cookie|VRDEX19825/);
});

test("readable empty bio produces a negative verdict", async () => {
  const { calls, logs } = await check({ id: "usr_fixture", bio: "" });
  assert.equal(calls.filter(([op]) => op === "proof_outcome").length, 0);
  const results = calls.filter(([op]) => op === "proof_result");
  assert.equal(results.length, 1);
  assert.equal(results[0][1].found, false);
  assert.ok(logs.some((entry) => entry.event === "collector_proof_check" && entry.outcome === "not_found"));
});
