import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isProfileFieldVisible } from "../../convex/_profileFieldVisibility";
import { toProfileLookupResult } from "../../convex/_profileLookup";
import { grantProfileOwner } from "../../convex/_profileOwnership";
import {
  createProfileSlugBase,
  createProfileSlugCandidate,
  normalizeProfileSlugInput,
  PROFILE_SLUG_MAX_LENGTH,
  toProfileSlug,
  validateProfileSlug,
} from "../../convex/_profileSlugs";
import { canEditProfileField, canReadProfile } from "../../convex/_profilePermissions";
import { toPublicProfile } from "../../convex/_profilePublic";
import {
  createProfileSortName,
  sanitizeCommunitySubmissionProfileInput,
  sanitizeProfileTextList,
} from "../../convex/_profileSubmissions";
import { createPublicProfileWorldCredits } from "../../convex/_profileWorldCredits";
import {
  canTransitionProfileClaimState,
  getProfileTrustLabel,
  requireProfileClaimStateTransition,
} from "../../convex/_profileStates";

describe("profile slug helpers", () => {
  it("normalizes display text into strict ASCII slug candidates", () => {
    assert.equal(
      normalizeProfileSlugInput(" DJ Celine & Friends!! "),
      "dj-celine-and-friends",
    );
  });

  it("validates canonical slug rules", () => {
    assert.deepEqual(validateProfileSlug("dj-celine"), {
      ok: true,
      slug: "dj-celine",
    });
    assert.deepEqual(validateProfileSlug("DJ-Celine"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateProfileSlug("dj--celine"), {
      ok: false,
      reason: "invalid_format",
    });
    assert.deepEqual(validateProfileSlug("admin"), {
      ok: false,
      reason: "reserved",
    });
  });

  it("turns freeform input into a valid custom slug result", () => {
    assert.deepEqual(toProfileSlug("DJ Celine"), {
      ok: true,
      slug: "dj-celine",
    });
  });

  it("generates safe bases for short, reserved, empty, and long inputs", () => {
    assert.equal(createProfileSlugBase("dj"), "dj-profile");
    assert.equal(createProfileSlugBase("admin"), "admin-profile");
    assert.equal(createProfileSlugBase("!!!"), "profile-page");

    const longBase = createProfileSlugBase("a".repeat(PROFILE_SLUG_MAX_LENGTH + 20));
    assert.equal(longBase.length, PROFILE_SLUG_MAX_LENGTH);
    assert.equal(validateProfileSlug(longBase).ok, true);
  });

  it("keeps numeric retry candidates inside the maximum length", () => {
    const base = "a".repeat(PROFILE_SLUG_MAX_LENGTH);
    const candidate = createProfileSlugCandidate(base, 12);

    assert.equal(candidate.length, PROFILE_SLUG_MAX_LENGTH);
    assert.equal(candidate.endsWith("-12"), true);
  });
});

describe("profile permission helpers", () => {
  const publishedUnclaimedPerson = {
    claimState: "unclaimed",
    profileType: "person",
    publicationState: "published",
    publicSurfacingState: "public",
  } as const;

  const privateUnclaimedPerson = {
    ...publishedUnclaimedPerson,
    publicationState: "draft_private",
  } as const;

  const privateClaimedPerson = {
    ...privateUnclaimedPerson,
    claimState: "claimed_unverified",
  } as const;

  it("gates public reads by publication state", () => {
    assert.equal(canReadProfile("public", publishedUnclaimedPerson), true);
    assert.equal(canReadProfile("public", privateUnclaimedPerson), false);
    assert.equal(canReadProfile("claimed_owner", privateClaimedPerson), true);
    assert.equal(canReadProfile("moderator", privateUnclaimedPerson), true);
  });

  it("requires read access before edit access", () => {
    assert.equal(
      canEditProfileField("community_submitter", privateUnclaimedPerson, "displayName"),
      false,
    );
    assert.equal(
      canEditProfileField("community_submitter", publishedUnclaimedPerson, "displayName"),
      true,
    );
  });

  it("blocks incompatible type-specific fields and custom slug submission", () => {
    assert.equal(
      canEditProfileField("community_submitter", publishedUnclaimedPerson, "community"),
      false,
    );
    assert.equal(canEditProfileField("community_submitter", publishedUnclaimedPerson, "slug"), false);
  });
});

describe("profile claim-state helpers", () => {
  it("maps trust labels from claim state and creation source", () => {
    assert.equal(getProfileTrustLabel("unclaimed", "community"), "community_submitted");
    assert.equal(getProfileTrustLabel("unclaimed", "self"), "unclaimed");
    assert.equal(getProfileTrustLabel("claimed_unverified", "community"), "claimed_unverified");
    assert.equal(getProfileTrustLabel("claimed_verified", "community"), "claimed_verified");
  });

  it("allows only real forward claim-state transitions", () => {
    assert.equal(canTransitionProfileClaimState("unclaimed", "claimed_unverified"), true);
    assert.equal(canTransitionProfileClaimState("unclaimed", "claimed_verified"), true);
    assert.equal(canTransitionProfileClaimState("claimed_unverified", "claimed_verified"), true);
    assert.equal(canTransitionProfileClaimState("unclaimed", "unclaimed"), false);
    assert.equal(canTransitionProfileClaimState("claimed_verified", "claimed_unverified"), false);
  });

  it("throws for invalid claim-state transitions", () => {
    assert.throws(() => requireProfileClaimStateTransition("unclaimed", "unclaimed"));
    assert.throws(() => requireProfileClaimStateTransition("claimed_verified", "unclaimed"));
  });
});

describe("profile ownership helpers", () => {
  function createOwnerDb(existingOwners: Array<Record<string, unknown>>) {
    const inserted: Array<{ table: string; document: Record<string, unknown> }> = [];

    return {
      inserted,
      db: {
        query(table: string) {
          assert.equal(table, "profileOwners");

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
                async take(limit: number) {
                  return existingOwners
                    .filter((owner) =>
                      Object.entries(values).every(([field, value]) => owner[field] === value),
                    )
                    .slice(0, limit);
                },
              };
            },
          };
        },
        async insert(table: string, document: Record<string, unknown>) {
          inserted.push({ table, document });
          return "owner-new" as Id<"profileOwners">;
        },
      },
    };
  }

  it("keeps profile owner authority as a singleton", async () => {
    const profileId = "profile123" as Id<"profiles">;
    const userId = "user123" as Id<"users">;
    const existingOwner = {
      _id: "owner-existing" as Id<"profileOwners">,
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    };
    const sameOwnerDb = createOwnerDb([existingOwner]);

    assert.equal(
      await grantProfileOwner(sameOwnerDb.db as never, { profileId, userId, now: 2 }),
      existingOwner._id,
    );
    assert.equal(sameOwnerDb.inserted.length, 0);

    const newOwnerDb = createOwnerDb([]);
    assert.equal(await grantProfileOwner(newOwnerDb.db as never, { profileId, userId, now: 2 }), "owner-new");
    assert.deepEqual(newOwnerDb.inserted[0], {
      table: "profileOwners",
      document: {
        profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: 2,
        updatedAt: 2,
      },
    });

    const conflictingOwnerDb = createOwnerDb([{ ...existingOwner, userId: "otherUser" }]);
    await assert.rejects(
      () => grantProfileOwner(conflictingOwnerDb.db as never, { profileId, userId, now: 2 }),
      /already has an active owner/,
    );
  });
});

