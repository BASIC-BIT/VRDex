import type {
  PlanReference,
  SavedResolution,
  TimelineEvent,
  TimelinePage,
  TimelineRange,
  TimelineRosterPage,
} from "../../../../../convex/_eventTimelineTypes";
import { reconcileEventLanes, type EventLane } from "./packing";
export const HOUR = 3_600_000;
const WINDOW = 48 * HOUR;
const PAGE_BUDGET = 10;
export type TimelineTransport = {
  list(args: {
    range: TimelineRange;
    cursor?: string;
    limit: number;
  }): Promise<TimelinePage>;
  roster(args: {
    eventId: string;
    range: TimelineRange;
    cursor?: string;
  }): Promise<TimelineRosterPage>;
  resolve(args: { references: PlanReference[] }): Promise<SavedResolution[]>;
};
type Data = {
  eventLanes: EventLane[];
  records: TimelineEvent[];
  slotCoverage: Record<string, "partial" | "complete">;
  saved: SavedResolution[];
  savedState: "loading" | "ready" | "error";
};
export type TimelineDataState = Data &
  (
    | { kind: "loading" }
    | { kind: "partial"; more: true }
    | { kind: "ready" }
    | { kind: "error"; error: unknown }
  );
type WindowEntry = {
  range: TimelineRange;
  records: Map<string, TimelineEvent>;
  cursor?: string;
  complete: boolean;
  updatedAt: number | null;
  retained?: Map<string, TimelineEvent>;
};
export function windowsForRange(range: TimelineRange): TimelineRange[] {
  const start = Math.floor(range.startAt / WINDOW) * WINDOW;
  const starts = [start];
  if (range.startAt - start <= 6 * HOUR) starts.push(start - WINDOW);
  if (start + WINDOW - range.endAt <= 6 * HOUR) starts.push(start + WINDOW);
  return starts.map((startAt) => ({
    startAt,
    endAt: startAt + WINDOW,
    timeZone: range.timeZone,
  }));
}
export function referenceKey(reference: PlanReference): string {
  return reference.kind === "event"
    ? reference.eventId
    : `${reference.eventId}:${reference.slotId}`;
}
export function inRange(
  event: Pick<TimelineEvent, "schedule">,
  range: TimelineRange,
): boolean {
  const s = event.schedule;
  if (s.kind === "date_only") {
    const format = new Intl.DateTimeFormat("en-CA", {
      timeZone: range.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return (
      s.eventDate >= format.format(range.startAt) &&
      s.eventDate <= format.format(range.endAt - 1)
    );
  }
  return s.kind === "timed"
    ? s.startAt < range.endAt && s.endAt > range.startAt
    : s.startAt >= range.startAt && s.startAt < range.endAt;
}
const byId = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];
export function sortEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.sort((a, b) => {
    const aTime =
      a.schedule.kind === "date_only"
        ? Date.parse(a.schedule.eventDate)
        : a.schedule.startAt;
    const bTime =
      b.schedule.kind === "date_only"
        ? Date.parse(b.schedule.eventDate)
        : b.schedule.startAt;
    return aTime - bTime || a.id.localeCompare(b.id);
  });
}

