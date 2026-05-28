import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { findAvailableProfileSlug, getProfileBySlug } from "./_profileSlugs";
import { sanitizeCommunitySubmissionProfileInput } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

const profileType = v.union(v.literal("person"), v.literal("community"));

function requireE2eHelper(secret: string) {
  const expectedSecret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();

  if (process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" || !expectedSecret || secret !== expectedSecret) {
    throw new Error("E2E helpers are not enabled for this deployment.");
  }
}

export const submitProfile = mutation({
  args: {
    secret: v.string(),
    runId: v.string(),
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
    requireE2eHelper(args.secret);

    const input = sanitizeCommunitySubmissionProfileInput(args);
    const now = Date.now();
    const slug = await findAvailableProfileSlug(ctx.db, input.displayName);
    const sourceAttribution = {
      submittedAt: now,
      submitter: {
        tokenIdentifier: `e2e:${args.runId.slice(0, 80)}`,
        issuer: "vrdex:e2e",
        subject: args.runId.slice(0, 120),
        displayName: "Playwright E2E",
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

    const profileId = await ctx.db.insert(
      "profiles",
      input.profileType === "person"
        ? {
            ...sharedFields,
            profileType: "person",
            person: { roleTags: input.person.roleTags },
          }
        : {
            ...sharedFields,
            profileType: "community",
            community: input.community,
          },
    );
    const profile = await ctx.db.get(profileId);

    if (profile !== null) {
      await Promise.all([
        upsertSearchDocument(ctx.db, createProfileSearchDocument(profile)),
        ctx.db.insert("profileAuditEvents", {
          profileId,
          action: "e2e_profile_submitted",
          actor: sourceAttribution.submitter,
          sourceType: "community",
          note: "Playwright E2E profile submission flow.",
          createdAt: now,
        }),
      ]);
    }

    return {
      profileId,
      profileType: input.profileType,
      slug,
      profilePath: input.profileType === "person" ? `/p/${slug}` : `/c/${slug}`,
    };
  },
});

export const cleanupProfileBySlug = mutation({
  args: {
    secret: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    requireE2eHelper(args.secret);

    const profile = await getProfileBySlug(ctx.db, args.slug);

    if (profile === null) {
      return { deleted: false };
    }

    if (!profile.sourceAttribution?.submitter.tokenIdentifier.startsWith("e2e:")) {
      throw new Error("Only E2E-created profiles can be cleaned up by this helper.");
    }

    const [searchDocuments, auditEvents] = await Promise.all([
      ctx.db.query("searchDocuments").withIndex("by_profileId", (query) => query.eq("profileId", profile._id)).collect(),
      ctx.db.query("profileAuditEvents").withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profile._id)).collect(),
    ]);

    await Promise.all([
      ...searchDocuments.map((document) => ctx.db.delete(document._id)),
      ...auditEvents.map((event) => ctx.db.delete(event._id)),
      ctx.db.delete(profile._id),
    ]);

    return { deleted: true };
  },
});
