import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "./_eventPublic";
import { toProfileLookupResult } from "./_profileLookup";
import { canReadProfile } from "./_profilePermissions";
import { toPublicProfile } from "./_profilePublic";
import { findAvailableProfileSlug, getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { sanitizeCommunitySubmissionProfileInput } from "./_profileSubmissions";
import { getPublicProfileWorldCredits } from "./_profileWorldCredits";
import {
  createProfileSearchDocument,
  normalizeSearchQuery,
  sortSearchResults,
  toPublicSearchResult,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { recordVocabularyTerms } from "./_vocabulary";

const profileType = v.union(v.literal("person"), v.literal("community"));
const PROFILE_LOOKUP_RESULT_LIMIT = 12;

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(value ?? fallback, max));
}

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
    now: v.optional(v.number()),
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

    return {
      ...toPublicProfile(profile),
      worldCredits: await getPublicProfileWorldCredits(ctx.db, {
        profileType: profile.profileType,
        slug: profile.slug,
      }),
      ...eventContext,
    };
  },
});

export const lookupPeople = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const searchText = normalizeSearchQuery(args.query);
    const limit = boundedLimit(args.limit, PROFILE_LOOKUP_RESULT_LIMIT, 25);

    if (!searchText) {
      return [];
    }

    const documents = await ctx.db
      .query("searchDocuments")
      .withSearchIndex("search_text", (search) =>
        search.search("searchText", searchText).eq("publicState", "public").eq("entityType", "profile"),
      )
      .take(limit * 3);
    const rankedPeople = sortSearchResults(documents.map((document) => toPublicSearchResult(document, searchText)))
      .filter((result) => result.profileType === "person")
      .slice(0, limit);
    const results = await Promise.all(
      rankedPeople.map(async (result) => {
        const profile = await getProfileBySlug(ctx.db, result.slug);

        if (profile === null || profile.profileType !== "person" || !canReadProfile("public", profile)) {
          return null;
        }

        return toProfileLookupResult(profile);
      }),
    );

    return results.filter((result): result is NonNullable<typeof result> => result !== null);
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

      const profile = await ctx.db.get(profileId);
      if (profile !== null) {
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
      };
    }

    const profileId = await ctx.db.insert("profiles", {
      ...sharedFields,
      profileType: "community",
      community: input.community,
    });

    const profile = await ctx.db.get(profileId);
    if (profile !== null) {
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
    };
  },
});
