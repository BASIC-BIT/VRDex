import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiEventCreateRequestSchema, ApiEventUpdateRequestSchema, PublicEventSchema } from "../src/schemas";

it("accepts date-only public schedules and rejects an invented instant", () => {
  const event = { id: "date", slug: "july", title: "July", scheduleKind: "date_only", eventDate: "2026-07-04",
    source: { label: "Community", sourceType: "community" }, watchSurfaceEnabled: false };
  assert.equal(PublicEventSchema.safeParse(event).success, true);
  assert.equal(PublicEventSchema.safeParse({ ...event, startAt: 1783123200000 }).success, false);
  assert.equal(PublicEventSchema.safeParse({ ...event, eventDate: "2026-02-30" }).success, false);
  assert.equal(PublicEventSchema.safeParse({ ...event, scheduleKind: "timed" }).success, false);
});

it("accepts an unconfirmed world on a contributed public event", () => {
  const event = { id: "event", slug: "night", title: "Night", scheduleKind: "date_only", eventDate: "2027-10-15",
    source: { label: "Contributor", sourceType: "contributor" }, watchSurfaceEnabled: false,
    worlds: [{ slug: "world", displayName: "World", tags: [], association: { sourceType: "contributor", confirmationState: "unconfirmed" } }] };
  assert.equal(PublicEventSchema.safeParse(event).success, true);
});

it("accepts owner date-only corrections and canonical lineup replacement", () => {
  const patch = { scheduleKind: "date_only", eventDate: "2027-10-15", venueLabel: "Harbor", lineup: [{ clientKey: "guest", position: 0, performerLabel: "Guest" }], posterImageUrl: "/api/v0/events/event-id/artwork/artwork-id" };
  assert.deepEqual(ApiEventUpdateRequestSchema.parse(patch), patch);
  assert.equal(ApiEventUpdateRequestSchema.safeParse({ ...patch, posterImageUrl: "/arbitrary.png" }).success, false);
  assert.equal(ApiEventUpdateRequestSchema.safeParse({ ...patch, participantLinks: [], slotLinks: [] }).success, false);
});

it("validates event stream inputs and preserves replacement clear semantics", () => {
  const draft = { title: "Lineup", communitySlug: "club", startAt: 1798761600000,
    watchMode: "performer_sequence", slotLinks: [{ displayLabel: "Set", startAt: 1798761600000, selectedStreamId: "alpha" }] };
  assert.equal(ApiEventCreateRequestSchema.parse(draft).slotLinks?.[0]?.selectedStreamId, "alpha");
  assert.equal(ApiEventCreateRequestSchema.safeParse({ ...draft, watchMode: "unknown" }).success, false);
  const cleared = ApiEventUpdateRequestSchema.parse({ participantLinks: [], slotLinks: [{ ...draft.slotLinks[0], selectedStreamId: null }] });
  assert.equal(cleared.slotLinks?.[0]?.selectedStreamId, null);
  assert.equal(Object.hasOwn(ApiEventUpdateRequestSchema.parse({ title: "Updated" }), "slotLinks"), false);
});

it("checks known public slot types instead of accepting unknown roster payloads", () => {
  const event = { id: "event", slug: "lineup", title: "Lineup", startAt: 1798761600000,
    source: { label: "VRDex", sourceType: "manual" }, watchSurfaceEnabled: false };
  assert.equal(PublicEventSchema.parse(event).watchMode, "event_stream");
  assert.equal(PublicEventSchema.safeParse({ ...event, slots: [{ playbackKey: 123 }] }).success, false);
  assert.equal(PublicEventSchema.safeParse({ ...event, participants: [{ outboundLinks: "private" }] }).success, false);
});

it("retains ordered partial lineup rows and matched portrait data in the public contract", () => {
  const lineup = [
    { key: "guest", position: 0, displayLabel: "Guest" },
    { key: "matched", position: 1, displayLabel: "Aurora", roleLabel: "DJ", startAt: 1000,
      performer: { slug: "aurora", displayName: "Aurora", trustLabel: "unclaimed", imageUrl: "https://example.com/portrait.png", outboundLinks: [] } },
  ];
  const result = PublicEventSchema.parse({
    id: "event", slug: "event", title: "Event", startAt: 1000, watchSurfaceEnabled: false, source: { sourceType: "community", label: "Fixture" }, lineup,
  });
  assert.deepEqual(result.lineup, lineup);
});

it("rejects malformed lineup times and missing performer labels", () => {
  const event = { id: "event", slug: "event", title: "Event", startAt: 1000, watchSurfaceEnabled: false, source: { sourceType: "community", label: "Fixture" } };
  assert.equal(PublicEventSchema.safeParse({ ...event, lineup: [{ key: "x", position: 0 }] }).success, false);
  assert.equal(PublicEventSchema.safeParse({ ...event, lineup: [{ key: "x", position: 0, displayLabel: "Guest", startAt: "unknown" }] }).success, false);
});
