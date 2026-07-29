import { ConvexError, v } from "convex/values";

import {
  claimSessionUserOrNull,
  requireVerifiedActiveBrowserSession,
} from "./_claimSession";
import { isAuthSessionInvalidError } from "./_authSessionGuard";
import { requireSecureOutboundUrl } from "./_secureUrl";
import { boundedFetch } from "./_boundedFetch";
import { claimError } from "./_claimErrors";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import {
  type ExternalControlLevel,
  externalControlLevelRank,
  recordExternalControlProof,
  revokeExternalControlProof,
} from "./_externalControl";

const STATE_TTL_MS = 10 * 60_000;
/**
 * How long an unapplied reservation keeps its claim on ordering.
 *
 * Long enough to cover a slow OAuth round-trip, short enough that a callback
 * that died does not permanently silence every earlier reader — including one
 * that observed a revocation and would otherwise never get to apply it.
 */
const RESERVATION_ABANDONED_MS = 2 * 60_000;
/** Outstanding OAuth round-trips one account may hold at once. */
const MAX_OPEN_VERIFICATION_STATES = 5;

/** Code-point scan; no escaping subtlety can hide a control byte. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}
// Discord user and guild ids are both snowflakes.
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const DISCORD_ADMINISTRATOR_PERMISSION = BigInt(8);
const DISCORD_MANAGE_GUILD_PERMISSION = BigInt(32);

type DiscordOAuthGuild = {
  id: string;
  name?: string;
  owner?: boolean;
  permissions?: string;
};

type DiscordTokenResponse = {
  access_token?: string;
  token_type?: string;
};

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);

  if (!value) {
    throw claimError("ADAPTER_NOT_CONFIGURED", name);
  }

  return value;
}

function discordApiBaseUrl(): string {
  // The token exchange posts `AUTH_DISCORD_SECRET` and the authorization code
  // here, and every call after it carries the access token.
  return requireSecureOutboundUrl(
    optionalEnv("DISCORD_API_BASE_URL") ?? "https://discord.com/api/v10",
    "discord_api_url",
  ).replace(/\/$/, "");
}

function discordAuthorizeBaseUrl(): string {
  // Overridable so hosted E2E can point the consent step at a local stub. The
  // user's browser follows this one, so a plaintext consent page would put the
  // round-trip — and the `state` that authorizes it — on the wire in the clear.
  return requireSecureOutboundUrl(
    optionalEnv("DISCORD_OAUTH_AUTHORIZE_URL") ?? "https://discord.com/oauth2/authorize",
    "discord_authorize_url",
  )
    .replace(/\/$/, "");
}

export function discordVerificationRedirectUri(): string {
  return `${requiredEnv("SITE_URL").replace(/\/$/, "")}/api/discord/verify/callback`;
}

/**
 * Highest management tier the user holds in a guild, or null when they hold
 * none. Discord's three tiers all clear the bar for acting on a community's
 * behalf; we record which one so it can be shown and re-checked later.
 */
export function discordControlLevel(guild: DiscordOAuthGuild): ExternalControlLevel | null {
  if (guild.owner === true) {
    return "owner";
  }

  // A guild whose permissions cannot be read is not a guild the user lacks
  // access to. Reconciliation treats absence from the manageable list as
  // positive evidence that control was lost, so returning null for a malformed
  // value would revoke a working proof on the strength of a statement Discord
  // never actually made. Fail the whole round-trip instead.
  if (typeof guild.permissions !== "string" || !/^\d+$/.test(guild.permissions)) {
    throw claimError("ADAPTER_UNAVAILABLE", "discord_guild_permissions_malformed");
  }

  let permissions: bigint;

  try {
    permissions = BigInt(guild.permissions);
  } catch {
    throw claimError("ADAPTER_UNAVAILABLE", "discord_guild_permissions_malformed");
  }

  if ((permissions & DISCORD_ADMINISTRATOR_PERMISSION) !== BigInt(0)) {
    return "administrator";
  }

  if ((permissions & DISCORD_MANAGE_GUILD_PERMISSION) !== BigInt(0)) {
    return "manager";
  }

  return null;
}

function createStateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export const createVerificationState = internalMutation({
  args: { returnTo: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);

    // A crafted `returnTo` must not turn the callback into an open redirect.
    // Backslashes matter: the WHATWG URL parser normalizes them to forward
    // slashes for http(s), so `/\evil.com` clears a naive `//` check and then
    // resolves to a different host.
    if (
      !args.returnTo.startsWith("/") ||
      args.returnTo.startsWith("//") ||
      args.returnTo.includes("\\") ||
      hasControlCharacter(args.returnTo)
    ) {
      throw claimError("VERIFICATION_STATE_INVALID", "return_to_not_relative");
    }

    const now = Date.now();
    const state = createStateToken();

    // Opportunistically clear expired rows so the table stays small without
    // needing a dedicated cron.
    const stale = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(50);
    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

    // Expiry sweeping alone does not bound anything: a caller who starts the
    // flow and never finishes it accumulates unexpired rows faster than the
    // sweep reclaims them. Keeping only the caller's most recent few caps the
    // backlog per account outright, and still leaves room for the ordinary
    // reason to hold more than one — the same person starting the flow in a
    // couple of tabs.
    const own = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      // One extra beyond the cap absorbs the overshoot from concurrent calls;
      // every call trims back to the cap, so the backlog cannot grow past it.
      .take(MAX_OPEN_VERIFICATION_STATES + 5);
    await Promise.all(
      own.slice(MAX_OPEN_VERIFICATION_STATES - 1).map((row) => ctx.db.delete(row._id)),
    );

    await ctx.db.insert("discordVerificationStates", {
      userId: user._id,
      state,
      returnTo: args.returnTo,
      createdAt: now,
      expiresAt: now + STATE_TTL_MS,
    });

    return { state };
  },
});

export const consumeVerificationState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    // Read before the session guard so a revoked session can still be told
    // where the round-trip started. The row is not consumed and nothing is
    // returned on that path — the destination travels on the error, and
    // `invalidAuthSessionSignInPath` validates it before redirecting. Without
    // this a user whose session lapsed while they sat on the consent screen
    // signs in again and lands on `/account` instead of the claim they were
    // part-way through.
    const row = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    let user;

    try {
      ({ user } = await requireVerifiedActiveBrowserSession(ctx));
    } catch (error) {
      if (isAuthSessionInvalidError(error) && row !== null && row.expiresAt > Date.now()) {
        throw new ConvexError({
          ...(error.data as Record<string, unknown>),
          returnTo: row.returnTo,
        });
      }

      throw error;
    }

    if (row === null || row.userId !== user._id || row.expiresAt <= Date.now()) {
      throw claimError("VERIFICATION_STATE_INVALID");
    }

    await ctx.db.delete(row._id);

    return { returnTo: row.returnTo };
  },
});

/**
 * Reserve the next reconciliation generation for one Discord identity.
 *
 * Called before the guild read, so the order two overlapping callbacks were
 * issued in is fixed by a counter this mutation increments rather than by two
 * workers' clocks. Convex serializes conflicting mutations, so two callers
 * cannot draw the same number.
 */
export const reserveGuildVerificationGeneration = internalMutation({
  args: { discordUserId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const now = Date.now();
    const watermark = await ctx.db
      .query("discordVerificationWatermarks")
      .withIndex("by_userId_discordUserId", (q) =>
        q.eq("userId", user._id).eq("discordUserId", args.discordUserId),
      )
      .unique();

    if (watermark === null) {
      await ctx.db.insert("discordVerificationWatermarks", {
        userId: user._id,
        discordUserId: args.discordUserId,
        issuedGeneration: 1,
        appliedGeneration: 0,
        issuedAt: now,
        updatedAt: now,
      });

      return { generation: 1 };
    }

    const generation = watermark.issuedGeneration + 1;
    await ctx.db.patch(watermark._id, { issuedGeneration: generation, issuedAt: now, updatedAt: now });

    return { generation };
  },
});

