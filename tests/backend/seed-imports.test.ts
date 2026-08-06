import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import {
  FAKE_SEED_IMPORT_FIXTURE_KEY,
  FAKE_SEED_IMPORT_FIXTURES,
  candidatePublicationStateForReviewState,
  createSeedImportDocumentsFromFixture,
  canBulkAcceptSeedImportCandidate,
  canBulkAcceptSeedImportField,
  canBulkApproveSeedImportBatch,
  getSeedImportPublicationBlockers,
  getSeedImportPublishBlockers,
  hasPublicationAuthorization,
  hasSeedFieldContent,
  normalizeSeedImportFixture,
  type SeedImportFixture,
} from "../../convex/_seedImports";
import {
  misplacedMigrationFlag,
  readOption,
  unknownOption,
  VALUE_OPTIONS,
} from "../../scripts/publish-seed-batch.mjs";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/seedImports.ts": () => import("../../convex/seedImports"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

function cloneFixture(fixture: SeedImportFixture): SeedImportFixture {
  return structuredClone(fixture);
}

describe("seed import fake fixture creation", () => {
  it("creates private unreviewed candidates and preserves field provenance", async () => {
    const inserts: Array<{ table: string; id: string; document: Record<string, unknown> }> = [];
    const db = {
      async insert(table: string, document: Record<string, unknown>) {
        const id = `${table}-${inserts.length + 1}`;
        inserts.push({ table, id, document });
        return id;
      },
    };
    const importedBy = {
      tokenIdentifier: "fixture:tester",
      issuer: "vrdex:test",
      subject: "tester",
      displayName: "Fixture Tester",
    };

    const result = await createSeedImportDocumentsFromFixture(
      db as never,
      FAKE_SEED_IMPORT_FIXTURES[FAKE_SEED_IMPORT_FIXTURE_KEY],
      { importedBy, now: 1_788_220_800_000 },
    );

    assert.equal(result.candidateIds.length, 2);
    assert.equal(result.fieldIds.length, 4);
    assert.equal(inserts[0]?.table, "seedImportBatches");
    assert.deepEqual(inserts[0]?.document, {
      externalBatchId: "seed_fake_2026_001",
      sourceName: "Example Partner Directory",
      sourceType: "partner",
      sourceContact: "example-fixture-owner@vrdex.invalid",
      receivedAt: Date.parse("2026-06-01T00:00:00.000Z"),
      publicationPolicy: "reviewed_publication_allowed",
      importedBy,
      reviewState: "draft",
      notes: "Fake fixture for reviewed seed-import workflow tests.",
      createdAt: 1_788_220_800_000,
      updatedAt: 1_788_220_800_000,
    });

    const candidateInsert = inserts.find((insert) => insert.table === "seedImportCandidateProfiles");
    assert.equal(candidateInsert?.document.reviewState, "unreviewed");
    assert.equal(candidateInsert?.document.publicationState, "draft_private");
    assert.equal(candidateInsert?.document.claimState, "unclaimed");

    const fieldInsert = inserts.find(
      (insert) =>
        insert.table === "seedImportCandidateFields" &&
        insert.document.fieldKey === "outboundLinks",
    );
    assert.equal(fieldInsert?.document.sourceLabel, "Example Partner Directory");
    assert.equal(fieldInsert?.document.sourceType, "partner");
    assert.equal(fieldInsert?.document.confidence, "medium");
    assert.equal(fieldInsert?.document.reviewState, "unreviewed");
    assert.equal(fieldInsert?.document.visibility, "public");
  });

  it("rejects fixture data that does not stay fake", () => {
    const fixture = cloneFixture(FAKE_SEED_IMPORT_FIXTURES[FAKE_SEED_IMPORT_FIXTURE_KEY]);

    fixture.batchId = "seed_real_partner_001";
    assert.throws(() => normalizeSeedImportFixture(fixture), /seed_fake_/);

    const realUrlFixture = cloneFixture(FAKE_SEED_IMPORT_FIXTURES[FAKE_SEED_IMPORT_FIXTURE_KEY]);
    realUrlFixture.candidates[0]!.fields[1]!.value = [
      { type: "website", label: "Real site", url: "https://real.example.com/dj" },
    ];
    assert.throws(() => normalizeSeedImportFixture(realUrlFixture), /\.invalid URLs/);

    const ownerConfirmedFixture = cloneFixture(FAKE_SEED_IMPORT_FIXTURES[FAKE_SEED_IMPORT_FIXTURE_KEY]);
    ownerConfirmedFixture.candidates[0]!.fields[0]!.confidence = "owner_confirmed";
    assert.throws(() => normalizeSeedImportFixture(ownerConfirmedFixture), /owner-confirmed/);
  });
});

