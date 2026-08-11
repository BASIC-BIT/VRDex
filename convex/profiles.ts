import { ConvexError, type Infer, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  findMcpWriteReceipt,
  type McpProfileWriteResult,
  mcpWriteAttributionArgs,
  recordMcpWriteReceipt,
  requireMcpAttributionText,
  requireSha256Hex,
} from "./_mcpWriteReceipts";
import { normalizeOAuthClientId } from "./_oauth";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "./_eventPublic";
import type { AuthSubject } from "./_communityAuthority";
import {
  activeBrowserSessionOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";
import { getPublicCommunityTelemetry } from "./_communityTelemetryPublic";
import {
  apiWriteAuditActorKindValidator,
  recordApiWriteAuditEvent,
} from "./_apiWriteAuditEvents";
import { toPublicProfileAppearance } from "./_profileAppearance";
import {
  consumeProfileAssetUploads,
  getProfileAssetDisplayPreference,
  getPublicProfileMediaKit,
} from "./_profileAssets";
import {
  canEditProfileField,
  canReadProfile,
  PROFILE_EDITABLE_FIELDS,
  type ProfileEditableField,
} from "./_profilePermissions";
import { profileLinkInputValidator } from "./_profileLinks";
import { toPublicProfile } from "./_profilePublic";
import {
  createProfileSlugBase,
  findAvailableProfileSlug,
  getProfileBySlug,
  validateProfileSlug,
} from "./_profileSlugs";
import { getProfileFieldVisibility } from "./_profileFieldVisibility";
import {
  createProfileSortName,
  sanitizeCommunitySubmissionProfileInput,
} from "./_profileSubmissions";
import { getPublicProfileWorldCredits } from "./_profileWorldCredits";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { searchPublicDocuments } from "./_publicSearch";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { assertIdentityNotSuppressed } from "./_suppressions";
import { recordVocabularyTerms } from "./_vocabulary";
import { userOwnsProfile } from "./_profileOwnership";
import {
  applyApiProfileUpdate,
  assertProfileEditNotSuppressed,
  assertSubmittedFieldsEditable,
} from "./_profileUpdates";

const profileType = v.union(v.literal("person"), v.literal("community"));
const PROFILE_LOOKUP_RESULT_LIMIT = 12;
const nullableString = v.union(v.string(), v.null());
const apiProfileUpdateArgs = {
  displayName: v.optional(v.string()),
  aliases: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  headline: v.optional(nullableString),
  bio: v.optional(nullableString),
  region: v.optional(nullableString),
  timezone: v.optional(nullableString),
  person: v.optional(
    v.object({
      pronouns: v.optional(nullableString),
      roleTags: v.optional(v.array(v.string())),
    }),
  ),
  community: v.optional(
    v.object({
      subtype: v.optional(nullableString),
      categoryTags: v.optional(v.array(v.string())),
    }),
  ),
  outboundLinks: v.optional(v.array(profileLinkInputValidator)),
};

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(value ?? fallback, max));
}

function toApiOwnedProfileSummary(profile: Doc<"profiles">) {
  return {
    id: profile._id,
    slug: profile.slug,
    profileType: profile.profileType,
    displayName: profile.displayName,
    headline: profile.headline,
    claimState: profile.claimState,
    publicationState: profile.publicationState,
    publicSurfacingState: profile.publicSurfacingState,
    creationSource: profile.creationSource,
    claimedAt: profile.claimedAt,
    publishedAt: profile.publishedAt,
    updatedAt: profile.updatedAt,
  };
}

function toApiProfileWriteResponse(profile: Doc<"profiles">) {
  return {
    profileId: profile._id,
    slug: profile.slug,
    profileType: profile.profileType,
    profilePath: profile.profileType === "person" ? `/p/${profile.slug}` : `/c/${profile.slug}`,
    // Computed here rather than by each caller, so no write path can report a
    // public path it did not check is actually readable.
    publiclyViewable: canReadProfile("public", profile),
  };
}

function apiOwnerAuthSubject(userId: Doc<"users">["_id"]): AuthSubject {
  return {
    tokenIdentifier: `api:${userId}`,
    issuer: "vrdex:api",
    subject: String(userId),
    displayName: "API user",
  };
}

/**
 * Refusals a hosted MCP tool should relay rather than flatten.
 *
 * The event write tools collapse every failure into one denial, which is right
 * when the cause is ownership of something the caller cannot see. It is wrong
 * for profiles, where most refusals name something the agent can act on -- a
 * headline over its length, a `discord` link pointing at the wrong host, a
 * profile that is claimed, an identity that asked not to be listed. Flattening
 * those turns a fixable request into a retry loop.
 */