describe("profile submission helpers", () => {
  it("normalizes sort names and community submission lists", () => {
    assert.equal(createProfileSortName("  DJ Céline  "), "dj celine");
    assert.deepEqual(
      sanitizeProfileTextList([" House ", "house", "Trance", ""], "Tags", {
        maxItems: 4,
        maxLength: 16,
      }),
      ["House", "Trance"],
    );

    assert.throws(
      () => sanitizeProfileTextList(["x".repeat(17)], "Tags", { maxItems: 4, maxLength: 16 }),
      /Tags items must be 16 characters or fewer/,
    );
  });

  it("sanitizes person submissions to the narrow public field set", () => {
    assert.deepEqual(
      sanitizeCommunitySubmissionProfileInput({
        profileType: "person",
        displayName: "  DJ Celine  ",
        aliases: ["Celine", "celine"],
        tags: ["House"],
        person: {
          roleTags: ["DJ", "VJ"],
        },
      }),
      {
        profileType: "person",
        displayName: "DJ Celine",
        sortName: "dj celine",
        aliases: ["Celine"],
        tags: ["House"],
        person: {
          roleTags: ["DJ", "VJ"],
        },
      },
    );
  });

  it("sanitizes community submissions and rejects mismatched type-specific fields", () => {
    assert.deepEqual(
      sanitizeCommunitySubmissionProfileInput({
        profileType: "community",
        displayName: "Nocturne VR",
        tags: ["Events"],
        community: {
          subtype: " Club ",
          categoryTags: ["Music", "music"],
        },
      }),
      {
        profileType: "community",
        displayName: "Nocturne VR",
        sortName: "nocturne vr",
        aliases: [],
        tags: ["Events"],
        community: {
          subtype: "Club",
          categoryTags: ["Music"],
        },
      },
    );

    assert.throws(
      () =>
        sanitizeCommunitySubmissionProfileInput({
          profileType: "person",
          displayName: "DJ Celine",
          community: {
            subtype: "x".repeat(50),
          },
        }),
      /Community fields cannot be submitted for a person profile/,
    );
  });
});

