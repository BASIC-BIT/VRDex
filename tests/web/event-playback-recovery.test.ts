import assert from "node:assert/strict";
import { test } from "node:test";
import { EventPlaybackOwner, type PlaybackRequest } from "../../apps/web/src/lib/event-playback-owner";
import { createTwitchAdapter, type TwitchSDK } from "../../apps/web/src/lib/twitch-player-adapter";
import { foregroundPlayback } from "../../apps/web/src/lib/foreground-playback";
import { createEventPlaybackAdapter } from "../../apps/web/src/lib/event-playback-adapters";
const request: PlaybackRequest = { kind: "vrcdn", eventId: "a", eventSlug: "a", title: "A", href: "/a", sourceId: "a", src: "a", transport: "video", startAt: Date.now() - 1000 };
class Video extends EventTarget {
  style = {}; src = ""; paused = true; muted = false; volume = 1; removed = false; listeners = 0;
  async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() {} load() {} remove() { this.removed = true; }
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>) { this.listeners++; super.addEventListener(...args); }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>) { this.listeners--; super.removeEventListener(...args); }
}
function dom() {
  const before = { document: globalThis.document, window: globalThis.window }; const nodes: Video[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement() { const node = new Video(); nodes.push(node); return node; } } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1200, location: { hostname: "localhost" } } });
  return { nodes, mount: { append() {} } as unknown as HTMLElement, restore() { Object.defineProperty(globalThis, "document", { configurable: true, value: before.document }); Object.defineProperty(globalThis, "window", { configurable: true, value: before.window }); } };
}
test("native browser pause, EOF, error and recovery update state; disposal removes listeners", async () => {
  const fixture = dom(); const owner = new EventPlaybackOwner((value, notify) => createEventPlaybackAdapter(value, fixture.mount, notify));
  try {
    await owner.play(request); const video = fixture.nodes[0]; video.pause(); assert.equal(owner.getSnapshot().status, "paused");
    let stoppedOther = false; foregroundPlayback.acquire({}, () => { stoppedOther = true; });
    await video.play(); assert.equal(owner.getSnapshot().status, "playing"); assert.equal(stoppedOther, true);
    video.dispatchEvent(new Event("ended")); assert.equal(owner.getSnapshot().status, "paused");
    video.dispatchEvent(new Event("error")); assert.equal(owner.getSnapshot().status, "unavailable");
    owner.close(); assert.equal(video.listeners, 0); video.dispatchEvent(new Event("playing")); assert.equal(owner.getSnapshot().status, "idle");
  } finally { owner.close(); fixture.restore(); }
});
test("Twitch SDK failure retry creates a recoverable adapter and restores viewer output", async () => {
  const fixture = dom(); let attempts = 0;
  const outputs: unknown[] = [];
  class Player {
    static READY = "ready"; static PLAYING = "playing"; static PAUSE = "pause"; static OFFLINE = "offline"; static PLAYBACK_BLOCKED = "blocked";
    callbacks = new Map<string, () => void>();
    addEventListener(key: string, callback: () => void) { this.callbacks.set(key, callback); if (key === "ready") queueMicrotask(callback); }
    removeEventListener(key: string) { this.callbacks.delete(key); }
    play() { this.callbacks.get("playing")?.(); } pause() {} setVolume(value: number) { outputs.push(value); } setMuted(value: boolean) { outputs.push(value); }
  }
  const load = async () => { if (++attempts === 1) throw new Error("SDK failed"); return { Player } as TwitchSDK; };
  const twitch: PlaybackRequest = { ...request, kind: "twitch", channel: "fixture" };
  const owner = new EventPlaybackOwner((value, notify) => createTwitchAdapter(value as Extract<PlaybackRequest, {kind:"twitch"}>, fixture.mount, notify, load));
  try { owner.setVolume(0.25); owner.setMuted(true); await owner.play(twitch); assert.equal(owner.getSnapshot().status, "unavailable"); owner.pause(); await owner.play(twitch); assert.equal(attempts, 2); assert.equal(owner.getSnapshot().status, "playing"); assert.equal(fixture.nodes[0].removed, true); assert.deepEqual(outputs, [0.25, true]); }
  finally { owner.close(); fixture.restore(); }
});

test("fatal MPEG-TS retry disposes failed transport before reattach and reapplies viewer output", async () => {
  const fixture = dom();
  const players: Array<{ callbacks: Map<string, () => void>; disposed: boolean }> = [];
  const mpegts = { isSupported: () => true, Events: { ERROR: "error", LOADING_COMPLETE: "complete" }, createPlayer() {
    const record = { callbacks: new Map<string, () => void>(), disposed: false }; players.push(record);
    return { on(key: string, callback: () => void) { record.callbacks.set(key, callback); }, attachMediaElement() {}, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() { record.disposed = true; } };
  } };
  const load = async () => ({ default: mpegts }) as unknown as typeof import("mpegts.js");
  const owner = new EventPlaybackOwner((value, notify) => createEventPlaybackAdapter(value, fixture.mount, notify, load));
  try {
    owner.setMuted(true); owner.setVolume(0.25);
    const stream: PlaybackRequest = { ...request, transport: "mpegts" };
    await owner.play(stream); players[0].callbacks.get("error")!(); fixture.nodes[0].pause();
    assert.equal(owner.getSnapshot().status, "unavailable");
    await owner.play(stream); assert.equal(players.length, 2); assert.equal(players[0].disposed, true);
    assert.equal(fixture.nodes[0].listeners, 0); assert.equal(fixture.nodes[1].muted, true); assert.equal(fixture.nodes[1].volume, 0.25);
    players[0].callbacks.get("error")!(); assert.equal(owner.getSnapshot().status, "playing");
  } finally { owner.close(); fixture.restore(); }
});

test("blocked playback retries the existing usable adapter", async () => {
  const fixture = dom(); let created = 0;
  const owner = new EventPlaybackOwner((value, notify) => {
    created++; const adapter = createEventPlaybackAdapter(value, fixture.mount, notify);
    const video = fixture.nodes.at(-1)!; const play = video.play.bind(video); let first = true;
    video.play = async () => { if (first) { first = false; throw new Error("autoplay blocked"); } await play(); };
    return adapter;
  });
  try { await owner.play(request); assert.equal(owner.getSnapshot().status, "blocked"); await owner.play(request); assert.equal(created, 1); assert.equal(owner.getSnapshot().status, "playing"); }
  finally { owner.close(); fixture.restore(); }
});
