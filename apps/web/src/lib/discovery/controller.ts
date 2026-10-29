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
export type DiscoveryContext = { now: number; timeZone: string; rotationKey: string };
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
  | { kind: "available"; events: DiscoveryEventCandidate[]; clubs: DiscoveryProfileSignal[]; eventSignals: DiscoveryEventSignal[]; favoriteProfiles: DiscoveryProfileSignal[]; eligibleEventIds: readonly string[]; eligibleClubIds: readonly string[]; coverage: DiscoveryCoverage; refreshing: boolean };
type CandidatePool = { generation: Generation; events: DiscoveryEventCandidate[]; clubs: DiscoveryProfileSignal[]; eventSignals: DiscoveryEventSignal[]; coverage: DiscoveryCoverage };
type Generation = { stopped: boolean; stops: Set<() => void> };
const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
const batches = <T>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export function createDiscoveryController({ transport, concurrency }: { transport: DiscoveryTransport; concurrency: 3 }) {
  let context: DiscoveryContext | undefined;
  let snapshot: DiscoverySnapshot = { kind: "loading" };
  // Only the current watched public pool may supply minute-level replacements.
  let recommendationPool: Parameters<typeof selectDiscovery>[0] | undefined;
  let favoriteProfileIds: string[] = [];
  let favoriteProfiles: DiscoveryProfileSignal[] | undefined;
  let favoritePending = false;
  let favorites: Generation | undefined;
  let retainedFavorites: Generation | undefined;
  let candidatePool: CandidatePool | undefined;
  // Ranking readiness never transfers ownership of the displayed public data.
  let committedPool: CandidatePool | undefined;
  let focusedEventId: string | null = null;
  let pinnedEvent: { event: DiscoveryEventCandidate; pool: CandidatePool } | undefined;
  let focusedClubId: string | null = null;
  let pinnedClub: { profile: DiscoveryProfileSignal; source: Generation; owner: Generation } | undefined;
  let favoriteOwner: Generation | undefined;
  let favoriteSources = new Map<string, Generation>();
  let candidatePending = false;
  let current: Generation | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const emit = (value: DiscoverySnapshot) => { snapshot = value; listeners.forEach(listener => listener()); };
  const stop = (generation: Generation | undefined) => {
    if (!generation || generation.stopped) return;
    generation.stopped = true;
    generation.stops.forEach(cancel => cancel());
    generation.stops.clear();
  };
  function stopUnusedCandidate(generation: Generation | undefined) {
    if (generation !== current && generation !== committedPool?.generation && generation !== pinnedEvent?.pool.generation) stop(generation);
  }
  function releaseEventPin() {
    const previous = pinnedEvent;
    pinnedEvent = undefined;
    stopUnusedCandidate(previous?.pool.generation);
  }
  function eligibleEvents(events: readonly DiscoveryEventCandidate[]) {
    return [...new Set([...events.map(event => event.id), ...(pinnedEvent ? [pinnedEvent.event.id] : [])])];
  }
  function publishEligibility() {
    if (snapshot.kind !== "available" || !recommendationPool) return;
    emit({ ...snapshot, ...selectDiscovery(recommendationPool), eventSignals: [...recommendationPool.eventSignals],
      eligibleEventIds: eligibleEvents(recommendationPool.events),
      eligibleClubIds: [...new Set([...recommendationPool.clubs.map(club => club.id), ...(pinnedClub ? [pinnedClub.profile.id] : [])])] });
  }
  // Only an explicit signal rejection is authoritative; a bounded sample's
  // omission cannot revoke the still-watched displayed or focused event.
  function reconcileEligibility(requested: string[], signals: DiscoveryEventSignal[]) {
    const accepted = new Set(signals.map(signal => signal.eventId));
    const rejected = new Set(requested.filter(id => !accepted.has(id)));
    if (!rejected.size) return;
    if (focusedEventId && rejected.has(focusedEventId)) { focusedEventId = null; releaseEventPin(); }
    if (committedPool) {
      committedPool.events = committedPool.events.filter(event => !rejected.has(event.id));
      committedPool.eventSignals = committedPool.eventSignals.filter(signal => !rejected.has(signal.eventId));
    }
    if (recommendationPool) {
      recommendationPool = { ...recommendationPool, events: recommendationPool.events.filter(event => !rejected.has(event.id)), eventSignals: recommendationPool.eventSignals.filter(signal => !rejected.has(signal.eventId)) };
      publishEligibility();
    }
  }
  function invalidate() {
    if (disposed) return;
    stop(current); stop(committedPool?.generation); stop(pinnedEvent?.pool.generation);
    committedPool = undefined; pinnedEvent = undefined; focusedEventId = null;
    stop(favorites); stop(retainedFavorites); retainedFavorites = undefined;
    stop(pinnedClub?.source); pinnedClub = undefined; focusedClubId = null; favoriteSources.clear(); favoriteOwner = undefined;
    recommendationPool = undefined; candidatePool = undefined;
    favoriteProfiles = undefined; favoritePending = false; candidatePending = false;
    emit({ kind: "loading" });
    refreshFavorites(); refresh();
  }
  function fail(generation: Generation, error: unknown) {
    if (generation.stopped || disposed) return;
    stop(current); stop(committedPool?.generation); stop(pinnedEvent?.pool.generation);
    committedPool = undefined; pinnedEvent = undefined; focusedEventId = null;
    stop(favorites); stop(retainedFavorites); retainedFavorites = undefined;
    stop(pinnedClub?.source); pinnedClub = undefined; focusedClubId = null; favoriteSources.clear(); favoriteOwner = undefined;
    recommendationPool = undefined; candidatePool = undefined;
    emit({ kind: "error", error });
  }
  // Candidate and favorite generations share the logical first-value budget.
  // A completed query stays watched; this is not a wire-concurrency limit.
  let pending = 0;
  const queue: (() => void)[] = [];
  const pump = () => { while (pending < concurrency) { const start = queue.shift(); if (!start) return; start(); } };
  function read<T>(generation: Generation, query: DiscoveryQuery<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      let received = false, running = false;
      let previous = "";
      let unsubscribe = () => {};
      const release = () => { if (running) { running = false; pending--; pump(); } };
      const cancel = () => { unsubscribe(); if (!received) reject(new Error("Obsolete discovery context")); release(); };
      generation.stops.add(cancel);
      queue.push(() => {
        if (generation.stopped || disposed) { reject(new Error("Obsolete discovery context")); return; }
        pending++; running = true;
        try {
          unsubscribe = query.subscribe(value => {
            if (generation.stopped || disposed) return;
            const serialized = JSON.stringify(value);
            if (received) { if (previous !== serialized) invalidate(); return; }
            received = true; previous = serialized; resolve(value); release();
          }, error => { reject(error); fail(generation, error); release(); });
          if (generation.stopped) unsubscribe();
        } catch (error) { reject(error); fail(generation, error); release(); }
      });
      pump();
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
    const events: DiscoveryEventCandidate[] = [], clubs: DiscoveryProfileSignal[] = [];
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
    await parallel(jobs);
    const candidates = unique(events);
    const eventSignals: DiscoveryEventSignal[] = [];
    await parallel(batches(candidates.map(item => item.id), 4).map(eventIds => async () => {
      const result = await read(generation, transport.eventSignals({ eventIds }));
      if (generation.stopped || disposed) return;
      reconcileEligibility(eventIds, result.items);
      eventSignals.push(...result.items);
    }));
    if (generation.stopped || disposed) return;
    const eligibleIds = new Set(eventSignals.map(item => item.eventId));
    const localDate = formatZonedDateTimeInput(input.now, input.timeZone).slice(0, 10);
    const eligible = candidates.filter(item => eligibleIds.has(item.id) && (item.schedule.kind === "date_only" ? item.schedule.eventDate >= localDate : item.schedule.startAt >= input.now));
    coverage.candidateCount = candidates.length;
    coverage.signals = eventSignals.map(({ eventId, coverage }) => ({ eventId, coverage }));
    candidatePending = false;
    candidatePool = { generation, events: eligible, eventSignals, clubs: unique(clubs), coverage };
    commitRanks();
  }
  function commitRanks() {
    if (!context || !candidatePool || favoritePending || !favoriteProfiles || disposed) return;
    const { events, clubs, eventSignals, coverage } = candidatePool;
    const previous = committedPool;
    if (focusedEventId && !events.some(event => event.id === focusedEventId) && !pinnedEvent) {
      const event = previous?.events.find(event => event.id === focusedEventId);
      // One already-live generation supplies both public metadata and signals.
      // It is excluded from new rankings and cannot accumulate across refreshes.
      if (event && previous) pinnedEvent = { event, pool: previous };
    }
    committedPool = candidatePool;
    if (pinnedEvent && events.some(event => event.id === pinnedEvent?.event.id)) releaseEventPin();
    recommendationPool = { events, eventSignals, clubs: unique([...clubs, ...favoriteProfiles.filter(item => item.profileType === "community")]), favoriteProfiles, favoriteProfileIds, rotationKey: context.rotationKey };
    emit({ kind: "available", ...selectDiscovery(recommendationPool), eventSignals, favoriteProfiles,
      eligibleEventIds: eligibleEvents(events), eligibleClubIds: [...new Set([...recommendationPool.clubs.map(item => item.id), ...(pinnedClub ? [pinnedClub.profile.id] : [])])],
      coverage: { ...coverage, favoriteCount: favoriteProfileIds.length }, refreshing: candidatePending });
    stopUnusedCandidate(previous?.generation);
  }
  function refreshFavorites() {
    if (disposed || !context) return;
    if (!favoritePending) { stop(retainedFavorites); retainedFavorites = favorites; }
    else stop(favorites);
    const generation: Generation = { stopped: false, stops: new Set() };
    favorites = generation; favoritePending = true;
    if (snapshot.kind === "available") emit({ ...snapshot, refreshing: true });
    const ids = favoriteProfileIds;
    void (async () => {
      const profiles: DiscoveryProfileSignal[] = [];
      const sources = new Map<string, Generation>();
      await parallel(batches(ids, 50).map(profileIds => async () => {
        const source: Generation = { stopped: false, stops: new Set() };
        // A focused outside-sample club may retain exactly this already-live
        // batch (at most 50 IDs), never an entire obsolete favorite generation.
        generation.stops.add(() => { if (pinnedClub?.source !== source) stop(source); });
        if (generation.stopped) { stop(source); return; }
        const result = await read(source, transport.profileSignals({ profileIds }));
        profiles.push(...result.items);
        for (const profile of result.items) sources.set(profile.id, source);
      }));
      if (generation.stopped || disposed) return;
      favoriteProfiles = unique(profiles); favoriteSources = sources; favoriteOwner = generation; favoritePending = false;
      if (pinnedClub && sources.has(pinnedClub.profile.id)) { stop(pinnedClub.source); pinnedClub = undefined; }
      stop(retainedFavorites); retainedFavorites = undefined;
      commitRanks();
    })().catch(error => fail(generation, error));
  }
  function refresh() {
    if (disposed || !context) return;
    if (snapshot.kind === "error") { invalidate(); return; }
    const previous = current;
    const generation: Generation = { stopped: false, stops: new Set() };
    current = generation; candidatePending = true;
    // An uncommitted completed pool may be superseded while favorites wait.
    // Fall back to the still-watched committed pool until the new one is ready.
    candidatePool = committedPool;
    stopUnusedCandidate(previous);
    if (snapshot.kind === "available") emit({ ...snapshot, refreshing: true });
    void run(generation, context).catch(error => fail(generation, error));
  }
  return {
    setContext(input: DiscoveryContext) {
      if (disposed) return;
      const next = { ...input };
      if (JSON.stringify(context) === JSON.stringify(next)) return;
      const sameContext = context && context.timeZone === next.timeZone && context.rotationKey === next.rotationKey
        && formatZonedDateTimeInput(context.now, context.timeZone).slice(0, 10) === formatZonedDateTimeInput(next.now, next.timeZone).slice(0, 10);
      context = next;
      if (sameContext) refresh(); else invalidate();
    },
    setFavorites(input: readonly string[]) {
      if (disposed) return;
      const next = [...new Set(input)].sort().slice(0, 500);
      if (JSON.stringify(next) === JSON.stringify(favoriteProfileIds)) return;
      if (focusedClubId && !next.includes(focusedClubId) && !pinnedClub && !candidatePool?.clubs.some(club => club.id === focusedClubId)) {
        const profile = favoriteProfiles?.find(profile => profile.id === focusedClubId && profile.profileType === "community");
        const source = favoriteSources.get(focusedClubId);
        if (profile && source && favoriteOwner && !source.stopped) pinnedClub = { profile, source, owner: favoriteOwner };
      }
      favoriteProfileIds = next;
      refreshFavorites();
    },
    setFocusedClub(profileId: string | null) {
      if (disposed) return;
      focusedClubId = profileId;
      if (pinnedClub && pinnedClub.profile.id !== profileId) {
        // A pending favorite refresh still owns its normal retained watch.
        if (pinnedClub.owner.stopped) stop(pinnedClub.source);
        pinnedClub = undefined;
        publishEligibility();
      }
    },
    setFocusedEvent(eventId: string | null) {
      if (disposed) return;
      focusedEventId = eventId;
      if (pinnedEvent && pinnedEvent.event.id !== eventId) { releaseEventPin(); publishEligibility(); }
    },
    getSnapshot: () => snapshot,
    /** Refill expired cards from inspected public candidates without new reads. */
    getSnapshotAt(now: number): DiscoverySnapshot {
      if (snapshot.kind !== "available" || !recommendationPool || !context) return snapshot;
      const localDate = formatZonedDateTimeInput(now, context.timeZone).slice(0, 10);
      const events = recommendationPool.events.filter(event => event.schedule.kind === "date_only" ? event.schedule.eventDate >= localDate : event.schedule.startAt >= now);
      if (pinnedEvent && !(pinnedEvent.event.schedule.kind === "date_only" ? pinnedEvent.event.schedule.eventDate >= localDate : pinnedEvent.event.schedule.startAt >= now)) {
        focusedEventId = null; releaseEventPin();
      }
      return { ...snapshot, ...selectDiscovery({ ...recommendationPool, events }), eligibleEventIds: eligibleEvents(events) };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retry: invalidate,
    refresh,
    dispose() {
      disposed = true; stop(current); stop(committedPool?.generation); stop(pinnedEvent?.pool.generation); committedPool = undefined; pinnedEvent = undefined; stop(favorites); stop(retainedFavorites); stop(pinnedClub?.source); pinnedClub = undefined; favoriteSources.clear(); favoriteOwner = undefined; listeners.clear();
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
