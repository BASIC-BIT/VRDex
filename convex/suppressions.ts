import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createProfileSortName, normalizeProfileInlineText } from "./_profileSubmissions";
import {
  createProfileSearchDocument,
  createWorldSearchDocument,
  getHiddenWorldAttributionProfileKeys,
  upsertSearchDocument,
} from "./_searchDocuments";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

const profileType = v.union(v.literal("person"), v.literal("community"));

const PROFILE_RETRACTION_PAGE_SIZE = 20;
const WORLD_REINDEX_PAGE_SIZE = 25;
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

/**
 * One page of the profiles an accepted request should retract.
 *
 * Identity is resolved at acceptance time rather than request time: a pre-claim
 * request may be filed before any profile exists and then have a matching profile
 * published before an operator gets to it. An id or slug target is a single
 * profile; a name-only request can match many namesakes, so that path pages.
 */
async function resolveSuppressionTargetPage(
  db: MutationCtx["db"],
  request: Doc<"profileSuppressionRequests">,
  cursor: string | undefined,
): Promise<{ profiles: Doc<"profiles">[]; isDone: boolean; continueCursor?: string }> {
  if (cursor === undefined) {
    const byId = request.profileId === undefined ? null : await db.get(request.profileId);

    if (byId !== null) {
      return { profiles: [byId], isDone: true };
    }

    const bySlug =
      request.profileSlug === undefined ? null : await getProfileBySlug(db, request.profileSlug);

    // A pre-claim request can record a slug before any profile holds it, and someone
    // else may acquire it before acceptance. Only trust a slug match that agrees
    // with the request's stored identity; otherwise fall through to name and type.
    if (bySlug !== null && suppressionIdentityAgrees(request, bySlug)) {
      return { profiles: [bySlug], isDone: true };
    }
  }

  if (request.displayName === undefined) {
    return { profiles: [], isDone: true };
  }

  // Namesake resolution pages over one profile type at a time. The cursor encodes
  // which type is in progress so a request with no stored type still covers both.
  const sortName = createProfileSortName(request.displayName);
  const [encodedType, innerCursor] = decodeSuppressionCursor(cursor, request.profileType);
  const result = await db
    .query("profiles")
    .withIndex("by_profileType_sortName", (query) =>
      query.eq("profileType", encodedType).eq("sortName", sortName),
    )
    .paginate({ numItems: PROFILE_RETRACTION_PAGE_SIZE, cursor: innerCursor });

  if (!result.isDone) {
    return {
      profiles: result.page,
      isDone: false,
      continueCursor: `${encodedType}:${result.continueCursor}`,
    };
  }

  const shouldContinueToCommunity =
    request.profileType === undefined && encodedType === "person";

  return {
    profiles: result.page,
    isDone: !shouldContinueToCommunity,
    ...(shouldContinueToCommunity ? { continueCursor: "community:" } : {}),
  };
}

function decodeSuppressionCursor(
  cursor: string | undefined,
  requestedType: Doc<"profiles">["profileType"] | undefined,
): [Doc<"profiles">["profileType"], string | null] {
  if (cursor === undefined) {
    return [requestedType ?? "person", null];
  }

  const separator = cursor.indexOf(":");
  const type = cursor.slice(0, separator) === "community" ? "community" : "person";
  const inner = cursor.slice(separator + 1);

  return [type, inner === "" ? null : inner];
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

    // Required, and persisted on the request itself. A pre-claim request that
    // matches no profile yet writes no audit event, so without this an accepted
    // request could block publication with no record of who decided that.
    if (actor === undefined) {
      throw new Error(
        "Resolving a suppression request requires an operator identity. Pass actor when calling outside a browser session.",
      );
    }

    // Acceptance is terminal in both directions.
    //
    // Leaving `accepted` would drop the request from the publication guard without
    // restoring profiles the scheduled job already opted out, and a change made
    // mid-retraction would strand part of a namesake set because later pages stop
    // once the request is no longer accepted.
    //
    // Re-accepting is a no-op rather than an error, so a retry after a client
    // timeout is safe: rewriting the row would overwrite the original resolver and
    // timestamp, and rescheduling would duplicate the audit rows.
    if (request.state === "accepted") {
      if (args.state === "accepted") {
        return {
          requestId: request._id,
          state: "accepted" as const,
          retractionScheduled: false as const,
          alreadyAccepted: true as const,
        };
      }

      throw new Error(
        "An accepted suppression request cannot be reopened. Re-publish the profile deliberately instead.",
      );
    }

    await ctx.db.patch(request._id, {
      state: args.state,
      ...optionalValue("resolutionNote", optionalText(args.resolutionNote, 1_000)),
      resolvedBy: actor,
      resolvedAt: now,
      updatedAt: now,
    });

    if (args.state !== "accepted") {
      return { requestId: request._id, state: args.state, retractionScheduled: false as const };
    }

    // Retraction is scheduled, not inline. A common name can resolve to many
    // profiles, and an oversized transaction would roll back the acceptance itself,
    // leaving the request unaccepted and every profile public. Acceptance already
    // blocks new publication through hasAcceptedSuppression, so the retraction of
    // existing profiles can safely land in a later pass.
    await ctx.scheduler.runAfter(0, internal.suppressions.retractProfilesForSuppression, {
      requestId: request._id,
    });

    return { requestId: request._id, state: args.state, retractionScheduled: true as const };
  },
});

