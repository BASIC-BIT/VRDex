import { v } from "convex/values";

import { internal } from "./_generated/api";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { createProfileSortName } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument, vocabularyForProfile } from "./_searchDocuments";
import { buildConciergeProfileFieldPatch, isLiveHandoffInvitation } from "./_seedHandoffs";
import { hasAcceptedSuppression } from "./_suppressions";
import { recordVocabularyTerms } from "./_vocabulary";
import {
  FAKE_SEED_IMPORT_FIXTURE_KEY,
  FAKE_SEED_IMPORT_FIXTURES,
  canBulkAcceptSeedImportCandidate,
  canBulkAcceptSeedImportField,
  canBulkApproveSeedImportBatch,
  candidatePublicationStateForReviewState,
  createSeedImportCandidateDocuments,
  createSeedImportDocuments,
  createSeedImportDocumentsFromFixture,
  getSeedImportPublicationBlockers,
  getSeedImportPublishBlockers,
  normalizePermissionedSeedImport,
  normalizeSeedImportFixture,
  seedImportCandidateFingerprint,
} from "./_seedImports";
import {
  seedImportAuthSubjectValidator,
  seedImportBatchReviewStateValidator,
  seedImportCandidateReviewStateValidator,
  seedImportFieldReviewStateValidator,
  seedImportPublicationPolicyValidator,
} from "./_seedImportValidators";
import {
  createProfileSlugBase,
  findAvailableProfileSlug,
  getProfileBySlug,
  validateProfileSlug,
} from "./_profileSlugs";

const reviewNoteValidator = v.optional(v.string());

const PREVIEW_FIELD_SAMPLE_CANDIDATES = 50;
// ponytail: conservative because --accept-fields patches every field of every
// candidate in a page, then both gates rescan them, and publication does a
// vocabulary lookup and write per list value. Split field acceptance and
// vocabulary recording into separately paged mutations if larger pages are needed.
const BULK_PUBLISH_MAX_PAGE_SIZE = 10;
const PREVIEW_CANDIDATE_READ_CAP = 2_000;

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalReviewNote(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized ? normalized.slice(0, 1_000) : undefined;
}

/**
 * Append an audit line to a batch's notes rather than replacing them.
 *
 * Source notes recorded at import time and earlier review context are exactly
 * the provenance that matters when a batch is relaxed for publication, so a
 * policy record must not overwrite them. Oldest entries are dropped first if the
 * combined note would exceed the stored limit.
 */
function appendBatchNote(existing: string | undefined, entry: string): string | undefined {
  const normalizedEntry = optionalReviewNote(entry);

  if (normalizedEntry === undefined) {
    return existing;
  }

  const combined = existing === undefined ? normalizedEntry : `${existing}\n${normalizedEntry}`;

  return combined.length <= 4_000 ? combined : combined.slice(combined.length - 4_000);
}

/**
 * Append a publication-authorization record.
 *
 * Append-only rather than write-once: a batch can be revoked to `private_only` and
 * later reauthorized with a new reason, and each authorization needs its own
 * durable record. Kept out of `notes`, which any later `setBatchReviewState` call
 * can replace and which `appendBatchNote` trims oldest-first.
 */
function publicationAuthorizationPatch(
  batch: Doc<"seedImportBatches">,
  reason: string,
  actor: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string } | undefined,
  now: number,
) {
  const existing = batch.publicationAuthorizations ?? [];
  const latest = existing[existing.length - 1];

  // Skip an exact repeat, so paging a bulk run does not append the same record
  // once per page.
  if (latest !== undefined && latest.reason === reason && latest.authorizedAt === now) {
    return {};
  }

  return {
    publicationAuthorizations: [
      ...existing,
      {
        reason,
        ...optionalValue("authorizedBy", actor),
        authorizedAt: now,
      },
    ],
  };
}

async function actorFromArgs(
  ctx: MutationCtx,
  actor: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string } | undefined,
) {
  if (actor !== undefined) {
    return actor;
  }

  return (await activeBrowserSessionSubjectOrNull(ctx))?.subject;
}

/**
 * Whether a live concierge handoff invitation is outstanding for this candidate.
 *
 * Publishing while someone holds a private review link would break the promise
 * that invitation was sent under, and queueing also moves the candidate out of the
 * states `previewInvitation` and `acceptInvitation` accept, invalidating the link.
 */
