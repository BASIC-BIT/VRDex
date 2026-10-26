import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanReference } from "../../convex/_eventTimelineTypes";
import { reducePreferences, type TimelinePreferences } from "../../apps/web/src/lib/timeline/preferences";

const empty = (): TimelinePreferences => ({ version: 1, plan: [], favoriteProfileIds: [] });
const add = (state: TimelinePreferences, reference: PlanReference) => reducePreferences(state, { type: "add-plan", reference });

describe("timeline preferences", () => {
  it("wholeEventReplacesItsSets", () => {
    let state = add(empty(), { kind: "set", eventId: "A", slotId: "first" }).state;
    state = add(state, { kind: "set", eventId: "A", slotId: "second" }).state;
    assert.deepEqual(add(state, { kind: "event", eventId: "A" }).state.plan, [{ kind: "event", eventId: "A" }]);
  });

  it("identifies sets by both stable event and slot IDs", () => {
    let state = add(empty(), { kind: "set", eventId: "A", slotId: "same" }).state;
    state = add(state, { kind: "set", eventId: "B", slotId: "same" }).state;
    const removed = reducePreferences(state, { type: "remove-plan", reference: { kind: "set", eventId: "A", slotId: "same" } });
    assert.deepEqual(removed.state.plan, [{ kind: "set", eventId: "B", slotId: "same" }]);
  });

  it("keeps included sets idempotent and removes a whole event without restoring its sets", () => {
    const state: TimelinePreferences = { ...empty(), plan: [{ kind: "event", eventId: "A" }] };
    for (const reference of [{ kind: "event", eventId: "A" }, { kind: "set", eventId: "A", slotId: "one" }] satisfies PlanReference[]) {
      const result = add(state, reference);
      assert.equal(result.outcome, "unchanged");
      assert.equal(result.state, state);
    }
    assert.equal(reducePreferences(state, { type: "remove-plan", reference: { kind: "set", eventId: "A", slotId: "one" } }).state, state);
    assert.deepEqual(reducePreferences(state, { type: "remove-plan", reference: { kind: "event", eventId: "A" } }).state.plan, []);
  });

  it("preserves independent potentially overlapping choices without display content", () => {
    const reference = { kind: "set", eventId: "A", slotId: "one", title: "Never persist", startAt: 123, grant: "private" } satisfies PlanReference & { title: string; startAt: number; grant: string };
    let state = add(empty(), reference).state;
    state = add(state, { kind: "event", eventId: "B" }).state;
    assert.deepEqual(state.plan, [{ kind: "set", eventId: "A", slotId: "one" }, { kind: "event", eventId: "B" }]);
    assert.equal(JSON.stringify(state).includes("Never persist"), false);
  });

  it("fullPlanRejectsOnlyAdditions", () => {
    const state: TimelinePreferences = { ...empty(), plan: Array.from({ length: 200 }, (_, index) => ({ kind: "event", eventId: String(index) })) };
    const result = add(state, { kind: "event", eventId: "new" });
    assert.equal(result.outcome, "limit");
    assert.equal(result.state, state);
    const removed = reducePreferences(state, { type: "remove-plan", reference: { kind: "event", eventId: "0" } });
    assert.equal(removed.outcome, "changed");
    assert.equal(removed.state.plan.length, 199);
    assert.equal(add(state, { kind: "event", eventId: "0" }).outcome, "unchanged");
  });

  it("allows whole-event replacement at the plan cap", () => {
    const state: TimelinePreferences = { ...empty(), plan: [{ kind: "set", eventId: "A", slotId: "one" }, ...Array.from({ length: 199 }, (_, index): PlanReference => ({ kind: "event", eventId: String(index) }))] };
    const result = add(state, { kind: "event", eventId: "A" });
    assert.equal(result.outcome, "changed");
    assert.equal(result.state.plan.length, 200);
    assert.equal(result.state.plan.some((reference) => reference.kind === "set"), false);
  });

  it("bounds favorites at 500 without blocking idempotence or removal", () => {
    const state: TimelinePreferences = { ...empty(), favoriteProfileIds: Array.from({ length: 500 }, (_, index) => String(index)) };
    assert.deepEqual(reducePreferences(state, { type: "add-favorite", profileId: "new" }), { state, outcome: "limit" });
    assert.equal(reducePreferences(state, { type: "add-favorite", profileId: "0" }).state, state);
    const result = reducePreferences(state, { type: "remove-favorite", profileId: "0" });
    assert.equal(result.outcome, "changed");
    assert.equal(result.state.favoriteProfileIds.length, 499);
    assert.equal(reducePreferences(result.state, { type: "remove-favorite", profileId: "0" }).state, result.state);
  });

  it("adds and removes favorites independently from the plan", () => {
    const state = add(empty(), { kind: "event", eventId: "A" }).state;
    const result = reducePreferences(state, { type: "add-favorite", profileId: "person" });
    assert.deepEqual(result.state.favoriteProfileIds, ["person"]);
    assert.equal(result.state.plan, state.plan);
    assert.deepEqual(reducePreferences(result.state, { type: "remove-favorite", profileId: "person" }).state, state);
  });
});