const RELAYED_PROFILE_WRITE_ERROR_CODES = new Set([
  "IDENTITY_SUPPRESSED",
  "PROFILE_CONTRIBUTE_SCOPE_REQUIRED",
  "INVALID_PROFILE_LINK",
  "PROFILE_CLAIMED",
  "PROFILE_INPUT_INVALID",
]);

function asMcpProfileWriteError(error: unknown) {
  return error instanceof ConvexError
      && typeof error.data?.code === "string"
      && RELAYED_PROFILE_WRITE_ERROR_CODES.has(error.data.code)
    ? error
    : new ConvexError({ code: "MCP_WRITE_DENIED" });
}

/**
 * The subject an editor acts as on this profile, plus the two refusals that
 * come before any per-field check.
 *
 * Shared by the browser, API-token and hosted-MCP paths so they cannot drift.
 * The API path used to require ownership outright, which made the community
 * correction the browser already allows invisible to anyone driving VRDex from a
 * tool -- and unclaimed profiles are most of them, so that was most of the
 * value. One helper, because a permission rule copied into three callers is a
 * rule that will be fixed in one of them.
 */
async function resolveProfileEditSubject(
  db: DatabaseReader,
  profile: Doc<"profiles">,
  userId: Id<"users">,
  /**
   * Whether the calling credential may act as a community contributor.
   *
   * Undefined for the browser, where the signed-in user is acting directly and
   * there is no delegation to bound. A credential passes what it was actually
   * granted: a token or OAuth session holding only `profile:write` was issued
   * against a consent screen reading "Edit your profiles", and letting it
   * correct strangers' profiles would widen a grant its user never made.
   */
  contributeGranted?: boolean,
) {
  const owns = await userOwnsProfile(db, profile._id, userId);
  const editSubject = owns ? ("claimed_owner" as const) : ("community_submitter" as const);

  // Readability first, and only then the claimed-profile message. The other
  // order tells anyone who guesses the slug of a draft or opted-out claimed
  // profile that it exists and is claimed -- a distinction the generic
  // not-found is there to withhold from someone who cannot read it at all.
  //
  // The scope refusal below is under the same rule and for the same reason: a
  // credential without the contribution grant that guessed a hidden slug would
  // otherwise get a distinct 403 where an unknown slug gets 404, and learn the
  // profile exists from the difference.
  if (!canReadProfile(editSubject, profile)) {
    throw new Error("Profile was not found.");
  }

  // Ahead of the per-field checks, so a claimed profile gives the reason
  // rather than a field name the editor cannot act on.
  if (!owns && profile.claimState !== "unclaimed") {
    throw new ConvexError({
      code: "PROFILE_CLAIMED",
      message: "This profile has been claimed, so only its owner can edit it.",
    });
  }

  // Last of the three, and after the claimed check on purpose. Claim state is
  // already public, so leading with it is both safe and accurate: telling a
  // caller to go get `profile:contribute` for a profile they still could not
  // write would send them after a grant that would not help.
  if (!owns && contributeGranted === false) {
    throw new ConvexError({
      code: "PROFILE_CONTRIBUTE_SCOPE_REQUIRED",
      message: "Editing a profile you do not own requires the profile:contribute scope.",
    });
  }

  return { owns, editSubject };
}

const profileAssetPlacement = v.union(
  v.literal("profile_image"),
  v.literal("banner"),
  v.literal("primary_logo"),
  v.literal("additional_logo"),
);
const profileAssetUploadInput = v.object({
  intentId: v.id("profileAssetUploadIntents"),
  uploadToken: v.string(),
  label: v.optional(v.string()),
  caption: v.optional(v.string()),
  placements: v.array(profileAssetPlacement),
  position: v.optional(v.number()),
});

export const listProfilesForApiOwner = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    profileType: v.optional(profileType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, 50, 100);
    const owners = await ctx.db
      .query("profileOwners")
      .withIndex("by_userId_state", (index) => index.eq("userId", args.ownerUserId).eq("state", "active"))
      .collect();
    const profiles = await Promise.all(owners.map((owner) => ctx.db.get(owner.profileId)));

    return profiles
      .filter((profile): profile is Doc<"profiles"> => profile !== null)
      .filter((profile) => args.profileType === undefined || profile.profileType === args.profileType)
      .sort((first, second) => first.displayName.localeCompare(second.displayName))
      .slice(0, limit)
      .map(toApiOwnedProfileSummary);
  },
});

