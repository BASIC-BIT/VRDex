import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { createPreferenceStore, parsePreferences, PREFERENCE_STORAGE_KEY } from "../../apps/web/src/lib/timeline/preference-storage";

const empty = { version: 1, plan: [], favoriteProfileIds: [] };
const saved = { version: 1, plan: [{ kind: "event", eventId: "A" }], favoriteProfileIds: ["person"] };
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function external(target: EventTarget, value: string | null, key: string | null = PREFERENCE_STORAGE_KEY) {
  target.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
}

describe("timeline preference storage", () => {
  it("renders the actual hook on the server without reading browser APIs", async () => {
    const requireWeb = createRequire(path.resolve("apps/web/package.json"));
    const React = requireWeb("react");
    const { renderToStaticMarkup } = requireWeb("react-dom/server");
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, get() { throw new Error("render read browser APIs"); } });
    try {
      const { useTimelinePreferences } = await import("../../apps/web/src/app/_components/timeline/use-timeline-preferences");
      function Consumer() {
        const value = useTimelinePreferences();
        assert.deepEqual(value.preferences, empty);
        assert.equal(value.persistence, "saved");
        for (const action of [value.addPlan, value.removePlan, value.addFavorite, value.removeFavorite]) assert.equal(typeof action, "function");
        return "empty";
      }
      assert.equal(renderToStaticMarkup(React.createElement(Consumer)), "empty");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("rejects unsupported versions and invalid envelopes", () => {
    for (const value of [undefined, null, "bad JSON", [], {}, { ...saved, version: 2 }, { ...saved, plan: {} }, { ...saved, favoriteProfileIds: null }]) {
      assert.deepEqual(parsePreferences(value), empty);
    }
  });

  it("validates identities, removes duplicates and destructures only reference fields", () => {
    assert.deepEqual(parsePreferences({ version: 1, extra: "secret", plan: [
      { kind: "set", eventId: "A", slotId: "one", title: "secret" },
      { kind: "set", eventId: "A", slotId: "one" },
      { kind: "set", eventId: "A", slotId: "two" },
      { kind: "event", eventId: "A", poster: "secret" },
      { kind: "set", eventId: "A", slotId: "three" },
      { kind: "set", eventId: "B", slotId: "" }, { kind: "event", eventId: 3 }, null,
    ], favoriteProfileIds: ["person", "person", "", 3, null, "club"] }), { version: 1, plan: [{ kind: "event", eventId: "A" }], favoriteProfileIds: ["person", "club"] });
  });

  it("bounds persisted choices without evicting earlier records", () => {
    const result = parsePreferences({ version: 1, plan: Array.from({ length: 201 }, (_, index) => ({ kind: "event", eventId: String(index) })), favoriteProfileIds: Array.from({ length: 501 }, (_, index) => String(index)) });
    assert.equal(result.plan.length, 200);
    assert.deepEqual(result.plan.at(-1), { kind: "event", eventId: "199" });
    assert.equal(result.favoriteProfileIds.length, 500);
    assert.equal(result.favoriteProfileIds.at(-1), "499");
  });

  it("keeps SSR and render snapshots stable without reading browser providers", () => {
    let reads = 0;
    const store = createPreferenceStore({ storage: () => { reads++; throw new Error("browser forbidden"); }, eventTarget: () => { reads++; throw new Error("browser forbidden"); } });
    assert.equal(store.getSnapshot(), store.getSnapshot());
    assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
    assert.deepEqual(store.getServerSnapshot().preferences, empty);
    assert.equal(reads, 0);
    store.dispose();
  });

  it("works without browser APIs and retains changes in session", () => {
    const store = createPreferenceStore({});
    const unsubscribe = store.subscribe(() => {});
    store.dispatch({ type: "add-favorite", profileId: "person" });
    assert.deepEqual(store.getSnapshot(), { preferences: { ...empty, favoriteProfileIds: ["person"] }, persistence: "session" });
    unsubscribe();
    store.dispose();
  });

  it("hydrates only on subscription and writes only bounded references to the versioned key", () => {
    const storage = new MemoryStorage();
    storage.values.set(PREFERENCE_STORAGE_KEY, JSON.stringify(saved));
    const store = createPreferenceStore({ storage, eventTarget: new EventTarget() });
    assert.deepEqual(store.getSnapshot().preferences, empty);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications++; });
    assert.deepEqual(store.getSnapshot(), { preferences: saved, persistence: "saved" });
    assert.deepEqual(store.getServerSnapshot().preferences, empty);
    const snapshot = store.getSnapshot();
    assert.equal(store.dispatch({ type: "add-favorite", profileId: "person" }).outcome, "unchanged");
    assert.equal(store.getSnapshot(), snapshot);
    store.dispatch({ type: "add-favorite", profileId: "club" });
    assert.deepEqual(JSON.parse(storage.getItem("vrdex.timeline.preferences.v1") ?? "null"), { ...saved, favoriteProfileIds: ["person", "club"] });
    assert.equal(notifications, 2);
    unsubscribe();
    store.dispose();
  });

  it("recovers invalid JSON as empty usable preferences", () => {
    const storage = new MemoryStorage();
    storage.values.set(PREFERENCE_STORAGE_KEY, "{");
    const store = createPreferenceStore({ storage });
    store.subscribe(() => {});
    assert.deepEqual(store.getSnapshot().preferences, empty);
    store.dispatch({ type: "add-favorite", profileId: "person" });
    assert.equal(store.getSnapshot().persistence, "saved");
    assert.deepEqual(JSON.parse(storage.getItem(PREFERENCE_STORAGE_KEY) ?? "null"), { ...empty, favoriteProfileIds: ["person"] });
    store.dispose();
  });

  it("keeps read failures and subsequent writes usable without losing session choices on resubscribe", () => {
    for (const storage of [
      () => { throw new Error("storage access denied"); },
      { getItem: () => { throw new Error("read denied"); }, setItem: () => { throw new Error("must remain session-only"); } },
    ]) {
      const store = createPreferenceStore({ storage });
      const unsubscribe = store.subscribe(() => {});
      store.dispatch({ type: "add-plan", reference: { kind: "event", eventId: "A" } });
      unsubscribe();
      const unsubscribeAgain = store.subscribe(() => {});
      assert.deepEqual(store.getSnapshot(), { preferences: { ...empty, plan: [{ kind: "event", eventId: "A" }] }, persistence: "session" });
      unsubscribeAgain();
      store.dispose();
    }
  });

  it("retains in-memory changes after quota failures and does not claim later external persistence", () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const target = new EventTarget();
    const store = createPreferenceStore({ storage, eventTarget: target });
    const unsubscribe = store.subscribe(() => {});
    store.dispatch({ type: "add-favorite", profileId: "person" });
    assert.equal(store.getSnapshot().persistence, "session");
    external(target, JSON.stringify(saved));
    assert.deepEqual(store.getSnapshot().preferences, { ...empty, favoriteProfileIds: ["person"] });
    store.dispatch({ type: "remove-favorite", profileId: "person" });
    assert.deepEqual(store.getSnapshot().preferences, empty);
    unsubscribe();
    store.dispose();
  });

  it("replaces independent stores with accepted cross-tab snapshots, including removals", () => {
    const target = new EventTarget();
    const first = createPreferenceStore({ storage: new MemoryStorage(), eventTarget: target });
    const second = createPreferenceStore({ storage: new MemoryStorage(), eventTarget: target });
    first.subscribe(() => {});
    second.subscribe(() => {});
    first.dispatch({ type: "add-favorite", profileId: "local" });
    external(target, JSON.stringify(saved));
    assert.deepEqual(first.getSnapshot().preferences, saved);
    assert.deepEqual(second.getSnapshot().preferences, saved);
    external(target, "{bad");
    external(target, JSON.stringify({ ...saved, version: 2 }));
    external(target, JSON.stringify(empty), "unrelated");
    assert.deepEqual(first.getSnapshot().preferences, saved);
    external(target, null);
    assert.deepEqual(first.getSnapshot().preferences, empty);
    external(target, JSON.stringify(saved));
    external(target, null, null);
    assert.deepEqual(second.getSnapshot().preferences, empty);
    first.dispose();
    second.dispose();
  });

  it("owns one listener and reattaches after StrictMode-style cleanup", () => {
    const target = new EventTarget();
    const store = createPreferenceStore({ storage: new MemoryStorage(), eventTarget: target });
    let notifications = 0;
    const listener = () => { notifications++; };
    const first = store.subscribe(listener);
    const second = store.subscribe(() => { notifications++; });
    external(target, JSON.stringify(saved));
    assert.equal(notifications, 2);
    first(); second();
    external(target, JSON.stringify(empty));
    assert.deepEqual(store.getSnapshot().preferences, saved);
    const third = store.subscribe(listener);
    external(target, JSON.stringify(saved));
    assert.deepEqual(store.getSnapshot().preferences, saved);
    store.dispose();
    external(target, JSON.stringify(empty));
    assert.deepEqual(store.getSnapshot().preferences, saved);
    third();
  });
});
