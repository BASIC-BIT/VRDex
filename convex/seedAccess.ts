import { v } from "convex/values";

import {
  getAccountFeatureAccess,
  requirePrivateSeedLookupAccess,
} from "./_accountFeatures";
import { getCurrentUser } from "./accounts";
import { query } from "./_generated/server";
import {
  canIncludePrivateSeedCandidate,
  projectSafePrivateSeedField,
} from "./_seedAccess";

export const viewerAccess = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return {
        allowed: false,
        source: "signed_out" as const,
      };
    }

    const access = await getAccountFeatureAccess(ctx.db, user._id);
    return {
      allowed: access.canViewPrivateSeedLookup,
      source: access.superAdmin
        ? ("super_admin" as const)
        : access.canViewPrivateSeedLookup
          ? ("feature_grant" as const)
          : ("none" as const),
    };
  },
});

export const lookupPeople = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { access } = await requirePrivateSeedLookupAccess(ctx);
    const searchTerm = args.query.trim().replace(/\s+/g, " ").slice(0, 120);

    if (searchTerm.length < 2) {
      throw new Error("Private seed lookup requires at least two characters.");
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 50));
    const [draftCandidates, reviewCandidates] = await Promise.all([
      ctx.db
        .query("seedImportCandidateProfiles")
        .withSearchIndex("search_proposedDisplayName", (query) =>
          query
            .search("proposedDisplayName", searchTerm)
            .eq("profileType", "person")
            .eq("publicationState", "draft_private"),
        )
        .take(limit * 2),
      ctx.db
        .query("seedImportCandidateProfiles")
        .withSearchIndex("search_proposedDisplayName", (query) =>
          query
            .search("proposedDisplayName", searchTerm)
            .eq("profileType", "person")
            .eq("publicationState", "review_pending"),
        )
        .take(limit * 2),
    ]);
    const candidatesWithBatches = await Promise.all(
      [...draftCandidates, ...reviewCandidates].map(async (candidate) => ({
        batch: await ctx.db.get(candidate.batchId),
        candidate,
      })),
    );
    const candidates = candidatesWithBatches
      .filter(({ batch, candidate }) =>
        canIncludePrivateSeedCandidate(
          candidate,
          batch?.publicationPolicy,
          batch?.reviewState,
          access.superAdmin,
        ),
      )
      .slice(0, limit);

    return await Promise.all(
      candidates.map(async ({ batch, candidate }) => {
        const fields = await ctx.db
          .query("seedImportCandidateFields")
          .withIndex("by_candidateId", (query) =>
            query.eq("candidateId", candidate._id),
          )
          .collect();
        const projectedFields = fields
          .filter((field) =>
            access.superAdmin
              ? field.reviewState !== "rejected"
              : field.reviewState === "accepted",
          )
          .map(projectSafePrivateSeedField)
          .filter((field) => field !== null);

        return {
          id: candidate._id,
          displayName: candidate.proposedDisplayName,
          proposedSlug: candidate.proposedSlug,
          reviewState: candidate.reviewState,
          publicationState: candidate.publicationState,
          reviewedAt: candidate.reviewedAt,
          source:
            batch === null
              ? null
              : {
                  name: batch.sourceName,
                  observedAt: batch.sourceObservedAt,
                },
          fields: projectedFields,
        };
      }),
    );
  },
});