/**
 * The manual publication path writes public data, so it enforces the same
 * operator-identity contract as bulkPublishBatch rather than trusting a CLI
 * wrapper to supply one.
 */
function requireOperatorIdentity<T>(actor: T | undefined, action: string): T {
  if (actor === undefined) {
    throw new Error(
      `${action} requires an operator identity. Pass an actor when calling outside a browser session.`,
    );
  }

  return actor;
}

async function hasLiveHandoffInvitation(
  ctx: Pick<QueryCtx, "db">,
  candidateId: Id<"seedImportCandidateProfiles">,
  matchedProfileId: Id<"profiles"> | undefined,
  now: number,
) {
  const invitations = await ctx.db
    .query("seedHandoffInvitations")
    .withIndex("by_candidateId_state", (query) =>
      query.eq("candidateId", candidateId).eq("state", "active"),
    )
    .collect();

  if (invitations.some((invitation) => isLiveHandoffInvitation(invitation, now))) {
    return true;
  }

  // Also by matched profile: several candidates may reference the same prepared
  // profile, so publishing one would expose another candidate's private handoff
  // destination and break its still-live invitation on acceptance.
  if (matchedProfileId === undefined) {
    return false;
  }

  const profileInvitations = await ctx.db
    .query("seedHandoffInvitations")
    .withIndex("by_profileId_state", (query) =>
      query.eq("profileId", matchedProfileId).eq("state", "active"),
    )
    .collect();

  return profileInvitations.some((invitation) => isLiveHandoffInvitation(invitation, now));
}

async function getCandidateFields(ctx: Pick<QueryCtx, "db">, candidateId: Id<"seedImportCandidateProfiles">) {
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

    requireUnpublishedCandidate(candidate);

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

/**
 * Review state is immutable once a candidate has published.
 *
 * Re-running publication cannot reconcile a review reversal: the copied data is
 * already on a public profile and the idempotent early return would report
 * success while leaving it there. Withdrawing published data goes through
 * `suppressions:resolveProfileSuppression`, which actually retracts it.
 */
function requireUnpublishedCandidate(
  candidate: Doc<"seedImportCandidateProfiles">,
): void {
  if (candidate.publishedProfileId !== undefined) {
    throw new Error(
      "This candidate has already published. Retract the profile with suppressions:resolveProfileSuppression instead of changing review state.",
    );
  }
}

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

    const fieldCandidate = await ctx.db.get(field.candidateId);

    if (fieldCandidate !== null) {
      requireUnpublishedCandidate(fieldCandidate);
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

    requireUnpublishedCandidate(candidate);

    // Matching is frozen while an invitation is live. An invitation created before
    // the match carries no profileId, so repointing the candidate afterwards leaves
    // the by_profileId index unable to see it: publishing another candidate into the
    // same profile would expose this one's private destination, and acceptance would
    // then fail because the invitation's profile no longer matches its candidate.
    // Only this candidate's own invitations. Including the matched profile's would
    // stop candidate A unmatching from a profile whose invitation belongs to
    // candidate B, even though unmatching removes that conflict rather than
    // creating one. The profile-indexed check stays at the publication gates.
    if (await hasLiveHandoffInvitation(ctx, candidate._id, undefined, args.now ?? Date.now())) {
      throw new Error(
        "This candidate has a live handoff invitation. Revoke it with seedHandoffs:revokeInvitation before changing its match.",
      );
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
      matchedProfileId: args.matchedProfileId,
      ...optionalValue("reviewer", reviewer),
      reviewedAt: now,
      ...optionalValue("reviewNote", optionalReviewNote(args.reviewNote)),
      updatedAt: now,
    });

    return { candidateId: candidate._id, matchedProfileId: args.matchedProfileId };
  },
});

type QueueCandidateArgs = {
  candidateId: Id<"seedImportCandidateProfiles">;
  reviewer?: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string };
  reviewNote?: string;
  now?: number;
  /** Pre-loaded accepted suppression requests, so a bulk page reads them once. */
  acceptedRequests?: Doc<"profileSuppressionRequests">[];
};

