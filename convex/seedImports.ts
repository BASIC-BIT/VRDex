import { v } from "convex/values";

import { toAuthSubject } from "./_communityAuthority";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import {
  FAKE_SEED_IMPORT_FIXTURE_KEY,
  FAKE_SEED_IMPORT_FIXTURES,
  candidatePublicationStateForReviewState,
  createSeedImportCandidateDocuments,
  createSeedImportDocuments,
  createSeedImportDocumentsFromFixture,
  getSeedImportPublicationBlockers,
  normalizePermissionedSeedImport,
  normalizeSeedImportFixture,
  seedImportCandidateFingerprint,
} from "./_seedImports";
import {
  seedImportAuthSubjectValidator,
  seedImportBatchReviewStateValidator,
  seedImportCandidateReviewStateValidator,
  seedImportFieldReviewStateValidator,
} from "./_seedImportValidators";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";

const reviewNoteValidator = v.optional(v.string());

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalReviewNote(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized ? normalized.slice(0, 1_000) : undefined;
}

async function actorFromArgs(
  ctx: MutationCtx,
  actor: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string } | undefined,
) {
  if (actor !== undefined) {
    return actor;
  }

  const identity = await ctx.auth.getUserIdentity();

  return identity === null ? undefined : toAuthSubject(identity);
}

async function getCandidateFields(ctx: Pick<MutationCtx, "db">, candidateId: Id<"seedImportCandidateProfiles">) {
  return await ctx.db
    .query("seedImportCandidateFields")
    .withIndex("by_candidateId", (query) => query.eq("candidateId", candidateId))
    .collect();
}

export const importFakeFixtureBatch = internalMutation({
  args: {
    fixtureKey: v.optional(v.string()),
    importedBy: v.optional(seedImportAuthSubjectValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const fixtureKey = args.fixtureKey ?? FAKE_SEED_IMPORT_FIXTURE_KEY;
    const fixture = FAKE_SEED_IMPORT_FIXTURES[fixtureKey];

    if (fixture === undefined) {
      throw new Error("Unknown fake seed import fixture key.");
    }

    const normalized = normalizeSeedImportFixture(fixture);
    const existing = await ctx.db
      .query("seedImportBatches")
      .withIndex("by_externalBatchId", (query) => query.eq("externalBatchId", normalized.externalBatchId))
      .unique();

    if (existing !== null) {
      return {
        inserted: false as const,
        batchId: existing._id,
      };
    }

    const importedBy = await actorFromArgs(ctx, args.importedBy);
    const result = await createSeedImportDocumentsFromFixture(ctx.db, fixture, {
      importedBy,
      now: args.now ?? Date.now(),
    });

    return {
      inserted: true as const,
      ...result,
    };
  },
});

export const importPermissionedJsonBatch = internalMutation({
  args: {
    payload: v.any(),
    importedBy: seedImportAuthSubjectValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizePermissionedSeedImport(args.payload);
    const existing = await ctx.db
      .query("seedImportBatches")
      .withIndex("by_externalBatchId", (query) =>
        query.eq("externalBatchId", normalized.externalBatchId),
      )
      .take(2);

    if (existing.length > 1) {
      throw new Error("Seed import batch id is not unique.");
    }

    const existingBatch = existing[0];
    const now = args.now ?? Date.now();

    if (existingBatch !== undefined) {
      if (
        existingBatch.sourceName !== normalized.sourceName ||
        existingBatch.sourceType !== normalized.sourceType ||
        existingBatch.sourceContact !== normalized.sourceContact ||
        existingBatch.receivedAt !== normalized.receivedAt ||
        existingBatch.sourceObservedAt !== normalized.sourceObservedAt ||
        existingBatch.publicationPolicy !== "private_only"
      ) {
        throw new Error("Seed import batch metadata does not match the existing batch.");
      }

      const existingCandidates = await ctx.db
        .query("seedImportCandidateProfiles")
        .withIndex("by_batchId", (query) => query.eq("batchId", existingBatch._id))
        .collect();
      const existingCandidateIds = new Set(
        existingCandidates.map((candidate) => candidate.externalCandidateId),
      );
      const existingCandidatesById = new Map(
        existingCandidates.map((candidate) => [candidate.externalCandidateId, candidate]),
      );

      for (const candidate of normalized.candidates) {
        const existingCandidate = existingCandidatesById.get(candidate.externalCandidateId);

        if (existingCandidate === undefined) {
          continue;
        }

        const fingerprint = await seedImportCandidateFingerprint(candidate);
        if (
          existingCandidate.importFingerprint === undefined ||
          existingCandidate.importFingerprint !== fingerprint
        ) {
          throw new Error(
            `Seed candidate "${candidate.externalCandidateId}" conflicts with the existing import.`,
          );
        }
      }
      const candidates = normalized.candidates.filter(
        (candidate) => !existingCandidateIds.has(candidate.externalCandidateId),
      );
      const result = await createSeedImportCandidateDocuments(
        ctx.db,
        existingBatch._id,
        candidates,
        now,
      );

      return {
        inserted: candidates.length > 0,
        insertedBatch: false as const,
        batchId: existingBatch._id,
        candidateCount: result.candidateIds.length,
        skippedCandidateCount: normalized.candidates.length - candidates.length,
        fieldCount: result.fieldIds.length,
      };
    }

    const result = await createSeedImportDocuments(ctx.db, normalized, {
      importedBy: args.importedBy,
      now,
    });

    return {
      inserted: true as const,
      insertedBatch: true as const,
      batchId: result.batchId,
      candidateCount: result.candidateIds.length,
      skippedCandidateCount: 0,
      fieldCount: result.fieldIds.length,
    };
  },
});

export const getBatchReviewSnapshot = internalQuery({
  args: {
    batchId: v.id("seedImportBatches"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);

    if (batch === null) {
      return null;
    }

    const candidates = await ctx.db
      .query("seedImportCandidateProfiles")
      .withIndex("by_batchId", (query) => query.eq("batchId", batch._id))
      .collect();
    const candidateFields = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        fields: await ctx.db
          .query("seedImportCandidateFields")
          .withIndex("by_candidateId", (query) => query.eq("candidateId", candidate._id))
          .collect(),
      })),
    );

    return {
      batch,
      candidates: candidateFields,
    };
  },
});