export const updateProfileForApiOwner = internalMutation({
  args: {
    actorKind: apiWriteAuditActorKindValidator,
    ownerUserId: v.id("users"),
    currentSlug: v.string(),
    contributeGranted: v.boolean(),
    ...apiProfileUpdateArgs,
  },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.currentSlug);

    if (!validation.ok) {
      throw new Error("Current profile slug is invalid.");
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null) {
      throw new Error("Profile was not found.");
    }

    const { owns, editSubject } = await resolveProfileEditSubject(
      ctx.db,
      profile,
      args.ownerUserId,
      args.contributeGranted,
    );

    // Permission first, before anything that answers differently for a value
    // this writer may not read -- the same ordering the browser path documents.
    assertSubmittedFieldsEditable(profile, args, editSubject);

    // Renaming is another way to reintroduce a retracted identity: an owner of some
    // other public profile could rename it to a name an accepted suppression
    // request covers, putting that identity straight back on public pages and in
    // search.
    await assertProfileEditNotSuppressed(ctx.db, profile, args);

    const now = Date.now();
    const { changedFields, profile: updatedProfile } = await applyApiProfileUpdate(ctx.db, {
      profile,
      input: args,
      subject: editSubject,
      now,
    });

    // Same rule as the browser path, and it needs stating here too now that
    // `changedFields` is a diff: a PATCH that re-sent what the profile already
    // held used to be impossible to distinguish and now reads as
    // "Public API profile update: ." -- a history row saying nothing happened.
    if (changedFields.length > 0) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "api_profile_updated",
        actor: apiOwnerAuthSubject(args.ownerUserId),
        // The history says who this was, not which transport carried it. A
        // contributor correcting an unclaimed profile through a token is the
        // same act as doing it in the browser, and a claiming owner reading
        // their history back should see that distinction rather than "owner"
        // on every row because the write happened to arrive over the API.
        sourceType: owns ? "owner" : "community",
        note: `Public API profile update: ${changedFields.join(", ")}.`,
        createdAt: now,
      });
    }

    // Recorded regardless: this is the API rate-and-abuse ledger, and a write
    // request that changed nothing is still a write request that was made.
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_updated",
      actorKind: args.actorKind,
      ownerUserId: args.ownerUserId,
      resourceType: "profile",
      routeClass: "public_write",
      targetProfileId: profile._id,
      now,
    });

    return toApiProfileWriteResponse(updatedProfile);
  },
});

export const getPublicBySlug = query({
  args: {
    slug: v.string(),
    profileType: v.optional(profileType),
    now: v.optional(v.number()),
    includeTelemetry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
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

    if (!canReadProfile("public", profile)) {
      return null;
    }

    const now = args.now ?? Date.now();
    const eventContext =
      profile.profileType === "person"
        ? {
            upcomingEvents: await getPublicPersonUpcomingEvents(ctx.db, profile._id, now),
            hostedEvents: [],
          }
        : {
            upcomingEvents: [],
            hostedEvents: await getPublicCommunityHostedEvents(ctx.db, profile._id, now),
          };

    const publicProfile = toPublicProfile(profile);
    const preference = await getProfileAssetDisplayPreference(ctx.db, profile._id);
    const mediaKit = await getPublicProfileMediaKit(ctx.db, profile, { preference });
    const appearance = toPublicProfileAppearance(preference);
    const legacyAvatarImageUrl =
      "avatarImageUrl" in publicProfile && typeof publicProfile.avatarImageUrl === "string"
        ? publicProfile.avatarImageUrl
        : undefined;
    const legacyBannerImageUrl =
      "bannerImageUrl" in publicProfile && typeof publicProfile.bannerImageUrl === "string"
        ? publicProfile.bannerImageUrl
        : undefined;
    const telemetry = profile.profileType === "community" && args.includeTelemetry !== false
      ? await getPublicCommunityTelemetry(ctx.db, profile._id, now)
      : null;

    return {
      ...publicProfile,
      appearance,
      mediaKit,
      avatarImageUrl: mediaKit.profileImage?.imageUrl ?? legacyAvatarImageUrl,
      bannerImageUrl: mediaKit.banner?.imageUrl ?? legacyBannerImageUrl,
      worldCredits: await getPublicProfileWorldCredits(ctx.db, {
        profileType: profile.profileType,
        slug: profile.slug,
      }),
      ...eventContext,
      ...(telemetry ? { telemetry } : {}),
    };
  },
});

