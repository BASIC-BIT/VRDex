import assert from "node:assert/strict";
import { it } from "node:test";
import { apiScopes, normalizeDynamicMcpClientRegistration } from "../src/index";
import { EventIntakePatchSchema, SaveEventIntakeDraftSchema, PublishEventIntakeSchema, resolveEventLocalTime, selectEventLocalTime } from "../src/event-intake";

it("offers event contribution as an explicit OAuth grant", () => {
  assert.ok((apiScopes as readonly string[]).includes("events:contribute"));
  for (const scope of ["mcp:read events:contribute", "mcp:write events:contribute"]) {
    const client = normalizeDynamicMcpClientRegistration({ client_name: "Intake", redirect_uris: ["http://127.0.0.1/callback"], scope });
    assert.ok(client.allowedScopes.includes("events:contribute"));
    assert.ok(!client.allowedScopes.includes("events:write"));
  }
});

it("accepts poster-only, partial and explicit clearing patches", () => {
  assert.deepEqual(EventIntakePatchSchema.parse({ posterSourceId: "private-source" }), { posterSourceId: "private-source" });
  assert.deepEqual(EventIntakePatchSchema.parse({ title: null, summary: "" }), { title: null, summary: "" });
  assert.ok(SaveEventIntakeDraftSchema.safeParse({ patch: { title: "Night" } }).success);
});
it("resolves normal times, DST gaps and repeated hours without silently choosing", () => {
  assert.deepEqual(resolveEventLocalTime("2027-03-14", { time: "02:30" }, "America/New_York"), []);
  assert.deepEqual(resolveEventLocalTime("2027-11-07", { time: "01:30" }, "America/New_York"), [Date.parse("2027-11-07T05:30:00Z"), Date.parse("2027-11-07T06:30:00Z")]);
  assert.throws(() => selectEventLocalTime("2027-11-07", { time: "01:30" }, "America/New_York"), /Ambiguous/);
  assert.equal(selectEventLocalTime("2027-11-07", { time: "01:30", occurrence: "later" }, "America/New_York"), Date.parse("2027-11-07T06:30:00Z"));
  assert.equal(selectEventLocalTime("2027-10-15", { time: "18:00" }, "UTC"), Date.parse("2027-10-15T18:00:00Z"));
});
it("excludes actor, trusted provenance and live controls", () => {
  for (const key of ["actorUserId", "sourceType", "ownerConfirmed", "watchMode", "selectedStreamId", "posterImageUrl"])
    assert.equal(EventIntakePatchSchema.safeParse({ [key]: "forged" }).success, false);
  assert.equal(EventIntakePatchSchema.safeParse({ lineup: [{ clientKey: "x", position: 0, selectedStreamId: "x" }] }).success, false);
});
it("requires current version and bounded idempotency for publish", () => {
  assert.ok(PublishEventIntakeSchema.safeParse({ draftId: "draft", expectedVersion: 1, idempotencyKey: "publish-1" }).success);
  assert.equal(PublishEventIntakeSchema.safeParse({ draftId: "draft", expectedVersion: 0, idempotencyKey: "" }).success, false);
});
