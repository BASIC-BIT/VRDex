import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";
import {
  projectPublicSearchResult,
  publicSearchLookupAvatarUrl,
  searchPublicDocuments,
} from "../../convex/_publicSearch";
import { toProfileLookupResult } from "../../convex/_profileLookup";
import { firstSafePublicImageUrl } from "../../convex/_publicFields";
import {
  createEventSearchDocument,
  createProfileSearchDocument,
  createWorldSearchDocument,
  sortSearchResults,
  toPublicSearchResult,
} from "../../convex/_searchDocuments";
import { createVocabularyKey, collectVocabularyKeys, SEEDED_VOCABULARY_TERMS } from "../../convex/_vocabulary";

describe("vocabulary normalization", () => {
  it("normalizes obvious duplicate terms into stable keys", () => {
    assert.equal(createVocabularyKey("  Melodic   House  "), "melodic_house");
    assert.equal(createVocabularyKey("DJs"), "djs");
    assert.deepEqual(
      collectVocabularyKeys([
        { scope: "profile_tag", label: "House" },
        { scope: "profile_tag", label: " house " },
        { scope: "person_role", label: "DJ" },
      ]),
      ["person_role:dj", "profile_tag:house"],
    );
  });

  it("keeps legacy event role labels as aliases", () => {
    const djSet = SEEDED_VOCABULARY_TERMS.find(
      (term) => term.scope === "event_participant_role" && term.label === "DJ set",
    );
    const host = SEEDED_VOCABULARY_TERMS.find(
      (term) => term.scope === "event_participant_role" && term.label === "Host",
    );

    assert.ok(djSet?.aliases?.includes("Headliner"));
    assert.ok(host?.aliases?.includes("Opener"));
  });
});

