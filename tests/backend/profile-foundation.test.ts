import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createProfileSlugBase,
  createProfileSlugCandidate,
  normalizeProfileSlugInput,
  PROFILE_SLUG_MAX_LENGTH,
  toProfileSlug,
  validateProfileSlug,
} from "../../convex/_profileSlugs";
import { canEditProfileField, canReadProfile } from "../../convex/_profilePermissions";
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
