import assert from "node:assert/strict";
import { test } from "node:test";
import { directionOptions, primaryFirst, syncedLabel, STATE_LABELS, DIRECTION_HELP } from "../../apps/web/src/app/account/communities/[slug]/club-integrations-model";

const NOW = Date.UTC(2027, 0, 10, 12);
test("synced label uses relative time", () => {
  assert.equal(syncedLabel(undefined, NOW), null);
  assert.equal(syncedLabel(NOW - 30_000, NOW), "Synced now");
  assert.equal(syncedLabel(NOW - 5 * 60_000, NOW), "Synced 5 minutes ago");
  assert.equal(syncedLabel(NOW - 3 * 3_600_000, NOW), "Synced 3 hours ago");
  assert.equal(syncedLabel(NOW - 2 * 86_400_000, NOW), "Synced 2 days ago");
});
test("direction options follow the kind's allowed directions", () => {
  assert.deepEqual(directionOptions("discord_board").map(o => o.label), ["Export", "Off"]);
  assert.deepEqual(directionOptions("google_calendar").map(o => o.label), ["Import", "Export", "Both", "Off"]);
});
test("approved copy is verbatim", () => {
  assert.deepEqual(STATE_LABELS, { active: "Active", paused: "Paused", needs_reauth: "Needs reconnecting" });
  assert.equal(DIRECTION_HELP.bidirectional, "Changes on either side reach the other.");
});
test("the primary Google calendar comes first, the rest keep their order", () => {
  const calendars = [{ id: "a", summary: "A" }, { id: "b", summary: "B" }, { id: "me", summary: "Me", primary: true }, { id: "c", summary: "C" }];
  assert.deepEqual(primaryFirst(calendars).map(c => c.id), ["me", "a", "b", "c"]);
});
