import type { FavoriteLineupArgs, FavoriteLineupResult } from "../../../../../convex/_homeDiscoveryTypes";
import type { DiscoveryQuery } from "./controller";

export type { FavoriteLineupArgs, FavoriteLineupResult } from "../../../../../convex/_homeDiscoveryTypes";
export type FavoriteLineupTransport = { favoriteLineup(args: FavoriteLineupArgs): DiscoveryQuery<FavoriteLineupResult> };
export type FavoriteLineupContext = { eventIds: readonly string[]; favoriteProfileIds: readonly string[] };
export type FavoriteLineupSnapshot =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | ({ kind: "available" } & FavoriteLineupResult);
type Generation = { stopped: boolean; stops: Set<() => void> };

/** Three outstanding first values; completed reads stay subscribed for revocation. */
export function createFavoriteLineupController({ transport }: { transport: FavoriteLineupTransport }) {
  let context: FavoriteLineupArgs | undefined;
  let current: Generation | undefined;
  let snapshot: FavoriteLineupSnapshot = { kind: "loading" };
  let disposed = false;
  const listeners = new Set<() => void>();
  const emit = (value: FavoriteLineupSnapshot) => { snapshot = value; listeners.forEach(listener => listener()); };
  function stop() {
    if (!current || current.stopped) return;
    current.stopped = true;
    current.stops.forEach(cancel => cancel());
    current.stops.clear();
  }
  function fail(generation: Generation, error: unknown) {
    if (generation.stopped || disposed) return;
    stop(); emit({ kind: "error", error });
  }
  function read(generation: Generation, args: FavoriteLineupArgs): Promise<FavoriteLineupResult> {
    return new Promise((resolve, reject) => {
      let received = false;
      let previous = "";
      let unsubscribe = () => {};
      const cancel = () => { unsubscribe(); if (!received) reject(new Error("Obsolete favorite lineup context")); };
      generation.stops.add(cancel);
      try {
        unsubscribe = transport.favoriteLineup(args).subscribe(value => {
          if (generation.stopped || disposed) return;
          const serialized = JSON.stringify(value);
          if (received) {
            // Any changed public result invalidates the entire summary. Never
            // combine a changed membership/privacy result with a trusted old list.
            if (serialized !== previous) refresh();
            return;
          }
          received = true; previous = serialized; resolve(value);
        }, error => { reject(error); fail(generation, error); });
        if (generation.stopped) unsubscribe();
      } catch (error) { reject(error); fail(generation, error); }
    });
  }
  async function run(generation: Generation, input: FavoriteLineupArgs) {
    const batches = Array.from({ length: Math.ceil(input.favoriteProfileIds.length / 25) }, (_, i) => input.favoriteProfileIds.slice(i * 25, (i + 1) * 25));
    const results: FavoriteLineupResult[] = new Array(batches.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (!generation.stopped && index < batches.length) {
        const batchIndex = index++;
        results[batchIndex] = await read(generation, { eventIds: input.eventIds, favoriteProfileIds: batches[batchIndex]! });
      }
    }));
    if (generation.stopped || disposed) return;
    const items: FavoriteLineupResult["items"] = [];
    for (const eventId of input.eventIds) {
      const matches = results.map(result => result.items.find(item => item.eventId === eventId));
      // Cached batches can briefly disagree during event revocation. Absence in
      // any batch wins until every current batch confirms public availability.
      if (matches.some(item => item === undefined)) continue;
      const people = new Map(matches.flatMap(item => item?.performers ?? []).map(person => [person.id, person]));
      items.push({ eventId, performers: input.favoriteProfileIds.flatMap(id => { const person = people.get(id); return person ? [person] : []; }) });
    }
    emit({ kind: "available", items });
  }
  function refresh() {
    if (disposed || !context) return;
    stop();
    if (!context.eventIds.length || !context.favoriteProfileIds.length) {
      emit({ kind: "available", items: [] }); return;
    }
    const generation: Generation = { stopped: false, stops: new Set() };
    current = generation;
    emit({ kind: "loading" });
    void run(generation, context).catch(error => fail(generation, error));
  }
  return {
    setContext(input: FavoriteLineupContext) {
      if (disposed) return;
      if (input.eventIds.length > 2 || input.favoriteProfileIds.length > 500) throw new Error("Too many favorite lineup IDs");
      const next = { eventIds: [...new Set(input.eventIds)].sort(), favoriteProfileIds: [...new Set(input.favoriteProfileIds)].sort() };
      if (JSON.stringify(next) === JSON.stringify(context)) return;
      context = next; refresh();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retry: refresh,
    dispose() { disposed = true; stop(); listeners.clear(); },
  };
}
