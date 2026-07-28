import { v } from "convex/values";

import { getLinkedProviderAccount } from "./accounts";
import { boundedFetch } from "./_boundedFetch";
import { claimError } from "./_claimErrors";
import {
  claimSessionUserOrNull,
  requireClaimSession,
  requireVerifiedActiveBrowserSession,
} from "./_claimSession";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  getActiveProfileLinks,
  linkProfileToAsset,
  recordExternalControlProof,
} from "./_externalControl";
import { createClaimedDiscordProfileForUser } from "./_profileClaimCreation";
import { approveProfileClaimForUser, getActiveProfileOwner, userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";
import { normalizeVrchatTargetId } from "./_vrchatIdentity";

const DAY_MS = 86_400_000;
// Minimum gap between delegated VRC Linking consultations for one attempt.
const VRCLINKING_CHECK_COOLDOWN_MS = 60_000;
// Bounds provider spend that the per-attempt cooldown alone cannot: one
// claimant creating many attempts and having each consulted once. Applies to
// every proof target — the collector fleet polls `vrchat_user`/`vrchat_group`
// attempts against a shared service-account budget just as delegated VRC
// Linking credentials are spent, so an unbounded backlog is the same abuse
// either way.
const MAX_OPEN_PROOF_ATTEMPTS = 3;
const DISCORD_ADMINISTRATOR_PERMISSION = BigInt(8);
const DISCORD_GUILD_ID_PATTERN = /^\d{17,20}$/;
const noSuitableMatchConfirmed = v.boolean();
const vrchatTargetType = v.union(
  v.literal("vrchat_user"),
  v.literal("vrchat_group"),
  v.literal("vrclinking"),
);
const claimedPersonProfileArgs = {
  noSuitableMatchConfirmed,
  displayName: v.string(),
  aliases: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  person: v.optional(
    v.object({
      roleTags: v.optional(v.array(v.string())),
    }),
  ),
};
const claimedCommunityProfileArgs = {
  noSuitableMatchConfirmed,
  displayName: v.string(),
  aliases: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  community: v.optional(
    v.object({
      subtype: v.optional(v.string()),
      categoryTags: v.optional(v.array(v.string())),
    }),
  ),
};

export const getClaimTargetBySlug = query({
  args: {
    profileSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.profileSlug);
    if (!validation.ok) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);
    if (profile === null) {
      return null;
    }

    const user = await claimSessionUserOrNull(ctx);
    const hasPublicProfile = canReadProfile("public", profile);
    const isOwner = user !== null && await userOwnsProfile(ctx.db, profile._id, user._id);
    if (!hasPublicProfile && !isOwner) {
      return null;
    }

    return {
      avatarImageUrl: profile.avatarImageUrl,
      displayName: profile.displayName,
      hasPublicProfile,
      profileId: profile._id,
      profileType: profile.profileType,
      slug: profile.slug,
    };
  },
});

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
type DiscordCommunityClaimAdapterContext = {
  claimRequest: Doc<"profileClaimRequests">;
  discordUserId: string;
};
type VerifyAdapterResult =
  | { state: Doc<"profileVerificationAttempts">["state"] }
  | { state: "unavailable" }
  // No adapter configured for this target: the collector fleet reads it on its
  // own schedule, so nothing was checked just now. Distinct from `pending`,
  // which means we asked and the code was not there.
  | { state: "queued" }
  | {
      // Absent when the proof only added a connection to a profile the caller
      // already owns — no claim was requested, so no claim request exists.
      claimRequestId: Id<"profileClaimRequests"> | undefined;
      profileId: Id<"profiles">;
      claimState: Doc<"profiles">["claimState"];
    };
type DiscordAdminAdapterResult =
  | { state: Doc<"profileClaimRequests">["state"] }
  | {
      profileId: Id<"profiles">;
      claimState: Doc<"profiles">["claimState"];
    };
type DiscordGuild = {
  id: string;
  name?: string;
  owner_id?: string;
};
type DiscordGuildMember = {
  user?: { id?: string };
  roles?: string[];
};
type DiscordRole = {
  id: string;
  name?: string;
  permissions: string;
};
type ProofAdapterResponse = {
  verified?: boolean;
  evidenceSource?: "vrchat_api" | "vrclinking" | "manual";
  evidenceSummary?: string;
  /** Set by the VRC Linking adapter to name the delegation that answered. */
  matchedGuildId?: string;
  /** Index into the delegations sent; unambiguous when guilds repeat. */
  matchedDelegationIndex?: number;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);

  if (!value) {
    // Surfaces as "this method is not available yet" rather than a redacted
    // server error, which is what made the missing production adapter
    // configuration so hard to diagnose.
    throw claimError("ADAPTER_NOT_CONFIGURED", name);
  }

  return value;
}

async function requireLinkedDiscordAccount(ctx: Parameters<typeof getLinkedProviderAccount>[0], userId: Parameters<typeof getLinkedProviderAccount>[1]) {
  const account = await getLinkedProviderAccount(ctx, userId, "discord");

  if (account === null) {
    throw claimError("DISCORD_NOT_LINKED");
  }

  return account;
}

