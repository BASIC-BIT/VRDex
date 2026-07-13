import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  accountFeatureAccessFromGrants,
  isAccountFeatureGrantActive,
} from "../../convex/_accountFeatureModel";
import {
  canIncludePrivateSeedCandidate,
  projectSafePrivateSeedField,
} from "../../convex/_seedAccess";
import {
  buildConciergeProfileFieldPatch,
  canRevealAcceptedHandoffDestination,
  hashHandoffToken,
  isHandoffBatchAvailable,
  isClaimablePrivatePersonSeedCandidate,
  isLiveHandoffInvitation,
  isReusablePrivateConciergeProfile,
  projectHandoffPreviewField,
  requireSecureHandoffToken,
  selectHandoffFields,
} from "../../convex/_seedHandoffs";
import {
  createSeedImportDocuments,
  getSeedImportPublicationBlockers,
  normalizePermissionedSeedImport,
  seedImportCandidateFingerprint,
} from "../../convex/_seedImports";
import {
  chunkPermissionedSeedImport,
  MAX_CONVEX_IMPORT_ARGS_BYTES,
} from "../../scripts/import-seed-json.mjs";

function seedField(
  overrides: Partial<Doc<"seedImportCandidateFields">> = {},
): Doc<"seedImportCandidateFields"> {
  return {
    _id: "field-1" as Id<"seedImportCandidateFields">,
    _creationTime: 1,
    candidateId: "candidate-1" as Id<"seedImportCandidateProfiles">,
    fieldKey: "aliases",
    value: ["DJ Example"],
    sourceLabel: "Example Partner",
    sourceType: "partner",
    confidence: "medium",
    reviewState: "unreviewed",
    visibility: "private",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("account feature access", () => {
  it("honors expiry and lets super-admin imply seed lookup", () => {
    assert.equal(
      isAccountFeatureGrantActive(
        { feature: "view_private_seed_lookup", state: "active", expiresAt: 99 },
        100,
      ),
      false,
    );
    assert.deepEqual(
      accountFeatureAccessFromGrants(
        [{ feature: "super_admin", state: "active", expiresAt: 101 }],
        100,
      ),
      { superAdmin: true, canViewPrivateSeedLookup: true },
    );
    assert.deepEqual(
      accountFeatureAccessFromGrants(
        [{ feature: "view_private_seed_lookup", state: "revoked" }],
        100,
      ),
      { superAdmin: false, canViewPrivateSeedLookup: false },
    );
  });
});

describe("permissioned seed import", () => {
  const payload = {
    permissioned: true,
    batchId: "partner_2026_07_09",
    sourceName: "Example Partner",
    sourceType: "partner",
    receivedAt: "2026-07-09T12:00:00.000Z",
    sourceObservedAt: "2026-07-01T00:00:00.000Z",
    candidates: [
      {
        candidateId: "example-dj-1",
        proposedDisplayName: "DJ Example",
        fields: [
          {
            fieldKey: "outboundLinks",
            value: [
              {
                type: "soundcloud",
                label: "SoundCloud",
                url: "https://example.invalid/dj-example",
              },
            ],
            sourceLabel: "Example Partner",
            sourceType: "partner",
            sourceObservedAt: "2026-07-01T00:00:00.000Z",
            lastCheckedAt: "2026-07-08T00:00:00.000Z",
            confidence: "medium",
            visibility: "private",
          },
        ],
      },
    ],
  };

  it("normalizes real input into private unclaimed records with freshness", async () => {
    const normalized = normalizePermissionedSeedImport(payload);
    assert.equal(normalized.sourceObservedAt, Date.parse("2026-07-01T00:00:00.000Z"));
    assert.equal(normalized.candidates[0]?.publicationState, "draft_private");
    assert.equal(normalized.candidates[0]?.claimState, "unclaimed");
    assert.equal(
      normalized.candidates[0]?.fields[0]?.lastCheckedAt,
      Date.parse("2026-07-08T00:00:00.000Z"),
    );

    const inserts: Array<{ table: string; document: Record<string, unknown> }> = [];
    await createSeedImportDocuments(
      {
        async insert(table: string, document: Record<string, unknown>) {
          inserts.push({ table, document });
          return `${table}-${inserts.length}`;
        },
      } as never,
      normalized,
      { now: 10 },
    );

    assert.equal(
      inserts.find((insert) => insert.table === "seedImportBatches")?.document.sourceObservedAt,
      Date.parse("2026-07-01T00:00:00.000Z"),
    );
    assert.equal(
      inserts.find((insert) => insert.table === "seedImportBatches")?.document.publicationPolicy,
      "private_only",
    );
    assert.equal(
      inserts.find((insert) => insert.table === "seedImportCandidateFields")?.document.lastCheckedAt,
      Date.parse("2026-07-08T00:00:00.000Z"),
    );
    assert.match(
      String(
        inserts.find((insert) => insert.table === "seedImportCandidateProfiles")
          ?.document.importFingerprint,
      ),
      /^[a-f0-9]{64}$/,
    );
  });

  it("rejects unpermissioned, extra, and private-contact fields", () => {
    assert.throws(
      () => normalizePermissionedSeedImport({ ...payload, permissioned: false }),
      /permissioned: true/,
    );
    assert.throws(
      () => normalizePermissionedSeedImport({ ...payload, privateNotes: "do not ingest" }),
      /unsupported key/,
    );
    const privateContact = structuredClone(payload) as Record<string, any>;
    privateContact.candidates[0].fields[0].fieldKey = "privateContactEmail";
    privateContact.candidates[0].fields[0].value = "private@example.invalid";
    assert.throws(
      () => normalizePermissionedSeedImport(privateContact),
      /Unsupported permissioned seed field/,
    );
  });

  it("chunks a 400-DJ list below the Windows command-line limit", () => {
    const candidates = Array.from({ length: 400 }, (_, index) => ({
      ...structuredClone(payload.candidates[0]),
      candidateId: `example-dj-${index + 1}`,
      proposedDisplayName: `DJ Example ${index + 1}`,
    }));
    const chunks = chunkPermissionedSeedImport(
      { ...payload, candidates },
      {
        tokenIdentifier: "operator",
        issuer: "vrdex",
        subject: "seed-import",
      },
    );

    assert.ok(chunks.length > 1);
    assert.equal(
      chunks.reduce((count, chunk) => count + chunk.payload.candidates.length, 0),
      400,
    );
    for (const chunk of chunks) {
      assert.ok(Buffer.byteLength(JSON.stringify(chunk), "utf8") <= MAX_CONVEX_IMPORT_ARGS_BYTES);
    }
  });

  it("blocks public publication for permissioned imports", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: { publicationPolicy: "private_only", reviewState: "approved" },
      candidate: {
        reviewState: "accepted",
        publicationState: "review_pending",
        claimState: "unclaimed",
        proposedSlug: "example-dj",
      },
      fields: [
        {
          fieldKey: "aliases",
          value: ["DJ Example"],
          confidence: "medium",
          reviewState: "accepted",
          visibility: "private",
        },
      ],
    });

    assert.deepEqual(blockers, ["source_private_only"]);
  });

  it("rejects future freshness timestamps", () => {
    const futurePayload = structuredClone(payload);
    futurePayload.candidates[0]!.fields[0]!.lastCheckedAt = "2026-07-11T00:00:00.000Z";

    assert.throws(
      () => normalizePermissionedSeedImport(
        futurePayload,
        Date.parse("2026-07-10T00:00:00.000Z"),
      ),
      /cannot be in the future/,
    );
  });

  it("fingerprints candidate payloads and detects changed reruns", async () => {
    const normalized = normalizePermissionedSeedImport(payload);
    const original = normalized.candidates[0]!;
    const changedPayload = structuredClone(payload);
    changedPayload.candidates[0]!.proposedDisplayName = "DJ Example Updated";
    const changed = normalizePermissionedSeedImport(changedPayload).candidates[0]!;

    assert.equal(
      await seedImportCandidateFingerprint(original),
      await seedImportCandidateFingerprint(original),
    );
    assert.notEqual(
      await seedImportCandidateFingerprint(original),
      await seedImportCandidateFingerprint(changed),
    );
  });
});

