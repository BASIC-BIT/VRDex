import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { recordExternalControlProof } from "./_externalControl";
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

function normalizeE2eEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized.endsWith("@e2e.vrdex.local")) {
    throw new Error("E2E auth helpers only accept @e2e.vrdex.local emails.");
  }

  return normalized;
}

async function deleteE2eAuthCodes(ctx: MutationCtx, email: string) {
  const codes = await ctx.db.query("e2eAuthCodes").withIndex("by_email", (query) => query.eq("email", email)).collect();

  await Promise.all(codes.map((code) => ctx.db.delete(code._id)));
}

async function deleteE2eProfile(ctx: MutationCtx, profile: Doc<"profiles">) {
  if (!profile.sourceAttribution?.submitter.tokenIdentifier.startsWith("e2e:")) {
    throw new Error("Only E2E-created profiles can be cleaned up by this helper.");
  }

  const [searchDocuments, auditEvents, owners, claimRequests, verificationAttempts, externalLinks] = await Promise.all([
    ctx.db.query("searchDocuments").withIndex("by_profileId", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileAuditEvents").withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileOwners").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileClaimRequests").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    ctx.db.query("profileVerificationAttempts").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id)).collect(),
    // Created when a community claim pairs a control proof with the profile.
    ctx.db.query("profileExternalLinks").withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id).eq("state", "active")).collect(),
  ]);

  await Promise.all([
    ...searchDocuments.map((document) => ctx.db.delete(document._id)),
    ...auditEvents.map((event) => ctx.db.delete(event._id)),
    ...owners.map((owner) => ctx.db.delete(owner._id)),
    ...claimRequests.map((claimRequest) => ctx.db.delete(claimRequest._id)),
    ...verificationAttempts.map((attempt) => ctx.db.delete(attempt._id)),
    ...externalLinks.map((link) => ctx.db.delete(link._id)),
    ctx.db.delete(profile._id),
  ]);
}

async function userByEmail(ctx: MutationCtx, email: string) {
  return await ctx.db.query("users").withIndex("email", (query) => query.eq("email", email)).unique();
}

