import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createProfileSortName, normalizeProfileInlineText } from "./_profileSubmissions";
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
 * Every profile an accepted request should retract.
 *
 * Resolved at acceptance time, not at request time. A pre-claim request may be
 * filed before any profile exists and then have a matching profile published
 * before an operator gets to it; resolving only the stored id or slug would leave
 * that profile public even though the request was accepted. Name/type identity is
 * therefore re-resolved here.
 */
/**
 * Whether a slug-matched profile is actually the one a request names.
 *
 * A request with no stored name or type carries no further identity to disagree
 * with, so the slug is taken at face value.
 */
function suppressionIdentityAgrees(
  request: Doc<"profileSuppressionRequests">,
  profile: Doc<"profiles">,
): boolean {
  if (request.profileType !== undefined && request.profileType !== profile.profileType) {
    return false;
  }

  if (
    request.displayName !== undefined &&
    createProfileSortName(request.displayName) !== createProfileSortName(profile.displayName)
  ) {
    return false;
  }

  return true;
}

async function resolveSuppressionTargets(
  db: MutationCtx["db"],
  request: Doc<"profileSuppressionRequests">,
): Promise<Doc<"profiles">[]> {
  const byId = request.profileId === undefined ? null : await db.get(request.profileId);

  if (byId !== null) {
    return [byId];
  }

  const bySlug =
    request.profileSlug === undefined ? null : await getProfileBySlug(db, request.profileSlug);

  // A pre-claim request can record a slug before any profile holds it, and someone
  // else — possibly of the other profile type — may acquire it before acceptance.
  // Only trust a slug match that agrees with the request's stored identity;
  // otherwise fall through to the name/type lookup for the intended profile.
  if (bySlug !== null && suppressionIdentityAgrees(request, bySlug)) {
    return [bySlug];
  }

  if (request.displayName === undefined) {
    return [];
  }

  const sortName = createProfileSortName(request.displayName);
  const profileTypes =
    request.profileType === undefined
      ? (["person", "community"] as const)
      : ([request.profileType] as const);
  const matches: Doc<"profiles">[] = [];

  for (const type of profileTypes) {
    matches.push(
      ...(await db
        .query("profiles")
        .withIndex("by_profileType_sortName", (query) =>
          query.eq("profileType", type).eq("sortName", sortName),
        )
        .collect()),
    );
  }

  return matches;
}

/**
 * Resolve a suppression request, applying the surfacing change on acceptance.
 *
 * Without this, `requestProfileSuppression` only ever wrote `submitted` rows and
 * nothing could reach `accepted`, which meant the accepted-suppression guard on
 * publication could never fire and there was no way to retract an already-public
 * profile.
 *
 * Accepting sets every matching profile to `opted_out`, audits it, and reindexes
 * so discovery drops it. An accepted request with no matching profile still
 * blocks future seed publication for that name and type through
 * `hasAcceptedSuppression`.
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

    if (args.state !== "accepted") {
      return {
        requestId: request._id,
        state: args.state,
        appliedToProfileIds: [] as Id<"profiles">[],
      };
    }

    const targets = await resolveSuppressionTargets(ctx.db, request);
    const applied: Id<"profiles">[] = [];

    for (const profile of targets) {
      // An existing moderation suppression outranks a later opt-out. Both hide the
      // profile, but downgrading would destroy the distinct moderation state and
      // its reason; the request is still accepted and audited.
      if (profile.publicSurfacingState !== "suppressed") {
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

        applied.push(profile._id);
      }

      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "suppression_accepted",
        ...optionalValue("actor", actor),
        sourceType: "moderator",
        note:
          profile.publicSurfacingState === "suppressed"
            ? "Suppression request accepted; existing moderation suppression left in place."
            : "Profile opted out of public surfacing by accepted suppression request.",
        createdAt: now,
      });
    }

    return {
      requestId: request._id,
      state: args.state,
      appliedToProfileIds: applied,
    };
  },
});
