import assert from "node:assert/strict";
import { it } from "node:test";
import { renderEventEmbed, type PublicEventProjection } from "../../convex/eventSyncKinds/discordBoard";

const START = Date.UTC(2026, 5, 14, 22, 0, 0); // 1781474400
const END = Date.UTC(2026, 5, 15, 1, 0, 0); // 1781485200
const world = (displayName: string) => ({ slug: displayName.toLowerCase().replace(/\W+/g, "-"), displayName, tags: [], association: { sourceType: "community" as const, confirmationState: "confirmed" as const } });

function projection(overrides: Partial<PublicEventProjection> = {}): PublicEventProjection {
  return {
    id: "event-id", slug: "7m2kp9q", title: "Afterglow Harbor Sessions",
    startAt: START, endAt: END, scheduleKind: "timed", eventDate: "2026-06-14", status: "scheduled",
    communityName: "Afterglow Social", communitySlug: "afterglow-social",
    source: { sourceType: "community", label: "Community listing" },
    worlds: [], participantCount: 0, slotCount: 0, nextSlots: [], watchMode: "event_stream", watchSurfaceEnabled: false,
    authoredMediaLinks: [], mediaLinks: [], participants: [], slots: [],
    lineup: [
      { key: "one", position: 0, displayLabel: "Aurora", roleLabel: "DJ", startAt: START, endAt: Date.UTC(2026, 5, 14, 22, 45, 0) },
      { key: "two", position: 1, displayLabel: "Closing guest" },
    ],
    url: "https://vrdex.net/afterglow-social/events/7m2kp9q",
    artworkImageUrl: "https://media.example.test/poster.png",
    ...overrides,
  } as PublicEventProjection;
}

it("renders the exact board layout", () => {
  assert.deepEqual(renderEventEmbed(projection({ worlds: [world("Harbor Club")] })), {
    title: "Afterglow Harbor Sessions",
    url: "https://vrdex.net/afterglow-social/events/7m2kp9q",
    description: "- <t:1781474400:t>-<t:1781477100:t> - Aurora - DJ\n- Closing guest",
    fields: [
      { name: "Time", value: "<t:1781474400:F> (<t:1781474400:R>)" },
      { name: "End", value: "<t:1781485200:f>" },
      { name: "Host", value: "Afterglow Social" },
      { name: "World", value: "Harbor Club" },
    ],
    image: { url: "https://media.example.test/poster.png" },
  });
});

it("names several worlds, falls back to the venue, and omits empty parts", () => {
  assert.deepEqual(renderEventEmbed(projection({ worlds: [world("Harbor Club"), world("Night Market")] })).fields.at(-1), { name: "Worlds", value: "Harbor Club, Night Market" });
  assert.deepEqual(renderEventEmbed(projection({ venueLabel: "The Lighthouse" })).fields.at(-1), { name: "Venue", value: "The Lighthouse" });
  const bare = renderEventEmbed(projection({ lineup: [], artworkImageUrl: undefined }));
  assert.equal(Object.hasOwn(bare, "description"), false);
  assert.equal(Object.hasOwn(bare, "image"), false);
});

it("renders a date-only event without timestamps", () => {
  const embed = renderEventEmbed(projection({ scheduleKind: "date_only", startAt: undefined, endAt: undefined }));
  assert.deepEqual(embed.fields.slice(0, 2), [{ name: "Date", value: "2026-06-14 (Time TBA)" }, { name: "Host", value: "Afterglow Social" }]);
  assert.equal(embed.description, "- Aurora - DJ\n- Closing guest");
});

it("keeps a Cancelled line above the lineup", () => {
  assert.ok(renderEventEmbed(projection({ status: "cancelled" })).description!.startsWith("**Cancelled**\n\n- <t:1781474400:t>"));
});

it("stays inside Discord's embed limits", () => {
  const embed = renderEventEmbed(projection({
    title: "a".repeat(300),
    communityName: "c".repeat(2000),
    worlds: Array.from({ length: 40 }, (_, i) => world(`World ${i} ${"w".repeat(40)}`)),
    lineup: Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, position: i, displayLabel: `Performer ${i} ${"p".repeat(30)}` })),
  }));
  assert.equal(embed.title.length, 256);
  assert.ok(embed.title.endsWith("…"));
  assert.ok(embed.description!.length <= 4096);
  assert.ok(embed.description!.endsWith("\n…"));
  assert.ok(embed.fields.length <= 25);
  for (const field of embed.fields) assert.ok(field.name.length <= 256 && field.value.length <= 1024);
  const total = embed.title.length + embed.description!.length + embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000);
});