export const recordGuildControlProofs = internalMutation({
  args: {
    discordUserId: v.string(),
    // From `reserveGuildVerificationGeneration`, drawn before the guild read.
    generation: v.number(),
    guilds: v.array(
      v.object({
        id: v.string(),
        name: v.optional(v.string()),
        controlLevel: v.union(
          v.literal("manager"),
          v.literal("administrator"),
          v.literal("owner"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireVerifiedActiveBrowserSession(ctx);
    const now = Date.now();

    const discordProofs = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_userId_assetType_assetExternalId", (q) =>
        q.eq("userId", user._id).eq("assetType", "discord_guild"),
      )
      .collect();

    // Two callbacks for the same identity can overlap, and Discord's answer can
    // change between their reads. Without an ordering check the last one to
    // arrive wins, so an older response listing a guild could land after a
    // newer one revoked it and reactivate the proof with a fresh 30-day window
    // — access Discord no longer reports, still good for claims and
    // delegations.
    //
    // The watermark is its own row rather than being inferred from the proofs,
    // because the case that matters most leaves no proof behind: a result with
    // no manageable guilds writes nothing and, on a first verification, revokes
    // nothing either. An older result arriving after it would find no trace to
    // lose against and would create the very access the newer read said was
    // gone. Per identity, since a second Discord account's round-trip says
    // nothing about this one's ordering.
    //
    // Ordered by the reserved generation, not by a timestamp: two workers'
    // clocks can tie or run backwards, and this decides whether revoked access
    // comes back.
    const watermark = await ctx.db
      .query("discordVerificationWatermarks")
      .withIndex("by_userId_discordUserId", (q) =>
        q.eq("userId", user._id).eq("discordUserId", args.discordUserId),
      )
      .unique();

    // No row means the reservation never happened — a caller that skipped it,
    // or a row removed since. Refuse rather than apply an unordered result.
    if (watermark === null) {
      return { recorded: 0, revoked: 0, superseded: true };
    }

    // Against the newest *reservation*, not only the newest applied result. A
    // callback that reserved after Discord removed access may still be reading
    // when an older one arrives; letting the older one land would reactivate
    // the proof and leave a window in which a concurrent claim takes ownership
    // on access that is already gone. Only the newest reader may write.
    //
    // Unless that newer reader never came back. A reservation whose callback
    // died would otherwise suppress every earlier result forever, so a
    // revocation that one of them observed would never be applied and the proof
    // would stay usable until its own revalidation deadline. Past the window a
    // round-trip could plausibly take, an outstanding reservation stops
    // counting.
    const reservationOutstanding =
      watermark.issuedGeneration > watermark.appliedGeneration &&
      watermark.issuedAt > now - RESERVATION_ABANDONED_MS;

    // Superseded results still revoke; they just do not grant.
    //
    // Discarding them outright lost real information: if the newer callback
    // then died, nothing retried this one and a revocation it had observed
    // stayed unapplied until the proof's own revalidation deadline. Revoking on
    // an older read is safe in a way that granting is not — it can only remove
    // access that read saw as gone, and the newer result restores anything it
    // finds still held. So the direction that can only take access away is
    // allowed through, and the direction that hands it out is not.
    const superseded =
      (reservationOutstanding && args.generation < watermark.issuedGeneration) ||
      args.generation <= watermark.appliedGeneration;

    if (!superseded) {
      // `issuedGeneration` is already at least this value — the guard above
      // refuses anything below it — so only the applied cursor moves.
      await ctx.db.patch(watermark._id, {
        appliedGeneration: args.generation,
        updatedAt: now,
      });
    }

    await Promise.all(
      (superseded ? [] : args.guilds).map((guild) =>
        recordExternalControlProof(ctx.db, {
          userId: user._id,
          assetType: "discord_guild",
          assetExternalId: guild.id,
          ...(guild.name !== undefined ? { assetDisplayName: guild.name } : {}),
          controlLevel: guild.controlLevel,
          evidenceSource: "discord_oauth",
          evidenceSummary: `Discord OAuth reported ${guild.controlLevel} access in guild ${guild.name ?? guild.id}.`,
          evidenceSubjectId: args.discordUserId,
          now,
        }),
      ),
    );

    // The OAuth response is the complete list of guilds this user can manage,
    // so a previously proved guild missing from it is positive evidence that
    // control was lost. Leaving those rows active would let someone who just
    // demonstrated they no longer manage a server keep claiming with it until
    // the 30-day window lapsed.
    //
    // "Complete" only holds for the Discord identity that authorized this
    // round-trip, though. One VRDex user may manage servers through more than
    // one Discord account; reconciling across all of them would let a second
    // account's consent silently revoke the first account's servers. Proofs
    // predating this field have no recorded subject, so they reconcile against
    // whoever verifies next — the same behaviour they had when written.
    const manageable = new Set(args.guilds.map((guild) => guild.id));
    const revoked = discordProofs.filter(
      (proof) =>
        proof.state === "active" &&
        (proof.evidenceSubjectId === undefined ||
          proof.evidenceSubjectId === args.discordUserId) &&
        !manageable.has(proof.assetExternalId),
    );

    await Promise.all(
      revoked.map((proof) =>
        revokeExternalControlProof(
          ctx.db,
          proof._id,
          "Discord no longer reports manageable access to this server.",
          now,
        ),
      ),
    );

    return {
      recorded: superseded ? 0 : args.guilds.length,
      revoked: revoked.length,
      superseded,
    };
  },
});

/**
 * Guilds the signed-in user has proved management access to, for the claim UI's
 * server picker. Replaces asking the user to paste a raw guild id. Returns an
 * empty list rather than throwing so the picker renders for any viewer.
 */
export const getManageableGuilds = query({
  args: {},
  handler: async (ctx) => {
    const user = await claimSessionUserOrNull(ctx);

    if (user === null) {
      return [];
    }

    const now = Date.now();
    const proofs = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "active"))
      .collect();

    const usable = proofs.filter(
      (proof) =>
        proof.assetType === "discord_guild" &&
        // Match the authorization check exactly. Between a proof lapsing and
        // the sweeper marking it stale it is still `active`, and offering it
        // here would show a server that `requireControlProof` then rejects,
        // while hiding the re-verify prompt that would fix it.
        (proof.revalidateAfter === undefined || proof.revalidateAfter > now),
    );
    // One guild manageable through two Discord logins has one proof per login.
    // The picker is about servers, not evidence, so collapse to the strongest.
    const byGuild = new Map<string, (typeof usable)[number]>();

    for (const proof of usable) {
      const incumbent = byGuild.get(proof.assetExternalId);

      if (
        incumbent === undefined ||
        externalControlLevelRank(proof.controlLevel) >
          externalControlLevelRank(incumbent.controlLevel) ||
        (proof.controlLevel === incumbent.controlLevel && proof.verifiedAt > incumbent.verifiedAt)
      ) {
        byGuild.set(proof.assetExternalId, proof);
      }
    }

    return [...byGuild.values()].map((proof) => ({
      guildId: proof.assetExternalId,
      guildName: proof.assetDisplayName,
      controlLevel: proof.controlLevel,
      verifiedAt: proof.verifiedAt,
    }));
  },
});

/**
 * Where a pending round-trip started, without consuming or authenticating it.
 *
 * The callback can arrive with no usable session at all — the refresh failed
 * while the user was on Discord's consent screen — and the state row is then
 * the only surviving record of the claim they were completing. Sending them
 * through sign-in to `/account` loses it.
 *
 * Deliberately unauthenticated, and deliberately narrow: `state` is a
 * single-use random token the caller already holds, and this returns only the
 * same-origin path it was issued for, which `validateSignInReturnTo` checks
 * again before any redirect. Nothing is consumed, so the real callback still
 * works.
 */
export const peekVerificationReturnTo = query({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();

    if (row === null || row.expiresAt <= Date.now()) {
      return { returnTo: null };
    }

    return { returnTo: row.returnTo };
  },
});

export const startGuildVerification = action({
  args: { returnTo: v.string() },
  handler: async (ctx, args): Promise<{ authorizeUrl: string }> => {
    const clientId = requiredEnv("AUTH_DISCORD_ID");
    const { state } = (await ctx.runMutation(internal.discordVerification.createVerificationState, {
      returnTo: args.returnTo,
    })) as { state: string };
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "identify guilds",
      state,
      redirect_uri: discordVerificationRedirectUri(),
      prompt: "consent",
    });

    return { authorizeUrl: `${discordAuthorizeBaseUrl()}?${params.toString()}` };
  },
});

