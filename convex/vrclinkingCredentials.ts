import { v } from "convex/values";

import { boundedFetch } from "./_boundedFetch";
import { requireSecureOutboundUrl } from "./_secureUrl";
import { internal } from "./_generated/api";

import { getLinkedProviderAccount } from "./accounts";
import { requireVerifiedActiveBrowserSession } from "./_claimSession";
import { claimError } from "./_claimErrors";
import {
  vrclinkingSecretName,
  vrclinkingSecretNameForRow,
  vrclinkingSecretRef,
  vrclinkingSecretRefForRow,
} from "./_vrclinkingSecretRef";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
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

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

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
 * Whether a row's key might still be arriving.
 *
 * Only ever true of a cancelled reservation: a revoke can retire a name moments
 * before the POST that reserved it finishes writing, and deleting a
 * not-yet-created secret succeeds, so the retirement would be recorded against
 * a key that then comes into existence. Until the writer is presumed gone —
 * which is what the reservation TTL means — that row stays unretired and the
 * sweep keeps offering it.
 *
 * A genuine revocation is settled the moment it happens: its key was written
 * long before, so there is no writer to wait for.
 */
function writerMayStillBeRunning(
  row: Doc<"communityVrclinkingCredentials">,
  now: number,
): boolean {
  return (
    row.revokedReason === ABANDONED_RESERVATION_REASON &&
    row.createdAt + PENDING_DELEGATION_TTL_MS > now
  );
}

/**
 * The names among `retiring` that no other live delegation still resolves
 * through.
 *
 * Only legacy rows raise the question: their name is guild-scoped, so it is
 * shared by every pre-naming row for that guild — across profiles. A
 * per-credential name cannot be shared, because nothing else can derive it.
 *
 * This lives in one place because it was needed in four: activation's
 * supersession, the abandoned-reservation sweep, the revoke path, and the retry
 * that reports unretired rows. Fixing them one at a time is how three separate
 * rounds each retired a name another profile was still using.
 */
