import { v } from "convex/values";

import { getCurrentUser, requireVerifiedEmailUser } from "./accounts";
import { toAuthSubject } from "./_communityAuthority";
import { claimError } from "./_claimErrors";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  type ExternalAssetType,
  MINIMUM_COMMUNITY_CONTROL_LEVEL,
  getActiveControlProof,
  getActiveProfileLinks,
  getProfilesLinkedToAsset,
  linkProfileToAsset,
  removeProfileLink,
  requireControlProof,
} from "./_externalControl";
import { approveProfileClaimForUser, getActiveProfileOwner, userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

const externalAssetType = v.union(
  v.literal("discord_guild"),
  v.literal("vrchat_group"),
  v.literal("vrchat_user"),
);
const linkRole = v.union(v.literal("primary"), v.literal("secondary"));

/** Asset types a given profile type is allowed to hold. */
function assetTypeAllowedForProfile(
  assetType: ExternalAssetType,
  profileType: "person" | "community",
): boolean {
  return assetType === "vrchat_user" ? profileType === "person" : profileType === "community";
}

async function requireProfileFromSlug(db: Parameters<typeof getProfileBySlug>[0], slug: string) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw claimError("INVALID_PROFILE_SLUG");
  }

  const profile = await getProfileBySlug(db, validation.slug);

  if (profile === null) {
    throw claimError("PROFILE_NOT_FOUND");
  }

  return profile;
}

/**
 * Connections attached to a profile, plus whether the viewer could add more.
 * Public readers see the linked assets; only managers see who linked them.
 */
export const listProfileConnections = query({
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

    const user = await getCurrentUser(ctx);
    const isManager = user !== null && (await userOwnsProfile(ctx.db, profile._id, user._id));

    if (!canReadProfile("public", profile) && !isManager) {
      return null;
    }

    const links = await getActiveProfileLinks(ctx.db, profile._id);

    return {
      isManager,
      connections: links
        .map((link) => ({
          id: link._id,
          assetType: link.assetType,
          assetExternalId: link.assetExternalId,
          assetDisplayName: link.assetDisplayName,
          linkRole: link.linkRole,
          verified: link.verifiedByProofId !== undefined,
          ...(isManager ? { createdAt: link.createdAt } : {}),
        }))
        // Primary first, then stable by creation order.
        .sort((left, right) =>
          left.linkRole === right.linkRole
            ? left.assetExternalId.localeCompare(right.assetExternalId)
            : left.linkRole === "primary"
              ? -1
              : 1,
        ),
    };
  },
});

/**
 * Claim a community profile using a Discord guild the caller already proved
 * they manage. Verification happened during the OAuth round-trip, so this is a
 * single step: pair the existing proof with the profile and grant ownership.
 */
export const claimCommunityWithVerifiedGuild = mutation({
  args: { profileSlug: v.string(), guildId: v.string() },
  handler: async (ctx, args) => {
    const [user, identity] = await Promise.all([
      requireVerifiedEmailUser(ctx),
      ctx.auth.getUserIdentity(),
    ]);
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    if (profile.profileType !== "community") {
      throw claimError("WRONG_PROFILE_TYPE");
    }

    const proof = await requireControlProof(
      ctx.db,
      user._id,
      "discord_guild",
      args.guildId,
      MINIMUM_COMMUNITY_CONTROL_LEVEL,
    );
    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);

    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw claimError("PROFILE_ALREADY_OWNED");
    }

    const now = Date.now();
    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: "community",
      requestedDisplayName: profile.displayName,
      userId: user._id,
      method: "discord_community_admin",
      state: "approved",
      discordGuildId: args.guildId,
      ...(proof.assetDisplayName !== undefined
        ? { discordGuildName: proof.assetDisplayName }
        : {}),
      evidenceSource: proof.evidenceSource,
      evidenceSummary: proof.evidenceSummary ?? "Discord control verified through OAuth.",
      createdAt: now,
      updatedAt: now,
      verifiedAt: now,
      reviewedAt: now,
    });

    await linkProfileToAsset(ctx.db, {
      profileId: profile._id,
      assetType: "discord_guild",
      assetExternalId: args.guildId,
      ...(proof.assetDisplayName !== undefined
        ? { assetDisplayName: proof.assetDisplayName }
        : {}),
      linkedByUserId: user._id,
      verifiedByProofId: proof._id,
      now,
    });

    // Also runs when the caller already owns the profile but it is still
    // `claimed_unverified` — the no-match creation path grants ownership without
    // verification, and proving server control is exactly what should upgrade
    // it. `approveProfileClaimForUser` is idempotent for an existing owner and
    // only advances the claim state.
    if (activeOwner === null || profile.claimState !== "claimed_verified") {
      await approveProfileClaimForUser(ctx.db, {
        profile,
        profileId: profile._id,
        userId: user._id,
        grantedByClaimRequestId: claimRequestId,
        verified: true,
        now,
        ...(identity !== null ? { actor: toAuthSubject(identity) } : {}),
        note: `Discord ${proof.controlLevel} access verified for guild ${args.guildId}.`,
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
      profilePath: `/c/${profile.slug}`,
    };
  },
});

