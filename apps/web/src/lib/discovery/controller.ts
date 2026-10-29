import type { DiscoveryEventCandidate, DiscoveryEventRequest, DiscoveryEventSignal, DiscoveryPage, DiscoveryProfileSignal } from "../../../../../convex/_homeDiscoveryTypes";
import { formatZonedDateTimeInput } from "../calendar/zoned-date-time";
import { selectDiscovery } from "./recommendations";

/** One live backend query. Its first emission completes the scheduled request. */
export type DiscoveryQuery<T> = { subscribe(next: (value: T) => void, error: (error: unknown) => void): () => void };
export type DiscoveryTransport = {
  listEvents(args: DiscoveryEventRequest): DiscoveryQuery<DiscoveryPage<DiscoveryEventCandidate>>;
  listClubs(args: { direction: "asc" | "desc"; cursor?: string }): DiscoveryQuery<DiscoveryPage<DiscoveryProfileSignal>>;
  eventSignals(args: { eventIds: string[] }): DiscoveryQuery<{ items: DiscoveryEventSignal[] }>;
  profileSignals(args: { profileIds: string[] }): DiscoveryQuery<{ items: DiscoveryProfileSignal[] }>;
};
export type DiscoveryContext = { now: number; timeZone: string; favoriteProfileIds: readonly string[]; rotationKey: string };
type StreamCoverage = { pages: number; cursor: string | null; complete: boolean };
export type DiscoveryCoverage = {
  events: (StreamCoverage & Pick<DiscoveryEventRequest, "band" | "kind" | "direction">)[];
  clubs: (StreamCoverage & { direction: "asc" | "desc" })[];
  candidateCount: number;
  signals: { eventId: string; coverage: DiscoveryEventSignal["coverage"] }[];
  favoriteCount: number;
};
export type DiscoverySnapshot =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "available"; events: DiscoveryEventCandidate[]; clubs: DiscoveryProfileSignal[]; eventSignals: DiscoveryEventSignal[]; favoriteProfiles: DiscoveryProfileSignal[]; coverage: DiscoveryCoverage; refreshing: boolean };
type Generation = { stopped: boolean; stops: Set<() => void> };
const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
const batches = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export function createDiscoveryController({ transport, concurrency }: { transport: DiscoveryTransport; concurrency: 3 }) {
  let context: DiscoveryContext | undefined;
  let snapshot: DiscoverySnapshot = { kind: "loading" };
  // Only the current watched public pool may supply minute-level replacements.
  let recommendationPool: Parameters<typeof selectDiscovery>[0] | undefined;
  let current: Generation | undefined;
  let retained: Generation | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const emit = (value: DiscoverySnapshot) => { snapshot = value; listeners.forEach(listener => listener()); };
  const stop = (generation: Generation | undefined) => {
    if (!generation || generation.stopped) return;
    generation.stopped = true;
    generation.stops.forEach(cancel => cancel());
    generation.stops.clear();
  };
  function invalidate() {
    if (disposed) return;
    stop(current); stop(retained); retained = undefined;
    recommendationPool = undefined;
    emit({ kind: "loading" });
    refresh();
  }
  function fail(generation: Generation, error: unknown) {
    if (generation.stopped || disposed) return;
    stop(current); stop(retained); retained = undefined;
    recommendationPool = undefined;
    emit({ kind: "error", error });
  }
  function read<T>(generation: Generation, query: DiscoveryQuery<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (generation.stopped) { reject(new Error("Obsolete discovery context")); return; }
      let received = false;
      let previous = "";
      let unsubscribe = () => {};
      const cancel = () => { unsubscribe(); if (!received) reject(new Error("Obsolete discovery context")); };
      generation.stops.add(cancel);
      try {
        unsubscribe = query.subscribe(value => {
          if (generation.stopped || disposed) return;
          const serialized = JSON.stringify(value);
          if (received) { if (previous !== serialized) invalidate(); return; }
          received = true; previous = serialized; resolve(value);
        }, error => { reject(error); fail(generation, error); });
        if (generation.stopped) unsubscribe();
      } catch (error) { reject(error); fail(generation, error); }
    });
  }
  async function parallel(jobs: (() => Promise<void>)[]) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (index < jobs.length) { const job = jobs[index++]; if (job) await job(); }
    }));
  }
  async function collect<T extends { id: string }>(generation: Generation, cap: number, query: (cursor?: string) => DiscoveryQuery<DiscoveryPage<T>>) {
    let items: T[] = [], cursor: string | null = null, pages = 0, complete = false;
    do {
      const page: DiscoveryPage<T> = await read(generation, query(cursor ?? undefined));
      pages++;
      const all = unique([...items, ...page.items]);
      items = all.slice(0, cap);
      cursor = page.cursor;
      complete = page.complete && all.length <= cap;
      if (page.complete || !cursor || items.length >= cap) break;
    } while (pages < 3);
    return { items, coverage: { pages, cursor, complete } };
  }
  async function run(generation: Generation, input: DiscoveryContext) {
    const events: DiscoveryEventCandidate[] = [], clubs: DiscoveryProfileSignal[] = [], favoriteProfiles: DiscoveryProfileSignal[] = [];
    const coverage: DiscoveryCoverage = { events: [], clubs: [], signals: [], candidateCount: 0, favoriteCount: 0 };
    const jobs: (() => Promise<void>)[] = [];
    for (const band of [0, 1, 2, 3] as const) for (const kind of ["timed", "date_only"] as const) for (const direction of ["asc", "desc"] as const) {
      jobs.push(async () => {
        const result = await collect(generation, 2, cursor => transport.listEvents({ now: input.now, timeZone: input.timeZone, band, kind, direction, ...(cursor ? { cursor } : {}) }));
        events.push(...result.items); coverage.events.push({ band, kind, direction, ...result.coverage });
      });
    }
    for (const direction of ["asc", "desc"] as const) jobs.push(async () => {
      const result = await collect(generation, 12, cursor => transport.listClubs({ direction, ...(cursor ? { cursor } : {}) }));
      clubs.push(...result.items); coverage.clubs.push({ direction, ...result.coverage });
    });
    for (const profileIds of batches(input.favoriteProfileIds, 50)) jobs.push(async () => {
      const result = await read(generation, transport.profileSignals({ profileIds })); favoriteProfiles.push(...result.items);
    });
    await parallel(jobs);
    const candidates = unique(events);
    const eventSignals: DiscoveryEventSignal[] = [];
    await parallel(batches(candidates.map(item => item.id), 4).map(eventIds => async () => {
      const result = await read(generation, transport.eventSignals({ eventIds })); eventSignals.push(...result.items);
    }));
    if (generation.stopped || disposed) return;
    const eligibleIds = new Set(eventSignals.map(item => item.eventId));
    const localDate = formatZonedDateTimeInput(input.now, input.timeZone).slice(0, 10);
    const eligible = candidates.filter(item => eligibleIds.has(item.id) && (item.schedule.kind === "date_only" ? item.schedule.eventDate >= localDate : item.schedule.startAt >= input.now));
    coverage.candidateCount = candidates.length; coverage.favoriteCount = input.favoriteProfileIds.length;
    coverage.signals = eventSignals.map(({ eventId, coverage }) => ({ eventId, coverage }));
    recommendationPool = { events: eligible, eventSignals, clubs: unique([...clubs, ...favoriteProfiles.filter(item => item.profileType === "community")]), favoriteProfiles, favoriteProfileIds: input.favoriteProfileIds, rotationKey: input.rotationKey };
    const selection = selectDiscovery(recommendationPool);
    stop(retained); retained = undefined;
    emit({ kind: "available", ...selection, eventSignals, favoriteProfiles, coverage, refreshing: false });
  }
  function refresh() {
    if (disposed || !context) return;
    if (snapshot.kind === "available" && !snapshot.refreshing) {
      stop(retained); retained = current;
      emit({ ...snapshot, refreshing: true });
    } else stop(current);
    const generation: Generation = { stopped: false, stops: new Set() };
    current = generation;
    void run(generation, context).catch(error => fail(generation, error));
  }
  return {
    setContext(input: DiscoveryContext) {
      if (disposed) return;
      const next = { ...input, favoriteProfileIds: [...new Set(input.favoriteProfileIds)].slice(0, 500) };
      if (JSON.stringify(context) === JSON.stringify(next)) return;
      const sameContext = context && context.timeZone === next.timeZone && context.rotationKey === next.rotationKey
        && JSON.stringify(context.favoriteProfileIds) === JSON.stringify(next.favoriteProfileIds)
        && formatZonedDateTimeInput(context.now, context.timeZone).slice(0, 10) === formatZonedDateTimeInput(next.now, next.timeZone).slice(0, 10);
      context = next;
      if (sameContext) refresh(); else invalidate();
    },
    getSnapshot: () => snapshot,
    /** Refill expired cards from inspected public candidates without new reads. */
    getSnapshotAt(now: number): DiscoverySnapshot {
      if (snapshot.kind !== "available" || !recommendationPool || !context) return snapshot;
      const localDate = formatZonedDateTimeInput(now, context.timeZone).slice(0, 10);
      const events = recommendationPool.events.filter(event => event.schedule.kind === "date_only" ? event.schedule.eventDate >= localDate : event.schedule.startAt >= now);
      return { ...snapshot, ...selectDiscovery({ ...recommendationPool, events }) };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retry: invalidate,
    refresh,
    dispose() {
      disposed = true; stop(current); stop(retained); listeners.clear();
      recommendationPool = undefined;
      snapshot = { kind: "loading" };
    },
  };
}

/** Called after browser boot only; storage holds a random seed, never public data. */
export function createDiscoverySessionSeed({ storage, createSeed }: {
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
  createSeed: () => string;
}): () => string {
  let memorySeed: string | undefined;
  return () => {
    if (memorySeed) return memorySeed;
    const key = "vrdex.discovery.session.v1";
    try { const saved = storage()?.getItem(key); if (saved) return memorySeed = saved; } catch { /* Storage may be blocked. */ }
    memorySeed = createSeed();
    try { storage()?.setItem(key, memorySeed); } catch { /* Keep the in-memory session seed. */ }
    return memorySeed;
  };
}
