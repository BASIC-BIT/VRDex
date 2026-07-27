import { v } from "convex/values";

import { getLinkedProviderAccount, requireVerifiedEmailUser } from "./accounts";
import { claimError } from "./_claimErrors";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { MINIMUM_COMMUNITY_CONTROL_LEVEL, requireControlProof } from "./_externalControl";
import { userOwnsProfile } from "./_profileOwnership";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";

// Mirrors the collector account rule: credentials live in the operator secret
// store and Convex only ever holds a reference to them.
//
// Deliberately case-sensitive. The adapter classifies references with
// case-sensitive `startsWith`, so accepting `SECRET://…` here would store a
// reference that registers cleanly and then fails every resolution forever,
// with no operator-visible signal beyond a permanently "unavailable" claim.
const SECRET_REF_PATTERN = /^(arn:aws:secretsmanager:|secret:\/\/)[^\s]+$/;
const DISCORD_GUILD_ID_PATTERN = /^\d{17,20}$/;

async function requireCommunityProfile(
  db: Parameters<typeof getProfileBySlug>[0],
  slug: string,
) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw claimError("INVALID_PROFILE_SLUG");
  }

  const profile = await getProfileBySlug(db, validation.slug);

  if (profile === null) {
    throw claimError("PROFILE_NOT_FOUND");
  }

  if (profile.profileType !== "community") {
    throw claimError("WRONG_PROFILE_TYPE", "community");
  }

  return profile;
}

/**
 * Delegate a VRCLinking API key for one guild to VRDex.
 *
 * Requires both profile ownership and a current proof that the caller manages
 * the guild, so an operator cannot delegate a key for a server they do not
 * control. The token never reaches Convex: callers pass a secret-store
 * reference that the adapter resolves.
 */
export const registerCredential = mutation({
  args: {
    profileSlug: v.string(),
    guildId: v.string(),
    secretRef: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireCommunityProfile(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw claimError("NOT_PROFILE_OWNER");
    }

    const guildId = args.guildId.trim();

    if (!DISCORD_GUILD_ID_PATTERN.test(guildId)) {
      throw claimError("INVALID_DISCORD_GUILD_ID");
    }

    // The delegation is only as trustworthy as the delegator's control of the
    // guild, so re-check it here rather than trusting profile ownership alone.
    await requireControlProof(
      ctx.db,
      user._id,
      "discord_guild",
      guildId,
      MINIMUM_COMMUNITY_CONTROL_LEVEL,
    );

    const secretRef = args.secretRef.trim();

    if (!SECRET_REF_PATTERN.test(secretRef)) {
      throw claimError(
        "ADAPTER_NOT_CONFIGURED",
        "vrclinking_credentials_require_secret_reference",
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "active"),
      )
      .collect();
    const sameGuild = existing.find((row) => row.guildId === guildId);

    if (sameGuild !== undefined) {
      await ctx.db.patch(sameGuild._id, {
        secretRef: secretRef.slice(0, 500),
        delegatedByUserId: user._id,
        updatedAt: now,
      });

      return { credentialId: sameGuild._id, replaced: true };
    }

    const credentialId = await ctx.db.insert("communityVrclinkingCredentials", {
      communityProfileId: profile._id,
      guildId,
      secretRef: secretRef.slice(0, 500),
      state: "active",
      delegatedByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    return { credentialId, replaced: false };
  },
});

export const revokeCredential = mutation({
  args: { profileSlug: v.string(), guildId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireCommunityProfile(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw claimError("NOT_PROFILE_OWNER");
    }

    const active = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "active"),
      )
      .collect();
    const target = active.find((row) => row.guildId === args.guildId.trim());

    if (target === undefined) {
      return { revoked: false };
    }

    const now = Date.now();
    await ctx.db.patch(target._id, {
      state: "revoked",
      revokedAt: now,
      revokedReason: "Revoked by the profile owner.",
      updatedAt: now,
    });

    return { revoked: true };
  },
});

/**
 * Delegations attached to a profile. Deliberately omits `secretRef` so the
 * reference is never rendered to a browser.
 */
export const listCredentials = query({
  args: { profileSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const profile = await requireCommunityProfile(ctx.db, args.profileSlug);

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      return [];
    }

    const active = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "active"),
      )
      .collect();

    return active.map((row) => ({
      guildId: row.guildId,
      lastUsedAt: row.lastUsedAt,
      lastResultSummary: row.lastResultSummary,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Resolve the delegation the adapter should use for a guild. Internal only:
 * this is the one place `secretRef` leaves the table, and it goes to a Convex
 * action that forwards it to the configured adapter.
 */
export const getCredentialForAdapter = internalQuery({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_guildId_state", (q) => q.eq("guildId", args.guildId).eq("state", "active"))
      .first();

    return active === null
      ? null
      : {
          credentialId: active._id,
          communityProfileId: active.communityProfileId,
          guildId: active.guildId,
          secretRef: active.secretRef,
        };
  },
});

/** Bounds how many delegated guilds one claim may consult. */
const MAX_ADAPTER_DELEGATIONS = 5;

/**
 * Delegation context for a VRC Linking proof attempt: the claimant's Discord
 * identity plus the guilds VRDex may ask about on their behalf.
 *
 * Internal only — this is the single place `secretRef` leaves the table, and it
 * goes to the action that forwards it to the adapter.
 */
export const getAdapterContext = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const discordAccount = await getLinkedProviderAccount(ctx, args.userId, "discord");

    if (discordAccount === null) {
      return null;
    }

    // Oldest-consulted first, so consultation rotates fairly across every
    // delegation instead of pinning the same few. Selecting on `updatedAt`
    // while also bumping it on use was self-reinforcing: past the cap, the
    // delegations never consulted could never become eligible.
    //
    // Membership is not knowable here — VRDex cannot tell which delegated
    // guilds a claimant belongs to without asking — so a claimant beyond the
    // cap may need to retry before their guild comes up. Rotation guarantees it
    // eventually does.
    const delegations = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_state_lastConsultedAt", (q) => q.eq("state", "active"))
      .take(MAX_ADAPTER_DELEGATIONS);

    return {
      discordUserId: discordAccount.providerAccountId,
      delegations: delegations.map((row) => ({
        credentialId: row._id,
        guildId: row.guildId,
        secretRef: row.secretRef,
      })),
    };
  },
});

/**
 * Stamp rotation position for every delegation that was consulted.
 *
 * Deliberately does not touch `updatedAt`, `lastUsedAt`, or
 * `lastResultSummary`: being asked is not the same as having answered, and an
 * operator's audit trail should not fill with other communities' proofs.
 */
export const recordCredentialConsultations = internalMutation({
  args: { credentialIds: v.array(v.id("communityVrclinkingCredentials")) },
  handler: async (ctx, args) => {
    const now = Date.now();

    await Promise.all(
      args.credentialIds.map((credentialId) =>
        ctx.db.patch(credentialId, { lastConsultedAt: now }),
      ),
    );
  },
});

/** Record that a delegation actually produced the match. */
export const recordCredentialUse = internalMutation({
  args: {
    credentialId: v.id("communityVrclinkingCredentials"),
    resultSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.credentialId, {
      lastConsultedAt: now,
      lastUsedAt: now,
      lastResultSummary: args.resultSummary.slice(0, 300),
      updatedAt: now,
    });
  },
});
