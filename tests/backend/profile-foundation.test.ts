import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PublicProfileSchema } from "../../packages/api-contracts/src/schemas";
import { isReservedSlug } from "../../convex/_globalSlugs";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  normalizeProfilePublicSectionOrder,
  toPublicProfileAppearance,
} from "../../convex/_profileAppearance";
import {
  createProfileAssetUploadIntentRecord,
  createProfileAssetStorageKey,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCredit,
  finalizeProfileAssetUploadIntentUpload,
  getPublicProfileMediaKit,
  normalizeProfileAvatarAppearance,
  normalizeProfileAssetMimeType,
  normalizeProfileAssetSourceUrl,
  sanitizeProfileAssetCaption,
  sanitizeProfileAssetLabel,
  validateProfileAssetByteSize,
} from "../../convex/_profileAssets";
import {
  isProfileFieldVisible,
  materializeProfileFieldVisibility,
  normalizeProfileFieldVisibility,
} from "../../convex/_profileFieldVisibility";
import { toProfileLookupResult } from "../../convex/_profileLookup";
import { approveProfileClaimForUser, grantProfileOwner } from "../../convex/_profileOwnership";
import {
  applyProfileFieldVisibilityUpdate,
  toOwnedProfilePrivacyResult,
} from "../../convex/_profilePrivacy";
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
import { toPublicProfileShareCard } from "../../convex/_profileShareCard";
import {
  createProfileSortName,
  PROFILE_ALIAS_MAX_COUNT,
  sanitizeCommunitySubmissionProfileInput,
  sanitizeProfileTextList,
} from "../../convex/_profileSubmissions";
import {
  assertProfileEditNotSuppressed,
  sanitizeApiProfileUpdateInput,
  submittedEditableFields,
  type ApiProfileUpdateInput,
} from "../../convex/_profileUpdates";
import { createClaimedDiscordProfileForUser } from "../../convex/_profileClaimCreation";
import { createPublicProfileWorldCredits } from "../../convex/_profileWorldCredits";
import {
  canTransitionProfileClaimState,
  getProfileTrustLabel,
  requireProfileClaimStateTransition,
} from "../../convex/_profileStates";

type ProfileClaimTestTable =
  | "profiles"
  | "profileOwners"
  | "profileClaimRequests"
  | "profileAuditEvents"
  | "searchDocuments"
  | "shortLinks"
  | "vocabularyTerms"
  | "profileSuppressionRequests"
  // Slug uniqueness is global across the three root-routed entity types, so
  // assigning a profile slug reads these too.
  | "worlds"
  | "events";
type ProfileClaimTestRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

function valueAtPath(row: ProfileClaimTestRow, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== "object") {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, row);
}

