import { v } from "convex/values";

import { getLinkedProviderAccount } from "./accounts";
import { requireVerifiedActiveBrowserSession } from "./_claimSession";
import { claimError } from "./_claimErrors";
import { vrclinkingSecretName, vrclinkingSecretRef } from "./_vrclinkingSecretRef";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
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
const secretNameFor = vrclinkingSecretName;
const secretRefFor = vrclinkingSecretRef;

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
 * Both checks a delegation needs, in one place.
 *
 * Profile ownership is not enough on its own: the delegation is only as
 * trustworthy as the delegator's control of the guild whose member links it
 * opens up.
 */
async function requireDelegationAuthority(
  ctx: QueryCtx,
  profileSlug: string,
  rawGuildId: string,
) {
  const { user } = await requireVerifiedActiveBrowserSession(ctx);
  const profile = await requireOwnedCommunityProfile(ctx.db, profileSlug, user._id);
  const guildId = rawGuildId.trim();

  if (!DISCORD_GUILD_ID_PATTERN.test(guildId)) {
    throw claimError("INVALID_DISCORD_GUILD_ID");
  }

  await requireControlProof(
    ctx.db,
    user._id,
    "discord_guild",
    guildId,
    MINIMUM_COMMUNITY_CONTROL_LEVEL,
  );

  return { guildId, profile, user };
}

/**
 * A pending row that has plainly been abandoned.
 *
 * Long enough that a slow Secrets Manager write is never swept out from under
 * the route holding it; short enough that a crashed request does not leave a
 * name reserved for the rest of the day.
 */
const PENDING_DELEGATION_TTL_MS = 10 * 60 * 1000;

/**
 * Replacements one owner may make for one guild inside that same window.
 *
 * Every reservation creates a Secrets Manager object, and a deleted one holds
 * its name for a seven-day recovery window, so an unbounded loop costs both
 * money and the account's secret quota. High enough that correcting a mistyped
 * key is never refused.
 */
const MAX_RECENT_DELEGATION_WRITES = 10;

/**
 * Reserve the row a pasted key will be written against.
 *
 * The row exists, with its own id and therefore its own secret name, before
 * anything is written — which is what makes the write non-destructive. The
 * community's working delegation stays active and untouched until
 * `activateCredential` succeeds, so a Secrets Manager failure, an expiring
 * authorization, or a crashed request costs an unused pending row and nothing
 * else.
 *
 * Registering first and writing after would revoke the working delegation on
 * the way to a write that might fail. Writing first and registering after was
 * no better while names were guild-scoped: the new key landed under the *old*
 * row's identical reference, so a failed registration left the previous
 * delegation quietly answering with a key nobody had registered.
 */
export const reserveCredential = mutation({
  args: { profileSlug: v.string(), guildId: v.string() },
  handler: async (ctx, args) => {
    const { guildId, profile, user } = await requireDelegationAuthority(
      ctx,
      args.profileSlug,
      args.guildId,
    );
    const now = Date.now();

    // Swept here rather than on a cron: this is the only thing that creates
    // them, so it is the only place that can accumulate them.
    //
    // The names go back to the caller rather than being dropped. A request that
    // dies between writing the key and activating leaves a pending row whose
    // secret *does* exist, and deleting the row silently is what would strand
    // that key forever — the name is the only handle on it, and it is derived
    // from a row that no longer exists. Convex cannot reach Secrets Manager, so
    // it hands the names to the one caller that can.
    const stale = (
      await ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", profile._id).eq("state", "pending"),
        )
        .collect()
    ).filter((row) => row.guildId === guildId && row.createdAt + PENDING_DELEGATION_TTL_MS <= now);
    const abandonedSecretNames = stale.map((row) => secretNameFor(row.guildId, row._id));

    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

    // A cap, because every reservation creates a Secrets Manager object and
    // nothing else bounds how many an owner can ask for. Counted over the same
    // window the sweep uses, so an owner correcting a typo is never blocked
    // while a loop is.
    const recent = (
      await ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", profile._id).eq("state", "revoked"),
        )
        .collect()
    ).filter((row) => row.guildId === guildId && row.createdAt + PENDING_DELEGATION_TTL_MS > now);

    if (recent.length >= MAX_RECENT_DELEGATION_WRITES) {
      throw claimError("TOO_MANY_OPEN_PROOFS");
    }

    const credentialId = await ctx.db.insert("communityVrclinkingCredentials", {
      communityProfileId: profile._id,
      guildId,
      // Placeholder. Every reader derives the reference from the row, so this
      // is never the value anything compares against — but the field is
      // required, and writing the derived value needs the id this insert is
      // producing.
      secretRef: "",
      state: "pending",
      delegatedByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(credentialId, { secretRef: secretRefFor(guildId, credentialId) });

    return {
      credentialId,
      secretName: secretNameFor(guildId, credentialId),
      abandonedSecretNames,
    };
  },
});

