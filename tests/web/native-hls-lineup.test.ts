import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeObservedSource } from "../../apps/web/src/lib/native-hls-observed-source";
import type { ReadyPlayback } from "../../apps/web/src/lib/native-hls-adapter";
const grant: ReadyPlayback = { kind: "ready", grant: { id: "grant", streamKey: "vrcdn/DJ/1", context: { kind: "event", eventId: "event", selectedSourceId: "slot" }, contextRevision: 1, issuedAt: 1, expiresAt: 9999999999999, renditions: ["video", "audio"] }, videoPlaylist: "https://media/video.m3u8", audioPlaylist: "https://media/audio.m3u8", metadata: { displayName: "DJ", artworkAssetId: null, artworkRevision: null } };
class Media extends EventTarget {
  src = ""; paused = true; muted = false; volume = 1; hidden = false; currentTime = 0; readyState = 3; ended = false; error = null;
  canPlayType() { return "probably"; }
  async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
  load() {} remove() {}
}
test("native observed media measures progress without Web Audio or invented levels", async () => {
  const before = globalThis.document;
  const audio = globalThis.AudioContext;
  const nodes: Media[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", createElement() { const n = new Media(); nodes.push(n); return n; } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: class { constructor() { throw Error("Native must not construct AudioContext"); } } });
  try {
    const source = await createNativeObservedSource({ grant, mode: "audio", isCurrent: () => true, mount: { append() {} } as unknown as HTMLElement });
    assert.equal(nodes.some(n => n.src), false);
    source.setMuted(true);
    assert.equal(await source.play(), true);
    for (let i = 1; i <= 3; i++) { nodes[1].currentTime = i; const sample = source.sample(i * 100, false); assert.deepEqual(sample.audioLevel, { kind: "unavailable" }); assert.equal(sample.progressing, true); }
    assert.equal(source.ready(), true);
    assert.equal(nodes[0].src, "");
    source.pause(); assert.equal(source.sample(400, true).progressing, false);
    source.release();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: before });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: audio });
  }
});

