import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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
import { applyApiProfileUpdate, assertProfileEditNotSuppressed } from "./_profileUpdates";

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

    if (!(await userOwnsProfile(ctx.db, profile._id, args.ownerUserId))) {
      throw new Error("You do not have permission to update this profile.");
    }

    // Renaming is another way to reintroduce a retracted identity: an owner of some
    // other public profile could rename it to a name an accepted suppression
    // request covers, putting that identity straight back on public pages and in
    // search.
    await assertProfileEditNotSuppressed(ctx.db, profile, args);

    const now = Date.now();
    const { changedFields, profile: updatedProfile } = await applyApiProfileUpdate(ctx.db, {
      profile,
      input: args,
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
        sourceType: "owner",
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

export const submitCommunityProfile = mutation({
  args: {
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
    assets: v.optional(v.array(profileAssetUploadInput)),
  },
  handler: async (ctx, args) => {
    const { subject } = await requireActiveBrowserSessionSubject(ctx);
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
      submitter: subject,
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
  args: { slug: v.string() },
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
     */
    expectedUpdatedAt: v.optional(v.number()),
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

    const owns = await userOwnsProfile(ctx.db, profile._id, user._id);
    const editSubject = owns ? ("claimed_owner" as const) : ("community_submitter" as const);

    // Readability first, and only then the claimed-profile message. The other
    // order tells anyone who guesses the slug of a draft or opted-out claimed
    // profile that it exists and is claimed -- a distinction the generic
    // not-found is there to withhold from someone who cannot read it at all.
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

    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== profile.updatedAt) {
      throw new ConvexError({
        code: "PROFILE_CHANGED",
        message: "This profile changed while you were editing it. Reload to see the current version.",
      });
    }

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
    };
  },
});
