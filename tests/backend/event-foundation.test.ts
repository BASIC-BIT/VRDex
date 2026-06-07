import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import type { DatabaseReader } from "../../convex/_generated/server";
import { createDiscordTimestampSet, toDiscordTimestamp } from "../../convex/_discordTimestamps";
import { sanitizeEventDraftInput } from "../../convex/_eventInputs";
import {
  getPublicEventPreviews,
  toPublicEvent,
  toPublicEventPreviewFromRecord,
} from "../../convex/_eventPublic";
import {
  createEventSlugBase,
  createEventSlugCandidate,
  toEventSlug,
  validateEventSlug,
} from "../../convex/_eventSlugs";
import { generateSequentialEventSlots, sanitizeEventSlotInputs } from "../../convex/_eventSlots";

describe("event slug helpers", () => {
  it("normalizes event names into dated readable slugs", () => {
    assert.equal(
      createEventSlugBase(" Afterglow Harbor Sessions!! ", Date.UTC(2026, 5, 14, 22, 0, 0)),
      "afterglow-harbor-sessions-2026-06-14",
    );
  });

  it("validates canonical event slug rules", () => {
    assert.deepEqual(validateEventSlug("afterglow-harbor"), {
      ok: true,
      slug: "afterglow-harbor",
    });
    assert.deepEqual(validateEventSlug("Afterglow-Harbor"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateEventSlug("events"), {
      ok: false,
      reason: "reserved",
    });
  });

  it("keeps retry candidates inside the maximum length", () => {
    const base = "a".repeat(64);
    const candidate = createEventSlugCandidate(base, 12);

    assert.equal(candidate.length, 64);
    assert.equal(candidate.endsWith("-12"), true);
  });

  it("turns freeform slug input into canonical event slugs", () => {
    assert.deepEqual(toEventSlug("Afterglow Harbor"), {
      ok: true,
      slug: "afterglow-harbor",
    });
  });
});

describe("event draft input", () => {
  it("sanitizes media links, participants, and optional event fields", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);
    const input = sanitizeEventDraftInput({
      title: "  Afterglow Harbor Sessions  ",
      communitySlug: "afterglow-social",
      worldSlug: "neon-harbor",
      startAt,
      doorsOpenAt: startAt - 1_800_000,
      endAt: startAt + 10_800_000,
      timezone: "UTC",
      sourceLabel: " Fixture listing ",
      sourceUrl: "https://example.invalid/events/afterglow",
      posterImageUrl: "https://example.invalid/poster.png",
      mediaLinks: [
        {
          type: "watch",
          label: " Twitch ",
          url: "https://example.invalid/watch",
        },
        {
          type: "vrcdn",
          label: " VRCDN PC ",
          url: "https://example.invalid/vrcdn",
        },
      ],
      participantLinks: [
        {
          personSlug: "dj-aurora",
          roleLabel: " House ",
        },
      ],
      slotLinks: [
        {
          personSlug: "dj-aurora",
          displayLabel: " DJ Aurora ",
          roleLabel: " House ",
          startAt,
          endAt: startAt + 2_700_000,
        },
      ],
    });

    assert.equal(input.title, "Afterglow Harbor Sessions");
    assert.equal(input.sortTitle, "afterglow harbor sessions");
    assert.equal(input.doorsOpenAt, startAt - 1_800_000);
    assert.equal(input.mediaLinks[0]?.presentation, "open");
    assert.equal(input.mediaLinks[1]?.presentation, "copy");
    assert.equal(input.participantLinks[0]?.roleLabel, "House");
    assert.equal(input.slotLinks[0]?.displayLabel, "DJ Aurora");
    assert.equal(input.slotLinks[0]?.roleLabel, "House");
  });

  it("rejects non-https public URLs", () => {
    assert.throws(
      () =>
        sanitizeEventDraftInput({
          title: "Afterglow Harbor Sessions",
          startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
          sourceUrl: "http://example.invalid/events/afterglow",
        }),
      /Event source URL must use https\./,
    );
  });

  it("normalizes VRCDN media URL variants to the canonical public page", () => {
    const input = sanitizeEventDraftInput({
      title: "Afterglow Harbor Sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      mediaLinks: [
        {
          type: "watch",
          label: "Quest stream",
          url: "https://stream.vrcdn.live/live/basicbit.live.ts",
        },
        {
          type: "vrcdn",
          label: "PC stream",
          url: "rtspt://stream.vrcdn.live/live/basicbit",
        },
      ],
    });

    assert.equal(input.mediaLinks.length, 1);
    assert.equal(input.mediaLinks[0]?.url, "https://vrcdn.live/basicbit");
  });

  it("preserves direct VRCDN media files for native playback", () => {
    const input = sanitizeEventDraftInput({
      title: "Afterglow Harbor Sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      mediaLinks: [
        {
          type: "vrcdn",
          label: "Archive",
          url: "https://stream.vrcdn.live/live/basicbit.mp4",
        },
      ],
    });

    assert.equal(input.mediaLinks[0]?.url, "https://stream.vrcdn.live/live/basicbit.mp4");
  });

  it("rejects invalid event time zones", () => {
    assert.throws(
      () =>
        sanitizeEventDraftInput({
          title: "Afterglow Harbor Sessions",
          startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
          timezone: "UTC+1",
        }),
      /Time zone must be a valid IANA time zone\./,
    );
  });

  it("rejects doors-open times after event start", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventDraftInput({
          title: "Afterglow Harbor Sessions",
          startAt,
          doorsOpenAt: startAt + 60_000,
        }),
      /Doors-open time must be at or before the event start time\./,
    );
  });

  it("requires a time zone when event slots are provided", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventDraftInput({
          title: "Afterglow Harbor Sessions",
          startAt,
          slotLinks: [{ displayLabel: "DJ Aurora", startAt }],
        }),
      /Time zone is required when event slots are provided\./,
    );
  });

  it("caps unique participants after deriving linked slot performers", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventDraftInput({
          title: "Afterglow Harbor Sessions",
          startAt,
          timezone: "UTC",
          participantLinks: Array.from({ length: 80 }, (_, index) => ({
            personSlug: `person-${index + 1}`,
          })),
          slotLinks: [
            {
              personSlug: "person-81",
              displayLabel: "Person 81",
              startAt,
            },
          ],
        }),
      /Participant links can include at most 80 unique profiles including linked slot performers\./,
    );
  });
});

