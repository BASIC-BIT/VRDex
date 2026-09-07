import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { recordExternalControlProof } from "./_externalControl";
import { profileLinkInputValidator } from "./_profileLinks";
import { findAvailableProfileSlug, getProfileBySlug } from "./_profileSlugs";
import { sanitizeCommunitySubmissionProfileInput } from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

const profileType = v.union(v.literal("person"), v.literal("community"));
const fieldVisibilityState = v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"));
const fieldVisibility = v.object({
  aliases: v.optional(fieldVisibilityState),
  tags: v.optional(fieldVisibilityState),
  genres: v.optional(fieldVisibilityState),
  headline: v.optional(fieldVisibilityState),
  bio: v.optional(fieldVisibilityState),
  about: v.optional(fieldVisibilityState),
  avatarImageUrl: v.optional(fieldVisibilityState),
  bannerImageUrl: v.optional(fieldVisibilityState),
  outboundLinks: v.optional(fieldVisibilityState),
  region: v.optional(fieldVisibilityState),
  timezone: v.optional(fieldVisibilityState),
  personPronouns: v.optional(fieldVisibilityState),
  personRoleTags: v.optional(fieldVisibilityState),
  communitySubtype: v.optional(fieldVisibilityState),
  communityCategoryTags: v.optional(fieldVisibilityState),
  mediaKit: v.optional(fieldVisibilityState),
});

function optionalText(value: string | undefined, maxLength = 500) {
  const trimmed = value?.trim();

  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function requireE2eHelper(secret?: string) {
  const expectedSecret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();

  if (process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" || !expectedSecret) {
    throw new Error("E2E helpers are not enabled for this deployment.");
  }

  if (secret !== undefined && secret !== expectedSecret) {
    throw new Error("E2E helper secret did not match this deployment.");
  }
}

function requireE2eAuthHelper(secret?: string) {
  requireE2eHelper(secret);

  if (process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true") {
    throw new Error("E2E auth helpers are not enabled for this deployment.");
  }
}

/**
 * These helpers delete accounts by email, so the domain is the blast radius.
 * `e2e.vrdex.net` is a subdomain nothing routes mail for and no real account can
 * hold, which keeps the guard as tight as the old one.
 *
 * It replaced `e2e.vrdex.local` because Clerk rejects that address outright —
 * `.local` is not a valid TLD to its Backend API, so the accounts these helpers
 * exist to serve could not be created at all:
 *
 *     422 form_param_format_invalid: Email address must be a valid email address.
 */
const E2E_EMAIL_DOMAIN = "@e2e.vrdex.net";

function normalizeE2eEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized.endsWith(E2E_EMAIL_DOMAIN)) {
    throw new Error(`E2E auth helpers only accept ${E2E_EMAIL_DOMAIN} emails.`);
  }

  return normalized;
}

function requireFixtureProofTargets(attempts: Doc<"profileVerificationAttempts">[]) {
  // Provenance of an E2E profile/account says nothing about a submitted target.
  // Only the established fixture namespace may lose its reservation history.
  if (attempts.some((attempt) => attempt.targetType !== "vrclinking" &&
    !/^(?:usr|grp)_e2e00000-0000-4000-8000-00000000000[123]$/.test(attempt.targetExternalId))) {
    throw new Error("E2E cleanup cannot remove a non-fixture VRChat target reservation.");
  }
}

async function deleteE2eProfile(ctx: MutationCtx, profile: Doc<"profiles">) {
  if (!profile.sourceAttribution?.submitter.tokenIdentifier.startsWith("e2e:")) {
    throw new Error("Only E2E-created profiles can be cleaned up by this helper.");
  }

  const [searchDocuments, auditEvents, owners, claimRequests, verificationAttempts, externalLinks, vrclinkingCredentials] = await Promise.all([
    ctx.db.query("searchDocuments").withIndex("by_profileId", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileAuditEvents").withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileOwners").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileClaimRequests").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileVerificationAttempts").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    // Created when a community claim pairs a control proof with the profile.
    // Every state, not just `active`: `removeConnection` leaves `removed` rows
    // behind, and filtering to active left them dangling against a deleted
    // profile on every shared-staging run.
    ctx.db.query("profileExternalLinks").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    // Nothing else deletes these, and a row that outlives its profile cannot
    // be revoked (revocation resolves the profile by slug) or listed, while
    // still consuming a slot in the adapter selection window forever.
    ctx.db.query("communityVrclinkingCredentials").withIndex("by_communityProfileId_state", (query) => query.eq("communityProfileId", profile._id)).collect(),
  ]);

  requireFixtureProofTargets(verificationAttempts);

  await Promise.all([
    ...searchDocuments.map((document) => ctx.db.delete(document._id)),
    ...auditEvents.map((event) => ctx.db.delete(event._id)),
    ...owners.map((owner) => ctx.db.delete(owner._id)),
    ...claimRequests.map((claimRequest) => ctx.db.delete(claimRequest._id)),
    ...verificationAttempts.map((attempt) => ctx.db.delete(attempt._id)),
    ...externalLinks.map((link) => ctx.db.delete(link._id)),
    ...vrclinkingCredentials.map((credential) => ctx.db.delete(credential._id)),
    ctx.db.delete(profile._id),
  ]);
}