async function retirableSecretNames(
  ctx: QueryCtx,
  guildId: string,
  retiring: Doc<"communityVrclinkingCredentials">[],
): Promise<string[]> {
  const names = retiring.map((row) => vrclinkingSecretNameForRow(row));

  const live = await ctx.db
    .query("communityVrclinkingCredentials")
    .withIndex("by_guildId_state", (q) => q.eq("guildId", guildId).eq("state", "active"))
    .collect();
  const stillLive = new Set(
    live
      .filter((row) => !retiring.some((retired) => retired._id === row._id))
      .map((row) => vrclinkingSecretNameForRow(row)),
  );

  return [...new Set(names.filter((name) => !stillLive.has(name)))];
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
 * Marks a row that was reserved and never activated, as against one an owner
 * actually delegated and later revoked. The first is noise in an audit list and
 * is deleted once its key is gone; the second is history and is kept.
 */
const ABANDONED_RESERVATION_REASON = "Reservation abandoned before activation.";

/**
 * Replacements one owner may make for one guild inside that same window.
 *
 * Every reservation creates a Secrets Manager object, and a deleted one holds
 * its name for a seven-day recovery window, so an unbounded loop costs both
 * money and the account's secret quota. High enough that correcting a mistyped
 * key is never refused.
 */
const MAX_RECENT_DELEGATION_WRITES = 10;

/** One sweep's worth. A backlog drains over runs rather than in one action. */
const OVERDUE_CLEANUP_SCAN_LIMIT = 50;

/**
 * How many rows one sweep will look at.
 *
 * Bounds the read, not the result: the batch is still
 * `OVERDUE_CLEANUP_SCAN_LIMIT`. A cap alone was never enough, because rows the
 * legacy-name liveness guard withholds never settle — so an age-ordered scan
 * restarted into the same ones daily and this number was just where the wall
 * sat. Every row a pass looks at is stamped and the next scan resumes behind it,
 * which is what makes a bounded read still make progress.
 */
const OVERDUE_CLEANUP_MAX_EXAMINED = 500;

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
    // Reported, not deleted. A request that dies between writing the key and
    // activating leaves a pending row whose secret *does* exist, and the row is
    // the only handle on it — the name is derived from the row id. Deleting here
    // and handing the name over in the same breath meant a transient Secrets
    // Manager failure lost the name for good, with no way to reconstruct it and
    // nothing left to retry from.
    //
    // The row survives until the caller confirms the key is gone. It stays
    // inert meanwhile: no selection query matches a non-`active` state, so a
    // tombstone costs a row and nothing else.
    const stale = (
      await ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", profile._id).eq("state", "pending"),
        )
        .collect()
    ).filter(
      (row) =>
        row.guildId === guildId &&
        row.secretRetiredAt === undefined &&
        row.createdAt + PENDING_DELEGATION_TTL_MS <= now,
    );
    // Revoked rows whose key was never confirmed gone belong here too. Revoking
    // makes the row unfindable by the revoke path — it looks for an *active*
    // row — so a `DeleteSecret` that failed transiently had no retry at all, and
    // the owner's live key stayed in the store after they asked for it to go.
    const unretired = (
      await ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_guildId_state_secretRetiredAt", (q) =>
          q.eq("guildId", guildId).eq("state", "revoked").eq("secretRetiredAt", undefined),
        )
        .collect()
    ).filter((row) => row.communityProfileId === profile._id);

    // Claimed before anyone deletes its key. A request still in flight past the
    // TTL could otherwise activate the very row a later request has just
    // scheduled for deletion — and with the file backend that deletion is
    // immediate, so the winning activation would come up backed by nothing.
    // `activateCredential` only accepts a `pending` row, so moving it out of
    // that state is the whole guard.
    await Promise.all(
      stale.map((row) =>
        ctx.db.patch(row._id, {
          state: "revoked",
          revokedAt: now,
          revokedReason: ABANDONED_RESERVATION_REASON,
          updatedAt: now,
        }),
      ),
    );

    const retiring = [...stale, ...unretired];
    const retirable = new Set(await retirableSecretNames(ctx, guildId, retiring));
    const abandoned = retiring
      .map((row) => ({ credentialId: row._id, secretName: vrclinkingSecretNameForRow(row) }))
      // A revoked legacy row can outlive the check that withheld its name at
      // activation: another profile still delegates that guild, so the shared
      // name is not retirable yet. Reporting it anyway put the retry itself in
      // the business of breaking the delegation the original check protected.
      .filter((row) => retirable.has(row.secretName));

    // A cap, because every reservation creates a Secrets Manager object and
    // nothing else bounds how many an owner can ask for. Counted over the same
    // window the sweep uses, so an owner correcting a typo is never blocked
    // while a loop is.
    //
    // Every state, not just `revoked`. Concurrent requests are all still
    // `pending` — none has reached activation, so none has revoked anything —
    // and counting settled rows alone let an unbounded burst through with each
    // one creating its own secret before the first finished.
    // By delegating user, not by profile. Scoping to one profile gave an owner a
    // fresh allowance for every profile they control, and one guild can be
    // delegated through as many of them as they like — so the bound multiplied
    // by exactly the thing it was meant to bound.
    // Ranged on the index rather than collected and filtered. Genuine
    // revocations are kept as audit history, so a long-lived operator
    // accumulates rows indefinitely — reading all of them to count ten would
    // eventually exceed Convex's read limits and stop them reserving at all.
    const recent = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_delegatedByUserId_guildId_createdAt", (q) =>
        q
          .eq("delegatedByUserId", user._id)
          .eq("guildId", guildId)
          .gt("createdAt", now - PENDING_DELEGATION_TTL_MS),
      )
      .collect();

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

    return { credentialId, secretName: secretNameFor(guildId, credentialId), abandoned };
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
      const savedNames = pending.supersededSecretNames ?? [];
      // Re-derived rather than left empty. A replay schedules the same deletions,
      // so it owes the same confirmations — returning names with no rows meant
      // the retry deleted the keys and confirmed nothing, leaving every replaced
      // row an outstanding obligation that later reservations kept re-reporting.
      const revokedRows = await ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", profile._id).eq("state", "revoked"),
        )
        .collect();

      return {
        credentialId: pending._id,
        replaced: savedNames.length > 0,
        supersededSecretNames: savedNames,
        supersededCredentials: revokedRows
          .map((row) => ({ credentialId: row._id, secretName: vrclinkingSecretNameForRow(row) }))
          .filter((row) => savedNames.includes(row.secretName)),
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

    // Per row, not per scheme: a delegation created before per-credential naming
    // keeps its key under the guild-only name, and deriving the current shape
    // would schedule deletion of an object that does not exist while leaving the
    // real provider key in the store.
    //
    const supersededSecretNames = await retirableSecretNames(ctx, pending.guildId, superseded);
    // Paired with their rows, so the caller can confirm exactly the ones whose
    // deletion succeeded rather than confirming a batch or nothing.
    const supersededCredentials = superseded
      .map((row) => ({ credentialId: row._id, secretName: vrclinkingSecretNameForRow(row) }))
      .filter((row) => supersededSecretNames.includes(row.secretName));

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
      supersededCredentials,
    };
  },
});

