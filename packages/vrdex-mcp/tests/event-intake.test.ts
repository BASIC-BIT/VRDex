import assert from "node:assert/strict";
import { test } from "node:test";
import { createVrdexApiClient } from "../src/api-client";

test("intake client carries bearer authority and uses the shared wire paths", async () => {
  const calls: { url: string; method?: string; body: unknown; authorization: string | null }[] = [];
  const client = createVrdexApiClient({ apiBaseUrl: "http://127.0.0.1/api/v0", bearerToken: "test", outputMode: "compact", fetch: async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({ draftId: "draft", version: 1, fields: { title: "Night" } });
  } });
  assert.equal(typeof client.eventIntake, "function");
  await client.eventIntake("draft_save", { patch: { title: "Night" } });
  await client.eventIntake("draft_get", { draftId: "draft" });
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1/api/v0/event-intake", method: "POST", body: { patch: { title: "Night" } }, authorization: "Bearer test" },
    { url: "http://127.0.0.1/api/v0/event-intake/draft", method: "GET", body: null, authorization: "Bearer test" },
  ]);
  await assert.rejects(client.eventIntake("draft_save", { patch: { title: "Night" }, actorUserId: "forged" }));
});

test("intake client preserves ordered and singular source inputs", async () => {
  const bodies: unknown[] = [];
  const client = createVrdexApiClient({ apiBaseUrl: "http://127.0.0.1/api/v0", bearerToken: "test", outputMode: "compact", fetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(bodies.length === 1 ? { draftId: "draft", version: 2 } : { event: { title: null, communitySlug: null, eventDate: null, start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [], questions: [] });
  } });
  await client.eventIntake("draft_save", { draftId: "draft", expectedVersion: 1, patch: { posterSourceIds: ["a", "b"] } });
  await client.eventIntake("extract", { draftId: "draft", posterAssetId: "a" });
  assert.deepEqual(bodies, [{ draftId: "draft", expectedVersion: 1, patch: { posterSourceIds: ["a", "b"] } }, { posterAssetId: "a" }]);
});

test("poster bridge rejects source URLs and unconfigured upload origins before network access", async () => {
  const client = createVrdexApiClient({ apiBaseUrl: "http://127.0.0.1/api/v0", outputMode: "compact", fetch: async () => { throw new Error("network called"); } });
  assert.equal(typeof client.uploadEventPosterBytes, "function");
  await assert.rejects(client.uploadEventPosterBytes({ draftId: "draft", base64: "https://private.example/poster.png", contentType: "image/png" }), /base64|origin/i);
});

test("poster bytes go only to a pinned HTTPS origin, without bearer headers or redirects", async () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
  let uploadOrigin = "https://other.example";
  let transfers = 0;
  const client = createVrdexApiClient({ apiBaseUrl: "http://127.0.0.1/api/v0", bearerToken: "secret", outputMode: "compact", posterUploadOrigin: "https://storage.example", fetch: async (url, init) => {
    if (String(url).endsWith("/begin")) return Response.json({ posterAssetId: "poster", expiresAt: Date.now()+600000, transfer: { method: "POST", url: uploadOrigin + "/upload", fields: { key: "private-source" }, fileField: "file" } });
    if (String(url).endsWith("/complete")) return Response.json({ posterAssetId: "poster" });
    assert.equal(new URL(String(url)).origin,"https://storage.example");
    assert.equal(new Headers(init?.headers).has("authorization"),false);
    assert.equal(init?.redirect,"error");
    const form=init?.body as FormData;
    assert.ok(form.get("file") instanceof Blob); transfers++; return new Response(null,{status:204});
  } });
  await assert.rejects(client.uploadEventPosterBytes({ draftId:"draft",base64,contentType:"image/png" }),/origin/);
  assert.equal(transfers,0);
  uploadOrigin="https://storage.example";
  const result=await client.uploadEventPosterBytes({ draftId:"draft",base64,contentType:"image/png" });
  assert.deepEqual(result,{ok:true,data:{posterAssetId:"poster"}});assert.equal(transfers,1);
  await assert.rejects(client.uploadEventPosterBytes({ draftId:"draft",base64,contentType:"image/jpeg" }),/type/);
  // Nonzero padding bits decode to the same bytes but are not canonical base64.
  const noncanonical = base64.slice(0, -2) + "J=";
  assert.deepEqual(Buffer.from(noncanonical, "base64"), Buffer.from(base64, "base64"));
  await assert.rejects(client.uploadEventPosterBytes({ draftId:"draft",base64:noncanonical,contentType:"image/png" }),/base64/);
  assert.equal(transfers,1);
});
