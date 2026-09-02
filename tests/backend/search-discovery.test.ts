import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";
import {
  projectPublicSearchResult,
  publicSearchLookupAvatarUrl,
  publicSearchLookupUsesLogo,
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
import {
  createVocabularyKey,
  collectVocabularyKeys,
  recordVocabularyTerms,
  releaseVocabularyTerms,
  SEEDED_VOCABULARY_TERMS,
} from "../../convex/_vocabulary";

function createVocabularyDb(rows: Array<Record<string, unknown>>) {
  const db = {
    query(table: string) {
      assert.equal(table, "vocabularyTerms");

      return {
        withIndex(_index: string, builder: (query: unknown) => unknown) {
          const values: Record<string, unknown> = {};
          const query = {
            eq(field: string, value: unknown) {
              values[field] = value;
              return query;
            },
          };

          builder(query);

          return {
            async unique() {
              return (
                rows.find((row) =>
                  Object.entries(values).every(([field, value]) => row[field] === value),
                ) ?? null
              );
            },
          };
        },
      };
    },
    async patch(id: string, patch: Record<string, unknown>) {
      Object.assign(rows.find((row) => row._id === id) as Record<string, unknown>, patch);
    },
    async insert(_table: string, row: Record<string, unknown>) {
      rows.push({ ...row, _id: `term${rows.length}` });
    },
  };

  return { db, rows };
}

describe("vocabulary usage counts", () => {
  // Distinct labels can canonicalize to one key, but the search document stores that
  // key once. Counting per label would inflate the term, and a later release of the
  // same profile would then erase another profile's contribution.
  const colliding = [
    { scope: "profile_tag" as const, label: "Drum & Bass" },
    { scope: "profile_tag" as const, label: "Drum and Bass" },
  ];

  it("counts colliding labels once when recording", async () => {
    const store = createVocabularyDb([]);

    await recordVocabularyTerms(store.db as never, colliding, 5);

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].key, createVocabularyKey("Drum & Bass"));
    assert.equal(store.rows[0].usageCount, 1);
  });

  it("refreshes a retained term's label without counting it again", async () => {
    // The two spellings share a key, so a profile correcting one contributes
    // nothing new to count -- but the label is what discovery shows, and
    // skipping the candidate left it reading the old wording even where this
    // profile was the only contributor.
    const store = createVocabularyDb([
      {
        _id: "term0",
        scope: "profile_tag",
        key: createVocabularyKey("Drum & Bass"),
        label: "Drum & Bass",
        aliases: [],
        source: "user_created",
        usageCount: 1,
        rank: 10,
      },
    ]);

    await recordVocabularyTerms(
      store.db as never,
      [{ scope: "profile_tag" as const, label: "Drum and Bass" }],
      7,
      { incrementUsage: false },
    );

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].label, "Drum and Bass");
    assert.equal(store.rows[0].usageCount, 1);
  });

  it("leaves a shared term's label to the profiles sharing it", async () => {
    // Two public profiles spelling one key differently. Reconciling on every
    // reindex meant an edit to either profile's bio re-asserted that profile's
    // spelling as the discovery label, so the last save won a fight neither
    // profile had picked.
    const store = createVocabularyDb([
      {
        _id: "term0",
        scope: "profile_tag",
        key: createVocabularyKey("Drum & Bass"),
        label: "Drum & Bass",
        aliases: [],
        source: "user_created",
        usageCount: 2,
        rank: 10,
      },
    ]);

    await recordVocabularyTerms(
      store.db as never,
      [{ scope: "profile_tag" as const, label: "Drum and Bass" }],
      7,
      { incrementUsage: false },
    );

    assert.equal(store.rows[0].label, "Drum & Bass");
    assert.equal(store.rows[0].usageCount, 2);
    // Not touched at all, so an unrelated edit does not even restamp the row.
    assert.equal(store.rows[0].updatedAt, undefined);
  });

  it("does not invent a term for a retained key with no row", async () => {
    // A retained key whose row went missing is a lost record, not a new
    // contribution. Inserting one would put a count on the books that no later
    // release accounts for.
    const store = createVocabularyDb([]);

    await recordVocabularyTerms(
      store.db as never,
      [{ scope: "profile_tag" as const, label: "Drum and Bass" }],
      7,
      { incrementUsage: false },
    );

    assert.deepEqual(store.rows, []);
  });

  it("releases colliding labels once", async () => {
    const store = createVocabularyDb([
      {
        _id: "term0",
        scope: "profile_tag",
        key: createVocabularyKey("Drum & Bass"),
        usageCount: 2,
      },
    ]);

    await releaseVocabularyTerms(store.db as never, colliding, 5);

    assert.equal(store.rows[0].usageCount, 1);
  });
});

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
    assert.equal(document.routePath, "/dj-aurora");
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
      notes: "private-manager-token",
      sourceType: "manual",
      sourceLabel: "Fixture event listing",
      eventStatus: "scheduled",
      publicationState: "published",
      updatedAt: 1,
    } as unknown as Doc<"events">;
    const community = {
      slug: "afterglow",
      displayName: "Afterglow Social",
      profileType: "community",
      publicationState: "published",
      publicSurfacingState: "public",
    } as unknown as Doc<"profiles">;

    const worldDocument = createWorldSearchDocument(world);
    const eventDocument = createEventSearchDocument(event, { community, world, roleLabels: ["House"] });

    assert.equal(worldDocument.entityType, "world");
    assert.ok(worldDocument.searchText.includes("Afterglow Social"));
    assert.equal(eventDocument.entityType, "event");
    assert.equal(eventDocument.publicState, "public");
    assert.equal(eventDocument.routePath, "/afterglow/events/afterglow-harbor-sessions");
    assert.ok(eventDocument.searchText.includes("Neon Harbor"));
    assert.equal(eventDocument.searchText.includes("private-manager-token"), false);
    assert.deepEqual(eventDocument.vocabularyKeys, [
      "event_participant_role:house",
      "event_tag:afterglow_social",
      "event_tag:upcoming",
    ]);

    const hiddenCommunityDocument = createEventSearchDocument(event, {
      community: {
        ...community,
        publicSurfacingState: "suppressed",
      } as Doc<"profiles">,
    });

    assert.equal(hiddenCommunityDocument.publicState, "public");
    assert.equal(
      hiddenCommunityDocument.routePath,
      "/afterglow/events/afterglow-harbor-sessions",
    );
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

  it("returns a root route path even for a row indexed under the retired prefixes", () => {
    // `routePath` is persisted at index time, so every row written before profiles
    // moved to the site root still holds `/p/...`. Reading it back verbatim sent
    // searchers to a deleted route until that entity happened to be reindexed, so
    // the path is derived from the slug instead of stored.
    const stale = {
      entityType: "profile",
      profileType: "person",
      slug: "dj-aurora",
      routePath: "/p/dj-aurora",
      title: "DJ Aurora",
      searchText: "House",
      exactTokens: ["dj aurora"],
      vocabularyKeys: [],
      trustRank: 10,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;

    assert.equal(toPublicSearchResult(stale, "House").routePath, "/dj-aurora");
    assert.equal(
      toPublicSearchResult(
        { ...stale, entityType: "world", slug: "neon-harbor", routePath: "/w/neon-harbor" } as unknown as Doc<"searchDocuments">,
        "House",
      ).routePath,
      "/neon-harbor",
    );
  });

  it("reranks exact and event results above weaker matches", () => {
    const weak = {
      entityType: "profile",
      slug: "random-profile",
      routePath: "/random-profile",
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
      routePath: "/afterglow/events/house-night",
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
    assert.equal(results[0]?.routePath, "/afterglow/events/house-night");
  });

  it("matches BASICBIT exact aliases without case-sensitive ranking drift", () => {
    const document = {
      entityType: "profile",
      profileType: "person",
      slug: "basicbit",
      routePath: "/basicbit",
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
      routePath: `/${profile.slug}`,
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

  it("drops an event when its community became non-public after indexing", async () => {
    const event = {
      _id: "event123",
      communityProfileId: "community123",
      slug: "h4rb0r2",
    } as unknown as Doc<"events">;
    const community = {
      _id: "community123",
      profileType: "community",
      publicationState: "published",
      publicSurfacingState: "suppressed",
    } as unknown as Doc<"profiles">;
    const document = {
      entityType: "event",
      eventId: event._id,
      slug: "harbor-sessions",
      routePath: "/afterglow/events/harbor-sessions",
      title: "Harbor Sessions",
      searchText: "Harbor Sessions",
      exactTokens: ["harbor sessions"],
      vocabularyKeys: [],
      trustRank: 10,
      featuredRank: 20,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const ctx = {
      db: {
        get: async (id: string) => id === event._id ? event : community,
      },
    } as unknown as QueryCtx;

    assert.equal(await projectPublicSearchResult(ctx, document, "Harbor"), null);
  });

  it("rebuilds event result routes from the live community slug", async () => {
    const event = {
      _id: "event123",
      communityProfileId: "community123",
      slug: "h4rb0r2",
    } as unknown as Doc<"events">;
    const community = {
      _id: "community123",
      slug: "afterglow-renamed",
      displayName: "Afterglow Renamed",
      profileType: "community",
      publicationState: "published",
      publicSurfacingState: "public",
    } as unknown as Doc<"profiles">;
    const document = {
      entityType: "event",
      eventId: event._id,
      slug: event.slug,
      routePath: "/afterglow/events/h4rb0r2",
      title: "Harbor Sessions",
      subtitle: "Afterglow",
      searchText: "Harbor Sessions",
      exactTokens: ["harbor sessions"],
      vocabularyKeys: [],
      trustRank: 10,
      featuredRank: 20,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const ctx = {
      db: {
        get: async (id: string) => id === event._id ? event : community,
      },
    } as unknown as QueryCtx;

    const result = await projectPublicSearchResult(ctx, document, "Harbor");

    assert.equal(result?.routePath, "/afterglow-renamed/events/h4rb0r2");
    assert.equal(result?.subtitle, "Afterglow Renamed");
  });

  it("projects profile verification without exposing it as provenance copy", async () => {
    const profile = {
      _id: "profile123",
      slug: "basicbit",
      displayName: "BASICBIT",
      aliases: [],
      tags: [],
      genres: [],
      outboundLinks: [],
      claimState: "claimed_verified",
      creationSource: "self",
      publicationState: "published",
      publicSurfacingState: "public",
      profileType: "person",
      person: { roleTags: [] },
      updatedAt: 2,
    } as unknown as Doc<"profiles">;
    const document = {
      entityType: "profile",
      profileType: "person",
      profileId: profile._id,
      slug: profile.slug,
      routePath: `/${profile.slug}`,
      title: profile.displayName,
      searchText: profile.displayName,
      exactTokens: ["basicbit"],
      vocabularyKeys: [],
      trustRank: 40,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const queryBuilder = {
      withIndex: () => queryBuilder,
      collect: async () => [],
      unique: async () => null,
    };
    const ctx = {
      db: {
        get: async () => profile,
        query: () => queryBuilder,
      },
    } as unknown as QueryCtx;

    const result = await projectPublicSearchResult(ctx, document, "BASICBIT");

    assert.equal(result?.trustLabel, "claimed_verified");
    assert.equal(result?.source, undefined);
  });

  it("applies the result limit after dropping stale search documents", async () => {
    const hiddenProfiles = Array.from({ length: 3 }, (_, index) => ({
      _id: `hiddenProfile${index}`,
      slug: `hidden-house-${index}`,
      displayName: `House ${index}`,
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
    })) as unknown as Doc<"profiles">[];
    const hiddenDocuments = hiddenProfiles.map((profile) => ({
      entityType: "profile",
      profileType: "person",
      profileId: profile._id,
      slug: profile.slug,
      routePath: `/${profile.slug}`,
      title: profile.displayName,
      searchText: "House",
      exactTokens: ["house"],
      vocabularyKeys: [],
      trustRank: 40,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    })) as unknown as Doc<"searchDocuments">[];
    const visibleDocument = {
      entityType: "event",
      slug: "visible-house-night",
      routePath: "/visible-house-night",
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
      take: async (count: number) => [...hiddenDocuments, visibleDocument].slice(0, count),
    };
    const ctx = {
      db: {
        get: async (id: string) => hiddenProfiles.find((profile) => profile._id === id) ?? null,
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

  it("hydrates only the ranked window needed to fill the result limit", async () => {
    const profiles = ["first-house", "second-house"].map((slug, index) => ({
      _id: `profile-${index}`,
      slug,
      displayName: index === 0 ? "First House" : "Second House",
      aliases: [],
      tags: [],
      genres: [],
      claimState: "claimed_verified",
      creationSource: "self",
      publicationState: "published",
      publicSurfacingState: "public",
      profileType: "person",
      person: { roleTags: [] },
      updatedAt: 2,
    })) as unknown as Doc<"profiles">[];
    const documents = profiles.map((profile, index) => ({
      entityType: "profile",
      profileType: "person",
      profileId: profile._id,
      slug: profile.slug,
      routePath: `/${profile.slug}`,
      title: profile.displayName,
      searchText: "House",
      exactTokens: index === 0 ? ["house"] : [],
      vocabularyKeys: [],
      trustRank: 20 - index,
      featuredRank: 0,
      publicState: "public",
      updatedAt: 1,
    })) as unknown as Doc<"searchDocuments">[];
    const searchBuilder = {
      search: () => searchBuilder,
      eq: () => searchBuilder,
    };
    const searchQuery = {
      withSearchIndex: (_index: string, configure: (builder: typeof searchBuilder) => unknown) => {
        configure(searchBuilder);
        return searchQuery;
      },
      take: async () => documents,
    };
    const emptyIndexQuery = {
      withIndex: () => emptyIndexQuery,
      collect: async () => [],
      unique: async () => null,
    };
    let profileReads = 0;
    const ctx = {
      db: {
        get: async (id: string) => {
          profileReads += 1;
          return profiles.find((profile) => profile._id === id) ?? null;
        },
        query: (table: string) => table === "searchDocuments" ? searchQuery : emptyIndexQuery,
      },
    } as unknown as QueryCtx;

    const results = await searchPublicDocuments(
      ctx,
      { query: "House", limit: 1, profileType: "person" },
      { defaultLimit: 10, maxLimit: 20 },
    );

    assert.equal(results.length, 1);
    assert.equal(profileReads, 1);
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

  it("preserves avatar appearance through public search and lookup projections", () => {
    const avatarAppearance = {
      borderEnabled: true,
      borderColor: "#67e8f9",
      borderWidthPx: 4,
      borderSoftnessPx: 12,
      radiusPercent: 18,
    };
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
    const document = {
      entityType: "profile",
      profileType: "person",
      slug: "basicbit",
      routePath: "/basicbit",
      title: "BASICBIT",
      searchText: "BASICBIT",
      exactTokens: ["basicbit"],
      vocabularyKeys: [],
      trustRank: 40,
      featuredRank: 40,
      publicState: "public",
      updatedAt: 1,
    } as unknown as Doc<"searchDocuments">;
    const mediaKit = {
      additionalLogos: [],
      assets: [],
      avatarAppearance,
      compactDisplay: "profile_image" as const,
      galleryAssets: [],
      logos: [],
    };

    assert.deepEqual(toPublicSearchResult(document, "", mediaKit).avatarAppearance, avatarAppearance);
    assert.deepEqual(
      toProfileLookupResult(profile, { avatarAppearance })?.avatarAppearance,
      avatarAppearance,
    );
    assert.equal(
      toProfileLookupResult(profile, { avatarImageKind: "profile" })?.avatarImageKind,
      "profile",
    );
  });

  it("keeps the configured compact-display image ahead of the profile-image fallback", () => {
    const compactLogoResult = {
      imageUrl: "/api/v0/profiles/basicbit/assets/compact-logo/file",
      logoImageUrl: "/api/v0/profiles/basicbit/assets/compact-logo/file",
      profileImageUrl: "/api/v0/profiles/basicbit/assets/profile-image/file",
    };

    assert.equal(
      publicSearchLookupAvatarUrl(compactLogoResult),
      "/api/v0/profiles/basicbit/assets/compact-logo/file",
    );
    assert.equal(publicSearchLookupUsesLogo(compactLogoResult), true);
    assert.equal(
      publicSearchLookupUsesLogo({
        ...compactLogoResult,
        imageUrl: compactLogoResult.profileImageUrl,
      }),
      false,
    );
  });

  it("caps stale event featured rank after an event has passed", () => {
    const pastEvent = {
      entityType: "event",
      slug: "past-house-night",
      routePath: "/afterglow/events/past-house-night",
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
      routePath: "/afterglow/events/upcoming-house-night",
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
