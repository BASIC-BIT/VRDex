import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalMutation, internalQuery, query, type ActionCtx, type DatabaseReader } from "../_generated/server";
import { requireActiveBrowserSessionSubject } from "../_browserSessionAuthority";
import { discordRequest } from "../_discordRest";
import { createDiscordTimestampSet } from "../_discordTimestamps";
import { boardEnabled, DISCORD_ID, requireConnectorAuthority } from "../_eventConnectors";
import { cleanPublicText, formatDiscordLineupLines } from "../_eventDiscordExport";
import { eventPathForSlugs } from "../_eventPaths";
import { getPublicEventBySlug, type PublicEvent } from "../_eventPublic";
import { dateOnlyEventsEnabled, eventSortAt, eventSortEndAt } from "../_eventSchedule";
import { enqueueSyncJob } from "../_eventSync";
import { MINIMUM_COMMUNITY_CONTROL_LEVEL, requireControlProof } from "../_externalControl";
import { firstSafePublicImageUrl } from "../_publicFields";
import type { SyncKindHandler } from "./types";

/** A public event plus its absolute https page URL and artwork. */
export type PublicEventProjection = PublicEvent & { url: string; artworkImageUrl?: string };

export type DiscordEmbed = {
  title: string;
  url: string;
  description?: string;
  fields: Array<{ name: string; value: string }>;
  image?: { url: string };
};

