import { v } from "convex/values";

import { getLinkedProviderAccount, requireVerifiedEmailUser } from "./accounts";
import { toAuthSubject } from "./_communityAuthority";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { approveProfileClaimForUser, getActiveProfileOwner } from "./_profileOwnership";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

const DAY_MS = 86_400_000;
const vrchatTargetType = v.union(
  v.literal("vrchat_user"),
  v.literal("vrchat_group"),
  v.literal("vrclinking"),
);

type VrchatTargetType = Doc<"profileVerificationAttempts">["targetType"];
type VerificationAttemptAdapterContext = {
  attempt: Doc<"profileVerificationAttempts">;
  profile: {
    id: Id<"profiles">;
    slug: string;
    profileType: Doc<"profiles">["profileType"];
    displayName: string;
  };
};
type VerifyAdapterResult =
  | { state: Doc<"profileVerificationAttempts">["state"] }
  | {
      claimRequestId: Id<"profileClaimRequests">;
      profileId: Id<"profiles">;
      claimState: Doc<"profiles">["claimState"];
    };

async function requireLinkedDiscordAccount(ctx: Parameters<typeof getLinkedProviderAccount>[0], userId: Parameters<typeof getLinkedProviderAccount>[1]) {
  const account = await getLinkedProviderAccount(ctx, userId, "discord");

  if (account === null) {
    throw new Error("A linked Discord account is required for this claim method.");
  }

  return account;
}

async function getClaimableProfileBySlug(
  ctx: Parameters<typeof getProfileBySlug>[0],
  slug: string,
  expectedProfileType: "person" | "community",
) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw new Error("A valid profile slug is required.");
  }

  const profile = await getProfileBySlug(ctx, validation.slug);

  if (profile === null) {
    throw new Error("Profile not found.");
  }

  if (profile.profileType !== expectedProfileType) {
    throw new Error(`This claim method requires a ${expectedProfileType} profile.`);
  }

  return profile;
}

function proofMethodForTarget(targetType: VrchatTargetType): Doc<"profileVerificationAttempts">["method"] {
  if (targetType === "vrchat_user") {
    return "vrchat_user_proof";
  }

  if (targetType === "vrchat_group") {
    return "vrchat_group_proof";
  }

  return "vrclinking_attestation";
}

function requireCompatibleProofTarget(profile: Doc<"profiles">, targetType: VrchatTargetType) {
  if (targetType === "vrchat_user" && profile.profileType !== "person") {
    throw new Error("VRChat user proof requires a person profile.");
  }

  if (targetType === "vrchat_group" && profile.profileType !== "community") {
    throw new Error("VRChat group proof requires a community profile.");
  }
}