/**
 * Opt out every profile an accepted request covers, in pages.
 *
 * Split out of `resolveProfileSuppression` so acceptance is durable regardless of
 * how many profiles share the requested name. Reschedules itself while pages
 * remain.
 */
export const retractProfilesForSuppression = internalMutation({
  args: {
    requestId: v.id("profileSuppressionRequests"),
    cursor: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);

    if (request === null || request.state !== "accepted") {
      return { retracted: 0, isDone: true as const };
    }

    const now = args.now ?? Date.now();
    const page = await resolveSuppressionTargetPage(ctx.db, request, args.cursor);
    let retracted = 0;

    for (const profile of page.profiles) {
      // An existing moderation suppression outranks a later opt-out. Both hide the
      // profile, but downgrading would destroy the distinct moderation state and
      // its reason; the request is still accepted and audited.
      const alreadySuppressed = profile.publicSurfacingState === "suppressed";

      if (!alreadySuppressed) {
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
          await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
            profiles: [{ profileType: updated.profileType, profileSlug: updated.slug }],
          });
        }

        retracted += 1;
      }

      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "suppression_accepted",
        ...optionalValue("actor", request.resolvedBy),
        sourceType: "moderator",
        note: alreadySuppressed
          ? "Suppression request accepted; existing moderation suppression left in place."
          : "Profile opted out of public surfacing by accepted suppression request.",
        createdAt: now,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.suppressions.retractProfilesForSuppression, {
        requestId: request._id,
        ...optionalValue("cursor", page.continueCursor),
      });
    }

    return { retracted, isDone: page.isDone };
  },
});

/**
 * Rebuild search documents for worlds crediting a retracted profile, in pages.
 *
 * The public world projection filters hidden attributions dynamically, but a
 * world's stored search document keeps the profile's display name in `searchText`
 * and `exactTokens` until something rebuilds it, so searching the retracted
 * identity would still surface its world associations.
 *
 * Reschedules itself while pages remain, so a profile credited on many worlds
 * cannot push this over a transaction limit.
 */
export const reindexWorldsCreditingProfile = internalMutation({
  args: {
    // A list, so one scan can cover a whole page of published profiles. Scanning
    // the worlds table once per profile would mean hundreds of identical
    // full-table scans for a large batch.
    profiles: v.array(
      v.object({
        profileType: v.union(v.literal("person"), v.literal("community")),
        profileSlug: v.string(),
      }),
    ),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Paged over worlds rather than worldProfileCredits: nothing in the codebase
    // writes that table, so a reverse-index lookup would silently find nothing.
    // creatorAttributions lives on the world row and has no index, hence the scan.
    const worlds = await ctx.db
      .query("worlds")
      .paginate({ numItems: WORLD_REINDEX_PAGE_SIZE, cursor: args.cursor ?? null });
    let reindexed = 0;

    const wanted = new Set(
      args.profiles.map((profile) => `${profile.profileType}:${profile.profileSlug}`),
    );

    for (const world of worlds.page) {
      const creditsProfile = world.creatorAttributions.some(
        (attribution) =>
          attribution.profileSlug !== undefined &&
          attribution.profileType !== undefined &&
          wanted.has(`${attribution.profileType}:${attribution.profileSlug}`),
      );

      if (!creditsProfile) {
        continue;
      }

      const hiddenProfileKeys = await getHiddenWorldAttributionProfileKeys(ctx.db, world);
      await upsertSearchDocument(ctx.db, createWorldSearchDocument(world, { hiddenProfileKeys }));
      reindexed += 1;
    }

    if (!worlds.isDone) {
      await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
        profiles: args.profiles,
        cursor: worlds.continueCursor,
      });
    }

    return { reindexed, isDone: worlds.isDone };
  },
});
