import { v } from "convex/values";

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
import { toPublicProfile } from "./_profilePublic";
import { findAvailableProfileSlug, getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { sanitizeCommunitySubmissionProfileInput } from "./_profileSubmissions";
import { getPublicProfileWorldCredits } from "./_profileWorldCredits";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { searchPublicDocuments } from "./_publicSearch";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { hasAcceptedSuppression } from "./_suppressions";
import { recordVocabularyTerms } from "./_vocabulary";
import { userOwnsProfile } from "./_profileOwnership";
import { applyApiProfileUpdate } from "./_profileUpdates";

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
    assets: v.optional(v.array(profileAssetUploadInput)),
  },
  handler: async (ctx, args) => {
    const { subject } = await requireActiveBrowserSessionSubject(ctx);
    const input = sanitizeCommunitySubmissionProfileInput(args);
    const now = Date.now();

    // Community submissions publish immediately, so they are the other way an
    // accepted suppression request can be bypassed: someone can submit an identity
    // that asked not to be listed. A pre-claim request may name someone who has no
    // profile at all, which is exactly the case this covers.
    if (
      await hasAcceptedSuppression(ctx.db, {
        displayNames: [input.displayName],
        profileType: input.profileType,
      })
    ) {
      throw new Error("This profile cannot be submitted.");
    }

    const slug = await findAvailableProfileSlug(ctx.db, input.displayName);
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
      outboundLinks: [],
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
