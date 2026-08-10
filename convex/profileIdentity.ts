import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { checkProfileSlugAvailability, getProfileBySlug } from "./_profileSlugs";
import { isPubliclySurfaced } from "./_profileSurfacing";
import { assertIdentityNotSuppressed, surfacedProfileNames } from "./_suppressions";
import { createProfileSortName, normalizeProfileInlineText } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

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
  | "CLAIMED_PROFILE_NEEDS_CONFIRMATION"
  | "PROFILE_HAS_CREDITED_REFERENCES";

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
 * Scoped to a profile nothing credits. Both the name and the slug are
 * denormalized onto world attributions and event rows, and moving those is a
 * larger job than this -- so it is refused rather than half-applied. Every one of
 * those tables is empty today, which is why the refusal costs nothing and the
 * machinery would have been written against no rows at all.
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

    // A profile's name and slug are denormalized onto anything crediting it: a
    // world's `creatorAttributions` carry both, `worldProfileCredits` carry the
    // slug, and an event carries its community's name. Moving those is a real
    // job -- paged scans, an ordering guarantee between two tables, and a race
    // with whoever takes the freed slug -- and all three tables are empty.
    //
    // So this refuses instead of relinking. Building the machinery now would
    // mean shipping a page of untestable scanning against no rows, for a tool
    // whose whole purpose is one badly-named person. When worlds and events
    // carry data, that is the moment to build it, with real cases to test it on.
    const [credit, world, communityEvent] = await Promise.all([
      ctx.db
        .query("worldProfileCredits")
        .withIndex("by_profileType_profileSlug", (query) =>
          query.eq("profileType", profile.profileType).eq("profileSlug", profile.slug),
        )
        .first(),
      // Any world at all, because nothing indexes attributions by contained
      // slug, and a crude check that cannot be wrong beats a cheap one that can.
      ctx.db.query("worlds").first(),
      profile.profileType === "community"
        ? ctx.db
            .query("events")
            .withIndex("by_communityProfileId_startAt", (query) =>
              query.eq("communityProfileId", profile._id),
            )
            .first()
        : Promise.resolve(null),
    ]);

    if (credit !== null || world !== null || communityEvent !== null) {
      throw identityError(
        "PROFILE_HAS_CREDITED_REFERENCES",
        "This profile is credited on a world or event. Moving those references is not built yet, so the identity change is refused rather than left half-applied.",
      );
    }

    // Before the patch, and only while the profile is on the public surfaces.
    // A rename is a way to resurface a retracted identity -- which is exactly
    // why `assertProfileEditNotSuppressed` guards ordinary edits -- and this
    // path wrote straight past it. A hidden profile stays editable, on the same
    // contract: it publishes nothing now, and restoring it re-checks.
    if (isPubliclySurfaced(profile)) {
      await assertIdentityNotSuppressed(ctx.db, {
        profileId: profile._id,
        slugs: [nextSlug],
        displayNames: [
          nextDisplayName,
          ...surfacedProfileNames(profile).slice(1),
        ],
        profileType: profile.profileType,
      });
    }

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

    // One event per change rather than one for both. A combined rename and
    // reslug recorded only the reslug, and `seedAccess.withheldProfileRecord`
    // hides the operator note from an ordinary owner and shows the action as the
    // description -- so an owner whose name was changed had no record of it.
    if (renames) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "profile_renamed",
        actor: args.actor,
        sourceType: "moderator",
        note: reason,
        createdAt: now,
      });
    }

    if (reslugs) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "profile_slug_changed",
        actor: args.actor,
        sourceType: "moderator",
        note: reason,
        createdAt: now,
      });
    }

    return { ...preview, changed: true as const };
  },
});
