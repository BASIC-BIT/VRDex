import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx, type DatabaseReader } from "../_generated/server";
import { discordRequest } from "../_discordRest";
import { DISCORD_IMAGE_MAX_BYTES, parseScheduledEvent, toScheduledEventBody, type DiscordScheduledEvent, type DiscordScheduledEventBody, type ScheduledEventSource } from "../_discordScheduledEventMap";
import { DISCORD_ID, discordScheduledEventsEnabled } from "../_eventConnectors";
import { enqueueSyncJob } from "../_eventSync";
import { liveMessageId as liveExternalId, pause, publicEventProjection, readObject } from "./discordBoard";
import type { SyncKindHandler } from "./types";

type Connector = Doc<"eventConnectors">;
export type ScheduledEventJobPayload = { action: "create" | "update" | "delete"; event: DiscordScheduledEvent; receivedAt: number };

const ARTWORK_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const BASE64_CHUNK = 0x8000; // String.fromCharCode's spread overflows the stack on a whole image.

/** One `import_item` job per active importing connector on the guild; returns how many were enqueued. */
export const relayScheduledEvent = internalMutation({
  args: { action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")), guildId: v.string(), payload: v.any(), receivedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, { action, guildId, payload, receivedAt }) => {
    const event = parseScheduledEvent(payload);
    if (!discordScheduledEventsEnabled() || !DISCORD_ID.test(guildId) || event?.guild_id !== guildId) return 0;
    const connectors = await ctx.db.query("eventConnectors").withIndex("by_kind_target_guildId", q => q.eq("kind", "discord_scheduled_events").eq("target.guildId", guildId)).collect();
    const importing = connectors.filter(connector => connector.state === "active" && (connector.direction === "import" || connector.direction === "bidirectional"));
    const job: ScheduledEventJobPayload = { action, event, receivedAt };
    for (const connector of importing) await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "import_item", payload: job });
    return importing.length;
  },
});

/** The event as the export reads it, or null when it is not public. */
export async function loadScheduledEventSource(db: DatabaseReader, event: Doc<"events">): Promise<ScheduledEventSource | null> {
  const projection = await publicEventProjection(db, event);
  if (!projection) return null;
  const { title, summary, venueLabel, worlds, startAt, endAt, timezone, status, url, artworkImageUrl, scheduleKind } = projection;
  return { title, summary, venueLabel, worldNames: worlds.map(world => world.displayName), startAt: scheduleKind === "date_only" ? undefined : startAt, endAt, timezone, status, url, artworkImageUrl };
}

export const getExportState = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<ScheduledEventSource | null> => {
    const event = await ctx.db.get(eventId);
    return event && await loadScheduledEventSource(ctx.db, event);
  },
});

/** The artwork as a data URI; on any failure the export goes out without a cover. */
export async function artworkDataUri(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!response.ok || !type || !ARTWORK_TYPES.has(type) || Number(response.headers.get("content-length")) > DISCORD_IMAGE_MAX_BYTES) return undefined;
    // ponytail: a body with no content-length is read whole before the size check; stream it with a running cap if artwork hosts ever turn hostile.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > DISCORD_IMAGE_MAX_BYTES) return undefined;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

