import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createTimelineController,
  windowsForRange,
} from "../../apps/web/src/lib/timeline/window-cache";
import type {
  TimelineEvent,
  TimelinePage,
  TimelineRange,
  TimelineRosterPage,
} from "../../convex/_eventTimelineTypes";
const h = 3_600_000;
const range = { startAt: 12 * h, endAt: 20 * h, timeZone: "UTC" };
const event = (id: string): TimelineEvent => ({
  id,
  slug: id,
  title: id,
  status: "scheduled",
  schedule: { kind: "timed", startAt: 13 * h, endAt: 15 * h },
  slots: [],
  performers: [],
  rosterCursor: null,
});
const page = (items: TimelineEvent[] = []): TimelinePage => ({
  items,
  cursor: null,
  complete: true,
});
const transport = (
  list: (args: {
    range: TimelineRange;
    cursor?: string;
    limit: number;
  }) => Promise<TimelinePage>,
) => ({
  list,
  roster: async () => ({
    items: [],
    performers: [],
    cursor: null,
    complete: true,
  }),
  resolve: async () => [],
});
it("prefetches 48-hour windows only within six hours and bounds to three", () => {
  assert.deepEqual(
    windowsForRange(range).map((r) => [r.startAt / h, r.endAt / h]),
    [[0, 48]],
  );
  assert.deepEqual(
    windowsForRange({ ...range, startAt: 43 * h, endAt: 50 * h }).map(
      (r) => r.startAt / h,
    ),
    [0, 48],
  );
  assert.deepEqual(
    windowsForRange({ ...range, startAt: 3 * h, endAt: 45 * h }).map(
      (r) => r.startAt / h,
    ),
    [0, -48, 48],
  );
});
it("discards out-of-order obsolete generations including filter changes", async () => {
  const pending: Array<(value: TimelinePage) => void> = [];
  const c = createTimelineController(
    transport(() => new Promise((resolve) => pending.push(resolve))),
  );
  const first = c.setViewport(range, false, []);
  const second = c.setViewport(range, true, ["club"]);
  pending[1](
    page([
      {
        ...event("new"),
        host: { id: "club", slug: "club", displayName: "Club" },
      },
    ]),
  );
  await second;
  pending[0](page([event("old")]));
  await first;
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["new"],
  );
  assert.equal(c.getSnapshot().kind, "ready");
});
it("retains partial after ten empty candidates, More resumes cursor and finds later favorites", async () => {
  const cursors: Array<string | undefined> = [];
  const c = createTimelineController(
    transport(async ({ cursor, limit }) => {
      assert.equal(limit, 50);
      cursors.push(cursor);
      const n = Number(cursor ?? 0);
      return n < 10
        ? { items: [], cursor: String(n + 1), complete: false }
        : page([
            {
              ...event("later"),
              host: { id: "fav", slug: "fav", displayName: "Favorite" },
            },
          ]);
    }),
  );
  await c.setViewport(range, true, ["fav"]);
  assert.equal(c.getSnapshot().kind, "partial");
  assert.equal(c.getSnapshot().records.length, 0);
  assert.equal(cursors.length, 10);
  await c.loadMore();
  assert.equal(cursors.at(-1), "10");
  assert.equal(c.getSnapshot().kind, "ready");
  assert.equal(c.getSnapshot().records[0]?.id, "later");
});
it("drains empty roster phases and deduplicates untimed favorite performers", async () => {
  const pending = Promise.withResolvers<TimelineRosterPage>();
  const started = Promise.withResolvers<void>();
  const c = createTimelineController({
    ...transport(async () => page([{ ...event("e"), rosterCursor: "slots" }])),
    roster: async ({ cursor }: { cursor?: string }) => {
      if (cursor === "slots")
        return {
          items: [],
          performers: [],
          cursor: "participants",
          complete: false,
        };
      started.resolve();
      return pending.promise;
    },
  });
  const loading = c.setViewport(range, true, ["fav"]);
  await started.promise;
  assert.equal(c.getSnapshot().kind, "loading");
  assert.equal(c.getSnapshot().slotCoverage.e, "partial");
  assert.deepEqual(c.getSnapshot().records, []);
  pending.resolve({
    items: [],
    performers: [
      { id: "fav", slug: "fav", displayName: "Untimed DJ" },
      { id: "fav", slug: "fav", displayName: "Untimed DJ" },
    ],
    cursor: null,
    complete: true,
  });
  await loading;
  assert.equal(c.getSnapshot().kind, "ready");
  assert.equal(c.getSnapshot().records[0]?.performers.length, 1);
  assert.equal(c.getSnapshot().slotCoverage.e, "complete");
});
it("incomplete roster never becomes an empty ready result and More drains it", async () => {
  const c = createTimelineController({
    ...transport(async () => page([{ ...event("e"), rosterCursor: "0" }])),
    roster: async ({ cursor }: { cursor?: string }) => {
      const n = Number(cursor);
      return n < 12
        ? { items: [], performers: [], cursor: String(n + 1), complete: false }
        : {
            items: [],
            performers: [{ id: "f", slug: "f", displayName: "F" }],
            cursor: null,
            complete: true,
          };
    },
  });
  await c.setViewport(range, true, ["f"]);
  assert.equal(c.getSnapshot().kind, "partial");
  await c.loadMore();
  assert.equal(c.getSnapshot().kind, "ready");
  assert.equal(c.getSnapshot().records.length, 1);
});
it("retry restarts failed reads without duplicating records", async () => {
  let failed = false;
  const c = createTimelineController(
    transport(async ({ cursor }) => {
      if (!cursor)
        return { items: [event("e")], cursor: "next", complete: false };
      if (!failed) {
        failed = true;
        throw Error("offline");
      }
      return page([event("e")]);
    }),
  );
  await c.setViewport(range, false, []);
  assert.equal(c.getSnapshot().kind, "error");
  assert.equal(c.getSnapshot().records.length, 1);
  await c.retry();
  assert.equal(c.getSnapshot().kind, "ready");
  assert.equal(c.getSnapshot().records.length, 1);
});
it("evicts distant windows and refresh rechecks current data", async () => {
  let calls = 0;
  const c = createTimelineController(
    transport(async () => {
      calls++;
      return page();
    }),
  );
  for (let i = 0; i < 4; i++)
    await c.setViewport(
      { ...range, startAt: (12 + 48 * i) * h, endAt: (20 + 48 * i) * h },
      false,
      [],
    );
  const before = calls;
  await c.setViewport({ ...range, startAt: 60 * h, endAt: 68 * h }, false, []);
  assert.equal(calls, before, "the other retained window is reused");
  await c.setViewport(range, false, []);
  assert.equal(calls, before + 1);
  await c.refresh();
  assert.equal(calls, before + 2);
});
it("resolves references in batches of 50", async () => {
  const batches: number[] = [];
  const c = createTimelineController({
    ...transport(async () => page()),
    resolve: async ({
      references,
    }: {
      references: Array<
        | { kind: "event"; eventId: string }
        | { kind: "set"; eventId: string; slotId: string }
      >;
    }) => {
      batches.push(references.length);
      return references.map((reference) => ({
        reference,
        kind: "unavailable" as const,
      }));
    },
  });
  await c.setPlan(
    Array.from({ length: 111 }, (_, i) => ({
      kind: "event",
      eventId: String(i),
    })),
  );
  assert.deepEqual(batches, [50, 50, 11]);
  assert.equal(c.getSnapshot().saved.length, 111);
});

