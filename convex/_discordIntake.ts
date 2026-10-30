import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import { DISCORD_ID } from "./_eventConnectors";
import { getLinkedProviderAccount } from "./accounts";
import { EVENT_POSTER_MAX_BYTES, EventPosterDeclarationSchema } from "../packages/api-contracts/src/event-intake";

export { isDiscordCdnUrl } from "../packages/api-contracts/src/event-intake";

export const DISCORD_SNOWFLAKE = DISCORD_ID;

export const discordAttachmentValidator = v.object({ url: v.string(), contentType: v.string(), byteLength: v.number() });

/** The gateway relay's message payload. A delete carries only what the gateway still has, so every field but `messageId` is optional; `recordMessage` requires the rest for create and update. */
export const discordMessagePayloadValidator = v.object({
  messageId: v.string(),
  authorId: v.optional(v.string()),
  authorDisplayName: v.optional(v.string()),
  isBot: v.optional(v.boolean()),
  content: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  editedAt: v.optional(v.number()),
  attachments: v.optional(v.array(discordAttachmentValidator)),
});

/** Default 120 s, clamped to 30..600 s. */
export function quietWindowMs(connector: Doc<"eventConnectors">): number {
  return Math.min(600, Math.max(30, connector.quietWindowSeconds ?? 120)) * 1000;
}

/** The VRDex user behind a Discord ID, only when exactly one user completed verification of it and it is still their current Discord identity. */
export async function resolveDiscordUserId(ctx: QueryCtx | MutationCtx, discordUserId: string): Promise<Id<"users"> | null> {
  const watermarks = await ctx.db.query("discordVerificationWatermarks").withIndex("by_discordUserId", q => q.eq("discordUserId", discordUserId)).collect();
  const users = [...new Set(watermarks.filter(row => row.appliedAt !== undefined || row.appliedGeneration > 0).map(row => row.userId))];
  if (users.length !== 1) return null;
  return (await getLinkedProviderAccount(ctx, users[0], "discord"))?.providerAccountId === discordUserId ? users[0] : null;
}

const SOURCE_TEXT_MAX = 12_000;
const POSTER_TYPES: readonly string[] = EventPosterDeclarationSchema.shape.contentType.options;
const live = (messages: Doc<"discordIntakeMessages">[]) => messages.filter(message => message.deletedAt === undefined);

/** Live messages oldest first as `Author (ISO time): content`; over the limit the oldest messages drop first, then the rest truncates. */
export function buildSourceText(messages: Doc<"discordIntakeMessages">[]): string {
  const parts = live(messages).sort((a, b) => a.createdAt - b.createdAt)
    .map(message => `${message.authorDisplayName} (${new Date(message.createdAt).toISOString()}): ${message.content}`);
  while (parts.length > 1 && parts.join("\n\n").length > SOURCE_TEXT_MAX) parts.shift();
  return parts.join("\n\n").slice(0, SOURCE_TEXT_MAX);
}

/** At most three poster-eligible attachments of live messages, largest first. */
export function pickPosterAttachments(messages: Doc<"discordIntakeMessages">[]): Array<{ url: string; contentType: string; byteLength: number }> {
  return live(messages).flatMap(message => message.attachments)
    .filter(item => POSTER_TYPES.includes(item.contentType) && item.byteLength <= EVENT_POSTER_MAX_BYTES)
    .sort((a, b) => b.byteLength - a.byteLength).slice(0, 3);
}

/**
 * The sync link a run applies through. A Discord announcement's external ID is the first trigger message of the run that
 * created it; every source row stores the external ID it resolved to, so a run whose trigger messages already have source
 * rows reuses it however later runs regroup the posts.
 */
export async function findRunLink(db: DatabaseReader, connectorId: Id<"eventConnectors">, triggerMessageIds: string[]) {
  const sources = (await Promise.all(triggerMessageIds.map(messageId =>
    db.query("discordIntakeSources").withIndex("by_connectorId_messageId", q => q.eq("connectorId", connectorId).eq("messageId", messageId)).first())))
    .filter(row => row !== null);
  const externalId = sources[0]?.externalId ?? triggerMessageIds[0];
  const link = await db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).unique();
  const priorEvents: Array<{ sourceMessageId: string; eventSlug: string }> = [];
  for (const row of sources) {
    const slug = row.eventId ? (await db.get(row.eventId))?.slug : undefined;
    if (slug) priorEvents.push({ sourceMessageId: row.messageId, eventSlug: slug });
  }
  const priorEventIds = [...new Set(sources.flatMap(row => row.eventId ? [row.eventId] : []))];
  return { externalId, link, priorEvents, priorEventIds };
}
