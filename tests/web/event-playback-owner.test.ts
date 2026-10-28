import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EventPlaybackOwner,
  type PlaybackAdapter,
  type PlaybackRequest,
} from "../../apps/web/src/lib/event-playback-owner";
const request = (eventId = "a", src = "https://stream/a"): PlaybackRequest => ({
  kind: "vrcdn",
  eventId,
  eventSlug: eventId,
  title: eventId,
  href: `/events/${eventId}`,
  sourceId: "source",
  src,
  transport: "mpegts",
  startAt: Date.now() - 1000,
});
function fixture() {
  const adapters: Array<
    PlaybackAdapter & {
      disposed: number;
      pauses: number;
      plays: number;
      resolve: (accepted: boolean) => void;
    }
  > = [];
  const owner = new EventPlaybackOwner((_request, notify) => {
    let resolve = (_: boolean) => {};
    const pending = new Promise<boolean>((done) => {
      resolve = done;
    });
    const adapter = {
      disposed: 0,
      pauses: 0,
      plays: 0,
      resolve,
      play() {
        this.plays++;
        return pending;
      },
      pause() {
        this.pauses++;
      },
      setVolume() {},
      setMuted() {},
      update() {},
      dispose() {
        this.disposed++;
      },
      notify,
    };
    adapters.push(adapter);
    return adapter;
  });
  return { owner, adapters };
}
test("rapid replacement disposes before starting; old async completion cannot change new state", async () => {
  const { owner, adapters } = fixture();
  const first = owner.play(request());
  const second = owner.play(request("b"));
  assert.equal(adapters[0].disposed, 1);
  adapters[1].resolve(true);
  await second;
  adapters[0].resolve(false);
  await first;
  assert.equal(owner.getSnapshot().request?.eventId, "b");
  assert.equal(owner.getSnapshot().status, "playing");
  owner.close();
});
test("same event repeated Play and metadata refresh retain adapter; browsing cannot replace it", async () => {
  const { owner, adapters } = fixture();
  const playing = owner.play(request());
  await owner.play(request());
  owner.update({ ...request(), title: "renamed" });
  owner.update(request("b"));
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0].plays, 1);
  adapters[0].resolve(true);
  await playing;
  assert.equal(owner.getSnapshot().request?.title, "renamed");
  owner.close();
});
test("autoplay rejection, pause during load, and close ignore stale completions", async () => {
  const { owner, adapters } = fixture();
  const playing = owner.play(request());
  adapters[0].resolve(false);
  await playing;
  assert.equal(owner.getSnapshot().status, "blocked");
  owner.close();
  const pending = owner.play(request("b"));
  owner.pause();
  adapters[1].resolve(true);
  await pending;
  assert.equal(owner.getSnapshot().status, "paused");
  assert.equal(adapters[1].pauses, 1);
  owner.close();
  owner.close();
  assert.equal(adapters[1].disposed, 1);
});
test("revocation and same-ID URL replacement release old transport; late projection is fenced", async () => {
  const { owner, adapters } = fixture();
  const pending = owner.play(request());
  const generation = owner.generation;
  owner.update(request("a", "https://stream/new"));
  assert.equal(adapters[0].disposed, 1);
  adapters[0].resolve(true);
  await pending;
  assert.equal(owner.getSnapshot().status, "paused");
  const next = owner.play(request("b"));
  owner.revalidate(null, generation);
  assert.equal(owner.getSnapshot().request?.eventId, "b");
  owner.revalidate(null, owner.generation);
  assert.equal(adapters[1].disposed, 1);
  adapters[1].resolve(true);
  await next;
  assert.equal(owner.getSnapshot().status, "unavailable");
  owner.close();
});
test("end blocks fresh Play but does not cut off ongoing authorized playback", async () => {
  const { owner, adapters } = fixture();
  await owner.play({ ...request(), endAt: 1 });
  assert.equal(adapters.length, 0);
  const pending = owner.play(request());
  adapters[0].resolve(true);
  await pending;
  owner.update({ ...request(), endAt: 1 });
  assert.equal(adapters[0].disposed, 0);
  owner.pause();
  await owner.play({ ...request(), endAt: 1 });
  assert.equal(owner.getSnapshot().status, "playing");
  owner.close();
});
test("volume and mute control only viewer output; pause delegates prepared-input release", async () => {
  const { owner, adapters } = fixture();
  const pending = owner.play(request());
  adapters[0].resolve(true);
  await pending;
  owner.setVolume(0.2);
  owner.setMuted(true);
  owner.pause();
  assert.equal(owner.getSnapshot().volume, 0.2);
  assert.equal(owner.getSnapshot().muted, true);
  assert.equal(adapters[0].pauses, 1);
  owner.close();
});
test("suspend disposes transport while retaining a retryable request and fences pending Play", async () => {
  const { owner, adapters } = fixture();
  const pending = owner.play(request());
  owner.suspend();
  assert.equal(adapters[0].disposed, 1);
  adapters[0].resolve(true);
  await pending;
  assert.equal(owner.getSnapshot().status, "paused");
  assert.equal(owner.getSnapshot().request?.eventId, "a");
  const retry = owner.play(request());
  assert.equal(adapters.length, 2);
  adapters[1].resolve(true);
  await retry;
  assert.equal(owner.getSnapshot().status, "playing");
  owner.close();
});
test("public profile bypasses event calendar and mode changes do not admit a second source", async () => {
  const { owner, adapters } = fixture();
  const profile: PlaybackRequest = {
    kind: "vrcdn",
    profileId: "profile",
    profileSlug: "dj",
    title: "DJ",
    href: "/dj",
    sourceId: "source",
    src: "https://stream/a",
    transport: "mpegts",
  };
  const playing = owner.play(profile);
  assert.equal(adapters.length, 1);
  adapters[0].resolve(true);
  await playing;
  await owner.setMode("audio");
  assert.equal(adapters.length, 1);
  assert.equal(owner.getSnapshot().mode, "audio");
  owner.close();
});
test("mode completion cannot override newer selection, pause or close", async () => {
  const pending: Array<(value: boolean) => void> = [];
  let calls = 0;
  const owner = new EventPlaybackOwner(() => ({
    async play() {
      return true;
    },
    pause() {},
    setVolume() {},
    setMuted() {},
    update() {},
    dispose() {},
    setMode() {
      calls++;
      return new Promise((resolve) => pending.push(resolve));
    },
  }));
  await owner.play(request());
  const first = owner.setMode("audio");
  const second = owner.setMode("video");
  pending[1](true);
  await second;
  pending[0](false);
  await first;
  assert.equal(owner.getSnapshot().status, "playing");
  assert.equal(owner.getSnapshot().mode, "video");
  const paused = owner.setMode("audio");
  owner.pause();
  pending[2](true);
  await paused;
  assert.equal(owner.getSnapshot().status, "paused");
  const closed = owner.setMode("video");
  owner.close();
  pending[3](true);
  await closed;
  assert.equal(owner.getSnapshot().status, "idle");
  assert.equal(calls, 4);
});
test("new owner restores mode across DJ/route replacement without autoplay", async () => {
  const { writePlaybackMode } =
    await import("../../apps/web/src/lib/playback-mode");
  writePlaybackMode(undefined, "audio");
  let created = 0;
  const owner = new EventPlaybackOwner(() => {
    created++;
    throw Error("must not create");
  });
  assert.equal(owner.getSnapshot().mode, "audio");
  assert.equal(owner.getSnapshot().status, "idle");
  assert.equal(created, 0);
  owner.close();
  writePlaybackMode(undefined, "video");
});

test("retained retry clears the previous unsupported reason before later native errors", async () => {
  let notify: import("../../apps/web/src/lib/event-playback-owner").AdapterNotify =
    () => {};
  const owner = new EventPlaybackOwner((_request, changed) => {
    notify = changed;
    return {
      async play() {
        return true;
      },
      async retry() {
        return true;
      },
      pause() {},
      setVolume() {},
      setMuted() {},
      update() {},
      dispose() {},
    };
  });
  await owner.play(request());
  notify({ status: "unavailable", unavailableReason: "unsupported" });
  await owner.play(request());
  notify({ status: "unavailable" });
  assert.equal(owner.getSnapshot().unavailableReason, undefined);
  owner.close();
});
