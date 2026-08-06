import { GenericDatabaseReader } from "convex/server";
import { v } from "convex/values";

import {
  getAccountFeatureAccess,
  requirePrivateSeedLookupAccess,
} from "./_accountFeatures";
import { activeBrowserSessionOrNull } from "./_browserSessionAuthority";
import { DataModel, Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import {
  canIncludePrivateSeedCandidate,
  OPERATOR_LOOKUP_PUBLICATION_STATES,
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

/**
 * How far a single search will read looking for rows the viewer may see.
 *
 * A ceiling on work, not on results: the walk stops as soon as `limit` eligible
 * rows are found, and only a search whose matches are mostly ineligible reaches
 * this. Without it a three-character query against a large rejected batch would
 * read the whole batch.
 */
const LOOKUP_SCAN_LIMIT = 300;

/**
 * Read a search until `limit` rows the viewer may see are collected.
 *
 * Not a fixed window that is filtered afterwards. Eligibility depends on the
 * candidate's batch and on the live profile it published to, neither of which
 * the search index can filter on, so a window sized to the answer holds however
 * many eligible rows happen to fall inside it. For a common name whose first
 * matches all belong to a rejected batch, that was none -- the surface reported
 * "no matches" for a person it holds records for, which is the failure this
 * lookup exists to prevent.
 */
async function takeEligibleCandidates(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchTerm: string,
  // Absent for a super-admin, who sees every state and so searches unfiltered.
  publicationState: (typeof OPERATOR_LOOKUP_PUBLICATION_STATES)[number] | undefined,
  limit: number,
  superAdmin: boolean,
) {
  const eligible = [];
  let scanned = 0;

  for await (const candidate of ctx.db
    .query("seedImportCandidateProfiles")
    .withSearchIndex("search_proposedDisplayName", (query) => {
      const named = query.search("proposedDisplayName", searchTerm).eq("profileType", "person");

      return publicationState === undefined ? named : named.eq("publicationState", publicationState);
    })) {
    if (scanned >= LOOKUP_SCAN_LIMIT) {
      break;
    }

    scanned += 1;
    // The published profile is loaded here, not just for its slug on the way
    // out: the candidate's own `claimState` goes stale, because claim flows
    // patch the profile and never revisit the candidate row.
    const [batch, publishedProfile] = await Promise.all([
      ctx.db.get(candidate.batchId),
      candidate.publishedProfileId === undefined
        ? Promise.resolve(null)
        : ctx.db.get(candidate.publishedProfileId),
    ]);

    if (
      canIncludePrivateSeedCandidate(
        candidate,
        batch?.publicationPolicy,
        batch?.reviewState,
        superAdmin,
        publishedProfile,
      )
    ) {
      eligible.push({ batch, candidate, publishedProfile });

      if (eligible.length >= limit) {
        break;
      }
    }
  }

  return eligible;
}

/**
 * Take from each state's results in turn, so no state is starved by the limit.
 *
 * Concatenating and slicing spends the whole limit on the first list that can
 * fill it. Each state now collects up to `limit` on its own, so a common name
 * with enough `draft_private` matches dropped every reviewed and published row —
 * hiding the published imports this surface was widened to recover, which is the
 * failure it exists to answer rather than a ranking preference.
 *
 * Round-robin rather than a relevance merge: a search index score is not
 * comparable across separate searches, so there is no honest way to rank them
 * against each other. Taking one from each in turn at least says the same thing
 * about every state.
 */
function interleave<T>(lists: T[][], limit: number): T[] {
  const merged: T[] = [];

  for (let index = 0; merged.length < limit; index += 1) {
    let found = false;

    for (const list of lists) {
      if (index >= list.length) {
        continue;
      }

      merged.push(list[index]);
      found = true;

      if (merged.length >= limit) {
        break;
      }
    }

    if (!found) {
      break;
    }
  }

  return merged;
}

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
    // One search per state a viewer may see, rather than one broad search that
    // is then filtered. Filtering afterwards lets states the viewer cannot see
    // consume the whole window: a common name whose first matches are all
    // rejected or suppressed would return nothing, and the surface would look
    // empty rather than filtered.
    //
    // A super-admin sees every state, so a single unfiltered search cannot
    // starve them.
    const candidates = access.superAdmin
      ? await takeEligibleCandidates(ctx, searchTerm, undefined, limit, true)
      : interleave(
          await Promise.all(
            OPERATOR_LOOKUP_PUBLICATION_STATES.map((publicationState) =>
              takeEligibleCandidates(ctx, searchTerm, publicationState, limit, false),
            ),
          ),
          limit,
        );

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
 * Whether the import record behind a live profile is still one the narrower
 * grant may see, judged by the rule the name lookup uses.
 *
 * Runs the profile back to its candidates rather than judging the profile alone,
 * because half the rule lives on the batch: policy revoked to `private_only`,
 * review withdrawn to `rejected` or `superseded`, the candidate itself no longer
 * accepted. None of those touch the published profile, so a surface reading only
 * the profile keeps answering long after the lookup has stopped.
 *
 * Any eligible candidate is enough, which is what the name lookup does -- it
 * returns a row per candidate, so a profile two batches contributed to still
 * appears there on the strength of the live one. Judging only the first row this
 * index happens to return would hide such a profile whenever the withdrawn batch
 * sorted first, which is arbitrary rather than a decision.
 *
 * Read as a stream, stopping at the first eligible row. A fixed `take` was the
 * same mistake in miniature: eight withdrawn candidates ahead of the live one and
 * the profile went missing from this surface while the lookup went on listing it,
 * because the bound was sized to what seemed likely rather than to the question.
 * `LOOKUP_SCAN_LIMIT` still caps the work, and it is the ceiling the name lookup
 * already uses.
 */
async function publishedSeedCandidateIsVisible(
  ctx: { db: GenericDatabaseReader<DataModel> },
  profile: Doc<"profiles">,
): Promise<boolean> {
  let scanned = 0;

  for await (const candidate of ctx.db
    .query("seedImportCandidateProfiles")
    .withIndex("by_publishedProfileId", (query) => query.eq("publishedProfileId", profile._id))) {
    if (scanned >= LOOKUP_SCAN_LIMIT) {
      break;
    }

    scanned += 1;

    const batch = await ctx.db.get(candidate.batchId);

    if (
      canIncludePrivateSeedCandidate(
        candidate,
        batch?.publicationPolicy,
        batch?.reviewState,
        false,
        profile,
      )
    ) {
      return true;
    }
  }

  // Includes the no-candidate case: nothing to check the profile against fails
  // closed rather than falling back to trusting the profile alone.
  return false;
}

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
    // query answers by slug -- so without this the beta grant would read hidden
    // fields and edit history for any profile whose slug someone guessed,
    // claimed ones included. A direct Convex call is not bounded by the public
    // page this renders on.
    //
    // The narrower grant sees exactly what the name lookup shows it, decided by
    // the same predicate over the same rows: the candidate the profile was
    // published from, and that candidate's batch. Checking only the live profile
    // was still the surface reasoning it apart -- a batch rejected or superseded
    // after publication vanishes from `lookupPeople` while the profile stays
    // public, and by-slug reads went on answering. No candidate means nothing to
    // check it against, which fails closed.
    //
    // The candidate is the whole test. `creationSource` used to be checked
    // alongside it and was both redundant and wrong: reaching a candidate whose
    // `publishedProfileId` is this profile already proves it came from the seed
    // lane, and publishing a candidate by *merging* into an existing profile
    // keeps that profile's original `creationSource` -- so a merged seed profile
    // showed up in the name lookup, which asks the candidate, and then refused to
    // open from the link beside it, which asked the profile.
    //
    // Super-admins and the profile's own owner are unrestricted, so this whole
    // lookup is skipped for them.
    const withinSeedGrant =
      !owns &&
      !access.superAdmin &&
      access.canViewPrivateSeedLookup &&
      (await publishedSeedCandidateIsVisible(ctx, profile));

    if (!owns && !access.superAdmin && !withinSeedGrant) {
      return null;
    }

    const history = await ctx.db
      .query("profileAuditEvents")
      .withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profile._id))
      .order("desc")
      .take(PROFILE_HISTORY_LIMIT);

    // Audit notes are written by operators, for operators. A seed visibility
    // migration records the free-form reason one of them typed, and the claim
    // adapter's notes describe internal mechanics -- neither is prose anybody
    // wrote expecting a profile's owner to read it, and a migration reason can
    // carry source and review context that is not the owner's to see. What makes
    // the history worth inheriting is the action, who did it and when, and an
    // owner still gets all three.
    const seesInternalNotes = access.superAdmin || withinSeedGrant;

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
        note: seesInternalNotes ? event.note : undefined,
        createdAt: event.createdAt,
        // The whole point of the record: an edit with no attributable actor is
        // exactly the mystery a claiming owner should not inherit. Not in the
        // public projection -- an editor's identity is not the public's.
        actor: event.actor?.displayName ?? event.actor?.subject,
      })),
    };
  },
});
