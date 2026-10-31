import assert from "node:assert/strict";
import { test } from "node:test";
import { EventPlaybackOwner, type PlaybackSnapshot } from "../../apps/web/src/lib/event-playback-owner";
import { nowPlayingIdentity, applyNowPlaying, clearNowPlaying, retainNowPlaying } from "../../apps/web/src/lib/now-playing";
import { playbackArtwork } from "../../apps/web/src/lib/playback-metadata";

test("authoritative raw name formats once and revision changes artwork URL", () => {
  const state = { status: "playing", mode: "audio", volume: 1, muted: false, request: { kind: "vrcdn", profileId: "p", profileSlug: "dj", title: "DJ - VRDex", href: "/dj", sourceId: "AA", src: "url", transport: "mpegts" }, metadata: { displayName: "DJ", artworkAssetId: "asset", artworkRevision: "1" } } as const;
  assert.equal(nowPlayingIdentity(state)?.displayName, "DJ");
  assert.match(playbackArtwork(state)!, /revision=1&brand=/);
  assert.notEqual(playbackArtwork(state), playbackArtwork({ ...state, metadata: { ...state.metadata, artworkRevision: "2" } }));
  assert.equal(nowPlayingIdentity({ ...state, metadata: undefined }), null);
});

test("media session update and Close clear metadata and fence retained resume callbacks", async () => {
  const handlers = new Map();
  const session = { metadata: null, playbackState: "none", setActionHandler(action: string, handler: unknown) { handlers.set(action, handler); } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: session } });
  Object.defineProperty(globalThis, "MediaMetadata", { configurable: true, value: class { constructor(value: object) { Object.assign(this, value); } } });
  const request = { kind: "vrcdn", profileId: "p", profileSlug: "dj", title: "DJ - VRDex", href: "/dj", sourceId: "AA", src: "url", transport: "mpegts" } as const;
  let plays = 0;
  const owner = new EventPlaybackOwner(() => ({ play: async () => { plays++; return true; }, pause() {}, setVolume() {}, setMuted() {}, update() {}, dispose() {} }));
  await owner.play(request);
  applyNowPlaying({ identity: { displayName: "DJ", artwork: undefined }, mode: "audio", actions: { owner, generation: owner.generation } });
  assert.equal(session.metadata?.title, "DJ - VRDex");
  const oldResume = handlers.get("play");
  applyNowPlaying({ identity: { displayName: "DJ refreshed", artwork: undefined }, mode: "audio", actions: { owner, generation: owner.generation } });
  assert.equal(plays, 1, "metadata refresh must not reconnect");
  owner.close(); clearNowPlaying(); oldResume();
  assert.equal(plays, 1);
  assert.equal(session.metadata, null);
  assert.equal(handlers.get("play"), null);
  await owner.play({ ...request, sourceId: "BB" });
  oldResume();
  assert.equal(plays, 2, "a stale action cannot act on a replacement owner generation");
  owner.close();
});

test("installed current owns artwork during overtime and preparation", () => {
  const state: PlaybackSnapshot = { status: "playing", mode: "audio", volume: 1, muted: false,
    request: { kind: "performer_sequence", eventId: "event", eventSlug: "show", title: "Show", href: "/events/show", startAt: 1,
      event: { title: "Show", startAt: 1, slots: [{ key: "a", startAt: 1, endAt: 2, performerId: "dj-a", label: "A" }, { key: "b", startAt: 2, endAt: 3, performerId: "dj-b", label: "B" }] } },
    lineup: { current: "a", started: true, following: true, paused: false, muted: false, volume: 1, connected: true, unavailable: false }, metadata: { displayName: "DJ A", artworkAssetId: "asset", artworkRevision: "1" } };
  assert.match(playbackArtwork(state)!, /profiles\/dj-a\//);
  assert.equal(nowPlayingIdentity(state)?.displayName, "DJ A");
  assert.deepEqual(nowPlayingIdentity({ ...state, metadata: { displayName: "Show", artworkAssetId: null, artworkRevision: null } }), { displayName: "Show", artwork: "/brand/now-playing/neutral-wordmark-v1-512.png" });
});


test("retained owner publishes refresh without reconnect and Close clears native metadata automatically", async () => {
  const handlers = new Map();
  const session = { metadata: null, playbackState: "none", setActionHandler(action: string, handler: unknown) { handlers.set(action, handler); } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: session } });
  Object.defineProperty(globalThis, "MediaMetadata", { configurable: true, value: class { constructor(value: object) { Object.assign(this, value); } } });
  let plays = 0;
  let notify: Parameters<ConstructorParameters<typeof EventPlaybackOwner>[0]>[1];
  const owner = new EventPlaybackOwner((_request, update) => {
    notify = update;
    update({ metadata: { displayName: "DJ", artworkAssetId: null, artworkRevision: null } });
    return { play: async () => { plays++; return true; }, pause() {}, setVolume() {}, setMuted() {}, update() {}, dispose() {} };
  });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://vrdex.test" } });
  const stop = retainNowPlaying(owner);
  await owner.play({ kind: "vrcdn", profileId: "p", profileSlug: "dj", title: "DJ - VRDex", href: "/dj", sourceId: "AA", src: "url", transport: "mpegts" });
  assert.equal(session.metadata?.title, "DJ - VRDex");
  notify!({ metadata: { displayName: "DJ refreshed", artworkAssetId: null, artworkRevision: null } });
  assert.equal(session.metadata?.title, "DJ refreshed - VRDex");
  assert.deepEqual(session.metadata?.artwork, [{ src: "https://vrdex.test/brand/now-playing/neutral-wordmark-v1-512.png", sizes: "512x512", type: "image/png" }]);
  assert.equal(plays, 1);
  owner.close();
  assert.equal(session.metadata, null);
  assert.equal(handlers.get("play"), null);
  stop();
});
