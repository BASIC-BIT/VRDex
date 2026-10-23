import { parseMediaSettings } from "./broadcast-profiles.mjs";
/** Owns physical acquisition capacity, including retiring handles. Desired entries
 * are {slotKey, source: authoritative descriptor}; URLs never leave readySources.
 * Provider handles own reconnects. Failed terminal handles retry only after their
 * disposal proves closure, with capped backoff and the same desired identity.
 */
export function createInputManager({
  settings,
  createVrcdnInput,
  createTwitchInput,
  onState = () => {},
}) {
  let bound,
    stopped = false,
    generation = 0,
    desired = [],
    stopPromise;
  const live = new Map(),
    retries = new Map();
  const keyOf = (entry, epoch) =>
    JSON.stringify([
      epoch,
      entry.slotKey,
      entry.source.id,
      entry.source.revision,
      entry.source.input,
      entry.source.publicUrl,
    ]);
  const valid = (entry) =>
    !stopped &&
    !entry.retiring &&
    desired.some((d) => d.key === entry.key) &&
    live.get(entry.key) === entry;
  const state = (entry, event) => {
    if (!valid(entry)) return;
    try {
      onState({
        kind: event.kind,
        reason: event.reason,
        slotKey: entry.slotKey,
        sourceId: entry.source.id,
        revision: entry.source.revision,
        generation: entry.generation,
        epoch: entry.epoch,
      });
    } catch {
      /* Observation consumers cannot change acquisition ownership. */
    }
  };
  function retire(entry) {
    if (entry.retiring) return entry.cleanup;
    entry.retiring = true;
    entry.url = undefined;
    entry.abort.abort();
    try {
      entry.cleanup = Promise.resolve(entry.handle.dispose());
    } catch (error) {
      entry.cleanup = Promise.reject(error);
    }
    entry.cleanup.then(
      () => {
        live.delete(entry.key);
        pump();
      },
      () => {},
    );
    return entry.cleanup;
  }
  function pump() {
    for (const entry of live.values())
      if (stopped || !desired.some((d) => d.key === entry.key)) retire(entry);
    if (stopped || !bound) return;
    for (const want of desired) {
      if (live.size >= 2) break;
      if (live.has(want.key) || retries.get(want.key)?.timer) continue;
      const entry = {
        ...want,
        generation: ++generation,
        abort: new AbortController(),
        retiring: false,
      };
      live.set(entry.key, entry);
      try {
        const factory =
          entry.source.input?.kind === "twitch"
            ? createTwitchInput
            : createVrcdnInput;
        entry.handle = factory({
          source: entry.source,
          settings: bound,
          signal: entry.abort.signal,
          onState: (event) => queueMicrotask(() => state(entry, event)),
          preparationExpiresAt: entry.preparationExpiresAt,
          sessionExpiresAt: entry.sessionExpiresAt,
        });
        if (
          !entry.handle?.transportReady?.then ||
          typeof entry.handle.dispose !== "function"
        )
          throw Error("Invalid input handle");
        entry.handle.transportReady.then(
          (result) => {
            if (valid(entry)) {
              entry.url = result.url;
              state(entry, { kind: "transport_ready" });
            }
          },
          () => {
            if (!valid(entry)) return;
            state(entry, { kind: "unavailable" });
            const retry = retries.get(entry.key) ?? { attempt: 0 };
            retry.timer = setTimeout(
              () => {
                retry.timer = undefined;
                pump();
              },
              Math.min(10000, 1000 * 2 ** Math.min(retry.attempt++, 4)),
            );
            retry.timer.unref?.();
            retries.set(entry.key, retry);
            retire(entry);
          },
        );
      } catch {
        // Factories must return an immediate handle or throw before allocating.
        live.delete(entry.key);
        state(entry, { kind: "unavailable" });
      }
    }
  }
  function bindSettings(value) {
    const parsed = parseMediaSettings(value);
    if (bound && JSON.stringify(bound) !== JSON.stringify(parsed))
      throw Error("Session media settings changed");
    bound = Object.freeze(parsed);
    pump();
  }
  if (settings) bindSettings(settings);
  return {
    bindSettings,
    reconcile({ current, candidate, epoch, intentSequence }) {
      if (stopped) return;
      desired = [current, candidate]
        .filter(Boolean)
        .map((entry) => ({
          ...entry,
          epoch,
          intentSequence,
          key: keyOf(entry, epoch),
        }))
        .filter(
          (entry, i, all) =>
            all.findIndex((other) => other.key === entry.key) === i,
        );
      for (const [key, retry] of retries)
        if (!desired.some((d) => d.key === key)) {
          clearTimeout(retry.timer);
          retries.delete(key);
        }
      pump();
    },
    readySources: () =>
      [...live.values()]
        .filter((entry) => valid(entry) && entry.url)
        .map((entry) => ({
          slotKey: entry.slotKey,
          sourceId: entry.source.id,
          revision: entry.source.revision,
          url: entry.url,
        })),
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      desired = [];
      for (const retry of retries.values()) clearTimeout(retry.timer);
      retries.clear();
      stopPromise = Promise.all([...live.values()].map(retire)).then(() => {});
      stopPromise.catch(() => {});
      return stopPromise;
    },
  };
}
