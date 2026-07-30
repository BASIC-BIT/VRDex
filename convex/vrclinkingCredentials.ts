import { v } from "convex/values";

import { getLinkedProviderAccount } from "./accounts";
import { requireVerifiedActiveBrowserSession } from "./_claimSession";
import { claimError } from "./_claimErrors";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  MINIMUM_COMMUNITY_CONTROL_LEVEL,
  getActiveControlProof,
  requireControlProof,
} from "./_externalControl";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";

// Mirrors the collector account rule: credentials live in the operator secret
// store and Convex only ever holds a reference to them.
//
// Mirrors the adapter's own grammar, not a looser superset. Anything this
// accepts that `classifySecretRef` rejects registers cleanly and then fails
// every resolution forever, with no operator-visible signal beyond a
// permanently "unavailable" claim — so the two must agree on case, on the
// allowed characters after `secret://`, and on rejecting traversal.
// Storage bound, enforced at validation rather than by truncating on write. A
// silently shortened ARN still resolves — to something else, or to nothing — so
// registration would succeed and every verification through that delegation
// would then be permanently unavailable with no operator-visible cause.
const SECRET_REF_MAX_LENGTH = 500;
const DISCORD_GUILD_ID_PATTERN = /^\d{17,20}$/;

/**
 * The one secret name a delegation for `guildId` may point at.
 *
 * Reference syntax is not authorization. The adapter resolves whatever it is
 * given through its own IAM role, so accepting any well-formed name let a
 * verified owner of guild A register another tenant's guessable reference and
 * have VRDex send that tenant's key to VRCLinking on their behalf — cross-tenant
 * credential use, quota burn, and disclosure of any non-JSON secret the task
 * role happens to read. Binding the name to the guild the caller has just proved
 * control of removes the choice: the only reference they can register is the one
 * an operator provisioned for their own server.
 */
function secretNameForGuild(guildId: string): string {
  return `vrdex/vrclinking/${guildId}`;
}

/**
 * One accepted form: the name.
 *
 * The ARN form was accepted too, and it was a trap. Its pattern allowed any
 * region and any 12-digit account, while the adapter's execution role can read
 * only its own — so a community registering a cross-account ARN registered
 * successfully, was selected for claims, and then failed every resolution with
 * an AWS denial that surfaces as `unavailable` indefinitely, with nothing
 * pointing back at the reference. The name has no region or account to get
 * wrong and resolves through Secrets Manager wherever the adapter runs.
 */
function isSecretRefForGuild(value: string, guildId: string): boolean {
  return (
    value.length <= SECRET_REF_MAX_LENGTH && value === `secret://${secretNameForGuild(guildId)}`
  );
}

/**
 * Resolve a community profile the caller owns.
 *
 * Ownership and public readability are settled before the type check, and
 * before anything is returned. Answering `WRONG_PROFILE_TYPE` for a hidden
 * person and `NOT_PROFILE_OWNER` for a hidden community, while an unused slug
 * answered `PROFILE_NOT_FOUND`, told a prober both that a draft, opted-out, or
 * suppressed listing exists and what type it is. A publicly readable profile is
 * different: its existence is not a secret, so a non-owner still gets the
 * accurate refusal there.
 */
async function requireOwnedCommunityProfile(
  db: Parameters<typeof getProfileBySlug>[0],
  slug: string,
  userId: Id<"users">,
) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw claimError("INVALID_PROFILE_SLUG");
  }

  const profile = await getProfileBySlug(db, validation.slug);

  if (profile === null) {
    throw claimError("PROFILE_NOT_FOUND");
  }

  if (!(await userOwnsProfile(db, profile._id, userId))) {
    throw claimError(canReadProfile("public", profile) ? "NOT_PROFILE_OWNER" : "PROFILE_NOT_FOUND");
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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedCommunityProfile(ctx.db, args.profileSlug, user._id);

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

    if (!isSecretRefForGuild(secretRef, guildId)) {
      throw claimError(
        "ADAPTER_NOT_CONFIGURED",
        `vrclinking_credentials_require_secret_reference:${secretNameForGuild(guildId)}`,
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
      // A replacement is a different key. Carrying the old one's audit history
      // forward made the Connections page attribute its queries and matches to
      // a credential that has answered nothing — the operator's only way to
      // tell a working delegation from an untested one.
      await ctx.db.patch(sameGuild._id, {
        secretRef,
        delegatedByUserId: user._id,
        lastConsultedAt: undefined,
        lastUsedAt: undefined,
        lastResultSummary: undefined,
        updatedAt: now,
      });

      return { credentialId: sameGuild._id, replaced: true };
    }

    const credentialId = await ctx.db.insert("communityVrclinkingCredentials", {
      communityProfileId: profile._id,
      guildId,
      secretRef,
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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedCommunityProfile(ctx.db, args.profileSlug, user._id);

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
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedCommunityProfile(ctx.db, args.profileSlug, user._id);

    const active = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "active"),
      )
      .collect();

    return active.map((row) => ({
      guildId: row.guildId,
      // Being consulted and having answered are different things, and only the
      // second stamps `lastUsedAt`. An operator whose key has been queried
      // several times without ever matching should still see that, rather than
      // "Not used yet".
      lastConsultedAt: row.lastConsultedAt,
      lastUsedAt: row.lastUsedAt,
      lastResultSummary: row.lastResultSummary,
      createdAt: row.createdAt,
    }));
  },
});


/** Bounds how many delegated guilds one claim may consult. */
const MAX_ADAPTER_DELEGATIONS = 5;

