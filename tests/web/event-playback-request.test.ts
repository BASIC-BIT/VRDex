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
