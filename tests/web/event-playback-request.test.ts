import assert from "node:assert/strict";
import { test } from "node:test";
import { eventPlaybackRequest } from "../../apps/web/src/lib/event-playback-request";
import type { PublicEvent } from "../../apps/web/src/app/_components/event-public-page";
const event = { id: "id", slug: "event", communitySlug: "host", title: "Event", watchSurfaceEnabled: true, startAt: 1, endAt: 2, mediaLinks: [{ type: "watch", label: "Watch", url: "https://twitch.tv/fixture", presentation: "open" }], slots: [] } as unknown as PublicEvent;
test("public projection authorization rejects removed/private, cancelled, disabled and date-only events", () => {
  for (const value of [null, { ...event, status: "cancelled" as const }, { ...event, watchSurfaceEnabled: false }, { ...event, scheduleKind: "date_only" as const }, { ...event, mediaLinks: [] }]) assert.equal(eventPlaybackRequest(value), null);
});
test("calendar end alone does not revoke active event and metadata retains stable event identity", () => {
  const value = eventPlaybackRequest(event);
  assert.equal(value?.kind, "twitch"); assert.equal(value?.eventId, "id"); assert.equal(value?.href, "/host/events/event"); assert.equal(value?.endAt, 2);
});
test("sequence projection preserves repeated appearances and missing streams", () => {
  const value = eventPlaybackRequest({ ...event, watchMode: "performer_sequence", slots: [
    { playbackKey: "slot-a", startAt: 1, displayLabel: "Same", performer: { slug: "same" } },
    { playbackKey: "slot-b", startAt: 2, displayLabel: "Same", performer: { slug: "same" } },
  ] as PublicEvent["slots"] });
  assert.equal(value?.kind, "performer_sequence");
  if (value?.kind === "performer_sequence") assert.deepEqual(value.event.slots.map(slot => slot.key), ["slot-a", "slot-b"]);
});
test('profile request retains canonical case and rejects removed links without calendar gates',async()=>{
 const {profilePlaybackRequest}=await import('../../apps/web/src/lib/event-playback-request');
 const profile={id:'profile',slug:'dj',displayName:'DJ Name',outboundLinks:[{type:'vrcdn',url:'vrcdn:Alpha'}]};
 const value=profilePlaybackRequest(profile,'Alpha');assert.equal(value?.title,'DJ Name - VRDex');assert.equal(value?.sourceId,'Alpha');assert.equal(value?.startAt,undefined);
 assert.equal(profilePlaybackRequest(profile,'alpha'),null);assert.equal(profilePlaybackRequest({...profile,outboundLinks:[]},'Alpha'),null);
});

const playableSlot = { playbackKey: "slot-a", position: 0, startAt: 1, displayLabel: "DJ", roleLabel: "DJ", discord: {}, source: { sourceType: "community", label: "Community" }, stream: { streamId: "dj", pcUrl: "pc", questUrl: "quest" } } as PublicEvent["slots"][number];
test("community lineup watching is automatic without staff watch settings", () => {
  const request = eventPlaybackRequest({ ...event, watchSurfaceEnabled: false, slots: [playableSlot] });
  assert.equal(request?.kind, "performer_sequence");
  assert.equal(request && "localOnly" in request && request.localOnly, true);
});
test("automatic watching keeps gaps and requires an actual public playable source", () => {
  assert.equal(eventPlaybackRequest({ ...event, watchSurfaceEnabled: false, slots: [{ ...playableSlot, stream: undefined }] }), null);
  const request = eventPlaybackRequest({ ...event, watchSurfaceEnabled: false, slots: [playableSlot, { ...playableSlot, playbackKey: "gap", startAt: 2, stream: undefined }] });
  assert.equal(request?.kind === "performer_sequence" && request.event.slots.length, 2);
});


test("canonical untimed rows block progression without losing later public sources", () => {
  const later = { ...playableSlot, playbackKey: "slot-b", position: 2, startAt: 10 };
  const request = eventPlaybackRequest({ ...event, endAt: 20, watchSurfaceEnabled: false,
    slots: [playableSlot, later], lineup: [
      { ...playableSlot, key: "slot-a" },
      { key: "unknown", position: 1, displayLabel: "Guest", roleLabel: "DJ" },
      { ...later, key: "slot-b" },
    ] });
  assert.equal(request?.kind, "performer_sequence");
  if (request?.kind !== "performer_sequence") return;
  assert.equal(request.event.slots[0].endAt, undefined);
  assert.equal(request.event.slots[0].followingBlocked, true);
  assert.equal(request.event.slots[1].endAt, 20);
});


test("enabled explicit event streams take precedence over playable performers", () => {
  const request = eventPlaybackRequest({ ...event, watchMode: "event_stream", slots: [playableSlot] });
  assert.equal(request?.kind, "twitch");
});
