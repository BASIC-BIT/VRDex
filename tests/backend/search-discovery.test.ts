import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
import {
  createEventSearchDocument,
  createProfileSearchDocument,
  createWorldSearchDocument,
  sortSearchResults,
  toPublicSearchResult,
} from "../../convex/_searchDocuments";
import { createVocabularyKey, collectVocabularyKeys } from "../../convex/_vocabulary";

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
});

describe("search document projection", () => {
  it("builds weighted profile documents and hides suppressed profiles", () => {
    const profile = {
      _id: "profile123",
      slug: "dj-aurora",
      displayName: "DJ Aurora",
      sortName: "dj aurora",
      aliases: ["Auralight"],
      tags: ["Melodic House"],
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
    assert.deepEqual(document.vocabularyKeys, ["person_role:dj", "profile_tag:melodic_house"]);
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
    const eventDocument = createEventSearchDocument(event, { world, roleLabels: ["Headliner"] });

    assert.equal(worldDocument.entityType, "world");
    assert.equal(eventDocument.entityType, "event");
    assert.equal(eventDocument.publicState, "public");
    assert.ok(eventDocument.searchText.includes("Neon Harbor"));
    assert.deepEqual(eventDocument.vocabularyKeys, [
      "event_participant_role:headliner",
      "event_tag:afterglow_social",
      "event_tag:upcoming",
    ]);
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
});