import { mock } from "node:test";
import { EventLineupSession, type LineupObservedSource } from "../../apps/web/src/lib/event-lineup-runtime";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const stream = (id: string) => ({ streamId: id, pcUrl: id, questUrl: id });
const slots = [{ key: "a", performerId: "a", label: "DJ A", startAt: 0, endAt: 60_000, stream: stream("AA") }, { key: "b", performerId: "b", label: "DJ B", startAt: 60_000, endAt: 120_000, stream: stream("BB") }];
async function fixture(run: (f: { session: EventLineupSession; sources: Array<LineupObservedSource & { muted: boolean; released: boolean; progressing: boolean; reject: boolean; plays: number }>; currentMetadata: string[]; visibility(value: string): void; step(wall: number, duration?: number): Promise<void> }) => Promise<void>, same = false) {
  const before = globalThis.document, ac = globalThis.AudioContext;
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  let wall = 0, clock = 0, tick = () => {};
  const sources: Array<LineupObservedSource & { muted: boolean; released: boolean; progressing: boolean; reject: boolean; plays: number }> = [];
  const currentMetadata: string[] = [];
  let session: EventLineupSession | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: class { constructor() { throw Error("Native WebAudio prohibited"); } } });
    mock.method(globalThis, "setInterval", callback => { tick = callback; return 1; }); mock.method(globalThis, "clearInterval", () => {});
    mock.method(Date, "now", () => wall); mock.method(performance, "now", () => clock);
    const eventSlots = same ? [slots[0], { ...slots[1], stream: slots[0].stream }] : slots;
    session = new EventLineupSession({ title: "Event", startAt: 0, endAt: 90_000, slots: eventSlots }, { append() {} } as unknown as HTMLElement, () => {}, undefined, {
      async create(slot, prepared, isCurrent, proof) {
        assert.equal(isCurrent(), true);
        if (prepared) assert.equal(proof, "grant-a");
        const source = { media: new Media() as unknown as HTMLMediaElement, grantId: `grant-${slot.key}`, muted: prepared, released: false, progressing: true, reject: false, plays: 0,
          async play() { source.plays++; return !source.reject && !source.released; }, pause() {}, release() { source.released = true; source.muted = true; }, setMuted(value: boolean) { source.muted = value; assert.ok(sources.filter(s => !s.released && !s.muted).length <= 1, "at most one audible source"); }, setVolume() {},
          sample(observedAt: number) { return { observedAt, progressing: source.progressing, analysisActive: document.visibilityState === "visible", paused: false, disconnected: !source.progressing, audioLevel: { kind: "unavailable" as const } }; }, ready() { return source.progressing; },
          async rebind() { return true; }, async recover() { return true; },
        };
        sources.push(source); return source;
      }, onCurrent(_source, slot) { currentMetadata.push(slot.key); },
    });
    await session.play(); await flush();
    await run({ session, sources, currentMetadata, visibility(value) { document.visibilityState = value; }, async step(at, duration = 100) { wall = at; for (let t = 0; t < duration; t += 100) { clock += 100; tick(); await flush(); } } });
  } finally { session?.dispose(); mock.restoreAll(); Object.defineProperty(globalThis, "document", { configurable: true, value: before }); Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: ac }); }
}
test("native foreground failure hands off at boundary, prepared metadata never claims current", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  await step(50_000, 400); assert.equal(sources.length, 2); assert.equal(sources[1].muted, true); assert.deepEqual(currentMetadata, ["a"]);
  sources[0].progressing = false; await step(50_000, 800); assert.equal(session.state.current, "a");
  await step(60_000, 600); assert.equal(session.state.current, "b"); assert.equal(sources[0].released, true); assert.equal(sources[1].muted, false); assert.deepEqual(currentMetadata, ["a", "b"]);
}));
test("native healthy overrun survives end and hidden documents never prepare or hand off", () => fixture(async ({ session, sources, visibility, step }) => {
  visibility("hidden"); await step(60_000, 2500); assert.equal(sources.length, 1); assert.equal(session.state.current, "a"); assert.equal(sources[0].released, false);
  visibility("visible"); await step(95_000, 2000); assert.equal(sources.length, 2); assert.equal(session.state.current, "a"); assert.equal(sources[0].released, false);
  visibility("hidden"); sources[0].progressing = false; await step(95_000, 2500); assert.equal(session.state.current, "a"); assert.equal(sources[1].released, true);
}));
test("blocked native promotion retains old owner and requires explicit enable gesture", () => fixture(async ({ session, sources, step }) => {
  await step(50_000, 400); sources[1].reject = true; sources[0].progressing = false;
  await step(60_000, 1400); assert.equal(session.state.nextPlaybackBlocked, true); assert.equal(session.state.current, "a"); assert.equal(sources[1].muted, true); assert.equal(sources[0].released, false);
  const plays = sources[1].plays; await step(60_000, 2500); assert.equal(sources[1].plays, plays);
  sources[1].reject = false; session.retryNextPlayback(); await flush(); assert.equal(session.state.current, "b"); assert.equal(sources[0].released, true); assert.equal(sources[1].muted, false);
}));
test("native projection revocation releases both transports and requires a new gesture", () => fixture(async ({ session, sources, step }) => {
  await step(50_000, 400); session.update({ title: "Event", startAt: 0, slots: [slots[1]] });
  assert.equal(sources.every(s => s.released), true); assert.equal(session.state.paused, true); assert.equal(session.state.unavailable, true);
}));
test("native same-source identity advances authorization without replacing media", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  await step(60_000, 400); assert.equal(session.state.current, "b"); assert.equal(sources.length, 1); assert.equal(sources[0].released, false); assert.deepEqual(currentMetadata, ["a", "b"]);
}, true));