describe("search document projection", () => {
  it("builds weighted profile documents and hides suppressed profiles", () => {
    const profile = {
      _id: "profile123",
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      sortName: "dj aurora",
      aliases: ["Auralight"],
      searchAliases: ["dj_aurora"],
      tags: ["Melodic House"],
      genres: [
        {
          slug: "drum-and-bass",
          displayName: "Drum and Bass",
          displayLabel: "DnB",
          aliases: ["D&B", "drum & bass"],
          featured: true,
          source: "owner_selected",
          confidence: "high",
          explicit: true,
        },
      ],
      headline: "Late-night VRChat floors.",
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "suppressed",
      creationSource: "community",
      updatedAt: 1,
      profileType: "person",
      person: {
        roleTags: ["DJ"],
      },
    } as unknown as Doc<"profiles">;

    const document = createProfileSearchDocument(profile);

    assert.equal(document.publicState, "hidden");
    assert.equal(document.routePath, "/p/dj-aurora");
    assert.equal(document.trustRank, 40);
    assert.ok(document.searchText.includes("DJ Aurora"));
    assert.ok(document.searchText.includes("dj_aurora"));
    assert.ok(document.searchText.includes("D&B"));
    assert.deepEqual(document.vocabularyKeys, [
      "person_role:dj",
      "profile_genre:drum_and_bass",
      "profile_tag:melodic_house",
    ]);
  });

  it("omits unlisted and private profile fields from discovery documents", () => {
    const profile = {
      _id: "profile123",
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      sortName: "dj aurora",
      aliases: ["Private Alias"],
      searchAliases: ["search-only-alias"],
      tags: ["Unlisted Tag"],
      genres: [
        {
          slug: "unlisted-genre",
          displayName: "Unlisted Genre",
          source: "owner_selected",
          confidence: "high",
          explicit: true,
        },
      ],
      headline: "Private headline",
      bio: "Public bio",
      avatarImageUrl: "https://example.invalid/private-avatar.png",
      bannerImageUrl: "https://example.invalid/public-banner.png",
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: 1,
      fieldVisibility: {
        aliases: "private",
        tags: "unlisted",
        genres: "unlisted",
        headline: "private",
        bio: "public",
        avatarImageUrl: "private",
        bannerImageUrl: "public",
        personRoleTags: "unlisted",
      },
      profileType: "person",
      person: {
        roleTags: ["Unlisted Role"],
      },
    } as unknown as Doc<"profiles">;

    const document = createProfileSearchDocument(profile);

    assert.equal(document.summary, "Public bio");
    assert.equal(document.imageUrl, "https://example.invalid/public-banner.png");
    assert.equal(document.searchText.includes("Private Alias"), false);
    assert.equal(document.searchText.includes("search-only-alias"), true);
    assert.equal(document.searchText.includes("Unlisted Tag"), false);
    assert.equal(document.searchText.includes("Unlisted Genre"), false);
    assert.equal(document.searchText.includes("Private headline"), false);
    assert.equal(document.searchText.includes("Unlisted Role"), false);
    assert.deepEqual(document.vocabularyKeys, []);
    assert.deepEqual(document.exactTokens, ["dj aurora", "search only alias"]);
  });

  it("builds world and event documents for universal search", () => {
    const world = {
      _id: "world123",
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world"],
      summary: "A VRChat venue.",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [
        {
          role: "world_author",
          displayName: "Afterglow Social",
          profileSlug: "afterglow-social",
          profileType: "community",
        },
      ],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: 1,
    } as unknown as Doc<"worlds">;
    const event = {
      _id: "event123",
      slug: "afterglow-harbor-sessions",
      title: "Afterglow Harbor Sessions",
      sortTitle: "afterglow harbor sessions",
      startAt: Date.now() + 86_400_000,
      communityName: "Afterglow Social",
      summary: "A poster-forward fixture event.",
      sourceType: "manual",
      sourceLabel: "Fixture event listing",
      publicationState: "published",
      updatedAt: 1,
    } as unknown as Doc<"events">;

    const worldDocument = createWorldSearchDocument(world);
    const eventDocument = createEventSearchDocument(event, { world, roleLabels: ["House"] });

    assert.equal(worldDocument.entityType, "world");
    assert.ok(worldDocument.searchText.includes("Afterglow Social"));
    assert.equal(eventDocument.entityType, "event");
    assert.equal(eventDocument.publicState, "public");
    assert.ok(eventDocument.searchText.includes("Neon Harbor"));
    assert.deepEqual(eventDocument.vocabularyKeys, [
      "event_participant_role:house",
      "event_tag:afterglow_social",
      "event_tag:upcoming",
    ]);
  });

  it("omits hidden linked profile attribution names from world search documents", () => {
    const world = {
      _id: "world123",
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world"],
      summary: "A VRChat venue.",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [
        {
          role: "world_author",
          displayName: "Suppressed Creator",
          profileSlug: "suppressed-creator",
          profileType: "person",
        },
        {
          role: "builder",
          displayName: "Unlinked Builder",
        },
      ],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: 1,
    } as unknown as Doc<"worlds">;

    const document = createWorldSearchDocument(world, {
      hiddenProfileKeys: new Set(["person:suppressed-creator"]),
    });

    assert.equal(document.searchText.includes("Suppressed Creator"), false);
    assert.equal(document.exactTokens.includes("suppressed creator"), false);
    assert.ok(document.searchText.includes("Unlinked Builder"));
  });

  it("reranks exact and event results above weaker matches", () => {
    const weak = {
      entityType: "profile",
      slug: "random-profile",
      routePath: "/p/random-profile",
      title: "Random Profile",
      searchText: "House",
      exactTokens: ["random profile"],
      vocabularyKeys: ["profile_tag:house"],
      trustRank: 10,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const strong = {
      ...weak,
      entityType: "event",
      slug: "house-night",
      routePath: "/e/house-night",
      title: "House Night",
      exactTokens: ["house"],
      trustRank: 30,
      featuredRank: 40,
      startsAt: Date.now() + 3_600_000,
    } as unknown as Doc<"searchDocuments">;

    const results = sortSearchResults([
      toPublicSearchResult(weak, "House"),
      toPublicSearchResult(strong, "House"),
    ]);

    assert.equal(results[0]?.slug, "house-night");
  });

  it("matches BASICBIT exact aliases without case-sensitive ranking drift", () => {
    const document = {
      entityType: "profile",
      profileType: "person",
      slug: "basicbit",
      routePath: "/p/basicbit",
      title: "BASICBIT",
      searchText: "BASICBIT BASIC basic_bit",
      exactTokens: ["basic", "basic bit", "basicbit"],
      vocabularyKeys: ["person_role:vrdj"],
      trustRank: 40,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;

    const upper = toPublicSearchResult(document, "BASICBIT");
    const lower = toPublicSearchResult(document, "basicbit");
    const underscoredAlias = toPublicSearchResult(document, "basic_bit");

    assert.equal(upper.score, lower.score);
    assert.equal(underscoredAlias.score, upper.score);
    assert.equal(upper.slug, "basicbit");
  });

  it("drops a profile that became non-public after its search document was indexed", async () => {
    const profile = {
      _id: "profile123",
      slug: "hidden-basicbit",
      displayName: "Hidden BASICBIT",
      aliases: [],
      tags: [],
      genres: [],
      claimState: "unclaimed",
      creationSource: "import",
      publicationState: "published",
      publicSurfacingState: "suppressed",
      profileType: "person",
      person: { roleTags: [] },
      updatedAt: 2,
    } as unknown as Doc<"profiles">;
    const document = {
      entityType: "profile",
      profileType: "person",
      profileId: profile._id,
      slug: profile.slug,
      routePath: `/p/${profile.slug}`,
      title: profile.displayName,
      searchText: profile.displayName,
      exactTokens: ["hidden basicbit"],
      vocabularyKeys: [],
      trustRank: 8,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const ctx = {
      db: {
        get: async () => profile,
      },
    } as unknown as QueryCtx;

    assert.equal(await projectPublicSearchResult(ctx, document, "BASICBIT"), null);
  });

  it("applies the result limit after dropping stale search documents", async () => {
    const hiddenProfile = {
      _id: "hiddenProfile",
      slug: "hidden-house",
      displayName: "House",
      aliases: [],
      tags: [],
      genres: [],
      claimState: "unclaimed",
      creationSource: "import",
      publicationState: "published",
      publicSurfacingState: "suppressed",
      profileType: "person",
      person: { roleTags: [] },
      updatedAt: 2,
    } as unknown as Doc<"profiles">;
    const hiddenDocument = {
      entityType: "profile",
      profileType: "person",
      profileId: hiddenProfile._id,
      slug: hiddenProfile.slug,
      routePath: `/p/${hiddenProfile.slug}`,
      title: hiddenProfile.displayName,
      searchText: "House",
      exactTokens: ["house"],
      vocabularyKeys: [],
      trustRank: 40,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const visibleDocument = {
      entityType: "event",
      slug: "visible-house-night",
      routePath: "/e/visible-house-night",
      title: "Visible House Night",
      searchText: "House",
      exactTokens: [],
      vocabularyKeys: ["event_tag:house"],
      trustRank: 10,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const searchBuilder = {
      search: () => searchBuilder,
      eq: () => searchBuilder,
    };
    const queryBuilder = {
      withSearchIndex: (_index: string, configure: (builder: typeof searchBuilder) => unknown) => {
        configure(searchBuilder);
        return queryBuilder;
      },
      take: async () => [hiddenDocument, visibleDocument],
    };
    const ctx = {
      db: {
        get: async () => hiddenProfile,
        query: () => queryBuilder,
      },
    } as unknown as QueryCtx;

    const results = await searchPublicDocuments(
      ctx,
      { query: "House", limit: 1 },
      { defaultLimit: 10, maxLimit: 20 },
    );

    assert.deepEqual(results.map((result) => result.slug), ["visible-house-night"]);
  });

  it("uses the first safe public avatar candidate, including local media routes", () => {
    const profile = {
      slug: "basicbit",
      displayName: "BASICBIT",
      aliases: [],
      tags: [],
      genres: [],
      claimState: "claimed_verified",
      creationSource: "self",
      profileType: "person",
      person: { roleTags: ["VRDJ"] },
      outboundLinks: [],
    } as unknown as Doc<"profiles">;
    const avatarImageUrl = firstSafePublicImageUrl(
      "javascript:alert(1)",
      "/api/profile-assets/basicbit",
      "https://example.invalid/fallback.png",
    );
    const result = toProfileLookupResult(profile, { avatarImageUrl });

    assert.equal(avatarImageUrl, "/api/profile-assets/basicbit");
    assert.equal(result?.avatarImageUrl, "/api/profile-assets/basicbit");
  });

  it("keeps the configured compact-display image ahead of the profile-image fallback", () => {
    assert.equal(
      publicSearchLookupAvatarUrl({
        imageUrl: "/api/v0/profiles/basicbit/assets/compact-logo/file",
        profileImageUrl: "/api/v0/profiles/basicbit/assets/profile-image/file",
      }),
      "/api/v0/profiles/basicbit/assets/compact-logo/file",
    );
  });

  it("caps stale event featured rank after an event has passed", () => {
    const pastEvent = {
      entityType: "event",
      slug: "past-house-night",
      routePath: "/e/past-house-night",
      title: "Past House Night",
      searchText: "House",
      exactTokens: ["house"],
      vocabularyKeys: ["event_tag:house"],
      trustRank: 30,
      featuredRank: 42,
      startsAt: Date.now() - 3_600_000,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const upcomingEvent = {
      ...pastEvent,
      slug: "upcoming-house-night",
      routePath: "/e/upcoming-house-night",
      title: "Upcoming House Night",
      startsAt: Date.now() + 3_600_000,
    } as unknown as Doc<"searchDocuments">;

    const results = sortSearchResults([
      toPublicSearchResult(pastEvent, "House"),
      toPublicSearchResult(upcomingEvent, "House"),
    ]);

    assert.equal(results[0]?.slug, "upcoming-house-night");
  });
});
