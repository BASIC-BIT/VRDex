import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { requireClaimSession } from "./_claimSession";
import { getProfileBySlug } from "./_profileSlugs";
import { setProfileSurfacing } from "./_profileSurfacing";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

export const ARCHIVE_REASON_MIN_LENGTH = 10;
export const ARCHIVE_REASON_MAX_LENGTH = 500;

export type ProfileArchivalErrorCode =
  | "SUPER_ADMIN_REQUIRED"
  | "PROFILE_NOT_FOUND"
  | "REASON_REQUIRED"
  | "CLAIMED_PROFILE_NEEDS_CONFIRMATION"
  | "NOT_ARCHIVED";

function archivalError(code: ProfileArchivalErrorCode, message: string) {
  // Structured rather than a plain `Error`: Convex redacts plain messages on
  // production deployments, so an operator running this against prod would get
  // one generic string for every distinct refusal.
  return new ConvexError({ code, message });
}

/**
 * Archive a profile, or put an archived one back.
 *
 * Archival is the operator's answer to a row that should not be on the site --
 * a display name that is a pasted URL, a placeholder that is not a person -- as
 * distinct from suppression, which records that somebody asked to be hidden.
 * Both hide the profile; only one of them is a moderation decision about a
 * human, and filing the wrong one puts a fabricated take-down in the audit
 * history.
 *
 * Invisible and reversible, never destructive. The row, its slug and its audit
 * trail all survive: releasing the slug would let a later import take the name
 * and resurrect the identity under a new row, which is the opposite of what
 * archiving it was for.
 *
 * Shared by the signed-in superadmin path and the operator CLI, which differ
 * only in how authority is established -- a `super_admin` grant on one side, a
 * deploy key on the other -- and not at all in what they do.
 */
async function applyProfileArchival(
  ctx: MutationCtx,
  args: {
    slug: string;
    archived: boolean;
    reason: string;
    confirmClaimed?: boolean;
    actor: Doc<"profileAuditEvents">["actor"];
    dryRun?: boolean;
    now: number;
  },
) {
  const reason = args.reason.trim();

  if (reason.length < ARCHIVE_REASON_MIN_LENGTH || reason.length > ARCHIVE_REASON_MAX_LENGTH) {
    throw archivalError(
      "REASON_REQUIRED",
      `A reason of ${ARCHIVE_REASON_MIN_LENGTH} to ${ARCHIVE_REASON_MAX_LENGTH} characters is required.`,
    );
  }

  const profile = await getProfileBySlug(ctx.db, args.slug);

  if (profile === null) {
    throw archivalError("PROFILE_NOT_FOUND", "No profile has that slug.");
  }

  if (args.archived) {
    // Named rather than inferred. A superadmin has complete data authority, so
    // the gate is not permission -- it is that archiving a *claimed* profile
    // takes a page away from the person who answers for it, which is a
    // moderation act wearing a data-quality label. Obvious actions stay one
    // step; this one has to be said out loud.
    if (profile.claimState !== "unclaimed" && args.confirmClaimed !== true) {
      throw archivalError(
        "CLAIMED_PROFILE_NEEDS_CONFIRMATION",
        "This profile is claimed. Re-run with confirmation to archive it anyway.",
      );
    }
  } else if (profile.publicSurfacingState !== "archived") {
    // Unarchiving only ever undoes an archival. A profile sitting at
    // `opted_out` or `suppressed` is hidden because of a request somebody
    // filed, and restoring it here would resolve that request as a side effect,
    // through a path with no reviewer and no record of the decision.
    throw archivalError(
      "NOT_ARCHIVED",
      profile.publicSurfacingState === "public"
        ? "This profile is not archived."
        : `This profile is ${profile.publicSurfacingState}, not archived. Resolve that through suppressions.`,
    );
  }

  const nextState = args.archived ? ("archived" as const) : ("public" as const);

  if (profile.publicSurfacingState === nextState) {
    return {
      slug: profile.slug,
      displayName: profile.displayName,
      publicSurfacingState: profile.publicSurfacingState,
      changed: false as const,
    };
  }

  // Every gate above has run by now, so a dry run answers the questions that
  // actually refuse an apply -- missing slug, claimed profile, wrong current
  // state -- rather than reporting on a path it never walked.
  if (args.dryRun === true) {
    return {
      slug: profile.slug,
      displayName: profile.displayName,
      publicSurfacingState: nextState,
      changed: true as const,
    };
  }

  const reindexKey = await setProfileSurfacing(ctx.db, profile, {
    state: nextState,
    reason,
    now: args.now,
  });

  await ctx.db.insert("profileAuditEvents", {
    profileId: profile._id,
    action: args.archived ? "profile_archived" : "profile_unarchived",
    ...(args.actor === undefined ? {} : { actor: args.actor }),
    sourceType: "moderator",
    note: reason,
    createdAt: args.now,
  });

  // A world's stored search document keeps the profile's display name in its own
  // `searchText` until something rebuilds it, so an archived name stays findable
  // through its world credits without this. Same scheduled scan suppression
  // uses, and it matters in both directions: on unarchive the name has to come
  // back.
  if (reindexKey !== null) {
    await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
      profiles: [reindexKey],
    });
  }

  return {
    slug: profile.slug,
    displayName: profile.displayName,
    publicSurfacingState: nextState,
    changed: true as const,
  };
}

/** The in-app path: authority is the caller's own `super_admin` grant. */
export const setProfileArchived = mutation({
  args: {
    slug: v.string(),
    archived: v.boolean(),
    reason: v.string(),
    confirmClaimed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, subject } = await requireClaimSession(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);

    if (!access.superAdmin) {
      throw archivalError("SUPER_ADMIN_REQUIRED", "Super admin access is required.");
    }

    return await applyProfileArchival(ctx, { ...args, actor: subject, now: Date.now() });
  },
});

/**
 * The operator CLI path.
 *
 * Internal because the deploy key is the authority here, exactly as it is for
 * the seed publication mutations: there is no session to carry a `super_admin`
 * grant. The actor is recorded from what the operator names rather than
 * verified, which is why this one cannot be reached from a browser.
 */
export const setProfileArchivedAsOperator = internalMutation({
  args: {
    slug: v.string(),
    archived: v.boolean(),
    reason: v.string(),
    confirmClaimed: v.optional(v.boolean()),
    actor: authSubjectValidator,
    dryRun: v.optional(v.boolean()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await applyProfileArchival(ctx, { ...args, now: args.now ?? Date.now() });
  },
});
