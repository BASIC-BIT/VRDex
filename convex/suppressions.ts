import { v } from "convex/values";

import { internalMutation, mutation } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { normalizeProfileInlineText } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

const profileType = v.union(v.literal("person"), v.literal("community"));
const suppressionRequestType = v.union(
  v.literal("owner_opt_out"),
  v.literal("pre_claim_safety"),
);

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeProfileInlineText(value ?? "");

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

export const requestProfileSuppression = mutation({
  args: {
    requestType: suppressionRequestType,
    profileSlug: v.optional(v.string()),
    profileType: v.optional(profileType),
    displayName: v.optional(v.string()),
    requesterContact: v.optional(v.string()),
    requesterNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requester = (await activeBrowserSessionSubjectOrNull(ctx))?.subject;
    const slugValidation = args.profileSlug ? validateProfileSlug(args.profileSlug) : undefined;

    if (slugValidation && !slugValidation.ok) {
      throw new Error("Profile slug is invalid.");
    }

    const profile = slugValidation ? await getProfileBySlug(ctx.db, slugValidation.slug) : null;
    const displayName = optionalText(args.displayName ?? profile?.displayName, 120);

    if (profile === null && displayName === undefined) {
      throw new Error("Suppression requests need a profile slug or display name.");
    }

    const requestId = await ctx.db.insert("profileSuppressionRequests", {
      ...optionalValue("profileId", profile?._id),
      ...optionalValue("profileSlug", profile?.slug ?? slugValidation?.slug),
      ...optionalValue("profileType", profile?.profileType ?? args.profileType),
      ...optionalValue("displayName", displayName),
      requestType: args.requestType,
      state: "submitted",
      ...optionalValue("requester", requester),
      ...optionalValue("requesterContact", optionalText(args.requesterContact, 160)),
      ...optionalValue("requesterNote", optionalText(args.requesterNote, 1_000)),
      createdAt: now,
      updatedAt: now,
    });

    if (profile) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "suppression_requested",
        ...optionalValue("actor", requester),
        sourceType: "community",
        note:
          args.requestType === "owner_opt_out"
            ? "Owner opt-out request submitted."
            : "Pre-claim safety suppression request submitted.",
        createdAt: now,
      });
    }

    return { requestId };
  },
});

/**
 * Resolve a suppression request, applying the surfacing change on acceptance.
 *
 * Without this, `requestProfileSuppression` only ever wrote `submitted` rows and
 * nothing could reach `accepted`, which meant the accepted-suppression guard on
 * publication could never fire and there was no way to retract an already-public
 * profile. Accepting a request that names a profile sets it to `opted_out` and
 * reindexes it so discovery drops it.
 *
 * A pre-claim request with no profile id or slug has no profile to change. It is
 * still recorded as accepted, which blocks future seed publication for that
 * name/type through `hasAcceptedSuppression`.
 */
export const resolveProfileSuppression = internalMutation({
  args: {
    requestId: v.id("profileSuppressionRequests"),
    state: v.union(v.literal("under_review"), v.literal("accepted"), v.literal("rejected")),
    resolutionNote: v.optional(v.string()),
    actor: v.optional(authSubjectValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);

    if (request === null) {
      throw new Error("Suppression request not found.");
    }

    const now = args.now ?? Date.now();
    const actor = args.actor ?? (await activeBrowserSessionSubjectOrNull(ctx))?.subject;

    await ctx.db.patch(request._id, {
      state: args.state,
      ...optionalValue("resolutionNote", optionalText(args.resolutionNote, 1_000)),
      updatedAt: now,
    });

    const profile =
      request.profileId !== undefined
        ? await ctx.db.get(request.profileId)
        : request.profileSlug === undefined
          ? null
          : await getProfileBySlug(ctx.db, request.profileSlug);

    if (args.state !== "accepted" || profile === null) {
      return {
        requestId: request._id,
        state: args.state,
        appliedToProfile: false as const,
      };
    }

    await ctx.db.patch(profile._id, {
      publicSurfacingState: "opted_out",
      publicSurfacingUpdatedAt: now,
      publicSurfacingReason:
        request.requestType === "owner_opt_out"
          ? "Owner opt-out request accepted."
          : "Pre-claim safety suppression request accepted.",
      updatedAt: now,
    });

    const updated = await ctx.db.get(profile._id);

    if (updated !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(updated));
    }

    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "suppression_accepted",
      ...optionalValue("actor", actor),
      sourceType: "moderator",
      note: "Profile opted out of public surfacing by accepted suppression request.",
      createdAt: now,
    });

    return {
      requestId: request._id,
      state: args.state,
      appliedToProfile: true as const,
      profileId: profile._id,
      slug: profile.slug,
    };
  },
});