export const lookupPeople = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, PROFILE_LOOKUP_RESULT_LIMIT, 25);
    const rankedPeople = await searchPublicDocuments(
      ctx,
      {
        entityType: "profile",
        limit,
        profileType: "person",
        query: args.query,
      },
      {
        defaultLimit: PROFILE_LOOKUP_RESULT_LIMIT,
        maxLimit: 25,
        takeMultiplier: 3,
      },
    );
    return rankedPeople.flatMap((result) => result.person ?? []);
  },
});

const communityProfileSubmissionArgs = {
  profileType,
  displayName: v.string(),
  aliases: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  person: v.optional(
    v.object({
      roleTags: v.optional(v.array(v.string())),
    }),
  ),
  community: v.optional(
    v.object({
      subtype: v.optional(v.string()),
      categoryTags: v.optional(v.array(v.string())),
    }),
  ),
  outboundLinks: v.optional(v.array(profileLinkInputValidator)),
};

// Inferred from the validators rather than restated, so a field added to the
// submission surface cannot compile here while silently missing from one caller.
type CommunityProfileSubmissionInput = Infer<ReturnType<typeof communityProfileSubmissionObject>> & {
  assets?: Infer<typeof profileAssetUploadInput>[];
};

function communityProfileSubmissionObject() {
  return v.object(communityProfileSubmissionArgs);
}

/**
 * Create a community-submitted profile, having already established who is
 * submitting it.
 *
 * Split from the browser mutation so the hosted-MCP path creates profiles the
 * same way rather than a similar way: the suppression check, the immediate
 * publication, the `community_submitted` link provenance and the audit row are
 * the parts that must not differ by transport.
 */
async function createCommunityProfileRecord(
  ctx: { db: DatabaseWriter },
  args: CommunityProfileSubmissionInput,
  submitter: AuthSubject,
) {
  {
    // Community-submitted: the signed-in submitter is adding a profile for
    // someone else, so these links are not owner-authored.
    const input = sanitizeCommunitySubmissionProfileInput(args, {
      linkSource: "community_submitted",
    });
    const now = Date.now();

    const slug = await findAvailableProfileSlug(ctx.db, input.displayName);

    // Community submissions publish immediately, so they are the other way an
    // accepted suppression request can be bypassed: someone can submit an identity
    // that asked not to be listed. Both the base slug the name would naturally take
    // and the slug actually allocated are checked, because a request may have been
    // filed with only a slug and no display name, and because the base slug being
    // taken pushes the allocation to a suffixed variant.
    await assertIdentityNotSuppressed(ctx.db, {
      slugs: [createProfileSlugBase(input.displayName), slug],
      // Aliases too: a submission can carry an unrelated display name and put the
      // suppressed one in aliases, which toPublicProfile exposes and search indexes.
      displayNames: [input.displayName, ...input.aliases],
      profileType: input.profileType,
    });
    const sourceAttribution = {
      submittedAt: now,
      submitter,
    };

    const sharedFields = {
      slug,
      displayName: input.displayName,
      sortName: input.sortName,
      aliases: input.aliases,
      tags: input.tags,
      outboundLinks: input.outboundLinks,
      claimState: "unclaimed" as const,
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      publicSurfacingUpdatedAt: now,
      creationSource: "community" as const,
      publishedAt: now,
      updatedAt: now,
      sourceAttribution,
    };

    if (input.profileType === "person") {
      const profileId = await ctx.db.insert("profiles", {
        ...sharedFields,
        profileType: "person",
        person: {
          roleTags: input.person.roleTags,
        },
      });
      const shortLink = await ensureShortLinkForTarget(
        ctx.db,
        { targetType: "profile", targetId: profileId },
        now,
      );

      const profile = await ctx.db.get(profileId);
      if (profile !== null) {
        await consumeProfileAssetUploads(ctx.db, {
          profileId,
          requestedBy: sourceAttribution.submitter,
          uploads: args.assets ?? [],
          source: "community_submitted",
          now,
        });
        await Promise.all([
          upsertSearchDocument(ctx.db, createProfileSearchDocument(profile)),
          recordVocabularyTerms(ctx.db, vocabularyForProfile(profile), now),
          ctx.db.insert("profileAuditEvents", {
            profileId,
            action: "community_profile_submitted",
            actor: sourceAttribution.submitter,
            sourceType: "community",
            note: "Community-submitted person profile created.",
            createdAt: now,
          }),
        ]);
      }

      return {
        profileId,
        profileType: "person" as const,
        slug,
        profilePath: `/p/${slug}`,
        shortLinkCode: shortLink.code,
        shortLinkPath: shortLink.shortLinkPath,
      };
    }

    const profileId = await ctx.db.insert("profiles", {
      ...sharedFields,
      profileType: "community",
      community: input.community,
    });
    const shortLink = await ensureShortLinkForTarget(
      ctx.db,
      { targetType: "profile", targetId: profileId },
      now,
    );

    const profile = await ctx.db.get(profileId);
    if (profile !== null) {
      await consumeProfileAssetUploads(ctx.db, {
        profileId,
        requestedBy: sourceAttribution.submitter,
        uploads: args.assets ?? [],
        source: "community_submitted",
        now,
      });
      await Promise.all([
        upsertSearchDocument(ctx.db, createProfileSearchDocument(profile)),
        recordVocabularyTerms(ctx.db, vocabularyForProfile(profile), now),
        ctx.db.insert("profileAuditEvents", {
          profileId,
          action: "community_profile_submitted",
          actor: sourceAttribution.submitter,
          sourceType: "community",
          note: "Community-submitted community profile created.",
          createdAt: now,
        }),
      ]);
    }

    return {
      profileId,
      profileType: "community" as const,
      slug,
      profilePath: `/c/${slug}`,
      shortLinkCode: shortLink.code,
      shortLinkPath: shortLink.shortLinkPath,
    };
  }
}