function createProfileClaimTestDb(
  initial: Partial<Record<ProfileClaimTestTable, Array<Partial<ProfileClaimTestRow>>>> = {},
) {
  const tableNames: ProfileClaimTestTable[] = [
    "profiles",
    "profileOwners",
    "profileClaimRequests",
    "profileAuditEvents",
    "searchDocuments",
    "shortLinks",
    "vocabularyTerms",
    "profileSuppressionRequests",
    "worlds",
    "events",
  ];
  const tables = Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      (initial[tableName] ?? []).map((row, index) => ({
        _id: `${tableName}-seed-${index}`,
        _creationTime: index,
        ...row,
      })) as ProfileClaimTestRow[],
    ]),
  ) as Record<ProfileClaimTestTable, ProfileClaimTestRow[]>;
  let sequence = 0;

  function allRows() {
    return tableNames.flatMap((tableName) => tables[tableName]);
  }

  const db = {
    async get(id: string) {
      return allRows().find((row) => row._id === id) ?? null;
    },
    query(tableName: ProfileClaimTestTable) {
      return {
        withIndex(_indexName: string, builder: (query: { eq: (field: string, value: unknown) => unknown }) => unknown) {
          const filters: Array<{ field: string; value: unknown }> = [];
          const query = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return query;
            },
          };

          builder(query);

          function matchingRows() {
            return tables[tableName].filter((row) =>
              filters.every((filter) => valueAtPath(row, filter.field) === filter.value),
            );
          }

          return {
            async unique() {
              const rows = matchingRows();

              if (rows.length > 1) {
                throw new Error("Expected unique query result.");
              }

              return rows[0] ?? null;
            },
            async take(limit: number) {
              return matchingRows().slice(0, limit);
            },
            async collect() {
              return matchingRows();
            },
          };
        },
      };
    },
    async insert(tableName: ProfileClaimTestTable, document: Record<string, unknown>) {
      sequence += 1;
      const row = {
        _id: `${tableName}-${sequence}`,
        _creationTime: sequence,
        ...document,
      };

      tables[tableName].push(row);

      return row._id;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      const row = allRows().find((entry) => entry._id === id);

      if (row === undefined) {
        throw new Error(`Missing row ${id}.`);
      }

      Object.assign(row, patch);
    },
  };

  return { db, tables };
}

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
    // Reserved names pass shape validation. Rejecting them is the assignment path's
    // job, so a reserved name an operator has already granted still looks up.
    assert.deepEqual(validateProfileSlug("admin"), {
      ok: true,
      slug: "admin",
    });
    assert.equal(isReservedSlug("admin"), true);
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

  it("lets the community correct information about an unclaimed person", () => {
    // The rule is information about the person versus the record itself, not a
    // growing allowlist. outboundLinks is the case that proves it: a DJ's stream
    // links are why anyone visits the profile, and the old allowlist left them
    // out by omission rather than by any decision.
    for (const field of [
      "displayName",
      "aliases",
      "tags",
      "headline",
      "bio",
      "region",
      "outboundLinks",
      "person",
    ] as const) {
      assert.equal(
        canEditProfileField("community_submitter", publishedUnclaimedPerson, field),
        true,
        field,
      );
    }
  });

  // Editing a field means being shown its current value first, and no public
  // surface renders `timezone` -- only the operator lookup does, behind
  // `view_private_seed_lookup`. Visibility does not catch this on its own: the
  // field sits at `public` by default and is invisible anyway, because being
  // allowed to show something is not the same as showing it. The owner keeps it,
  // since it is their own record.
  // The page shows focus items -- role tags, category tags, free tags -- in one
  // metadata line, and whether a given value reaches it depends on the profile: a
  // headline takes the row, and without one the line renders four values after
  // deduplication. `timezone` has no place on the page at all; only the lookup
  // shows it.
  //
  // So the rule is "the page does not reliably show it" rather than a copy of the
  // component's layout. Three review rounds each found another way that copy was
  // inexact, and the conservative version cannot be wrong in the direction that
  // matters: it can cost a contributor an edit to an unlisted value that happened
  // to be on screen, never let them read one that was not.
  it("keeps the community out of focus fields the page may not show", () => {
    for (const [field, key] of [
      ["tags", "tags"],
      ["person", "personRoleTags"],
      ["timezone", "timezone"],
    ] as const) {
      assert.equal(
        canEditProfileField(
          "community_submitter",
          { ...publishedUnclaimedPerson, fieldVisibility: { [key]: "unlisted" } },
          field,
        ),
        false,
        key,
      );
      // Public is unaffected: discovery carries it whatever the page does.
      assert.equal(
        canEditProfileField(
          "community_submitter",
          { ...publishedUnclaimedPerson, fieldVisibility: {} },
          field,
        ),
        true,
        key,
      );
    }

    // Nothing else moves. `bio` has its own section on the page.
    assert.equal(
      canEditProfileField(
        "community_submitter",
        { ...publishedUnclaimedPerson, fieldVisibility: { bio: "unlisted" } },
        "bio",
      ),
      true,
    );
  });

  // `person` groups pronouns with role tags and only the role tags are focus
  // content: the page renders pronouns in that metadata row either way. Asking
  // the question of the whole group withheld the entire form group over an
  // unlisted pronoun that is on the page.
  it("hides a grouped field only for the keys the page may not show", () => {
    assert.equal(
      canEditProfileField(
        "community_submitter",
        { ...publishedUnclaimedPerson, fieldVisibility: { personPronouns: "unlisted" } },
        "person",
      ),
      true,
    );
    assert.equal(
      canEditProfileField(
        "community_submitter",
        { ...publishedUnclaimedPerson, fieldVisibility: { personRoleTags: "unlisted" } },
        "person",
      ),
      false,
    );
    // A private pronoun is still withheld: private is nowhere regardless.
    assert.equal(
      canEditProfileField(
        "community_submitter",
        { ...publishedUnclaimedPerson, fieldVisibility: { personPronouns: "private" } },
        "person",
      ),
      false,
    );
  });

  it("stops the community editing a profile once someone owns it", () => {
    const claimedPerson = { ...publishedUnclaimedPerson, claimState: "claimed_unverified" } as const;

    assert.equal(canEditProfileField("community_submitter", claimedPerson, "outboundLinks"), false);
    assert.equal(canEditProfileField("claimed_owner", claimedPerson, "outboundLinks"), true);
  });

  it("keeps the community out of fields the profile withholds", () => {
    // Editing a field means being shown its current value first, so the
    // community may not edit what it may not read -- otherwise the editor is a
    // way to read a private value by opening a form.
    const withPrivateBio = {
      ...publishedUnclaimedPerson,
      fieldVisibility: { bio: "private", personRoleTags: "private", aliases: "unlisted" },
    } as const;

    assert.equal(canEditProfileField("community_submitter", withPrivateBio, "bio"), false);
    // `person` covers pronouns and role tags, so a private half holds the whole
    // grouped field back rather than being revealed by an edit to the other.
    assert.equal(canEditProfileField("community_submitter", withPrivateBio, "person"), false);
    // unlisted is not private: it renders on the profile page, so a contributor
    // looking at that page has already seen it.
    assert.equal(canEditProfileField("community_submitter", withPrivateBio, "aliases"), true);
    assert.equal(canEditProfileField("community_submitter", withPrivateBio, "tags"), true);
    // The owner's own hidden fields stay theirs to edit.
    assert.equal(
      canEditProfileField(
        "claimed_owner",
        { ...withPrivateBio, claimState: "claimed_unverified" },
        "bio",
      ),
      true,
    );
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
      /PROFILE_ALREADY_OWNED/,
    );
  });

  it("refuses Discord claim creation for a suppressed identity", async () => {
    const { db } = createProfileClaimTestDb({
      profileSuppressionRequests: [
        {
          displayName: "DJ No Match",
          profileType: "person",
          requestType: "pre_claim_safety",
          state: "accepted",
        },
      ],
    });

    // Claim creation inserts published/public directly, so it is a way to put a
    // retracted identity back in front of people without going through submission.
    await assert.rejects(
      createClaimedDiscordProfileForUser(db as never, {
        userId: "user-suppressed" as Id<"users">,
        discordProviderAccountId: "discord-suppressed-1",
        input: {
          profileType: "person",
          displayName: " DJ No Match ",
          aliases: [],
          tags: [],
          person: { roleTags: [] },
        },
        now: 1_790_000_000_000,
      }),
      (error: unknown) => {
        // Structured, not a plain Error: Convex redacts plain messages in
        // production, so the claim client could not tell a permanent safety
        // rejection from a transient failure.
        const data = (error as { data?: { code?: string } }).data;
        assert.equal(data?.code, "IDENTITY_SUPPRESSED");
        return true;
      },
    );
  });

  it("refuses Discord claim creation when an alias carries the suppressed identity", async () => {
    const { db } = createProfileClaimTestDb({
      profileSuppressionRequests: [
        {
          displayName: "DJ Hidden",
          profileType: "person",
          requestType: "pre_claim_safety",
          state: "accepted",
        },
      ],
    });

    // The display name is unrelated; the suppressed identity rides in aliases,
    // which toPublicProfile exposes and the search document indexes.
    await assert.rejects(
      createClaimedDiscordProfileForUser(db as never, {
        userId: "user-alias" as Id<"users">,
        discordProviderAccountId: "discord-alias-1",
        input: {
          profileType: "person",
          displayName: "Totally Different Name",
          aliases: ["DJ Hidden"],
          tags: [],
          person: { roleTags: [] },
        },
        now: 1_790_000_000_000,
      }),
      (error: unknown) => {
        const data = (error as { data?: { code?: string } }).data;
        assert.equal(data?.code, "IDENTITY_SUPPRESSED");
        return true;
      },
    );
  });

  it("creates a new claimed Discord person profile when no match is selected", async () => {
    const now = 1_790_000_000_000;
    const userId = "user-person" as Id<"users">;
    const { db, tables } = createProfileClaimTestDb();

    const result = await createClaimedDiscordProfileForUser(db as never, {
      userId,
      discordProviderAccountId: "discord-person-123",
      input: {
        profileType: "person",
        displayName: " DJ No Match ",
        aliases: ["No Match", "no match"],
        tags: ["House"],
        person: {
          roleTags: ["DJ"],
        },
      },
      now,
      actor: {
        tokenIdentifier: "issuer|person",
        issuer: "issuer",
        subject: "person",
        displayName: "DJ No Match",
      },
    });

    const profile = tables.profiles[0];

    assert.equal(result.profilePath, "/dj-no-match");
    assert.equal(result.claimState, "claimed_unverified");
    assert.equal(profile?.slug, "dj-no-match");
    assert.equal(profile?.claimState, "claimed_unverified");
    assert.equal(profile?.creationSource, "self");
    assert.equal(profile?.publicationState, "published");
    assert.equal(profile?.publicSurfacingState, "public");
    assert.equal(profile?.claimedAt, now);
    assert.equal(tables.profileOwners.length, 1);
    assert.equal(tables.profileOwners[0]?.profileId, result.profileId);
    assert.equal(tables.profileOwners[0]?.userId, userId);
    assert.equal(tables.profileOwners[0]?.roleKey, "owner");
    assert.equal(tables.profileOwners[0]?.state, "active");
    assert.equal(tables.profileOwners[0]?.grantedByClaimRequestId, result.claimRequestId);
    assert.equal(tables.profileClaimRequests[0]?.method, "discord_person");
    assert.equal(tables.profileClaimRequests[0]?.state, "approved");
    assert.equal(tables.profileAuditEvents[0]?.action, "profile_claim_approved_unverified");
    assert.equal(tables.shortLinks[0]?.targetProfileId, result.profileId);
    assert.equal(tables.searchDocuments[0]?.profileId, result.profileId);
    assert.equal(tables.searchDocuments[0]?.trustRank, 28);
  });

  it("creates a new claimed Discord community profile without admin verification", async () => {
    const now = 1_790_000_000_000;
    const userId = "user-community" as Id<"users">;
    const { db, tables } = createProfileClaimTestDb();

    const result = await createClaimedDiscordProfileForUser(db as never, {
      userId,
      discordProviderAccountId: "discord-community-123",
      input: {
        profileType: "community",
        displayName: "Afterglow Social",
        aliases: ["Afterglow"],
        tags: ["Events"],
        community: {
          subtype: "Club",
          categoryTags: ["Music"],
        },
      },
      now,
    });

    const profile = tables.profiles[0];

    assert.equal(result.profilePath, "/afterglow-social");
    assert.equal(result.claimState, "claimed_unverified");
    assert.equal(profile?.profileType, "community");
    assert.equal(profile?.claimState, "claimed_unverified");
    assert.equal(profile?.creationSource, "self");
    assert.equal(tables.profileOwners.length, 1);
    assert.equal(tables.profileClaimRequests[0]?.method, "discord_community");
    assert.equal(tables.profileClaimRequests[0]?.evidenceSource, "discord_api");
    assert.equal(tables.searchDocuments[0]?.routePath, "/afterglow-social");
    assert.equal(
      tables.vocabularyTerms.some((term) => term.scope === "community_subtype" && term.key === "club"),
      true,
    );
  });

  it("keeps existing-profile claim approval on the same profile and rejects a second owner", async () => {
    const profileId = "profile-existing" as Id<"profiles">;
    const firstUserId = "user-first" as Id<"users">;
    const secondUserId = "user-second" as Id<"users">;
    const existingProfile = {
      _id: profileId,
      _creationTime: 1,
      profileType: "person",
      slug: "existing-dj",
      displayName: "Existing DJ",
      sortName: "existing dj",
      aliases: [],
      tags: [],
      outboundLinks: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      publicSurfacingUpdatedAt: 1,
      creationSource: "community",
      publishedAt: 1,
      updatedAt: 1,
      person: {
        roleTags: [],
      },
    } as unknown as Doc<"profiles">;
    const { db, tables } = createProfileClaimTestDb({
      profiles: [existingProfile],
    });

    await approveProfileClaimForUser(db as never, {
      profile: existingProfile,
      profileId,
      userId: firstUserId,
      grantedByClaimRequestId: "claim-existing" as Id<"profileClaimRequests">,
      verified: false,
      now: 2,
    });

    assert.equal(tables.profiles[0]?._id, profileId);
    assert.equal(tables.profiles[0]?.claimState, "claimed_unverified");
    assert.equal(tables.profiles[0]?.claimedAt, 2);
    assert.equal(tables.profileOwners.length, 1);
    assert.equal(tables.profileOwners[0]?.profileId, profileId);
    assert.equal(tables.profileOwners[0]?.userId, firstUserId);

    await assert.rejects(
      () =>
        approveProfileClaimForUser(db as never, {
          profile: tables.profiles[0] as unknown as Doc<"profiles">,
          profileId,
          userId: secondUserId,
          grantedByClaimRequestId: "claim-second" as Id<"profileClaimRequests">,
          verified: false,
          now: 3,
        }),
      /PROFILE_ALREADY_OWNED/,
    );
    assert.equal(tables.profileOwners.length, 1);
    assert.equal(tables.profiles[0]?._id, profileId);
  });
});