/**
 * A hidden listing must not be claimable by slug.
 *
 * Every claim *query* gates on `canReadProfile`, but the mutations resolved the
 * profile without it, so knowing or guessing the slug of an unowned draft,
 * opted-out, or safety-suppressed profile was enough to take ownership of it —
 * past the UI's not-found boundary and past the moderation state that hid it.
 * An existing owner still passes: they can already see their own profile.
 */
function requireClaimableVisibility(
  profile: Doc<"profiles">,
  activeOwner: { userId: Id<"users"> } | null,
  userId: Id<"users">,
) {
  if (activeOwner?.userId === userId) {
    return;
  }

  if (!canReadProfile("public", profile)) {
    throw claimError("PROFILE_NOT_FOUND");
  }
}

async function getClaimableProfileBySlug(
  ctx: Parameters<typeof getProfileBySlug>[0],
  slug: string,
  expectedProfileType: "person" | "community",
) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw claimError("INVALID_PROFILE_SLUG");
  }

  const profile = await getProfileBySlug(ctx, validation.slug);

  if (profile === null) {
    throw claimError("PROFILE_NOT_FOUND");
  }

  if (profile.profileType !== expectedProfileType) {
    throw claimError("WRONG_PROFILE_TYPE", expectedProfileType);
  }

  return profile;
}

function requireNoSuitableMatchConfirmed(confirmed: boolean) {
  if (confirmed !== true) {
    throw new Error("Confirm that no suitable unclaimed profile match exists before creating a new claimed profile.");
  }
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

function proofEvidenceSourceForTarget(
  targetType: VrchatTargetType,
): "vrchat_api" | "vrclinking" {
  return targetType === "vrclinking" ? "vrclinking" : "vrchat_api";
}

function requireCompatibleProofTarget(profile: Doc<"profiles">, targetType: VrchatTargetType) {
  if (targetType === "vrchat_user" && profile.profileType !== "person") {
    throw claimError("WRONG_PROFILE_TYPE", "person");
  }

  if (targetType === "vrchat_group" && profile.profileType !== "community") {
    throw claimError("WRONG_PROFILE_TYPE", "community");
  }

  // A VRC Linking attestation names a VRChat *account*, so it belongs to a
  // person profile. The caller's lookup already resolves `vrclinking` against
  // `"person"` and throws before reaching here, but stating it locally means the
  // constraint survives someone editing that ternary — otherwise a community
  // attempt would persist a `vrchat_user` asset on a community profile and
  // violate `assetTypeAllowedForProfile`.
  if (targetType === "vrclinking" && profile.profileType !== "person") {
    throw claimError("WRONG_PROFILE_TYPE", "person");
  }
}

/**
 * Audit provenance for a verified proof.
 *
 * One fixed string claimed a proof code was read by the VRChat proof adapter,
 * which is wrong for both other paths now reaching this mutation: VRC Linking
 * never uses the proof code, and collector reads involve no adapter. Support
 * and audit consumers should not have to know that.
 */
function proofAuditNote(
  targetType: VrchatTargetType,
  evidenceSource: Doc<"profileVerificationAttempts">["evidenceSource"],
): string {
  if (targetType === "vrclinking") {
    return "VRC Linking reported a verified Discord-to-VRChat link for this claimant.";
  }

  return evidenceSource === "vrchat_api"
    ? "The proof code was found on the VRChat target by the collector fleet."
    : "The proof code was found on the VRChat target by the configured proof adapter.";
}

function createProofCode(): string {
  return `VRDEX-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export const getClaimJourneyContext = query({
  args: { profileSlug: v.string() },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.profileSlug);
    if (!validation.ok) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);
    if (profile === null) {
      return null;
    }

    const user = await claimSessionUserOrNull(ctx);
    const publiclyReadable = canReadProfile("public", profile);
    if (user === null) {
      if (!publiclyReadable) {
        return null;
      }

      return {
        ownership: "signed_out" as const,
        verified: false,
        lastVerifiedProofAt: null,
        emailVerified: false,
        hasDiscord: false,
        pendingClaimRequest: null,
        pendingProof: null,
      };
    }

    const owner = await getActiveProfileOwner(ctx.db, profile._id);
    if (!publiclyReadable && owner?.userId !== user._id) {
      return null;
    }

    const [discordAccount, pendingRequests, pendingProofs] = await Promise.all([
      getLinkedProviderAccount(ctx, user._id, "discord"),
      ctx.db
        .query("profileClaimRequests")
        .withIndex("by_profileId_userId_state_updatedAt", (q) =>
          q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("profileVerificationAttempts")
        .withIndex("by_profileId_userId_state_updatedAt", (q) =>
          q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
        )
        .filter((q) => q.neq(q.field("targetType"), "vrclinking"))
        .order("desc")
        .first(),
    ]);
    const request = pendingRequests;
    const proof = pendingProofs;
    // The most recent attempt that has already settled. A pending proof simply
    // disappearing is not evidence it succeeded — the hourly expiry cron and a
    // cancellation from another tab both remove it — so the UI needs the
    // terminal state to tell a completion from either of those.
    const settledProof = await ctx.db
      .query("profileVerificationAttempts")
      .withIndex("by_profileId_userId_state_updatedAt", (q) =>
        q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "verified"),
      )
      .order("desc")
      .first();

    return {
      ownership:
        owner === null ? ("available" as const) : owner.userId === user._id ? ("viewer" as const) : ("other" as const),
      verified: profile.claimState === "claimed_verified",
      emailVerified: user.email !== undefined && user.emailVerificationTime !== undefined,
      hasDiscord: discordAccount !== null,
      pendingClaimRequest: request
        ? {
            id: request._id,
            method: request.method,
            discordGuildId: request.discordGuildId,
            discordGuildName: request.discordGuildName,
          }
        : null,
      // Only the verified terminal state is reported. `expired` and `failed`
      // attempts are absences, not outcomes to announce.
      lastVerifiedProofAt: settledProof?.verifiedAt ?? null,
      pendingProof: proof
        ? {
            id: proof._id,
            targetType: proof.targetType,
            targetExternalId: proof.targetExternalId,
            proofCode: proof.proofCode,
            expiresAt: proof.expiresAt,
            expired: proof.expiresAt <= Date.now(),
          }
        : null,
    };
  },
});

export const cancelClaimJourneyPending = mutation({
  args: {
    profileSlug: v.string(),
    pendingType: v.union(v.literal("claim_request"), v.literal("proof")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireClaimSession(ctx);
    const validation = validateProfileSlug(args.profileSlug);
    if (!validation.ok) {
      throw claimError("INVALID_PROFILE_SLUG");
    }
    const profile = await getProfileBySlug(ctx.db, validation.slug);
    if (profile === null) {
      throw claimError("PROFILE_NOT_FOUND");
    }

    const now = Date.now();

    if (args.pendingType === "claim_request") {
      const request = await ctx.db
        .query("profileClaimRequests")
        .withIndex("by_profileId_userId_state_updatedAt", (q) =>
          q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
        )
        .order("desc")
        .first();
      if (request === null) {
        return { canceled: false };
      }
      await ctx.db.patch(request._id, {
        state: "rejected",
        rejectionReason: "Canceled by claimant.",
        reviewedAt: now,
        updatedAt: now,
      });
      return { canceled: true };
    }

    const proof = await ctx.db
      .query("profileVerificationAttempts")
      .withIndex("by_profileId_userId_state_updatedAt", (q) =>
        q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
      )
      .filter((q) => q.neq(q.field("targetType"), "vrclinking"))
      .order("desc")
      .first();
    if (proof === null) {
      return { canceled: false };
    }
    await ctx.db.patch(proof._id, {
      state: proof.expiresAt <= now ? "expired" : "failed",
      evidenceSummary: "Canceled by claimant.",
      updatedAt: now,
    });
    return { canceled: true };
  },
});

/**
 * Adapter endpoint for a proof target, or null when none is configured.
 *
 * VRC Linking has no other reader, so a missing endpoint there is a
 * misconfiguration. VRChat targets are read by the collector fleet in
 * production, where `VRCHAT_PROOF_ADAPTER_URL` is deliberately unset — treating
 * that as an error is what made "Check proof now" fail in the first place, so
 * an absent VRChat adapter means "the collector has this", not "broken".
 */
function proofAdapterUrl(targetType: VrchatTargetType): string | null {
  if (targetType === "vrclinking") {
    return requiredEnv("VRCLINKING_PROOF_ADAPTER_URL");
  }

  return optionalEnv("VRCHAT_PROOF_ADAPTER_URL") ?? null;
}

/**
 * Both adapters require this bearer token, so treating it as optional here only
 * bought a silent failure: Convex would post with no `authorization`, the
 * adapter would answer 401, and `!response.ok` maps that to the non-terminal
 * `unavailable` — a claim that stalls forever with the misconfiguration
 * reported nowhere. If an adapter is configured, so must its token be.
 */
function proofAdapterHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${requiredEnv("VRCHAT_PROOF_ADAPTER_BEARER_TOKEN")}`,
  };
}