async function userByEmail(ctx: MutationCtx, email: string) {
  return await ctx.db.query("users").withIndex("email", (query) => query.eq("email", email)).unique();
}

async function cleanupE2eUserByEmail(ctx: MutationCtx, email: string) {
  const user = await userByEmail(ctx, email);

  if (user === null) {
    return { deleted: false };
  }

  await cleanupE2eDeveloperCredentials(ctx, user._id);

  // Clerk owns accounts and sessions, so there are no auth tables left to
  // sweep. The Clerk-side test user is torn down by the Playwright fixture.
  const [claimRequests, verificationAttempts, profileOwners, controlProofs, discordWatermarks] = await Promise.all([
    ctx.db.query("profileClaimRequests").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("profileVerificationAttempts").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("profileOwners").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    // Seeded by the claim flow through the record-guild-proof helper; without
    // this, every shared-staging run leaves a dangling proof behind. Every
    // state, not just `active`: OAuth reconciliation revokes rows and the
    // hourly sweep marks them stale, and both survived an active-only filter.
    ctx.db.query("externalControlProofs").withIndex("by_userId_assetType_assetExternalId", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("discordVerificationWatermarks").withIndex("by_userId_discordUserId", (query) => query.eq("userId", user._id)).collect(),
  ]);

  requireFixtureProofTargets(verificationAttempts);

  await Promise.all([
    ...claimRequests.map((claimRequest) => ctx.db.delete(claimRequest._id)),
    ...verificationAttempts.map((attempt) => ctx.db.delete(attempt._id)),
    ...profileOwners.map((owner) => ctx.db.delete(owner._id)),
    ...controlProofs.map((proof) => ctx.db.delete(proof._id)),
    ...discordWatermarks.map((watermark) => ctx.db.delete(watermark._id)),
    ctx.db.delete(user._id),
  ]);

  return { deleted: true };
}

async function cleanupE2eDeveloperCredentials(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const [apiTokens, apiTokenEvents, oauthApplications, oauthAuthorizationCodes, oauthRefreshTokens, oauthClientEvents, oauthConsentTransactions] =
    await Promise.all([
      ctx.db.query("apiTokens").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("apiTokenEvents").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("oauthApplications").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("oauthAuthorizationCodes").withIndex("by_userId_createdAt", (query) => query.eq("userId", userId)).collect(),
      ctx.db.query("oauthRefreshTokens").withIndex("by_userId_expiresAt", (query) => query.eq("userId", userId)).collect(),
      ctx.db.query("oauthClientEvents").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      // `/oauth/authorize` inserts one of these before consent is submitted, so
      // a hosted run that fails between those two points leaves a row behind.
      // Nothing else would ever collect it: the only expiry sweep runs when the
      // same user starts another transaction, which cannot happen once this
      // helper deletes the user.
      ctx.db.query("oauthConsentTransactions").withIndex("by_userId_expiresAt", (query) => query.eq("userId", userId)).collect(),
    ]);
  const [oauthApplicationSecrets, oauthAccessTokens] = await Promise.all([
    Promise.all(
      oauthApplications.map((application) =>
        ctx.db
          .query("oauthApplicationSecrets")
          .withIndex("by_applicationId_status_createdAt", (query) => query.eq("applicationId", application._id))
          .collect(),
      ),
    ),
    Promise.all(
      oauthApplications.map((application) =>
        ctx.db
          .query("oauthAccessTokens")
          .withIndex("by_applicationId_issuedAt", (query) => query.eq("applicationId", application._id))
          .collect(),
      ),
    ),
  ]);

  await Promise.all([
    ...apiTokenEvents.map((event) => ctx.db.delete(event._id)),
    ...apiTokens.map((token) => ctx.db.delete(token._id)),
    ...oauthApplicationSecrets.flat().map((secret) => ctx.db.delete(secret._id)),
    ...oauthAuthorizationCodes.map((code) => ctx.db.delete(code._id)),
    ...oauthRefreshTokens.map((token) => ctx.db.delete(token._id)),
    ...oauthAccessTokens.flat().map((token) => ctx.db.delete(token._id)),
    ...oauthClientEvents.map((event) => ctx.db.delete(event._id)),
    ...oauthConsentTransactions.map((transaction) => ctx.db.delete(transaction._id)),
  ]);
  await Promise.all(oauthApplications.map((application) => ctx.db.delete(application._id)));
}


export const linkDiscordAccountByEmail = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    providerAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper(args.secret);

    const email = normalizeE2eEmail(args.email);
    const user = await userByEmail(ctx, email);

    if (user === null) {
      throw new Error("E2E user not found.");
    }

    if (user.emailVerificationTime === undefined) {
      throw new Error("E2E user email is not verified.");
    }

    const providerAccountId = args.providerAccountId.trim();
    if (!providerAccountId) {
      throw new Error("Discord provider account id is required.");
    }

    // Claiming reads VRDex's own Discord verification watermark rather than a
    // sign-in provider account, so that is what this seeds.
    const now = Date.now();
    const existing = await ctx.db
      .query("discordVerificationWatermarks")
      .withIndex("by_userId_discordUserId", (query) =>
        query.eq("userId", user._id).eq("discordUserId", providerAccountId),
      )
      .unique();

    if (existing !== null) {
      await ctx.db.patch(existing._id, { updatedAt: now });
      return { linked: true };
    }

    await ctx.db.insert("discordVerificationWatermarks", {
      userId: user._id,
      discordUserId: providerAccountId,
      issuedGeneration: 1,
      appliedGeneration: 1,
      // Stands in for a completed round-trip, so it needs the success stamp the
      // current-identity selection ranks on.
      appliedAt: now,
      issuedAt: now,
      updatedAt: now,
    });

    return { linked: true };
  },
});

