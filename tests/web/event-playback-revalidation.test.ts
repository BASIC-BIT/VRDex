import assert from "node:assert/strict";
import { test } from "node:test";
import { EventPlaybackOwner, type PlaybackRequest } from "../../apps/web/src/lib/event-playback-owner";
import { retainPlaybackAuthorization } from "../../apps/web/src/lib/event-playback-revalidation";
const request = (id: string): PlaybackRequest => ({ kind: "vrcdn", eventId: id, eventSlug: id, href: id, title: id, sourceId: "a", src: "a", transport: "video", startAt: Date.now() - 1000 });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let disposed = 0;
  const owner = new EventPlaybackOwner(() => ({ async play() { return true; }, pause() {}, setVolume() {}, setMuted() {}, update() {}, dispose() { disposed++; } }));
  return { owner, disposed: () => disposed };
}
test("active authorization continues without route consumers and revocation disposes media", async () => {
  const { owner, disposed } = fixture(); await owner.play(request("a"));
  let resolve!: (value: PlaybackRequest | null) => void;
  const stop = retainPlaybackAuthorization(owner, () => new Promise(done => { resolve = done; }));
  resolve(null); await settle(); assert.equal(disposed(), 1); assert.equal(owner.getSnapshot().status, "unavailable"); stop();
});
test("late public response cannot revoke a replacement event", async () => {
  const { owner, disposed } = fixture(); await owner.play(request("a"));
  let resolve!: (value: PlaybackRequest | null) => void;
  const stop = retainPlaybackAuthorization(owner, () => new Promise(done => { resolve = done; }));
  await owner.play(request("b")); resolve(null); await settle();
  assert.equal(disposed(), 1); assert.equal(owner.getSnapshot().request?.eventId, "b"); stop(); owner.close();
});
test("failed and stalled public revalidation stop retained playback", async () => {
  for (const read of [async () => { throw new Error("offline"); }, () => new Promise<null>(() => {})]) {
    const { owner, disposed } = fixture(); await owner.play(request("a"));
    const stop = retainPlaybackAuthorization(owner, read, 15, 5);
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(disposed(), 1); stop(); owner.close();
  }
});