export const listBatchesForReview = internalQuery({
  args: {
    reviewState: v.optional(seedImportBatchReviewStateValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));
    const reviewState = args.reviewState;

    if (reviewState !== undefined) {
      return await ctx.db
        .query("seedImportBatches")
        .withIndex("by_reviewState_receivedAt", (query) => query.eq("reviewState", reviewState))
        .order("desc")
        .take(limit);
    }

    return await ctx.db.query("seedImportBatches").order("desc").take(limit);
  },
});

export const listCandidateFields = internalQuery({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("seedImportCandidateFields")
      .withIndex("by_candidateId", (query) => query.eq("candidateId", args.candidateId))
      .collect();
  },
});

export const setBatchReviewState = internalMutation({
  args: {
    batchId: v.id("seedImportBatches"),
    reviewState: seedImportBatchReviewStateValidator,
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);

    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);
    const reviewed = args.reviewState === "approved" || args.reviewState === "rejected" || args.reviewState === "superseded";

    await ctx.db.patch(batch._id, {
      reviewState: args.reviewState,
      reviewedBy: reviewed ? reviewer : undefined,
      reviewedAt: reviewed ? now : undefined,
      ...optionalValue("notes", optionalReviewNote(args.reviewNote)),
      updatedAt: now,
    });

    return { batchId: batch._id, reviewState: args.reviewState };
  },
});

export const setCandidateReviewState = internalMutation({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
    reviewState: seedImportCandidateReviewStateValidator,
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);

    if (candidate === null) {
      throw new Error("Seed import candidate not found.");
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);
    const reviewed = args.reviewState !== "unreviewed";

    await ctx.db.patch(candidate._id, {
      reviewState: args.reviewState,
      publicationState: candidatePublicationStateForReviewState(args.reviewState),
      reviewer: reviewed ? reviewer : undefined,
      reviewedAt: reviewed ? now : undefined,
      reviewNote: reviewed ? optionalReviewNote(args.reviewNote) : undefined,
      updatedAt: now,
    });

    return {
      candidateId: candidate._id,
      reviewState: args.reviewState,
      publicationState: candidatePublicationStateForReviewState(args.reviewState),
    };
  },
});