describe("seed import review and publication guards", () => {
  const approvedBatch = {
    reviewState: "approved" as const,
    publicationPolicy: "reviewed_publication_allowed" as const,
    publicationAuthorizations: [
      {
        policy: "reviewed_publication_allowed" as const,
        reason: "Source confirmed public listing is permitted.",
        authorizedAt: 1_788_220_800_000,
      },
    ],
  };
  const acceptedCandidate = {
    reviewState: "accepted" as const,
    publicationState: "review_pending" as const,
    claimState: "unclaimed" as const,
    proposedSlug: "dj-example",
  };
  const acceptedPublicFields = [
    {
      fieldKey: "person.roleTags",
      value: ["DJ"],
      confidence: "medium" as const,
      reviewState: "accepted" as const,
      visibility: "public" as const,
    },
    {
      fieldKey: "outboundLinks",
      value: [{ type: "website", label: "Site", url: "https://example.invalid/dj" }],
      sourceUrl: "https://example.invalid/source",
      confidence: "medium" as const,
      reviewState: "accepted" as const,
      visibility: "public" as const,
    },
  ];

  it("maps accepted candidates into the review-pending publication boundary", () => {
    assert.equal(candidatePublicationStateForReviewState("accepted"), "review_pending");
    assert.equal(candidatePublicationStateForReviewState("rejected"), "rejected");
    assert.equal(candidatePublicationStateForReviewState("needs_correction"), "draft_private");
  });

  it("allows a fully reviewed fake candidate to be queued without public writes", () => {
    assert.deepEqual(
      getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: acceptedCandidate,
        fields: acceptedPublicFields,
      }),
      [],
    );
  });

  it("blocks batch, candidate, and field states that are not explicitly reviewed", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: { reviewState: "draft" },
      candidate: {
        reviewState: "unreviewed",
        publicationState: "draft_private",
        claimState: "unclaimed",
      },
      fields: [
        {
          fieldKey: "person.roleTags",
          value: ["DJ"],
          confidence: "medium",
          reviewState: "unreviewed",
          visibility: "public",
        },
        {
          fieldKey: "bio",
          value: "Needs work",
          confidence: "low",
          reviewState: "needs_correction",
          visibility: "public",
        },
      ],
    });

    // source_private_only too: a batch with no explicit policy fails closed.
    // no_publicly_visible_field as well: neither field is accepted, so nothing
    // here would reach the profile even once the review states were resolved.
    assert.deepEqual(new Set(blockers), new Set([
      "source_private_only",
      "publication_not_authorized",
      "batch_not_approved",
      "candidate_not_accepted",
      "candidate_not_pending_publication",
      "field_unreviewed",
      "field_needs_correction",
      "no_publicly_visible_field",
    ]));
  });

  it("blocks unsafe public fields and owner-confirmed claims without an owner flow", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: approvedBatch,
      candidate: acceptedCandidate,
      fields: [
        {
          fieldKey: "privateContactEmail",
          value: "person@example.invalid",
          confidence: "medium",
          reviewState: "accepted",
          visibility: "public",
        },
        {
          fieldKey: "outboundLinks",
          value: [{ type: "website", label: "Unsafe", url: "http://example.invalid/dj" }],
          confidence: "owner_confirmed",
          reviewState: "accepted",
          visibility: "public",
        },
      ],
    });

    assert.deepEqual(new Set(blockers), new Set([
      "owner_confirmed_field_without_claim",
      "unsafe_public_field",
    ]));
  });

  it("blocks matched claimed, opted-out, suppressed, and slug-collision profiles", () => {
    const matchedProfile = {
      _id: "profile_claimed" as Id<"profiles">,
      claimState: "claimed_verified" as const,
      publicSurfacingState: "suppressed" as const,
    };
    const slugCollisionProfile = {
      _id: "profile_collision" as Id<"profiles">,
      claimState: "unclaimed" as const,
      publicSurfacingState: "public" as const,
    };
    const blockers = getSeedImportPublicationBlockers({
      batch: approvedBatch,
      candidate: {
        ...acceptedCandidate,
        matchedProfileId: "profile_claimed" as Id<"profiles">,
      },
      fields: acceptedPublicFields,
      matchedProfile,
      slugCollisionProfile,
      hasAcceptedSuppressionRequest: true,
    });

    // No slug_collision blocker: a deliberate match merges into the matched
    // profile and keeps its slug, so the colliding slug is never written.
    assert.deepEqual(new Set(blockers), new Set([
      "matched_profile_claimed",
      "matched_profile_not_publicly_surfaceable",
      "suppression_request_blocks_publication",
    ]));
  });

  it("blocks a community candidate at the queue gate, not just at publish", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: approvedBatch,
      candidate: { ...acceptedCandidate, profileType: "community" as const },
      fields: acceptedPublicFields,
    });

    assert.ok(blockers.includes("candidate_profile_type_unsupported"));
  });

  it("blocks accepted fields the publication mapper cannot convert", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: approvedBatch,
      candidate: acceptedCandidate,
      fields: [
        {
          fieldKey: "aliases",
          // A string where the mapper requires an array; previously this passed both
          // gates and then threw mid-page.
          value: "Not An Array",
          confidence: "medium" as const,
          reviewState: "accepted" as const,
          visibility: "private" as const,
        },
      ],
    });

    assert.ok(blockers.includes("unsafe_public_field"));
  });

  it("applies display-name bounds only when creating a profile", () => {
    const shortName = { ...acceptedCandidate, proposedDisplayName: "x" };

    assert.ok(
      getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: shortName,
        fields: acceptedPublicFields,
      }).includes("display_name_outside_public_limits"),
    );

    assert.ok(
      !getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: { ...shortName, matchedProfileId: "profile_matched" as Id<"profiles"> },
        fields: acceptedPublicFields,
        matchedProfile: {
          _id: "profile_matched" as Id<"profiles">,
          claimState: "unclaimed" as const,
          publicSurfacingState: "public" as const,
        },
      }).includes("display_name_outside_public_limits"),
    );
  });

  it("ignores an invalid proposed slug for an explicit match", () => {
    assert.ok(
      getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: acceptedCandidate,
        fields: acceptedPublicFields,
        hasInvalidProposedSlug: true,
      }).includes("invalid_proposed_slug"),
    );

    assert.ok(
      !getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: {
          ...acceptedCandidate,
          matchedProfileId: "profile_matched" as Id<"profiles">,
        },
        fields: acceptedPublicFields,
        matchedProfile: {
          _id: "profile_matched" as Id<"profiles">,
          claimState: "unclaimed" as const,
          publicSurfacingState: "public" as const,
        },
        hasInvalidProposedSlug: true,
      }).includes("invalid_proposed_slug"),
    );
  });

  it("treats a revoked batch as unauthorized despite its history", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: {
        reviewState: "approved" as const,
        publicationPolicy: "reviewed_publication_allowed" as const,
        // Only a revocation on record: the list holds both directions, so a
        // non-empty history is not proof of authorization.
        publicationAuthorizations: [
          {
            policy: "private_only" as const,
            reason: "Source withdrew permission.",
            authorizedAt: 1_788_220_800_000,
          },
        ],
      },
      candidate: acceptedCandidate,
      fields: acceptedPublicFields,
    });

    assert.deepEqual(blockers, ["publication_not_authorized"]);
  });

  it("blocks a relaxed batch that carries no recorded authorization", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: {
        reviewState: "approved" as const,
        publicationPolicy: "reviewed_publication_allowed" as const,
      },
      candidate: acceptedCandidate,
      fields: acceptedPublicFields,
    });

    assert.deepEqual(blockers, ["publication_not_authorized"]);
  });

  // The predicate itself, because three gates ask it -- queue, publish, and the
  // `--set-visibility --rederive-values` migration -- and the third was written
  // with its own weaker copy that read policy and review state alone. A fixture
  // batch carrying the relaxed policy by accident could replay seed values onto
  // live profiles the publish gate would have refused.
  it("recognizes authorization only from a live authorizing entry", () => {
    assert.equal(hasPublicationAuthorization({}), false);
    assert.equal(hasPublicationAuthorization({ publicationAuthorizations: [] }), false);
    assert.equal(
      hasPublicationAuthorization({
        publicationAuthorizations: [
          { policy: "private_only" as const, reason: "Revoked.", authorizedAt: 1_788_220_800_000 },
        ],
      }),
      false,
    );
    assert.equal(
      hasPublicationAuthorization({
        publicationAuthorizations: [
          { policy: "private_only" as const, reason: "Revoked.", authorizedAt: 1_788_220_800_000 },
          {
            policy: "reviewed_publication_allowed" as const,
            reason: "Source re-confirmed permission.",
            authorizedAt: 1_788_307_200_000,
          },
        ],
      }),
      true,
    );
    // Written before revocations were recorded, so an entry with no policy is an
    // authorization by the only thing the list held then.
    assert.equal(
      hasPublicationAuthorization({
        publicationAuthorizations: [{ reason: "Legacy grant.", authorizedAt: 1_788_220_800_000 }],
      }),
      true,
    );
  });

  it("blocks a cross-type match at the queue gate", () => {
    const blockers = getSeedImportPublicationBlockers({
      batch: approvedBatch,
      candidate: {
        ...acceptedCandidate,
        profileType: "person" as const,
        matchedProfileId: "profile_community" as Id<"profiles">,
      },
      fields: acceptedPublicFields,
      matchedProfile: {
        _id: "profile_community" as Id<"profiles">,
        claimState: "unclaimed" as const,
        publicSurfacingState: "public" as const,
        profileType: "community" as const,
      },
    });

    assert.ok(blockers.includes("matched_profile_type_mismatch"));
  });

  it("blocks a slug collision only when creating a new profile", () => {
    const slugCollisionProfile = {
      _id: "profile_collision" as Id<"profiles">,
      claimState: "unclaimed" as const,
      publicSurfacingState: "public" as const,
    };

    assert.ok(
      getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: acceptedCandidate,
        fields: acceptedPublicFields,
        slugCollisionProfile,
      }).includes("slug_collision_blocks_publication"),
    );

    assert.ok(
      !getSeedImportPublicationBlockers({
        batch: approvedBatch,
        candidate: {
          ...acceptedCandidate,
          matchedProfileId: "profile_matched" as Id<"profiles">,
        },
        fields: acceptedPublicFields,
        matchedProfile: {
          _id: "profile_matched" as Id<"profiles">,
          claimState: "unclaimed" as const,
          publicSurfacingState: "public" as const,
        },
        slugCollisionProfile,
      }).includes("slug_collision_blocks_publication"),
    );
  });
});

