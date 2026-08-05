import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "./_eventPublic";
import type { AuthSubject } from "./_communityAuthority";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
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
import { canReadProfile } from "./_profilePermissions";
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

    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "api_profile_updated",
      actor: apiOwnerAuthSubject(args.ownerUserId),
      sourceType: "owner",
      note: `Public API profile update: ${changedFields.join(", ")}.`,
      createdAt: now,
    });
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
    ...apiProfileUpdateArgs,
    assets: v.optional(v.array(profileAssetUploadInput)),
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

    // Reported before the per-field checks so a claimed profile gives the reason
    // rather than a field name the editor cannot act on.
    if (!owns && profile.claimState !== "unclaimed") {
      throw new ConvexError({
        code: "PROFILE_CLAIMED",
        message: "This profile has been claimed, so only its owner can edit it.",
      });
    }

    if (!canReadProfile(editSubject, profile)) {
      throw new Error("Profile was not found.");
    }

    await assertProfileEditNotSuppressed(ctx.db, profile, args);

    const now = Date.now();
    const { changedFields, profile: updatedProfile } = await applyApiProfileUpdate(ctx.db, {
      profile,
      input: args,
      subject: editSubject,
      now,
    });

    if ((args.assets ?? []).length > 0) {
      await consumeProfileAssetUploads(ctx.db, {
        profileId: profile._id,
        requestedBy: subject,
        uploads: args.assets ?? [],
        // A profile picture or logo is information about the person, which is
        // exactly what a third party is positioned to supply, and the most
        // visible thing missing from a seeded profile. The provenance stamp is
        // what keeps it honest.
        source: owns ? "owner_authored" : "community_submitted",
        now,
      });
    }

    // The durable record of who changed what, and when. A claiming owner
    // inherits a history rather than a mystery, and it is what the operator
    // surface reads back.
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: owns ? "owner_profile_updated" : "community_profile_updated",
      actor: subject,
      sourceType: owns ? "owner" : "community",
      note: `${changedFields.join(", ")} updated.`,
      createdAt: now,
    });

    return {
      ...toApiProfileWriteResponse(updatedProfile),
      changedFields,
    };
  },
});