/**
 * Activate a reserved delegation once its key is actually in the store.
 *
 * Re-authorizes rather than trusting the reservation: control of the guild can
 * lapse in the window, and this is the call that starts sending the key to a
 * third party.
 */
export const activateCredential = mutation({
  args: { profileSlug: v.string(), credentialId: v.id("communityVrclinkingCredentials") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.credentialId);

    if (pending === null) {
      throw claimError("LINK_NOT_FOUND");
    }

    const { profile } = await requireDelegationAuthority(ctx, args.profileSlug, pending.guildId);

    // Already done. A retry after a lost response must not read as a failure —
    // the caller decides whether to retire the stored key from this answer, and
    // an activation reported as failed after it committed would destroy the key
    // it had just installed.
    if (pending.state === "active" && pending.communityProfileId === profile._id) {
      // The same obligation the first call returned. Reporting an empty list on
      // a replay meant a lost response also lost the names of the keys that
      // activation had just retired, leaving them in the store with nothing
      // pointing at them.
      return {
        credentialId: pending._id,
        replaced: (pending.supersededSecretNames ?? []).length > 0,
        supersededSecretNames: pending.supersededSecretNames ?? [],
      };
    }

    if (pending.state !== "pending") {
      throw claimError("LINK_NOT_FOUND");
    }

    // The reservation belongs to this profile or it belongs to nobody here.
    // Without this, an owner of profile A could activate a row reserved under
    // profile B and adopt its secret name.
    if (pending.communityProfileId !== profile._id) {
      throw claimError("LINK_NOT_FOUND");
    }

    const now = Date.now();
    const active = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "active"),
      )
      .collect();
    const superseded = active.filter((row) => row.guildId === pending.guildId);

    // Revoked rather than patched in place, so the replacement does not inherit
    // an audit history it did not earn: the Connections page would otherwise
    // attribute the old key's queries and matches to a credential that has
    // answered nothing, which is the operator's only way to tell a working
    // delegation from an untested one. Each row keeps its own secret, so
    // revoking one never disturbs the other's key.
    await Promise.all(
      superseded.map((row) =>
        ctx.db.patch(row._id, {
          state: "revoked",
          revokedAt: now,
          revokedReason: "Replaced by a new delegated credential.",
          updatedAt: now,
        }),
      ),
    );

    const supersededSecretNames = superseded.map((row) => secretNameFor(row.guildId, row._id));

    // Recorded on the row, not just returned: a retry after a lost response has
    // to be able to hand back the same names, and by then the revoked rows are
    // indistinguishable from ones retired by an earlier replacement.
    await ctx.db.patch(pending._id, { state: "active", supersededSecretNames, updatedAt: now });

    return {
      credentialId: pending._id,
      replaced: superseded.length > 0,
      // Revoking the row does not remove the key it points at, and per-credential
      // names are never reused — so a replaced key would otherwise sit in the
      // store forever: unreachable, but still a community's live provider
      // credential, still readable by the adapter role. The caller retires them.
      supersededSecretNames,
    };
  },
});

/**
 * Drop a reservation whose key never made it into the store.
 *
 * Deletes rather than revokes: nothing was ever delegated, so an operator's
 * audit list should not fill with rows recording that a form failed.
 */