it("saved resolution ignores a late prior plan and retry recovers a failed saved read", async () => {
  let release:
    | ((
        value: Array<{
          reference: { kind: "event"; eventId: string };
          kind: "unavailable";
        }>,
      ) => void)
    | undefined;
  let fail = true;
  const c = createTimelineController({
    ...transport(async () => page()),
    resolve: async ({ references }) => {
      if (references[0]?.eventId === "old")
        return new Promise((resolve) => {
          release = resolve;
        });
      if (fail) {
        fail = false;
        throw Error("offline");
      }
      return references.map((reference) => ({
        reference,
        kind: "unavailable" as const,
      }));
    },
  });
  const old = c.setPlan([{ kind: "event", eventId: "old" }]);
  await c.setPlan([{ kind: "event", eventId: "new" }]);
  assert.equal(c.getSnapshot().savedState, "error");
  await c.retry();
  release?.([
    { reference: { kind: "event", eventId: "old" }, kind: "unavailable" },
  ]);
  await old;
  assert.equal(c.getSnapshot().savedState, "ready");
  assert.equal(c.getSnapshot().saved[0]?.reference.eventId, "new");
});

it("refresh retains ongoing records through early pages and drops revoked records only on complete coverage", async () => {
  let refresh = false;
  const c = createTimelineController(
    transport(async ({ cursor }) =>
      !refresh
        ? page([event("ongoing"), event("revoked")])
        : !cursor
          ? { items: [event("new")], cursor: "ongoing-phase", complete: false }
          : page([event("ongoing")]),
    ),
  );
  await c.setViewport(range, false, []);
  const snapshots: Array<{ kind: string; ids: string[] }> = [];
  c.subscribe(() =>
    snapshots.push({
      kind: c.getSnapshot().kind,
      ids: c.getSnapshot().records.map((e) => e.id),
    }),
  );
  refresh = true;
  await c.refresh();
  assert.ok(
    snapshots
      .filter((s) => s.kind === "loading")
      .every((s) => s.ids.includes("ongoing")),
  );
  assert.equal(c.getSnapshot().kind, "ready");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["new", "ongoing"],
  );
});