import { createNativeLineupAdapter } from "../../apps/web/src/lib/native-lineup-adapter";
import type { RelayPlaybackClient } from "../../apps/web/src/lib/relay-playback-adapter";
import type { PlaybackRequest } from "../../apps/web/src/lib/event-playback-owner";
async function adapterFixture(run: (f: { adapter: ReturnType<typeof createNativeLineupAdapter>; nodes: Media[]; opened: Array<{ key: string; proof?: string }>; released: string[]; step(wall: number, duration?: number): Promise<void>; visibility(value: string): void; deferGet(): () => void }) => Promise<void>) {
  const before = globalThis.document;
  let wall = 0, clock = 0, tick = () => {};
  const nodes: Media[] = [], opened: Array<{ key: string; proof?: string }> = [], released: string[] = [];
  let getWait: Promise<void> | undefined;
  const admissions = new Map<string, ReadyPlayback>();
  const doc = { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement() { const n = new Media(); nodes.push(n); return n; } };
  const request: Extract<PlaybackRequest, { kind: "performer_sequence" }> = { kind: "performer_sequence", eventId: "event", eventSlug: "event", title: "Event", href: "/events/event", startAt: 0, endAt: 90_000, event: { title: "Event", startAt: 0, endAt: 90_000, slots } };
  const client: RelayPlaybackClient = {
    async open(context, streamId, _mode, proof) { assert.equal(context.kind, "event"); if (context.kind !== "event") throw Error("event only"); opened.push({ key: context.selectedSourceId, proof }); const value: ReadyPlayback = { ...grant, grant: { ...grant.grant, id: `grant-${context.selectedSourceId}`, context, streamKey: `vrcdn/${streamId}/1` }, metadata: { ...grant.metadata, displayName: context.selectedSourceId } }; admissions.set(value.grant.id, value); return value; },
    async get(id) { await getWait; return admissions.get(id); }, async restart(id) { return admissions.get(id); }, async refresh(id) { return admissions.get(id); }, async release(id) { released.push(id); },
  };
  let adapter: ReturnType<typeof createNativeLineupAdapter> | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
    mock.method(globalThis, "setInterval", cb => { tick = cb; return 1; }); mock.method(globalThis, "clearInterval", () => {}); mock.method(Date, "now", () => wall); mock.method(performance, "now", () => clock);
    adapter = createNativeLineupAdapter({ request, mount: { append() {} } as unknown as HTMLElement, notify() {}, mode: "audio", client });
    assert.equal(opened.length, 0, "mount never opens a grant");
    await adapter.play(); await flush();
    await run({ adapter, nodes, opened, released, visibility(value) { doc.visibilityState = value; }, async step(at, duration = 100) { wall = at; for (let t = 0; t < duration; t += 100) { clock += 100; nodes.forEach(n => { if (!n.paused) n.currentTime += 0.1; }); tick(); await flush(); } }, deferGet() { let finish!: () => void; getWait = new Promise(resolve => { finish = resolve; }); return finish; } });
  } finally { adapter?.dispose(); mock.restoreAll(); Object.defineProperty(globalThis, "document", { configurable: true, value: before }); }
}
test("real native lineup adapter keeps prepared muted and respects native pause", () => adapterFixture(async ({ adapter, nodes, opened, released, step }) => {
  await step(50_000, 500); assert.deepEqual(opened, [{ key: "a", proof: undefined }, { key: "b", proof: "grant-a" }]);
  assert.equal(nodes[1].muted, false); assert.equal(nodes[3].muted, true);
  nodes[1].pause(); // OS/native pause must stop the coordinator instead of reconnecting.
  await step(60_000, 1400); assert.equal(opened.length, 2); assert.ok(released.includes("grant-b"));
  await adapter.play(); await step(60_000, 1400);
  assert.equal(adapter.media, nodes[1]); assert.equal(nodes[1].paused, false);
}));
test("pause fences an in-flight automatic native media recovery", () => adapterFixture(async ({ adapter, nodes, step, deferGet }) => {
  await step(0, 500); const finish = deferGet();
  nodes[1].currentTime = 0; nodes[1].readyState = 0;
  await step(0, 1400); adapter.pause(); finish(); await flush();
  assert.equal(nodes.length, 4, "recovery must not construct replacement media after pause");
  assert.equal(nodes.every(n => n.paused), true);
}));
test("real native failure promotes decoded audio and releases the old context grant", () => adapterFixture(async ({ adapter, nodes, released, step }) => {
  await step(50_000, 500); nodes[1].readyState = 0;
  await step(60_000, 1400);
  assert.equal(adapter.media, nodes[3]); assert.ok(released.includes("grant-a"));
  assert.equal(nodes[1].paused, true); assert.equal(nodes[3].muted, false);
}));
test("native audio mode remains selected through a DJ handoff", () => adapterFixture(async ({ adapter, nodes, step }) => {
  await step(50_000, 500); nodes[1].readyState = 0; await step(60_000, 1400);
  assert.equal(adapter.media, nodes[3]); assert.equal(nodes[2].src, ""); assert.ok(nodes[3].src.endsWith("audio.m3u8"));
}));