// Discord embed limits: https://discord.com/developers/docs/resources/message#embed-object-embed-limits
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_LIMIT = 6000;
const ELLIPSIS = "…";

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}${ELLIPSIS}` : value;
}

/** Joins rows by newline, dropping trailing rows for a final `…` row when the result would pass `limit`. */
function clipRows(rows: string[], limit: number): string {
  const joined = rows.join("\n");

  if (joined.length <= limit) {
    return joined;
  }

  const kept: string[] = [];
  let length = ELLIPSIS.length;

  for (const row of rows) {
    if (length + row.length + 1 > limit) {
      break;
    }

    kept.push(row);
    length += row.length + 1;
  }

  return [...kept, ELLIPSIS].join("\n");
}

export function renderEventEmbed(event: PublicEventProjection): DiscordEmbed {
  const title = clip(cleanPublicText(event.title), TITLE_LIMIT);
  const eventTime = event.scheduleKind === "date_only" || event.startAt === undefined ? undefined : createDiscordTimestampSet(event.startAt);
  const fields: DiscordEmbed["fields"] = [];
  const addField = (name: string, value: string) => {
    const cleaned = cleanPublicText(value);

    if (cleaned.length > 0) {
      fields.push({ name, value: clip(cleaned, FIELD_VALUE_LIMIT) });
    }
  };

  if (eventTime !== undefined) {
    addField("Time", `${eventTime.longDateTime} (${eventTime.relative})`);
  } else if (event.eventDate !== undefined) {
    addField("Date", `${event.eventDate} (Time TBA)`);
  }

  if (eventTime !== undefined && event.endAt !== undefined) {
    addField("End", createDiscordTimestampSet(event.endAt).shortDateTime);
  }

  addField("Host", event.communityName ?? "");

  const worlds = event.worlds.map((world) => cleanPublicText(world.displayName)).filter((world) => world.length > 0);

  if (worlds.length > 0) {
    addField(worlds.length === 1 ? "World" : "Worlds", worlds.join(", "));
  } else {
    addField("Venue", event.venueLabel ?? "");
  }

  const lineupLines = formatDiscordLineupLines(event);
  const rows = event.status === "cancelled"
    ? ["**Cancelled**", ...(lineupLines.length > 0 ? ["", ...lineupLines] : [])]
    : lineupLines;
  // Four short-named fields at most 1024 each plus a 256 title leave well over zero for the description.
  const fixedLength = title.length + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  const description = clipRows(rows, Math.min(DESCRIPTION_LIMIT, EMBED_TOTAL_LIMIT - fixedLength));

  return {
    title,
    url: event.url,
    ...(description.length > 0 ? { description } : {}),
    fields,
    ...(event.artworkImageUrl !== undefined ? { image: { url: event.artworkImageUrl } } : {}),
  };
}

export const BOARD_POST_AHEAD_MS = 14 * 24 * 3_600_000;
export const BOARD_RETIRE_AFTER_MS = 24 * 3_600_000;

type Connector = Doc<"eventConnectors">;
type BoardEvent = { projection: PublicEventProjection | null; status: "scheduled" | "cancelled"; sortAt: number; sortEndAt: number };

export const isEnabled = query({ args: {}, handler: async (): Promise<boolean> => boardEnabled() });

/** The signed-in staffer manages the community's integrations and has proved control of the guild. */
export const authorizeBoardTarget = internalQuery({
  args: { communityProfileId: v.id("profiles"), guildId: v.string() },
  handler: async (ctx, { communityProfileId, guildId }): Promise<void> => {
    if (!DISCORD_ID.test(guildId)) throw new ConvexError({ code: "BOARD_TARGET_INVALID" });
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    await requireConnectorAuthority(ctx, communityProfileId, userId);
    await requireControlProof(ctx.db, userId, "discord_guild", guildId, MINIMUM_COMMUNITY_CONTROL_LEVEL);
  },
});

const BOARD_CHANNEL_TYPES = new Set([0, 5]); // text, announcement

/** The guild's text and announcement channels, in Discord's order, for the board picker. */
export const listBoardChannels = action({
  args: { communityProfileId: v.id("profiles"), guildId: v.string() },
  handler: async (ctx, args): Promise<Array<{ id: string; name: string }>> => {
    if (!boardEnabled()) throw new ConvexError({ code: "CONNECTOR_KIND_DISABLED" });
    if (!DISCORD_ID.test(args.guildId)) throw new ConvexError({ code: "BOARD_TARGET_INVALID" });
    await ctx.runQuery(internal.eventSyncKinds.discordBoard.authorizeBoardTarget, args);
    const response = await discordRequest({ method: "GET", path: `/guilds/${args.guildId}/channels` });
    if (!response.ok) throw new ConvexError({ code: `discord_${response.status}` });
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new ConvexError({ code: "discord_bad_response" });
    return rows
      .filter((row): row is { id: string; name: string; type: number; position?: number } =>
        typeof row?.id === "string" && DISCORD_ID.test(row.id) && typeof row.name === "string" && BOARD_CHANNEL_TYPES.has(row.type))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(({ id, name }) => ({ id, name }));
  },
});

/** The board message a link points at; `none:` ids and non-linked rows mean there is none. */
export function liveMessageId(link: Doc<"eventSyncLinks"> | null): string | null {
  return link?.state === "linked" && DISCORD_ID.test(link.externalId) ? link.externalId : null;
}

/** The event's public projection for Discord, or null when it is not public. */
export async function publicEventProjection(db: DatabaseReader, event: Doc<"events">): Promise<PublicEventProjection | null> {
  const publicEvent = await getPublicEventBySlug(db, event);
  if (!publicEvent?.communitySlug) return null;
  const siteUrl = process.env.SITE_URL?.replace(/\/+$/, "");
  if (!siteUrl) throw new Error("SITE_URL_MISSING");
  // Intake artwork can be a same-origin path; Discord needs an absolute URL.
  const artwork = firstSafePublicImageUrl(publicEvent.posterImageUrl, publicEvent.bannerImageUrl, publicEvent.thumbnailImageUrl);
  return {
    ...publicEvent,
    url: siteUrl + eventPathForSlugs(publicEvent.communitySlug, publicEvent.slug),
    ...(artwork !== undefined ? { artworkImageUrl: new URL(artwork, siteUrl).href } : {}),
  };
}

export const getBoardEvent = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<BoardEvent | null> => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    return { projection: await publicEventProjection(ctx.db, event), status: event.eventStatus, sortAt: eventSortAt(event), sortEndAt: eventSortEndAt(event) };
  },
});

export const pauseBoardConnector = internalMutation({
  args: { connectorId: v.id("eventConnectors"), lastError: v.string() },
  handler: async (ctx, { connectorId, lastError }): Promise<void> => {
    await ctx.db.patch(connectorId, { state: "paused", lastError, updatedAt: Date.now() });
  },
});

const BOARD_LOOKBACK_MS = 7 * 24 * 3_600_000;
const REFRESH_STAGGER_MS = 2_000;

/** Queues the day's board changes: retire live messages, post events entering the window. Every change is an export_upsert, so the handler decides. */
export const planBoardRefresh = internalMutation({
  args: { connectorId: v.id("eventConnectors") },
  handler: async (ctx, { connectorId }): Promise<{ upserts: number; deletes: number }> => {
    const connector = await ctx.db.get(connectorId);
    const counts = { upserts: 0, deletes: 0 };
    if (!connector) return counts;
    const now = Date.now();
    const retired = (event: Doc<"events">) => eventSortEndAt(event) + BOARD_RETIRE_AFTER_MS < now;
    const hasPendingJob = async (eventId: Id<"events">) =>
      (await ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connectorId).eq("eventId", eventId).eq("state", "pending")).first()) !== null;
    const enqueue = async (eventId: Id<"events">, count: keyof typeof counts) => {
      if (await hasPendingJob(eventId)) return;
      await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert", dueAt: now + (counts.upserts + counts.deletes) * REFRESH_STAGGER_MS });
      counts[count]++;
    };
    // Message IDs are digits, which sort before `none:`; retracted rows keep theirs, so liveMessageId still filters.
    const links = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).lt("externalId", "none:")).take(1000);
    for (const link of links) {
      // A link keyed to a held draft has no event yet.
      const eventId = link.eventId;
      if (!eventId || !liveMessageId(link)) continue;
      const event = await ctx.db.get(eventId);
      // The same cases the handler deletes for: gone, no longer public, or past retirement.
      if (!event || retired(event) || !(await getPublicEventBySlug(ctx.db, event))?.communitySlug) await enqueue(eventId, "deletes");
    }
    // ponytail: the 7-day lookback misses an event that started more than 7 days ago and is still running; widen it if multi-week events appear.
    const sortField = dateOnlyEventsEnabled() ? "sortAt" : "startAt";
    const events = await ctx.db.query("events")
      .withIndex(dateOnlyEventsEnabled() ? "by_communityProfileId_publicationState_eventStatus_sortAt" : "by_communityProfileId_publicationState_eventStatus_startAt", q => q
        .eq("communityProfileId", connector.communityProfileId).eq("publicationState", "published").eq("eventStatus", "scheduled")
        .gte(sortField, now - BOARD_LOOKBACK_MS).lte(sortField, now + BOARD_POST_AHEAD_MS))
      .take(500);
    for (const event of events) {
      if (event.moderationRemovedAt !== undefined || retired(event)) continue;
      const link = (await ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", event._id)).take(100)).find(row => row.connectorId === connectorId) ?? null;
      if (!liveMessageId(link)) await enqueue(event._id, "upserts");
    }
    return counts;
  },
});

/** The daily cron: one board_refresh per active export board. */
export const enqueueBoardRefreshes = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (!boardEnabled()) return 0;
    let enqueued = 0;
    // ponytail: one mutation walks every board connector; paginate if boards reach the thousands.
    for await (const connector of ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "discord_board"))) {
      if (connector.state !== "active" || connector.direction !== "export") continue;
      const pending = await ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connector._id).eq("eventId", undefined).eq("state", "pending")).take(20);
      if (pending.some(job => job.kind === "board_refresh")) continue;
      await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "board_refresh" });
      enqueued++;
    }
    return enqueued;
  },
});

// Every request checks the flag and the channel first, so no Discord path is built from a bad target.
function boardMessagesPath(connector: Connector): string {
  if (!boardEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
  const channelId = connector.target.channelId;
  if (!channelId || !DISCORD_ID.test(channelId)) throw new Error("BOARD_TARGET_INVALID");
  return `/channels/${channelId}/messages`;
}

export async function pause(ctx: ActionCtx, connector: Connector, code: string): Promise<never> {
  await ctx.runMutation(internal.eventSyncKinds.discordBoard.pauseBoardConnector, { connectorId: connector._id, lastError: code });
  throw new Error(code);
}

// Returns null for a 404 on PATCH or DELETE (the message is gone); a 403, or a 404 on GET or POST (the channel is gone), pauses the connector.
async function send(ctx: ActionCtx, connector: Connector, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Response | null> {
  const response = await discordRequest({ method, path, body });
  if (response.ok) return response;
  if (response.status === 404 && (method === "PATCH" || method === "DELETE")) return null;
  if (response.status === 403) return pause(ctx, connector, "discord_forbidden");
  if (response.status === 404) return pause(ctx, connector, "discord_channel_missing");
  throw new Error(`discord_${response.status}`);
}

// A non-JSON body would throw a SyntaxError quoting it, and lastError must stay a short code.
export async function readObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  if (typeof value !== "object" || value === null) throw new Error("discord_bad_response");
  return value as Record<string, unknown>;
}

// Every new message first proves the channel is a text or announcement channel of the target guild, so a foreign channelId never gets a post.
async function postMessage(ctx: ActionCtx, connector: Connector, path: string, body: unknown): Promise<string> {
  const channel = await readObject((await send(ctx, connector, "GET", path.replace(/\/messages$/, "")))!);
  if (channel.guild_id !== connector.target.guildId || !BOARD_CHANNEL_TYPES.has(channel.type as number)) await pause(ctx, connector, "discord_channel_mismatch");
  const { id } = await readObject((await send(ctx, connector, "POST", path, body))!);
  if (typeof id !== "string" || !DISCORD_ID.test(id)) throw new Error("discord_bad_response");
  return id;
}

export const discordBoardHandler: SyncKindHandler = {
  async exportUpsert(ctx, connector, event, link): Promise<{ externalId: string }> {
    const path = boardMessagesPath(connector);
    const board = await ctx.runQuery(internal.eventSyncKinds.discordBoard.getBoardEvent, { eventId: event._id });
    const messageId = liveMessageId(link);
    const none = { externalId: `none:${event._id}` };
    const now = Date.now();
    if (!board?.projection || board.sortEndAt + BOARD_RETIRE_AFTER_MS < now) {
      if (messageId) await send(ctx, connector, "DELETE", `${path}/${messageId}`);
      return none;
    }
    const body = { embeds: [renderEventEmbed(board.projection)], allowed_mentions: { parse: [] } };
    // A live message is edited whatever its status; a new one (none yet, or the old one deleted) only for a postable event.
    if (messageId && await send(ctx, connector, "PATCH", `${path}/${messageId}`, body)) return { externalId: messageId };
    if (board.status !== "scheduled" || board.sortAt > now + BOARD_POST_AHEAD_MS) return none;
    return { externalId: await postMessage(ctx, connector, path, body) };
  },
  async exportDelete(ctx, connector, link): Promise<void> {
    const path = boardMessagesPath(connector);
    const messageId = liveMessageId(link);
    if (messageId) await send(ctx, connector, "DELETE", `${path}/${messageId}`);
  },
  async boardRefresh(ctx, connector): Promise<void> {
    boardMessagesPath(connector); // Throws on the flag or a bad target before any job is queued.
    await ctx.runMutation(internal.eventSyncKinds.discordBoard.planBoardRefresh, { connectorId: connector._id });
  },
};