// Every method checks the flag and the guild first, so no Discord path is built from a bad target.
function scheduledEventsGuildId(connector: Connector): string {
  if (!discordScheduledEventsEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
  const { guildId } = connector.target;
  if (!guildId || !DISCORD_ID.test(guildId)) throw new Error("SCHEDULED_EVENTS_TARGET_INVALID");
  return guildId;
}

// With `missingOk` a 404 returns null: the event is gone, which the caller handles. Any other 404 is a failure.
async function send(ctx: ActionCtx, connector: Connector, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, missingOk = false): Promise<Response | null> {
  const response = await discordRequest({ method, path, body });
  if (response.ok) return response;
  if (response.status === 403) return pause(ctx, connector, "discord_forbidden");
  if (response.status === 404 && missingOk) return null;
  throw new Error(`discord_${response.status}`);
}

// The Discord event's status, or null when it is gone.
async function liveStatus(ctx: ActionCtx, connector: Connector, path: string): Promise<unknown> {
  const response = await send(ctx, connector, "GET", path, undefined, true);
  return response && (await readObject(response)).status;
}

const removeLive = (ctx: ActionCtx, connector: Connector, path: string) => send(ctx, connector, "DELETE", path, undefined, true);
const utcDate = (at: string) => new Date(at).toISOString().slice(0, 10);

// A copy made by hand on the same UTC date. Series and finished events are never adopted: a one-off must not rewrite them.
async function findUnlinkedCopy(ctx: ActionCtx, connector: Connector, path: string, body: DiscordScheduledEventBody): Promise<string | undefined> {
  const rows: unknown = await (await send(ctx, connector, "GET", path))!.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error("discord_bad_response");
  const date = utcDate(body.scheduled_start_time);
  const name = body.name.toLowerCase();
  const candidates = rows.flatMap(row => parseScheduledEvent(row) ?? [])
    .filter(item => !item.recurrence_rule && item.status <= 2 && utcDate(item.scheduled_start_time) === date && item.name.trim().toLowerCase() === name);
  if (candidates.length === 0) return undefined;
  const linked = await ctx.runQuery(internal.googleCalendarConnector.linkedExternalIds, { connectorId: connector._id, externalIds: candidates.map(item => item.id) });
  return candidates.find(item => !linked.includes(item.id))?.id;
}

export const discordScheduledEventsHandler: SyncKindHandler = {
  async exportUpsert(ctx, connector, event, link): Promise<{ externalId: string }> {
    const path = `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`;
    // An imported occurrence's ID is not a Discord event (until plan 11), and what Discord deleted is staff's call in My events.
    if (link && (link.externalSeriesId !== undefined || link.state === "external_deleted")) return { externalId: link.externalId };
    const source = await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getExportState, { eventId: event._id });
    const liveId = liveExternalId(link);
    const livePath = `${path}/${liveId}`;
    const none = { externalId: `none:${event._id}` };
    const kept = liveId ? { externalId: liveId } : none;
    if (!source) {
      if (liveId) await removeLive(ctx, connector, livePath);
      return none;
    }
    if (source.status === "cancelled") {
      // Discord cannot cancel a started event, and a missing one needs nothing, so only status 1 is patched.
      if (liveId && await liveStatus(ctx, connector, livePath) === 1) await send(ctx, connector, "PATCH", livePath, { status: 4 });
      return kept;
    }
    const { startAt } = source;
    // Discord refuses past starts.
    if (startAt === undefined || startAt <= Date.now()) return kept;
    // ponytail: the cover is re-fetched and re-sent on every PATCH; store the artwork URL on the link if Discord's rate limits ever bite.
    const body = toScheduledEventBody({ ...source, startAt }, source.artworkImageUrl && await artworkDataUri(source.artworkImageUrl));
    if (liveId) {
      const status = await liveStatus(ctx, connector, livePath);
      if (status !== null && status !== 3 && status !== 4) {
        await send(ctx, connector, "PATCH", livePath, body);
        return kept;
      }
    } else {
      const copy = await findUnlinkedCopy(ctx, connector, path, body);
      if (copy) {
        await send(ctx, connector, "PATCH", `${path}/${copy}`, body);
        return { externalId: copy };
      }
    }
    const { id } = await readObject((await send(ctx, connector, "POST", path, body))!);
    if (typeof id !== "string" || !DISCORD_ID.test(id)) throw new Error("discord_bad_response");
    return { externalId: id };
  },
  async exportDelete(ctx, connector, link): Promise<void> {
    const path = `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`;
    const liveId = liveExternalId(link);
    if (liveId) await removeLive(ctx, connector, `${path}/${liveId}`);
  },
};