async function queueCandidate(ctx: MutationCtx, args: QueueCandidateArgs) {
  {
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
    const [fields, matchedProfile] = await Promise.all([
      getCandidateFields(ctx, candidate._id),
      candidate.matchedProfileId === undefined ? Promise.resolve(null) : ctx.db.get(candidate.matchedProfileId),
    ]);
    // Same base builder the allocator uses, so reserved or too-short names that
    // findAvailableProfileSlug repairs are checked here too.
    const collisionSlug = validProposedSlug ?? createProfileSlugBase(candidate.proposedDisplayName);
    const slugCollisionProfile = await getProfileBySlug(ctx.db, collisionSlug);
    // The shared identity-aware check, not a slug-only lookup. A slug-only hit
    // would reject the legitimate current owner of a slug that some older
    // name-only request happened to record.
    const suppressed = await hasAcceptedSuppression(ctx.db, {
      ...optionalValue("profileId", matchedProfile?._id),
      slug: collisionSlug,
      displayNames: [
        candidate.proposedDisplayName,
        ...(matchedProfile === null ? [] : [matchedProfile.displayName]),
      ],
      profileType: candidate.profileType,
      ...optionalValue("acceptedRequests", args.acceptedRequests),
    });
    const blockers = getSeedImportPublicationBlockers({
      batch,
      candidate,
      fields,
      matchedProfile,
      slugCollisionProfile,
      hasInvalidProposedSlug: proposedSlugValidation !== undefined && !proposedSlugValidation.ok,
      hasAcceptedSuppressionRequest: suppressed,
      hasLiveHandoffInvitation: await hasLiveHandoffInvitation(
        ctx,
        candidate._id,
        candidate.matchedProfileId,
        args.now ?? Date.now(),
      ),
    });

    if (blockers.length > 0) {
      return {
        queued: false as const,
        blockers,
      };
    }

    const now = args.now ?? Date.now();
    const reviewer = requireOperatorIdentity(
      await actorFromArgs(ctx, args.reviewer),
      "Queueing a seed import candidate for publication",
    );

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
  }
}

export const queueCandidatePublication = internalMutation({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => await queueCandidate(ctx, args),
});

/**
 * Relax or restore a batch's publication policy.
 *
 * `private_only` batches are blocked from publication by
 * `getSeedImportPublicationBlockers`. Relaxing a batch to
 * `reviewed_publication_allowed` is an explicit operator decision that the
 * source permits public listing, so a reason note is required and recorded on
 * the batch. Restoring `private_only` re-blocks future publication but does not
 * retract profiles already published from the batch.
 */
export const setBatchPublicationPolicy = internalMutation({
  args: {
    batchId: v.id("seedImportBatches"),
    publicationPolicy: seedImportPublicationPolicyValidator,
    reviewer: v.optional(seedImportAuthSubjectValidator),
    reviewNote: reviewNoteValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);

    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    const reason = optionalReviewNote(args.reviewNote);

    if (args.publicationPolicy === "reviewed_publication_allowed" && reason === undefined) {
      throw new Error(
        "Relaxing a seed import batch to reviewed_publication_allowed requires a reviewNote recording the source permission.",
      );
    }

    const now = args.now ?? Date.now();
    const reviewer = requireOperatorIdentity(
      await actorFromArgs(ctx, args.reviewer),
      "Changing a seed import batch publication policy",
    );
    const previousPolicy = batch.publicationPolicy ?? "private_only";

    await ctx.db.patch(batch._id, {
      publicationPolicy: args.publicationPolicy,
      ...(args.publicationPolicy === "reviewed_publication_allowed" && reason !== undefined
        ? publicationAuthorizationPatch(batch, reason, reviewer, now)
        : {}),
      ...optionalValue(
        "notes",
        reason === undefined
          ? undefined
          : appendBatchNote(
              batch.notes,
              `Publication policy ${previousPolicy} -> ${args.publicationPolicy} by ${
                reviewer?.displayName ?? reviewer?.subject ?? "unknown operator"
              }: ${reason}`,
            ),
      ),
      updatedAt: now,
    });

    return {
      batchId: batch._id,
      previousPolicy,
      publicationPolicy: args.publicationPolicy,
    };
  },
});

/**
 * Publish a queued candidate as a public unclaimed profile.
 *
 * `queueCandidatePublication` only marks intent; this mutation is what actually
 * creates or promotes the profile, indexes it for search, and records the link
 * back on the candidate. It re-checks every gate at publish time because policy,
 * review state, and suppression requests can all change after queueing.
 *
 * Returns `published: false` with blockers instead of throwing so a bulk
 * publish run can skip ineligible candidates and continue.
 */
type PublishCandidateArgs = {
  candidateId: Id<"seedImportCandidateProfiles">;
  reviewer?: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string };
  now?: number;
  /** Pre-loaded accepted suppression requests, so a bulk page reads them once. */
  acceptedRequests?: Doc<"profileSuppressionRequests">[];
};

