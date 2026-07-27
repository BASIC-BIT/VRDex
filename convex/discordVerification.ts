import { v } from "convex/values";

import { getCurrentUser, requireVerifiedEmailUser } from "./accounts";
import { claimError } from "./_claimErrors";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import {
  type ExternalControlLevel,
  recordExternalControlProof,
  revokeExternalControlProof,
} from "./_externalControl";

const STATE_TTL_MS = 10 * 60_000;

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
  return (optionalEnv("DISCORD_API_BASE_URL") ?? "https://discord.com/api/v10").replace(/\/$/, "");
}

function discordAuthorizeBaseUrl(): string {
  // Overridable so hosted E2E can point the consent step at a local stub.
  return (optionalEnv("DISCORD_OAUTH_AUTHORIZE_URL") ?? "https://discord.com/oauth2/authorize")
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

  let permissions: bigint;

  try {
    permissions = BigInt(guild.permissions ?? "0");
  } catch {
    return null;
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
    const user = await requireVerifiedEmailUser(ctx);

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

    // Opportunistically clear this user's expired rows so the table stays small
    // without needing a dedicated cron.
    const stale = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(50);
    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

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
    const user = await requireVerifiedEmailUser(ctx);
    const row = await ctx.db
      .query("discordVerificationStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();

    if (row === null || row.userId !== user._id || row.expiresAt <= Date.now()) {
      throw claimError("VERIFICATION_STATE_INVALID");
    }

    await ctx.db.delete(row._id);

    return { returnTo: row.returnTo };
  },
});

export const recordGuildControlProofs = internalMutation({
  args: {
    discordUserId: v.string(),
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
    const user = await requireVerifiedEmailUser(ctx);
    const now = Date.now();

    await Promise.all(
      args.guilds.map((guild) =>
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
    const existing = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "active"))
      .collect();
    const revoked = existing.filter(
      (proof) =>
        proof.assetType === "discord_guild" &&
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

    return { recorded: args.guilds.length, revoked: revoked.length };
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
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return [];
    }

    const now = Date.now();
    const proofs = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "active"))
      .collect();

    return proofs
      .filter(
        (proof) =>
          proof.assetType === "discord_guild" &&
          // Match the authorization check exactly. Between a proof lapsing and
          // the sweeper marking it stale it is still `active`, and offering it
          // here would show a server that `requireControlProof` then rejects,
          // while hiding the re-verify prompt that would fix it.
          (proof.revalidateAfter === undefined || proof.revalidateAfter > now),
      )
      .map((proof) => ({
        guildId: proof.assetExternalId,
        guildName: proof.assetDisplayName,
        controlLevel: proof.controlLevel,
        verifiedAt: proof.verifiedAt,
      }));
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

async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const response = await fetch(`${discordApiBaseUrl()}/oauth2/token`, {
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

  const payload = (await response.json()) as DiscordTokenResponse;

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

    const response = await fetch(
      `${discordApiBaseUrl()}/users/@me/guilds?${params.toString()}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw claimError("ADAPTER_UNAVAILABLE", `guilds_${response.status}`);
    }

    const batch = (await response.json()) as DiscordOAuthGuild[];

    // A non-array payload must not be read as "no more pages". The caller
    // treats the result as the complete manageable set and revokes every proof
    // absent from it, so a malformed first page would revoke all of them.
    if (!Array.isArray(batch)) {
      throw claimError("ADAPTER_UNAVAILABLE", "guilds_malformed_payload");
    }

    if (batch.length === 0) {
      break;
    }

    collected.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    after = batch[batch.length - 1]?.id;

    if (after === undefined) {
      break;
    }
  }

  return collected;
}

/**
 * The Discord account that authorized this round-trip.
 *
 * Recorded on every proof so reconciliation can tell "this identity no longer
 * manages that server" from "a different identity of the same VRDex user was
 * never asked about it".
 */
async function fetchCurrentDiscordUserId(accessToken: string): Promise<string> {
  const response = await fetch(`${discordApiBaseUrl()}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw claimError("ADAPTER_UNAVAILABLE", `identity_${response.status}`);
  }

  const payload = (await response.json()) as { id?: unknown };

  if (typeof payload.id !== "string" || payload.id.length === 0) {
    throw claimError("ADAPTER_UNAVAILABLE", "identity_malformed_payload");
  }

  return payload.id;
}

async function revokeAccessToken(accessToken: string): Promise<void> {
  // Best effort: the proof is already recorded, and a lingering token is the
  // thing we are trying to avoid, so failures here must not fail the claim.
  try {
    await fetch(`${discordApiBaseUrl()}/oauth2/token/revoke`, {
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
      const guilds = await fetchAllGuilds(accessToken);
      const manageable = guilds.flatMap((guild) => {
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

      await ctx.runMutation(internal.discordVerification.recordGuildControlProofs, {
        discordUserId,
        guilds: manageable,
      });

      return { status: "verified", returnTo, verifiedGuildCount: manageable.length };
    } catch {
      return { status: "failed", returnTo, verifiedGuildCount: 0 };
    } finally {
      await revokeAccessToken(accessToken);
    }
  },
});