function createProofCode(): string {
  return `VRDEX-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function requiredAdapterUrl(): string {
  const value = process.env.VRCHAT_PROOF_ADAPTER_URL?.trim();

  if (!value) {
    throw new Error("VRCHAT_PROOF_ADAPTER_URL is not configured.");
  }

  return value;
}

export const claimExistingPersonWithDiscord = mutation({
  args: {
    profileSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const [user, identity] = await Promise.all([
      requireVerifiedEmailUser(ctx),
      ctx.auth.getUserIdentity(),
    ]);
    const [profile, discordAccount] = await Promise.all([
      getClaimableProfileBySlug(ctx.db, args.profileSlug, "person"),
      requireLinkedDiscordAccount(ctx, user._id),
    ]);
    const now = Date.now();
    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: "person",
      requestedDisplayName: profile.displayName,
      userId: user._id,
      method: "discord_person",
      state: "approved",
      evidenceSource: "discord_api",
      evidenceSummary: `Linked Discord account ${discordAccount.providerAccountId} claimed person profile.`,
      createdAt: now,
      updatedAt: now,
      verifiedAt: now,
      reviewedAt: now,
    });

    await approveProfileClaimForUser(ctx.db, {
      profile,
      profileId: profile._id,
      userId: user._id,
      grantedByClaimRequestId: claimRequestId,
      verified: false,
      now,
      ...(identity !== null ? { actor: toAuthSubject(identity) } : {}),
      note: "Discord person claim grants owner control without stronger profile verification.",
    });

    const updatedProfile = await ctx.db.get(profile._id);
    if (updatedProfile !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(updatedProfile));
    }

    return {
      claimRequestId,
      profileId: profile._id,
      claimState: updatedProfile?.claimState ?? profile.claimState,
      profilePath: `/p/${profile.slug}`,
    };
  },
});

export const requestCommunityDiscordAdminClaim = mutation({
  args: {
    profileSlug: v.string(),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const [profile, discordAccount] = await Promise.all([
      getClaimableProfileBySlug(ctx.db, args.profileSlug, "community"),
      requireLinkedDiscordAccount(ctx, user._id),
    ]);
    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);

    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw new Error("This community profile already has an active owner.");
    }

    if (activeOwner !== null) {
      return {
        profileId: profile._id,
        profilePath: `/c/${profile.slug}`,
        state: "already_owned" as const,
      };
    }

    const now = Date.now();
    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: "community",
      requestedDisplayName: profile.displayName,
      userId: user._id,
      method: "discord_community_admin",
      state: "pending",
      discordGuildId: args.discordGuildId.trim(),
      ...(args.discordGuildName?.trim() ? { discordGuildName: args.discordGuildName.trim() } : {}),
      evidenceSource: "discord_api",
      evidenceSummary: `Linked Discord account ${discordAccount.providerAccountId} requested Administrator verification.`,
      createdAt: now,
      updatedAt: now,
    });

    return {
      claimRequestId,
      profileId: profile._id,
      profilePath: `/c/${profile.slug}`,
      state: "pending_admin_verification" as const,
    };
  },
});

export const recordDiscordCommunityAdminApproval = internalMutation({
  args: {
    claimRequestId: v.id("profileClaimRequests"),
    evidenceSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const claimRequest = await ctx.db.get(args.claimRequestId);

    if (claimRequest === null) {
      throw new Error("Claim request not found.");
    }

    if (claimRequest.method !== "discord_community_admin" || claimRequest.state !== "pending") {
      throw new Error("Only pending Discord community admin claims can be approved this way.");
    }

    if (claimRequest.profileId === undefined) {
      throw new Error("Claim request is missing a profile target.");
    }

    const profile = await ctx.db.get(claimRequest.profileId);

    if (profile === null || profile.profileType !== "community") {
      throw new Error("Community profile not found.");
    }

    const now = Date.now();

    await ctx.db.patch(claimRequest._id, {
      state: "approved",
      evidenceSummary: args.evidenceSummary,
      verifiedAt: now,
      reviewedAt: now,
      updatedAt: now,
    });
    await approveProfileClaimForUser(ctx.db, {
      profile,
      profileId: profile._id,
      userId: claimRequest.userId,
      grantedByClaimRequestId: claimRequest._id,
      verified: true,
      now,
      note: "Discord Administrator permission verified by the Discord claim adapter.",
    });

    const updatedProfile = await ctx.db.get(profile._id);
    if (updatedProfile !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(updatedProfile));
    }

    return {
      profileId: profile._id,
      claimState: updatedProfile?.claimState ?? profile.claimState,
    };
  },
});

export const startVrchatProof = mutation({
  args: {
    profileSlug: v.string(),
    targetType: vrchatTargetType,
    targetExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await getClaimableProfileBySlug(
      ctx.db,
      args.profileSlug,
      args.targetType === "vrchat_group" ? "community" : "person",
    );
    requireCompatibleProofTarget(profile, args.targetType);

    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);
    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw new Error("This profile already has an active owner.");
    }

    const targetExternalId = args.targetExternalId.trim();
    if (!targetExternalId) {
      throw new Error("A VRChat or VRCLinking target id is required.");
    }

    const now = Date.now();
    const attemptId = await ctx.db.insert("profileVerificationAttempts", {
      profileId: profile._id,
      userId: user._id,
      method: proofMethodForTarget(args.targetType),
      targetType: args.targetType,
      targetExternalId,
      proofCode: createProofCode(),
      state: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + DAY_MS,
    });
    const attempt = await ctx.db.get(attemptId);

    if (attempt === null) {
      throw new Error("Unable to create verification attempt.");
    }

    return {
      attemptId,
      profileId: profile._id,
      proofCode: attempt.proofCode,
      expiresAt: attempt.expiresAt,
    };
  },
});

export const getVerificationAttemptForAdapter = internalQuery({
  args: {
    attemptId: v.id("profileVerificationAttempts"),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);

    if (attempt === null) {
      return null;
    }

    const profile = await ctx.db.get(attempt.profileId);

    if (profile === null) {
      return null;
    }

    return {
      attempt,
      profile: {
        id: profile._id,
        slug: profile.slug,
        profileType: profile.profileType,
        displayName: profile.displayName,
      },
    };
  },
});

export const recordVrchatProofVerification = internalMutation({
  args: {
    attemptId: v.id("profileVerificationAttempts"),
    evidenceSource: v.union(v.literal("vrchat_api"), v.literal("vrclinking"), v.literal("manual")),
    evidenceSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);

    if (attempt === null) {
      throw new Error("Verification attempt not found.");
    }

    if (attempt.state !== "pending") {
      throw new Error("Only pending verification attempts can be approved.");
    }

    const now = Date.now();
    if (attempt.expiresAt < now) {
      await ctx.db.patch(attempt._id, { state: "expired", updatedAt: now });
      throw new Error("Verification attempt has expired.");
    }

    const profile = await ctx.db.get(attempt.profileId);
    if (profile === null) {
      throw new Error("Profile not found.");
    }

    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: profile.profileType,
      requestedDisplayName: profile.displayName,
      userId: attempt.userId,
      method: attempt.method,
      state: "approved",
      vrchatTargetId: attempt.targetExternalId,
      evidenceSource: args.evidenceSource,
      evidenceSummary: args.evidenceSummary,
      createdAt: now,
      updatedAt: now,
      verifiedAt: now,
      reviewedAt: now,
    });

    await ctx.db.patch(attempt._id, {
      state: "verified",
      evidenceSource: args.evidenceSource,
      evidenceSummary: args.evidenceSummary,
      verifiedAt: now,
      updatedAt: now,
    });
    await approveProfileClaimForUser(ctx.db, {
      profile,
      profileId: profile._id,
      userId: attempt.userId,
      grantedByClaimRequestId: claimRequestId,
      verified: true,
      now,
      note: "External profile proof code was verified by the VRChat proof adapter.",
    });

    const updatedProfile = await ctx.db.get(profile._id);
    if (updatedProfile !== null) {
      await upsertSearchDocument(ctx.db, createProfileSearchDocument(updatedProfile));
    }

    return {
      claimRequestId,
      profileId: profile._id,
      claimState: updatedProfile?.claimState ?? profile.claimState,
    };
  },
});

export const recordVrchatProofFailure = internalMutation({
  args: {
    attemptId: v.id("profileVerificationAttempts"),
    evidenceSource: v.optional(v.union(v.literal("vrchat_api"), v.literal("vrclinking"), v.literal("manual"))),
    evidenceSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);

    if (attempt === null) {
      throw new Error("Verification attempt not found.");
    }

    if (attempt.state !== "pending") {
      return { state: attempt.state };
    }

    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      state: attempt.expiresAt < now ? "expired" : "failed",
      ...(args.evidenceSource !== undefined ? { evidenceSource: args.evidenceSource } : {}),
      evidenceSummary: args.evidenceSummary,
      updatedAt: now,
    });

    return { state: attempt.expiresAt < now ? "expired" : "failed" };
  },
});

export const verifyVrchatProofViaAdapter = action({
  args: {
    attemptId: v.id("profileVerificationAttempts"),
  },
  handler: async (ctx, args): Promise<VerifyAdapterResult> => {
    const attemptContext = (await ctx.runQuery(internal.profileClaims.getVerificationAttemptForAdapter, {
      attemptId: args.attemptId,
    })) as VerificationAttemptAdapterContext | null;

    if (attemptContext === null) {
      throw new Error("Verification attempt not found.");
    }

    if (attemptContext.attempt.state !== "pending") {
      return { state: attemptContext.attempt.state };
    }

    const adapterUrl = requiredAdapterUrl();
    const response = await fetch(adapterUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        targetType: attemptContext.attempt.targetType,
        targetExternalId: attemptContext.attempt.targetExternalId,
        proofCode: attemptContext.attempt.proofCode,
        profile: attemptContext.profile,
      }),
    });

    if (!response.ok) {
      await ctx.runMutation(internal.profileClaims.recordVrchatProofFailure, {
        attemptId: args.attemptId,
        evidenceSource: "manual",
        evidenceSummary: `Proof adapter returned HTTP ${response.status}.`,
      });

      return { state: "failed" as const };
    }

    const result = (await response.json()) as {
      verified?: boolean;
      evidenceSource?: "vrchat_api" | "vrclinking" | "manual";
      evidenceSummary?: string;
    };

    if (result.verified !== true) {
      await ctx.runMutation(internal.profileClaims.recordVrchatProofFailure, {
        attemptId: args.attemptId,
        evidenceSource: result.evidenceSource ?? "manual",
        evidenceSummary: result.evidenceSummary ?? "Proof code was not found by the adapter.",
      });

      return { state: "failed" as const };
    }

    return await ctx.runMutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId: args.attemptId,
      evidenceSource: result.evidenceSource ?? "vrchat_api",
      evidenceSummary: result.evidenceSummary ?? "Proof code was found by the configured adapter.",
    });
  },
});