export const submitCommunityProfile = mutation({
  args: {
    ...communityProfileSubmissionArgs,
    assets: v.optional(v.array(profileAssetUploadInput)),
  },
  handler: async (ctx, args) => {
    const { subject } = await requireActiveBrowserSessionSubject(ctx);

    return await createCommunityProfileRecord(ctx, args, subject);
  },
});

/**
 * The record an editor is about to change, as stored rather than as published.
 *
 * The public projection is the wrong source for a form: it omits private fields,
 * so an editor would see an empty link list, add one, and save an array that
 * silently dropped everything already there. That is exactly the state 405
 * seeded profiles are in.
 *
 * Reading stored values is not a licence to read *private* ones. Every value
 * here belongs to a field `canEditProfileField` has already cleared for this
 * subject, and that check refuses a private field to the community -- so a
 * contributor is shown what they may edit and nothing else, and the form cannot
 * become a way to read a withheld value by opening it.
 */
export const editableProfile = query({
  args: {
    slug: v.string(),
    /**
     * The type the route claims this profile is.
     *
     * Slugs are global, so `/p/<community-slug>/edit` resolves to the community
     * profile and would have edited it happily -- then sent the writer back to a
     * `/p/` path that 404s, because `profilePath` came from the route rather than
     * the record. Refused here, the same way `seedAccess:withheldProfileRecord`
     * refuses a mismatched type, rather than checked in the component.
     */
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

    const owns = await userOwnsProfile(ctx.db, profile._id, activeSession.user._id);
    const subject = owns ? ("claimed_owner" as const) : ("community_submitter" as const);
    const editableFields = PROFILE_EDITABLE_FIELDS.filter((field) =>
      canEditProfileField(subject, profile, field),
    );
    const editable = new Set<string>(editableFields);

    if (editableFields.length === 0) {
      return null;
    }

    const whenEditable = <T>(field: ProfileEditableField, value: T) =>
      editable.has(field) ? value : undefined;

    return {
      slug: profile.slug,
      profileType: profile.profileType,
      // Whether the public profile route can render this at all, answered by the
      // predicate that route answers to. A `draft_private`, opted-out or
      // suppressed profile is editable by its owner and 404s for everybody
      // including them, so the editor has to know not to send them there once
      // the save succeeds.
      publiclyViewable: canReadProfile("public", profile),
      // Sent back with the save, so a second editor is told the profile moved
      // rather than quietly overwriting whatever changed underneath them.
      updatedAt: profile.updatedAt,
      displayName: profile.displayName,
      aliases: whenEditable("aliases", profile.aliases),
      tags: whenEditable("tags", profile.tags),
      headline: whenEditable("headline", profile.headline),
      bio: whenEditable("bio", profile.bio),
      region: whenEditable("region", profile.region),
      timezone: whenEditable("timezone", profile.timezone),
      // The whole link, not just type and url. The form posts this array back,
      // so anything omitted here is dropped on the next save: a custom label
      // becomes the provider's default name, a VRCDN handle has to be re-derived,
      // and a copy-styled link turns into a button.
      outboundLinks: whenEditable(
        "outboundLinks",
        (profile.outboundLinks ?? []).map((link) => ({
          type: link.type,
          url: link.url,
          label: link.label,
          handle: link.handle,
          presentation: link.presentation,
          // Echoed back by the form so an untouched link keeps the provenance it
          // has. Honoured as a claim, never as an assertion.
          source: link.source,
        })),
      ),
      person:
        profile.profileType === "person"
          ? whenEditable("person", {
              pronouns: profile.person.pronouns,
              roleTags: profile.person.roleTags,
            })
          : undefined,
      community:
        profile.profileType === "community"
          ? whenEditable("community", {
              subtype: profile.community.subtype,
              categoryTags: profile.community.categoryTags,
            })
          : undefined,
      subject,
      editableFields,
    };
  },
});