it("a failed refresh keeps prior records with error until retry finishes fresh coverage", async () => {
  let phase: "initial" | "failed" | "ready" = "initial";
  const c = createTimelineController(
    transport(async () => {
      if (phase === "failed") throw Error("offline");
      return phase === "initial"
        ? page([event("old")])
        : page([event("fresh")]);
    }),
  );
  await c.setViewport(range, false, []);
  phase = "failed";
  await c.refresh();
  assert.equal(c.getSnapshot().kind, "error");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["old"],
  );
  phase = "ready";
  await c.retry();
  assert.equal(c.getSnapshot().kind, "ready");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["fresh"],
  );
});

it("expired favorite/filter reads retain readable matching records on failure", async (t) => {
  let now = 1_000,
    fail = false;
  t.mock.method(Date, "now", () => now);
  const a = {
    ...event("a"),
    host: { id: "first", slug: "first", displayName: "First" },
  };
  const b = {
    ...event("b"),
    host: { id: "second", slug: "second", displayName: "Second" },
  };
  const c = createTimelineController(
    transport(async () => {
      if (fail) throw Error("offline");
      return page([a, b]);
    }),
  );
  await c.setViewport(range, true, ["first"]);
  now += 60_001;
  fail = true;
  await c.setViewport(range, true, ["second"]);
  assert.equal(c.getSnapshot().kind, "error");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["b"],
  );
  fail = false;
  await c.retry();
  assert.equal(c.getSnapshot().kind, "ready");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["b"],
  );
});

it("cache hits do not renew expiry and a timestamp of zero can expire", async (t) => {
  let now = 0,
    calls = 0,
    fail = false;
  t.mock.method(Date, "now", () => now);
  const c = createTimelineController(
    transport(async () => {
      calls++;
      if (fail) throw Error("offline");
      return page([event("readable")]);
    }),
  );
  await c.setViewport(range, false, []);
  now = 30_000;
  await c.setViewport(range, false, ["new-favorite"]);
  assert.equal(calls, 1);
  now = 60_001;
  fail = true;
  await c.setViewport(range, false, ["another-favorite"]);
  assert.equal(calls, 2);
  assert.equal(c.getSnapshot().kind, "error");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["readable"],
  );
});