/**
 * Record that the caller actually deleted these rows' keys.
 *
 * Separate from the sweep that reports them, because only the caller knows
 * whether Secrets Manager accepted the deletion. A row that is not confirmed
 * stays reportable, and the next reservation offers it again — which is the
 * retry, and the only one either path has.
 *
 * A reservation that never delegated anything is deleted outright; a revoked row
 * is stamped, because an operator's audit list should keep the delegation that
 * existed while losing the key that backed it.
 */
export const confirmSecretsRetired = mutation({
  args: {
    profileSlug: v.string(),
    credentialIds: v.array(v.id("communityVrclinkingCredentials")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const profile = await requireOwnedCommunityProfile(ctx.db, args.profileSlug, user._id);
    // `active` is excluded deliberately. A stale reservation can be swept and
    // its deletion scheduled by a later request while the original one is still
    // in flight; if that original wins the race and activates, confirming here
    // would mark the *live* delegation's key retired — and it is already
    // scheduled for deletion, so the community would lose its only working
    // credential when the recovery window closed.
    const rows = (await Promise.all(args.credentialIds.map((id) => ctx.db.get(id)))).filter(
      (row) =>
        row !== null && row.communityProfileId === profile._id && row.state !== "active",
    );
    const now = Date.now();

    // Stamped, never deleted. The row is the only thing its key's name can be
    // derived from, so deleting it on confirmation destroyed the retry handle at
    // exactly the moment a concurrent write might still be creating that key —
    // and a later reservation could then neither find nor reconstruct it.
    //
    // A reservation that never delegated anything is moved out of `pending` at
    // the same time, so the stale sweep stops offering it. Both end up inert:
    // `listCredentials` shows active rows only, and the unretired sweep skips
    // anything already stamped.
    //
    // Except while its writer might still be running. Deleting a key that does
    // not exist yet succeeds — idempotently, and correctly — so a revoke racing
    // a reservation can retire a name moments before the POST creates it. The
    // stamp would then suppress the only durable handle to a live provider key.
    // A cancelled reservation stays unretired until its writer is presumed gone,
    // which is what the TTL means, and the unretired sweep keeps offering it
    // until then.
    await Promise.all(
      rows.map((row) => {
        const pendingWriter = writerMayStillBeRunning(row!, now);

        // Settled and never a delegation: delete rather than stamp. Keeping
        // every aborted write forever is not audit history — nobody delegated
        // anything — and `reserveCredential` reads all of a profile's revoked
        // rows before filtering, so enough of them would eventually put that
        // query past Convex's read limits and block delegation changes outright.
        //
        // A genuine revocation is history and stays. The window where a writer
        // might still be running is the one time an abandoned row must survive,
        // because it is the only handle on a key that may be arriving.
        if (
          !pendingWriter &&
          (row!.state === "pending" || row!.revokedReason === ABANDONED_RESERVATION_REASON)
        ) {
          return ctx.db.delete(row!._id);
        }

        return ctx.db.patch(row!._id, {
          ...(pendingWriter ? {} : { secretRetiredAt: now }),
          updatedAt: now,
          ...(row!.state === "pending"
            ? {
                state: "revoked" as const,
                revokedAt: now,
                revokedReason: ABANDONED_RESERVATION_REASON,
              }
            : {}),
        });
      }),
    );

    return { confirmed: rows.length };
  },
});

/**
 * The same discard, authorized by the server rather than the browser session.
 *
 * `abandonCredential` needs a live session, and the case it most needs to cover
 * is the one where that session has just died: an expiry between storing the key
 * and activating it makes activation fail, and then makes cleanup fail for the
 * same reason. The key stays with nothing pointing at it, and after a revocation
 * there may never be another reservation for that guild to sweep it.
 *
 * Internal, so only the route can call it, and it takes the credential id the
 * route already holds from its own reservation — it cannot be pointed at a row
 * the caller did not create in this request.
 */
export const abandonCredentialAsServer = internalMutation({
  args: { credentialId: v.id("communityVrclinkingCredentials") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.credentialId);

    // Gone entirely, which a revoke racing this request can do: it cancels the
    // reservation, the DELETE route retires the name — successfully, because the
    // write had not landed yet — and confirmation deletes the row. The caller
    // still holds the name and has to finish the job.
    if (pending === null) {
      return { abandoned: false, missing: true, secretName: null };
    }

    const discardable =
      pending.state === "pending" ||
      (pending.state === "revoked" && pending.revokedReason === ABANDONED_RESERVATION_REASON);

    if (!discardable) {
      return { abandoned: false, missing: false, secretName: null };
    }

    const now = Date.now();

    if (pending.state === "pending") {
      await ctx.db.patch(pending._id, {
        state: "revoked",
        revokedAt: now,
        revokedReason: ABANDONED_RESERVATION_REASON,
        updatedAt: now,
      });
    }

    const [retirable] = await retirableSecretNames(ctx, pending.guildId, [pending]);

    return { abandoned: true, missing: false, secretName: retirable ?? null };
  },
});