/**
 * Edit a profile from the browser, as its owner or as the community.
 *
 * One mutation for both, because they are the same operation with a different
 * writer: `canEditProfileField` decides which fields the subject may touch and
 * the link stamp follows from it. Splitting them would mean two sanitizers and
 * two field policies drifting apart, and the community half is the one that
 * exists to correct an unclaimed profile nobody else can.
 *
 * Applies directly rather than queueing for review, matching community
 * submissions, which publish immediately. A queue is a real option later; it is
 * not a prerequisite for a profile being correctable at all.
 */
export const updateProfileFromBrowser = mutation({
  args: {
    slug: v.string(),
    /**
     * The `updatedAt` the editor loaded.
     *
     * The form posts every field group it rendered, so a second person saving a
     * display-name fix would spread stale values over links, tags and roles
     * somebody else changed in the meantime -- and the diff would read those as
     * deliberate, because it compares against the profile as it is now. This
     * refuses the save instead of silently winning it.
     *
     * Required, not optional. A check a caller can decline by omitting the
     * argument is not a check: a cached page still running the previous
     * deployment's bundle, or anything calling the mutation directly, would post
     * the same whole-form payload and skip straight past it -- landing exactly
     * the overwrite this exists to refuse. Every browser save knows the version
     * it loaded, because it had to read the profile to fill the form.
     */
    expectedUpdatedAt: v.number(),
    ...apiProfileUpdateArgs,
  },
  handler: async (ctx, args) => {
    const { subject, user } = await requireActiveBrowserSessionSubject(ctx);
    const validation = validateProfileSlug(args.slug);

    if (!validation.ok) {
      throw new Error("Profile was not found.");
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null) {
      throw new Error("Profile was not found.");
    }

    const { owns, editSubject } = await resolveProfileEditSubject(ctx.db, profile, user._id);

    if (args.expectedUpdatedAt !== profile.updatedAt) {
      throw new ConvexError({
        code: "PROFILE_CHANGED",
        message: "This profile changed while you were editing it. Reload to see the current version.",
      });
    }

    // Permission first, before anything that answers differently for a value
    // this writer may not read. The suppression lookup returns
    // `IDENTITY_SUPPRESSED` for a retracted name and refuses everything else by
    // field name, so running it ahead of the field check told any signed-in
    // caller which identities had asked to be suppressed -- submit guesses at a
    // profile whose aliases are private and read the answer off the reply.
    // `applyApiProfileUpdate` checks the same thing again over what it is about
    // to write; this is the earlier gate, not a replacement for it.
    assertSubmittedFieldsEditable(profile, args, editSubject);

    await assertProfileEditNotSuppressed(ctx.db, profile, args);

    const now = Date.now();
    const { changedFields, profile: updatedProfile } = await applyApiProfileUpdate(ctx.db, {
      profile,
      input: args,
      subject: editSubject,
      now,
    });

    // No media here. `profileAssets:createUploadIntentForOwnedProfile` is the
    // only browser path to an upload intent and it requires ownership and
    // refuses unclaimed profiles outright, so a community contributor cannot
    // obtain one -- accepting an `assets` argument would be a parameter no
    // caller can satisfy. Letting any signed-in account attach images to
    // somebody else's profile also needs a moderation answer this change does
    // not have; the field policy is the part that was ready.

    // The durable record of who changed what, and when. A claiming owner
    // inherits a history rather than a mystery, and it is what the operator
    // surface reads back -- so a save that changed nothing writes nothing, and
    // one that changed a display name says so rather than naming every field
    // the form happened to post.
    if (changedFields.length > 0) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: owns ? "owner_profile_updated" : "community_profile_updated",
        actor: subject,
        sourceType: owns ? "owner" : "community",
        note: `${changedFields.join(", ")} updated.`,
        createdAt: now,
      });
    }

    return {
      ...toApiProfileWriteResponse(updatedProfile),
      changedFields,
      // The version the editor should hold from here. It pins the one it loaded
      // so a save cannot carry stale values over somebody else's edit, and until
      // now every successful save navigated away, so the pin never had to move.
      // An owner whose profile has no public page stays on the form, and a second
      // save would otherwise be refused as a conflict with their own first.
      //
      // Alongside `changedFields` rather than in the shared write response, which
      // is the public API's shape and has a schema and two OpenAPI artifacts
      // behind it.
      updatedAt: updatedProfile.updatedAt,
    };
  },
});

