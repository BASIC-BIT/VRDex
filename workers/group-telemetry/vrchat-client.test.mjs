import assert from "node:assert/strict";
import { test } from "node:test";
import { VrchatClient } from "./vrchat-client.mjs";

function client(body, status = 200) {
  return new VrchatClient({
    authCookie: "test-cookie", userAgent: "VRDex/test",
    fetcher: async () => new Response(body, { status }),
  });
}

test("documented empty success is accepted only when explicitly enabled", async () => {
  assert.equal(await client("").request("/test", { method: "POST", maxResponseBytes: 100, allowEmptyResponse: true }), null);
  await assert.rejects(client("").request("/test", { maxResponseBytes: 100 }), { category: "schema_drift" });
});

test("empty-success opt-in preserves JSON parsing and rejects malformed or oversized bodies", async () => {
  const options = { method: "POST", maxResponseBytes: 20, allowEmptyResponse: true };
  assert.deepEqual(await client('{"ok":true}').request("/test", options), { ok: true });
  await assert.rejects(client("not json").request("/test", options), { category: "schema_drift" });
  await assert.rejects(client(" ".repeat(21)).request("/test", options), { category: "schema_drift" });
  await assert.rejects(client("", 403).request("/test", options), { status: 403 });
});