describe("event slot helpers", () => {
  it("sanitizes and orders event slots", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);
    const slots = sanitizeEventSlotInputs(
      [
        {
          displayLabel: " DJ Lumen ",
          roleLabel: " Trance ",
          startAt: startAt + 2_700_000,
          endAt: startAt + 5_400_000,
        },
        {
          personSlug: "dj-aurora",
          displayLabel: " DJ Aurora ",
          startAt,
          endAt: startAt + 2_700_000,
          sourceUrl: "https://example.invalid/lineup",
        },
      ],
      "Fixture lineup",
    );

    assert.equal(slots[0]?.displayLabel, "DJ Aurora");
    assert.equal(slots[0]?.position, 0);
    assert.equal(slots[0]?.personSlug, "dj-aurora");
    assert.equal(slots[0]?.roleLabel, "Performer");
    assert.equal(slots[1]?.displayLabel, "DJ Lumen");
    assert.equal(slots[1]?.position, 1);
  });

  it("rejects invalid slot times", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventSlotInputs(
          [
            {
              displayLabel: "DJ Aurora",
              startAt,
              endAt: startAt,
            },
          ],
          "Fixture lineup",
        ),
      /Slot end time must be after the start time\./,
    );
  });

  it("rejects slot times outside the event window", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.throws(
      () =>
        sanitizeEventSlotInputs(
          [
            {
              displayLabel: "DJ Aurora",
              startAt: startAt - 60_000,
            },
          ],
          "Fixture lineup",
          { startAt },
        ),
      /Slot start time must be at or after the event start time\./,
    );

    assert.throws(
      () =>
        sanitizeEventSlotInputs(
          [
            {
              displayLabel: "DJ Aurora",
              startAt,
              endAt: startAt + 120_000,
            },
          ],
          "Fixture lineup",
          { startAt, endAt: startAt + 60_000 },
        ),
      /Slot end time must be at or before the event end time\./,
    );
  });

  it("generates sequential slots from an event start", () => {
    const startAt = Date.UTC(2026, 5, 14, 22, 0, 0);
    const slots = generateSequentialEventSlots({
      eventStartAt: startAt,
      slotCount: 3,
      slotDurationMinutes: 45,
      breakMinutes: 5,
    });

    assert.deepEqual(
      slots.map((slot) => ({ position: slot.position, startOffsetMinutes: slot.startOffsetMinutes })),
      [
        { position: 0, startOffsetMinutes: 0 },
        { position: 1, startOffsetMinutes: 50 },
        { position: 2, startOffsetMinutes: 100 },
      ],
    );
    assert.equal(slots[0]?.endAt, startAt + 45 * 60_000);
  });
});