/**
 * Edit a profile from a hosted MCP session.
 *
 * Same permission model as the browser and API-token paths -- own it, or it is
 * unclaimed and you are correcting it as the community. What this adds is the
 * replay guard the transport needs: an agent that retries a tool call after a
 * timeout must not append the same link twice, so the first result is returned
 * again rather than re-applied.
 */
export const updateProfileForMcpActor = internalMutation({
  args: {
    ...mcpWriteAttributionArgs,
    currentSlug: v.string(),
    contributeGranted: v.boolean(),
    ...apiProfileUpdateArgs,
  },
  handler: async (ctx, args) => {
    const oauthClientId = normalizeOAuthClientId(args.oauthClientId);
    const idempotencyKeyHash = requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = requireSha256Hex(args.requestFingerprint, "Request fingerprint");
    const toolName = "vrdex_profile_update" as const;
    const existing = await findMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
    });

    if (existing !== null) {
      return existing.result as McpProfileWriteResult;
    }

    const validation = validateProfileSlug(args.currentSlug);

    if (!validation.ok) {
      throw new ConvexError({ code: "MCP_WRITE_DENIED" });
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null) {
      throw new ConvexError({ code: "MCP_WRITE_DENIED" });
    }

    let owns: boolean;
    let result: McpProfileWriteResult;
    let changedFields: string[];

    try {
      const authorization = await resolveProfileEditSubject(
        ctx.db,
        profile,
        args.ownerUserId,
        args.contributeGranted,
      );
      owns = authorization.owns;
      assertSubmittedFieldsEditable(profile, args, authorization.editSubject);
      await assertProfileEditNotSuppressed(ctx.db, profile, args);

      const applied = await applyApiProfileUpdate(ctx.db, {
        profile,
        input: args,
        subject: authorization.editSubject,
        now: Date.now(),
      });

      changedFields = applied.changedFields;
      result = toApiProfileWriteResponse(applied.profile);
    } catch (error) {
      throw asMcpProfileWriteError(error);
    }

    const now = Date.now();

    if (changedFields.length > 0) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "api_profile_updated",
        actor: apiOwnerAuthSubject(args.ownerUserId),
        sourceType: owns ? "owner" : "community",
        note: `Hosted MCP profile update: ${changedFields.join(", ")}.`,
        createdAt: now,
      });
    }

    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_updated",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      resourceType: "profile",
      routeClass: "authenticated_mcp_write",
      targetProfileId: profile._id,
      oauthClientId,
      oauthTokenId: requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256),
      requestId: requireMcpAttributionText(args.requestId, "Request id", 256),
      mcpToolName: toolName,
      idempotencyKeyHash,
      now,
    });
    await recordMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
      result,
      now,
    });

    return result;
  },
});

/**
 * Create a community-sourced profile from a hosted MCP session.
 *
 * No `assets` argument, matching the browser submission form: an upload intent
 * needs ownership of a claimed profile, so there is no sequence by which an
 * agent could satisfy one here.
 */
