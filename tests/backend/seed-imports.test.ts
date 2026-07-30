import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
  normalizeSeedImportFixture,
  type SeedImportFixture,
} from "../../convex/_seedImports";

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
  const approvedBatch = { reviewState: "approved" as const };
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

    assert.deepEqual(new Set(blockers), new Set([
      "batch_not_approved",
      "candidate_not_accepted",
      "candidate_not_pending_publication",
      "field_unreviewed",
      "field_needs_correction",
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

    assert.deepEqual(new Set(blockers), new Set([
      "matched_profile_claimed",
      "matched_profile_not_publicly_surfaceable",
      "suppression_request_blocks_publication",
      "slug_collision_blocks_publication",
    ]));
  });
});

describe("seed import publish guards", () => {
  const publishableBatch = {
    reviewState: "approved" as const,
    publicationPolicy: "reviewed_publication_allowed" as const,
  };
  const queuedCandidate = {
    reviewState: "accepted" as const,
    publicationState: "published_unclaimed" as const,
    claimState: "unclaimed" as const,
    profileType: "person" as const,
    proposedSlug: "dj-example",
  };

  it("allows publishing an approved, accepted, queued person candidate", () => {
    assert.deepEqual(
      getSeedImportPublishBlockers({ batch: publishableBatch, candidate: queuedCandidate }),
      [],
    );
  });

  it("fails closed when the batch has no explicit publication policy", () => {
    const blockers = getSeedImportPublishBlockers({
      batch: { reviewState: "approved" as const },
      candidate: queuedCandidate,
    });

    assert.ok(blockers.includes("source_private_only"));
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