async function publishCandidate(ctx: MutationCtx, args: PublishCandidateArgs) {
  {
    const candidate = await ctx.db.get(args.candidateId);

    if (candidate === null) {
      throw new Error("Seed import candidate not found.");
    }

    const batch = await ctx.db.get(candidate.batchId);

    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    // Already published: return the existing profile rather than creating a duplicate.
    if (candidate.publishedProfileId !== undefined) {
      const published = await ctx.db.get(candidate.publishedProfileId);

      if (published !== null) {
        return {
          published: true as const,
          alreadyPublished: true as const,
          candidateId: candidate._id,
          profileId: published._id,
          slug: published.slug,
        };
      }
    }

    const proposedSlugValidation =
      candidate.proposedSlug === undefined ? undefined : validateProfileSlug(candidate.proposedSlug);
    const validProposedSlug =
      proposedSlugValidation !== undefined && proposedSlugValidation.ok
        ? proposedSlugValidation.slug
        : undefined;
    const matchedProfile =
      candidate.matchedProfileId === undefined ? null : await ctx.db.get(candidate.matchedProfileId);
    // Collision is checked on the derived base slug too, not just an explicit
    // proposedSlug. Otherwise a candidate with no slug whose name normalizes onto
    // an existing profile silently allocates a suffixed slug and creates a second
    // public profile for the same person instead of asking the operator to match.
    // Built with createProfileSlugBase, the same function findAvailableProfileSlug
    // allocates from. toProfileSlug errors on reserved, too-short, or empty names
    // that the allocator repairs, so using it here would skip the collision check
    // for exactly those repaired names.
    const collisionSlug = validProposedSlug ?? createProfileSlugBase(candidate.proposedDisplayName);
    const slugCollisionProfile =
      collisionSlug === undefined ? null : await getProfileBySlug(ctx.db, collisionSlug);
    const targetSlug =
      matchedProfile?.slug ??
      (await findAvailableProfileSlug(ctx.db, validProposedSlug ?? candidate.proposedDisplayName));
    const suppressed = await hasAcceptedSuppression(ctx.db, {
      ...optionalValue("profileId", matchedProfile?._id),
      slug: targetSlug,
      // Both names: a name-only pre-claim request may name the existing profile
      // rather than whatever the candidate proposes to call it.
      displayNames: [
        candidate.proposedDisplayName,
        ...(matchedProfile === null ? [] : [matchedProfile.displayName]),
      ],
      profileType: candidate.profileType,
      ...optionalValue("acceptedRequests", args.acceptedRequests),
    });

    const publisher = requireOperatorIdentity(
      await actorFromArgs(ctx, args.reviewer),
      "Publishing a seed import candidate",
    );

    // Fields are loaded before the gate so publish-time field review states are
    // re-checked. Filtering to accepted alone would silently drop a field moved
    // back to needs_correction and publish the profile anyway.
    const fields = await getCandidateFields(ctx, candidate._id);

    const blockers = getSeedImportPublishBlockers({
      batch,
      candidate,
      fields,
      matchedProfile,
      slugCollisionProfile,
      hasInvalidProposedSlug: proposedSlugValidation !== undefined && !proposedSlugValidation.ok,
      hasAcceptedSuppressionRequest: suppressed,
      // Rechecked here: an invitation can be created between queueing and publish.
      hasLiveHandoffInvitation: await hasLiveHandoffInvitation(
        ctx,
        candidate._id,
        candidate.matchedProfileId,
        args.now ?? Date.now(),
      ),
    });

    if (blockers.length > 0) {
      return { published: false as const, blockers };
    }

    const now = args.now ?? Date.now();
    const acceptedFields = fields.filter((field) => field.reviewState === "accepted");

    // Publication keeps each field's reviewed visibility and never clears fields
    // the candidate did not propose. The concierge defaults do the opposite:
    // everything private, and the accepted selection replaces the whole profile.
    const publishFieldPatchOptions = {
      fieldVisibilitySource: "reviewed" as const,
      clearUnselectedFields: false,
      sourceType: batch.sourceType,
    };

    const publicSurfacing = {
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      publicSurfacingUpdatedAt: now,
    };

    let profileId: Id<"profiles">;

    if (matchedProfile !== null) {
      const existingPerson = matchedProfile as Extract<Doc<"profiles">, { profileType: "person" }>;

      await ctx.db.patch(matchedProfile._id, {
        ...buildConciergeProfileFieldPatch(acceptedFields, existingPerson, publishFieldPatchOptions),
        ...publicSurfacing,
        // Preserve the original first-publication timestamp on a merge.
        publishedAt: matchedProfile.publishedAt ?? now,
        publicSurfacingReason: undefined,
        updatedAt: now,
      });
      profileId = matchedProfile._id;
    } else {
      const fieldPatch = buildConciergeProfileFieldPatch(
        acceptedFields,
        undefined,
        publishFieldPatchOptions,
      );

      profileId = await ctx.db.insert("profiles", {
        ...fieldPatch,
        slug: targetSlug,
        displayName: candidate.proposedDisplayName,
        sortName: createProfileSortName(candidate.proposedDisplayName),
        aliases: fieldPatch.aliases ?? [],
        tags: fieldPatch.tags ?? [],
        outboundLinks: fieldPatch.outboundLinks ?? [],
        claimState: "unclaimed",
        ...publicSurfacing,
        publishedAt: now,
        creationSource: "import",
        profileType: "person",
        person: fieldPatch.person ?? { roleTags: [] },
        // No sourceAttribution: toPublicProfile renders any profile carrying it
        // as "Community submitted", which would be false provenance for an
        // operator import. creationSource already records that it came from one.
        updatedAt: now,
      });
    }

    const profile = await ctx.db.get(profileId);

    if (profile === null) {
      throw new Error("Unable to load published profile.");
    }

    await Promise.all([
      upsertSearchDocument(ctx.db, createProfileSearchDocument(profile)),
      recordVocabularyTerms(ctx.db, vocabularyForProfile(profile), now),
    ]);

    await ctx.db.patch(candidate._id, {
      publishedProfileId: profileId,
      publishedAt: now,
      publishedBy: publisher,
      matchedProfileId: profileId,
      updatedAt: now,
    });

    return {
      published: true as const,
      alreadyPublished: false as const,
      candidateId: candidate._id,
      profileId,
      slug: profile.slug,
      // Returned rather than scheduled here so a bulk page can coalesce every
      // published profile into a single worlds scan. A world crediting this slug
      // hid the attribution while the profile was not publicly readable.
      reindexKey: { profileType: profile.profileType, profileSlug: profile.slug },
    };
  }
}

