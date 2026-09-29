import assert from "node:assert/strict";
import { it } from "node:test";
import { ApiEventCreateRequestSchema, ApiEventUpdateRequestSchema, PublicEventSchema } from "../src/schemas";

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
