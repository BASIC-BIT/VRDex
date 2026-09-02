import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDiscordTimestampSet } from "../../convex/_discordTimestamps";
import { formatDiscordEventPost } from "../../convex/_eventDiscordExport";
import type { PublicEvent } from "../../convex/_eventPublic";

function createPublicEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

  return {
    id: "event-afterglow-harbor-sessions-2026-06-14",
    slug: "afterglow-harbor-sessions-2026-06-14",
    title: "Afterglow Harbor Sessions",
    startAt,
    status: "scheduled",
    source: {
      sourceType: "community",
      label: "Community listing",
    },
    worlds: [],
    participantCount: 0,
    slotCount: 0,
    watchSurfaceEnabled: false,
    authoredMediaLinks: [],
    mediaLinks: [],
    participants: [],
    slots: [],
    ...overrides,
  };
}

describe("Discord event post export", () => {
  it("does not generate a promotional post for a cancelled event", () => {
    assert.equal(
      formatDiscordEventPost({
        canonicalUrl: "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        event: createPublicEvent({ status: "cancelled" }),
      }),
      null,
    );
  });

  it("formats a public event with event time, slots, host, world, and safe projected links", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);
    const event = createPublicEvent({
      startAt,
      doorsOpenAt: startAt - 30 * 60_000,
      endAt: startAt + 3 * 60 * 60_000,
      communityName: "Afterglow Social",
      worlds: [
        {
          slug: "neon-harbor",
          displayName: "Neon Harbor",
          tags: ["club"],
          association: {
            sourceType: "manual",
            confirmationState: "confirmed",
          },
        },
      ],
      mediaLinks: [
        {
          type: "watch",
          label: "Watch",
          url: "https://example.invalid/watch",
          presentation: "open",
        },
        {
          type: "vrcdn",
          label: "Quest stream",
          url: "vrcdn:basicbit",
          presentation: "copy",
        },
      ],
      slots: [
        {
          position: 0,
          startAt,
          endAt: startAt + 45 * 60_000,
          displayLabel: "DJ Aurora",
          roleLabel: "House",
          discord: createDiscordTimestampSet(startAt),
          source: {
            sourceType: "community",
            label: "Fixture lineup",
          },
        },
        {
          position: 1,
          startAt: startAt + 45 * 60_000,
          displayLabel: "DJ Lumen",
          roleLabel: "Trance",
          discord: createDiscordTimestampSet(startAt + 45 * 60_000),
          source: {
            sourceType: "community",
            label: "Fixture lineup",
          },
        },
      ],
    });

    assert.equal(
      formatDiscordEventPost({
        canonicalUrl: "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        event,
      }),
      [
        "**Afterglow Harbor Sessions**",
        "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        "",
        "Host: Afterglow Social",
        "World: Neon Harbor",
        "Time: <t:1781474400:F> (<t:1781474400:R>)",
        "Doors: <t:1781472600:f>",
        "End: <t:1781485200:f>",
        "",
        "Lineup:",
        "- <t:1781474400:t>-<t:1781477100:t> - DJ Aurora - House",
        "- <t:1781477100:t> - DJ Lumen - Trance",
        "",
        "Links:",
        "- Watch: https://example.invalid/watch",
        // The transport stream, not the HLS playlist: VRCDN publishes no HLS,
        // so the exported link used to answer `404` in Discord.
        "- Quest stream: https://stream.vrcdn.live/live/basicbit.live.ts",
      ].join("\n"),
    );
  });

  it("falls back to the public participant lineup when detailed slots are absent", () => {
    const event = createPublicEvent({
      participants: [
        {
          slug: "vj-lumen",
          displayName: "VJ Lumen",
          roleLabel: "VJ",
          trustLabel: "claimed_verified",
          source: {
            sourceType: "community",
            label: "Fixture lineup",
          },
        },
      ],
    });

    assert.equal(
      formatDiscordEventPost({
        canonicalUrl: "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        event,
      }),
      [
        "**Afterglow Harbor Sessions**",
        "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        "",
        "Time: <t:1781474400:F> (<t:1781474400:R>)",
        "",
        "Lineup:",
        "- VJ Lumen - VJ",
      ].join("\n"),
    );
  });

  it("does not include source links or fields outside the export scope", () => {
    const event = createPublicEvent({
      source: {
        sourceType: "import",
        label: "Imported source",
        url: "https://example.invalid/source-post",
      },
    });
    const post = formatDiscordEventPost({
      canonicalUrl: "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
      event,
    });

    assert.equal(
      post,
      [
        "**Afterglow Harbor Sessions**",
        "https://vrdex.net/e/afterglow-harbor-sessions-2026-06-14",
        "",
        "Time: <t:1781474400:F> (<t:1781474400:R>)",
      ].join("\n"),
    );
  });
});