/**
 * Seed a verified Discord guild control proof, standing in for the OAuth
 * round-trip that hosted runs cannot perform against real Discord.
 */
export const recordGuildControlProofByEmail = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    guildId: v.string(),
    guildName: v.optional(v.string()),
    controlLevel: v.optional(
      v.union(v.literal("manager"), v.literal("administrator"), v.literal("owner")),
    ),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper(args.secret);

    const user = await userByEmail(ctx, normalizeE2eEmail(args.email));

    if (user === null) {
      throw new Error("E2E user not found.");
    }

    const guildId = args.guildId.trim();
    if (!guildId) {
      throw new Error("Discord guild id is required.");
    }

    const proofId = await recordExternalControlProof(ctx.db, {
      userId: user._id,
      assetType: "discord_guild",
      assetExternalId: guildId,
      ...(args.guildName !== undefined ? { assetDisplayName: args.guildName } : {}),
      controlLevel: args.controlLevel ?? "administrator",
      evidenceSource: "discord_oauth",
      evidenceSummary: "Seeded by the E2E helper.",
      now: Date.now(),
    });

    return { proofId };
  },
});


export const cleanupAuthUserByEmail = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper(args.secret);

    const email = normalizeE2eEmail(args.email);

    return await cleanupE2eUserByEmail(ctx, email);
  },
});

export const submitProfile = mutation({
  args: {
    secret: v.string(),
    runId: v.string(),
    profileType,
    displayName: v.string(),
    aliases: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    headline: v.optional(v.string()),
    bio: v.optional(v.string()),
    about: v.optional(v.string()),
    region: v.optional(v.string()),
    timezone: v.optional(v.string()),
    fieldVisibility: v.optional(fieldVisibility),
    person: v.optional(
      v.object({
        pronouns: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    requireE2eHelper(args.secret);

    const input = sanitizeCommunitySubmissionProfileInput(args, {
      linkSource: "community_submitted",
    });
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
    const headline = optionalText(args.headline, 160);
    const bio = optionalText(args.bio, 600);
    const about = optionalText(args.about, 1_200);
    const region = optionalText(args.region, 80);
    const timezone = optionalText(args.timezone, 80);
    const pronouns = optionalText(args.person?.pronouns, 80);
    const sharedFields = {
      slug,
      displayName: input.displayName,
      sortName: input.sortName,
      aliases: input.aliases,
      tags: input.tags,
      ...(headline !== undefined ? { headline } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(about !== undefined ? { about } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(args.fieldVisibility !== undefined ? { fieldVisibility: args.fieldVisibility } : {}),
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

    const profileId = await ctx.db.insert(
      "profiles",
      input.profileType === "person"
        ? {
            ...sharedFields,
            profileType: "person",
            person: {
              ...(pronouns !== undefined ? { pronouns } : {}),
              roleTags: input.person.roleTags,
            },
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
      profilePath: `/${slug}`,
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

    await deleteE2eProfile(ctx, profile);

    return { deleted: true };
  },
});

export const cleanupProfilesByRunId = mutation({
  args: {
    secret: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireE2eHelper(args.secret);

    const runId = args.runId.trim().slice(0, 120);

    if (!runId) {
      throw new Error("E2E cleanup requires a runId.");
    }

    const sourceToken = `e2e:${runId.slice(0, 80)}`;
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_sourceSubmitterTokenIdentifier", (query) => query.eq("sourceAttribution.submitter.tokenIdentifier", sourceToken))
      .collect();
    const matchingProfiles = profiles.filter((profile) => profile.sourceAttribution?.submitter.subject === runId);

    await Promise.all(matchingProfiles.map((profile) => deleteE2eProfile(ctx, profile)));

    return { deleted: matchingProfiles.length };
  },
});