/**
 * `fetch` with a deadline that stays armed until the body has been read.
 *
 * Every Discord call here is made after `completeGuildVerification` has already
 * consumed the single-use state, so a provider that sends headers and then
 * stalls the body blocks the callback until the action runtime gives up and
 * forces the user through the whole OAuth round-trip again. `fetch` resolves on
 * headers, so clearing the timer around the fetch alone bounds nothing.
 */

async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const response = await boundedFetch(`${discordApiBaseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("AUTH_DISCORD_ID"),
      client_secret: requiredEnv("AUTH_DISCORD_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: discordVerificationRedirectUri(),
    }).toString(),
  });

  if (!response.ok) {
    throw claimError("ADAPTER_UNAVAILABLE", `token_exchange_${response.status}`);
  }

  const payload = (response.body ?? {}) as DiscordTokenResponse;

  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw claimError("ADAPTER_UNAVAILABLE", "token_exchange_missing_token");
  }

  return payload.access_token;
}

/**
 * Read every guild the token can see.
 *
 * `/users/@me/guilds` caps a page at 200 and pages with `after`, so a single
 * request silently truncates for anyone in more guilds than that — their
 * manageable servers past the first page would never get a control proof and
 * could not be selected for claiming.
 */
async function fetchAllGuilds(accessToken: string): Promise<DiscordOAuthGuild[]> {
  const pageSize = 200;
  const collected: DiscordOAuthGuild[] = [];
  let after: string | undefined;

  // Bounded so a provider that ignores `after` cannot loop forever. Discord
  // caps user guild membership well below this.
  for (let page = 0; page < 15; page += 1) {
    const params = new URLSearchParams({ limit: String(pageSize) });

    if (after !== undefined) {
      params.set("after", after);
    }

    const response = await boundedFetch(
      `${discordApiBaseUrl()}/users/@me/guilds?${params.toString()}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw claimError("ADAPTER_UNAVAILABLE", `guilds_${response.status}`);
    }

    const batch = response.body as DiscordOAuthGuild[];

    // A non-array payload must not be read as "no more pages". The caller
    // treats the result as the complete manageable set and revokes every proof
    // absent from it, so a malformed first page would revoke all of them.
    if (!Array.isArray(batch)) {
      throw claimError("ADAPTER_UNAVAILABLE", "guilds_malformed_payload");
    }

    // A complete answer that happens to be empty: no guilds at all, or a
    // membership count that lands exactly on a page boundary. `return`, not
    // `break` — falling through to the cap error below would fail the callback
    // for a user with no guilds, and worse, refuse to reconcile the proofs of
    // one who has just left every guild they had.
    if (batch.length === 0) {
      return collected;
    }

    collected.push(...batch);

    if (batch.length < pageSize) {
      return collected;
    }

    const next = batch[batch.length - 1]?.id;

    // A cursor that does not move means the provider ignored `after` and served
    // the same page again. The caller reads this list as the complete
    // manageable set and revokes every proof missing from it, so returning a
    // truncated-but-plausible list would revoke real access. Same for running
    // out of pages below: an incomplete answer must not look like a complete
    // one.
    if (next === undefined || next === after) {
      throw claimError("ADAPTER_UNAVAILABLE", "guilds_pagination_stalled");
    }

    after = next;
  }

  throw claimError("ADAPTER_UNAVAILABLE", "guilds_pagination_unbounded");
}