/**
 * Confirm retirement without a browser session, for the same reason.
 */
export const confirmSecretsRetiredAsServer = internalMutation({
  args: { credentialIds: v.array(v.id("communityVrclinkingCredentials")) },
  handler: async (ctx, args) => {
    const rows = (await Promise.all(args.credentialIds.map((id) => ctx.db.get(id)))).filter(
      (row) => row !== null && row.state !== "active",
    );
    const now = Date.now();

    // Stamped, never deleted. The row is the only thing its key's name can be
    // derived from, so deleting it on confirmation destroyed the retry handle at
    // exactly the moment a concurrent write might still be creating that key —
    // and a later reservation could then neither find nor reconstruct it.
    //
    // A reservation that never delegated anything is moved out of `pending` at
    // the same time, so the stale sweep stops offering it. Both end up inert:
    // `listCredentials` shows active rows only, and the unretired sweep skips
    // anything already stamped.
    //
    // Except while its writer might still be running. Deleting a key that does
    // not exist yet succeeds — idempotently, and correctly — so a revoke racing
    // a reservation can retire a name moments before the POST creates it. The
    // stamp would then suppress the only durable handle to a live provider key.
    // A cancelled reservation stays unretired until its writer is presumed gone,
    // which is what the TTL means, and the unretired sweep keeps offering it
    // until then.
    await Promise.all(
      rows.map((row) => {
        const pendingWriter = writerMayStillBeRunning(row!, now);

        // Settled and never a delegation: delete rather than stamp. Keeping
        // every aborted write forever is not audit history — nobody delegated
        // anything — and `reserveCredential` reads all of a profile's revoked
        // rows before filtering, so enough of them would eventually put that
        // query past Convex's read limits and block delegation changes outright.
        //
        // A genuine revocation is history and stays. The window where a writer
        // might still be running is the one time an abandoned row must survive,
        // because it is the only handle on a key that may be arriving.
        if (
          !pendingWriter &&
          (row!.state === "pending" || row!.revokedReason === ABANDONED_RESERVATION_REASON)
        ) {
          return ctx.db.delete(row!._id);
        }

        return ctx.db.patch(row!._id, {
          ...(pendingWriter ? {} : { secretRetiredAt: now }),
          updatedAt: now,
          ...(row!.state === "pending"
            ? {
                state: "revoked" as const,
                revokedAt: now,
                revokedReason: ABANDONED_RESERVATION_REASON,
              }
            : {}),
        });
      }),
    );

    return { confirmed: rows.length };
  },
});