/** Owns bounded query continuations. Generation checks discard obsolete network reads. */
export function createTimelineController(transport: TimelineTransport) {
  let state: TimelineDataState = {
    kind: "loading",
    records: [],
    eventLanes: [],
    slotCoverage: {},
    saved: [],
    savedState: "ready",
  };
  let layoutEvents: Array<Pick<TimelineEvent, "id" | "schedule">> = [];
  let layoutLanes: EventLane[] = [];
  let layoutEstablished = false;
  let generation = 0;
  let savedGeneration = 0;
  let viewport: TimelineRange | null = null;
  let favoritesOnly = false;
  let favorites = new Set<string>();
  let plan: ReadonlyArray<PlanReference> = [];
  const cache = new Map<string, WindowEntry>();
  const listeners = new Set<() => void>();
  const key = (r: TimelineRange) => `${r.startAt}:${r.timeZone}`;
  const emit = (next: TimelineDataState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  function publish(
    status: Pick<TimelineDataState, "kind"> & { error?: unknown },
  ) {
    const records = new Map<string, TimelineEvent>();
    const slotCoverage: Data["slotCoverage"] = {};
    if (viewport)
      for (const r of windowsForRange(viewport)) {
        const entry = cache.get(key(r));
        for (const event of (entry?.retained ?? entry?.records)?.values() ??
          []) {
          const prior = records.get(event.id);
          records.set(
            event.id,
            prior
              ? {
                  ...event,
                  slots: byId([...prior.slots, ...event.slots]).sort(
                    (a, b) =>
                      a.schedule.startAt - b.schedule.startAt ||
                      a.id.localeCompare(b.id),
                  ),
                  performers: byId([...prior.performers, ...event.performers]),
                }
              : event,
          );
          slotCoverage[event.id] =
            event.rosterCursor === null && slotCoverage[event.id] !== "partial"
              ? "complete"
              : "partial";
        }
      }
    const visible = sortEvents(
      [...records.values()].filter(
        (e) =>
          !favoritesOnly ||
          (e.host && favorites.has(e.host.id)) ||
          e.performers.some((p) => favorites.has(p.id)),
      ),
    );
    // Filters and prefetch inclusion/removal must not move remaining rows.
    // Track layout for bounded cached windows, including currently hidden ones.
    const layoutRecords = byId([
      ...[...cache.values()].flatMap((entry) => [
        ...(entry.retained ?? entry.records).values(),
      ]),
      ...records.values(),
    ]);
    layoutLanes = reconcileEventLanes({
      events: layoutRecords,
      previousEvents: layoutEvents,
      previous: layoutLanes,
      allowPrepend: !layoutEstablished,
    });
    layoutEvents = layoutRecords.map(({ id, schedule }) => ({ id, schedule }));
    if (status.kind === "ready") layoutEstablished = true;
    const visibleIds = new Set(visible.map((event) => event.id));
    const eventLanes = layoutLanes.filter((lane) =>
      visibleIds.has(lane.eventId),
    );
    const data = {
      records: visible,
      eventLanes,
      slotCoverage,
      saved: state.saved,
      savedState: state.savedState,
    };
    switch (status.kind) {
      case "partial":
        emit({ ...data, kind: "partial", more: true });
        break;
      case "error":
        emit({ ...data, kind: "error", error: status.error });
        break;
      default:
        emit({ ...data, kind: status.kind });
    }
  }
  function entries() {
    if (!viewport) return [];
    const ranges = windowsForRange(viewport);
    for (const r of ranges)
      if (!cache.has(key(r)))
        cache.set(key(r), {
          range: r,
          records: new Map(),
          complete: false,
          updatedAt: null,
        });
    // Prefer the current viewport and its prefetch windows; retain at most three.
    const needed = new Set(ranges.map(key));
    for (const k of cache.keys())
      if (cache.size > 3 && !needed.has(k)) cache.delete(k);
    return ranges.flatMap((r) => {
      const e = cache.get(key(r));
      return e ? [e] : [];
    });
  }
  function invalidate(entry: WindowEntry) {
    // Keep the last readable version until this window's entire replacement is
    // complete. A new generation can continue the draft without erasing it.
    entry.retained ??= new Map(entry.records);
    entry.records = new Map();
    entry.cursor = undefined;
    entry.complete = false;
    entry.updatedAt = null;
  }
  async function run(token: number) {
    let pages = 0;
    const active = entries();
    try {
      for (const entry of active) {
        while (!entry.complete && pages < PAGE_BUDGET) {
          const result = await transport.list({
            range: entry.range,
            cursor: entry.cursor,
            limit: 50,
          });
          if (token !== generation) return;
          pages++;
          for (const event of result.items) {
            const prior = entry.records.get(event.id);
            entry.records.set(
              event.id,
              prior
                ? {
                    ...event,
                    slots: byId([...prior.slots, ...event.slots]).sort(
                      (a, b) =>
                        a.schedule.startAt - b.schedule.startAt ||
                        a.id.localeCompare(b.id),
                    ),
                    performers: byId([
                      ...prior.performers,
                      ...event.performers,
                    ]),
                  }
                : {
                    ...event,
                    slots: [...event.slots],
                    performers: [...event.performers],
                  },
            );
          }
          entry.cursor = result.cursor ?? undefined;
          entry.complete = result.complete;
          publish({ kind: "loading" });
        }
        for (const event of entry.records.values()) {
          let rosterPages = 0;
          while (event.rosterCursor !== null && rosterPages < PAGE_BUDGET) {
            const result = await transport.roster({
              eventId: event.id,
              range: entry.range,
              cursor: event.rosterCursor,
            });
            if (token !== generation) return;
            rosterPages++;
            event.slots = byId([...event.slots, ...result.items]).sort(
              (a, b) =>
                a.schedule.startAt - b.schedule.startAt ||
                a.id.localeCompare(b.id),
            );
            event.performers = byId([
              ...event.performers,
              ...result.performers,
            ]);
            event.rosterCursor = result.cursor;
            publish({ kind: "loading" });
          }
        }
        if (
          entry.complete &&
          [...entry.records.values()].every((e) => e.rosterCursor === null)
        ) {
          entry.updatedAt ??= Date.now();
          entry.retained = undefined;
        }
      }
      if (token !== generation) return;
      publish({
        kind: active.every(
          (e) =>
            e.complete &&
            [...e.records.values()].every((r) => r.rosterCursor === null),
        )
          ? "ready"
          : "partial",
      });
    } catch (error) {
      if (token === generation) publish({ kind: "error", error });
    }
  }
  async function setPlan(references: ReadonlyArray<PlanReference>) {
    plan = references;
    const token = ++savedGeneration;
    // Remove old content immediately when a reference is removed.
    const keys = new Set(references.map(referenceKey));
    emit({
      ...state,
      saved: state.saved.filter((s) => keys.has(referenceKey(s.reference))),
      savedState: references.length ? "loading" : "ready",
    });
    const saved: SavedResolution[] = [];
    try {
      for (let i = 0; i < references.length; i += 50) {
        const result = await transport.resolve({
          references: references.slice(i, i + 50),
        });
        if (token !== savedGeneration) return;
        saved.push(...result);
      }
      emit({ ...state, saved, savedState: "ready" });
    } catch {
      if (token === savedGeneration)
        emit({ ...state, saved: [], savedState: "error" });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async setViewport(
      range: TimelineRange,
      only: boolean,
      ids: ReadonlyArray<string>,
    ) {
      viewport = range;
      favoritesOnly = only;
      favorites = new Set(ids);
      const token = ++generation;
      for (const entry of entries())
        if (entry.updatedAt !== null && Date.now() - entry.updatedAt >= 60_000)
          invalidate(entry);
      publish({ kind: "loading" });
      await run(token);
    },
    loadMore: () => {
      const token = ++generation;
      publish({ kind: "loading" });
      return run(token);
    },
    retry: async () => {
      const token = ++generation;
      publish({ kind: "loading" });
      await Promise.all([run(token), setPlan(plan)]);
    },
    async refresh() {
      const token = ++generation;
      for (const entry of cache.values()) invalidate(entry);
      publish({ kind: "loading" });
      await Promise.all([run(token), setPlan(plan)]);
    },
    setPlan,
    async resolveRoster(
      eventId: string,
      range: TimelineRange,
    ): Promise<TimelineRosterPage> {
      const items: TimelineRosterPage["items"] = [],
        performers: TimelineRosterPage["performers"] = [];
      let cursor: string | undefined;
      do {
        const result = await transport.roster({ eventId, range, cursor });
        items.push(...result.items);
        performers.push(...result.performers);
        cursor = result.cursor ?? undefined;
      } while (cursor);
      return {
        items: byId(items),
        performers: byId(performers),
        cursor: null,
        complete: true,
      };
    },
    dispose() {
      generation++;
      savedGeneration++;
      listeners.clear();
    },
  };
}