describe("private seed projection", () => {
  it("shows unreviewed candidates only to super-admins and allowlists fields", () => {
    const candidate = {
      claimState: "unclaimed" as const,
      profileType: "person" as const,
      publicationState: "draft_private" as const,
      reviewState: "unreviewed" as const,
    };
    assert.equal(canIncludePrivateSeedCandidate(candidate as never, undefined, undefined, true), true);
    assert.equal(canIncludePrivateSeedCandidate(candidate as never, "private_only", "approved", false), false);
    assert.equal(
      canIncludePrivateSeedCandidate(
        { ...candidate, claimState: "claimed_unverified", reviewState: "accepted" } as never,
        "private_only",
        "approved",
        false,
      ),
      false,
    );
    assert.equal(
      canIncludePrivateSeedCandidate(
        { ...candidate, reviewState: "accepted" } as never,
        "reviewed_publication_allowed",
        "approved",
        false,
      ),
      false,
    );
    assert.equal(
      canIncludePrivateSeedCandidate(
        { ...candidate, reviewState: "accepted" } as never,
        "private_only",
        "approved",
        false,
      ),
      true,
    );
    for (const batchReviewState of ["rejected", "superseded"] as const) {
      assert.equal(
        canIncludePrivateSeedCandidate(
          { ...candidate, reviewState: "accepted" } as never,
          "private_only",
          batchReviewState,
          false,
        ),
        false,
      );
    }
    assert.equal(projectSafePrivateSeedField(seedField())?.fieldKey, "aliases");
    assert.equal(
      projectSafePrivateSeedField(
        seedField({ fieldKey: "privateContactEmail", value: "private@example.invalid" }),
      ),
      null,
    );
  });
});