async function cleanupE2eUserByEmail(ctx: MutationCtx, email: string) {
  const user = await userByEmail(ctx, email);

  await deleteE2eAuthCodes(ctx, email);

  if (user === null) {
    return { deleted: false };
  }

  await cleanupE2eDeveloperCredentials(ctx, user._id);

  const [accounts, sessions, claimRequests, verificationAttempts, profileOwners, controlProofs] = await Promise.all([
    ctx.db.query("authAccounts").withIndex("userIdAndProvider", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("authSessions").withIndex("userId", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("profileClaimRequests").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("profileVerificationAttempts").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    ctx.db.query("profileOwners").withIndex("by_userId_state", (query) => query.eq("userId", user._id)).collect(),
    // Seeded by the claim flow through the record-guild-proof helper; without
    // this, every shared-staging run leaves a dangling proof behind.
    ctx.db.query("externalControlProofs").withIndex("by_userId_state", (query) => query.eq("userId", user._id).eq("state", "active")).collect(),
  ]);
  const verificationCodes = await Promise.all(
    accounts.map((account) => ctx.db.query("authVerificationCodes").withIndex("accountId", (query) => query.eq("accountId", account._id)).collect()),
  );
  const refreshTokens = await Promise.all(
    sessions.map((session) => ctx.db.query("authRefreshTokens").withIndex("sessionId", (query) => query.eq("sessionId", session._id)).collect()),
  );

  await Promise.all([
    ...verificationCodes.flat().map((code) => ctx.db.delete(code._id)),
    ...refreshTokens.flat().map((token) => ctx.db.delete(token._id)),
    ...claimRequests.map((claimRequest) => ctx.db.delete(claimRequest._id)),
    ...verificationAttempts.map((attempt) => ctx.db.delete(attempt._id)),
    ...profileOwners.map((owner) => ctx.db.delete(owner._id)),
    ...controlProofs.map((proof) => ctx.db.delete(proof._id)),
    ...accounts.map((account) => ctx.db.delete(account._id)),
    ...sessions.map((session) => ctx.db.delete(session._id)),
    ctx.db.delete(user._id),
  ]);

  return { deleted: true };
}

async function cleanupE2eDeveloperCredentials(ctx: MutationCtx, userId: Doc<"users">["_id"]) {
  const [apiTokens, apiTokenEvents, oauthApplications, oauthAuthorizationCodes, oauthRefreshTokens, oauthClientEvents] =
    await Promise.all([
      ctx.db.query("apiTokens").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("apiTokenEvents").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("oauthApplications").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
      ctx.db.query("oauthAuthorizationCodes").withIndex("by_userId_createdAt", (query) => query.eq("userId", userId)).collect(),
      ctx.db.query("oauthRefreshTokens").withIndex("by_userId_expiresAt", (query) => query.eq("userId", userId)).collect(),
      ctx.db.query("oauthClientEvents").withIndex("by_ownerUserId_createdAt", (query) => query.eq("ownerUserId", userId)).collect(),
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
  ]);
  await Promise.all(oauthApplications.map((application) => ctx.db.delete(application._id)));
}

export const recordAuthCode = internalMutation({
  args: {
    email: v.string(),
    code: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper();

    const email = normalizeE2eEmail(args.email);
    await deleteE2eAuthCodes(ctx, email);

    return await ctx.db.insert("e2eAuthCodes", {
      email,
      code: args.code,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
  },
});

export const consumeAuthCode = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper(args.secret);

    const email = normalizeE2eEmail(args.email);
    const codes = await ctx.db.query("e2eAuthCodes").withIndex("by_email", (query) => query.eq("email", email)).collect();
    const code = [...codes].sort((left, right) => right._creationTime - left._creationTime)[0];

    if (code === undefined || code.expiresAt < Date.now()) {
      throw new Error("No active E2E auth code found for this email.");
    }

    await Promise.all(codes.map((entry) => ctx.db.delete(entry._id)));

    return { code: code.code };
  },
});

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

    const existing = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (query) => query.eq("userId", user._id).eq("provider", "discord"))
      .unique();

    if (existing !== null) {
      await ctx.db.patch(existing._id, { providerAccountId, emailVerified: email });
      return { linked: true };
    }

    await ctx.db.insert("authAccounts", {
      userId: user._id,
      provider: "discord",
      providerAccountId,
      emailVerified: email,
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

export const setAuthSessionStateByEmail = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    state: v.union(
      v.literal("absolute_expired"),
      v.literal("inactive_expired"),
      v.literal("invalid_refresh"),
      v.literal("revoked"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    requireE2eAuthHelper(args.secret);

    const email = normalizeE2eEmail(args.email);
    const user = await userByEmail(ctx, email);

    if (user === null) {
      throw new Error("E2E user not found.");
    }

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (query) => query.eq("userId", user._id))
      .collect();
    const session = [...sessions].sort(
      (left, right) => right._creationTime - left._creationTime,
    )[0];

    if (session === undefined) {
      throw new Error("E2E auth session not found.");
    }

    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (query) => query.eq("sessionId", session._id))
      .collect();

    if (args.state === "absolute_expired") {
      await ctx.db.patch(session._id, { expirationTime: args.now - 1 });
    } else if (args.state === "inactive_expired") {
      await Promise.all(
        refreshTokens
          .filter((token) => token.firstUsedTime === undefined)
          .map((token) =>
            ctx.db.patch(token._id, { expirationTime: args.now - 1 }),
          ),
      );
    } else if (args.state === "invalid_refresh") {
      await Promise.all(
        refreshTokens
          .filter((token) => token.firstUsedTime === undefined)
          .map((token) => ctx.db.delete(token._id)),
      );
    } else {
      await Promise.all(refreshTokens.map((token) => ctx.db.delete(token._id)));
      await ctx.db.delete(session._id);
    }

    return {
      state: args.state,
      affectedRefreshTokens: refreshTokens.length,
    };
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
