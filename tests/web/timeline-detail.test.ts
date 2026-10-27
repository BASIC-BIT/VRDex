import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createEventDetailController,
  type CanonicalEvent,
  type DetailObserver,
} from "../../apps/web/src/lib/timeline/event-detail";
const event = (slug: string): CanonicalEvent => ({
  id: slug,
  slug,
  title: slug,
  status: "scheduled",
  startAt: 1,
  watchSurfaceEnabled: false,
  source: { sourceType: "community", label: "Fixture" },
  worlds: [],
  participants: [],
  slots: [],
  lineup: [],
  authoredMediaLinks: [],
  mediaLinks: [],
  participantCount: 0,
  slotCount: 0,
});
function setup() {
  const pending: DetailObserver[] = [];
  let stopped = 0;
  const controller = createEventDetailController((_slug, observer) => {
    pending.push(observer);
    return () => {
      stopped++;
    };
  });
  return { controller, pending, stopped: () => stopped };
}
it("A selected, B selected, A finishes cannot expose A", () => {
  const { controller, pending, stopped } = setup();
  controller.select("a");
  controller.select("b");
  pending[1].value(event("b"));
  pending[0].value(event("a"));
  const state = controller.getSnapshot();
  assert.equal(state.kind, "available");
  if (state.kind === "available") assert.equal(state.event.slug, "b");
  assert.equal(stopped(), 1);
});
it("revocation erases previously available metadata", () => {
  const { controller, pending } = setup();
  controller.select("a");
  pending[0].value(event("a"));
  pending[0].value(null);
  assert.deepEqual(controller.getSnapshot(), {
    kind: "unavailable",
    slug: "a",
  });
});
it("transient errors are distinct and retry creates a new read", () => {
  const { controller, pending } = setup();
  controller.select("a");
  pending[0].error(Error("offline"));
  assert.equal(controller.getSnapshot().kind, "error");
  controller.retry();
  assert.equal(controller.getSnapshot().kind, "loading");
  pending[0].value(null);
  assert.equal(controller.getSnapshot().kind, "loading");
  pending[1].value(event("a"));
  assert.equal(controller.getSnapshot().kind, "available");
});
it("same-event slot changes keep the detail subscription and available event", () => {
  const { controller, pending } = setup();
  controller.select("a");
  pending[0].value(event("a"));
  const before = controller.getSnapshot();
  controller.select("a");
  assert.equal(pending.length, 1);
  assert.equal(controller.getSnapshot(), before);
});
it("closing during a pending read drops all stale results", () => {
  const { controller, pending, stopped } = setup();
  controller.select("a");
  controller.select(null);
  pending[0].value(event("a"));
  pending[0].error(Error("late"));
  assert.deepEqual(controller.getSnapshot(), { kind: "loading", slug: null });
  assert.equal(stopped(), 1);
});