describe("seed import publish guards", () => {
  const publishableBatch = {
    reviewState: "approved" as const,
    publicationPolicy: "reviewed_publication_allowed" as const,
    publicationAuthorizations: [
      {
        policy: "reviewed_publication_allowed" as const,
        reason: "Source confirmed public listing is permitted.",
        authorizedAt: 1_788_220_800_000,
      },
    ],
  };
  const queuedCandidate = {
    reviewState: "accepted" as const,
    publicationState: "published_unclaimed" as const,
    claimState: "unclaimed" as const,
    profileType: "person" as const,
    proposedSlug: "dj-example",
  };
  // A candidate with nothing publishable is refused by `no_publicly_visible_field`
  // regardless of every other gate, so the fixture for "this one can publish"
  // has to carry a field somebody could actually see.
  const publishableFields = [
    {
      fieldKey: "person.roleTags",
      value: ["DJ"],
      confidence: "medium" as const,
      reviewState: "accepted" as const,
      visibility: "public" as const,
    },
  ];

  it("allows publishing an approved, accepted, queued person candidate", () => {
    assert.deepEqual(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: publishableFields,
      }),
      [],
    );
  });

  // Create-only, like the slug and display-name bounds beside it. A merge writes
  // into a profile that already exists and — because both gates refuse a match
  // that is not publicly surfaced — one that is already public with its own
  // content, so it cannot produce the display-name-only page this refuses.
  // Blocking it stranded the private-only merge `matchCandidateToProfile` exists
  // to record.
  // The import normalizers do not drop blank strings, so `tags: [""]` reached
  // this as a list of length one and counted as content, while the page filters
  // falsy metadata out and shows nothing. A list of nothing is nothing, the same
  // way an empty list already was.
  //
  // Publication was never actually open to it -- `unsafe_public_field` refuses
  // any public list carrying a blank entry, independently. What was wrong is the
  // answer, which `previewBatchPublication` reports as `publiclyVisibleFieldCount`
  // and which should not depend on a neighbouring gate to come out right.
  it("does not count a list of blank entries as visible content", () => {
    const field = (value: unknown) =>
      ({
        fieldKey: "tags",
        value,
        confidence: "medium" as const,
        reviewState: "accepted" as const,
        visibility: "public" as const,
      }) as never;

    assert.equal(hasSeedFieldContent(field([""])), false);
    assert.equal(hasSeedFieldContent(field(["", "   "])), false);
    assert.equal(hasSeedFieldContent(field([])), false);
    assert.equal(hasSeedFieldContent(field(["", "house"])), true);
    assert.equal(hasSeedFieldContent(field(["house"])), true);

    assert.ok(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: [field(["", "   "])],
      }).includes("no_publicly_visible_field"),
    );
  });

  it("lets private-only fields merge into an existing profile", () => {
    const privateOnlyFields = [
      {
        fieldKey: "person.roleTags",
        value: ["DJ"],
        confidence: "medium" as const,
        reviewState: "accepted" as const,
        visibility: "private" as const,
      },
    ];

    assert.ok(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: privateOnlyFields,
      }).includes("no_publicly_visible_field"),
    );

    assert.deepEqual(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: privateOnlyFields,
        matchedProfile: {
          _id: "profile-merge-target" as never,
          claimState: "unclaimed" as const,
          publicationState: "published" as const,
          publicSurfacingState: "public" as const,
        },
      }),
      [],
    );

    // Surfacing is not publication, and the exemption rests on the merge target
    // already being a page a reader can open. A legacy draft_private row carrying
    // publicSurfacingState: "public" is not one, so the candidate still has to
    // bring something visible of its own.
    assert.ok(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: privateOnlyFields,
        matchedProfile: {
          _id: "profile-merge-target" as never,
          claimState: "unclaimed" as const,
          publicationState: "draft_private" as const,
          publicSurfacingState: "public" as const,
        },
      }).includes("no_publicly_visible_field"),
    );
  });

  it("fails closed when the batch has no explicit publication policy", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: { reviewState: "approved" as const },
      candidate: queuedCandidate,
    });

    assert.ok(blockers.includes("source_private_only"));
    assert.ok(blockers.includes("publication_not_authorized"));
  });

  it("blocks a private_only batch", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: { reviewState: "approved" as const, publicationPolicy: "private_only" as const },
      candidate: queuedCandidate,
    });

    assert.ok(blockers.includes("source_private_only"));
  });

  it("requires the candidate to be queued for publication first", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: { ...queuedCandidate, publicationState: "review_pending" as const },
    });

    assert.ok(blockers.includes("candidate_not_queued_for_publication"));
  });

  it("honours an accepted suppression request", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: queuedCandidate,
      hasAcceptedSuppressionRequest: true,
    });

    assert.ok(blockers.includes("suppression_request_blocks_publication"));
  });

  it("skips community candidates instead of half-publishing them", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: { ...queuedCandidate, profileType: "community" as const },
    });

    assert.ok(blockers.includes("candidate_profile_type_unsupported"));
  });

  it("bulk-accepts only unreviewed fields, never undoing a review decision", () => {
    assert.equal(canBulkAcceptSeedImportField("unreviewed"), true);
    assert.equal(canBulkAcceptSeedImportField("rejected"), false);
    assert.equal(canBulkAcceptSeedImportField("needs_correction"), false);
    assert.equal(canBulkAcceptSeedImportField("accepted"), false);
  });

  it("bulk-accepts only unreviewed candidates, never undoing a review decision", () => {
    assert.equal(canBulkAcceptSeedImportCandidate("unreviewed"), true);
    assert.equal(canBulkAcceptSeedImportCandidate("rejected"), false);
    assert.equal(canBulkAcceptSeedImportCandidate("needs_correction"), false);
    assert.equal(canBulkAcceptSeedImportCandidate("accepted"), false);
  });

  it("bulk-approves only pre-decision batch states", () => {
    assert.equal(canBulkApproveSeedImportBatch("draft"), true);
    assert.equal(canBulkApproveSeedImportBatch("ready_for_review"), true);
    assert.equal(canBulkApproveSeedImportBatch("approved"), true);
    assert.equal(canBulkApproveSeedImportBatch("rejected"), false);
    assert.equal(canBulkApproveSeedImportBatch("superseded"), false);
  });

  it("rechecks matched-profile surfacing at publish time", () => {
    for (const publicSurfacingState of ["opted_out", "suppressed"] as const) {
      const blockers = getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: { ...queuedCandidate, matchedProfileId: "profile_matched" as Id<"profiles"> },
        matchedProfile: {
          _id: "profile_matched" as Id<"profiles">,
          claimState: "unclaimed" as const,
          publicSurfacingState,
          profileType: "person" as const,
        },
      });

      assert.ok(
        blockers.includes("matched_profile_not_publicly_surfaceable"),
        `expected ${publicSurfacingState} to block publication`,
      );
    }
  });

  it("blocks accepted fields that exceed public profile limits", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: queuedCandidate,
      fields: [
        {
          fieldKey: "bio",
          // Valid in private staging, far past the 600-character public limit.
          value: "x".repeat(1_200),
          confidence: "medium" as const,
          reviewState: "accepted" as const,
          visibility: "public" as const,
        },
      ],
    });

    assert.ok(blockers.includes("field_exceeds_public_profile_limits"));

    const aliasBlockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: queuedCandidate,
      fields: [
        {
          fieldKey: "aliases",
          value: Array.from({ length: 20 }, (_, index) => `alias-${index}`),
          confidence: "medium" as const,
          reviewState: "accepted" as const,
          visibility: "public" as const,
        },
      ],
    });

    assert.ok(aliasBlockers.includes("field_exceeds_public_profile_limits"));

    // Within limits, so no blocker.
    assert.deepEqual(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        fields: [
          {
            fieldKey: "bio",
            value: "Short bio",
            confidence: "medium" as const,
            reviewState: "accepted" as const,
            visibility: "public" as const,
          },
        ],
      }),
      [],
    );
  });

  it("blocks a display name outside public profile bounds", () => {
    for (const proposedDisplayName of ["x", "y".repeat(120)]) {
      assert.ok(
        getSeedImportPublishBlockers({
          batch: publishableBatch,
          candidate: { ...queuedCandidate, proposedDisplayName },
        }).includes("display_name_outside_public_limits"),
        `expected "${proposedDisplayName.slice(0, 12)}" to be blocked`,
      );
    }

    assert.deepEqual(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: { ...queuedCandidate, proposedDisplayName: "DJ Example" },
        fields: publishableFields,
      }),
      [],
    );
  });

  it("blocks publication while a live handoff invitation exists", () => {
    assert.ok(
      getSeedImportPublishBlockers({
        batch: publishableBatch,
        candidate: queuedCandidate,
        hasLiveHandoffInvitation: true,
      }).includes("live_handoff_invitation_blocks_publication"),
    );
  });

  it("rechecks field review states at publish time", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: queuedCandidate,
      fields: [
        {
          fieldKey: "bio",
          value: "Reverted after queueing",
          confidence: "low" as const,
          reviewState: "needs_correction" as const,
          visibility: "public" as const,
        },
      ],
    });

    assert.ok(blockers.includes("field_needs_correction"));
  });

  it("blocks publishing a person candidate onto a community profile", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: { ...queuedCandidate, matchedProfileId: "profile_community" as Id<"profiles"> },
      matchedProfile: {
        _id: "profile_community" as Id<"profiles">,
        claimState: "unclaimed" as const,
        publicSurfacingState: "public" as const,
        profileType: "community" as const,
      },
    });

    assert.ok(blockers.includes("matched_profile_type_mismatch"));
  });

  it("blocks publishing over a claimed matched profile", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: publishableBatch,
      candidate: { ...queuedCandidate, matchedProfileId: "profile_claimed" as Id<"profiles"> },
      matchedProfile: {
        _id: "profile_claimed" as Id<"profiles">,
        claimState: "claimed_verified" as const,
        publicSurfacingState: "public" as const,
      },
    });

    assert.ok(blockers.includes("matched_profile_claimed"));
  });
});