export const submitCommunityProfileForMcpActor = internalMutation({
  args: {
    ...mcpWriteAttributionArgs,
    ...communityProfileSubmissionArgs,
  },
  handler: async (ctx, args) => {
    const oauthClientId = normalizeOAuthClientId(args.oauthClientId);
    const idempotencyKeyHash = requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = requireSha256Hex(args.requestFingerprint, "Request fingerprint");
    const toolName = "vrdex_profile_submit" as const;
    const existing = await findMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
    });

    // Load-bearing here in a way it is not for edits: without it a retried
    // submission creates a second profile for the same person under a suffixed
    // slug, and nothing later merges them.
    if (existing !== null) {
      return existing.result as McpProfileWriteResult;
    }

    let created: Awaited<ReturnType<typeof createCommunityProfileRecord>>;

    try {
      created = await createCommunityProfileRecord(
        ctx,
        args,
        apiOwnerAuthSubject(args.ownerUserId),
      );
    } catch (error) {
      throw asMcpProfileWriteError(error);
    }

    const now = Date.now();
    const result: McpProfileWriteResult = {
      profileId: created.profileId,
      slug: created.slug,
      profileType: created.profileType,
      profilePath: created.profilePath,
      // Community submissions publish immediately, so this is always true here.
      // Stated rather than hardcoded so a future draft-submission path cannot
      // quietly claim public visibility it does not have.
      publiclyViewable: true,
    };

    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_created",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      resourceType: "profile",
      routeClass: "authenticated_mcp_write",
      targetProfileId: created.profileId,
      oauthClientId,
      oauthTokenId: requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256),
      requestId: requireMcpAttributionText(args.requestId, "Request id", 256),
      mcpToolName: toolName,
      idempotencyKeyHash,
      now,
    });
    await recordMcpWriteReceipt(ctx.db, {
      ownerUserId: args.ownerUserId,
      oauthClientId,
      toolName,
      idempotencyKeyHash,
      requestFingerprint,
      result,
      now,
    });

    return { ...result, shortLinkCode: created.shortLinkCode, shortLinkPath: created.shortLinkPath };
  },
});

/**
 * Create a community-sourced profile from an API credential.
 *
 * No idempotency key, unlike the MCP tool: a hand-written HTTP call is not a
 * tool loop retrying on a timeout, and inventing a key the caller never sent
 * would silently coalesce two deliberate submissions.
 */
export const submitCommunityProfileForApiUser = internalMutation({
  args: {
    actorKind: apiWriteAuditActorKindValidator,
    ownerUserId: v.id("users"),
    /**
     * Optional, and the reason it exists is retries rather than tidiness.
     *
     * A create has no natural replay guard: `findAvailableProfileSlug` suffixes
     * on collision, so a resubmission after a lost response publishes a second
     * profile for the same person under a second slug, and nothing merges them.
     * A caller that cannot lose its response can omit the key; the local stdio
     * MCP tool always sends one, because a tool loop retrying on timeout is
     * exactly the case this guards.
     */
    idempotencyKeyHash: v.optional(v.string()),
    requestFingerprint: v.optional(v.string()),
    ...communityProfileSubmissionArgs,
  },
  handler: async (ctx, args) => {
    const toolName = "vrdex_profile_submit" as const;
    // Scoped to the user rather than the individual credential. Two of one
    // user's tokens replaying one key is not a case worth splitting, and
    // conflating them errs toward fewer duplicate profiles.
    const receiptClientRef = `api:${args.actorKind}`;
    const idempotencyKeyHash = args.idempotencyKeyHash === undefined
      ? undefined
      : requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = args.requestFingerprint === undefined
      ? undefined
      : requireSha256Hex(args.requestFingerprint, "Request fingerprint");

    if (idempotencyKeyHash !== undefined && requestFingerprint !== undefined) {
      let existing;

      try {
        existing = await findMcpWriteReceipt(ctx.db, {
          ownerUserId: args.ownerUserId,
          oauthClientId: receiptClientRef,
          toolName,
          idempotencyKeyHash,
          requestFingerprint,
        });
      } catch {
        // The stored receipt holds a different request. Reusing one key for two
        // different profiles is a caller bug, and answering it with the first
        // profile would be worse than refusing.
        throw new ConvexError({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "This key was already used for a different profile submission.",
        });
      }

      if (existing !== null) {
        return existing.result as McpProfileWriteResult;
      }
    }

    const created = await createCommunityProfileRecord(
      ctx,
      args,
      apiOwnerAuthSubject(args.ownerUserId),
    );
    const now = Date.now();
    const result: McpProfileWriteResult = {
      profileId: created.profileId,
      slug: created.slug,
      profileType: created.profileType,
      profilePath: created.profilePath,
      publiclyViewable: true,
    };

    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_created",
      actorKind: args.actorKind,
      ownerUserId: args.ownerUserId,
      resourceType: "profile",
      routeClass: "public_write",
      targetProfileId: created.profileId,
      ...(idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash }),
      now,
    });

    if (idempotencyKeyHash !== undefined && requestFingerprint !== undefined) {
      await recordMcpWriteReceipt(ctx.db, {
        ownerUserId: args.ownerUserId,
        oauthClientId: receiptClientRef,
        toolName,
        idempotencyKeyHash,
        requestFingerprint,
        result,
        now,
      });
    }

    return result;
  },
});