/**
 * Reserve the delegations for one VRC Linking proof attempt: the claimant's
 * Discord identity plus the guilds VRDex may ask about on their behalf.
 *
 * Internal only — this is the single place `secretRef` leaves the table, and it
 * goes to the action that forwards it to the adapter.
 *
 * A mutation because selecting and stamping have to be one step. Reading the
 * rotation head in a query and advancing it afterwards let every concurrent
 * attempt select the same oldest few delegations, which is the opposite of the
 * fair rotation the cursor exists to provide: it concentrates provider calls
 * and quota on a handful of communities while the rest go untried. Convex
 * serializes conflicting mutations, so the cursor a second caller reads here
 * has already moved.
 */
export const reserveAdapterDelegations = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const discordAccount = await getLinkedProviderAccount(ctx, args.userId, "discord");

    if (discordAccount === null) {
      return null;
    }

    // Oldest-rotated first, so consultation rotates fairly across every
    // delegation instead of pinning the same few. The cursor is its own field:
    // selecting on `updatedAt` while also bumping it on use was
    // self-reinforcing, and selecting on the operator-visible
    // `lastConsultedAt` would have to stamp rows that were never queried.
    //
    // Membership is not knowable here — VRDex cannot tell which delegated
    // guilds a claimant belongs to without asking — so a claimant beyond the
    // cap may need to retry before their guild comes up. Rotation guarantees it
    // eventually does.
    const candidates = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_state_lastRotatedAt", (q) => q.eq("state", "active"))
      .take(MAX_ADAPTER_DELEGATIONS * 4);

    // A delegation is only as good as the delegator's current control of the
    // guild. Once OAuth reconciliation revokes their proof, or it passes its
    // revalidation window, VRDex must stop querying that community's key even
    // though the credential row itself is still active.
    const now = Date.now();
    const usable = [];
    const skipped = [];

    for (const row of candidates) {
      if (usable.length >= MAX_ADAPTER_DELEGATIONS) {
        break;
      }

      const proof = await getActiveControlProof(
        ctx.db,
        row.delegatedByUserId,
        "discord_guild",
        row.guildId,
      );

      if (proof === null || (proof.revalidateAfter !== undefined && proof.revalidateAfter <= now)) {
        skipped.push(row._id);
        continue;
      }

      usable.push(row);
    }

    // Advance the cursor for every row this pass looked at, in the same
    // transaction that chose them. Rotation only — being looked at is not being
    // consulted, so the operator-visible stamp happens later, once a provider
    // call is actually going out.
    //
    // Ineligible rows are stamped too. They sort by `lastRotatedAt` like
    // everything else, so leaving them unstamped pins them permanently at the
    // head of the index and, once there are more of them than the scan window,
    // no usable delegation is ever reached again.
    await Promise.all(
      [...usable.map((row) => row._id), ...skipped].map((credentialId) =>
        ctx.db.patch(credentialId, { lastRotatedAt: now }),
      ),
    );

    return {
      discordUserId: discordAccount.providerAccountId,
      delegations: usable.map((row) => ({
        credentialId: row._id,
        guildId: row.guildId,
        secretRef: row.secretRef,
      })),
    };
  },
});

/**
 * Record that a delegation's reference was actually sent to the adapter.
 *
 * Deliberately does not touch `updatedAt`, `lastUsedAt`, or
 * `lastResultSummary`: being asked is not the same as having answered, and an
 * operator's audit trail should not fill with other communities' proofs.
 */
export const recordCredentialConsultations = internalMutation({
  args: {
    // Paired with the reference each was consulted through. An owner can
    // replace or revoke a delegation while the adapter is answering, and
    // stamping the row by id alone made the *replacement* key look queried when
    // only the superseded one was ever sent.
    consulted: v.array(
      v.object({
        credentialId: v.id("communityVrclinkingCredentials"),
        secretRef: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await Promise.all(
      args.consulted.map(async ({ credentialId, secretRef }) => {
        const credential = await ctx.db.get(credentialId);

        if (
          credential === null ||
          credential.state !== "active" ||
          credential.secretRef !== secretRef
        ) {
          return;
        }

        await ctx.db.patch(credentialId, { lastConsultedAt: now });
      }),
    );
  },
});

/** Record that a delegation actually produced the match. */
export const recordCredentialUse = internalMutation({
  args: {
    credentialId: v.id("communityVrclinkingCredentials"),
    // The reference this attestation was actually obtained with. An owner can
    // revoke or repoint the delegation while the adapter is answering, and a
    // verdict from the superseded key must not be accepted on the new one's
    // behalf — nor stamp `lastUsedAt` as though the new key had answered.
    secretRef: v.string(),
    resultSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.db.get(args.credentialId);

    if (
      credential === null ||
      credential.state !== "active" ||
      credential.secretRef !== args.secretRef
    ) {
      return { accepted: false };
    }

    // The delegation is only as good as the delegator's current control of the
    // guild, which the selection checked and which can also lapse inside this
    // window.
    const proof = await getActiveControlProof(
      ctx.db,
      credential.delegatedByUserId,
      "discord_guild",
      credential.guildId,
    );
    const now = Date.now();

    if (proof === null || (proof.revalidateAfter !== undefined && proof.revalidateAfter <= now)) {
      return { accepted: false };
    }

    await ctx.db.patch(args.credentialId, {
      lastRotatedAt: now,
      lastConsultedAt: now,
      lastUsedAt: now,
      lastResultSummary: args.resultSummary.slice(0, 300),
      updatedAt: now,
    });

    return { accepted: true };
  },
});
