import { v } from "convex/values";

import {
  claimSessionUserOrNull,
  requireVerifiedActiveBrowserSession,
} from "./_claimSession";
import { claimError } from "./_claimErrors";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  type ExternalAssetType,
  type ExternalControlLevel,
  MINIMUM_COMMUNITY_CONTROL_LEVEL,
  externalControlLevelRank,
  getActiveControlProof,
  getActiveProfileLinks,
  linkProfileToAsset,
  removeProfileLink,
  requireControlProof,
} from "./_externalControl";
import { approveProfileClaimForUser, getActiveProfileOwner, userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { normalizeVrchatTargetId } from "./_vrchatIdentity";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";

const DISCORD_GUILD_ID_PATTERN = /^\d{17,20}$/;
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
 * Resolve a slug for an owner-only mutation, refusing in a way that says
 * nothing about listings the public cannot see.
 *
 * `NOT_PROFILE_OWNER` for a hidden slug and `PROFILE_NOT_FOUND` for an unused
 * one told a prober that a draft, opted-out, or suppressed listing exists. A
 * publicly readable profile is different: its existence is not a secret, so a
 * non-owner still gets the accurate `NOT_PROFILE_OWNER` there.
 */
async function requireOwnedProfileFromSlug(
  db: Parameters<typeof getProfileBySlug>[0],
  slug: string,
  userId: Id<"users">,
) {
  const profile = await requireProfileFromSlug(db, slug);

  if (!(await userOwnsProfile(db, profile._id, userId))) {
    throw claimError(canReadProfile("public", profile) ? "NOT_PROFILE_OWNER" : "PROFILE_NOT_FOUND");
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

    const user = await claimSessionUserOrNull(ctx);
    const isManager = user !== null && (await userOwnsProfile(ctx.db, profile._id, user._id));

    if (!canReadProfile("public", profile) && !isManager) {
      return null;
    }

    const links = await getActiveProfileLinks(ctx.db, profile._id);
    // A link deliberately outlives its proof: losing control of a server should
    // not silently detach it from the profile. The "Verified" label must not
    // outlive it too, so read through to the proof rather than treating the
    // presence of a reference as proof of anything.
    const now = Date.now();
    const proofs = await Promise.all(
      links.map((link) =>
        link.verifiedByProofId === undefined ? null : ctx.db.get(link.verifiedByProofId),
      ),
    );
    // Proofs are per verifying identity, so the row a link points at is not the
    // only one that can vouch for it. When a user holds proofs through two
    // Discord logins and reconciliation revokes the one the link happens to
    // reference, the other stays deliberately active — reporting the connection
    // unverified on the strength of the referenced row alone told the owner they
    // had lost something they still hold, with no way to rebind it because the
    // asset is already attached.
    const liveProofs = await Promise.all(
      links.map(async (link, index) => {
        const referenced = proofs[index];

        if (referenced === null || referenced === undefined) {
          return null;
        }

        const alternative = await getActiveControlProof(
          ctx.db,
          referenced.userId,
          link.assetType,
          link.assetExternalId,
          now,
        );

        // `getActiveControlProof` returns the strongest *active* row, which can
        // still be past its revalidation window — the sweeper marks those stale
        // in batches. Apply the same expiry rule the referenced proof gets, or
        // this would report an overdue proof as live.
        return alternative !== null &&
          (alternative.revalidateAfter === undefined || alternative.revalidateAfter > now)
          ? alternative
          : null;
      }),
    );

    return {
      isManager,
      connections: links
        .map((link, index) => {
          const proof = proofs[index];

          return {
            id: link._id,
            assetType: link.assetType,
            assetExternalId: link.assetExternalId,
            assetDisplayName: link.assetDisplayName,
            linkRole: link.linkRole,
            verified:
              (proof != null &&
                proof.state === "active" &&
                (proof.revalidateAfter === undefined || proof.revalidateAfter > now)) ||
              liveProofs[index] != null,
            ...(isManager ? { createdAt: link.createdAt } : {}),
          };
        })
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
 *
 * Control of a server is not evidence that the server is *this* listing's.
 * Nothing on a concierge-seeded profile names its guild, so the guild id here is
 * caller input all the way down — granting `claimed_verified` on it would let a
 * throwaway server take an unrelated community's listing and wear its badge.
 * Verified therefore requires the association to already be on record; without
 * one the claim grants ownership at the same unverified level every other
 * unproved claim does, and it upgrades once a trusted association exists.
 */
export const claimCommunityWithVerifiedGuild = mutation({
  args: { profileSlug: v.string(), guildId: v.string() },
  handler: async (ctx, args) => {
    const { subject, user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    // Visibility first, before anything that could answer a question about the
    // profile. Every claim *query* gates on public readability; this mutation
    // did not, so knowing or guessing the slug of an unowned draft, opted-out,
    // or suppressed community was enough to take ownership of it with any guild
    // the caller manages — past the UI's not-found boundary and past the
    // moderation state that hid it.
    //
    // Ordered ahead of the type and proof checks, not merely present: those
    // throw distinct structured codes, so a hidden community answered
    // `CONTROL_NOT_VERIFIED` and a hidden person `WRONG_PROFILE_TYPE`, while a
    // slug that does not exist answered `PROFILE_NOT_FOUND`. That difference is
    // the existence and type of a listing the public query deliberately hides.
    // An existing owner still gets through, since they can already see it.
    const activeOwner = await getActiveProfileOwner(ctx.db, profile._id);

    if (activeOwner?.userId !== user._id && !canReadProfile("public", profile)) {
      throw claimError("PROFILE_NOT_FOUND");
    }

    if (profile.profileType !== "community") {
      throw claimError("WRONG_PROFILE_TYPE");
    }

    if (activeOwner !== null && activeOwner.userId !== user._id) {
      throw claimError("PROFILE_ALREADY_OWNED");
    }

    const proof = await requireControlProof(
      ctx.db,
      user._id,
      "discord_guild",
      args.guildId,
      MINIMUM_COMMUNITY_CONTROL_LEVEL,
    );

    const now = Date.now();
    // Read before the link is written, and only associations somebody else put
    // on record count. A link this caller created — by an earlier run of this
    // same claim, or by attaching the server themselves — is their own assertion
    // repeated back, so treating it as corroboration would make the check
    // self-satisfying on the second attempt.
    const associatedGuilds = await getActiveProfileLinks(ctx.db, profile._id, "discord_guild");
    const guildBacksThisProfile = associatedGuilds.some(
      (link) => link.assetExternalId === args.guildId && link.linkedByUserId !== user._id,
    );

    // Attaching the guild is idempotent and has to happen either way — a
    // verified owner may be claiming with a server that is not linked yet.
    const linkGuild = async (verifiedByProofId: typeof proof._id) =>
      await linkProfileToAsset(ctx.db, {
        profileId: profile._id,
        assetType: "discord_guild",
        assetExternalId: args.guildId,
        ...(proof.assetDisplayName !== undefined
          ? { assetDisplayName: proof.assetDisplayName }
          : {}),
        linkedByUserId: user._id,
        verifiedByProofId,
        now,
      });

    // Beyond that there is nothing to do when this caller already owns the
    // profile and the claim would not change its state: a retry after a lost
    // response, or a second call from the account UI, would otherwise pile up
    // duplicate approved claim requests and redundant ownership and search
    // writes. An unverified owner whose guild *is* on record still falls
    // through, since that is exactly the upgrade this mutation exists to do.
    const wouldUpgrade = profile.claimState !== "claimed_verified" && guildBacksThisProfile;

    if (activeOwner !== null && !wouldUpgrade) {
      await linkGuild(proof._id);

      return {
        claimRequestId: null,
        profileId: profile._id,
        claimState: profile.claimState,
        profilePath: `/c/${profile.slug}`,
      };
    }

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
      evidenceSummary: guildBacksThisProfile
        ? (proof.evidenceSummary ?? "Discord control verified through OAuth.")
        : `${proof.evidenceSummary ?? "Discord control verified through OAuth."} This server was not already associated with the listing, so ownership is unverified.`,
      createdAt: now,
      updatedAt: now,
      verifiedAt: now,
      reviewedAt: now,
    });

    await linkGuild(proof._id);

    // Reached with no owner, or with an owner whose profile this claim upgrades.
    // `approveProfileClaimForUser` is idempotent for an existing owner and only
    // advances the claim state.
    {
      await approveProfileClaimForUser(ctx.db, {
        profile,
        profileId: profile._id,
        userId: user._id,
        grantedByClaimRequestId: claimRequestId,
        verified: guildBacksThisProfile,
        now,
        actor: subject,
        note: guildBacksThisProfile
          ? `Discord ${proof.controlLevel} access verified for guild ${args.guildId}, which already backed this profile.`
          : `Discord ${proof.controlLevel} access verified for guild ${args.guildId}. The guild did not already back this profile, so ownership is unverified.`,
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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedProfileFromSlug(ctx.db, args.profileSlug, user._id);

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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedProfileFromSlug(ctx.db, args.profileSlug, user._id);

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
      ...(existing.linkedByUserId !== undefined
        ? { linkedByUserId: existing.linkedByUserId }
        : {}),
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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedProfileFromSlug(ctx.db, args.profileSlug, user._id);

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
    const user = await claimSessionUserOrNull(ctx);

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

    // Every sibling query gates the lookup this way. Without it, a non-empty
    // result is an existence-and-type oracle for draft and suppressed profiles
    // that `listProfileConnections` and the claim queries deliberately hide.
    if (
      !canReadProfile("public", profile) &&
      !(await userOwnsProfile(ctx.db, profile._id, user._id))
    ) {
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

    // One asset may have a proof per verifying identity, so key the offer by the
    // asset and keep the strongest. Offering it twice would show the same server
    // as two options that attach to the same link.
    const offers = new Map<string, { assetType: string; assetExternalId: string; assetDisplayName?: string; controlLevel: ExternalControlLevel }>();

    for (const proof of proofs) {
      const key = `${proof.assetType}:${proof.assetExternalId}`;

      if (
        !assetTypeAllowedForProfile(proof.assetType, profile.profileType) ||
        attached.has(key) ||
        // Same expiry rule as requireControlProof: between a proof lapsing and
        // the sweeper marking it stale, offering it here would produce an option
        // that the attach then refuses.
        (proof.revalidateAfter !== undefined && proof.revalidateAfter <= now)
      ) {
        continue;
      }

      const incumbent = offers.get(key);

      if (
        incumbent === undefined ||
        externalControlLevelRank(proof.controlLevel) >
          externalControlLevelRank(incumbent.controlLevel)
      ) {
        offers.set(key, {
          assetType: proof.assetType,
          assetExternalId: proof.assetExternalId,
          assetDisplayName: proof.assetDisplayName,
          controlLevel: proof.controlLevel,
        });
      }
    }

    return [...offers.values()];
  },
});

/**
 * Record, as the operator, that an external asset backs a listing.
 *
 * This is the writer the verified claim paths check against. Proving control of
 * a Discord server or a VRChat group shows the claimant runs *that asset*; it
 * cannot show the asset is the one a listing represents, and a claimant's own
 * assertion cannot corroborate their own claim. Somebody who knows the listing
 * has to say so, which for a concierge-seeded profile is whoever seeded it.
 *
 * Internal, and deliberately so: run it with the deployment key, the same way
 * `communityTelemetry:registerCollectorAccount` is run. There is no
 * self-service surface for it, because self-service is exactly what it exists
 * to rule out. Links written here carry no `linkedByUserId` — no VRDex user
 * asserted them.
 */
export const recordOperatorAssociation = internalMutation({
  args: {
    profileSlug: v.string(),
    assetType: externalAssetType,
    assetExternalId: v.string(),
    assetDisplayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireProfileFromSlug(ctx.db, args.profileSlug);

    if (!assetTypeAllowedForProfile(args.assetType, profile.profileType)) {
      throw claimError("WRONG_PROFILE_TYPE", profile.profileType);
    }

    // Normalized exactly as the claim paths normalize their targets. Recording
    // `USR_…` or a profile URL here while `startVrchatProof` stores the
    // lower-cased bare id would fail closed and silently: the association would
    // never match, and the upgrade this mutation exists to enable would just
    // never happen, with nothing to show the operator why.
    const assetExternalId =
      args.assetType === "discord_guild"
        ? args.assetExternalId.trim()
        : normalizeVrchatTargetId(args.assetExternalId, args.assetType);

    if (!assetExternalId) {
      throw claimError("INVALID_VRCHAT_TARGET", args.assetType);
    }

    if (args.assetType === "discord_guild" && !DISCORD_GUILD_ID_PATTERN.test(assetExternalId)) {
      throw claimError("INVALID_DISCORD_GUILD_ID");
    }

    const linkId = await linkProfileToAsset(ctx.db, {
      profileId: profile._id,
      assetType: args.assetType,
      assetExternalId,
      ...(args.assetDisplayName !== undefined
        ? { assetDisplayName: args.assetDisplayName }
        : {}),
      now: Date.now(),
    });

    return { linkId, profileId: profile._id };
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