/**
 * The Discord account that authorized this round-trip.
 *
 * Recorded on every proof so reconciliation can tell "this identity no longer
 * manages that server" from "a different identity of the same VRDex user was
 * never asked about it".
 */
async function fetchCurrentDiscordUserId(accessToken: string): Promise<string> {
  const response = await boundedFetch(`${discordApiBaseUrl()}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw claimError("ADAPTER_UNAVAILABLE", `identity_${response.status}`);
  }

  const payload = (response.body ?? {}) as { id?: unknown };

  // A snowflake, not merely a nonempty string. This becomes the
  // `evidenceSubjectId` every proof is recorded under, and reconciliation only
  // revokes proofs whose subject matches the identity verifying now — so proofs
  // filed under a bogus id would be unreachable by the very check meant to take
  // them away, and stay usable for claims and delegations until they expire.
  if (typeof payload.id !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(payload.id)) {
    throw claimError("ADAPTER_UNAVAILABLE", "identity_malformed_payload");
  }

  return payload.id;
}

async function revokeAccessToken(accessToken: string): Promise<void> {
  // Best effort: the proof is already recorded, and a lingering token is the
  // thing we are trying to avoid, so failures here must not fail the claim.
  try {
    // Bounded too: this runs after the proofs are recorded, so a hang here
    // would strand a completed verification behind a request whose only job is
    // best-effort cleanup.
    await boundedFetch(`${discordApiBaseUrl()}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("AUTH_DISCORD_ID"),
        client_secret: requiredEnv("AUTH_DISCORD_SECRET"),
        token: accessToken,
      }).toString(),
    });
  } catch {
    // Intentionally ignored.
  }
}