it("a filter/navigation update superseding refresh preserves the readable window and discards its late response", async () => {
  let mode: "initial" | "pending" | "failed" = "initial";
  let release: ((value: TimelinePage) => void) | undefined;
  const a = {
    ...event("a"),
    host: { id: "first", slug: "first", displayName: "First" },
  };
  const b = {
    ...event("b"),
    host: { id: "second", slug: "second", displayName: "Second" },
  };
  const c = createTimelineController(
    transport(async () => {
      if (mode === "initial") return page([a, b]);
      if (mode === "failed") throw Error("offline");
      return new Promise((resolve) => {
        release = resolve;
      });
    }),
  );
  await c.setViewport(range, true, ["first"]);
  mode = "pending";
  const refresh = c.refresh();
  mode = "failed";
  await c.setViewport({ ...range, startAt: 13 * h, endAt: 21 * h }, true, [
    "second",
  ]);
  release?.(page([event("obsolete")]));
  await refresh;
  assert.equal(c.getSnapshot().kind, "error");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["b"],
  );
});

it("expired partial replacement stays readable through More and drops revoked records only at completion", async (t) => {
  let now = 1_000,
    expired = false;
  t.mock.method(Date, "now", () => now);
  const c = createTimelineController(
    transport(async ({ cursor }) =>
      !expired
        ? page([event("old")])
        : Number(cursor ?? 0) < 10
          ? {
              items: [],
              cursor: String(Number(cursor ?? 0) + 1),
              complete: false,
            }
          : page([event("fresh")]),
    ),
  );
  await c.setViewport(range, false, []);
  now += 60_001;
  expired = true;
  await c.setViewport(range, false, ["changed"]);
  assert.equal(c.getSnapshot().kind, "partial");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["old"],
  );
  await c.loadMore();
  assert.equal(c.getSnapshot().kind, "ready");
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["fresh"],
  );
});

it("published event lanes remain frozen when crossing the six-hour prefetch threshold", async () => {
  const earlier = {
    ...event("earlier"),
    schedule: { kind: "timed" as const, startAt: -4 * h, endAt: -h },
  };
  const ongoing = {
    ...event("ongoing"),
    schedule: { kind: "timed" as const, startAt: -2 * h, endAt: 20 * h },
  };
  const c = createTimelineController(
    transport(async ({ range }) =>
      page(range.startAt < 0 ? [earlier, ongoing] : [ongoing]),
    ),
  );
  await c.setViewport({ ...range, startAt: 3 * h, endAt: 11 * h }, false, []);
  assert.equal(
    c.getSnapshot().eventLanes.find((l) => l.eventId === "ongoing")?.lane,
    1,
  );
  await c.setViewport({ ...range, startAt: 7 * h, endAt: 15 * h }, false, []);
  assert.deepEqual(
    c.getSnapshot().records.map((e) => e.id),
    ["ongoing"],
  );
  assert.equal(
    c.getSnapshot().eventLanes.find((l) => l.eventId === "ongoing")?.lane,
    1,
  );
  await c.setViewport({ ...range, startAt: 3 * h, endAt: 11 * h }, false, []);
  assert.equal(
    c.getSnapshot().eventLanes.find((l) => l.eventId === "ongoing")?.lane,
    1,
  );
});

it("including an earlier prefetch window does not repack an established ongoing row", async () => {
  const earlier = {
    ...event("earlier"),
    schedule: { kind: "timed" as const, startAt: -4 * h, endAt: -h },
  };
  const ongoing = {
    ...event("ongoing"),
    schedule: { kind: "timed" as const, startAt: -2 * h, endAt: 20 * h },
  };
  const c = createTimelineController(
    transport(async ({ range }) =>
      page(range.startAt < 0 ? [earlier, ongoing] : [ongoing]),
    ),
  );
  await c.setViewport({ ...range, startAt: 7 * h, endAt: 15 * h }, false, []);
  assert.equal(
    c.getSnapshot().eventLanes.find((l) => l.eventId === "ongoing")?.lane,
    0,
  );
  await c.setViewport({ ...range, startAt: 3 * h, endAt: 11 * h }, false, []);
  assert.equal(
    c.getSnapshot().eventLanes.find((l) => l.eventId === "ongoing")?.lane,
    0,
  );
});