/**
 * Attach an additional verified asset to a profile the caller already manages —
 * a second Discord server, or a secondary VRChat group.
 */
export const addVerifiedConnection = mutation({
  args: {
    profileSlug: v.string(),
    assetType: externalAssetType,
    assetExternalId: v.string(),
    linkRole: v.optional(linkRole),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw claimError("NOT_PROFILE_OWNER");
    }

    if (!assetTypeAllowedForProfile(args.assetType, profile.profileType)) {
      throw claimError("WRONG_PROFILE_TYPE");
    }

    const required = args.assetType === "vrchat_user" ? "self" : MINIMUM_COMMUNITY_CONTROL_LEVEL;
    const proof = await requireControlProof(
      ctx.db,
      user._id,
      args.assetType,
      args.assetExternalId,
      required,
    );
    const now = Date.now();
    const linkId = await linkProfileToAsset(ctx.db, {
      profileId: profile._id,
      assetType: args.assetType,
      assetExternalId: args.assetExternalId,
      ...(proof.assetDisplayName !== undefined
        ? { assetDisplayName: proof.assetDisplayName }
        : {}),
      ...(args.linkRole !== undefined ? { linkRole: args.linkRole } : {}),
      linkedByUserId: user._id,
      verifiedByProofId: proof._id,
      now,
    });

    return { linkId };
  },
});

export const setPrimaryConnection = mutation({
  args: {
    profileSlug: v.string(),
    assetType: externalAssetType,
    assetExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw claimError("NOT_PROFILE_OWNER");
    }

    const existing = (await getActiveProfileLinks(ctx.db, profile._id, args.assetType)).find(
      (link) => link.assetExternalId === args.assetExternalId,
    );

    if (existing === undefined) {
      throw claimError("LINK_NOT_FOUND");
    }

    const now = Date.now();
    await linkProfileToAsset(ctx.db, {
      profileId: profile._id,
      assetType: args.assetType,
      assetExternalId: args.assetExternalId,
      linkRole: "primary",
      linkedByUserId: existing.linkedByUserId,
      ...(existing.verifiedByProofId !== undefined
        ? { verifiedByProofId: existing.verifiedByProofId }
        : {}),
      now,
    });

    return { primary: args.assetExternalId };
  },
});

export const removeConnection = mutation({
  args: {
    profileSlug: v.string(),
    assetType: externalAssetType,
    assetExternalId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw claimError("NOT_PROFILE_OWNER");
    }

    const now = Date.now();
    const linkId = await removeProfileLink(
      ctx.db,
      profile._id,
      args.assetType,
      args.assetExternalId,
      now,
    );

    return { linkId };
  },
});

/**
 * Assets the caller has proved control of that are not yet attached to this
 * profile — the source list for the claim page's server/group picker.
 */
export const listAvailableConnections = query({
  args: { profileSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return [];
    }

    const validation = validateProfileSlug(args.profileSlug);

    if (!validation.ok) {
      return [];
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null) {
      return [];
    }

    const [proofs, links] = await Promise.all([
      ctx.db
        .query("externalControlProofs")
        .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "active"))
        .collect(),
      getActiveProfileLinks(ctx.db, profile._id),
    ]);
    const attached = new Set(links.map((link) => `${link.assetType}:${link.assetExternalId}`));

    const now = Date.now();

    return proofs
      .filter(
        (proof) =>
          assetTypeAllowedForProfile(proof.assetType, profile.profileType) &&
          !attached.has(`${proof.assetType}:${proof.assetExternalId}`) &&
          // Same expiry rule as requireControlProof: between a proof lapsing and
          // the sweeper marking it stale, offering it here would produce an
          // option that the attach then refuses.
          (proof.revalidateAfter === undefined || proof.revalidateAfter > now),
      )
      .map((proof) => ({
        assetType: proof.assetType,
        assetExternalId: proof.assetExternalId,
        assetDisplayName: proof.assetDisplayName,
        controlLevel: proof.controlLevel,
      }));
  },
});

/** Matches the hourly cadence and headroom of `expireStaleVerificationAttempts`. */
const OVERDUE_PROOF_BATCH = 500;

/**
 * Mark control proofs whose revalidation window has passed as stale.
 *
 * A stale proof no longer satisfies `requireControlProof`, so it cannot be used
 * to claim a new profile or attach a new connection until the owner re-verifies.
 * Existing ownership and links are deliberately left alone: losing Manage Server
 * on one Discord account should not silently detach a community, which is a
 * support decision rather than an automatic one.
 */
export const markOverdueControlProofsStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const overdue = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_state_revalidateAfter", (q) =>
        q.eq("state", "active").lte("revalidateAfter", now),
      )
      .take(OVERDUE_PROOF_BATCH);

    await Promise.all(
      overdue.map((proof) => ctx.db.patch(proof._id, { state: "stale", updatedAt: now })),
    );

    // Every proof shares one 30-day revalidation window and a single OAuth pass
    // records one per manageable guild, so overdue proofs arrive in bursts. A
    // truncated batch means the tail stayed active past its window and could
    // still authorize a new claim, so surface it instead of returning a count
    // that looks identical to a healthy run.
    return { stale: overdue.length, saturated: overdue.length === OVERDUE_PROOF_BATCH };
  },
});