/**
 * Consume a state row for a callback that carries no `code`.
 *
 * Discord returns `error=access_denied` with the original `state` when a user
 * declines consent. Ignoring it would strand the row and lose the path the user
 * started from, so the decline is treated as a normal end to the round-trip.
 */
export const abandonGuildVerification = action({
  args: { state: v.string() },
  handler: async (ctx, args): Promise<{ returnTo: string }> => {
    return (await ctx.runMutation(internal.discordVerification.consumeVerificationState, {
      state: args.state,
    })) as { returnTo: string };
  },
});

export const completeGuildVerification = action({
  args: { code: v.string(), state: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "verified" | "failed"; returnTo: string; verifiedGuildCount: number }> => {
    // Consuming the state keeps it single-use, but it also destroys the only
    // record of where the user came from. Everything after this point reports
    // failure through the return value so the callback can still send them
    // back where they started.
    const { returnTo } = (await ctx.runMutation(
      internal.discordVerification.consumeVerificationState,
      { state: args.state },
    )) as { returnTo: string };
    let accessToken: string;

    try {
      accessToken = await exchangeCodeForAccessToken(args.code);
    } catch {
      return { status: "failed", returnTo, verifiedGuildCount: 0 };
    }

    try {
      const discordUserId = await fetchCurrentDiscordUserId(accessToken);
      // Reserved before the guild read, so two overlapping callbacks are
      // ordered by the counter they drew rather than by their workers' clocks.
      const { generation } = (await ctx.runMutation(
        internal.discordVerification.reserveGuildVerificationGeneration,
        { discordUserId },
      )) as { generation: number };
      const guilds = await fetchAllGuilds(accessToken);
      const manageable = guilds.flatMap((guild) => {
        // Before anything is recorded against it. The mutation's validator only
        // asks for a string, so a non-snowflake id would become an active
        // `discord_guild` control proof for something that is not a guild — and
        // `claimCommunityWithVerifiedGuild` grants ownership against exactly
        // such a proof.
        if (typeof guild.id !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(guild.id)) {
          throw claimError("ADAPTER_UNAVAILABLE", "discord_guild_id_malformed");
        }

        const controlLevel = discordControlLevel(guild);

        return controlLevel === null || controlLevel === "self"
          ? []
          : [
              {
                id: guild.id,
                ...(guild.name !== undefined ? { name: guild.name } : {}),
                controlLevel,
              },
            ];
      });

      const recorded = (await ctx.runMutation(
        internal.discordVerification.recordGuildControlProofs,
        { discordUserId, generation, guilds: manageable },
      )) as { superseded: boolean };

      // Nothing was written, so nothing was verified. Reporting success anyway
      // sent the user back with `discordVerify=verified` and a guild count in
      // front of an empty server picker — and if the newer round-trip that
      // superseded this one then failed, the state they were told about would
      // never arrive.
      if (recorded.superseded) {
        return { status: "failed" as const, returnTo, verifiedGuildCount: 0 };
      }

      return { status: "verified" as const, returnTo, verifiedGuildCount: manageable.length };
    } catch (error) {
      // A session revoked while the Discord round-trip was in flight is not a
      // provider failure. Translating it to `failed` sends the user back with
      // their stale auth cookies intact instead of reaching
      // `invalidAuthSessionResponse` in the callback route.
      if (isAuthSessionInvalidError(error)) {
        // Carrying `returnTo` with it. The single-use state row is already
        // consumed by this point, so it is the only surviving record of where
        // the user started; without it they sign in again and land on
        // `/account` instead of the claim they were part-way through.
        throw new ConvexError({ ...(error.data as Record<string, unknown>), returnTo });
      }

      return { status: "failed", returnTo, verifiedGuildCount: 0 };
    } finally {
      await revokeAccessToken(accessToken);
    }
  },
});

