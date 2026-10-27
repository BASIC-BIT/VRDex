import type { PlanReference } from "../../../../../convex/_eventTimelineTypes";
import { reducePreferences, type PreferenceAction, type TimelinePreferences } from "./preferences";

export const PREFERENCE_STORAGE_KEY = "vrdex.timeline.preferences.v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
type Source<T> = T | (() => T | null);
type Options = { storage?: Source<PreferenceStorage>; eventTarget?: Source<EventTarget> };
export type PreferenceSnapshot = { preferences: TimelinePreferences; persistence: "saved" | "session" };

function emptyPreferences(): TimelinePreferences {
  return { version: 1, plan: [], favoriteProfileIds: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Null distinguishes an invalid envelope from an accepted empty replacement.
function acceptedPreferences(value: unknown): TimelinePreferences | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.plan) || !Array.isArray(value.favoriteProfileIds)) return null;
  const references: PlanReference[] = [];
  for (const entry of value.plan) {
    if (!isRecord(entry) || !isId(entry.eventId)) continue;
    if (entry.kind === "event") references.push({ kind: "event", eventId: entry.eventId });
    else if (entry.kind === "set" && isId(entry.slotId)) references.push({ kind: "set", eventId: entry.eventId, slotId: entry.slotId });
  }
  // Whole-event inclusion wins regardless of the serialized record order or cap.
  const wholeEvents = new Set(references.filter((reference) => reference.kind === "event").map((reference) => reference.eventId));
  let state = emptyPreferences();
  for (const reference of references) {
    if (reference.kind === "set" && wholeEvents.has(reference.eventId)) continue;
    state = reducePreferences(state, { type: "add-plan", reference }).state;
  }
  for (const profileId of value.favoriteProfileIds) {
    if (isId(profileId)) state = reducePreferences(state, { type: "add-favorite", profileId }).state;
  }
  return state;
}

export function parsePreferences(value: unknown): TimelinePreferences {
  return acceptedPreferences(value) ?? emptyPreferences();
}

function readSerialized(value: string | null): TimelinePreferences | null {
  if (value === null) return emptyPreferences();
  try {
    const parsed: unknown = JSON.parse(value);
    return acceptedPreferences(parsed);
  } catch {
    return null;
  }
}

function resolveSource<T extends PreferenceStorage | EventTarget>(source: Source<T> | undefined): T | null {
  return typeof source === "function" ? source() : source ?? null;
}

export function createPreferenceStore(options: Options) {
  const serverSnapshot: PreferenceSnapshot = { preferences: emptyPreferences(), persistence: "saved" };
  let snapshot = serverSnapshot;
  let storage: PreferenceStorage | null = null;
  let target: EventTarget | null = null;
  let initialized = false;
  const listeners = new Set<() => void>();

  function publish(preferences: TimelinePreferences, persistence: PreferenceSnapshot["persistence"]) {
    if (snapshot.persistence === persistence && JSON.stringify(snapshot.preferences) === JSON.stringify(preferences)) return;
    snapshot = { preferences, persistence };
    for (const listener of listeners) listener();
  }

  function hydrate() {
    // A failed persistence boundary must never overwrite this session's choices.
    if (initialized && snapshot.persistence === "session") return;
    initialized = true;
    try {
      storage = resolveSource(options.storage);
      if (!storage) {
        publish(snapshot.preferences, "session");
        return;
      }
      publish(readSerialized(storage.getItem(PREFERENCE_STORAGE_KEY)) ?? emptyPreferences(), "saved");
    } catch {
      storage = null;
      publish(snapshot.preferences, "session");
    }
  }

  function onStorage(event: Event) {
    if (snapshot.persistence === "session" || !("key" in event) || !("newValue" in event)) return;
    if (event.key !== PREFERENCE_STORAGE_KEY && event.key !== null) return;
    if ("storageArea" in event && event.storageArea !== null && event.storageArea !== storage) return;
    if (event.newValue !== null && typeof event.newValue !== "string") return;
    const preferences = readSerialized(event.newValue);
    if (preferences) publish(preferences, "saved");
  }

  function detach() {
    target?.removeEventListener("storage", onStorage);
    target = null;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
      // useSyncExternalStore calls subscribe after commit, never during render.
      hydrate();
      try {
        target = resolveSource(options.eventTarget);
        target?.addEventListener("storage", onStorage);
      } catch {
        detach();
      }
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) detach();
    };
  }

  function dispatch(action: PreferenceAction) {
    if (!initialized) hydrate();
    const result = reducePreferences(snapshot.preferences, action);
    if (result.outcome !== "changed") return result;
    let persistence = snapshot.persistence;
    if (persistence === "saved" && storage) {
      try {
        storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(result.state));
      } catch {
        persistence = "session";
      }
    }
    publish(result.state, persistence);
    return result;
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe,
    dispatch,
    dispose: () => { detach(); listeners.clear(); },
  };
}
