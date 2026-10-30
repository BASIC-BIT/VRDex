import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import { connectorsEnabled, DISCORD_ID, requireConnectorAuthority } from "./_eventConnectors";
import { DISCORD_BOT_PERMISSIONS } from "./_discordRest";
import { getActiveProfileLinks, linkProfileToAsset } from "./_externalControl";
import { getLinkedProviderAccount } from "./accounts";
import { EVENT_POSTER_MAX_BYTES, EventPosterDeclarationSchema } from "../packages/api-contracts/src/event-intake";

export { isDiscordCdnUrl } from "../packages/api-contracts/src/event-intake";

export const DISCORD_SNOWFLAKE = DISCORD_ID;

const TARGET_NAME_MAX = 100;

/** Types a connector can read: text (0) and announcement (5). */
export const isConnectableChannelType = (type: number) => type === 0 || type === 5;

export const discordIntakeEnabled = () => process.env.VRDEX_DISCORD_INTAKE_ENABLED === "true";

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

export const clampQuietWindowSeconds = (seconds: number) => Math.min(600, Math.max(30, seconds));

/** Default 120 s, clamped to 30..600 s. */
export function quietWindowMs(connector: Doc<"eventConnectors">): number {
  return clampQuietWindowSeconds(connector.quietWindowSeconds ?? 120) * 1000;
}

/** The exact `/vrdex` command replies. */
export const discordCommandReplies = {
  connected: (channel: string, community: string, mode: "hold" | "autopublish") =>
    `Connected #${channel} to ${community}. ${mode === "hold" ? "Hold for review" : "Publish automatically"}.`,
  disconnected: (channel: string) => `Disconnected #${channel}.`,
  notLinked: (siteUrl: string) => `Link your Discord account on VRDex first: ${new URL("/account/connections", siteUrl)}`,
  noPermission: "You need to manage integrations for that community.",
  pausedSuffix: " Paused.",
  notConnected: "Not connected.",
} as const;

/** The VRDex user behind a Discord ID, only when exactly one user completed verification of it and it is still their current Discord identity. */
export async function resolveDiscordUserId(ctx: QueryCtx | MutationCtx, discordUserId: string): Promise<Id<"users"> | null> {
  const watermarks = await ctx.db.query("discordVerificationWatermarks").withIndex("by_discordUserId", q => q.eq("discordUserId", discordUserId)).collect();
  const users = [...new Set(watermarks.filter(row => row.appliedAt !== undefined || row.appliedGeneration > 0).map(row => row.userId))];
  if (users.length !== 1) return null;
  return (await getLinkedProviderAccount(ctx, users[0], "discord"))?.providerAccountId === discordUserId ? users[0] : null;
}

/** Every announcements connector on a channel that is not removed. */
export async function liveChannelConnectors(db: DatabaseReader, channelId: string) {
  const rows = await db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "discord_announcements").eq("target.channelId", channelId)).collect();
  return rows.filter(row => row.state !== "removed");
}

/** Connects a channel for the slash command and the site flow, which each prove guild control first. A channel belongs to one community. */
export async function connectDiscordAnnouncements(ctx: MutationCtx, args: {
  userId: Id<"users">; communityProfileId: Id<"profiles">; guildId: string; guildName: string; channelId: string; channelName: string;
  mode: "hold" | "autopublish"; quietWindowSeconds?: number;
}): Promise<Id<"eventConnectors">> {
  const { userId, communityProfileId, guildId, guildName, channelId, channelName, mode, quietWindowSeconds } = args;
  if (!connectorsEnabled()) throw new ConvexError({ code: "CONNECTORS_DISABLED" });
  if (!DISCORD_SNOWFLAKE.test(guildId) || !DISCORD_SNOWFLAKE.test(channelId) || guildName.length > TARGET_NAME_MAX || channelName.length > TARGET_NAME_MAX) throw new ConvexError({ code: "CONNECTOR_TARGET" });
  // An owner or super admin passes the authority check on any profile, so the type is checked separately.
  if ((await ctx.db.get(communityProfileId))?.profileType !== "community") throw new ConvexError({ code: "CONNECTOR_FORBIDDEN" });
  await requireConnectorAuthority(ctx, communityProfileId, userId);
  const existing = await liveChannelConnectors(ctx.db, channelId);
  if (existing.some(row => row.communityProfileId !== communityProfileId)) throw new ConvexError({ code: "CHANNEL_TAKEN" });
  const now = Date.now();
  const target = { guildId, guildName, channelId, channelName };
  const shared = { target, mode, direction: "import" as const, authorityUserId: userId, state: "active" as const, updatedAt: now };
  // Reconnecting resumes: the connector leaves any pause under the reconnecting user's authority.
  let connectorId = existing[0]?._id;
  if (connectorId) await ctx.db.patch(connectorId, { ...shared, lastError: undefined, ...(quietWindowSeconds === undefined ? {} : { quietWindowSeconds }) });
  else connectorId = await ctx.db.insert("eventConnectors", { ...shared, communityProfileId, kind: "discord_announcements", quietWindowSeconds: quietWindowSeconds ?? 120, createdAt: now });
  const links = await getActiveProfileLinks(ctx.db, communityProfileId, "discord_guild");
  if (!links.some(link => link.assetExternalId === guildId)) {
    await linkProfileToAsset(ctx, { profileId: communityProfileId, assetType: "discord_guild", assetExternalId: guildId, linkRole: "secondary", linkedByUserId: userId, now });
  }
  return connectorId;
}

export type DiscordChannel = {
  id: string; name: string; type: number; position?: number;
  permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
};

const ADMINISTRATOR = 8n;
const VIEW_AND_READ_HISTORY = 66_560n;

// Discord's documented order: base, then @everyone overwrite, then role overwrites together, then the member overwrite.
function botCanRead(channel: DiscordChannel, access: { guildId: string; botUserId: string; botRoleIds: string[]; roles: Array<{ id: string; permissions: string }> }) {
  const { guildId, botUserId, botRoleIds, roles } = access;
  let permissions = BigInt(roles.find(role => role.id === guildId)?.permissions ?? "0");
  for (const role of roles) if (botRoleIds.includes(role.id)) permissions |= BigInt(role.permissions);
  if (permissions & ADMINISTRATOR) return true;
  const overwrites = channel.permission_overwrites ?? [];
  const everyone = overwrites.find(row => row.id === guildId);
  if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n, deny = 0n;
  for (const row of overwrites) if (row.type === 0 && botRoleIds.includes(row.id)) { allow |= BigInt(row.allow); deny |= BigInt(row.deny); }
  permissions = (permissions & ~deny) | allow;
  const member = overwrites.find(row => row.type === 1 && row.id === botUserId);
  if (member) permissions = (permissions & ~BigInt(member.deny)) | BigInt(member.allow);
  return (permissions & VIEW_AND_READ_HISTORY) === VIEW_AND_READ_HISTORY;
}

/** The text and announcement channels the bot can view and read history in, in Discord's order. */
export function readableTextChannels(channels: DiscordChannel[], access: Parameters<typeof botCanRead>[1]): Array<{ channelId: string; name: string }> {
  return channels.filter(channel => isConnectableChannelType(channel.type) && botCanRead(channel, access))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(({ id, name }) => ({ channelId: id, name }));
}

export function discordBotInviteUrl(applicationId: string, guildId: string): string {
  const query = new URLSearchParams({ client_id: applicationId, scope: "bot applications.commands", permissions: String(DISCORD_BOT_PERMISSIONS), guild_id: guildId, disable_guild_select: "true" });
  return `https://discord.com/oauth2/authorize?${query}`;
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