describe("seed publish CLI option parsing", () => {
  it("treats a missing or flag-shaped value as absent", () => {
    assert.equal(readOption(["--reason", "Source permits it."], "--reason"), "Source permits it.");
    assert.equal(readOption(["--reason", "--accept-fields", "--apply"], "--reason"), undefined);
    assert.equal(readOption(["--apply", "--reason"], "--reason"), undefined);
    assert.equal(readOption(["--apply"], "--reason"), undefined);
  });

  // Without `--set-visibility` the run is a bulk publication, so
  // `--rederive-values --apply` -- meant to replay values onto profiles that are
  // already live -- would publish every pending candidate in the batch instead.
  // A typo that changes which operation runs is not a typo to absorb.
  it("refuses migration-only flags outside visibility mode", () => {
    assert.equal(
      misplacedMigrationFlag(undefined, { "--rederive-values": true, "--field-keys": false }),
      "--rederive-values",
    );
    assert.equal(
      misplacedMigrationFlag(undefined, { "--rederive-values": false, "--field-keys": true }),
      "--field-keys",
    );

    // `--field-keys` with no value still means the operator asked for it.
    // Reading that as absent let the misplaced form through to a bulk
    // publication, which is the operation this guard exists to keep separate.
    assert.equal(
      misplacedMigrationFlag(undefined, { "--rederive-values": false, "--field-keys": true }),
      "--field-keys",
    );

    // Every value-taking option is refused when its value is missing, because
    // `readOption` cannot tell that from the option being absent and the two mean
    // opposite things. `--set-visibility --apply` read as "no visibility mode"
    // runs a bulk publication instead of a migration.
    for (const name of VALUE_OPTIONS) {
      assert.equal(readOption([name, "--apply"], name), undefined, name);
      assert.equal(readOption([name], name), undefined, name);
    }

    assert.ok(VALUE_OPTIONS.includes("--set-visibility"));
    assert.ok(VALUE_OPTIONS.includes("--field-keys"));

    // In visibility mode both belong, and neither is required.
    assert.equal(
      misplacedMigrationFlag("public", { "--rederive-values": true, "--field-keys": true }),
      undefined,
    );
    assert.equal(
      misplacedMigrationFlag(undefined, { "--rederive-values": false, "--field-keys": false }),
      undefined,
    );
  });
});