/**
 * Claim and report every cleanup obligation nobody is coming back for.
 *
 * A mutation, not a query, because claiming and selecting have to be one
 * transaction: an expired reservation is moved out of `pending` before its name
 * is handed out, exactly as `reserveCredential` does, so a writer that surfaces
 * afterwards cannot activate the row whose key is being deleted.
 *
 * Covers three populations, which earlier versions each missed one of:
 *
 * - expired reservations whose POST died after writing the key;
 * - cancelled reservations past their writer window;
 * - genuine revocations and replacements whose `DeleteSecret` failed transiently,
 *   which are otherwise retried only if the owner touches that guild again.
 *
 * Selected through `by_secretRetiredAt_createdAt`, so the scan cap applies to
 * rows that are actually obligations. Capping a broader scan first let retired
 * history at the head of the index starve the sweep indefinitely.
 *
 * Two caps, not one, and they count different things.
 * `OVERDUE_CLEANUP_SCAN_LIMIT` bounds the batch and is applied to obligations —
 * rows that survived the liveness guard and will actually have a key deleted.
 * `OVERDUE_CLEANUP_MAX_EXAMINED` bounds the read. Neither is a wall, because
 * every row a pass looks at and does not hand out is stamped and sorts behind
 * the rows it has not reached, so consecutive sweeps advance instead of
 * restarting into the same head.
 */
