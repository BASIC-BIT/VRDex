import assert from "node:assert/strict";
import { it } from "node:test";
import type { PlanReference } from "../../convex/_eventTimelineTypes";
import {
  planSaveState,
  togglePlanAction,
} from "../../apps/web/src/lib/timeline/plan-actions";
import { reducePreferences } from "../../apps/web/src/lib/timeline/preferences";
it("included set actions cannot remove a whole-event save, while explicit event removal works", () => {
  const whole: PlanReference = { kind: "event", eventId: "night" };
  const set: PlanReference = {
    kind: "set",
    eventId: "night",
    slotId: "aurora",
  };
  const preferences = {
    version: 1 as const,
    plan: [whole],
    favoriteProfileIds: [],
  };
  assert.equal(planSaveState(preferences.plan, set), "included");
  assert.equal(togglePlanAction(preferences.plan, set), null);
  assert.equal(planSaveState(preferences.plan, whole), "saved");
  const remove = togglePlanAction(preferences.plan, whole);
  assert.deepEqual(remove, { type: "remove-plan", reference: whole });
  assert.deepEqual(
    remove && reducePreferences(preferences, remove).state.plan,
    [],
  );
});
it("individual saves remain removable and another event's whole save cannot include a set", () => {
  const set: PlanReference = {
    kind: "set",
    eventId: "night",
    slotId: "aurora",
  };
  assert.equal(planSaveState([set], set), "saved");
  assert.deepEqual(togglePlanAction([set], set), {
    type: "remove-plan",
    reference: set,
  });
  const other: PlanReference = { kind: "event", eventId: "other" };
  assert.equal(planSaveState([other], set), "unsaved");
  assert.deepEqual(togglePlanAction([other], set), {
    type: "add-plan",
    reference: set,
  });
  assert.equal(
    planSaveState([set], {
      kind: "set",
      eventId: "night",
      slotId: "different",
    }),
    "unsaved",
  );
});