describe("seed publish option safety", () => {
  it("refuses a misspelled option instead of running a different operation", () => {
    // The two reported spellings, both of which changed what the run did.
    // `--set-visibilty` leaves the real selector unset, so the run falls past
    // the migration into a bulk publication.
    assert.deepEqual(
      unknownOption(["--batch-id", "b", "--set-visibilty", "public", "--apply"]),
      { name: "--set-visibilty", reason: "unknown" },
    );

    // `--field-key` leaves `--field-keys` absent, which the script reads as
    // every accepted field, so a migration scoped to one key exposes all.
    assert.deepEqual(
      unknownOption(["--set-visibility", "public", "--field-key", "aliases"]),
      { name: "--field-key", reason: "unknown" },
    );
  });

  it("refuses a repeated option rather than silently taking the first", () => {
    assert.deepEqual(
      unknownOption(["--set-visibility", "public", "--set-visibility", "private"]),
      { name: "--set-visibility", reason: "repeated" },
    );
  });

  it("accepts a well-formed run, separator and all", () => {
    assert.equal(
      unknownOption([
        "--",
        "--batch-id",
        "seed_fake_2026_001",
        "--set-visibility",
        "public",
        "--field-keys",
        "aliases",
        "--rederive-values",
        "--apply",
        "--target",
        "prod",
      ]),
      undefined,
    );
  });
});