export const publishQueuedCandidate = internalMutation({
  args: {
    candidateId: v.id("seedImportCandidateProfiles"),
    reviewer: v.optional(seedImportAuthSubjectValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await publishCandidate(ctx, args);

    if (result.published && result.alreadyPublished === false && result.reindexKey !== undefined) {
      await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
        profiles: [result.reindexKey],
      });
    }

    return result;
  },
});

async function resolveBatch(
  ctx: Pick<QueryCtx, "db">,
  args: { batchId?: Id<"seedImportBatches">; externalBatchId?: string },
) {
  if (args.batchId !== undefined) {
    return await ctx.db.get(args.batchId);
  }

  if (args.externalBatchId === undefined) {
    throw new Error("Provide either batchId or externalBatchId.");
  }

  return await ctx.db
    .query("seedImportBatches")
    .withIndex("by_externalBatchId", (query) =>
      query.eq("externalBatchId", args.externalBatchId as string),
    )
    .unique();
}

/**
 * Read-only publication preview for a whole batch.
 *
 * Counts only. Never returns candidate names, field values, or source rows, so
 * it is safe to run against production from an operator terminal.
 */
export const previewBatchPublication = internalQuery({
  args: {
    batchId: v.optional(v.id("seedImportBatches")),
    externalBatchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = await resolveBatch(ctx, args);

    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    // Both reads are capped. An import may carry thousands of candidates with tens
    // of fields each, and a preview that blows the query's read limit would block
    // publishing rather than inform it.
    const candidateRows = await ctx.db
      .query("seedImportCandidateProfiles")
      .withIndex("by_batchId", (query) => query.eq("batchId", batch._id))
      .take(PREVIEW_CANDIDATE_READ_CAP + 1);

    const truncated = candidateRows.length > PREVIEW_CANDIDATE_READ_CAP;
    const candidates = truncated ? candidateRows.slice(0, PREVIEW_CANDIDATE_READ_CAP) : candidateRows;

    const tally = (values: string[]) =>
      values.reduce<Record<string, number>>((counts, value) => {
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
      }, {});

    // Field stats need one query per candidate, so they are sampled.
    const fieldStatsSampleSize = Math.min(candidates.length, PREVIEW_FIELD_SAMPLE_CANDIDATES);
    const fieldReviewStates: string[] = [];

    for (const candidate of candidates.slice(0, fieldStatsSampleSize)) {
      const fields = await getCandidateFields(ctx, candidate._id);
      fieldReviewStates.push(...fields.map((field) => field.reviewState));
    }

    return {
      externalBatchId: batch.externalBatchId,
      sourceName: batch.sourceName,
      batchReviewState: batch.reviewState,
      publicationPolicy: batch.publicationPolicy ?? "private_only",
      candidateCount: candidates.length,
      candidateCountComplete: !truncated,
      candidateReviewStates: tally(candidates.map((candidate) => candidate.reviewState)),
      candidatePublicationStates: tally(candidates.map((candidate) => candidate.publicationState)),
      candidateProfileTypes: tally(candidates.map((candidate) => candidate.profileType)),
      alreadyPublishedCount: candidates.filter(
        (candidate) => candidate.publishedProfileId !== undefined,
      ).length,
      fieldStatsSampledCandidates: fieldStatsSampleSize,
      fieldStatsComplete: fieldStatsSampleSize === candidates.length,
      fieldCount: fieldReviewStates.length,
      fieldReviewStates: tally(fieldReviewStates),
    };
  },
});