export const abandonCredential = mutation({
  args: { profileSlug: v.string(), credentialId: v.id("communityVrclinkingCredentials") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.credentialId);

    if (pending === null || pending.state !== "pending") {
      return { abandoned: false };
    }

    // Deliberately not `requireDelegationAuthority`: this runs on the path where
    // activation *failed*, and the most common reason is that the guild control
    // proof lapsed between reserving and activating. Repeating that check here
    // meant cleanup failed for exactly the reason cleanup was needed, and the
    // owner's key stayed in the store with nothing pointing at it.
    //
    // Still authorized, just not on the lapsed condition: the caller has to be
    // the signed-in user who created this reservation, and the row has to be
    // `pending`. Neither grants anything — a pending row is inert and deleting
    // it only discards a name nothing has used.
    const { user } = await requireVerifiedActiveBrowserSession(ctx);

    if (pending.delegatedByUserId !== user._id) {
      return { abandoned: false };
    }

    await ctx.db.delete(pending._id);

    return { abandoned: true, secretName: secretNameFor(pending.guildId, pending._id) };
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
 * How many distinct keys for one guild a single fan-out may try.
 *
 * More than one so a stale key cannot permanently suppress a working one; well
 * under the fan-out so one guild still cannot crowd out every other community.
 */
const MAX_DELEGATIONS_PER_GUILD = 2;

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
    // One guild may back several community profiles. Those rows used to derive
    // one shared reference, so sending each was a repeat of an identical
    // `/members/<guildId>` lookup — spending that community's quota once per row
    // and, with five rows, filling the whole fan-out with a single server while
    // a guild that could actually attest the claimant waited for a
    // cooldown-limited retry.
    //
    // Per-credential names ended that equivalence: those rows now hold
    // *different* keys. Dropping all but the first meant a stale or rejected key
    // permanently suppressed a working one, deterministically, because tied
    // rotation stamps preserve index order. A small per-guild allowance gives
    // the second key a turn without letting one guild crowd the fan-out.
    const perGuild = new Map<string, number>();

    for (const row of candidates) {
      if (usable.length >= MAX_ADAPTER_DELEGATIONS) {
        break;
      }

      // Stamped, not skipped: `lastRotatedAt` is the selection cursor, and a
      // duplicate left unstamped pins the head of the index exactly like an
      // ineligible row does.
      if ((perGuild.get(row.guildId) ?? 0) >= MAX_DELEGATIONS_PER_GUILD) {
        skipped.push(row._id);
        continue;
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

      perGuild.set(row.guildId, (perGuild.get(row.guildId) ?? 0) + 1);
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
        // Derived, not read back. The reference is a pure function of the guild
        // id, so the stored string carries no information — and a deployment
        // upgraded from when the ARN form was accepted still holds rows in that
        // shape. Emitting them verbatim meant the adapter dropped every one,
        // leaving those communities listed as delegated while silently
        // answering nothing. Deriving here retires the old rows without a
        // migration, and `recordCredentialUse` re-checks the same value.
        secretRef: secretRefFor(row.guildId, row._id),
        // Which version of this delegation the adapter is being asked about.
        // Every version derives the same reference, and the adapter caches a
        // resolved token for five minutes keyed on it — so without this a warm
        // container could answer a claim reserved against a replacement row
        // using the token it cached for the row that replacement superseded.
        // A cache key rather than a credential: the capability still authorizes
        // the request, so a forged generation costs only a cache miss.
        generation: row._creationTime,
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

        // Derived, like the other three comparison sites. Reading the stored
        // value discarded every consultation of a row registered before the ARN
        // form was retired, so `/account/connections` kept showing "Not used
        // yet" for a key that was being queried on every claim — the one
        // surface an operator has for telling a dead delegation from a live
        // one, reporting the opposite of the truth.
        if (
          credential === null ||
          credential.state !== "active" ||
          secretRefFor(credential.guildId, credential._id) !== secretRef
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

    // Compared against the derived reference, matching what selection sent.
    // Reading the stored string here would reject any row registered before the
    // ARN form was retired, which is exactly the population deriving on read
    // exists to keep working.
    if (
      credential === null ||
      credential.state !== "active" ||
      secretRefFor(credential.guildId, credential._id) !== args.secretRef
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