describe("public profile projection", () => {
  it("omits source attribution identifiers from public profile results", () => {
    const profile = {
      profileType: "person",
      slug: "dj-celine",
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: [],
      searchAliases: ["dj_celine"],
      tags: ["House"],
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
          externalIds: {
            musicBrainzGenreId: "462f9321-6103-49c9-b6db-96219bce6f62",
            wikidataQid: "Q188994",
          },
        },
      ],
      outboundLinks: [
        {
          type: "kofi",
          label: "DJ Celine Ko-fi",
          url: "https://example.invalid/dj-celine-kofi",
          source: "owner_authored",
        },
        {
          type: "other",
          label: "Unsafe link",
          url: "http://example.invalid/unsafe",
          source: "reviewed",
        },
      ],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      publishedAt: 1,
      updatedAt: 1,
      sourceAttribution: {
        submittedAt: 1,
        submitter: {
          tokenIdentifier: "issuer|subject",
          issuer: "issuer",
          subject: "subject",
          displayName: "Submitter",
        },
      },
      person: {
        roleTags: ["DJ"],
      },
    } as Doc<"profiles">;

    const publicProfile = toPublicProfile(profile);

    assert.equal("sourceAttribution" in publicProfile, false);
    assert.equal("creationSource" in publicProfile, false);
    assert.equal("searchAliases" in publicProfile, false);
    assert.equal(publicProfile.source?.label, "Community submitted");
    assert.equal(publicProfile.trustLabel, "community_submitted");
    assert.deepEqual(publicProfile.genres, [
      {
        slug: "drum-and-bass",
        displayName: "Drum and Bass",
        displayLabel: "DnB",
        featured: true,
      },
    ]);
    assert.equal(publicProfile.outboundLinks.length, 1);
    assert.equal(publicProfile.outboundLinks[0]?.url, "https://example.invalid/dj-celine-kofi");
  });

  it("projects DJ lookup rows with public links in operator priority order", () => {
    const profile = {
      profileType: "person",
      slug: "dj-celine",
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: ["Celine"],
      tags: ["House"],
      genres: [
        {
          slug: "house",
          displayName: "House",
          source: "owner_selected",
          confidence: "high",
          explicit: true,
        },
      ],
      outboundLinks: [
        {
          type: "soundcloud",
          label: "SoundCloud",
          url: "https://soundcloud.com/dj-celine",
          source: "owner_authored",
        },
        {
          type: "vrchat_profile",
          label: "VRChat profile",
          url: "https://vrchat.com/home/user/usr_00000000-0000-4000-8000-000000000001",
          source: "reviewed",
        },
        {
          type: "discord",
          label: "Discord: djceline",
          url: "https://discord.com/users/100000000000000001",
          source: "owner_authored",
        },
      ],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      publishedAt: 1,
      updatedAt: 1,
      person: {
        roleTags: ["DJ"],
      },
    } as Doc<"profiles">;

    const lookup = toProfileLookupResult(profile);

    assert.equal(lookup?.profilePath, "/p/dj-celine");
    assert.deepEqual(lookup?.roleTags, ["DJ"]);
    assert.deepEqual(lookup?.genres, [{ slug: "house", displayName: "House" }]);
    assert.deepEqual(
      lookup?.outboundLinks.map((link) => link.type),
      ["vrchat_profile", "discord", "soundcloud"],
    );
  });

  it("keeps unlisted fields on direct profiles and hides private fields", () => {
    const profile = {
      profileType: "person",
      slug: "dj-celine",
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: ["Celine"],
      tags: ["House"],
      genres: [
        {
          slug: "private-genre",
          displayName: "Private Genre",
          source: "owner_selected",
          confidence: "high",
          explicit: true,
        },
      ],
      headline: "Private headline",
      bio: "Unlisted bio",
      avatarImageUrl: "https://example.invalid/private-avatar.png",
      bannerImageUrl: "https://example.invalid/banner.png",
      outboundLinks: [
        {
          type: "website",
          label: "Website",
          url: "https://example.invalid",
          source: "owner_authored",
        },
      ],
      claimState: "claimed_unverified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      publishedAt: 1,
      updatedAt: 1,
      fieldVisibility: {
        aliases: "private",
        tags: "unlisted",
        genres: "private",
        headline: "private",
        bio: "unlisted",
        avatarImageUrl: "private",
        bannerImageUrl: "public",
        outboundLinks: "private",
        personRoleTags: "private",
      },
      person: {
        roleTags: ["DJ"],
      },
    } as Doc<"profiles">;

    const publicProfile = toPublicProfile(profile);

    assert.equal(isProfileFieldVisible(profile, "tags", "profile_page"), true);
    assert.equal(isProfileFieldVisible(profile, "tags", "discovery"), false);
    assert.deepEqual(publicProfile.aliases, []);
    assert.deepEqual(publicProfile.tags, ["House"]);
    assert.deepEqual(publicProfile.genres, []);
    assert.equal(publicProfile.headline, undefined);
    assert.equal(publicProfile.bio, "Unlisted bio");
    assert.equal(publicProfile.avatarImageUrl, undefined);
    assert.equal(publicProfile.bannerImageUrl, "https://example.invalid/banner.png");
    assert.deepEqual(publicProfile.outboundLinks, []);
    assert.deepEqual(publicProfile.person.roleTags, []);
  });
});

