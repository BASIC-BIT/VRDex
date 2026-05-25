import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import { isValidVrchatWorldId, toCanonicalVrchatWorldUrl } from "../../convex/_worldIds";
import { createPublicActiveWorldPreviews, createPublicWorldEventContext } from "../../convex/_worldEvents";
import { toPublicWorld } from "../../convex/_worldPublic";
import {
  createWorldSlugBase,
  createWorldSlugCandidate,
  normalizeWorldSlugInput,
  toWorldSlug,
  validateWorldSlug,
  WORLD_SLUG_MAX_LENGTH,
} from "../../convex/_worldSlugs";

describe("world slug helpers", () => {
  it("normalizes world names into strict ASCII slug candidates", () => {
    assert.equal(normalizeWorldSlugInput(" Neon Harbor & Friends!! "), "neon-harbor-and-friends");
  });

  it("validates canonical world slug rules", () => {
    assert.deepEqual(validateWorldSlug("neon-harbor"), {
      ok: true,
      slug: "neon-harbor",
    });
    assert.deepEqual(validateWorldSlug("Neon-Harbor"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateWorldSlug("worlds"), {
      ok: false,
      reason: "reserved",
    });
  });

  it("turns freeform input into a valid world slug result", () => {
    assert.deepEqual(toWorldSlug("Neon Harbor"), {
      ok: true,
      slug: "neon-harbor",
    });
  });

  it("generates safe bases and retry candidates", () => {
    assert.equal(createWorldSlugBase("vr"), "vr-world");
    assert.equal(createWorldSlugBase("worlds"), "worlds-world");
    assert.equal(createWorldSlugBase("!!!"), "world-page");

    const base = "a".repeat(WORLD_SLUG_MAX_LENGTH);
    const candidate = createWorldSlugCandidate(base, 12);

    assert.equal(candidate.length, WORLD_SLUG_MAX_LENGTH);
    assert.equal(candidate.endsWith("-12"), true);
  });
});

describe("VRChat world id helpers", () => {
  it("accepts VRChat world ids and derives canonical URLs", () => {
    const worldId = "wrld_00000000-0000-4000-8000-000000000001";

    assert.equal(isValidVrchatWorldId(worldId), true);
    assert.equal(
      toCanonicalVrchatWorldUrl(worldId),
      "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects invalid world ids", () => {
    assert.equal(isValidVrchatWorldId("world_00000000-0000-4000-8000-000000000001"), false);
    assert.equal(toCanonicalVrchatWorldUrl("wrld_not-a-uuid"), null);
  });
});

describe("public world projection", () => {
  it("omits raw source and profile ids while preserving public attribution", () => {
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world"],
      summary: "A VRChat venue.",
      vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
      canonicalVrchatWorldUrl:
        "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
      sourceUrl: "http://example.invalid/source",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      heroImageUrl: "http://example.invalid/hero.png",
      media: [
        {
          kind: "image",
          url: "https://example.invalid/screenshot.png",
        },
        {
          kind: "image",
          url: "http://example.invalid/unsafe.png",
        },
      ],
      creatorAttributions: [
        {
          role: "world_author",
          displayName: "Afterglow Social",
          profileId: "profile123",
          profileSlug: "afterglow-social",
          profileType: "community",
          sourceLabel: "Owner-authored",
        },
      ],
      outboundLinks: [
        {
          type: "gumroad",
          label: "Prefab pack",
          url: "https://example.invalid/prefab",
          source: "owner_authored",
        },
        {
          type: "other",
          label: "Unsafe link",
          url: "http://example.invalid/unsafe",
          source: "reviewed",
        },
      ],
      publicationState: "published",
      creationSource: "self",
      sourceAttribution: {
        sourceType: "owner",
        label: "Owner-authored metadata",
        url: "https://example.invalid/source",
        submittedAt: 1,
        confirmedAt: 2,
      },
      publishedAt: 1,
      updatedAt: 2,
    } as Doc<"worlds">;

    const publicWorld = toPublicWorld(world);

    assert.equal("creationSource" in publicWorld, false);
    assert.equal("sourceAttribution" in publicWorld, false);
    assert.equal("profileId" in publicWorld.creatorAttributions[0], false);
    assert.equal(publicWorld.creatorAttributions[0]?.profileSlug, "afterglow-social");
    assert.equal(publicWorld.source?.label, "Owner-authored metadata");
    assert.equal(publicWorld.source?.confirmedAt, 2);
    assert.equal("sourceUrl" in publicWorld, false);
    assert.equal("heroImageUrl" in publicWorld, false);
    assert.equal(publicWorld.media.length, 1);
    assert.equal(publicWorld.outboundLinks.length, 1);
  });

  it("omits source instead of returning undefined when source attribution is absent", () => {
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: [],
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: 1,
    } as Doc<"worlds">;

    const publicWorld = toPublicWorld(world);

    assert.equal("source" in publicWorld, false);
  });
});

describe("public world event context", () => {
  it("publishes confirmed event-world links as upcoming and recent event previews", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const association = {
      eventId: "event123",
      worldId: "world123",
      sourceType: "manual",
      confidence: 1,
      confirmationState: "confirmed",
      confirmedAt: now - 1_000,
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;

    const upcomingEvent = {
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: now + 86_400_000,
      endAt: now + 90_000_000,
      timezone: "UTC",
      communityName: "Afterglow Social",
      summary: "A confirmed fixture event.",
      sourceType: "manual",
      sourceLabel: "Fixture event listing",
      sourceUrl: "https://example.invalid/events/afterglow-harbor-sessions",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;

    const recentEvent = {
      title: "Neon Harbor Opening Night",
      sortTitle: "neon harbor opening night",
      startAt: now - 86_400_000,
      communityName: "Afterglow Social",
      sourceType: "community",
      sourceLabel: "Community-submitted event",
      sourceUrl: "http://example.invalid/unsafe-event",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;

    const context = createPublicWorldEventContext(
      [
        { event: recentEvent, association },
        { event: upcomingEvent, association },
      ],
      now,
    );

    assert.deepEqual(
      context.upcoming.map((event) => event.title),
      ["Afterglow Harbor Sessions"],
    );
    assert.deepEqual(
      context.recent.map((event) => event.title),
      ["Neon Harbor Opening Night"],
    );
    assert.equal(
      context.upcoming[0]?.source.url,
      "https://example.invalid/events/afterglow-harbor-sessions",
    );
    assert.equal("url" in context.recent[0]!.source, false);
    assert.equal(context.upcoming[0]?.worldAssociation.confirmationState, "confirmed");
  });

  it("omits unconfirmed associations and unpublished events from public world pages", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const publishedEvent = {
      title: "Unreviewed Venue Guess",
      sortTitle: "unreviewed venue guess",
      startAt: now + 86_400_000,
      sourceType: "ai_suggested",
      sourceLabel: "AI-suggested match",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const draftEvent = {
      ...publishedEvent,
      title: "Draft Event",
      publicationState: "draft_private",
    } as unknown as Doc<"events">;
    const unconfirmedAssociation = {
      eventId: "event123",
      worldId: "world123",
      sourceType: "ai_suggested",
      confidence: 0.8,
      confirmationState: "unconfirmed",
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;
    const confirmedAssociation = {
      ...unconfirmedAssociation,
      sourceType: "manual",
      confirmationState: "confirmed",
    } as unknown as Doc<"eventWorlds">;

    const context = createPublicWorldEventContext(
      [
        { event: publishedEvent, association: unconfirmedAssociation },
        { event: draftEvent, association: confirmedAssociation },
      ],
      now,
    );

    assert.equal(context.upcoming.length, 0);
    assert.equal(context.recent.length, 0);
  });
});

describe("public active world previews", () => {
  it("groups confirmed future event-world records into honest home-page venue cards", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world", "Cyberpunk"],
      summary: "A VRChat venue.",
      heroImageUrl: "http://example.invalid/unsafe-hero.png",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: now,
    } as unknown as Doc<"worlds">;
    const association = {
      eventId: "event123",
      worldId: "world123",
      sourceType: "manual",
      confidence: 1,
      confirmationState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;
    const laterEvent = {
      _id: "event456",
      title: "Afterglow Late Set",
      sortTitle: "afterglow late set",
      startAt: now + 172_800_000,
      sourceType: "manual",
      sourceLabel: "Fixture event listing",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const nextEvent = {
      ...laterEvent,
      _id: "event123",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: now + 86_400_000,
      communityName: "Afterglow Social",
      sourceUrl: "http://example.invalid/unsafe-event",
    } as unknown as Doc<"events">;

    const previews = createPublicActiveWorldPreviews(
      [
        { association, event: laterEvent, world },
        { association, event: nextEvent, world },
      ],
      now,
      3,
    );

    assert.equal(previews.length, 1);
    assert.equal(previews[0]?.displayName, "Neon Harbor");
    assert.equal(previews[0]?.activityLabel, "Hosting upcoming events");
    assert.equal(previews[0]?.upcomingEventCount, 2);
    assert.equal(previews[0]?.nextEvent.title, "Afterglow Harbor Sessions");
    assert.equal("heroImageUrl" in previews[0]!, false);
    assert.equal("url" in previews[0]!.nextEvent.source, false);
  });

  it("deduplicates duplicate event-world association rows for the same event and world", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: [],
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: now,
    } as unknown as Doc<"worlds">;
    const event = {
      _id: "event123",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: now + 86_400_000,
      sourceType: "manual",
      sourceLabel: "Fixture event listing",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const manualAssociation = {
      eventId: "event123",
      worldId: "world123",
      eventStartAt: event.startAt,
      sourceType: "manual",
      confidence: 1,
      confirmationState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;
    const partnerAssociation = {
      ...manualAssociation,
      sourceType: "partner",
    } as unknown as Doc<"eventWorlds">;

    const previews = createPublicActiveWorldPreviews(
      [
        { association: manualAssociation, event, world },
        { association: partnerAssociation, event, world },
      ],
      now,
      3,
    );

    assert.equal(previews.length, 1);
    assert.equal(previews[0]?.upcomingEventCount, 1);
  });

  it("excludes draft worlds, draft events, past events, and unconfirmed associations", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const world = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: [],
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: now,
    } as unknown as Doc<"worlds">;
    const event = {
      _id: "event123",
      title: "Unreviewed Venue Guess",
      sortTitle: "unreviewed venue guess",
      startAt: now + 86_400_000,
      sourceType: "ai_suggested",
      sourceLabel: "AI-suggested match",
      publicationState: "published",
      updatedAt: now,
    } as unknown as Doc<"events">;
    const confirmedAssociation = {
      eventId: "event123",
      worldId: "world123",
      sourceType: "manual",
      confidence: 1,
      confirmationState: "confirmed",
      updatedAt: now,
    } as unknown as Doc<"eventWorlds">;
    const unconfirmedAssociation = {
      ...confirmedAssociation,
      confirmationState: "unconfirmed",
    } as unknown as Doc<"eventWorlds">;

    const previews = createPublicActiveWorldPreviews(
      [
        { association: unconfirmedAssociation, event, world },
        {
          association: confirmedAssociation,
          event: { ...event, publicationState: "draft_private" } as unknown as Doc<"events">,
          world,
        },
        {
          association: confirmedAssociation,
          event: { ...event, startAt: now - 86_400_000 } as unknown as Doc<"events">,
          world,
        },
        {
          association: confirmedAssociation,
          event,
          world: { ...world, publicationState: "draft_private" } as unknown as Doc<"worlds">,
        },
      ],
      now,
      3,
    );

    assert.equal(previews.length, 0);
  });
});
