import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { checkProfileSlugAvailability, getProfileBySlug } from "./_profileSlugs";
import { createProfileSortName, normalizeProfileInlineText } from "./_profileSubmissions";
import {
  createProfileSearchDocument,
  reindexWorldSearchDocument,
  upsertSearchDocument,
} from "./_searchDocuments";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

const WORLD_RELINK_PAGE_SIZE = 25;

export const IDENTITY_REASON_MIN_LENGTH = 10;
export const IDENTITY_REASON_MAX_LENGTH = 500;
export const PROFILE_DISPLAY_NAME_MIN = 2;
export const PROFILE_DISPLAY_NAME_MAX = 80;

export type ProfileIdentityErrorCode =
  | "PROFILE_NOT_FOUND"
  | "REASON_REQUIRED"
  | "NOTHING_TO_CHANGE"
  | "DISPLAY_NAME_OUT_OF_BOUNDS"
  | "SLUG_UNAVAILABLE"
  | "CLAIMED_PROFILE_NEEDS_CONFIRMATION";

function identityError(code: ProfileIdentityErrorCode, message: string) {
  // Structured rather than a plain `Error`: Convex redacts plain messages on
  // production deployments, so every distinct refusal would reach the operator
  // as one generic string.
  return new ConvexError({ code, message });
}

/**
 * Correct a profile's name, its slug, or both.
 *
 * The gap this fills is narrow and real: an import can write a display name that
 * is a pasted URL, and nothing could fix it. Community editing can rename an
 * unclaimed profile but deliberately refuses `slug` -- a slug is what every link
 * to the page is made of, so it is not the community's to move -- and there is no
 * operator path at all. The choice was archiving a real person over a bad name,
 * or leaving the bad name up.
 *
 * A rename is cheap; a reslug is not, because the slug is denormalized wherever
 * a profile is credited. Everything that stores one is rewritten here rather
 * than left to drift.
 */
export const setProfileIdentityAsOperator = internalMutation({
  args: {
    slug: v.string(),
    displayName: v.optional(v.string()),
    newSlug: v.optional(v.string()),
    reason: v.string(),
    confirmClaimed: v.optional(v.boolean()),
    actor: authSubjectValidator,
    dryRun: v.optional(v.boolean()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const reason = args.reason.trim();

    if (reason.length < IDENTITY_REASON_MIN_LENGTH || reason.length > IDENTITY_REASON_MAX_LENGTH) {
      throw identityError(
        "REASON_REQUIRED",
        `A reason of ${IDENTITY_REASON_MIN_LENGTH} to ${IDENTITY_REASON_MAX_LENGTH} characters is required.`,
      );
    }

    const profile = await getProfileBySlug(ctx.db, args.slug);

    if (profile === null) {
      throw identityError("PROFILE_NOT_FOUND", "No profile has that slug.");
    }

    // Same reasoning as archival: complete data authority, but renaming a page
    // somebody answers for is not an obvious action and has to be said out loud.
    if (profile.claimState !== "unclaimed" && args.confirmClaimed !== true) {
      throw identityError(
        "CLAIMED_PROFILE_NEEDS_CONFIRMATION",
        "This profile is claimed. Re-run with confirmation to change its identity anyway.",
      );
    }

    const displayName =
      args.displayName === undefined
        ? undefined
        : normalizeProfileInlineText(args.displayName);

    if (
      displayName !== undefined &&
      (displayName.length < PROFILE_DISPLAY_NAME_MIN || displayName.length > PROFILE_DISPLAY_NAME_MAX)
    ) {
      throw identityError(
        "DISPLAY_NAME_OUT_OF_BOUNDS",
        `A display name of ${PROFILE_DISPLAY_NAME_MIN} to ${PROFILE_DISPLAY_NAME_MAX} characters is required.`,
      );
    }

    const nextDisplayName = displayName ?? profile.displayName;
    let nextSlug = profile.slug;

    if (args.newSlug !== undefined) {
      // Excluding this profile, so re-running with the slug it already has is a
      // no-op rather than a collision with itself.
      const availability = await checkProfileSlugAvailability(ctx.db, args.newSlug, profile._id);

      if (!availability.available) {
        throw identityError(
          "SLUG_UNAVAILABLE",
          `That slug is ${availability.reason}.`,
        );
      }

      nextSlug = availability.slug;
    }

    const renames = nextDisplayName !== profile.displayName;
    const reslugs = nextSlug !== profile.slug;

    if (!renames && !reslugs) {
      throw identityError("NOTHING_TO_CHANGE", "That profile already has this name and slug.");
    }

    const preview = {
      previousDisplayName: profile.displayName,
      previousSlug: profile.slug,
      displayName: nextDisplayName,
      slug: nextSlug,
      renamed: renames,
      reslugged: reslugs,
    };

    if (args.dryRun === true) {
      return { ...preview, changed: false as const };
    }

    await ctx.db.patch(profile._id, {
      displayName: nextDisplayName,
      // Derived, never supplied: it is the sort key the whole directory orders
      // on, and letting a caller pass one is how it drifts from the name.
      sortName: createProfileSortName(nextDisplayName),
      slug: nextSlug,
      updatedAt: now,
    });

    const updated = await ctx.db.get(profile._id);

    if (updated !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(updated));
    }

    if (reslugs) {
      // The slug is denormalized onto every world credit, in two places: the
      // `worldProfileCredits` rows and the `creatorAttributions` array on the
      // world itself. Leaving either behind orphans the credit -- it stops
      // resolving to the profile and keeps rendering the old name.
      await ctx.scheduler.runAfter(0, internal.profileIdentity.relinkProfileSlugReferences, {
        profileType: profile.profileType,
        previousSlug: profile.slug,
        nextSlug,
      });
    }

    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: reslugs ? "profile_identity_reslugged" : "profile_renamed",
      actor: args.actor,
      sourceType: "moderator",
      note: reason,
      createdAt: now,
    });

    return { ...preview, changed: true as const };
  },
});