describe("profile field visibility owner controls", () => {
  function createPrivacyDb(existingOwners: Array<Record<string, unknown>>) {
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];

    return {
      patched,
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
              const chain = {
                filter(filterBuilder: (query: unknown) => unknown) {
                  const filterQuery = {
                    field(field: string) {
                      return field;
                    },
                    eq(field: string, value: unknown) {
                      values[field] = value;
                      return true;
                    },
                  };

                  filterBuilder(filterQuery);
                  return chain;
                },
                async take(limit: number) {
                  return existingOwners
                    .filter((owner) =>
                      Object.entries(values).every(([field, value]) => owner[field] === value),
                    )
                    .slice(0, limit);
                },
              };

              builder(query);
              return chain;
            },
          };
        },
        async patch(id: string, patch: Record<string, unknown>) {
          patched.push({ id, patch });
        },
      },
    };
  }

  const profile = {
    _id: "profile123" as Id<"profiles">,
    profileType: "person",
    slug: "dj-celine",
    displayName: "DJ Celine",
    sortName: "dj celine",
    aliases: [],
    tags: [],
    claimState: "claimed_unverified",
    publicationState: "published",
    publicSurfacingState: "public",
    creationSource: "self",
    publishedAt: 1,
    updatedAt: 1,
    person: {
      roleTags: [],
    },
  } as Doc<"profiles">;

  it("normalizes supported visibility keys and rejects unsupported values", () => {
    assert.deepEqual(
      normalizeProfileFieldVisibility({
        aliases: "public",
        bio: "private",
        tags: "unlisted",
      }),
      {
        bio: "private",
        tags: "unlisted",
      },
    );
    assert.equal(materializeProfileFieldVisibility({ bio: "private" }).aliases, "public");
    assert.equal(materializeProfileFieldVisibility({ bio: "private" }).bio, "private");
    assert.throws(
      () => normalizeProfileFieldVisibility({ bookingEmail: "private" }),
      /Unsupported profile field visibility key/,
    );
    assert.throws(
      () => normalizeProfileFieldVisibility({ bio: "friends_only" }),
      /Unsupported profile field visibility state/,
    );
  });

  it("tells account navigation whether an owned profile has a public route", () => {
    assert.equal(toOwnedProfilePrivacyResult(profile).hasPublicProfile, true);
    assert.equal(
      toOwnedProfilePrivacyResult({
        ...profile,
        publicSurfacingState: "opted_out",
      }).hasPublicProfile,
      false,
    );
  });

  it("stores normalized owner visibility updates", async () => {
    const userId = "user123" as Id<"users">;
    const owner = {
      _id: "owner123" as Id<"profileOwners">,
      profileId: profile._id,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    };
    const privacyDb = createPrivacyDb([owner]);

    const result = await applyProfileFieldVisibilityUpdate(privacyDb.db as never, {
      profile,
      userId,
      fieldVisibility: {
        aliases: "public",
        bio: "private",
        tags: "unlisted",
      },
      now: 12,
    });

    assert.deepEqual(privacyDb.patched, [
      {
        id: profile._id,
        patch: {
          fieldVisibility: {
            bio: "private",
            tags: "unlisted",
          },
          updatedAt: 12,
        },
      },
    ]);
    assert.equal(result.fieldVisibility.aliases, "public");
    assert.equal(result.fieldVisibility.bio, "private");
    assert.equal(result.fieldVisibility.tags, "unlisted");
  });

  it("rejects non-owners and unclaimed profiles", async () => {
    const userId = "user123" as Id<"users">;
    const otherUserId = "otherUser" as Id<"users">;
    const owner = {
      _id: "owner123" as Id<"profileOwners">,
      profileId: profile._id,
      userId: otherUserId,
      roleKey: "owner",
      state: "active",
      grantedAt: 1,
      updatedAt: 1,
    };
    const privacyDb = createPrivacyDb([owner]);

    await assert.rejects(
      () =>
        applyProfileFieldVisibilityUpdate(privacyDb.db as never, {
          profile,
          userId,
          fieldVisibility: { bio: "private" },
          now: 12,
        }),
      /Only a claimed profile owner can update profile privacy/,
    );
    await assert.rejects(
      () =>
        applyProfileFieldVisibilityUpdate(privacyDb.db as never, {
          profile: { ...profile, claimState: "unclaimed" } as Doc<"profiles">,
          userId: otherUserId,
          fieldVisibility: { bio: "private" },
          now: 12,
        }),
      /Only a claimed profile owner can update profile privacy/,
    );
    assert.equal(privacyDb.patched.length, 0);
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
      sanitizeCommunitySubmissionProfileInput(
        {
          profileType: "person",
          displayName: "  DJ Celine  ",
          aliases: ["Celine", "celine"],
          tags: ["House"],
          person: {
            roleTags: ["DJ", "VJ"],
          },
        },
        { linkSource: "community_submitted" },
      ),
      {
        profileType: "person",
        displayName: "DJ Celine",
        sortName: "dj celine",
        aliases: ["Celine"],
        tags: ["House"],
        outboundLinks: [],
        person: {
          roleTags: ["DJ", "VJ"],
        },
      },
    );
  });

  it("sanitizes community submissions and rejects mismatched type-specific fields", () => {
    assert.deepEqual(
      sanitizeCommunitySubmissionProfileInput(
        {
          profileType: "community",
          displayName: "Nocturne VR",
          tags: ["Events"],
          community: {
            subtype: " Club ",
            categoryTags: ["Music", "music"],
          },
        },
        { linkSource: "community_submitted" },
      ),
      {
        profileType: "community",
        displayName: "Nocturne VR",
        sortName: "nocturne vr",
        aliases: [],
        tags: ["Events"],
        outboundLinks: [],
        community: {
          subtype: "Club",
          categoryTags: ["Music"],
        },
      },
    );

    assert.throws(
      () =>
        sanitizeCommunitySubmissionProfileInput(
          {
            profileType: "person",
            displayName: "DJ Celine",
            community: {
              subtype: "x".repeat(50),
            },
          },
          { linkSource: "community_submitted" },
        ),
      /Community fields cannot be submitted for a person profile/,
    );
  });
});

