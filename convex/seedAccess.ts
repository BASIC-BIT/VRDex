import { v } from "convex/values";

import {
  getAccountFeatureAccess,
  requirePrivateSeedLookupAccess,
} from "./_accountFeatures";
import { activeBrowserSessionOrNull } from "./_browserSessionAuthority";
import { query } from "./_generated/server";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import {
  canIncludePrivateSeedCandidate,
  projectSafePrivateSeedField,
  withheldProfileFields,
} from "./_seedAccess";

export const viewerAccess = query({
  args: {},
  handler: async (ctx) => {
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return {
        allowed: false,
        source: "signed_out" as const,
      };
    }
    const { user } = activeSession;

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

    if (searchTerm.length < 1) {
      throw new Error("Private seed lookup requires at least one character.");
    }

    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20), 50));
    // One search with no publication-state filter, rather than one query per
    // state. The two-query version covered draft_private and review_pending
    // only, so a candidate left this lookup at the moment it published: the
    // surface stopped covering a record precisely because it had shipped.
    // Which states a given viewer may see is decided by
    // canIncludePrivateSeedCandidate below, where the grant is known.
    const matches = await ctx.db
      .query("seedImportCandidateProfiles")
      .withSearchIndex("search_proposedDisplayName", (query) =>
        query.search("proposedDisplayName", searchTerm).eq("profileType", "person"),
      )
      .take(limit * 3);
    // The published profile is loaded here, not just for its slug below: the
    // candidate's own `claimState` goes stale, because claim flows patch the
    // profile and never revisit the candidate row.
    const candidatesWithBatches = await Promise.all(
      matches.map(async (candidate) => ({
        batch: await ctx.db.get(candidate.batchId),
        candidate,
        publishedProfile:
          candidate.publishedProfileId === undefined
            ? null
            : await ctx.db.get(candidate.publishedProfileId),
      })),
    );
    const candidates = candidatesWithBatches
      .filter(({ batch, candidate, publishedProfile }) =>
        canIncludePrivateSeedCandidate(
          candidate,
          batch?.publicationPolicy,
          batch?.reviewState,
          access.superAdmin,
          publishedProfile?.claimState,
        ),
      )
      .slice(0, limit);

    return await Promise.all(
      candidates.map(async ({ batch, candidate, publishedProfile }) => {
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
          // Where to go next once a candidate has published. Without it the
          // lookup names a person it can no longer take you to.
          publishedProfileSlug: publishedProfile?.slug,
          fields: projectedFields,
        };
      }),
    );
  },
});

const PROFILE_HISTORY_LIMIT = 20;

/**
 * What a profile holds that its public page does not show, plus its history.
 *
 * The only way to answer that used to be the Convex CLI with a production
 * deploy key -- a credential that can also deploy arbitrary code, spent on a
 * read. This asks the same question through the grant that already governs the
 * private seed lookup.
 *
 * The profile's own owner gets the same view. It is their record, and the edit
 * history is the half of community editing that makes it safe: a claiming owner
 * inherits an attributed history rather than a mystery.
 *
 * Read-only, and null for everyone else including signed-out visitors. It
 * renders on every public profile page, so refusing loudly would put an error in
 * front of ordinary readers.
 */
export const withheldProfileRecord = query({
  args: {
    slug: v.string(),
    profileType: v.optional(v.union(v.literal("person"), v.literal("community"))),
  },
  handler: async (ctx, args) => {
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return null;
    }

    const validation = validateProfileSlug(args.slug);

    if (!validation.ok) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null) {
      return null;
    }

    if (args.profileType !== undefined && profile.profileType !== args.profileType) {
      return null;
    }

    const [access, owns] = await Promise.all([
      getAccountFeatureAccess(ctx.db, activeSession.user._id),
      userOwnsProfile(ctx.db, profile._id, activeSession.user._id),
    ]);

    // `view_private_seed_lookup` is scoped to the private seed lane, and this
    // query answers by slug -- so without the second condition the beta grant
    // would read hidden fields and edit history for any profile whose slug
    // someone guessed, claimed ones included. A direct Convex call is not
    // bounded by the public page this renders on.
    //
    // The narrower grant sees what the seed lookup already shows it: unclaimed
    // records that came from an import and are still publicly listed.
    //
    // The surfacing check is the profile-level equivalent of the lookup keeping
    // `rejected` and `suppressed` candidates to super-admins. Without it, an
    // opted-out or moderation-suppressed imported profile -- withdrawn from
    // public view precisely because someone decided it should not be seen --
    // would still hand its withheld fields and edit history to a beta grant.
    //
    // Super-admins and the profile's own owner are unrestricted.
    const withinSeedGrant =
      profile.claimState === "unclaimed" &&
      profile.creationSource === "import" &&
      canReadProfile("public", profile);

    if (!owns && !access.superAdmin && !(access.canViewPrivateSeedLookup && withinSeedGrant)) {
      return null;
    }

    const history = await ctx.db
      .query("profileAuditEvents")
      .withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profile._id))
      .order("desc")
      .take(PROFILE_HISTORY_LIMIT);

    return {
      slug: profile.slug,
      viewerRole: owns ? ("owner" as const) : ("operator" as const),
      claimState: profile.claimState,
      publicationState: profile.publicationState,
      publicSurfacingState: profile.publicSurfacingState,
      withheldFields: withheldProfileFields(profile),
      history: history.map((event) => ({
        id: event._id,
        action: event.action,
        sourceType: event.sourceType,
        note: event.note,
        createdAt: event.createdAt,
        // The whole point of the record: an edit with no attributable actor is
        // exactly the mystery a claiming owner should not inherit. Not in the
        // public projection -- an editor's identity is not the public's.
        actor: event.actor?.displayName ?? event.actor?.subject,
      })),
    };
  },
});
