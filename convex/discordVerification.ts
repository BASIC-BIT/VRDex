import { v } from "convex/values";

import { getCurrentUser, requireVerifiedEmailUser } from "./accounts";
import { claimError } from "./_claimErrors";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import {
  type ExternalControlLevel,
  getActiveControlProof,
  recordExternalControlProof,
} from "./_externalControl";

const STATE_TTL_MS = 10 * 60_000;
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

    // Reuse the auth guard so a crafted `returnTo` cannot turn the callback
    // into an open redirect.
    if (!args.returnTo.startsWith("/") || args.returnTo.startsWith("//")) {
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
          now,
        }),
      ),
    );

    return { recorded: args.guilds.length };
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

    const proofs = await ctx.db
      .query("externalControlProofs")
      .withIndex("by_userId_state", (q) => q.eq("userId", user._id).eq("state", "active"))
      .collect();

    return proofs
      .filter((proof) => proof.assetType === "discord_guild")
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

export const completeGuildVerification = action({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ returnTo: string; verifiedGuildCount: number }> => {
    const { returnTo } = (await ctx.runMutation(
      internal.discordVerification.consumeVerificationState,
      { state: args.state },
    )) as { returnTo: string };
    const accessToken = await exchangeCodeForAccessToken(args.code);

    try {
      const response = await fetch(`${discordApiBaseUrl()}/users/@me/guilds`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw claimError("ADAPTER_UNAVAILABLE", `guilds_${response.status}`);
      }

      const guilds = (await response.json()) as DiscordOAuthGuild[];
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
        guilds: manageable,
      });

      return { returnTo, verifiedGuildCount: manageable.length };
    } finally {
      await revokeAccessToken(accessToken);
    }
  },
});

/** Drop a recorded guild proof, e.g. after losing access to a server. */
export const forgetGuildControlProof = mutation({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const proof = await getActiveControlProof(ctx.db, user._id, "discord_guild", args.guildId);

    if (proof === null) {
      return { forgotten: false };
    }

    const now = Date.now();
    await ctx.db.patch(proof._id, {
      state: "revoked",
      revokedAt: now,
      revokedReason: "Removed by the account holder.",
      updatedAt: now,
    });

    return { forgotten: true };
  },
});
