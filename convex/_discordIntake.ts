import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { DISCORD_ID } from "./_eventConnectors";
import { getLinkedProviderAccount } from "./accounts";

export const DISCORD_SNOWFLAKE = DISCORD_ID;
export const DISCORD_CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

/** The gateway relay's message payload. A delete carries only what the gateway still has, so every field but `messageId` is optional; `recordMessage` requires the rest for create and update. */
export const discordMessagePayloadValidator = v.object({
  messageId: v.string(),
  authorId: v.optional(v.string()),
  authorDisplayName: v.optional(v.string()),
  isBot: v.optional(v.boolean()),
  content: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  editedAt: v.optional(v.number()),
  attachments: v.optional(v.array(v.object({ url: v.string(), contentType: v.string(), byteLength: v.number() }))),
});

/** Default 120 s, clamped to 30..600 s. */
export function quietWindowMs(connector: Doc<"eventConnectors">): number {
  return Math.min(600, Math.max(30, connector.quietWindowSeconds ?? 120)) * 1000;
}

export function isDiscordCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && DISCORD_CDN_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** The VRDex user behind a Discord ID, only when exactly one user completed verification of it and it is still their current Discord identity. */
export async function resolveDiscordUserId(ctx: QueryCtx | MutationCtx, discordUserId: string): Promise<Id<"users"> | null> {
  const watermarks = await ctx.db.query("discordVerificationWatermarks").withIndex("by_discordUserId", q => q.eq("discordUserId", discordUserId)).collect();
  const users = [...new Set(watermarks.filter(row => row.appliedAt !== undefined || row.appliedGeneration > 0).map(row => row.userId))];
  if (users.length !== 1) return null;
  return (await getLinkedProviderAccount(ctx, users[0], "discord"))?.providerAccountId === discordUserId ? users[0] : null;
}
