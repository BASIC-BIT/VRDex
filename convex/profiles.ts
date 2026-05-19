import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { toPublicProfile } from "./_profilePublic";
import { findAvailableProfileSlug, getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { sanitizeCommunitySubmissionProfileInput } from "./_profileSubmissions";

const profileType = v.union(v.literal("person"), v.literal("community"));

function optionalIdentityDisplayName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 120);
}

export const getPublicBySlug = query({
  args: {
    slug: v.string(),
    profileType: v.optional(profileType),
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

    return toPublicProfile(profile);
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new Error("Profile submissions require a signed-in user.");
    }

    const input = sanitizeCommunitySubmissionProfileInput(args);
    const now = Date.now();
    const slug = await findAvailableProfileSlug(ctx.db, input.displayName);
    const displayName = optionalIdentityDisplayName(identity.name);
    const sourceAttribution = {
      submittedAt: now,
      submitter: {
        tokenIdentifier: identity.tokenIdentifier,
        issuer: identity.issuer,
        subject: identity.subject,
        ...(displayName !== undefined ? { displayName } : {}),
      },
    };

    const sharedFields = {
      slug,
      displayName: input.displayName,
      sortName: input.sortName,
      aliases: input.aliases,
      tags: input.tags,
      claimState: "unclaimed" as const,
      publicationState: "published" as const,
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

      return {
        profileId,
        profileType: "person" as const,
        slug,
        profilePath: `/p/${slug}`,
      };
    }

    const profileId = await ctx.db.insert("profiles", {
      ...sharedFields,
      profileType: "community",
      community: input.community,
    });

    return {
      profileId,
      profileType: "community" as const,
      slug,
      profilePath: `/c/${slug}`,
    };
  },
});
