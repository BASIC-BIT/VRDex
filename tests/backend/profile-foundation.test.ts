import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  normalizeProfilePublicSectionOrder,
  toPublicProfileAppearance,
} from "../../convex/_profileAppearance";
import {
  createProfileAssetUploadIntentRecord,
  createProfileAssetStorageKey,
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
import { applyProfileFieldVisibilityUpdate } from "../../convex/_profilePrivacy";
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
import { sanitizeApiProfileUpdateInput } from "../../convex/_profileUpdates";
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
  | "vocabularyTerms";
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

    assert.equal(result.profilePath, "/p/dj-no-match");
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

    assert.equal(result.profilePath, "/c/afterglow-social");
    assert.equal(result.claimState, "claimed_unverified");
    assert.equal(profile?.profileType, "community");
    assert.equal(profile?.claimState, "claimed_unverified");
    assert.equal(profile?.creationSource, "self");
    assert.equal(tables.profileOwners.length, 1);
    assert.equal(tables.profileClaimRequests[0]?.method, "discord_community");
    assert.equal(tables.profileClaimRequests[0]?.evidenceSource, "discord_api");
    assert.equal(tables.searchDocuments[0]?.routePath, "/c/afterglow-social");
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
      /already has an active owner/,
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

    assert.deepEqual(result.changedFields, ["displayName", "aliases", "bio", "person"]);
    assert.deepEqual(result.patch, {
      displayName: "DJ Celine",
      sortName: "dj celine",
      aliases: ["Celine"],
      bio: undefined,
      person: {
        roleTags: ["DJ", "VJ"],
      },
    });
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

    assert.equal(lookup?.profilePath, "/p/dj-celine");
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
      "profile-assets/2026-06-15/abcdef0123456789abcdef01/aurora-logo.svg",
    );
    assert.equal(
      createProfileAssetStorageKey({
        token: "abcdef0123456789abcdef0123456789",
        mimeType: "image/png",
        now: Date.UTC(2026, 5, 15),
      }),
      "profile-assets/2026-06-15/abcdef0123456789abcdef01/asset.png",
    );
  });

  it("consumes API-targeted upload intents into active profile assets", async () => {
    type AssetTable =
      | "profileAssetUploadIntents"
      | "profileAssets"
      | "profileAssetPlacements"
      | "profileAuditEvents"
      | "apiWriteAuditEvents"
      | "profileOwners";
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
        assert.equal(tableName, "profileOwners");
        let rows = tables.profileOwners;

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

            return {
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

                return {
                  async take(limit: number) {
                    return rows.slice(0, limit);
                  },
                };
              },
            };
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
      now: 1000,
    });

    assert.equal(tables.profileAssetUploadIntents[0]?.targetProfileId, "profile123");
    assert.equal(tables.profileAssetUploadIntents[0]?.label, "Primary logo");
    assert.deepEqual(tables.profileAssetUploadIntents[0]?.placements, ["primary_logo"]);

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
});