async function fetchDiscordJson<T>(path: string): Promise<T> {
  const baseUrl = optionalEnv("DISCORD_API_BASE_URL") ?? "https://discord.com/api/v10";
  const response = await boundedFetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bot ${requiredEnv("DISCORD_BOT_TOKEN")}`,
    },
  });

  if (!response.ok) {
    throw claimError("ADAPTER_UNAVAILABLE", `discord_${response.status}`);
  }

  return response.body as T;
}

async function verifyDiscordAdministratorPermission(discordGuildId: string, discordUserId: string) {
  const [guild, member, roles] = await Promise.all([
    fetchDiscordJson<DiscordGuild>(`/guilds/${encodeURIComponent(discordGuildId)}`),
    fetchDiscordJson<DiscordGuildMember>(
      `/guilds/${encodeURIComponent(discordGuildId)}/members/${encodeURIComponent(discordUserId)}`,
    ),
    fetchDiscordJson<DiscordRole[]>(`/guilds/${encodeURIComponent(discordGuildId)}/roles`),
  ]);

  // The provider's own name for the guild. The claim request carries a caller-
  // supplied label, which must never reach a durable proof or link: an admin of
  // a real server could otherwise present it under a misleading name.
  const guildName = typeof guild.name === "string" && guild.name.length > 0 ? guild.name : undefined;

  if (guild.owner_id === discordUserId) {
    return {
      verified: true,
      guildName,
      evidenceSummary: `Discord user ${discordUserId} owns guild ${guild.name ?? discordGuildId}.`,
    };
  }

  const roleIds = new Set([discordGuildId, ...(member.roles ?? [])]);
  const permissions = roles
    .filter((role) => roleIds.has(role.id))
    .reduce((combined, role) => combined | BigInt(role.permissions), BigInt(0));
  const verified = (permissions & DISCORD_ADMINISTRATOR_PERMISSION) !== BigInt(0);

  return {
    verified,
    guildName,
    evidenceSummary: verified
      ? `Discord user ${discordUserId} has Administrator permission in guild ${guild.name ?? discordGuildId}.`
      : `Discord user ${discordUserId} does not have Administrator permission in guild ${guild.name ?? discordGuildId}.`,
  };
}

export const claimExistingPersonWithDiscord = mutation({
  args: {
    profileSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { subject, user } = await requireVerifiedActiveBrowserSession(ctx);
    const [profile, discordAccount] = await Promise.all([
      getClaimableProfileBySlug(ctx.db, args.profileSlug, "person"),
      requireLinkedDiscordAccount(ctx, user._id),
    ]);
    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);
    requireClaimableVisibility(profile, activeOwner, user._id);

    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw claimError("PROFILE_ALREADY_OWNED");
    }

    if (activeOwner !== null) {
      return {
        profileId: profile._id,
        claimState: profile.claimState,
        profilePath: `/p/${profile.slug}`,
        state: "already_owned" as const,
      };
    }

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
      actor: subject,
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

export const createClaimedDiscordPersonProfile = mutation({
  args: claimedPersonProfileArgs,
  handler: async (ctx, args) => {
    requireNoSuitableMatchConfirmed(args.noSuitableMatchConfirmed);

    const { subject, user } = await requireVerifiedActiveBrowserSession(ctx);
    const discordAccount = await requireLinkedDiscordAccount(ctx, user._id);

    return await createClaimedDiscordProfileForUser(ctx.db, {
      userId: user._id,
      discordProviderAccountId: discordAccount.providerAccountId,
      input: {
        profileType: "person",
        displayName: args.displayName,
        aliases: args.aliases,
        tags: args.tags,
        person: args.person,
      },
      now: Date.now(),
      actor: subject,
    });
  },
});

export const createClaimedDiscordCommunityProfile = mutation({
  args: claimedCommunityProfileArgs,
  handler: async (ctx, args) => {
    requireNoSuitableMatchConfirmed(args.noSuitableMatchConfirmed);

    const { subject, user } = await requireVerifiedActiveBrowserSession(ctx);
    const discordAccount = await requireLinkedDiscordAccount(ctx, user._id);

    return await createClaimedDiscordProfileForUser(ctx.db, {
      userId: user._id,
      discordProviderAccountId: discordAccount.providerAccountId,
      input: {
        profileType: "community",
        displayName: args.displayName,
        aliases: args.aliases,
        tags: args.tags,
        community: args.community,
      },
      now: Date.now(),
      actor: subject,
    });
  },
});

/**
 * Opens a pending Discord Administrator check for `verifyDiscordCommunityAdminClaim`
 * to resolve through the bot token.
 *
 * The claim UI now proves guild control during the OAuth round-trip and claims
 * in one step, so nothing calls this today. It is kept deliberately: it and its
 * verifier are the bot-token path, which the deferred discord-gateway work
 * builds on for ongoing re-validation, and the claim journey still resumes any
 * pending request this created.
 */
export const requestCommunityDiscordAdminClaim = mutation({
  args: {
    profileSlug: v.string(),
    discordGuildId: v.string(),
    discordGuildName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const [profile, discordAccount] = await Promise.all([
      getClaimableProfileBySlug(ctx.db, args.profileSlug, "community"),
      requireLinkedDiscordAccount(ctx, user._id),
    ]);
    const discordGuildId = args.discordGuildId.trim();
    if (!DISCORD_GUILD_ID_PATTERN.test(discordGuildId)) {
      throw claimError("INVALID_DISCORD_GUILD_ID");
    }

    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);
    requireClaimableVisibility(profile, activeOwner, user._id);

    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw claimError("PROFILE_ALREADY_OWNED");
    }

    if (activeOwner !== null) {
      return {
        profileId: profile._id,
        profilePath: `/c/${profile.slug}`,
        state: "already_owned" as const,
      };
    }

    const now = Date.now();
    const existingRequest = await ctx.db
      .query("profileClaimRequests")
      .withIndex("by_profileId_userId_state_updatedAt", (q) =>
        q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("method"), "discord_community_admin"),
          q.eq(q.field("discordGuildId"), discordGuildId),
        ),
      )
      .order("desc")
      .first();

    if (existingRequest) {
      return {
        claimRequestId: existingRequest._id,
        profileId: profile._id,
        profilePath: `/c/${profile.slug}`,
        state: "pending_admin_verification" as const,
      };
    }

    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: "community",
      requestedDisplayName: profile.displayName,
      userId: user._id,
      method: "discord_community_admin",
      state: "pending",
      discordGuildId,
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
    discordUserId: v.string(),
    guildName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const claimRequest = await ctx.db.get(args.claimRequestId);

    if (claimRequest === null) {
      throw claimError("PROOF_NOT_FOUND");
    }

    if (claimRequest.method !== "discord_community_admin" || claimRequest.state !== "pending") {
      throw claimError("PROOF_NOT_PENDING");
    }

    if (claimRequest.profileId === undefined) {
      throw claimError("PROFILE_NOT_FOUND");
    }

    const profile = await ctx.db.get(claimRequest.profileId);

    if (profile === null || profile.profileType !== "community") {
      throw claimError("PROFILE_NOT_FOUND");
    }

    const now = Date.now();
    // Same rule as the OAuth path: Administrator in a server the claimant named
    // proves they run that server, not that the server is this listing's. Read
    // before the link below is written, and only associations somebody else put
    // on record count — otherwise the claim corroborates itself on the retry.
    const guildBacksThisProfile =
      claimRequest.discordGuildId !== undefined &&
      (await getActiveProfileLinks(ctx.db, profile._id, "discord_guild")).some(
        (link) =>
          link.assetExternalId === claimRequest.discordGuildId &&
          link.linkedByUserId !== claimRequest.userId,
      );

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
      verified: guildBacksThisProfile,
      now,
      note: guildBacksThisProfile
        ? "Discord Administrator permission verified by the Discord claim adapter for a server already backing this profile."
        : "Discord Administrator permission verified by the Discord claim adapter. The server did not already back this profile, so ownership is unverified.",
    });

    // The bot-token path proves the same thing the OAuth round-trip does, so it
    // has to leave the same durable record. Without it the guild is verified but
    // absent from the connection model: nothing shows under `/account/connections`
    // and nothing can delegate a VRC Linking credential for it.
    if (claimRequest.discordGuildId !== undefined) {
      // `claimRequest.discordGuildName` is a caller-supplied label from the
      // request step. Only the name the bot read from Discord may become durable
      // — otherwise an admin of a real server could display it under any name
      // they liked.
      const displayName =
        args.guildName === undefined ? {} : { assetDisplayName: args.guildName };
      const proofId = await recordExternalControlProof(ctx.db, {
        userId: claimRequest.userId,
        assetType: "discord_guild",
        assetExternalId: claimRequest.discordGuildId,
        ...displayName,
        controlLevel: "administrator",
        evidenceSource: "discord_bot",
        evidenceSummary: args.evidenceSummary,
        // The Discord identity the bot actually checked. Reconciliation treats a
        // proof with no recorded subject as belonging to whoever verifies next,
        // so leaving this off would let a later OAuth round-trip by a different
        // Discord account revoke this one.
        evidenceSubjectId: args.discordUserId,
        now,
      });

      await linkProfileToAsset(ctx.db, {
        profileId: profile._id,
        assetType: "discord_guild",
        assetExternalId: claimRequest.discordGuildId,
        ...displayName,
        linkedByUserId: claimRequest.userId,
        verifiedByProofId: proofId,
        now,
      });
    }

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

export const getDiscordCommunityClaimForAdapter = internalQuery({
  args: {
    claimRequestId: v.id("profileClaimRequests"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const claimRequest = await ctx.db.get(args.claimRequestId);

    if (claimRequest === null) {
      throw claimError("PROOF_NOT_FOUND");
    }

    if (claimRequest.userId !== user._id) {
      throw claimError("PROOF_NOT_FOUND");
    }

    if (claimRequest.method !== "discord_community_admin" || claimRequest.state !== "pending") {
      throw claimError("PROOF_NOT_PENDING");
    }

    if (claimRequest.discordGuildId === undefined) {
      throw claimError("INVALID_DISCORD_GUILD_ID");
    }

    const discordAccount = await requireLinkedDiscordAccount(ctx, user._id);

    return {
      claimRequest,
      discordUserId: discordAccount.providerAccountId,
    } satisfies DiscordCommunityClaimAdapterContext;
  },
});

export const recordDiscordCommunityAdminRejection = internalMutation({
  args: {
    claimRequestId: v.id("profileClaimRequests"),
    evidenceSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const claimRequest = await ctx.db.get(args.claimRequestId);

    if (claimRequest === null) {
      throw claimError("PROOF_NOT_FOUND");
    }

    if (claimRequest.method !== "discord_community_admin" || claimRequest.state !== "pending") {
      return { state: claimRequest.state };
    }

    const now = Date.now();
    await ctx.db.patch(claimRequest._id, {
      state: "rejected",
      evidenceSummary: args.evidenceSummary,
      rejectionReason: "Discord Administrator permission was not verified.",
      reviewedAt: now,
      updatedAt: now,
    });

    return { state: "rejected" as const };
  },
});

export const verifyDiscordCommunityAdminClaim = action({
  args: {
    claimRequestId: v.id("profileClaimRequests"),
  },
  handler: async (ctx, args): Promise<DiscordAdminAdapterResult> => {
    const claimContext = (await ctx.runQuery(internal.profileClaims.getDiscordCommunityClaimForAdapter, {
      claimRequestId: args.claimRequestId,
    })) as DiscordCommunityClaimAdapterContext;
    const guildId = claimContext.claimRequest.discordGuildId;

    if (guildId === undefined) {
      throw claimError("INVALID_DISCORD_GUILD_ID");
    }

    const result = await verifyDiscordAdministratorPermission(guildId, claimContext.discordUserId);

    if (!result.verified) {
      return await ctx.runMutation(internal.profileClaims.recordDiscordCommunityAdminRejection, {
        claimRequestId: args.claimRequestId,
        evidenceSummary: result.evidenceSummary,
      });
    }

    return await ctx.runMutation(internal.profileClaims.recordDiscordCommunityAdminApproval, {
      claimRequestId: args.claimRequestId,
      evidenceSummary: result.evidenceSummary,
      // The identity the bot actually checked, and the provider's own name for
      // the guild — not the label the claimant typed.
      discordUserId: claimContext.discordUserId,
      ...(result.guildName !== undefined ? { guildName: result.guildName } : {}),
    });
  },
});

export const startVrchatProof = mutation({
  args: {
    profileSlug: v.string(),
    targetType: vrchatTargetType,
    targetExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await getClaimableProfileBySlug(
      ctx.db,
      args.profileSlug,
      args.targetType === "vrchat_group" ? "community" : "person",
    );
    requireCompatibleProofTarget(profile, args.targetType);

    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);
    requireClaimableVisibility(profile, activeOwner, user._id);
    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw claimError("PROFILE_ALREADY_OWNED");
    }

    // A VRC Linking attestation names a VRChat account exactly as a direct
    // proof does — it becomes the `assetExternalId` of a `self`-level
    // `vrchat_user` proof — so it gets the same validation. Trimming alone let
    // arbitrary text become the identity of a durable control proof.
    const targetExternalId = normalizeVrchatTargetId(
      args.targetExternalId,
      args.targetType === "vrclinking" ? "vrchat_user" : args.targetType,
    );
    if (!targetExternalId) {
      throw claimError("INVALID_VRCHAT_TARGET", args.targetType);
    }

    const now = Date.now();

    const pendingAttempts = await ctx.db
      .query("profileVerificationAttempts")
      .withIndex("by_profileId_userId_state_updatedAt", (q) =>
        q.eq("profileId", profile._id).eq("userId", user._id).eq("state", "pending"),
      )
      .collect();
    const existingAttempt = pendingAttempts.find(
      (attempt) =>
        attempt.userId === user._id &&
        attempt.targetType === args.targetType &&
        attempt.targetExternalId === targetExternalId &&
        attempt.expiresAt > now,
    );

    if (existingAttempt) {
      return {
        attemptId: existingAttempt._id,
        profileId: profile._id,
        proofCode: existingAttempt.proofCode,
        expiresAt: existingAttempt.expiresAt,
      };
    }

    await Promise.all(
      pendingAttempts
        .filter((attempt) => attempt.expiresAt <= now)
        .map((attempt) => ctx.db.patch(attempt._id, { state: "expired", updatedAt: now })),
    );

    // A per-attempt cooldown alone is bypassable: unlimited pending attempts,
    // each read once, still spends provider quota one attempt at a time. Cap
    // how many of a given target type a claimant may hold open. Counted per
    // type so a VRC Linking backlog cannot lock someone out of VRChat proofs,
    // and checked only on the create path so re-reading an existing code always
    // works — the cap is on how much polling a claimant can queue, not on
    // reading back what they already queued.
    const openAttempts = await ctx.db
      .query("profileVerificationAttempts")
      .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "pending"))
      .collect();

    if (
      openAttempts.filter(
        (attempt) => attempt.targetType === args.targetType && attempt.expiresAt > now,
      ).length >= MAX_OPEN_PROOF_ATTEMPTS
    ) {
      // Its own code, not `PROOF_NOT_PENDING`: nothing was created and nothing
      // was resolved, and the outstanding attempts may well be on other
      // profiles, so the copy has to point somewhere the claimant can act.
      throw claimError("TOO_MANY_OPEN_PROOFS", args.targetType);
    }

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
      throw claimError("PROOF_NOT_FOUND");
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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const attempt = await ctx.db.get(args.attemptId);

    if (attempt === null) {
      return null;
    }

    if (attempt.userId !== user._id) {
      throw claimError("PROOF_NOT_FOUND");
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
      throw claimError("PROOF_NOT_FOUND");
    }

    if (attempt.state !== "pending") {
      throw claimError("PROOF_NOT_PENDING");
    }

    const now = Date.now();
    if (attempt.expiresAt <= now) {
      await ctx.db.patch(attempt._id, { state: "expired", updatedAt: now });
      return { state: "expired" as const };
    }

    const profile = await ctx.db.get(attempt.profileId);
    if (profile === null) {
      throw claimError("PROFILE_NOT_FOUND");
    }

    // Same rule as the Discord paths, and for the same reason. Placing a proof
    // code in a VRChat group's description proves the claimant administers that
    // group; it says nothing about whether the group is the one this listing
    // represents, and `startVrchatProof` takes the target id from the claimant.
    // Without this the Discord guard is decorative: claim any listing with any
    // guild to get `claimed_unverified`, then upgrade it to `claimed_verified`
    // with a throwaway VRChat group. Read before the link is written below, and
    // only associations somebody else recorded count.
    const assetType = attempt.targetType === "vrchat_group" ? "vrchat_group" : "vrchat_user";
    const assetBacksThisProfile = (
      await getActiveProfileLinks(ctx.db, profile._id, assetType)
    ).some(
      (link) =>
        link.assetExternalId === attempt.targetExternalId &&
        link.linkedByUserId !== attempt.userId,
    );

    // A verified owner proving control of *another* account or group is adding a
    // connection, not claiming the profile again. Writing an approved claim
    // request and re-running the ownership grant filled the audit trail with
    // history asserting ownership was granted a second time, for a profile whose
    // ownership never changed.
    const existingOwner = await getActiveProfileOwner(ctx.db, profile._id);
    const connectionOnly =
      existingOwner !== null &&
      existingOwner.userId === attempt.userId &&
      profile.claimState === "claimed_verified";

    const claimRequestId = connectionOnly
      ? undefined
      : await ctx.db.insert("profileClaimRequests", {
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
    if (!connectionOnly) {
      await approveProfileClaimForUser(ctx.db, {
        profile,
        profileId: profile._id,
        userId: attempt.userId,
        ...(claimRequestId === undefined ? {} : { grantedByClaimRequestId: claimRequestId }),
        verified: assetBacksThisProfile,
        now,
        note: assetBacksThisProfile
          ? proofAuditNote(attempt.targetType, args.evidenceSource)
          : `${proofAuditNote(attempt.targetType, args.evidenceSource)} The target did not already back this profile, so ownership is unverified.`,
      });
    }

    // Record the durable control proof and profile association so VRChat
    // targets participate in the same many-to-many link model as Discord
    // guilds, rather than the association living only on the claim request.
    // A VRC Linking attestation targets a `usr_…` account just as a direct
    // proof does, so it earns the same connection; skipping it left a profile
    // verified with nothing shown under its connections.
    {
      const proofId = await recordExternalControlProof(ctx.db, {
        userId: attempt.userId,
        assetType,
        assetExternalId: attempt.targetExternalId,
        // A group proof shows the claimant can edit the group's description,
        // which staff roles can also do. That is authority to administer, not
        // evidence of ownership, and recording `owner` would overstate it and
        // could satisfy a future owner-only check. A bio on one's own profile
        // does prove `self`.
        controlLevel: assetType === "vrchat_user" ? "self" : "administrator",
        evidenceSource: args.evidenceSource,
        evidenceSummary: args.evidenceSummary,
        now,
      });

      await linkProfileToAsset(ctx.db, {
        profileId: profile._id,
        assetType,
        assetExternalId: attempt.targetExternalId,
        linkedByUserId: attempt.userId,
        verifiedByProofId: proofId,
        now,
      });
    }

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
      throw claimError("PROOF_NOT_FOUND");
    }

    if (attempt.state !== "pending") {
      return { state: attempt.state };
    }

    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      state: attempt.expiresAt <= now ? "expired" : "failed",
      ...(args.evidenceSource !== undefined ? { evidenceSource: args.evidenceSource } : {}),
      evidenceSummary: args.evidenceSummary,
      updatedAt: now,
    });

    return { state: attempt.expiresAt <= now ? "expired" : "failed" };
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
      throw claimError("PROOF_NOT_FOUND");
    }

    if (attemptContext.attempt.state !== "pending") {
      return { state: attemptContext.attempt.state };
    }

    // An attempt that is already expired is expired regardless of whether the
    // adapter could be reached, so settle it before spending a provider call or
    // reading a delegated credential. Expiry *during* verification is still
    // handled after the fetch below.
    if (attemptContext.attempt.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.profileClaims.recordVrchatProofFailure, {
        attemptId: args.attemptId,
        evidenceSource: proofEvidenceSourceForTarget(attemptContext.attempt.targetType),
        evidenceSummary: "The proof attempt expired before adapter verification started.",
      });

      return { state: "expired" as const };
    }

    const adapterUrl = proofAdapterUrl(attemptContext.attempt.targetType);

    // No adapter for a VRChat target means the collector fleet reads it on its
    // own schedule. The attempt stays pending and the collector resolves it, so
    // report that rather than failing the user's manual check.
    if (adapterUrl === null) {
      return { state: "queued" as const };
    }
    // VRC Linking answers from a community's delegated credential rather than
    // from a proof code, so that path carries the claimant's Discord identity
    // and the delegations VRDex may consult. Only secret *references* travel.
    const delegationContext =
      attemptContext.attempt.targetType === "vrclinking"
        ? ((await ctx.runQuery(internal.vrclinkingCredentials.getAdapterContext, {
            userId: attemptContext.attempt.userId,
          })) as {
            discordUserId: string;
            delegations: { credentialId: Id<"communityVrclinkingCredentials">; guildId: string; secretRef: string }[];
            skippedCredentialIds: Id<"communityVrclinkingCredentials">[];
          } | null)
        : null;

    if (delegationContext !== null) {
      // Advance the selection cursor for every row this pass looked at, before
      // anything can short-circuit. Skipped rows must advance or they pin the
      // head of the index forever, and a denied cooldown or a throwing fetch
      // must not leave the selected ones unstamped either. This is rotation
      // only — the operator-visible "was queried" stamp happens once a provider
      // call is actually going out, and the audit stamp only for the delegation
      // that answered.
      await ctx.runMutation(internal.vrclinkingCredentials.recordCredentialRotation, {
        credentialIds: [
          ...delegationContext.delegations.map((delegation) => delegation.credentialId),
          ...delegationContext.skippedCredentialIds,
        ],
      });
    }

    // No linked Discord account, or no community has delegated a credential:
    // either way there is nothing to ask. Short-circuit rather than posting the
    // claimant's Discord id to an adapter that cannot answer.
    if (
      attemptContext.attempt.targetType === "vrclinking" &&
      (delegationContext === null || delegationContext.delegations.length === 0)
    ) {
      return { state: "unavailable" as const };
    }

    // Each consultation spends community-provided VRCLinking quota across up to
    // five delegations, and a negative leaves the attempt pending, so an
    // unthrottled caller could drain an operator's quota by retrying. Reserved
    // atomically before the fetch, not stamped after it, so concurrent callers
    // and a throwing fetch cannot both slip through.
    if (attemptContext.attempt.targetType === "vrclinking") {
      const reservation = (await ctx.runMutation(internal.profileClaims.reserveVrclinkingCheck, {
        attemptId: args.attemptId,
        cooldownMs: VRCLINKING_CHECK_COOLDOWN_MS,
      })) as { granted: boolean };

      if (!reservation.granted) {
        return { state: "pending" as const };
      }
    }

    if (delegationContext !== null) {
      // Past the cooldown gate, so these references really are going out. This
      // is the stamp an operator sees, which is why it is here and not with the
      // rotation cursor above: a key denied by the cooldown, or skipped as
      // ineligible, was never sent anywhere and must not report otherwise.
      await ctx.runMutation(internal.vrclinkingCredentials.recordCredentialConsultations, {
        credentialIds: delegationContext.delegations.map(
          (delegation) => delegation.credentialId,
        ),
      });
    }

    const response = await boundedFetch(adapterUrl, {
      method: "POST",
      headers: proofAdapterHeaders(),
      body: JSON.stringify({
        targetType: attemptContext.attempt.targetType,
        targetExternalId: attemptContext.attempt.targetExternalId,
        // The VRC Linking adapter answers from the claimant's Discord identity
        // and a delegated key; it neither reads nor validates these. Sending a
        // live one-time proof code and the profile record to a service that has
        // no use for them is avoidable exposure.
        ...(delegationContext === null
          ? {
              proofCode: attemptContext.attempt.proofCode,
              profile: attemptContext.profile,
            }
          : {
              discordUserId: delegationContext.discordUserId,
              delegations: delegationContext.delegations.map(({ guildId, secretRef }) => ({
                guildId,
                secretRef,
              })),
            }),
      }),
    });

    if (attemptContext.attempt.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.profileClaims.recordVrchatProofFailure, {
        attemptId: args.attemptId,
        evidenceSource: proofEvidenceSourceForTarget(attemptContext.attempt.targetType),
        evidenceSummary: "The proof attempt expired before adapter verification completed.",
      });
      return { state: "expired" as const };
    }

    // Covers the adapter's "could not consult anything" case too: it maps that
    // to a 503 rather than a 200 body flag, precisely so "we could not ask
    // anyone" never reaches the claimant as "we asked and the code was not
    // there". Do not add a body-level `unavailable` check here without also
    // making the adapter emit one — it does not.
    if (!response.ok) {
      return { state: "unavailable" as const };
    }

    const result = (response.body ?? {}) as ProofAdapterResponse;

    if (result.verified !== true) {
      return { state: "pending" as const };
    }

    // Only the delegation the adapter says answered gets the operator-visible
    // audit stamp.
    // Index first: two communities may delegate for the same guild, and
    // matching on guild id alone would stamp whichever was listed first rather
    // than the delegation that actually answered.
    const matched =
      typeof result.matchedDelegationIndex === "number"
        ? delegationContext?.delegations[result.matchedDelegationIndex]
        : delegationContext?.delegations.find(
            (delegation) => delegation.guildId === result.matchedGuildId,
          );

    if (matched !== undefined) {
      await ctx.runMutation(internal.vrclinkingCredentials.recordCredentialUse, {
        credentialId: matched.credentialId,
        resultSummary: "Confirmed a VRC Linking identity attestation.",
      });
    }

    return await ctx.runMutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId: args.attemptId,
      evidenceSource: result.evidenceSource ?? proofEvidenceSourceForTarget(attemptContext.attempt.targetType),
      evidenceSummary: result.evidenceSummary ?? "Proof code was found by the configured adapter.",
    });
  },
});

/**
 * Claim the right to consult delegated credentials for one attempt.
 *
 * Checking a timestamp in the action and stamping it after the fetch leaves a
 * window where concurrent callers all pass, and a fetch that throws never
 * stamps at all. Reserving inside a mutation makes the check and the stamp one
 * atomic step, so the cooldown holds under both.
 */
export const reserveVrclinkingCheck = internalMutation({
  args: { attemptId: v.id("profileVerificationAttempts"), cooldownMs: v.number() },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);

    if (attempt === null || attempt.state !== "pending") {
      return { granted: false };
    }

    const now = Date.now();

    if (attempt.lastCheckedAt !== undefined && attempt.lastCheckedAt > now - args.cooldownMs) {
      return { granted: false };
    }

    await ctx.db.patch(args.attemptId, { lastCheckedAt: now });

    return { granted: true };
  },
});

export const expireStaleVerificationAttempts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const attempts = await ctx.db
      .query("profileVerificationAttempts")
      .withIndex("by_state_expiresAt", (q) => q.eq("state", "pending").lte("expiresAt", now))
      .take(500);

    await Promise.all(
      attempts.map((attempt) =>
        ctx.db.patch(attempt._id, { state: "expired", updatedAt: now }),
      ),
    );

    return { expired: attempts.length };
  },
});