test("close releases a grant that arrives after native lineup admission was cancelled", async () => {
  const before = globalThis.document;
  const released: string[] = [];
  let finish!: (value: ReadyPlayback) => void;
  const pending = new Promise<ReadyPlayback>(resolve => { finish = resolve; });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
  const request: Extract<PlaybackRequest, { kind: "performer_sequence" }> = { kind: "performer_sequence", eventId: "event", eventSlug: "event", title: "Event", href: "/events/event", startAt: Date.now() - 1000, event: { title: "Event", startAt: Date.now() - 1000, slots: [{ ...slots[0], startAt: Date.now() - 1000, endAt: Date.now() + 10000 }] } };
  const client: RelayPlaybackClient = { open: () => pending, get: async () => grant, refresh: async () => grant, restart: async () => grant, release: async id => { released.push(id); } };
  const adapter = createNativeLineupAdapter({ request, mount: {} as HTMLElement, notify() {}, mode: "audio", client });
  try {
    await adapter.play(); adapter.dispose(); finish(grant); await flush();
    assert.deepEqual(released, [grant.grant.id]);
  } finally { adapter.dispose(); Object.defineProperty(globalThis, "document", { configurable: true, value: before }); }
});
test("a queued manual same-source choice supersedes an unresolved scheduled rebind", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const rebound: string[] = [];
  mock.method(sources[0], "rebind", async target => { rebound.push(target.key); return rebound.length === 1 ? pending : true; });
  await step(60_000); session.manual("a"); finish(true); await flush(); await flush();
  assert.deepEqual(rebound, ["b", "a"]); assert.equal(session.state.current, "a"); assert.equal(session.state.following, false); assert.deepEqual(currentMetadata, ["a", "a"]);
}, true));
test("hidden rebind completion cannot advance current metadata", () => fixture(async ({ session, sources, step, currentMetadata, visibility }) => {
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  mock.method(sources[0], "rebind", () => pending);
  await step(60_000); visibility("hidden"); finish(true); await flush();
  assert.equal(session.state.current, "a"); assert.deepEqual(currentMetadata, ["a"]);
  visibility("visible"); await step(60_000); assert.equal(session.state.current, "b");
}, true));
test("denied same-source rebind pauses without claiming the target identity", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  mock.method(sources[0], "rebind", async () => false); await step(60_000);
  assert.equal(session.state.paused, true); assert.equal(session.state.unavailable, true); assert.equal(session.state.current, "a"); assert.deepEqual(currentMetadata, ["a"]);
}, true));
test("pause cancels unresolved native promotion and restores retained current mute intent", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  await step(50_000, 400);
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  mock.method(sources[1], "play", () => pending); sources[0].progressing = false;
  await step(60_000, 1200); session.pause(); finish(true); await flush();
  assert.equal(session.state.paused, true); assert.equal(session.state.current, "a"); assert.equal(sources[0].muted, false); assert.equal(sources[1].released, true); assert.equal(sources[1].muted, true); assert.deepEqual(currentMetadata, ["a"]);
}));
test("current recovery during unresolved native promotion preserves the healthy current", () => fixture(async ({ session, sources, step, currentMetadata }) => {
  await step(50_000, 400);
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  mock.method(sources[1], "play", () => pending); sources[0].progressing = false;
  await step(60_000, 1200); sources[0].progressing = true; await step(60_000, 400); finish(true); await flush();
  assert.equal(session.state.current, "a"); assert.equal(sources[0].released, false); assert.equal(sources[0].muted, false); assert.equal(sources[1].muted, true); assert.deepEqual(currentMetadata, ["a"]);
}));