describe("Discord timestamp helpers", () => {
  it("formats timestamps into Discord token styles", () => {
    const timestamp = Date.UTC(2026, 5, 14, 22, 0, 0);

    assert.equal(toDiscordTimestamp(timestamp, "t"), "<t:1781474400:t>");
    assert.equal(createDiscordTimestampSet(timestamp).longDateTime, "<t:1781474400:F>");
  });
});

describe("public event projection", () => {
  function createEmptyEventAssociationDb() {
    const indexedQuery = {
      take: async () => [],
      filter: () => indexedQuery,
    };
    const query = {
      withIndex: () => indexedQuery,
    };

    return {
      get: async () => null,
      query: () => query,
    } as unknown as DatabaseReader;
  }

  it("projects event details with safe URLs and public participant links", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const event = {
      _id: "event123",
      slug: "afterglow-harbor-sessions-2026-06-14",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: now + 86_400_000,
      doorsOpenAt: now + 84_600_000,
      endAt: now + 90_000_000,
      timezone: "UTC",
      communityName: "Afterglow Social",
      summary: "A confirmed fixture event.",
      notes: "Bring water.",
      posterImageUrl: "https://example.invalid/poster.png",
      mediaLinks: [
        {
          type: "watch",
          label: "Watch",
          url: "https://example.invalid/watch",
          presentation: "open",
        },
        {
          type: "other",
          label: "Unsafe",
          url: "http://example.invalid/unsafe",
          presentation: "open",
        },
      ],
      sourceType: "community",
      sourceLabel: "Community listing",
      sourceUrl: "http://example.invalid/source",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      tags: ["Club world"],
      summary: "A venue world.",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: now,
    } as unknown as Doc<"worlds">;
    const worldAssociation = {
      eventId: "event123",
      worldId: "world123",
      eventStartAt: event.startAt,
      sourceType: "manual",
      confidence: 1,
      confirmationState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;
    const person = {
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      sortName: "dj aurora",
      aliases: [],
      tags: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      updatedAt: now,
      profileType: "person",
      person: {
        roleTags: ["DJ"],
      },
    } as unknown as Doc<"profiles">;
    const participant = {
      eventId: "event123",
      personProfileId: "profile123",
      eventStartAt: event.startAt,
      roleLabel: "Performer",
      sourceType: "community",
      sourceLabel: "Fixture lineup",
      confirmationState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventParticipants">;

    const slot = {
      eventId: "event123",
      eventStartAt: event.startAt,
      position: 0,
      startAt: event.startAt,
      endAt: event.startAt + 2_700_000,
      personProfileId: "profile123",
      displayLabel: "DJ Aurora",
      roleLabel: "House",
      sourceType: "community",
      sourceLabel: "Fixture lineup",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventSlots">;

    const publicEvent = toPublicEvent({
      event,
      worlds: [{ association: worldAssociation, world }],
      participants: [{ association: participant, profile: person }],
      slots: [{ slot, profile: person }],
    });

    assert.notEqual(publicEvent, null);
    assert.equal(publicEvent?.slug, "afterglow-harbor-sessions-2026-06-14");
    assert.equal(publicEvent?.doorsOpenAt, now + 84_600_000);
    assert.equal(publicEvent?.mediaLinks.length, 1);
    assert.equal(publicEvent?.worlds[0]?.displayName, "Neon Harbor");
    assert.equal(publicEvent?.participants[0]?.displayName, "DJ Aurora");
    assert.equal(publicEvent?.slots[0]?.displayLabel, "DJ Aurora");
    assert.equal(publicEvent?.slots[0]?.discord.shortTime, "<t:1779710400:t>");
    assert.equal("url" in publicEvent!.source, false);
  });

  it("keeps public slot labels when performer profiles are not projected", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const event = {
      slug: "afterglow-harbor-sessions-2026-06-14",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      doorsOpenAt: Date.UTC(2026, 5, 14, 21, 30, 0),
      sourceType: "community",
      sourceLabel: "Fixture event listing",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const slot = {
      eventId: "event123",
      eventStartAt: event.startAt,
      position: 0,
      startAt: event.startAt,
      personProfileId: "profile123",
      displayLabel: "DJ Aurora",
      roleLabel: "House",
      sourceType: "community",
      sourceLabel: "Fixture lineup",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventSlots">;

    const publicEvent = toPublicEvent({ event, worlds: [], participants: [], slots: [{ slot }] });

    assert.equal(publicEvent?.slots.length, 1);
    assert.equal(publicEvent?.slots[0]?.displayLabel, "DJ Aurora");
    assert.equal(publicEvent?.slots[0]?.performer, undefined);
  });

  it("creates compact previews for profile and community event sections", () => {
    const event = {
      slug: "afterglow-harbor-sessions-2026-06-14",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      doorsOpenAt: Date.UTC(2026, 5, 14, 21, 30, 0),
      sourceType: "community",
      sourceLabel: "Community listing",
      publicationState: "published",
      updatedAt: 1,
    } as unknown as Doc<"events">;
    const preview = toPublicEventPreviewFromRecord({ event, worlds: [], participants: [], slots: [] });

    assert.equal(preview.slug, "afterglow-harbor-sessions-2026-06-14");
    assert.equal(preview.doorsOpenAt, Date.UTC(2026, 5, 14, 21, 30, 0));
    assert.equal(preview.participantCount, 0);
    assert.deepEqual(preview.worlds, []);
  });

  it("allows explicit preview limits above the compact section default", async () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const events = Array.from(
      { length: 8 },
      (_, index) =>
        ({
          slug: `afterglow-harbor-${index + 1}`,
          title: `Afterglow Harbor ${index + 1}`,
          sortTitle: `afterglow harbor ${index + 1}`,
          startAt: now + index * 3_600_000,
          sourceType: "community",
          sourceLabel: "Community listing",
          publicationState: "published",
          updatedAt: now,
        }) as unknown as Doc<"events">,
    );
    const db = createEmptyEventAssociationDb();

    const defaultPreviews = await getPublicEventPreviews(db, events, { now });
    const expandedPreviews = await getPublicEventPreviews(db, events, { now, limit: 8 });

    assert.equal(defaultPreviews.length, 6);
    assert.equal(expandedPreviews.length, 8);
    assert.equal(expandedPreviews[7]?.title, "Afterglow Harbor 8");
  });
});