export const claimOverdueSecretCleanups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Per non-active state, because `secretRetiredAt` is also unset on every
    // *active* delegation — a deployment with fifty live keys would otherwise
    // fill the batch with rows that are not obligations and hand the sweep
    // nothing, forever.
    //
    // Scanned past, because a row can be an obligation by state and still be
    // withheld by the legacy-name liveness guard: another profile is still
    // resolving through the shared guild-scoped name. Those rows never settle —
    // nothing retires them, so nothing stamps `secretRetiredAt` and they stay in
    // this index forever.
    //
    // Which is why the scan orders by its own stamp and not by `createdAt`.
    // Ordered by age, every sweep restarted into the same head: a scan cap moved
    // the wall from one batch to `OVERDUE_CLEANUP_MAX_EXAMINED`, but that many
    // permanently withheld rows still meant every daily run examined the same
    // ones and reached nothing behind them. Stamping every row a pass considers
    // — eligible or not — is what `lastRotatedAt` already does one field over,
    // and for exactly this reason.
    //
    // Streaming rather than paging is the other half. A `.gt()` cursor on
    // `createdAt` was not unique, so advancing past the last row of a page
    // skipped every row sharing its millisecond; iterating the index has no
    // cursor to collide.
    const overdue: Doc<"communityVrclinkingCredentials">[] = [];
    const examined: Doc<"communityVrclinkingCredentials">[] = [];

    for (const state of ["pending", "revoked"] as const) {
      let seen = 0;

      for await (const row of ctx.db
        .query("communityVrclinkingCredentials")
        .withIndex("by_state_secretRetiredAt_lastCleanupScanAt", (q) =>
          q.eq("state", state).eq("secretRetiredAt", undefined),
        )) {
        seen += 1;
        examined.push(row);

        if (row.createdAt + PENDING_DELEGATION_TTL_MS <= now && !writerMayStillBeRunning(row, now)) {
          overdue.push(row);
        }

        if (seen >= OVERDUE_CLEANUP_MAX_EXAMINED) {
          break;
        }
      }
    }

    // Grouped by guild so the legacy-name liveness guard sees every row that
    // could still be resolving through a shared guild-scoped name.
    const byGuild = new Map<string, Doc<"communityVrclinkingCredentials">[]>();

    for (const row of overdue) {
      byGuild.set(row.guildId, [...(byGuild.get(row.guildId) ?? []), row]);
    }

    const obligations: {
      row: Doc<"communityVrclinkingCredentials">;
      credentialId: Id<"communityVrclinkingCredentials">;
      secretName: string;
    }[] = [];

    for (const [guildId, rows] of byGuild) {
      const retirable = new Set(await retirableSecretNames(ctx, guildId, rows));

      for (const row of rows) {
        const secretName = vrclinkingSecretNameForRow(row);

        if (retirable.has(secretName)) {
          obligations.push({ row, credentialId: row._id, secretName });
        }
      }
    }

    // Capped here rather than on the scan, because the two populations are not
    // the same one. A legacy row whose guild-scoped name another profile still
    // resolves through is due, is selected, and is then withheld by the guard
    // above — and it never settles, so it is due again tomorrow. Counting those
    // against the batch let fifty of them at the head of the index fill every
    // sweep with rows that produce no work, while per-credential obligations
    // behind them kept their keys forever.
    const batch = obligations.slice(0, OVERDUE_CLEANUP_SCAN_LIMIT);
    const handedOut = new Set(batch.map(({ credentialId }) => credentialId));

    // Claimed before their names go anywhere — and only the names actually going
    // anywhere. A candidate that was withheld is not being handed out, so there
    // is nothing to claim it against, and leaving it pending keeps the write
    // bounded by the batch rather than by how far the scan had to reach.
    await Promise.all(
      batch
        .filter(({ row }) => row.state === "pending")
        .map(({ credentialId }) =>
          ctx.db.patch(credentialId, {
            state: "revoked",
            revokedAt: now,
            revokedReason: ABANDONED_RESERVATION_REASON,
            updatedAt: now,
          }),
        ),
    );

    // Everything this pass looked at and did not hand out moves behind the rows
    // it has not reached yet. That is the whole reason the scan orders by this
    // stamp: a row the guard withholds is due forever, and without being moved
    // it would lead the index again tomorrow and every day after.
    //
    // The batch is deliberately not stamped. Those rows leave the index when the
    // route confirms their retirement, and if that confirmation never lands they
    // *should* lead the next scan — that is the retry, and the only one they get.
    await Promise.all(
      examined
        .filter((row) => !handedOut.has(row._id))
        .map((row) => ctx.db.patch(row._id, { lastCleanupScanAt: now })),
    );

    return batch.map(({ credentialId, secretName }) => ({ credentialId, secretName }));
  },
});

/**
 * Hand those obligations to the one party that can act on them.
 *
 * Convex cannot reach the secret store, so the web app does the deleting and the
 * confirming. Inert without both variables, which is the state every deployment
 * that has never delegated a key is in — including, today, all of them.
 */
