import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { carriedFields, carriedFieldsHash, requireConnectorAuthority, sha256Hex } from "../../convex/_eventConnectors";
import { connectorFixture } from "./_eventConnectorFixture";

it("hashes with standard SHA-256", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const text of ["", "x".repeat(55), "x".repeat(56), "x".repeat(64), "héllo 🎧".repeat(40)]) assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"));
});

it("google calendar carries exactly its schedule, summary, and venue fields", () => {
  assert.deepEqual([...carriedFields("google_calendar")].sort(), ["end", "eventDate", "start", "summary", "timeTba", "timezone", "title", "venueLabel"]);
  assert.equal(carriedFields("vrchat_calendar").includes("venueLabel"), false);
  assert.equal(carriedFields("notion").length, 0);
});

it("carried hash is stable across key order and zero day offsets and ignores uncarried fields", () => {
  const base = { title: "Night Flight", eventDate: "2027-02-12", timezone: "UTC", start: { time: "20:00", dayOffset: 0 }, venueLabel: "Main room" };
  const same = { venueLabel: "Main room ", start: { time: "20:00" }, timezone: "UTC", eventDate: "2027-02-12", title: "Night Flight", worldSlug: "elsewhere", summary: null };
  assert.equal(carriedFieldsHash("google_calendar", base), carriedFieldsHash("google_calendar", same));
  assert.notEqual(carriedFieldsHash("google_calendar", base), carriedFieldsHash("google_calendar", { ...base, title: "Other" }));
  assert.equal(carriedFieldsHash("vrchat_calendar", base), carriedFieldsHash("vrchat_calendar", { ...base, venueLabel: "Changed" }));
});

it("date-only fields hash without their time and timezone", () => {
  const dated = { title: "All Day", eventDate: "2027-05-01", timeTba: true };
  assert.equal(carriedFieldsHash("google_calendar", { ...dated, timezone: "UTC", start: { time: "20:00" } }), carriedFieldsHash("google_calendar", { ...dated, timezone: "", start: null }));
  assert.notEqual(carriedFieldsHash("google_calendar", dated), carriedFieldsHash("google_calendar", { ...dated, timeTba: false, timezone: "UTC", start: { time: "20:00" } }));
});

it("connector authority admits owner, super admin, and manage_integrations staff only", async () => {
  const f = await connectorFixture();
  const check = (userId: typeof f.users.owner) => f.t.run(ctx => requireConnectorAuthority(ctx, f.communityProfileId, userId));
  for (const userId of [f.users.owner, f.users.admin, f.users.integrator]) await check(userId);
  for (const userId of [f.users.eventStaff, f.users.outsider]) await assert.rejects(check(userId), /CONNECTOR_FORBIDDEN/);
  await f.t.run(ctx => ctx.db.patch(f.integratorGrant, { state: "revoked", revokedAt: Date.now() }));
  await assert.rejects(check(f.users.integrator), /CONNECTOR_FORBIDDEN/);
});