export const setCandidateFieldReviewState = internalMutation({
  args: {
    fieldId: v.id("seedImportCandidateFields"),
    reviewState: seedImportFieldReviewStateValidator,
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    lastCheckedAt: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const field = await ctx.db.get(args.fieldId);

    if (field === null) {
      throw new Error("Seed import candidate field not found.");
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);
    const reviewed = args.reviewState !== "unreviewed";

    if (args.lastCheckedAt !== undefined && args.lastCheckedAt > now) {
      throw new Error("Field lastCheckedAt cannot be in the future.");
    }

    await ctx.db.patch(field._id, {
      reviewState: args.reviewState,
      reviewedBy: reviewed ? reviewer : undefined,
      reviewedAt: reviewed ? now : undefined,
      ...optionalValue("lastCheckedAt", args.lastCheckedAt),
      reviewNote: reviewed ? optionalReviewNote(args.reviewNote) : undefined,
      updatedAt: now,
    });

    return { fieldId: field._id, reviewState: args.reviewState };
  },
});

export const matchCandidateToProfile = internalMutation({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
    matchedProfileId: v.optional(v.id("profiles")),
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);

    if (candidate === null) {
      throw new Error("Seed import candidate not found.");
    }

    if (args.matchedProfileId !== undefined) {
      const profile = await ctx.db.get(args.matchedProfileId);

      if (profile === null) {
        throw new Error("Matched profile not found.");
      }
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);

    await ctx.db.patch(candidate._id, {
      ...optionalValue("matchedProfileId", args.matchedProfileId),
      ...optionalValue("reviewer", reviewer),
      reviewedAt: now,
      ...optionalValue("reviewNote", optionalReviewNote(args.reviewNote)),
      updatedAt: now,
    });

    return { candidateId: candidate._id, matchedProfileId: args.matchedProfileId };
  },
});

export const queueCandidatePublication = internalMutation({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);

    if (candidate === null) {
      throw new Error("Seed import candidate not found.");
    }

    const batch = await ctx.db.get(candidate.batchId);
    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    const proposedSlugValidation =
      candidate.proposedSlug === undefined ? undefined : validateProfileSlug(candidate.proposedSlug);
    const validProposedSlug =
      proposedSlugValidation !== undefined && proposedSlugValidation.ok ? proposedSlugValidation.slug : undefined;
    const [fields, matchedProfile, slugCollisionProfile, acceptedSuppressionRequests] = await Promise.all([
      getCandidateFields(ctx, candidate._id),
      candidate.matchedProfileId === undefined ? Promise.resolve(null) : ctx.db.get(candidate.matchedProfileId),
      validProposedSlug === undefined ? Promise.resolve(null) : getProfileBySlug(ctx.db, validProposedSlug),
      validProposedSlug === undefined
        ? Promise.resolve([])
        : ctx.db
            .query("profileSuppressionRequests")
            .withIndex("by_profileSlug_state", (query) =>
              query.eq("profileSlug", validProposedSlug).eq("state", "accepted"),
            )
            .take(1),
    ]);
    const blockers = getSeedImportPublicationBlockers({
      batch,
      candidate,
      fields,
      matchedProfile,
      slugCollisionProfile,
      hasInvalidProposedSlug: proposedSlugValidation !== undefined && !proposedSlugValidation.ok,
      hasAcceptedSuppressionRequest: acceptedSuppressionRequests.length > 0,
    });

    if (blockers.length > 0) {
      return {
        queued: false as const,
        blockers,
      };
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);

    await ctx.db.patch(candidate._id, {
      publicationState: "published_unclaimed",
      ...optionalValue("publicationQueuedBy", reviewer),
      publicationQueuedAt: now,
      ...optionalValue("reviewNote", optionalReviewNote(args.reviewNote)),
      updatedAt: now,
    });

    return {
      queued: true as const,
      candidateId: candidate._id,
      publicationState: "published_unclaimed" as const,
      note: "Publication is queued only; this mutation does not create or update public profiles.",
    };
  },
});
