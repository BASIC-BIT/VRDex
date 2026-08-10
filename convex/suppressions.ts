import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { activeBrowserSessionSubjectOrNull } from "./_browserSessionAuthority";
import { getProfileBySlug, getRequestedProfile, resolveRequestedProfile } from "./_profileSlugs";
import { optionalEnv } from "./_supportEnv";
import {
  requireRawArgumentsWithinBounds,
  requireSupportBacklogHeadroom,
  supportInputError,
} from "./_supportIntake";
import { createProfileSortName, normalizeProfileInlineText } from "./_profileSubmissions";
import { setProfileSurfacing } from "./_profileSurfacing";
import { surfacedProfileNames } from "./_suppressions";
import {
  reindexWorldSearchDocument,
} from "./_searchDocuments";
import { seedImportAuthSubjectValidator as authSubjectValidator } from "./_seedImportValidators";

const profileType = v.union(v.literal("person"), v.literal("community"));

const PROFILE_RETRACTION_PAGE_SIZE = 20;
/**
 * Shorter than the support intake's 4,000, and exported so the one form feeding
 * both can hold the requester to whichever limit their topic actually has.
 */
export const SUPPRESSION_NOTE_MAX_LENGTH = 1_000;
const SUPPRESSION_CONTACT_MAX_LENGTH = 160;
const SUPPRESSION_DISPLAY_NAME_MAX_LENGTH = 120;
/** Matches the support intake's floor, since one form feeds both. */
const SUPPRESSION_NOTE_MIN_LENGTH = 10;
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

    // Before the session lookup and the backlog queries, as on the sibling
    // path: these bound the work one unauthenticated call can cause, and a
    // check that runs after the database reads bounds nothing.
    requireRawArgumentsWithinBounds(
      [args.profileSlug, args.displayName, args.requesterContact, args.requesterNote],
      "That is longer than we can store.",
    );

    // The sibling intake refuses an overlong contact; this one silently stored
    // the first 160 characters, so a caller reaching this mutation directly got
    // success and the digest got a truncated address.
    if (normalizeProfileInlineText(args.requesterContact ?? "").length > SUPPRESSION_CONTACT_MAX_LENGTH) {
      throw supportInputError("That contact is too long. Give us a shorter address or handle.");
    }

    // The form marks Message required, but `required` only rejects an empty
    // field: spaces satisfy it, normalize to nothing, and `optionalText` then
    // omits the note entirely. An owner opt-out or a safety report arrived
    // reported as sent, with no explanation of what it was for.
    const note = normalizeProfileInlineText(args.requesterNote ?? "");

    if (note.length < SUPPRESSION_NOTE_MIN_LENGTH) {
      throw supportInputError("Tell us a little more about what you need.");
    }

    // Refused rather than sliced. `optionalText` below would quietly drop
    // everything past 1,000 characters while the requester was told the request
    // was sent, and on a safety report the part that goes last is the evidence.
    if (note.length > SUPPRESSION_NOTE_MAX_LENGTH) {
      throw supportInputError(
        `That note is longer than we can store. Keep it under ${SUPPRESSION_NOTE_MAX_LENGTH} characters and link to the rest.`,
      );
    }

    // Shared with `submitSupportRequest`, because one form feeds both and its
    // profile field says "paste the profile link" whichever topic is chosen.
    // Parsing this only on the other path meant a pasted link resolved for a
    // dispute and was rejected for an opt-out.
    // The requester's own text, measured untruncated, as the sibling intake
    // does. Resolution searches on this name, so a silently sliced one sends the
    // scan after something the requester never wrote -- and on this path that
    // scan retracts every profile it matches.
    if (
      normalizeProfileInlineText(args.displayName ?? "").length > SUPPRESSION_DISPLAY_NAME_MAX_LENGTH
    ) {
      throw supportInputError(
        `That name is longer than we can store. Keep it under ${SUPPRESSION_DISPLAY_NAME_MAX_LENGTH} characters.`,
      );
    }

    const requested = resolveRequestedProfile(args.profileSlug, optionalEnv("SITE_URL"));
    const profileSlug = requested?.slug;

    // Only now the database, as on the sibling path: everything decidable
    // without it has already refused, so a caller repeating invalid input
    // cannot spend index reads on it.
    const requester = (await activeBrowserSessionSubjectOrNull(ctx))?.subject;

    await requireSupportBacklogHeadroom(ctx.db, requester, args.requestType);

    const profile = await getRequestedProfile(ctx.db, requested);
    const displayName = optionalText(
      args.displayName ?? profile?.displayName,
      SUPPRESSION_DISPLAY_NAME_MAX_LENGTH,
    );

    // A validated slug counts even when no profile holds it yet. The pre-claim case
    // is precisely "this slug is about me, do not let it be taken", and the
    // publication guards and retraction resolver both honour slug-only requests --
    // requiring a *resolved* profile made that documented shape impossible to file.
    if (profile === null && displayName === undefined && profileSlug === undefined) {
      throw supportInputError("Suppression requests need a profile slug or display name.");
    }

    const requestId = await ctx.db.insert("profileSuppressionRequests", {
      ...optionalValue("profileId", profile?._id),
      ...optionalValue("profileSlug", profile?.slug ?? profileSlug),
      // The pasted route beats the selector, which silently defaults to
      // `person`. A pre-claim request names a listing that does not exist yet,
      // so no record corrects a wrong guess, and `hasAcceptedSuppression`
      // checks type: the listing someone asked to keep down could be published.
      ...optionalValue(
        "profileType",
        profile?.profileType ?? requested?.profileType ?? args.profileType,
      ),
      ...optionalValue("displayName", displayName),
      requestType: args.requestType,
      state: "submitted",
      ...optionalValue("requester", requester),
      ...optionalValue(
        "requesterContact",
        optionalText(args.requesterContact, SUPPRESSION_CONTACT_MAX_LENGTH),
      ),
      ...optionalValue("requesterNote", optionalText(args.requesterNote, SUPPRESSION_NOTE_MAX_LENGTH)),
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
  // ponytail: pages the whole profile type rather than seeking the sortName, because
  // a profile can surface the requested identity through `aliases` while its display
  // name is unrelated and there is no alias index. The write-side guards treat
  // aliases as identity, so acceptance must too, or such a profile stays public
  // forever while every future write is blocked. Retraction is rare and already
  // scheduled and paged; add an alias index if that stops being true.
  const result = await db
    .query("profiles")
    .withIndex("by_profileType_sortName", (query) => query.eq("profileType", encodedType))
    .paginate({ numItems: PROFILE_RETRACTION_PAGE_SIZE, cursor: innerCursor });
  const matches = result.page.filter((profile) =>
    surfacedProfileNames(profile).some((name) => createProfileSortName(name) === sortName),
  );

  if (!result.isDone) {
    return {
      profiles: matches,
      isDone: false,
      continueCursor: `${encodedType}:${result.continueCursor}`,
    };
  }

  const shouldContinueToCommunity =
    request.profileType === undefined && encodedType === "person";

  return {
    profiles: matches,
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
    const reindexKeys: Array<{
      profileType: Doc<"profiles">["profileType"];
      profileSlug: string;
    }> = [];
    let retracted = 0;

    for (const profile of page.profiles) {
      // An existing moderation suppression outranks a later opt-out: both hide
      // the profile, but downgrading would destroy the distinct moderation state
      // and its reason. The request is still accepted and audited.
      //
      // An archival does *not* outrank it, and must be replaced rather than left
      // alone. Leaving it recorded the accepted request in audit history only,
      // and `--unarchive` reads the surfacing state -- so a profile archived
      // between acceptance and this job running would be republished later
      // despite the opt-out. Suppression outranking archival is the same rule
      // archival itself enforces by refusing to write over one; this is the
      // other ordering of it.
      const priorState = profile.publicSurfacingState;
      const alreadyHidden = priorState === "suppressed";

      if (!alreadyHidden) {
        const reindexKey = await setProfileSurfacing(ctx.db, profile, {
          state: "opted_out",
          reason:
            request.requestType === "owner_opt_out"
              ? "Owner opt-out request accepted."
              : "Pre-claim safety suppression request accepted.",
          now,
        });

        if (reindexKey !== null) {
          reindexKeys.push(reindexKey);
        }

        retracted += 1;
      }

      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "suppression_accepted",
        ...optionalValue("actor", request.resolvedBy),
        sourceType: "moderator",
        note: alreadyHidden
          ? `Suppression request accepted; existing ${priorState} state left in place.`
          : priorState === "archived"
            ? "Profile opted out of public surfacing by accepted suppression request, replacing an operator archival."
            : "Profile opted out of public surfacing by accepted suppression request.",
        createdAt: now,
      });
    }

    // One scan for the whole page rather than one per retracted profile.
    if (reindexKeys.length > 0) {
      await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
        profiles: reindexKeys,
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
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
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

      await reindexWorldSearchDocument(ctx.db, world, now);
      reindexed += 1;
    }

    if (!worlds.isDone) {
      await ctx.scheduler.runAfter(0, internal.suppressions.reindexWorldsCreditingProfile, {
        profiles: args.profiles,
        cursor: worlds.continueCursor,
        now,
      });
    }

    return { reindexed, isDone: worlds.isDone };
  },
});
