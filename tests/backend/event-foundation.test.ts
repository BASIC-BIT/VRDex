import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import { sanitizeEventDraftInput } from "../../convex/_eventInputs";
import { toPublicEvent, toPublicEventPreviewFromRecord } from "../../convex/_eventPublic";
import {
  createEventSlugBase,
  createEventSlugCandidate,
  toEventSlug,
  validateEventSlug,
} from "../../convex/_eventSlugs";

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
      endAt: startAt + 10_800_000,
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
          roleLabel: " Headliner ",
        },
      ],
    });

    assert.equal(input.title, "Afterglow Harbor Sessions");
    assert.equal(input.sortTitle, "afterglow harbor sessions");
    assert.equal(input.mediaLinks[0]?.presentation, "open");
    assert.equal(input.mediaLinks[1]?.presentation, "copy");
    assert.equal(input.participantLinks[0]?.roleLabel, "Headliner");
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
});

describe("public event projection", () => {
  it("projects event details with safe URLs and public participant links", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const event = {
      _id: "event123",
      slug: "afterglow-harbor-sessions-2026-06-14",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: now + 86_400_000,
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

    const publicEvent = toPublicEvent({
      event,
      worlds: [{ association: worldAssociation, world }],
      participants: [{ association: participant, profile: person }],
    });

    assert.notEqual(publicEvent, null);
    assert.equal(publicEvent?.slug, "afterglow-harbor-sessions-2026-06-14");
    assert.equal(publicEvent?.mediaLinks.length, 1);
    assert.equal(publicEvent?.worlds[0]?.displayName, "Neon Harbor");
    assert.equal(publicEvent?.participants[0]?.displayName, "DJ Aurora");
    assert.equal("url" in publicEvent!.source, false);
  });

  it("creates compact previews for profile and community event sections", () => {
    const event = {
      slug: "afterglow-harbor-sessions-2026-06-14",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      sourceType: "community",
      sourceLabel: "Community listing",
      publicationState: "published",
      updatedAt: 1,
    } as unknown as Doc<"events">;
    const preview = toPublicEventPreviewFromRecord({ event, worlds: [], participants: [] });

    assert.equal(preview.slug, "afterglow-harbor-sessions-2026-06-14");
    assert.equal(preview.participantCount, 0);
    assert.deepEqual(preview.worlds, []);
  });
});