/**
 * Move every stored reference to a profile's old slug, in pages.
 *
 * Split out and rescheduled for the same reason the suppression retraction is:
 * a profile credited on many worlds would otherwise push one mutation past a
 * transaction limit, and the rename itself must not be the thing that fails.
 */
export const relinkProfileSlugReferences = internalMutation({
  args: {
    profileType: v.union(v.literal("person"), v.literal("community")),
    previousSlug: v.string(),
    nextSlug: v.string(),
    cursor: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    // Indexed, so the credit rows cost a lookup rather than a scan. Done on the
    // first page only: the index is on the old slug, so once these are moved the
    // query returns nothing on later pages anyway.
    const credits =
      args.cursor === undefined
        ? await ctx.db
            .query("worldProfileCredits")
            .withIndex("by_profileType_profileSlug", (query) =>
              query.eq("profileType", args.profileType).eq("profileSlug", args.previousSlug),
            )
            .collect()
        : [];

    for (const credit of credits) {
      await ctx.db.patch(credit._id, { profileSlug: args.nextSlug, updatedAt: now });
    }

    // Worlds are paged rather than indexed: `creatorAttributions` is an array on
    // the world document, which nothing indexes by contained slug. Same shape as
    // `reindexWorldsCreditingProfile`, which pages worlds for the same reason.
    const worlds = await ctx.db
      .query("worlds")
      .paginate({ cursor: args.cursor ?? null, numItems: WORLD_RELINK_PAGE_SIZE });

    for (const world of worlds.page) {
      const attributions = world.creatorAttributions ?? [];
      const moves = attributions.some(
        (attribution) =>
          attribution.profileSlug === args.previousSlug &&
          attribution.profileType === args.profileType,
      );

      if (!moves) {
        continue;
      }

      await ctx.db.patch(world._id, {
        creatorAttributions: attributions.map((attribution) =>
          attribution.profileSlug === args.previousSlug &&
          attribution.profileType === args.profileType
            ? { ...attribution, profileSlug: args.nextSlug }
            : attribution,
        ),
      });

      const patched = await ctx.db.get(world._id);

      // The stored search text carries the credited profile's name and slug, so
      // a world keeps answering for the old one until something rebuilds it.
      if (patched !== null) {
        await reindexWorldSearchDocument(ctx.db, patched, now);
      }
    }

    if (!worlds.isDone) {
      await ctx.scheduler.runAfter(0, internal.profileIdentity.relinkProfileSlugReferences, {
        ...args,
        cursor: worlds.continueCursor,
        now,
      });
    }

    return { credits: credits.length, isDone: worlds.isDone };
  },
});