describe("public profile world credits", () => {
  it("derives reciprocal credits from indexed published-world attribution records", () => {
    const publishedWorld = {
      slug: "neon-harbor",
      displayName: "Neon Harbor",
      sortName: "neon harbor",
      tags: ["Club world"],
      summary: "A VRChat venue.",
      visibilityStatus: "public",
      platformCompatibility: ["pc"],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: 1,
    } as Doc<"worlds">;
    const draftWorld = {
      ...publishedWorld,
      slug: "draft-world",
      displayName: "Draft World",
      publicationState: "draft_private",
      publicSurfacingState: "public",
    } as Doc<"worlds">;
    const worldAuthorCredit = {
      worldId: "world123",
      profileSlug: "afterglow-social",
      profileType: "community",
      role: "world_author",
      sourceLabel: "Reviewed attribution",
      updatedAt: 1,
    } as unknown as Doc<"worldProfileCredits">;
    const storefrontCredit = {
      ...worldAuthorCredit,
      role: "storefront_owner",
    } as unknown as Doc<"worldProfileCredits">;

    const credits = createPublicProfileWorldCredits(
      [
        { credit: worldAuthorCredit, world: draftWorld },
        { credit: worldAuthorCredit, world: publishedWorld },
        { credit: storefrontCredit, world: publishedWorld },
      ],
    );

    assert.equal(credits.length, 1);
    assert.equal(credits[0]?.slug, "neon-harbor");
    assert.deepEqual(credits[0]?.roles, ["world_author", "storefront_owner"]);
    assert.equal(credits[0]?.sourceLabel, "Reviewed attribution");
  });
});