describe("API profile update helpers", () => {
  const claimedPerson = {
    _id: "profile-api-update" as Id<"profiles">,
    _creationTime: 1,
    profileType: "person",
    slug: "dj-celine",
    displayName: "DJ Celine",
    sortName: "dj celine",
    aliases: [],
    tags: [],
    outboundLinks: [],
    claimState: "claimed_unverified",
    publicationState: "published",
    publicSurfacingState: "public",
    publicSurfacingUpdatedAt: 1,
    creationSource: "self",
    claimedAt: 1,
    publishedAt: 1,
    updatedAt: 1,
    person: {
      pronouns: "she/her",
      roleTags: ["DJ"],
    },
  } as Doc<"profiles">;

  it("normalizes owner-editable profile update fields", () => {
    const result = sanitizeApiProfileUpdateInput(claimedPerson, {
      displayName: "  DJ   Celine  ",
      aliases: ["Celine", "celine"],
      bio: " ",
      person: {
        pronouns: null,
        roleTags: [" DJ ", "dj", "VJ"],
      },
    });

    // displayName and bio are absent from `changedFields`: both normalize to
    // exactly what the profile already holds, and that is the audit record, so
    // it reports what changed rather than what was submitted.
    //
    // They part company in the patch. The display name still normalizes through
    // the validator, because the raw input differs from the stored string even
    // though the normalized form does not. The bio is left out entirely: it is
    // whitespace against a profile that has no bio, so there is nothing to write
    // and the old `bio: undefined` was a clear of a field that was already clear.
    assert.deepEqual(result.changedFields, ["aliases", "person"]);
    assert.deepEqual(result.patch, {
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: ["Celine"],
      person: {
        roleTags: ["DJ", "VJ"],
      },
    });
  });

  // Convex redacts plain `Error` messages on production deployments, so every
  // one of these reached the form as "try again once the backend is reachable"
  // for a name the person could simply have lengthened. The structured payload
  // survives, which is how link errors already answered.
  it("rejects invalid input in a shape that survives production", () => {
    const invalid: Array<[string, ApiProfileUpdateInput, string]> = [
      ["display name too short", { displayName: "a" }, "PROFILE_INPUT_INVALID"],
      [
        "too many aliases",
        { aliases: Array.from({ length: 40 }, (_u, i) => `alias-${i}`) },
        "PROFILE_INPUT_INVALID",
      ],
      // The community may not edit a field the profile marks private. No value
      // would be accepted, so this answers as an authority refusal rather than
      // asking the caller to correct something.
      ["field not editable", { headline: "Updated" }, "PROFILE_FIELD_FORBIDDEN"],
      // Caught by shape validation before the permission check: a community
      // field on a person profile is a malformed request, not an authority one.
      ["wrong profile type", { community: { subtype: "Club" } }, "PROFILE_INPUT_INVALID"],
    ];

    for (const [label, input, expectedCode] of invalid) {
      assert.throws(
        () =>
          sanitizeApiProfileUpdateInput(
            {
              ...claimedPerson,
              claimState: "unclaimed",
              // So the "field not editable" case has something to refuse: the
              // community may not edit a field the profile marks private.
              fieldVisibility: { headline: "private" },
            } as Doc<"profiles">,
            input,
            "community_submitter",
          ),
        (error: unknown) => {
          const data = (error as { data?: { code?: string; message?: string } }).data;

          assert.equal(data?.code, expectedCode, label);
          assert.ok((data?.message ?? "").length > 0, label);

          return true;
        },
        label,
      );
    }
  });

  it("requires claimed-owner edit permission and compatible type fields", () => {
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(
          { ...claimedPerson, claimState: "unclaimed" } as Doc<"profiles">,
          { headline: "Updated" },
        ),
      /Only a claimed profile owner can update the headline field/,
    );

    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(claimedPerson, {
          community: {
            subtype: "Club",
          },
        }),
      /Community fields cannot be updated for a person profile/,
    );
  });

  it("stamps link provenance from the writer, not from the code path", () => {
    // One sanitizer serves the owner and the community, so the stamp has to
    // follow the subject. Calling a third party's links owner-authored would be
    // a plain lie on a surface that renders provenance as a trust signal.
    const unclaimedPerson = { ...claimedPerson, claimState: "unclaimed" } as Doc<"profiles">;
    const links = [{ type: "twitch", url: "https://twitch.tv/snekwtf" }];

    assert.equal(
      (
        sanitizeApiProfileUpdateInput(unclaimedPerson, { outboundLinks: links }, "community_submitter")
          .patch.outboundLinks as Array<{ source: string }>
      )[0]?.source,
      "community_submitted",
    );
    assert.equal(
      (
        sanitizeApiProfileUpdateInput(claimedPerson, { outboundLinks: links }, "claimed_owner")
          .patch.outboundLinks as Array<{ source: string }>
      )[0]?.source,
      "owner_authored",
    );
  });

  it("reports nothing changed when a save re-sends what is already stored", () => {
    // The editor posts every field group it rendered on every save, so without
    // the diff a typo fix records "aliases, tags, links, roles updated" and a
    // no-op save records a broad update anyway. That history is what a claiming
    // owner inherits.
    const result = sanitizeApiProfileUpdateInput(claimedPerson, {
      displayName: "DJ Celine",
      aliases: [],
      tags: [],
      person: { roleTags: ["DJ"] },
    });

    assert.deepEqual(result.changedFields, []);
  });

  it("keeps the provenance a link already had", () => {
    // The form posts the whole array back, so without this, saving an unrelated
    // field restamps every owner-authored link as community-submitted --
    // downgrading a trust signal nobody touched.
    const withLinks = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "owner_authored",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withLinks,
      {
        outboundLinks: [
          // Echoes the provenance it arrived with, which is what the editor
          // sends for a row nobody touched.
          { type: "twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
          { type: "soundcloud", url: "https://soundcloud.com/snekwtf" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string; type: string }>;

    assert.deepEqual(
      links.map((link) => [link.type, link.source]),
      [
        ["twitch", "owner_authored"],
        ["soundcloud", "community_submitted"],
      ],
    );
  });

  it("keeps stored provenance for a writer whose request cannot carry a claim", () => {
    // `ApiProfileUpdateRequestSchema` has no `source` field, so an owner
    // patching one link through the public API sends a claim for none of them.
    // Falling through to the sanitizer restamped the whole set `owner_authored`,
    // erasing the trust signal the reviewed and partner rows exist to carry.
    const withLinks = {
      ...claimedPerson,
      outboundLinks: [
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "reviewed",
        },
        {
          type: "soundcloud",
          label: "SoundCloud",
          url: "https://soundcloud.com/snekwtf",
          source: "partner_provided",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withLinks,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", label: "Twitch stream" },
          { type: "soundcloud", url: "https://soundcloud.com/snekwtf" },
        ],
      },
      "claimed_owner",
    ).patch.outboundLinks as Array<{ source: string; type: string }>;

    assert.deepEqual(
      links.map((link) => [link.type, link.source]),
      [
        ["twitch", "reviewed"],
        ["soundcloud", "partner_provided"],
      ],
    );
  });

  it("keeps an empty nested group out of the permission preflight", () => {
    // The preflight decides which fields the permission check sees. Counting an
    // empty group made the refusal depend on whether that group happened to be
    // withheld -- a withheld one answered with the field-specific message, an
    // editable one fell through to the generic empty-request error -- which is
    // the response oracle this preflight exists to close. Both asked for
    // nothing, so both have to answer the same.
    assert.deepEqual(
      submittedEditableFields({ person: {} } as ApiProfileUpdateInput),
      [],
    );
    assert.deepEqual(
      submittedEditableFields({ community: {} } as ApiProfileUpdateInput),
      [],
    );

    // A group that names one of its own fields still counts, whatever the value.
    assert.deepEqual(
      submittedEditableFields({ person: { roleTags: [] } } as ApiProfileUpdateInput),
      ["person"],
    );
  });

  it("rejects a nested group that names no field", () => {
    // `{ person: {} }` asked for nothing, but recording the group as submitted
    // satisfied the at-least-one-field check and returned success. An empty
    // nested object is the same empty write the top-level check already refuses.
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(
          claimedPerson as unknown as Doc<"profiles">,
          { person: {} } as ApiProfileUpdateInput,
          "claimed_owner",
        ),
      /At least one editable profile field is required/,
    );
  });

  it("refuses a provenance claim on a destination whose rows disagree", () => {
    // The claim used to be honoured whenever *some* stored row carried it. On a
    // mixed destination the rows are indistinguishable, so a community
    // contributor could drop the community row, submit the owner-authored source
    // of the one beside it, and keep a stamp for a row they had just deleted.
    const withDisagreement = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        { type: "twitch", label: "Twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "community_submitted",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withDisagreement,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.deepEqual(links.map((link) => link.source), ["community_submitted"]);
  });

  it("declines to inherit provenance a destination does not agree on", () => {
    // Inheriting by destination is only safe where the destination speaks with
    // one voice. Two stored rows disagreeing is the case that defeated the
    // earlier destination-keyed attempts, which handed sources out in stored
    // order and promoted the row sitting behind a deleted one. Here the writer
    // keeps their own stamp, which cannot invent authority nobody granted.
    const withDisagreement = {
      ...claimedPerson,
      outboundLinks: [
        { type: "twitch", label: "Twitch", url: "https://twitch.tv/snekwtf", source: "reviewed" },
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "partner_provided",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withDisagreement,
      { outboundLinks: [{ type: "twitch", url: "https://twitch.tv/snekwtf" }] },
      "claimed_owner",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.deepEqual(links.map((link) => link.source), ["owner_authored"]);
  });

  // Scheme and host are case-insensitive; a path is not. Folding the whole URL
  // made `/Mix` and `/mix` one destination, so a writer could move an
  // owner-authored link to a different page on a case-sensitive host and keep the
  // stamp. The form drops the claim for a case-only edit, but the mutation takes
  // `source` from any caller, so the form cannot be where this is decided.
  it("honours a provenance claim only for the exact destination", () => {
    const withLinks = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        {
          type: "website",
          label: "Website",
          url: "https://example.invalid/Mix",
          source: "owner_authored",
        },
      ],
    } as unknown as Doc<"profiles">;
    const sourceFor = (url: string) =>
      (
        sanitizeApiProfileUpdateInput(
          withLinks,
          { outboundLinks: [{ type: "website", url, source: "owner_authored" }] },
          "community_submitter",
        ).patch.outboundLinks as Array<{ source: string }>
      )[0]?.source;

    assert.equal(sourceFor("https://example.invalid/Mix"), "owner_authored");
    // A different page on a case-sensitive host is a different destination, so
    // the claim is refused and the writer gets their own stamp.
    assert.equal(sourceFor("https://example.invalid/mix"), "community_submitted");
    // Host case genuinely is case-insensitive, so this reaches the patch as a
    // changed URL and the claim still matches the link it names.
    assert.equal(sourceFor("https://EXAMPLE.invalid/Mix"), "owner_authored");
  });

  // The editor posts the alias list it rendered on every save, so treating any
  // defined `aliases` as a proposed identity re-asks the suppression question
  // about names already on the profile. A profile carrying a legacy alias that a
  // later name-only request covers would then refuse every edit, including a bio
  // typo, naming nothing the writer could act on.
  it("asks the suppression question only when the identity changes", async () => {
    let asked = false;
    const db = {
      query() {
        asked = true;

        return {
          withIndex() {
            return { collect: async () => [] };
          },
        };
      },
    };
    const publicProfile = {
      ...claimedPerson,
      publicationState: "published",
      publicSurfacingState: "public",
      aliases: ["Legacy Name"],
    } as unknown as Doc<"profiles">;

    await assertProfileEditNotSuppressed(db as never, publicProfile, {
      aliases: ["Legacy Name"],
    });
    assert.equal(asked, false);

    await assertProfileEditNotSuppressed(db as never, publicProfile, {
      aliases: ["Legacy Name", "A New Name"],
    });
    assert.equal(asked, true);
  });

  // Skipping the permission check for a group that happened to match made the
  // mutation an oracle: post a guessed alias array at an unclaimed profile whose
  // aliases are private, and the reply says whether the guess was right -- an
  // exact one took the no-op path and succeeded, a wrong one was refused by name.
  // Neither advances `updatedAt`, so the guessing could run indefinitely.
  it("refuses a withheld field whether or not the guess was right", () => {
    const withPrivateAliases = {
      ...claimedPerson,
      claimState: "unclaimed",
      aliases: ["Secret Alias"],
      fieldVisibility: { aliases: "private" },
    } as unknown as Doc<"profiles">;

    for (const guess of [["Secret Alias"], ["Wrong Guess"]]) {
      assert.throws(
        () =>
          sanitizeApiProfileUpdateInput(
            withPrivateAliases,
            { aliases: guess, bio: "Corrected biography" },
            "community_submitter",
          ),
        /aliases field cannot be edited/,
        guess.join(","),
      );
    }

    // The same shape for a private nested list, which is its own group.
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(
          {
            ...claimedPerson,
            claimState: "unclaimed",
            person: { roleTags: ["Secret Role"] },
            fieldVisibility: { personRoleTags: "private" },
          } as unknown as Doc<"profiles">,
          { person: { roleTags: ["Secret Role"] } },
          "community_submitter",
        ),
      /person field cannot be edited/,
    );
  });

  // Comparing type and URL alone called a row unchanged when an owner had edited
  // only its label, handle or presentation, so the update returned success and
  // wrote nothing.
  it("applies a link change that touches only its metadata", () => {
    const withLink = {
      ...claimedPerson,
      outboundLinks: [
        {
          type: "website",
          label: "Website",
          url: "https://example.invalid/dj",
          source: "owner_authored",
        },
      ],
    } as unknown as Doc<"profiles">;

    const result = sanitizeApiProfileUpdateInput(
      withLink,
      {
        outboundLinks: [
          { type: "website", label: "Bookings", url: "https://example.invalid/dj" },
        ],
      },
      "claimed_owner",
    );

    assert.deepEqual(result.changedFields, ["outboundLinks"]);
    assert.equal(
      (result.patch.outboundLinks as Array<{ label: string }>)[0]?.label,
      "Bookings",
    );
  });

  // The editor submits the name on every save, so revalidating it refused a
  // correction the writer did make over a name they did not touch -- on a profile
  // published before `display_name_outside_public_limits` existed and holding one
  // outside the current bounds.
  it("lets an unrelated edit through a legacy display name", () => {
    const withLegacyName = {
      ...claimedPerson,
      claimState: "unclaimed",
      displayName: "X",
    } as unknown as Doc<"profiles">;

    const result = sanitizeApiProfileUpdateInput(
      withLegacyName,
      { displayName: "X", bio: "Corrected biography" },
      "community_submitter",
    );

    assert.deepEqual(result.changedFields, ["bio"]);
    assert.equal("displayName" in result.patch, false);

    // A rename is still validated, so nothing new gets in this way.
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(
          withLegacyName,
          { displayName: "Y" },
          "community_submitter",
        ),
      /Display name must be at least/,
    );
  });

  // The editor posts every group it rendered, so an untouched group is validated
  // again on every save. That is fine until the stored value is outside a limit
  // the writer cannot fix -- published before the cap existed, or seeded past it
  // -- at which point resubmitting it refuses an unrelated correction and names a
  // field they never opened.
  it("lets an unrelated edit through a legacy over-limit headline", () => {
    // Same grandfathering the display name and the lists already had, for the
    // scalars that did not. A seeded profile can hold a headline longer than the
    // cap, and this editor posts every rendered field on every save -- so
    // validating before comparing refused the link correction the writer did
    // make, naming a headline they never opened and could not shorten without
    // losing what was there.
    const legacy = {
      ...claimedPerson,
      headline: "x".repeat(400),
      person: { ...claimedPerson.person, pronouns: "y".repeat(200) },
    } as unknown as Doc<"profiles">;

    const result = sanitizeApiProfileUpdateInput(legacy, {
      headline: "x".repeat(400),
      person: { pronouns: "y".repeat(200) },
      bio: "A bio the writer actually changed.",
    });

    assert.deepEqual(result.changedFields, ["bio"]);

    // Editing the over-limit value itself is still refused.
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(legacy, {
          headline: "z".repeat(400),
        }),
      /Headline must be \d+ characters or fewer/,
    );
  });

  it("lets an unrelated edit through a legacy over-limit list", () => {
    const overLimit = Array.from({ length: PROFILE_ALIAS_MAX_COUNT + 4 }, (_u, i) => `alias-${i}`);
    const withLegacyAliases = {
      ...claimedPerson,
      claimState: "unclaimed",
      aliases: overLimit,
    } as unknown as Doc<"profiles">;

    const result = sanitizeApiProfileUpdateInput(
      withLegacyAliases,
      { aliases: overLimit, bio: "Corrected biography" },
      "community_submitter",
    );

    assert.deepEqual(result.changedFields, ["bio"]);
    // Left out of the patch entirely rather than rewritten or truncated.
    assert.equal("aliases" in result.patch, false);

    // Changing the group still has to satisfy the limit: this grandfathers what
    // is stored without letting anything new past.
    assert.throws(
      () =>
        sanitizeApiProfileUpdateInput(
          withLegacyAliases,
          { aliases: [...overLimit, "one-more"] },
          "community_submitter",
        ),
      /Aliases can include at most/,
    );
  });

  // The submitted side is canonicalized before provenance is matched, so keying
  // the stored side on its raw URL missed every legacy row: a profile still
  // holding a `stream.vrcdn.live/live/<id>.m3u8` was compared against the
  // `vrcdn:<id>` it becomes, the claim never matched, and editing an
  // unrelated field restamped a reviewed link as community-submitted.
  it("matches provenance across VRCDN canonicalization", () => {
    const withLegacyLink = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        {
          type: "vrcdn",
          label: "VRCDN",
          url: "https://stream.vrcdn.live/live/snekwtf.m3u8",
          source: "reviewed",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withLegacyLink,
      {
        // What the editor posts back for an untouched row: the canonical URL it
        // was shown, and the provenance it arrived with.
        outboundLinks: [
          { type: "vrcdn", url: "vrcdn:snekwtf", source: "reviewed" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.equal(links[0]?.source, "reviewed");
  });

  it("does not let a prepended row take a reviewed link's standing", () => {
    // The reported shape. A community contributor prepends a row on the same
    // destination as a reviewed link, with whatever label and handle they like.
    // Consuming in submitted order gave that row `reviewed` and left the real
    // one to be restamped, so the trust signal followed the attacker's row.
    const withReviewed = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "reviewed",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withReviewed,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", label: "Mine" },
          { type: "twitch", url: "https://twitch.tv/snekwtf", label: "Twitch" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    // Neither row carries `reviewed` away.
    assert.deepEqual(links.map((link) => link.source), [
      "community_submitted",
      "community_submitted",
    ]);
  });

  it("gives a destination no provenance when more rows arrive than it stores", () => {
    // One stored link, two submitted rows on its destination. Nothing in the
    // request says which of them is the stored one, and answering by submitted
    // order answered it wrong: the first row took the owner-authored stamp and
    // the real one was restamped as the count ran out, so provenance moved
    // between rows. A writer could take a reviewed link's standing by prepending
    // a row to it.
    //
    // Neither row inherits now. That also covers what this case was first written
    // for -- a duplicate must not be recorded as owner-authored, which would be
    // inventing provenance rather than preserving it.
    const withLinks = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        {
          type: "twitch",
          label: "Twitch",
          url: "https://twitch.tv/snekwtf",
          source: "owner_authored",
        },
      ],
    } as unknown as Doc<"profiles">;

    const links = sanitizeApiProfileUpdateInput(
      withLinks,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
          { type: "twitch", url: "https://twitch.tv/snekwtf" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.deepEqual(links.map((link) => link.source), [
      "community_submitted",
      "community_submitted",
    ]);
  });

  it("does not let a claim invent provenance the stored link never had", () => {
    // The claim is honoured against a stored link that actually carries it, and
    // each stored link is claimed once. So deleting the owner-authored row and
    // keeping the community duplicate leaves the survivor community-submitted --
    // matching by position in stored order promoted it instead -- and a writer
    // asking for a source nothing has simply gets their own.
    const withDuplicates = {
      ...claimedPerson,
      claimState: "unclaimed",
      outboundLinks: [
        { type: "twitch", label: "Twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
        { type: "twitch", label: "Twitch", url: "https://twitch.tv/snekwtf", source: "community_submitted" },
      ],
    } as unknown as Doc<"profiles">;

    const survivors = sanitizeApiProfileUpdateInput(
      withDuplicates,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", source: "community_submitted" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.deepEqual(survivors.map((link) => link.source), ["community_submitted"]);

    const invented = sanitizeApiProfileUpdateInput(
      { ...claimedPerson, claimState: "unclaimed", outboundLinks: [] } as unknown as Doc<"profiles">,
      {
        outboundLinks: [
          { type: "twitch", url: "https://twitch.tv/snekwtf", source: "owner_authored" },
        ],
      },
      "community_submitter",
    ).patch.outboundLinks as Array<{ source: string }>;

    assert.deepEqual(invented.map((link) => link.source), ["community_submitted"]);
  });

  it("lets the community correct an unclaimed profile, and stops at a claimed one", () => {
    const unclaimedPerson = { ...claimedPerson, claimState: "unclaimed" } as Doc<"profiles">;
    const edit = { displayName: "Snek", person: { roleTags: ["DJ"] } };

    // `person` is absent: the fixture already carries roleTags ["DJ"], so only
    // the display name actually changed.
    assert.deepEqual(
      sanitizeApiProfileUpdateInput(unclaimedPerson, edit, "community_submitter").changedFields,
      ["displayName"],
    );
    assert.throws(
      () => sanitizeApiProfileUpdateInput(claimedPerson, edit, "community_submitter"),
      /cannot be edited on a profile you do not own/,
    );
  });
});

describe("public profile projection", () => {
  it("uses only discovery-visible profile fields in share cards", () => {
    const profile = {
      profileType: "person",
      slug: "dj-card",
      displayName: "DJ Card",
      sortName: "dj card",
      aliases: [],
      tags: [],
      headline: "Unlisted headline",
      bio: "Public bio",
      avatarImageUrl: "https://legacy.example.invalid/avatar.png",
      bannerImageUrl: "https://legacy.example.invalid/banner.png",
      outboundLinks: [],
      claimState: "claimed_unverified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      publishedAt: 1,
      updatedAt: 1,
      fieldVisibility: {
        headline: "unlisted",
        avatarImageUrl: "private",
        bannerImageUrl: "unlisted",
      },
      person: { roleTags: [] },
    } as Doc<"profiles">;
    const mediaKit = {
      profileImage: { imageUrl: "/api/profile-image", mimeType: "image/png" },
      banner: { imageUrl: "/api/banner-image", mimeType: "image/png" },
      primaryLogo: { imageUrl: "/api/primary-logo", mimeType: "image/png" },
      additionalLogos: [],
      logos: [],
      assets: [],
      galleryAssets: [],
      compactDisplay: "profile_image",
      avatarAppearance: {
        borderEnabled: true,
        borderColor: "#ffffff",
        borderWidthPx: 3,
        borderSoftnessPx: 0,
        radiusPercent: 18,
      },
    } as unknown as Awaited<ReturnType<typeof getPublicProfileMediaKit>>;

    assert.deepEqual(toPublicProfileShareCard(profile, mediaKit), {
      profileType: "person",
      slug: "dj-card",
      displayName: "DJ Card",
      trustLabel: "claimed_unverified",
      summary: "Public bio",
      avatarImageUrl: "/api/primary-logo",
      avatarImageKind: "logo",
    });
  });

  it("prefers public managed profile media and headline in share cards", () => {
    const profile = {
      profileType: "community",
      slug: "night-shift",
      displayName: "Night Shift",
      sortName: "night shift",
      aliases: [],
      tags: [],
      headline: "Late-night VRChat events.",
      bio: "Longer profile biography.",
      outboundLinks: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      publishedAt: 1,
      updatedAt: 1,
      community: { categoryTags: [] },
    } as Doc<"profiles">;
    const mediaKit = {
      profileImage: { imageUrl: "/api/profile-image", mimeType: "image/png" },
      banner: { imageUrl: "/api/banner-image", mimeType: "image/png" },
      additionalLogos: [],
      logos: [],
      assets: [],
      galleryAssets: [],
      compactDisplay: "profile_image",
      avatarAppearance: {
        borderEnabled: true,
        borderColor: "#ffffff",
        borderWidthPx: 3,
        borderSoftnessPx: 0,
        radiusPercent: 18,
      },
    } as unknown as Awaited<ReturnType<typeof getPublicProfileMediaKit>>;

    assert.deepEqual(toPublicProfileShareCard(profile, mediaKit), {
      profileType: "community",
      slug: "night-shift",
      displayName: "Night Shift",
      trustLabel: "claimed_verified",
      summary: "Late-night VRChat events.",
      avatarImageUrl: "/api/profile-image",
      avatarImageKind: "profile",
      bannerImageUrl: "/api/banner-image",
    });
  });

  it("keeps a raster avatar fallback when the preferred managed asset is SVG", () => {
    const profile = {
      profileType: "person",
      slug: "legacy-avatar",
      displayName: "Legacy Avatar",
      sortName: "legacy avatar",
      aliases: [],
      tags: [],
      avatarImageUrl: "https://images.example.invalid/avatar.png",
      outboundLinks: [],
      claimState: "claimed_unverified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      publishedAt: 1,
      updatedAt: 1,
      person: { roleTags: [] },
    } as Doc<"profiles">;
    const mediaKit = {
      profileImage: { imageUrl: "/api/profile-image.svg", mimeType: "image/svg+xml" },
      primaryLogo: { imageUrl: "/api/primary-logo", mimeType: "image/png" },
      additionalLogos: [],
      logos: [],
      assets: [],
      galleryAssets: [],
      compactDisplay: "profile_image",
    } as unknown as Awaited<ReturnType<typeof getPublicProfileMediaKit>>;

    assert.deepEqual(toPublicProfileShareCard(profile, mediaKit), {
      profileType: "person",
      slug: "legacy-avatar",
      displayName: "Legacy Avatar",
      trustLabel: "claimed_unverified",
      avatarImageUrl: "/api/primary-logo",
      avatarImageKind: "logo",
    });

    const logoPreferredMediaKit = {
      ...mediaKit,
      profileImage: { imageUrl: "/api/profile-image", mimeType: "image/webp" },
      primaryLogo: { imageUrl: "/api/primary-logo.svg", mimeType: "image/svg+xml" },
      compactDisplay: "logo",
    } as unknown as Awaited<ReturnType<typeof getPublicProfileMediaKit>>;

    assert.deepEqual(toPublicProfileShareCard(profile, logoPreferredMediaKit), {
      profileType: "person",
      slug: "legacy-avatar",
      displayName: "Legacy Avatar",
      trustLabel: "claimed_unverified",
      avatarImageUrl: "/api/profile-image",
      avatarImageKind: "profile",
    });
  });

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

  it("satisfies the public contract the write tools read it back through", () => {
    const profile = {
      _id: "profile_abc" as Id<"profiles">,
      profileType: "person",
      slug: "dj-readback",
      displayName: "DJ Readback",
      sortName: "dj readback",
      aliases: [],
      tags: [],
      outboundLinks: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      person: { roleTags: ["DJ"] },
      publishedAt: 1,
      updatedAt: 7,
    } as unknown as Doc<"profiles">;

    // Parsed through the contract, not spot-checked against it. `PublicProfile`
    // is passthrough, so a field the schema declares and the projection forgets
    // reads as `undefined` at every call site rather than failing to compile --
    // which is how `id` came to be compared against `write.profileId` on a
    // response that never carried it, turning every readback of a publicly
    // viewable profile write into a warning.
    const parsed = PublicProfileSchema.parse(toPublicProfile(profile));

    assert.equal(parsed.id, "profile_abc");
    assert.equal(parsed.updatedAt, 7);
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
          type: "twitch",
          label: "Twitch",
          presentation: "copy",
          url: "https://www.twitch.tv/dj_celine",
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

    assert.equal(lookup?.profilePath, "/dj-celine");
    assert.deepEqual(lookup?.roleTags, ["DJ"]);
    assert.deepEqual(lookup?.genres, [{ slug: "house", displayName: "House" }]);
    assert.deepEqual(
      lookup?.outboundLinks.map((link) => link.type),
      ["vrchat_profile", "discord", "soundcloud", "twitch"],
    );
    assert.equal(lookup?.outboundLinks.at(-1)?.presentation, "copy");
  });

  it("keeps unlisted fields out of lookup rows", () => {
    const profile = {
      profileType: "person",
      slug: "dj-celine",
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: ["Unlisted Alias"],
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
      headline: "Unlisted headline",
      bio: "Unlisted bio",
      avatarImageUrl: "https://example.invalid/avatar.png",
      outboundLinks: [
        {
          type: "website",
          label: "Website",
          url: "https://example.invalid",
          source: "owner_authored",
        },
      ],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      publishedAt: 1,
      updatedAt: 1,
      fieldVisibility: {
        aliases: "unlisted",
        tags: "unlisted",
        genres: "unlisted",
        headline: "unlisted",
        bio: "unlisted",
        avatarImageUrl: "unlisted",
        outboundLinks: "unlisted",
        personRoleTags: "unlisted",
      },
      person: {
        roleTags: ["Unlisted Role"],
      },
    } as Doc<"profiles">;

    const lookup = toProfileLookupResult(profile);

    assert.equal(lookup?.displayName, "DJ Celine");
    assert.deepEqual(lookup?.aliases, []);
    assert.deepEqual(lookup?.tags, []);
    assert.deepEqual(lookup?.genres, []);
    assert.deepEqual(lookup?.roleTags, []);
    assert.equal(lookup?.headline, undefined);
    assert.equal(lookup?.bio, undefined);
    assert.equal(lookup?.avatarImageUrl, undefined);
    assert.deepEqual(lookup?.outboundLinks, []);
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

  it("normalizes public profile section ordering preferences", () => {
    assert.deepEqual(
      normalizeProfilePublicSectionOrder(["links", "about", "links", "worlds"]),
      ["links", "about", "worlds", "events", "media_kit", "details"],
    );
    assert.deepEqual(
      normalizeProfilePublicSectionOrder(["unknown", "events"]),
      ["events", "about", "links", "media_kit", "worlds", "details"],
    );
    assert.deepEqual(
      toPublicProfileAppearance({
        sectionOrder: ["media_kit", "links"],
      } as Pick<Doc<"profileAssetDisplayPreferences">, "sectionOrder">),
      {
        sectionOrder: ["media_kit", "links", "about", "events", "worlds", "details"],
      },
    );
    assert.deepEqual(toPublicProfileAppearance(null), {
      sectionOrder: ["about", "events", "links", "media_kit", "worlds", "details"],
    });
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

describe("profile media kit asset helpers", () => {
  it("bounds accessibility descriptions and credits", () => {
    assert.equal(sanitizeProfileAssetAltText("  Neon portrait of BASICBIT  "), "Neon portrait of BASICBIT");
    assert.equal(sanitizeProfileAssetCredit(" Photo by Example "), "Photo by Example");
    assert.throws(() => sanitizeProfileAssetAltText("a".repeat(181)), /180/);
    assert.throws(() => sanitizeProfileAssetCredit("a".repeat(121)), /120/);
  });

  it("accepts first-slice image formats and rejects unsafe imports", () => {
    assert.equal(normalizeProfileAssetMimeType(" image/svg+xml "), "image/svg+xml");
    assert.equal(normalizeProfileAssetMimeType("IMAGE/PNG"), "image/png");
    assert.throws(() => normalizeProfileAssetMimeType("text/html"), /PNG, SVG, JPEG, or WebP/);

    assert.equal(
      normalizeProfileAssetSourceUrl(" https://example.invalid/logo.svg "),
      "https://example.invalid/logo.svg",
    );
    assert.throws(() => normalizeProfileAssetSourceUrl("http://example.invalid/logo.svg"), /HTTPS/);
    assert.throws(() => normalizeProfileAssetSourceUrl("https://user:token@example.invalid/logo.svg"), /credentials/);
  });

  it("bounds labels, captions, sizes, and generated storage keys", () => {
    assert.equal(sanitizeProfileAssetLabel("  Primary   logo "), "Primary logo");
    assert.equal(sanitizeProfileAssetCaption("  Transparent PNG "), "Transparent PNG");
    assert.equal(validateProfileAssetByteSize(1024), 1024);
    assert.throws(() => validateProfileAssetByteSize(0), /positive byte size/);

    assert.equal(
      createProfileAssetStorageKey({
        token: "abcdef0123456789abcdef0123456789",
        originalFileName: "Aurora Logo!!.svg",
        mimeType: "image/svg+xml",
        now: Date.UTC(2026, 5, 15),
      }),
      "profile-assets/2026-06-15/abcdef0123456789abcdef01/aurora-logo/display.svg",
    );
    assert.equal(
      createProfileAssetStorageKey({
        token: "abcdef0123456789abcdef0123456789",
        mimeType: "image/png",
        now: Date.UTC(2026, 5, 15),
      }),
      "profile-assets/2026-06-15/abcdef0123456789abcdef01/asset/display.webp",
    );
  });

  it("writes upload purposes and consumes legacy owner upload intents", async () => {
    type AssetTable =
      | "profileAssetUploadIntents"
      | "profileAssets"
      | "profileAssetPlacements"
      | "profileAuditEvents"
      | "apiWriteAuditEvents"
      | "profileOwners"
      | "profiles";
    type AssetRow = Record<string, unknown> & {
      _id: string;
      _creationTime: number;
    };
    const tables: Record<AssetTable, AssetRow[]> = {
      profileAssetUploadIntents: [],
      profileAssets: [],
      profileAssetPlacements: [],
      profileAuditEvents: [],
      apiWriteAuditEvents: [],
      profiles: [
        {
          _id: "profile123",
          _creationTime: 1,
          claimState: "claimed",
        },
      ],
      profileOwners: [
        {
          _id: "profileOwners:1",
          _creationTime: 1,
          profileId: "profile123",
          userId: "user123",
          roleKey: "owner",
          state: "active",
        },
      ],
    };
    const db = {
      async get(id: string) {
        return Object.values(tables).flat().find((row) => row._id === id) ?? null;
      },
      async insert(tableName: AssetTable, row: Record<string, unknown>) {
        const id = `${tableName}:${tables[tableName].length + 1}`;
        tables[tableName].push({
          _id: id,
          _creationTime: 1,
          ...row,
        });

        return id;
      },
      async patch(id: string, patch: Record<string, unknown>) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((candidate) => candidate._id === id);
          if (row !== undefined) {
            Object.assign(row, patch);
            return;
          }
        }

        throw new Error(`Missing test row ${id}.`);
      },
      query(tableName: AssetTable) {
        let rows = tables[tableName];
        const result = {
          async collect() {
            return rows;
          },
          async take(limit: number) {
            return rows.slice(0, limit);
          },
          filter(filterBuilder: (filter: unknown) => unknown) {
            const filter = {
              field(field: string) {
                return field;
              },
              eq(field: string, value: unknown) {
                rows = rows.filter((row) => row[field] === value);
                return true;
              },
            };
            filterBuilder(filter);
            return result;
          },
        };

        return {
          withIndex(_indexName: string, builder: (index: unknown) => unknown) {
            const values: Record<string, unknown> = {};
            const index = {
              eq(field: string, value: unknown) {
                values[field] = value;
                return index;
              },
            };
            builder(index);
            rows = rows.filter((row) =>
              Object.entries(values).every(([field, value]) => row[field] === value),
            );
            return result;
          },
        };
      },
    };
    const requestedBy = {
      tokenIdentifier: "api:user123",
      issuer: "vrdex:api",
      subject: "user123",
      displayName: "API user",
    };
    const intent = await createProfileAssetUploadIntentRecord(db as never, {
      requestedBy,
      targetProfileId: "profile123" as Id<"profiles">,
      originalFileName: " Logo.PNG ",
      mimeType: "image/png",
      byteSize: 2048,
      label: "  Primary   logo ",
      caption: " Brand mark ",
      placements: ["primary_logo"],
      source: "owner_authored",
      purpose: "owner_publish",
      now: 1000,
    });

    assert.equal(tables.profileAssetUploadIntents[0]?.targetProfileId, "profile123");
    assert.equal(tables.profileAssetUploadIntents[0]?.label, "Primary logo");
    assert.deepEqual(tables.profileAssetUploadIntents[0]?.placements, ["primary_logo"]);
    assert.equal(tables.profileAssetUploadIntents[0]?.purpose, "owner_publish");

    // Intents created before community proposals existed had no discriminator.
    // They were all owner uploads, so absence preserves that original behavior.
    delete tables.profileAssetUploadIntents[0]?.purpose;

    const completed = await finalizeProfileAssetUploadIntentUpload(db as never, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      mimeType: "image/png",
      byteSize: 4096,
      now: 1500,
    });

    assert.deepEqual(completed.assetIds, ["profileAssets:1"]);
    assert.equal(tables.profileAssetUploadIntents[0]?.state, "consumed");
    assert.equal(tables.profileAssets[0]?.profileId, "profile123");
    assert.equal(tables.profileAssets[0]?.byteSize, 4096);
    assert.equal(tables.profileAssets[0]?.label, "Primary logo");
    assert.equal(tables.profileAssets[0]?.source, "owner_authored");
    assert.equal(tables.profileAssetPlacements[0]?.placement, "primary_logo");
    assert.equal(tables.profileAuditEvents[0]?.action, "api_profile_asset_uploaded");
    assert.equal(tables.apiWriteAuditEvents[0]?.action, "profile_asset_upload_completed");
    assert.equal(tables.apiWriteAuditEvents[0]?.actorKind, "upload_token");
    assert.equal(tables.apiWriteAuditEvents[0]?.routeClass, "asset_upload_intent");
    assert.deepEqual(tables.apiWriteAuditEvents[0]?.assetIds, ["profileAssets:1"]);
  });

  it("rejects targeted upload completion after profile ownership transfers", async () => {
    const intent = {
      _id: "profileAssetUploadIntents:1" as Id<"profileAssetUploadIntents">,
      _creationTime: 1,
      uploadToken: "upload-token",
      requestedBy: {
        tokenIdentifier: "api:user123",
        issuer: "vrdex:api",
        subject: "user123",
        displayName: "API user",
      },
      targetProfileId: "profile123" as Id<"profiles">,
      originalFileName: "logo.png",
      mimeType: "image/png",
      byteSize: 2048,
      storageKey: "profile-assets/logo.png",
      placements: ["primary_logo" as const],
      source: "owner_authored" as const,
      state: "pending" as const,
      createdAt: 1000,
      expiresAt: 2000,
      updatedAt: 1000,
    };
    const activeOwner = {
      profileId: intent.targetProfileId,
      userId: "new-owner",
      state: "active",
    };
    let writeAttempted = false;
    const db = {
      async get(id: string) {
        return id === intent._id ? intent : null;
      },
      query(tableName: string) {
        assert.equal(tableName, "profileOwners");
        let matchesOwner = true;

        return {
          withIndex(_indexName: string, builder: (index: unknown) => unknown) {
            const index = {
              eq(field: keyof typeof activeOwner, value: unknown) {
                matchesOwner &&= activeOwner[field] === value;
                return index;
              },
            };
            builder(index);

            return {
              filter(filterBuilder: (filter: unknown) => unknown) {
                const filter = {
                  field(field: keyof typeof activeOwner) {
                    return field;
                  },
                  eq(field: keyof typeof activeOwner, value: unknown) {
                    matchesOwner &&= activeOwner[field] === value;
                    return true;
                  },
                };
                filterBuilder(filter);

                return {
                  async take() {
                    return matchesOwner ? [activeOwner] : [];
                  },
                };
              },
            };
          },
        };
      },
      async patch() {
        writeAttempted = true;
      },
      async insert() {
        writeAttempted = true;
        return "unexpected";
      },
    };

    await assert.rejects(
      () =>
        finalizeProfileAssetUploadIntentUpload(db as never, {
          intentId: intent._id,
          uploadToken: intent.uploadToken,
          mimeType: "image/png",
          byteSize: 4096,
          now: 1500,
        }),
      /do not have permission to update this profile/,
    );
    assert.equal(writeAttempted, false);
    assert.equal(intent.state, "pending");
  });

  it("normalizes avatar appearance controls to a safe display range", () => {
    assert.deepEqual(
      normalizeProfileAvatarAppearance({
        borderEnabled: true,
        borderColor: "#AABBCC",
        borderWidthPx: 4.4,
        borderSoftnessPx: 11.6,
        radiusPercent: 17.8,
      }),
      {
        borderEnabled: true,
        borderColor: "#aabbcc",
        borderWidthPx: 4,
        borderSoftnessPx: 12,
        radiusPercent: 18,
      },
    );
    assert.equal(
      normalizeProfileAvatarAppearance({
        borderEnabled: false,
        borderColor: "#123456",
        borderWidthPx: 999,
        borderSoftnessPx: 999,
        radiusPercent: 999,
      }).radiusPercent,
      50,
    );
    assert.equal(
      normalizeProfileAvatarAppearance({
        borderEnabled: false,
        borderColor: "#123456",
        borderWidthPx: 999,
        borderSoftnessPx: 999,
        radiusPercent: 999,
      }).borderSoftnessPx,
      24,
    );
    assert.throws(
      () => normalizeProfileAvatarAppearance({ borderEnabled: true, borderColor: "red", radiusPercent: 20 }),
      /six-digit hex color/,
    );
  });

  it("reuses supplied display preferences when building public media kits", async () => {
    const profile = {
      _id: "profile-appearance",
      slug: "dj-aurora",
    } as Doc<"profiles">;
    const preference = {
      profileId: profile._id,
      compactDisplay: "logo",
      avatarAppearance: {
        borderEnabled: true,
        borderColor: "#67e8f9",
        borderWidthPx: 4,
        borderSoftnessPx: 12,
        radiusPercent: 18,
      },
      sectionOrder: ["links", "about"],
      updatedAt: 1,
    } as Doc<"profileAssetDisplayPreferences">;
    const db = {
      query(tableName: string) {
        if (tableName === "profileAssetDisplayPreferences") {
          throw new Error("Display preferences should be supplied by the caller.");
        }

        return {
          withIndex() {
            return {
              async collect() {
                return [];
              },
            };
          },
        };
      },
    };

    const mediaKit = await getPublicProfileMediaKit(db as never, profile, { preference });

    assert.equal(mediaKit.compactDisplay, "logo");
    assert.deepEqual(mediaKit.avatarAppearance, preference.avatarAppearance);
  });

  it("projects gallery order, featured media, and optional public metadata", async () => {
    const profile = {
      _id: "profile-gallery",
      slug: "dj-aurora",
    } as Doc<"profiles">;
    const first = {
      _id: "asset-first",
      profileId: profile._id,
      state: "active",
      visibility: "public",
      label: "Press portrait",
      altText: "DJ Aurora under violet stage light.",
      credit: "Photo by Example",
      mimeType: "image/webp",
      byteSize: 1_024,
    } as Doc<"profileAssets">;
    const second = {
      ...first,
      _id: "asset-second",
      label: "Wordmark",
      altText: undefined,
    } as Doc<"profileAssets">;
    const unplaced = {
      ...first,
      _id: "asset-unplaced",
      label: undefined,
      altText: undefined,
    } as Doc<"profileAssets">;
    const placements = [
      { assetId: second._id, placement: "gallery", position: 0, state: "active" },
      { assetId: first._id, placement: "gallery", position: 1, state: "active" },
      { assetId: first._id, placement: "featured", position: 0, state: "active" },
    ] as Doc<"profileAssetPlacements">[];
    const db = {
      query(tableName: string) {
        return {
          withIndex() {
            return {
              async collect() {
                if (tableName === "profileAssets") return [first, second, unplaced];
                if (tableName === "profileAssetPlacements") return placements;
                return [];
              },
              async unique() {
                return null;
              },
            };
          },
        };
      },
    };

    const mediaKit = await getPublicProfileMediaKit(db as never, profile);

    assert.deepEqual(mediaKit.assets.map((asset) => asset.assetId), [second._id, first._id, unplaced._id]);
    assert.deepEqual(mediaKit.galleryAssets.map((asset) => asset.assetId), [second._id, first._id]);
    assert.equal(mediaKit.featuredAsset?.assetId, first._id);
    assert.equal(mediaKit.featuredAsset?.altText, "DJ Aurora under violet stage light.");
    assert.equal(mediaKit.featuredAsset?.credit, "Photo by Example");
    assert.equal(mediaKit.galleryAssets[0]?.altText, undefined);
  });

  it("does not let media-kit placements bypass profile field visibility", async () => {
    const profile = {
      _id: "profile-private-media",
      slug: "dj-private",
      fieldVisibility: {
        avatarImageUrl: "private",
        bannerImageUrl: "private",
        mediaKit: "private",
      },
    } as Doc<"profiles">;
    const asset = {
      _id: "asset-private-media",
      profileId: profile._id,
      state: "active",
      visibility: "public",
      label: "Press image",
      mimeType: "image/webp",
      byteSize: 1_024,
    } as Doc<"profileAssets">;
    const placements = [
      { assetId: asset._id, placement: "profile_image", position: 0, state: "active" },
      { assetId: asset._id, placement: "banner", position: 0, state: "active" },
      { assetId: asset._id, placement: "primary_logo", position: 0, state: "active" },
      { assetId: asset._id, placement: "gallery", position: 0, state: "active" },
      { assetId: asset._id, placement: "featured", position: 0, state: "active" },
    ] as Doc<"profileAssetPlacements">[];
    const db = {
      query(tableName: string) {
        return {
          withIndex() {
            return {
              async collect() {
                if (tableName === "profileAssets") return [asset];
                if (tableName === "profileAssetPlacements") return placements;
                return [];
              },
              async unique() {
                return null;
              },
            };
          },
        };
      },
    };

    const mediaKit = await getPublicProfileMediaKit(db as never, profile);

    assert.equal(mediaKit.profileImage, undefined);
    assert.equal(mediaKit.banner, undefined);
    assert.equal(mediaKit.primaryLogo, undefined);
    assert.equal(mediaKit.featuredAsset, undefined);
    assert.deepEqual(mediaKit.additionalLogos, []);
    assert.deepEqual(mediaKit.galleryAssets, []);
    assert.deepEqual(mediaKit.assets, []);
    assert.equal(mediaKit.logoZipUrl, undefined);
  });

  it("keeps unlisted media on direct profiles but out of discovery", async () => {
    const profile = {
      _id: "profile-unlisted-media",
      slug: "dj-unlisted",
      fieldVisibility: { mediaKit: "unlisted" },
    } as Doc<"profiles">;
    const asset = {
      _id: "asset-unlisted-media",
      profileId: profile._id,
      state: "active",
      visibility: "public",
      label: "Logo",
      mimeType: "image/webp",
      byteSize: 1_024,
    } as Doc<"profileAssets">;
    const placements = [
      { assetId: asset._id, placement: "primary_logo", position: 0, state: "active" },
    ] as Doc<"profileAssetPlacements">[];
    const db = {
      query(tableName: string) {
        return {
          withIndex() {
            return {
              async collect() {
                if (tableName === "profileAssets") return [asset];
                if (tableName === "profileAssetPlacements") return placements;
                return [];
              },
              async unique() {
                return null;
              },
            };
          },
        };
      },
    };

    const direct = await getPublicProfileMediaKit(db as never, profile);
    const discovery = await getPublicProfileMediaKit(db as never, profile, {
      surface: "discovery",
    });

    assert.equal(direct.primaryLogo?.assetId, asset._id);
    assert.equal(discovery.primaryLogo, undefined);
    assert.deepEqual(discovery.assets, []);
  });
});
