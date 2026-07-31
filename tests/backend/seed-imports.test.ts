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
import { readOption } from "../../scripts/publish-seed-batch.mjs";

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
    assert.deepEqual(new Set(blockers), new Set([
      "source_private_only",
      "publication_not_authorized",
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
});