describe("seed import visibility migration", () => {
  const reviewer = {
    tokenIdentifier: "operator:vrdex",
    issuer: "vrdex",
    subject: "seed-publish",
    displayName: "VRDex operator",
  };

  /**
   * Two candidates merged onto one published profile, each carrying a different
   * accepted field. This is the shape the 405-profile batch actually has, and
   * the one that made the per-profile identity set dangerous: used as a skip it
   * dropped the second candidate's patch, so a run could report success with a
   * field it had been told to hide still public.
   */
  async function seedMergedBatch(t: ReturnType<typeof convexTest>, now: number) {
    return await t.run(async (ctx) => {
      const batchId = await ctx.db.insert("seedImportBatches", {
        externalBatchId: "seed_fake_merge_001",
        sourceName: "Example Partner Directory",
        sourceType: "partner",
        receivedAt: now,
        publicationPolicy: "reviewed_publication_allowed",
        publicationAuthorizations: [
          {
            policy: "reviewed_publication_allowed",
            reason: "Source confirmed public listing is permitted.",
            authorizedAt: now,
          },
        ],
        importedBy: reviewer,
        reviewState: "approved",
        createdAt: now,
        updatedAt: now,
      });

      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "merged-seed-target",
        displayName: "Merged Seed Target",
        sortName: "merged seed target",
        aliases: ["Merged"],
        tags: ["dj"],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "concierge",
        person: { roleTags: [] },
        fieldVisibility: { aliases: "public", tags: "public" },
        updatedAt: now,
      });

      for (const [index, fieldKey] of ["aliases", "tags"].entries()) {
        const candidateId = await ctx.db.insert("seedImportCandidateProfiles", {
          batchId,
          externalCandidateId: `merge-candidate-${index + 1}`,
          profileType: "person",
          proposedDisplayName: "Merged Seed Target",
          reviewState: "accepted",
          publicationState: "published_unclaimed",
          claimState: "unclaimed",
          publishedProfileId: profileId,
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await ctx.db.insert("seedImportCandidateFields", {
          candidateId,
          fieldKey,
          value: fieldKey === "aliases" ? ["Merged"] : ["dj"],
          sourceLabel: "Example Partner Directory",
          sourceType: "partner",
          confidence: "medium",
          reviewState: "accepted",
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        });
      }

      return { batchId, profileId };
    });
  }

  it("applies every candidate's visibility to a profile two of them share", async () => {
    const t = convexTest({ schema, modules });
    const now = 1_788_220_800_000;
    const { batchId, profileId } = await seedMergedBatch(t, now);

    const result = await t.mutation(internal.seedImports.bulkSetFieldVisibility, {
      batchId,
      visibility: "private",
      reason: "Source withdrew permission to list these publicly.",
      reviewer,
      now,
    });

    const profile = await t.run(async (ctx) => await ctx.db.get(profileId));

    // The whole point: the second candidate's field is hidden too. Before the
    // identity set was demoted to counting only, this stayed "public" while the
    // run reported a profile re-derived.
    assert.equal(profile?.fieldVisibility?.aliases, "private");
    assert.equal(profile?.fieldVisibility?.tags, "private");
    // One profile, not one per candidate.
    assert.equal(result.profilesRederived, 1);
    assert.equal(result.fieldsChanged, 2);
  });

  it("predicts that same result without writing it", async () => {
    const t = convexTest({ schema, modules });
    const now = 1_788_220_800_000;
    const { batchId, profileId } = await seedMergedBatch(t, now);

    const result = await t.mutation(internal.seedImports.bulkSetFieldVisibility, {
      batchId,
      visibility: "private",
      reason: "Source withdrew permission to list these publicly.",
      reviewer,
      dryRun: true,
      now,
    });

    const profile = await t.run(async (ctx) => await ctx.db.get(profileId));

    assert.equal(profile?.fieldVisibility?.aliases, "public");
    assert.equal(profile?.fieldVisibility?.tags, "public");
    // The count the runbook promises will match the write.
    assert.equal(result.profilesRederived, 1);
    assert.deepEqual(result.countedProfileIds, [profileId]);
  });
});
