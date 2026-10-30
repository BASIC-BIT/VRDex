import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { discordRequest } from "../_discordRest";
import { createDiscordTimestampSet } from "../_discordTimestamps";
import { DISCORD_ID } from "../_eventConnectors";
import { cleanPublicText, formatDiscordLineupLines } from "../_eventDiscordExport";
import { eventPathForSlugs } from "../_eventPaths";
import { getPublicEventBySlug, type PublicEvent } from "../_eventPublic";
import { eventSortAt, eventSortEndAt } from "../_eventSchedule";
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

export function boardEnabled(): boolean {
  return process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED === "true";
}

/** The board message a link points at; `none:` ids and non-linked rows mean there is none. */
export function liveMessageId(link: Doc<"eventSyncLinks"> | null): string | null {
  return link?.state === "linked" && DISCORD_ID.test(link.externalId) ? link.externalId : null;
}

export const getBoardEvent = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<BoardEvent | null> => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;
    const board = { status: event.eventStatus, sortAt: eventSortAt(event), sortEndAt: eventSortEndAt(event) };
    const publicEvent = await getPublicEventBySlug(ctx.db, event);
    if (!publicEvent?.communitySlug) return { projection: null, ...board };
    const siteUrl = process.env.SITE_URL?.replace(/\/+$/, "");
    if (!siteUrl) throw new Error("SITE_URL_MISSING");
    // Intake artwork can be a same-origin path; Discord needs an absolute URL.
    const artwork = firstSafePublicImageUrl(publicEvent.posterImageUrl, publicEvent.bannerImageUrl, publicEvent.thumbnailImageUrl);
    const projection: PublicEventProjection = {
      ...publicEvent,
      url: siteUrl + eventPathForSlugs(publicEvent.communitySlug, publicEvent.slug),
      ...(artwork !== undefined ? { artworkImageUrl: new URL(artwork, siteUrl).href } : {}),
    };
    return { projection, ...board };
  },
});

export const pauseBoardConnector = internalMutation({
  args: { connectorId: v.id("eventConnectors"), lastError: v.string() },
  handler: async (ctx, { connectorId, lastError }): Promise<void> => {
    await ctx.db.patch(connectorId, { state: "paused", lastError, updatedAt: Date.now() });
  },
});

// Every request checks the flag and the channel first, so no Discord path is built from a bad target.
function boardMessagesPath(connector: Connector): string {
  if (!boardEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
  const channelId = connector.target.channelId;
  if (!channelId || !DISCORD_ID.test(channelId)) throw new Error("BOARD_TARGET_INVALID");
  return `/channels/${channelId}/messages`;
}

// Returns null for a 404 on PATCH or DELETE (the message is gone); a 403, or a 404 on POST (the channel is gone), pauses the connector.
async function send(ctx: ActionCtx, connector: Connector, method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Response | null> {
  const response = await discordRequest({ method, path, body });
  if (response.ok) return response;
  if (response.status === 404 && method !== "POST") return null;
  if (response.status === 403 || response.status === 404) {
    const code = response.status === 403 ? "discord_forbidden" : "discord_channel_missing";
    await ctx.runMutation(internal.eventSyncKinds.discordBoard.pauseBoardConnector, { connectorId: connector._id, lastError: code });
    throw new Error(code);
  }
  throw new Error(`discord_${response.status}`);
}

async function postMessage(ctx: ActionCtx, connector: Connector, path: string, body: unknown): Promise<string> {
  const { id } = (await (await send(ctx, connector, "POST", path, body))!.json()) as { id?: unknown };
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
    if (messageId) {
      if (await send(ctx, connector, "PATCH", `${path}/${messageId}`, body)) return { externalId: messageId };
    } else if (board.status !== "scheduled" || board.sortAt > now + BOARD_POST_AHEAD_MS) {
      return none;
    }
    return { externalId: await postMessage(ctx, connector, path, body) };
  },
  async exportDelete(ctx, connector, link): Promise<void> {
    const path = boardMessagesPath(connector);
    const messageId = liveMessageId(link);
    if (messageId) await send(ctx, connector, "DELETE", `${path}/${messageId}`);
  },
};