describe("seed handoff helpers", () => {
  it("allows handoff only for unclaimed candidates and profiles", () => {
    assert.equal(
      isClaimablePrivatePersonSeedCandidate({
        claimState: "unclaimed",
        profileType: "person",
        publicationState: "draft_private",
      }),
      true,
    );
    assert.equal(
      isClaimablePrivatePersonSeedCandidate({
        claimState: "claimed_unverified",
        profileType: "person",
        publicationState: "draft_private",
      }),
      false,
    );
    assert.equal(
      isReusablePrivateConciergeProfile({
        claimState: "claimed_verified",
        profileType: "person",
        publicationState: "draft_private",
      }),
      false,
    );
    assert.equal(
      canRevealAcceptedHandoffDestination(
        "user-1" as Id<"users">,
        undefined,
      ),
      false,
    );
    assert.equal(
      canRevealAcceptedHandoffDestination(
        "user-1" as Id<"users">,
        "user-2" as Id<"users">,
      ),
      false,
    );
    assert.equal(
      canRevealAcceptedHandoffDestination(
        "user-1" as Id<"users">,
        "user-1" as Id<"users">,
      ),
      true,
    );
    assert.equal(
      isLiveHandoffInvitation({ state: "active", expiresAt: 101 }, 100),
      true,
    );
    assert.equal(
      isLiveHandoffInvitation({ state: "active", expiresAt: 100 }, 100),
      false,
    );
  });

  it("hashes strong invitation tokens with SHA-256 and rejects weak tokens", async () => {
    const token = "A".repeat(43);
    assert.equal(
      await hashHandoffToken(token),
      createHash("sha256").update(token).digest("hex"),
    );
    assert.throws(() => requireSecureHandoffToken("short"), /invalid/);
  });

  it("allows recipients to remove every optional field explicitly", () => {
    assert.deepEqual(selectHandoffFields([seedField()], []), []);
  });

  it("rejects fields outside the invitation and builds private profile fields", () => {
    const aliasField = seedField();
    assert.throws(
      () =>
        selectHandoffFields(
          [aliasField],
          ["not-offered" as Id<"seedImportCandidateFields">],
        ),
      /not offered/,
    );
    assert.deepEqual(buildConciergeProfileFieldPatch([aliasField]), {
      aliases: ["DJ Example"],
      fieldVisibility: { aliases: "private" },
    });
  });

  it("rejects handoff fields withdrawn during review", () => {
    for (const reviewState of ["rejected", "needs_correction"] as const) {
      const field = seedField({ reviewState });
      assert.equal(projectHandoffPreviewField(field), null);
      assert.throws(() => selectHandoffFields([field], [field._id]), /no longer available/);
    }
  });

  it("closes handoffs when their import batch is rejected or superseded", () => {
    assert.equal(isHandoffBatchAvailable({ reviewState: "approved" }), true);
    assert.equal(isHandoffBatchAvailable({ reviewState: "rejected" }), false);
    assert.equal(isHandoffBatchAvailable({ reviewState: "superseded" }), false);
    assert.equal(isHandoffBatchAvailable(null), false);
  });

  it("clears stale search aliases when replacing aliases on a reused profile", () => {
    const patch = buildConciergeProfileFieldPatch(
      [seedField({ value: ["DJ Current"] })],
      {
        aliases: ["DJ Previous"],
        searchAliases: ["dj previous", "stale lineup name"],
      } as never,
    );

    assert.deepEqual(patch.aliases, ["DJ Current"]);
    assert.deepEqual(patch.searchAliases, []);
  });

  it("removes deselected prepared fields from a reused concierge profile", () => {
    const aliasField = seedField();
    const bioField = seedField({
      _id: "field-2" as Id<"seedImportCandidateFields">,
      fieldKey: "bio",
      value: "Prepared biography",
    });
    const patch = buildConciergeProfileFieldPatch(
      [],
      {
        aliases: ["DJ Example"],
        bio: "Prepared biography",
        avatarImageUrl: "https://cdn.example.invalid/avatar.png",
        fieldVisibility: {
          aliases: "private",
          bio: "private",
          avatarImageUrl: "private",
          tags: "public",
        },
        person: { pronouns: "they/them", roleTags: ["DJ"] },
      } as never,
    );

    assert.deepEqual(patch, {
      aliases: [],
      searchAliases: [],
      tags: [],
      genres: [],
      headline: undefined,
      bio: undefined,
      about: undefined,
      outboundLinks: [],
      region: undefined,
      timezone: undefined,
      person: { roleTags: [] },
      fieldVisibility: { avatarImageUrl: "private" },
    });
  });

  it("projects every grouped outbound link for recipient review", () => {
    const field = seedField({
      fieldKey: "outboundLinks",
      value: [
        { type: "twitch", label: "Twitch", url: "https://twitch.tv/example" },
        { type: "vrchat_profile", label: "VRChat", url: "https://vrchat.com/home/user/usr_example" },
      ],
    });
    const preview = projectHandoffPreviewField(field);

    assert.equal(preview?.kind, "link_list");
    assert.deepEqual(preview && "links" in preview ? preview.links : undefined, [
      { label: "Twitch", url: "https://twitch.tv/example" },
      { label: "VRChat", url: "https://vrchat.com/home/user/usr_example" },
    ]);
  });
});