import {
  createDetailRosterController,
  detailRows,
} from "../../apps/web/src/lib/timeline/detail-roster";
import type { TimelineRosterPage } from "../../convex/_eventTimelineTypes";
const rosterPage = (
  key: string,
  cursor: string | null = null,
): TimelineRosterPage => ({
  items: [],
  performers: [],
  cursor,
  complete: cursor === null,
  detail: {
    kind: "available",
    rows: [{ kind: "lineup", key, position: 0, displayLabel: key }],
  },
});
it("roster ignores superseded reads and erases content on unavailable", async () => {
  const pending: Array<(p: TimelineRosterPage) => void> = [];
  const c = createDetailRosterController(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const a = c.select("a"),
    b = c.select("b");
  pending[1](rosterPage("b"));
  await b;
  pending[0](rosterPage("a"));
  await a;
  const state = c.getSnapshot();
  assert.equal(state.kind, "available");
  if (state.kind === "available") assert.equal(state.rows[0].key, "b");
  const refresh = c.refresh();
  pending[2]({
    items: [],
    performers: [],
    cursor: null,
    complete: true,
    detail: { kind: "unavailable" },
  });
  await refresh;
  assert.deepEqual(c.getSnapshot(), { kind: "unavailable", eventId: "b" });
});
it("roster bounds automatic requests and More resumes exact cursor", async () => {
  let calls = 0;
  const c = createDetailRosterController(async ({ cursor }) => {
    assert.equal(cursor, calls === 0 ? undefined : String(calls));
    calls++;
    return rosterPage(String(calls), calls < 11 ? String(calls) : null);
  });
  await c.select("a");
  assert.equal(calls, 10);
  const partial = c.getSnapshot();
  assert.equal(partial.kind, "available");
  if (partial.kind === "available") assert.equal(partial.complete, false);
  await c.more();
  assert.equal(calls, 11);
  const done = c.getSnapshot();
  if (done.kind === "available") assert.equal(done.rows.length, 11);
});
it("authored entries stay intact while participant-only fallbacks deduplicate by eligible ID", () => {
  const person = { id: "p", slug: "p", displayName: "P" };
  const rows = detailRows([
    {
      kind: "participant",
      key: "participant",
      position: 0,
      displayLabel: "P",
      performer: person,
    },
    {
      kind: "slot",
      key: "slot",
      position: 2,
      displayLabel: "Set",
      performer: person,
    },
    { kind: "lineup", key: "manual", position: 1, displayLabel: "Manual" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.key),
    ["manual", "slot"],
  );
});
it("disposed subscription can remount the same event", () => {
  const { controller, pending } = setup();
  controller.select("a");
  controller.dispose();
  controller.select("a");
  assert.equal(pending.length, 2);
});
it("closing during pending roster read rejects its eventual metadata", async () => {
  let finish: (page: TimelineRosterPage) => void = () => {};
  const c = createDetailRosterController(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = c.select("a");
  await c.select(null);
  finish(rosterPage("secret"));
  await read;
  assert.deepEqual(c.getSnapshot(), { kind: "loading", eventId: null });
});
it("partial roster failure retains explicit incompleteness and Retry starts clean", async () => {
  let fail = true;
  const c = createDetailRosterController(async ({ cursor }) => {
    if (!cursor) return rosterPage("a", "next");
    if (fail) throw Error("offline");
    return rosterPage("b");
  });
  await c.select("a");
  const partial = c.getSnapshot();
  assert.equal(partial.kind, "available");
  if (partial.kind === "available") {
    assert.equal(partial.failed, true);
    assert.equal(partial.complete, false);
    assert.equal(partial.rows.length, 1);
  }
  fail = false;
  await c.refresh();
  const ready = c.getSnapshot();
  assert.equal(ready.kind, "available");
  if (ready.kind === "available") {
    assert.equal(ready.complete, true);
    assert.equal(ready.failed, false);
    assert.equal(ready.rows.length, 2);
  }
});

import { createSelectedSetController } from "../../apps/web/src/lib/timeline/selected-set";
import type { SavedResolution } from "../../convex/_eventTimelineTypes";
const selectedReference = {
  kind: "set",
  eventId: "event",
  slotId: "slot-801",
} as const;
const selectedResult = (reference = selectedReference): SavedResolution[] => [
  {
    kind: "available",
    reference,
    status: "scheduled",
    event: {
      id: reference.eventId,
      slug: "night",
      title: "Night",
      status: "scheduled",
      schedule: { kind: "timed", startAt: 1, endAt: 2 },
    },
    slot: {
      id: reference.slotId,
      eventId: reference.eventId,
      displayLabel: "Later set",
      schedule: { kind: "timed", startAt: 1, endAt: 2 },
    },
  },
];
it("failed selected read beyond automatic roster budget retries independently of usable lineup", async () => {
  let pages = 0,
    reads = 0;
  const roster = createDetailRosterController(async () =>
    rosterPage(String(++pages), String(pages)),
  );
  await roster.select("event");
  const lineup = roster.getSnapshot();
  assert.equal(pages, 10);
  const selected = createSelectedSetController(async () => {
    if (++reads === 1) throw Error("transport failed");
    return selectedResult();
  });
  await selected.select(selectedReference);
  assert.equal(selected.getSnapshot().kind, "error");
  assert.equal("row" in selected.getSnapshot(), false);
  await selected.retry();
  const ready = selected.getSnapshot();
  assert.equal(ready.kind, "available");
  if (ready.kind === "available") assert.equal(ready.row.key, "slot-801");
  assert.equal(reads, 2);
  assert.equal(pages, 10);
  assert.equal(roster.getSnapshot(), lineup);
});
it("selected failure clears prior metadata while unavailable remains distinct", async () => {
  let mode = "available";
  const selected = createSelectedSetController(async () => {
    if (mode === "error") throw Error("offline");
    return mode === "available"
      ? selectedResult()
      : [{ kind: "unavailable", reference: selectedReference }];
  });
  await selected.select(selectedReference);
  assert.equal(selected.getSnapshot().kind, "available");
  mode = "error";
  await selected.retry();
  assert.equal(selected.getSnapshot().kind, "error");
  assert.equal("row" in selected.getSnapshot(), false);
  mode = "unavailable";
  await selected.retry();
  assert.equal(selected.getSnapshot().kind, "unavailable");
  assert.equal("row" in selected.getSnapshot(), false);
});
it("selected retries ignore stale selections and close during pending resolution", async () => {
  const pending: Array<{
    resolve(value: SavedResolution[]): void;
    reject(error: unknown): void;
  }> = [];
  const selected = createSelectedSetController(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  );
  const first = selected.select(selectedReference);
  const second = selected.select({ ...selectedReference, slotId: "other" });
  pending[0].reject(Error("stale"));
  await first;
  assert.equal(selected.getSnapshot().kind, "loading");
  await selected.select(null);
  pending[1].resolve(selectedResult());
  await second;
  assert.deepEqual(selected.getSnapshot(), { kind: "idle" });
});
it("disposed selected read never publishes its delayed successful metadata", async () => {
  let resolve: (value: SavedResolution[]) => void = () => {};
  const selected = createSelectedSetController(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  let publications = 0;
  selected.subscribe(() => {
    publications++;
  });
  const pending = selected.select(selectedReference);
  assert.equal(publications, 1);
  selected.dispose();
  resolve(selectedResult());
  await pending;
  assert.equal(publications, 1);
  assert.equal("row" in selected.getSnapshot(), false);
});
