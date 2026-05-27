import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc } from "../../convex/_generated/dataModel";
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
      tags: ["House"],
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
    assert.equal(publicProfile.source?.label, "Community submitted");
    assert.equal(publicProfile.trustLabel, "community_submitted");
    assert.equal(publicProfile.outboundLinks.length, 1);
    assert.equal(publicProfile.outboundLinks[0]?.url, "https://example.invalid/dj-celine-kofi");
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