async function reviewFixture(run: (f: { adapter: ReturnType<typeof createNativeLineupAdapter>; client: RelayPlaybackClient; nodes: Media[]; released: string[]; states: Array<Parameters<import("../../apps/web/src/lib/event-playback-owner").AdapterNotify>[0]>; admissions: Map<string, ReadyPlayback>; step(at: number, duration?: number): Promise<void> }) => Promise<void>, sameStream = false) {
  const before = globalThis.document;
  let wall = 0, clock = 0, tick = () => {};
  const nodes: Media[] = [], released: string[] = [];
  const states: Array<Parameters<import("../../apps/web/src/lib/event-playback-owner").AdapterNotify>[0]> = [];
  const admissions = new Map<string, ReadyPlayback>();
  const sequence = ["a", "b", "c"].map((key, index) => ({ key, performerId: key, label: key, startAt: index * 3600_000, endAt: (index + 1) * 3600_000, stream: stream(sameStream ? "Shared" : `Source${key}`) }));
  const request: Extract<PlaybackRequest, { kind: "performer_sequence" }> = { kind: "performer_sequence", eventId: "event", eventSlug: "event", title: "Event", href: "/events/event", startAt: 0, endAt: 90_000, event: { title: "Event", startAt: 0, endAt: 90_000, slots: sequence } };
  const client: RelayPlaybackClient = {
    async open(context, streamId, _mode, proof) {
      if (context.kind !== "event") throw Error("event required");
      if (wall >= 90_000 && (!proof || released.includes(proof))) return { kind: "unavailable", reason: "unavailable" };
      const ready: ReadyPlayback = { ...grant, grant: { ...grant.grant, id: `grant-${context.selectedSourceId}`, context, streamKey: `vrcdn/${streamId}/1` }, metadata: { ...grant.metadata, displayName: context.selectedSourceId } };
      admissions.set(ready.grant.id, ready); return ready;
    },
    async get(id) { return admissions.get(id); }, async restart(id) { return admissions.get(id); }, async refresh(id) { return admissions.get(id); }, async release(id) { released.push(id); },
    async rebind(id, target, expected, revision) {
      const current = admissions.get(id);
      if (!current || current.grant.context.kind !== "event" || current.grant.context.selectedSourceId !== expected || current.grant.contextRevision !== revision) return { kind: "denied" };
      const next: ReadyPlayback = { ...current, grant: { ...current.grant, context: { ...current.grant.context, selectedSourceId: target }, contextRevision: revision + 1 }, metadata: { ...current.metadata, displayName: target } };
      admissions.set(id, next); return { kind: "rebound", grant: next.grant, metadata: next.metadata };
    },
  };
  let adapter: ReturnType<typeof createNativeLineupAdapter> | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement() { const node = new Media(); nodes.push(node); return node; } } });
    mock.method(globalThis, "setInterval", callback => { tick = callback; return 1; }); mock.method(globalThis, "clearInterval", () => {}); mock.method(Date, "now", () => wall); mock.method(performance, "now", () => clock);
    adapter = createNativeLineupAdapter({ request, mount: { append() {} } as unknown as HTMLElement, notify: patch => states.push(patch), mode: "audio", client });
    await adapter.play(); await flush();
    await run({ adapter, client, nodes, released, states, admissions, async step(at, duration = 100) { wall = at; for (let t = 0; t < duration; t += 100) { clock += 100; nodes.forEach(node => { if (!node.paused) node.currentTime += 0.1; }); tick(); await flush(); } } });
  } finally { adapter?.dispose(); mock.restoreAll(); Object.defineProperty(globalThis, "document", { configurable: true, value: before }); }
}
for (const operation of ["refresh", "recovery"] as const) test(`delayed ${operation} A cannot overwrite rebind B or poison subsequent C CAS`, () => reviewFixture(async ({ adapter, client, nodes, states, admissions, step }) => {
  await step(0, 400);
  const captured = admissions.get("grant-a")!;
  let finish!: (value: ReadyPlayback) => void;
  const pending = new Promise<ReadyPlayback>(resolve => { finish = resolve; });
  let refreshing: Promise<void> | undefined;
  if (operation === "refresh") { mock.method(client, "refresh", () => pending); refreshing = adapter.refresh!(); }
  else { mock.method(client, "get", () => pending); nodes[1].readyState = 0; await step(0, 1400); }
  adapter.manual!("b"); await flush();
  finish(captured); await refreshing; await flush();
  const metadata = () => states.filter(patch => "metadata" in patch).at(-1)?.metadata?.displayName;
  assert.equal(metadata(), "b"); assert.equal(adapter.media?.title, "b - VRDex");
  adapter.manual!("c"); await flush();
  assert.equal(metadata(), "c"); assert.equal(admissions.get("grant-a")?.grant.context.kind === "event" && admissions.get("grant-a")?.grant.context.selectedSourceId, "c");
}, true));
test("manual target deferred then denied clears installed-current metadata immediately", () => reviewFixture(async ({ adapter, client, states }) => {
  let finish!: (value: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  mock.method(client, "open", () => pending);
  adapter.manual!("b"); await flush();
  assert.equal(adapter.media, undefined);
  assert.equal(states.filter(patch => "metadata" in patch).at(-1)?.metadata, undefined);
  finish({ kind: "unavailable", reason: "unavailable" }); await flush();
  assert.equal(states.filter(patch => "metadata" in patch).at(-1)?.metadata, undefined);
}));
test("manual postwindow different-stream admission retains silent proof until target installation", () => reviewFixture(async ({ adapter, client, nodes, released, states, step }) => {
  await step(100_000, 400);
  const original = client.open.bind(client);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let proof: string | undefined;
  mock.method(client, "open", async (context, streamId, mode, continuation) => { proof = continuation; await pending; return original(context, streamId, mode, continuation); });
  adapter.manual!("b"); await flush();
  assert.equal(proof, "grant-a"); assert.equal(nodes[1].paused, true); assert.equal(released.includes("grant-a"), false);
  finish(); await flush(); await flush();
  assert.equal(states.filter(patch => "metadata" in patch).at(-1)?.metadata?.displayName, "b"); assert.equal(released.includes("grant-a"), true);
}));
for (const action of ["pause", "close", "supersede"] as const) test(`manual continuation ${action} cancels old admission and releases every stale grant`, () => reviewFixture(async ({ adapter, client, released, states, step }) => {
  await step(100_000, 400);
  const original = client.open.bind(client);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  mock.method(client, "open", async (context, streamId, mode, proof) => {
    const result = await original(context, streamId, mode, proof);
    if (context.kind === "event" && context.selectedSourceId === "b") await pending;
    return result;
  });
  adapter.manual!("b"); await flush();
  assert.equal(released.includes("grant-a"), false);
  if (action === "pause") adapter.pause();
  if (action === "close") adapter.dispose();
  if (action === "supersede") { adapter.manual!("c"); await flush(); await flush(); }
  assert.equal(released.includes("grant-a"), true);
  finish(); await flush(); await flush();
  assert.ok(released.includes("grant-b"), "late admitted target capability must be released");
  if (action === "supersede") assert.equal(states.filter(patch => "metadata" in patch).at(-1)?.metadata?.displayName, "c");
  else { assert.equal(adapter.media, undefined); assert.equal(states.filter(patch => "metadata" in patch).at(-1)?.metadata, undefined); }
}));
