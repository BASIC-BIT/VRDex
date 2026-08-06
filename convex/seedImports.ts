import { v } from "convex/values";

import { internal } from "./_generated/api";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { createProfileSortName } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument, vocabularyForProfile } from "./_searchDocuments";
import { buildConciergeProfileFieldPatch, isLiveHandoffInvitation } from "./_seedHandoffs";
import { hasAcceptedSuppression, surfacedProfileNames } from "./_suppressions";
import {
  createVocabularyKey,
  recordVocabularyTerms,
  releaseVocabularyTerms,
} from "./_vocabulary";
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
  hasPublicationAuthorization,
  hasSeedFieldContent,
  isPubliclyReadableProfile,
  normalizePermissionedSeedImport,
  normalizeSeedImportFixture,
  seedImportCandidateFingerprint,
} from "./_seedImports";
import {
  seedImportAuthSubjectValidator,
  seedImportBatchReviewStateValidator,
  seedImportCandidateReviewStateValidator,
  seedImportFieldReviewStateValidator,
  seedImportFieldVisibilityValidator,
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

type VocabularyCandidates = ReturnType<typeof vocabularyForProfile>;

function vocabularyKeys(candidates: VocabularyCandidates): Set<string> {
  return new Set(
    candidates.map((candidate) => `${candidate.scope}:${createVocabularyKey(candidate.label ?? "")}`),
  );
}

/**
 * Reindex a profile whose public fields just changed, both directions.
 *
 * `recordVocabularyTerms` only increments, so replaying an unchanged set
 * inflates counts, and replacing a visible tag would leave the old term's count
 * inflated forever while the search document correctly drops it.
 *
 * `before` is what the profile contributed to vocabulary *while publicly
 * readable* — pass an empty list for a profile that was not, or its terms get
 * filtered out of the introduced set and the now-public profile ends up
 * searchable while its facets never reach `vocabularyTerms`.
 */
/**
 * Whether two `fieldVisibility` maps say the same thing.
 *
 * Compared by entry rather than by serialization, because key order is an
 * artefact of how each map was built and would report a difference where there
 * is none -- which is the whole failure this guards against, one level down.
 */
function sameFieldVisibility(
  left: Doc<"profiles">["fieldVisibility"],
  right: Doc<"profiles">["fieldVisibility"],
): boolean {
  const a = Object.entries(left ?? {});
  const b = Object.entries(right ?? {});

  return (
    a.length === b.length &&
    a.every(([key, value]) => (right ?? {})[key as keyof typeof right] === value)
  );
}

async function reindexProfileVocabularyDelta(
  ctx: Pick<MutationCtx, "db">,
  before: VocabularyCandidates,
  profile: Doc<"profiles">,
  now: number,
): Promise<void> {
  // Empty for a profile the public cannot read. `vocabularyForProfile` honours
  // per-field visibility but knows nothing about surfacing state, so re-deriving
  // an opted-out or suppressed profile would otherwise push its tags into the
  // discovery term list while its own search document stayed hidden.
  const after = canReadProfile("public", profile) ? vocabularyForProfile(profile) : [];
  const beforeKeys = vocabularyKeys(before);
  const afterKeys = vocabularyKeys(after);
  const key = (candidate: VocabularyCandidates[number]) =>
    `${candidate.scope}:${createVocabularyKey(candidate.label ?? "")}`;

  // Colliding labels are deduplicated inside the vocabulary helpers, so both
  // sides of the delta can stay a plain filter.
  await Promise.all([
    upsertSearchDocument(ctx.db, createProfileSearchDocument(profile)),
    recordVocabularyTerms(ctx.db, after.filter((candidate) => !beforeKeys.has(key(candidate))), now),
    releaseVocabularyTerms(ctx.db, before.filter((candidate) => !afterKeys.has(key(candidate))), now),
  ]);
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
  policy: "private_only" | "reviewed_publication_allowed",
  reason: string,
  actor: { tokenIdentifier: string; issuer: string; subject: string; displayName?: string } | undefined,
  now: number,
) {
  const existing = batch.publicationAuthorizations ?? [];
  const latest = existing[existing.length - 1];
  const currentPolicy = batch.publicationPolicy ?? "private_only";

  // A no-op when the batch already sits at the requested policy under the same
  // reason. Timestamps cannot identify a retry -- a caller that times out and
  // retries without `now` gets a fresh Date.now() -- so current policy plus the
  // last recorded reason is the signal. Recording revocations as well as
  // authorizations is what makes that comparison correct in both directions: with
  // only authorizations stored, a revocation retry compared its reason against an
  // older authorization and always looked new.
  if (
    currentPolicy === policy &&
    latest !== undefined &&
    latest.reason === reason &&
    (latest.policy ?? "reviewed_publication_allowed") === policy
  ) {
    return {};
  }

  return {
    publicationAuthorizations: [
      ...existing,
      {
        policy,
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

/**
 * Whether a live concierge handoff invitation is outstanding for this candidate.
 *
 * Publishing while someone holds a private review link would break the promise
 * that invitation was sent under, and queueing also moves the candidate out of the
 * states `previewInvitation` and `acceptInvitation` accept, invalidating the link.
 */
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

  // Legacy invitations created before their candidate was matched carry no
  // profileId. Rather than walking every sibling candidate here -- which a
  // duplicate-heavy batch turns into tens of thousands of reads per page --
  // migrations:backfillHandoffInvitationProfileIds fills that field in, so this one
  // indexed lookup is sufficient.
  return profileInvitations.some((invitation) => isLiveHandoffInvitation(invitation, now));
}

/**
 * Public alias names a candidate's accepted fields would put on the profile.
 *
 * Aliases count as identity for suppression: an accepted `aliases` field can carry
 * a suppressed name while the proposed display name is unrelated, and the mapper
 * would copy it onto a public profile and into its search document.
 */
function acceptedAliasNames(fields: Doc<"seedImportCandidateFields">[]): string[] {
  const names: string[] = [];

  for (const field of fields) {
    if (field.fieldKey !== "aliases" || field.reviewState !== "accepted") {
      continue;
    }

    // Reviewed visibility decides, matching surfacedProfileNames for existing
    // profiles: the mapper copies a private alias but the public projection and
    // discovery both omit it, so it is not an identity this publication surfaces.
    if (field.visibility === "private") {
      continue;
    }

    for (const value of Array.isArray(field.value) ? field.value : []) {
      if (typeof value === "string") {
        names.push(value);
      }
    }
  }

  return names;
}

/**
 * Names a merge or create would actually surface.
 *
 * The mapper *overwrites* a profile's alias array when the candidate carries an
 * accepted `aliases` field, so the post-merge identity is the candidate's aliases
 * in that case and the profile's existing ones otherwise. Checking the union would
 * block a merge over an alias the publication is about to replace.
 */
function effectiveSurfacedNames(
  fields: Doc<"seedImportCandidateFields">[],
  matchedProfile: Doc<"profiles"> | null,
  proposedDisplayName: string,
): string[] {
  const replacesAliases = fields.some(
    (field) => field.fieldKey === "aliases" && field.reviewState === "accepted",
  );
  const candidateAliases = acceptedAliasNames(fields);

  if (matchedProfile === null) {
    return [proposedDisplayName, ...candidateAliases];
  }

  const profileNames = surfacedProfileNames(matchedProfile);

  if (!replacesAliases) {
    return profileNames;
  }

  // Display name and searchAliases survive a merge; ordinary aliases do not.
  return [
    matchedProfile.displayName,
    ...(matchedProfile.searchAliases ?? []),
    ...candidateAliases,
  ];
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
        existingBatch.sourceObservedAt !== normalized.sourceObservedAt
      ) {
        throw new Error("Seed import batch metadata does not match the existing batch.");
      }

      // publicationPolicy is deliberately excluded from the metadata comparison
      // above: a batch may have been relaxed for publication since import, and an
      // exact re-import of the same rows should stay idempotent. Adding *new*
      // candidates to an already-authorized batch is still rejected, since those
      // would inherit an authorization they were never reviewed under.
      // Keyed on authorization *history*, not current policy. A batch revoked back
      // to private_only still carries authorization records that describe the
      // contents they approved, and a later reauthorization would publish anything
      // appended in between under records that never covered it.
      const authorizedForPublication = (existingBatch.publicationAuthorizations ?? []).length > 0;

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

      if (authorizedForPublication && candidates.length > 0) {
        throw new Error(
          "This batch is already authorized for publication. Import new candidates as a new batch instead of appending to an authorized one.",
        );
      }

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
      // The effective post-publication identity, not the union of both. A merge
      // keeps the matched profile's slug and display name and writes neither of the
      // candidate's, so checking those would strand a valid merge against an
      // unrelated slug- or name-only request. Accepted aliases are checked either
      // way, since those genuinely are copied onto the profile.
      slugs: matchedProfile === null ? [collisionSlug] : [matchedProfile.slug],
      displayNames: effectiveSurfacedNames(fields, matchedProfile, candidate.proposedDisplayName),
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

    // Required in both directions. A revocation without one changed the policy while
    // appending nothing, so a previously authorized batch's durable history ended on
    // an authorization despite having been revoked.
    if (reason === undefined) {
      throw new Error(
        args.publicationPolicy === "reviewed_publication_allowed"
          ? "Relaxing a seed import batch to reviewed_publication_allowed requires a reviewNote recording the source permission."
          : "Revoking a seed import batch to private_only requires a reviewNote recording why publication was withdrawn.",
      );
    }

    const now = args.now ?? Date.now();
    const reviewer = requireOperatorIdentity(
      await actorFromArgs(ctx, args.reviewer),
      "Changing a seed import batch publication policy",
    );
    const previousPolicy = batch.publicationPolicy ?? "private_only";

    const authorizationPatch =
      reason === undefined
        ? {}
        : publicationAuthorizationPatch(batch, args.publicationPolicy, reason, reviewer, now);
    // The note shares the authorization patch's idempotency signal, so a retry
    // after a lost response does not append a duplicate policy line and trim away
    // earlier source and review context.
    // Both directions share one idempotency signal now that revocations are also
    // recorded, so a repeated call of either kind appends nothing.
    const recordsNewAuthorization = Object.keys(authorizationPatch).length > 0;

    await ctx.db.patch(batch._id, {
      publicationPolicy: args.publicationPolicy,
      ...authorizationPatch,
      ...optionalValue(
        "notes",
        reason === undefined || !recordsNewAuthorization
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
    // Fields are loaded before both the suppression check and the gate: their
    // accepted aliases are part of the identity, and publish-time review states
    // must be re-checked rather than merely filtered.
    const fields = await getCandidateFields(ctx, candidate._id);

    const suppressed = await hasAcceptedSuppression(ctx.db, {
      ...optionalValue("profileId", matchedProfile?._id),
      // Same effective identity as the queue gate: a merge keeps the matched
      // profile's slug and display name, so only a create checks the candidate's.
      slugs:
        matchedProfile === null
          ? [targetSlug, collisionSlug].filter((value): value is string => value !== undefined)
          : [matchedProfile.slug],
      displayNames: effectiveSurfacedNames(fields, matchedProfile, candidate.proposedDisplayName),
      profileType: candidate.profileType,
      ...optionalValue("acceptedRequests", args.acceptedRequests),
    });

    const publisher = requireOperatorIdentity(
      await actorFromArgs(ctx, args.reviewer),
      "Publishing a seed import candidate",
    );

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
    //
    // `linkStats` is threaded here for the same reason the migration threads it:
    // an accepted link whose host no longer matches its provider is dropped by
    // normalization, and a candidate with another visible field publishes anyway.
    // Without this the result said "published" and nothing said a reviewed link
    // had not made it -- a publication path that silently discards data, which is
    // the thing this whole slice exists to stop doing.
    const linkStats = { droppedCount: 0, deduplicatedCount: 0 };
    const publishFieldPatchOptions = {
      fieldVisibilitySource: "reviewed" as const,
      clearUnselectedFields: false,
      sourceType: batch.sourceType,
      linkStats,
    };

    const publicSurfacing = {
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      publicSurfacingUpdatedAt: now,
    };

    let profileId: Id<"profiles">;
    // Only a profile that was already publicly readable has contributed vocabulary.
    // Snapshotting a draft_private match's terms as "before" would filter them out
    // of the introduced set, leaving the now-public profile searchable while its
    // facets never reach vocabularyTerms.
    const matchedProfileWasPublic =
      matchedProfile !== null &&
      matchedProfile.publicationState === "published" &&
      matchedProfile.publicSurfacingState === "public";
    const vocabularyBeforeCandidates =
      matchedProfileWasPublic && matchedProfile !== null
        ? vocabularyForProfile(matchedProfile)
        : [];

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

    await reindexProfileVocabularyDelta(ctx, vocabularyBeforeCandidates, profile, now);

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
      linksDropped: linkStats.droppedCount,
      linksDeduplicated: linkStats.deduplicatedCount,
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

    const acceptedFieldVisibilities: string[] = [];
    let publiclyVisibleFieldCount = 0;
    // Candidates `no_publicly_visible_field` would actually refuse, as opposed to
    // fields that happen to be invisible. The gate exempts a merge into a profile
    // the public can already read, so a batch of those has no visible seed field
    // and publishes anyway -- while the driver, reading the field count alone,
    // told the operator publication was blocked and to run `--set-visibility`.
    // That is the worst shape of wrong answer: one recommending an irreversible
    // privacy change to fix a problem that is not there.
    let blockedOnNoVisibleFieldCount = 0;

    for (const candidate of candidates.slice(0, fieldStatsSampleSize)) {
      const fields = await getCandidateFields(ctx, candidate._id);
      const accepted = fields.filter((field) => field.reviewState === "accepted");
      const matchedProfile =
        candidate.matchedProfileId === undefined
          ? null
          : await ctx.db.get(candidate.matchedProfileId);

      // Only candidates a publication run would actually process.
      // `bulkPublishBatch` filters out rows that already published, so counting
      // them here reported a blocker for work that is finished -- and the driver
      // then recommended `--set-visibility` to unblock a publication that is not
      // pending, which would have made those profiles' private fields public for
      // nothing.
      if (
        candidate.publishedProfileId === undefined &&
        !isPubliclyReadableProfile(matchedProfile) &&
        !accepted.some((field) => field.visibility !== "private" && hasSeedFieldContent(field))
      ) {
        blockedOnNoVisibleFieldCount += 1;
      }

      fieldReviewStates.push(...fields.map((field) => field.reviewState));
      acceptedFieldVisibilities.push(...accepted.map((field) => field.visibility));
      // The same predicate `no_publicly_visible_field` uses, so the preview and
      // the gate cannot disagree. Counting by visibility alone reported content
      // for a public `tags: []` and then refused the batch anyway, which is a
      // dry run that says the opposite of what happens.
      publiclyVisibleFieldCount += accepted.filter(
        (field) => field.visibility !== "private" && hasSeedFieldContent(field),
      ).length;
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
      // Whether the field counters saw the whole batch. Both the candidate list
      // and the per-candidate field sample can stop short, and a reader cannot
      // tell "no candidate is blocked" from "none of the first fifty was" without
      // this -- which is the difference between a reassurance and a guess.
      // `!truncated` as well as the sample size. The candidate list itself stops
      // short on a large batch, so a sample that covered every candidate it was
      // handed still has not seen the batch -- and a reader cannot tell "no
      // candidate is blocked" from "none of the ones we looked at was" without
      // this. That is the difference between a reassurance and a guess.
      fieldStatsComplete: !truncated && fieldStatsSampleSize === candidates.length,
      fieldCount: fieldReviewStates.length,
      fieldReviewStates: tally(fieldReviewStates),
      // What the preview could not say before: "100 fields accepted" reads as
      // content going live, and every one of those fields can still be private.
      // Publication carries the reviewed visibility through, so this is the
      // number that predicts whether anyone will see anything.
      acceptedFieldVisibilities: tally(acceptedFieldVisibilities),
      publiclyVisibleFieldCount,
      blockedOnNoVisibleFieldCount,
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

    // A batch that was authorized and then rolled back -- to private_only, or out
    // of approved -- was stopped deliberately. Auto-restoring either would let a
    // timed-out first-page retry undo the kill switch, so resuming must be an
    // explicit operator action.
    const previouslyAuthorized = (batch.publicationAuthorizations ?? []).length > 0;

    if (
      previouslyAuthorized &&
      (batch.publicationPolicy ?? "private_only") !== "reviewed_publication_allowed"
    ) {
      throw new Error(
        "This batch was revoked to private_only after being authorized. Relax it explicitly with seedImports:setBatchPublicationPolicy before bulk publishing again.",
      );
    }

    if (previouslyAuthorized && batch.reviewState !== "approved") {
      throw new Error(
        `This batch was moved to "${batch.reviewState}" after being authorized. Re-approve it explicitly with seedImports:setBatchReviewState before bulk publishing again.`,
      );
    }

    if (!canBulkApproveSeedImportBatch(batch.reviewState)) {
      throw new Error(
        `Batch review state "${batch.reviewState}" is an explicit review decision. Move it with seedImports:setBatchReviewState before bulk publishing.`,
      );
    }

    if (isFirstPage) {
      const authorizationPatch = publicationAuthorizationPatch(
        batch,
        "reviewed_publication_allowed",
        reason,
        reviewer,
        now,
      );

      await ctx.db.patch(batch._id, {
        ...authorizationPatch,
        ...(needsPrerequisites
          ? {
              reviewState: "approved" as const,
              publicationPolicy: "reviewed_publication_allowed" as const,
              reviewedBy: reviewer,
              reviewedAt: now,
            }
          : {}),
        // Skipped when the authorization patch is a no-op, i.e. the batch already
        // carries this policy and reason. A cursor-less retry after a lost response
        // would otherwise append the note again, and a long reason repeated a few
        // times trims away the source and review context appendBatchNote exists to
        // preserve.
        ...(Object.keys(authorizationPatch).length === 0
          ? {}
          : optionalValue(
              "notes",
              appendBatchNote(
                batch.notes,
                `Bulk publish by ${reviewer?.displayName ?? reviewer?.subject ?? "unknown operator"}: ${reason}`,
              ),
            )),
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
    // Accumulated across the page for the same reason the migration reports them:
    // a link dropped by normalization does not block publication when the
    // candidate has other visible content, so without a count the run says
    // "published 50" and nothing says a reviewed link was discarded on the way.
    let linksDropped = 0;
    let linksDeduplicated = 0;
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
        linksDropped += publishResult.linksDropped ?? 0;
        linksDeduplicated += publishResult.linksDeduplicated ?? 0;

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
      linksDropped,
      linksDeduplicated,
      skipped,
      nextCursor: pageResult.isDone ? null : pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});

/**
 * Change the stored visibility of a batch's fields, and carry it to profiles
 * already published from them.
 *
 * A field's `visibility` is what publication copies onto the profile, so an
 * import that stored everything private publishes profiles that show nothing.
 * The publish gate refuses that now (`no_publicly_visible_field`), but a batch
 * already through it needs both halves fixed: the candidate rows, so the record
 * is right, and the profiles derived from them, so people can actually see it.
 *
 * Re-derivation runs the accepted fields back through the same builder
 * publication uses, which is also what canonicalizes links — a batch published
 * before that existed picks up the fix here rather than needing a second pass.
 *
 * Paged like `bulkPublishBatch`, and `dryRun` reports the same counts without
 * writing, because this changes what the public can see on live profiles.
 */
export const bulkSetFieldVisibility = internalMutation({
  args: {
    batchId: v.optional(v.id("seedImportBatches")),
    externalBatchId: v.optional(v.string()),
    visibility: seedImportFieldVisibilityValidator,
    // Absent means every accepted field. Named keys are the common case: role
    // tags and links go public while a bio stays back.
    fieldKeys: v.optional(v.array(v.string())),
    // Also replay the accepted field *values* onto already-published profiles,
    // not just their visibility. Off by default: these profiles are
    // community-editable, so replaying the import snapshot undoes every
    // correction made since publication.
    rederiveValues: v.optional(v.boolean()),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    /**
     * Profiles earlier pages of this dry run already counted.
     *
     * Only a dry run needs it. An applied run's later page reads the patch the
     * earlier one wrote and skips the profile as already-synchronized; a dry run
     * writes nothing, so without this it re-reads the untouched row and counts
     * the same merged profile once per page. The driver sums those pages, and the
     * total it shows an operator is the one the runbook promises will match the
     * write.
     */
    countedProfileIds: v.optional(v.array(v.id("profiles"))),
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
      throw new Error("Changing field visibility requires a reason recording the decision.");
    }

    const reviewer = await actorFromArgs(ctx, args.reviewer);

    // Same rule as bulk publishing: this changes what the public can see, so it
    // must never be recorded as an unknown operator.
    if (reviewer === undefined) {
      throw new Error(
        "Changing field visibility requires an operator identity. Pass reviewer when calling outside a browser session.",
      );
    }

    const now = args.now ?? Date.now();
    const dryRun = args.dryRun === true;
    const limit = Math.max(1, Math.min(args.limit ?? 10, BULK_PUBLISH_MAX_PAGE_SIZE));
    const fieldKeys = args.fieldKeys === undefined ? undefined : new Set(args.fieldKeys);

    if (fieldKeys?.size === 0) {
      throw new Error("Pass at least one field key, or omit fieldKeys to change every accepted field.");
    }

    // Re-deriving a live profile republishes seed data onto it, so it answers to
    // every lever publishing answers to, not a subset. `bulkPublishBatch` refuses
    // a batch revoked to `private_only`, a batch moved out of `approved`, and a
    // batch nobody recorded permission for -- so honouring only the first two
    // would leave a legacy or fixture batch carrying the relaxed policy by
    // accident able to replay seed values onto live profiles that the publish
    // gate would have refused with `publication_not_authorized`.
    //
    // Candidate rows are still updated either way: setting visibility before a
    // batch is authorized is preparation, and publication is gated separately.
    const canRederive =
      (batch.publicationPolicy ?? "private_only") === "reviewed_publication_allowed" &&
      batch.reviewState === "approved" &&
      hasPublicationAuthorization(batch);
    const note = `Field visibility set to ${args.visibility} by ${reviewer.displayName ?? reviewer.subject}: ${reason}`;

    // Skipped when the note is already the last line. A cursor-less retry after a
    // lost response would otherwise append it again, and appendBatchNote trims
    // oldest-first, so repeats eat the source and review context it exists to keep.
    if (args.cursor === undefined && !dryRun && !(batch.notes ?? "").endsWith(note)) {
      await ctx.db.patch(batch._id, {
        ...optionalValue("notes", appendBatchNote(batch.notes, note)),
        updatedAt: now,
      });
    }

    const pageResult = await ctx.db
      .query("seedImportCandidateProfiles")
      .withIndex("by_batchId", (query) => query.eq("batchId", batch._id))
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    // Read once per page rather than once per candidate, the same as
    // `bulkPublishBatch`. The recheck below is name-based, so it has no index to
    // narrow on and collects the whole accepted history on every call -- a 50
    // candidate page against a few hundred accepted requests multiplies into
    // enough document reads to pass the transaction limit and roll the page back.
    const acceptedRequests = await ctx.db
      .query("profileSuppressionRequests")
      .withIndex("by_state_createdAt", (query) => query.eq("state", "accepted"))
      .collect();

    const linkStats = { droppedCount: 0, deduplicatedCount: 0 };
    /**
     * What this run has already decided each profile's `fieldVisibility` will be.
     *
     * Several candidates can point at one merged profile. An applied run lets the
     * second see the first's patch and skip as already-synchronized; a dry run
     * reads the untouched row every time and counted both. Tracked here so the
     * two agree, which is the only thing that makes a dry run worth running.
     */
    const writtenFieldVisibility = new Map<
      Id<"profiles">,
      Doc<"profiles">["fieldVisibility"]
    >();
    // Seeded from earlier pages of the same dry run. Their exact visibility is
    // not carried -- only that the run has already reported this profile, which
    // is all the count needs. It decides the number and nothing else: a profile
    // in here is still patched, because two candidates on one merged profile
    // contribute different fields, and the second one's are no less real for the
    // first having been counted.
    const countedProfileIds = new Set<Id<"profiles">>(args.countedProfileIds ?? []);
    const skipped: Array<{ externalCandidateId: string; reason: string }> = [];
    let fieldsChanged = 0;
    let profilesRederived = 0;

    for (const candidate of pageResult.page) {
      const fields = await getCandidateFields(ctx, candidate._id);
      const targets = fields.filter(
        (field) =>
          field.reviewState === "accepted" &&
          field.visibility !== args.visibility &&
          (fieldKeys === undefined || fieldKeys.has(field.fieldKey)),
      );

      fieldsChanged += targets.length;

      if (!dryRun) {
        for (const field of targets) {
          await ctx.db.patch(field._id, { visibility: args.visibility, updatedAt: now });
        }
      }

      if (candidate.publishedProfileId === undefined) {
        continue;
      }

      if (!canRederive) {
        skipped.push({
          externalCandidateId: candidate.externalCandidateId,
          reason: "batch_not_authorized",
        });
        continue;
      }

      const profile = await ctx.db.get(candidate.publishedProfileId);

      if (profile === null) {
        continue;
      }

      // A claimed profile is its owner's. Re-deriving it would overwrite whatever
      // they have edited since with the seed snapshot, which is a far worse
      // outcome than a stale visibility flag on the candidate row.
      if (profile.claimState !== "unclaimed") {
        skipped.push({
          externalCandidateId: candidate.externalCandidateId,
          reason: "profile_claimed",
        });
        continue;
      }

      // The field patch builder is person-only, same as publication.
      if (profile.profileType !== "person") {
        skipped.push({
          externalCandidateId: candidate.externalCandidateId,
          reason: "profile_type_unsupported",
        });
        continue;
      }

      // Scoped to `fieldKeys` when one was given. `--field-keys outboundLinks`
      // says which fields this run is about, and feeding the builder every
      // accepted field would replay the whole import snapshot -- overwriting
      // live aliases, tags and roles nobody asked to touch. Narrowing the input
      // narrows both halves: `person` rebuilds from the profile's own value with
      // only the selected seed field applied, so a run targeting role tags
      // leaves pronouns alone.
      const acceptedFields = fields
        .filter(
          (field) =>
            field.reviewState === "accepted" &&
            (fieldKeys === undefined || fieldKeys.has(field.fieldKey)),
        )
        .map((field) =>
          targets.some((target) => target._id === field._id)
            ? { ...field, visibility: args.visibility }
            : field,
        );
      // Nothing selected for this candidate, so there is nothing to carry. A
      // `--field-keys outboundLinks` run over a batch reaches plenty of profiles
      // with no link field at all, and the builder would hand back the profile's
      // own `fieldVisibility` unchanged -- a patch whose only effect is a fresh
      // `updatedAt` and a reindex, counted and reported as a re-derivation. The
      // run would say it had touched every published profile in the batch and
      // mean nothing by it.
      if (acceptedFields.length === 0) {
        continue;
      }

      // Compared and accumulated against what the run has already written to
      // this profile, not only against what the row held when the page was read.
      // Two candidates can publish to one merged profile, and an applied run lets
      // the second see the first's patch -- so a dry run reading the untouched
      // row counted two re-derivations where the write does one. A dry run whose
      // whole job is to predict the write cannot be off by the thing it is
      // predicting.
      const alreadyWritten = writtenFieldVisibility.get(profile._id) ?? profile.fieldVisibility;

      const rebuilt = buildConciergeProfileFieldPatch(
        acceptedFields,
        // Layered onto the visibility this run has accumulated for the profile
        // rather than the row's own. Two candidates merging into one profile
        // contribute different fields, and rebuilding the second from the
        // untouched row drops the first's contribution on a dry run, which has no
        // write to read back.
        { ...profile, fieldVisibility: alreadyWritten },
        {
          fieldVisibilitySource: "reviewed",
          clearUnselectedFields: false,
          sourceType: batch.sourceType,
          linkStats,
        },
      );
      // Visibility only, unless the operator asks for the values too.
      //
      // These profiles are community-editable now, so replaying the whole seed
      // patch would silently undo every correction made since publication --
      // links fixed, tags added, a name spelled right -- and the operator would
      // see only a count of profiles "re-derived". Changing what is visible does
      // not require changing what is there.
      //
      // `rederiveValues` is the one-time pass for a batch published before link
      // canonicalization existed. It overwrites live values with the import
      // snapshot, which is the point and also the risk.
      const patch =
        args.rederiveValues === true
          ? rebuilt
          : { fieldVisibility: rebuilt.fieldVisibility };

      // A visibility-only run that would write the visibility the profile already
      // has is not a re-derivation, and patching it anyway is not free: it bumps
      // `updatedAt`, which is the version every open edit form is holding, so
      // re-running a finished migration would refuse everybody's in-progress save
      // -- while reporting a count of profiles it had updated and had not.
      //
      // Only for the visibility-only path. `--rederive-values` replays values
      // that this cannot compare cheaply, and running it twice is a deliberate
      // act rather than an accident.
      if (
        args.rederiveValues !== true &&
        sameFieldVisibility(rebuilt.fieldVisibility, alreadyWritten)
      ) {
        continue;
      }

      // Suppression is rechecked here, not only at publication. Making an alias
      // public is a way to surface an identity, and it is the one this path has:
      // a profile can be publicly readable *because* the retracted name was
      // private, and `--set-visibility public --field-keys aliases` then puts it
      // on the page and into the search index. Publication asks this question and
      // so does the owner visibility mutation; a migration that changes the same
      // thing has to ask it too.
      //
      // The profile is skipped and reported rather than the run failing: one
      // retracted identity in a batch of 405 must not strand the other 404, and
      // the operator needs to see which it was.
      const surfacedAfterPatch = surfacedProfileNames({
        ...profile,
        ...(patch as Partial<Doc<"profiles">>),
      });

      if (
        canReadProfile("public", profile) &&
        (await hasAcceptedSuppression(ctx.db, {
          slugs: [],
          displayNames: surfacedAfterPatch,
          profileType: profile.profileType,
          acceptedRequests,
        }))
      ) {
        skipped.push({
          externalCandidateId: candidate.externalCandidateId,
          reason: "suppressed_identity_blocks_visibility_change",
        });
        continue;
      }

      // Recorded only once the patch has survived every check, so what the run
      // carries forward is what it accepted. Recording before the suppression
      // check meant a refused candidate still claimed the profile: a later
      // candidate on the same profile built its rebuild on a patch that was
      // never applied, and the profile id it had already taken suppressed the
      // count for whichever patch did go through.
      //
      // Counted once per profile, applied once per candidate. The identity set
      // exists so a profile two candidates contribute to is not reported twice;
      // using it to skip the work as well dropped the second candidate's patch
      // entirely, so `--set-visibility private` could report success while a
      // field it named stayed public on the live profile. Whether this profile
      // has been counted decides the number, never whether the write happens.
      const alreadyCounted = countedProfileIds.has(profile._id);

      writtenFieldVisibility.set(profile._id, rebuilt.fieldVisibility);
      countedProfileIds.add(profile._id);

      if (!alreadyCounted) {
        profilesRederived += 1;
      }

      if (dryRun) {
        continue;
      }

      const vocabularyBefore =
        profile.publicationState === "published" && profile.publicSurfacingState === "public"
          ? vocabularyForProfile(profile)
          : [];

      await ctx.db.patch(profile._id, { ...patch, updatedAt: now });

      // The same row the owner visibility mutation writes, for the same reason:
      // `withheldProfileRecord` builds its History from this table alone, so
      // without it a claiming owner sees that their imported fields were exposed,
      // hidden or replayed and nothing about who did it or why. This path already
      // holds a reviewer identity and a required reason -- it was simply not
      // writing them down, which is the gap the whole record panel exists to
      // close.
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action:
          args.rederiveValues === true
            ? "seed_import_values_rederived"
            : "profile_field_visibility_updated",
        actor: reviewer,
        sourceType: "import",
        note,
        createdAt: now,
      });

      const updated = await ctx.db.get(profile._id);

      if (updated !== null) {
        await reindexProfileVocabularyDelta(ctx, vocabularyBefore, updated, now);
      }
    }

    return {
      externalBatchId: batch.externalBatchId,
      dryRun,
      processed: pageResult.page.length,
      fieldsChanged,
      profilesRederived,
      rederivedValues: args.rederiveValues === true,
      skipped,
      // Links the canonicalizer could not carry, and links that collapsed onto
      // one already present. Reported rather than swallowed: a re-derivation that
      // quietly drops a stream link looks identical to one that carried it.
      // Counted from the rebuilt patch either way, so a visibility-only run still
      // says what a value re-derivation would do.
      linksDropped: linkStats.droppedCount,
      linksDeduplicated: linkStats.deduplicatedCount,
      // Handed back so the next page starts where this one finished, the same as
      // the cursor. Returned on an applied run too, where it costs nothing and
      // keeps the two runs taking identical arguments -- a dry run whose call
      // shape differs from the real one is predicting something else.
      countedProfileIds: [...countedProfileIds],
      nextCursor: pageResult.isDone ? null : pageResult.continueCursor,
      isDone: pageResult.isDone,
    };
  },
});