/**
 * Publish a whole batch in pages.
 *
 * Runs the same per-candidate path as the single-candidate mutations, including
 * the queue-time gate, so bulk publishing cannot skip the field-safety checks
 * (`unsafe_public_field`, `owner_confirmed_field_without_claim`,
 * `field_needs_correction`) that gate a one-off publish.
 *
 * `acceptFields` is the trusted-source shortcut: it accepts candidates and
 * fields that are still `unreviewed`, and deliberately leaves `rejected` and
 * `needs_correction` alone because those record a real review decision.
 *
 * Call repeatedly, passing back `nextCursor`, until `remaining` reaches zero.
 * Paging is cursor-based rather than "first unpublished": a permanently blocked
 * candidate never gets a `publishedProfileId`, so offset paging would re-select
 * the same page forever and never reach the rest of the batch.
 */
export const bulkPublishBatch = internalMutation({
  args: {
    batchId: v.optional(v.id("seedImportBatches")),
    externalBatchId: v.optional(v.string()),
    reason: v.string(),
    acceptFields: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    reviewer: v.optional(seedImportAuthSubjectValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await resolveBatch(ctx, args);

    if (batch === null) {
      throw new Error("Seed import batch not found.");
    }

    const reason = optionalReviewNote(args.reason);

    if (reason === undefined) {
      throw new Error("Bulk publishing requires a reason recording the source permission.");
    }

    const now = args.now ?? Date.now();
    const reviewer = await actorFromArgs(ctx, args.reviewer);

    // Enforced in the backend, not just the CLI wrapper: this mutation approves a
    // batch and publishes public profiles, so it must never record its actions as
    // an unknown operator.
    if (reviewer === undefined) {
      throw new Error(
        "Bulk publishing requires an operator identity. Pass reviewer when calling outside a browser session.",
      );
    }

    // ponytail: capped at 50 because --accept-fields patches every field of every
    // candidate in this page and then rescans them in the queue and publish gates,
    // all in one Convex transaction. Split field acceptance into its own paged
    // mutation if batches ever need larger pages.
    const limit = Math.max(1, Math.min(args.limit ?? 10, BULK_PUBLISH_MAX_PAGE_SIZE));

    // Batch-level prerequisites and the run's audit note. The note is written on
    // the first page of a run (no cursor yet) regardless of whether the
    // prerequisites needed changing, so the required reason is always recorded
    // even when the batch was already approved and relaxed.
    const isFirstPage = args.cursor === undefined;
    const needsPrerequisites =
      batch.reviewState !== "approved" ||
      (batch.publicationPolicy ?? "private_only") !== "reviewed_publication_allowed";

    // Prerequisites are only relaxed on the first page. Restoring private_only or
    // changing the review state mid-run is the kill switch, so a later page stops
    // rather than quietly re-enabling publication. Checked before the explicit-state
    // validation below so a mid-run rejection reports a halt instead of throwing.
    if (!isFirstPage && needsPrerequisites) {
      return {
        externalBatchId: batch.externalBatchId,
        processed: 0,
        published: 0,
        skipped: [] as Array<{ externalCandidateId: string; blockers: string[] }>,
        nextCursor: null,
        isDone: true as const,
        haltedByPolicyChange: true as const,
      };
    }

    if (!canBulkApproveSeedImportBatch(batch.reviewState)) {
      throw new Error(
        `Batch review state "${batch.reviewState}" is an explicit review decision. Move it with seedImports:setBatchReviewState before bulk publishing.`,
      );
    }

    if (isFirstPage) {
      await ctx.db.patch(batch._id, {
        ...publicationAuthorizationPatch(batch, reason, reviewer, now),
        ...(needsPrerequisites
          ? {
              reviewState: "approved" as const,
              publicationPolicy: "reviewed_publication_allowed" as const,
              reviewedBy: reviewer,
              reviewedAt: now,
            }
          : {}),
        ...optionalValue(
          "notes",
          appendBatchNote(
            batch.notes,
            `Bulk publish by ${reviewer?.displayName ?? reviewer?.subject ?? "unknown operator"}: ${reason}`,
          ),
        ),
        updatedAt: now,
      });
    }

    const pageResult = await ctx.db
      .query("seedImportCandidateProfiles")
      .withIndex("by_batchId", (query) => query.eq("batchId", batch._id))
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    const page = pageResult.page.filter(
      (candidate) => candidate.publishedProfileId === undefined,
    );

    // Read once per page rather than once per candidate: the name-based suppression
    // check has no index to use, and this page may hold 50 candidates.
    const acceptedRequests = await ctx.db
      .query("profileSuppressionRequests")
      .withIndex("by_state_createdAt", (query) => query.eq("state", "accepted"))
      .collect();

    let published = 0;
    const skipped: Array<{ externalCandidateId: string; blockers: string[] }> = [];
    const reindexKeys: Array<{
      profileType: Doc<"profiles">["profileType"];
      profileSlug: string;
    }> = [];

    for (const candidate of page) {
      if (args.acceptFields === true) {
        const fields = await getCandidateFields(ctx, candidate._id);

        for (const field of fields) {
          if (canBulkAcceptSeedImportField(field.reviewState)) {
            await ctx.db.patch(field._id, {
              reviewState: "accepted",
              reviewedAt: now,
              ...optionalValue("reviewedBy", reviewer),
              updatedAt: now,
            });
          }
        }
      }

      if (
        args.acceptFields === true &&
        canBulkAcceptSeedImportCandidate(candidate.reviewState)
      ) {
        await ctx.db.patch(candidate._id, {
          reviewState: "accepted",
          publicationState: candidatePublicationStateForReviewState("accepted"),
          ...optionalValue("reviewer", reviewer),
          reviewedAt: now,
          updatedAt: now,
        });
      }

      // A candidate already queued through the manual workflow goes straight to
      // publish; re-queueing it would only return
      // candidate_already_queued_for_publication and strand it.
      if (candidate.publicationState !== "published_unclaimed") {
        // No reviewNote: queueCandidate writes it to the candidate's own
        // reviewNote, so passing the batch-wide reason would destroy per-candidate
        // review context. The reason is recorded on the batch instead.
        const queueResult = await queueCandidate(ctx, {
          candidateId: candidate._id,
          ...optionalValue("reviewer", reviewer),
          acceptedRequests,
          now,
        });

        if (!queueResult.queued) {
          skipped.push({
            externalCandidateId: candidate.externalCandidateId,
            blockers: queueResult.blockers,
          });
          continue;
        }
      }

      const publishResult = await publishCandidate(ctx, {
        candidateId: candidate._id,
        ...optionalValue("reviewer", reviewer),
        acceptedRequests,
        now,
      });

      if (publishResult.published) {
        published += 1;

        if (publishResult.reindexKey !== undefined) {
          reindexKeys.push(publishResult.reindexKey);
        }
      } else {
        skipped.push({
          externalCandidateId: candidate.externalCandidateId,
          blockers: publishResult.blockers,
        });
      }
    }

    // One scan for the whole page rather than one per published profile.
    if (reindexKeys.length > 0) {
      await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
        profiles: reindexKeys,
      });
    }

    return {
      externalBatchId: batch.externalBatchId,
      processed: page.length,
      published,
      skipped,
      nextCursor: pageResult.isDone ? null : pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});
