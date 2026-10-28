import assert from "node:assert/strict";
import { test } from "node:test";
import { createRelayPlaybackAdapter } from "../../apps/web/src/lib/relay-playback-adapter";
import type { Admission } from "../../packages/media-relay/src";
const request = {
  kind: "vrcdn",
  profileId: "profile",
  profileSlug: "dj",
  title: "DJ",
  href: "/dj",
  sourceId: "DJ",
  src: "https://legacy",
  transport: "mpegts",
} as const;
test("admission occurs only on Play and pending admission is released after Close", async () => {
  let opened = 0,
    released = "";
  let settle: (value: Admission) => void = () => {};
  const adapter = createRelayPlaybackAdapter({
    request,
    mode: "video",
    mount: {} as HTMLElement,
    notify() {},
    client: {
      open: () => {
        opened++;
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
      get: async () => ({ kind: "unavailable", reason: "unavailable" }),
      release: async (id) => {
        released = id;
      },
      refresh: async () => ({ kind: "unavailable", reason: "unavailable" }),
    },
  });
  assert.equal(opened, 0);
  const playing = adapter.play();
  assert.equal(opened, 1);
  adapter.dispose();
  settle({ kind: "preparing", grantId: "grant", retryAfterMs: 1 });
  assert.equal(await playing, false);
  assert.equal(released, "grant");
});
test("ready grant is reused for mode changes and metadata updates, paused admission never starts media", async () => {
  let opened = 0,
    created = 0,
    plays = 0;
  let settle: (value: Admission) => void = () => {};
  const ready: Admission = {
    kind: "ready",
    grant: {
      id: "grant",
      streamKey: "vrcdn/DJ/1",
      context: { kind: "profile", profileId: "profile", linkId: "DJ" },
      contextRevision: 1,
      issuedAt: 1,
      expiresAt: 9999999999999,
      renditions: ["video", "audio"],
    },
    videoPlaylist: "https://media/video.m3u8",
    audioPlaylist: "https://media/audio.m3u8",
    metadata: {
      displayName: "DJ",
      artworkAssetId: null,
      artworkRevision: null,
    },
  };
  const modes: string[] = [];
  const adapter = createRelayPlaybackAdapter({
    request,
    mode: "video",
    mount: {} as HTMLElement,
    notify() {},
    client: {
      open: () => {
        opened++;
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
      get: async () => ready,
      release: async () => {},
      refresh: async () => ready,
    },
    createNative: ({ mode }) => {
      created++;
      modes.push(mode);
      return {
        async play() {
          plays++;
          return true;
        },
        pause() {},
        async setMode(mode) {
          modes.push(mode);
          return true;
        },
        setVolume() {},
        setMuted() {},
        update() {},
        dispose() {},
      };
    },
  });
  const pending = adapter.play();
  adapter.pause();
  settle(ready);
  assert.equal(await pending, false);
  assert.equal(created, 0);
  assert.equal(plays, 0);
  await adapter.play();
  await adapter.setMode!("audio");
  adapter.update({ ...request, title: "Renamed" });
  assert.equal(opened, 1);
  assert.equal(created, 1);
  assert.deepEqual(modes, ["video", "audio"]);
  adapter.dispose();
});
test("foreground grant refresh is inactive while hidden and stops after cleanup", async () => {
  const { retainForegroundGrant } =
    await import("../../apps/web/src/lib/relay-playback-adapter");
  const visibility = new EventTarget();
  let visible = false,
    calls = 0;
  const stop = retainForegroundGrant(
    {
      refresh: async () => {
        calls++;
      },
    },
    visibility,
    () => visible,
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(calls, 0);
  visible = true;
  visibility.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  assert.equal(calls, 1);
  stop();
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(calls, 1);
});
test("deliberate resume after capability expiry uses ordinary admission again", async () => {
  let opened = 0,
    disposed = 0;
  const ready: Admission = {
    kind: "ready",
    grant: {
      id: "grant",
      streamKey: "vrcdn/DJ/1",
      context: { kind: "profile", profileId: "profile", linkId: "DJ" },
      contextRevision: 1,
      issuedAt: 1,
      expiresAt: Date.now() + 10,
      renditions: ["video", "audio"],
    },
    videoPlaylist: "https://media/video.m3u8",
    audioPlaylist: "https://media/audio.m3u8",
    metadata: {
      displayName: "DJ",
      artworkAssetId: null,
      artworkRevision: null,
    },
  };
  const adapter = createRelayPlaybackAdapter({
    request,
    mode: "video",
    mount: {} as HTMLElement,
    notify() {},
    client: {
      open: async () => {
        opened++;
        return opened === 1
          ? ready
          : { kind: "unavailable", reason: "unavailable" };
      },
      get: async () => ({ kind: "unavailable", reason: "unavailable" }),
      release: async () => {},
      refresh: async () => ready,
    },
    createNative: () => ({
      async play() {
        return true;
      },
      pause() {},
      setVolume() {},
      setMuted() {},
      update() {},
      dispose() {
        disposed++;
      },
    }),
  });
  await adapter.play();
  adapter.pause();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await adapter.play(), false);
  assert.equal(opened, 2);
  assert.equal(disposed, 1);
  adapter.dispose();
});
test("unsupported admission remains explicit and never creates a media transport", async () => {
  const states: unknown[] = [];
  let created = 0;
  const adapter = createRelayPlaybackAdapter({
    request,
    mode: "video",
    mount: {} as HTMLElement,
    notify: (state) => states.push(state),
    client: {
      open: async () => ({ kind: "unavailable", reason: "unsupported" }),
      get: async () => ({ kind: "unavailable", reason: "unsupported" }),
      release: async () => {},
      refresh: async () => ({ kind: "unavailable", reason: "unsupported" }),
    },
    createNative: () => {
      created++;
      throw Error("must not create");
    },
  });
  assert.equal(await adapter.play(), false);
  assert.equal(created, 0);
  assert.deepEqual(states, [
    { status: "unavailable", unavailableReason: "unsupported" },
  ]);
  adapter.dispose();
});