export const sweepAbandonedDelegationKeys = internalAction({
  args: {},
  handler: async (ctx) => {
    const url = optionalEnv("VRCLINKING_CLEANUP_URL");
    const token = optionalEnv("VRCLINKING_CLEANUP_TOKEN");

    if (url === undefined || token === undefined) {
      return { swept: 0, configured: false };
    }

    // A trigger, not a payload. Claiming here and posting the names meant the
    // route deleted whatever the body said, so the bearer alone was authority to
    // schedule `DeleteSecret` on any delegated-credential name a caller could
    // spell. The route claims them itself now, through the admin credential it
    // already needs to confirm them — this only decides when.
    const response = await boundedFetch(requireSecureOutboundUrl(url, "cleanup_url"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

    const retired: unknown =
      response.ok && typeof response.body === "object" && response.body !== null
        ? (response.body as { retired?: unknown }).retired
        : undefined;

    // Left for the next run rather than reported: a sweep has no caller waiting
    // on it, and the rows stay unretired, which is the durable retry handle this
    // exists to preserve.
    return { swept: typeof retired === "number" ? retired : 0, configured: true };
  },
});

/**
 * Report whether a reservation is still safe to discard, without discarding it.
 *
 * Deliberately does not delete. The row is the only thing its secret name can be
 * derived from, so deleting here and deleting the key afterwards meant a
 * transient Secrets Manager failure stranded that key with nothing left to
 * retry from. The caller deletes the key first and calls
 * `confirmSecretsRetired`, which removes the row — the same order the swept and
 * revoked paths use.
 *
 * The answer is still the useful predicate: `pending` means the activation never
 * committed, which is the only state where the key is provably unreachable and
 * safe to remove.
 */
export const abandonCredential = mutation({
  args: { profileSlug: v.string(), credentialId: v.id("communityVrclinkingCredentials") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.credentialId);

    // A reservation that a revoke cancelled counts too. Revoking retires
    // in-flight rows for that guild, so the replacement whose key was already
    // written arrives here finding its row `revoked` rather than `pending` — and
    // refusing on that alone left the freshly pasted provider key in the store
    // with nothing to retire it, possibly forever, since nothing else for that
    // guild may ever be reserved again after a revocation.
    //
    // The reason marker is what makes this safe: it is set only where VRDex
    // itself cancelled a reservation, never on a delegation an owner actually
    // had.
    // Gone entirely, which a revoke racing this request can do: it cancels the
    // reservation, the DELETE route retires the name — successfully, because the
    // write had not landed yet — and confirmation deletes the row. The caller
    // still holds the name and has to finish the job, so this is reported apart
    // from a name deliberately withheld.
    if (pending === null) {
      return { abandoned: false, missing: true, secretName: null };
    }

    const discardable =
      pending.state === "pending" ||
      (pending.state === "revoked" && pending.revokedReason === ABANDONED_RESERVATION_REASON);

    if (!discardable) {
      return { abandoned: false, missing: false, secretName: null };
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
      return { abandoned: false, missing: false, secretName: null };
    }

    const now = Date.now();

    // Claimed, not merely reported. A response lost before the mutation
    // committed leaves the row readable as `pending`, so answering read-only let
    // the route schedule its key for deletion while the delayed activation could
    // still promote that same row and revoke its predecessor. Moving it out of
    // `pending` — the only state activation accepts — closes that, exactly as
    // the stale sweep does.
    if (pending.state === "pending") {
      await ctx.db.patch(pending._id, {
        state: "revoked",
        revokedAt: now,
        revokedReason: ABANDONED_RESERVATION_REASON,
        updatedAt: now,
      });
    }

    const [retirable] = await retirableSecretNames(ctx, pending.guildId, [pending]);

    return { abandoned: true, missing: false, secretName: retirable ?? null };
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
      return { revoked: false, credentialId: null, retired: [] };
    }

    const now = Date.now();

    // Reservations for the same guild go too. A replacement that reserved a row
    // and is still writing its key would otherwise activate afterwards, find no
    // active predecessor, and promote itself — resurrecting the delegation the
    // owner had just revoked, from another tab, another session, or a co-owner.
    // `activateCredential` accepts only `pending`, so retiring that state is the
    // guard.
    const reserved = await ctx.db
      .query("communityVrclinkingCredentials")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", profile._id).eq("state", "pending"),
      )
      .collect();

    const cancelled = reserved.filter((row) => row.guildId === target.guildId);

    await Promise.all(
      cancelled.map((row) =>
        ctx.db.patch(row._id, {
          state: "revoked",
          revokedAt: now,
          revokedReason: ABANDONED_RESERVATION_REASON,
          updatedAt: now,
        }),
      ),
    );

    await ctx.db.patch(target._id, {
      state: "revoked",
      revokedAt: now,
      revokedReason: "Revoked by the profile owner.",
      updatedAt: now,
    });

    // The name goes back so the caller can retire the key itself. Revoking the
    // row does not remove it, and per-credential names are never reused — so an
    // owner who revokes would otherwise leave their live provider key in the
    // store indefinitely, still readable by the adapter role, which is close to
    // the opposite of what pressing Revoke means.
    const retiring = [target, ...cancelled];
    const retirable = new Set(await retirableSecretNames(ctx, target.guildId, retiring));

    return {
      revoked: true,
      credentialId: target._id,
      // Every row this call retired, not just the delegation itself. A
      // replacement that wrote its key and then crashed leaves a reservation
      // with a live provider key and no request left to clean it up — and after
      // a revocation there may never be another reservation for this guild to
      // sweep it. Names absent here are ones another profile's live delegation
      // still resolves through: revoked either way, but not this profile's alone
      // to delete.
      retired: retiring
        .map((row) => ({ credentialId: row._id, secretName: vrclinkingSecretNameForRow(row) }))
        .filter((row) => retirable.has(row.secretName)),
    };
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
    // other keys a turn without letting one guild crowd the fan-out.
    //
    // The allowance alone is not enough past two profiles on one guild: giving
    // selected and skipped rows the same `lastRotatedAt` leaves the tie order
    // handing the same two rows every slot forever. The stamp below puts
    // *selected* rows strictly behind skipped ones, so selection itself is the
    // rotation cursor.
    //
    // Ordering by last consultation was the earlier attempt and it does not
    // hold: a credential whose secret fails to resolve is deliberately not
    // recorded as consulted, so two broken keys would keep their undefined
    // `lastConsultedAt` and stay ahead of a working third forever. Advancing on
    // the attempt is what makes rotation independent of the outcome.
    const perGuild = new Map<string, number>();
    const sentReferences = new Set<string>();

    for (const row of candidates) {
      if (usable.length >= MAX_ADAPTER_DELEGATIONS) {
        break;
      }

      // Stamped, not skipped: `lastRotatedAt` is the selection cursor, and a
      // duplicate left unstamped pins the head of the index exactly like an
      // ineligible row does.
      // Per-guild allowance *and* per-reference: several legacy rows for one
      // guild resolve to the identical guild-scoped secret, so sending each one
      // spends a provider request and a fan-out slot to ask the same question of
      // the same key twice.
      if (
        (perGuild.get(row.guildId) ?? 0) >= MAX_DELEGATIONS_PER_GUILD ||
        sentReferences.has(vrclinkingSecretRefForRow(row))
      ) {
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
      sentReferences.add(vrclinkingSecretRefForRow(row));
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
    // Both advance, so neither pins the head of the index — but selected rows
    // land strictly later, which sends them to the back of the queue and lets a
    // credential that was skipped for the per-guild cap take the next slot.
    await Promise.all([
      ...skipped.map((credentialId) => ctx.db.patch(credentialId, { lastRotatedAt: now })),
      ...usable.map((row) => ctx.db.patch(row._id, { lastRotatedAt: now + 1 })),
    ]);

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
        secretRef: vrclinkingSecretRefForRow(row),
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
          vrclinkingSecretRefForRow(credential) !== secretRef
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
      vrclinkingSecretRefForRow(credential) !== args.secretRef
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
