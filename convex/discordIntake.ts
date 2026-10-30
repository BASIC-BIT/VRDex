import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type DatabaseReader, type MutationCtx } from "./_generated/server";
import {
  buildSourceText, discordAttachmentValidator, DISCORD_SNOWFLAKE, discordMessagePayloadValidator, findRunLink, isDiscordCdnUrl,
  pickPosterAttachments, quietWindowMs, resolveDiscordUserId,
} from "./_discordIntake";
import { applyEventCandidate } from "./_eventCandidateApply";
import { connectorDirection, connectorKind, connectorMode, connectorState, requireConnectorAuthority } from "./_eventConnectors";
import { saveIntakeDraft } from "./_eventIntake";
import { getEventBySlug } from "./_eventSlugs";
import { cancelPendingSchedule } from "./_eventSync";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { correctionFields } from "./eventCorrections";
import { EventIntakeCandidateSchema, type EventIntakeFields } from "../packages/api-contracts/src/event-intake";

const MAX_CONTENT = 12_000;
const DISCORD_KINDS = ["discord_announcements", "discord_board", "discord_scheduled_events"] as const;

/** Discord connectors for the gateway: a channel's or a guild's live ones, or with no filter every active one. */
export const listChannelConnectors = internalQuery({
  args: { guildId: v.optional(v.string()), channelId: v.optional(v.string()) },
  returns: v.array(v.object({
    connectorId: v.id("eventConnectors"), kind: connectorKind, direction: connectorDirection, mode: connectorMode, state: connectorState,
    guildId: v.string(), channelId: v.optional(v.string()), lastMessageId: v.optional(v.string()),
  })),
  handler: async (ctx, { guildId, channelId }) => {
    // ponytail: guild and unfiltered lookups scan each Discord kind's index prefix; add a guildId index if connector counts grow.
    const connectors = [];
    for (const kind of DISCORD_KINDS) {
      const rows = await ctx.db.query("eventConnectors")
        .withIndex("by_kind_target_channelId", q => channelId === undefined ? q.eq("kind", kind) : q.eq("kind", kind).eq("target.channelId", channelId)).collect();
      connectors.push(...rows.filter(row => guildId === undefined ? row.state === "active" : row.target.guildId === guildId && row.state !== "removed"));
    }
    return Promise.all(connectors.filter(row => row.target.guildId !== undefined).map(async row => {
      const last = await ctx.db.query("discordIntakeMessages").withIndex("by_connectorId_messageId", q => q.eq("connectorId", row._id)).order("desc").first();
      return {
        connectorId: row._id, kind: row.kind, direction: row.direction, mode: row.mode, state: row.state,
        guildId: row.target.guildId!, channelId: row.target.channelId, lastMessageId: last?.messageId,
      };
    }));
  },
});

/** One row per gateway instance, replaced on every beat. */
export const recordHeartbeat = internalMutation({
  args: { instanceId: v.string(), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { instanceId, at }) => {
    const existing = await ctx.db.query("discordGatewayHeartbeats").withIndex("by_instanceId", q => q.eq("instanceId", instanceId)).unique();
    if (existing) await ctx.db.patch(existing._id, { at, receivedAt: Date.now() });
    else await ctx.db.insert("discordGatewayHeartbeats", { instanceId, at, receivedAt: Date.now() });
    return null;
  },
});

/** Records one relayed channel message on every live connector for the channel, then restarts that author's quiet window. */
export const recordMessage = internalMutation({
  args: {
    guildId: v.string(), channelId: v.string(),
    action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    payload: discordMessagePayloadValidator,
  },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, { guildId, channelId, action, payload }) => {
    const ids = [guildId, channelId, payload.messageId, ...(action === "delete" ? [] : [payload.authorId])];
    if (!ids.every(id => id !== undefined && DISCORD_SNOWFLAKE.test(id))) throw new ConvexError({ code: "DISCORD_INTAKE_INVALID" });
    if (payload.isBot) return { recorded: 0 };
    const connectors = (await ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "discord_announcements").eq("target.channelId", channelId)).collect())
      .filter(connector => connector.target.guildId === guildId && connector.state !== "removed");
    let recorded = 0;
    for (const connector of connectors) {
      const existing = await ctx.db.query("discordIntakeMessages").withIndex("by_connectorId_messageId", q => q.eq("connectorId", connector._id).eq("messageId", payload.messageId)).unique();
      let authorId: string;
      if (action === "delete") {
        if (!existing) continue;
        await ctx.db.patch(existing._id, { deletedAt: existing.deletedAt ?? Date.now(), updatedAt: Date.now() });
        authorId = existing.authorId;
      } else {
        const { authorId: author, authorDisplayName, content, createdAt, attachments } = payload;
        if (author === undefined || authorDisplayName === undefined || content === undefined || createdAt === undefined || attachments === undefined) throw new ConvexError({ code: "DISCORD_INTAKE_INVALID" });
        if (!existing && createdAt < connector.createdAt) continue;
        const fields = {
          authorId: author, authorDisplayName, content: content.slice(0, MAX_CONTENT), editedAt: payload.editedAt,
          attachments: attachments.filter(item => isDiscordCdnUrl(item.url)),
          authorUserId: (await resolveDiscordUserId(ctx, author)) ?? undefined, updatedAt: Date.now(),
        };
        if (existing) await ctx.db.patch(existing._id, fields);
        else await ctx.db.insert("discordIntakeMessages", { connectorId: connector._id, messageId: payload.messageId, guildId, channelId, createdAt, ...fields });
        authorId = author;
      }
      recorded++;
      if (connector.state === "active" && connector.direction !== "off") await restartQuietWindow(ctx, connector, authorId, payload.messageId);
    }
    return { recorded };
  },
});

/** One pending run per connector and author; each new message joins it and pushes its start back by the quiet window. */
async function restartQuietWindow(ctx: MutationCtx, connector: Doc<"eventConnectors">, authorId: string, messageId: string) {
  const run = await ctx.db.query("discordIntakeRuns").withIndex("by_connectorId_authorId_state", q => q.eq("connectorId", connector._id).eq("authorId", authorId).eq("state", "pending")).first();
  const runId = run?._id ?? await ctx.db.insert("discordIntakeRuns", { connectorId: connector._id, authorId, triggerMessageIds: [], state: "pending", createdAt: Date.now() });
  const triggerMessageIds = run?.triggerMessageIds ?? [];
  await cancelPendingSchedule(ctx.db, ctx.scheduler, run?.scheduledFunctionId);
  const scheduledFunctionId = await ctx.scheduler.runAfter(quietWindowMs(connector), internal.discordIntakeRun.runPending, { runId });
  await ctx.db.patch(runId, { scheduledFunctionId, triggerMessageIds: triggerMessageIds.includes(messageId) ? triggerMessageIds : [...triggerMessageIds, messageId] });
}

const DAY_MS = 86_400_000;
const CONTEXT_MS = 6 * 3_600_000;
const DAILY_RUN_CAP = 20;
const AGENT_EVENT_LIMIT = 40;
type SkipReason = "connector_inactive" | "authority_lost" | "binding_cap" | "source_deleted";
const skipReason = v.union(v.literal("connector_inactive"), v.literal("authority_lost"), v.literal("binding_cap"), v.literal("source_deleted"));
const opsKey = (connectorId: Id<"eventConnectors">) => "discord-intake:" + connectorId;
const messageUrl = (message: Doc<"discordIntakeMessages">) => `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.messageId}`;
const messageRow = (db: DatabaseReader, connectorId: Id<"eventConnectors">, messageId: string) =>
  db.query("discordIntakeMessages").withIndex("by_connectorId_messageId", q => q.eq("connectorId", connectorId).eq("messageId", messageId)).unique();

/** Starts a debounced run, or closes it with a skip reason when the connector, its authority, its daily cap, or the posts no longer allow one. */
export const claimRun = internalMutation({
  args: { runId: v.id("discordIntakeRuns") },
  returns: v.union(
    v.object({ kind: v.literal("skip"), reason: skipReason }),
    v.object({
      kind: v.literal("run"), authorityUserId: v.id("users"), mode: connectorMode, sourceText: v.string(), sourceUrl: v.string(),
      posters: v.array(discordAttachmentValidator),
      context: v.object({
        trigger: v.literal("discord"), communitySlug: v.string(), connectorId: v.id("eventConnectors"), mode: connectorMode,
        priorEvents: v.array(v.object({ sourceMessageId: v.string(), eventSlug: v.string() })),
      }),
      draftId: v.optional(v.id("eventIntakeDrafts")),
    }),
  ),
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    const run = await ctx.db.get(runId);
    // A stale invocation must not overwrite a run another invocation started or finished.
    if (run?.state !== "pending") return { kind: "skip" as const, reason: "connector_inactive" as const };
    const skip = async (reason: SkipReason) => {
      await ctx.db.patch(runId, { state: "done", reason, finishedAt: now });
      return { kind: "skip" as const, reason };
    };
    const connector = await ctx.db.get(run.connectorId);
    const community = connector && await ctx.db.get(connector.communityProfileId);
    if (!connector || connector.state !== "active" || connector.direction === "off" || !community?.slug) return skip("connector_inactive");
    const pause = (lastError: "authority_lost" | "binding_cap") => ctx.db.patch(connector._id, { state: "paused", lastError, updatedAt: now });

    try {
      await requireConnectorAuthority(ctx, connector.communityProfileId, connector.authorityUserId);
    } catch (error) {
      if (!(error instanceof ConvexError) || (error.data as { code?: unknown } | null)?.code !== "CONNECTOR_FORBIDDEN") throw error;
      await pause("authority_lost");
      return skip("authority_lost");
    }

    const dayStart = new Date(now).setUTCHours(0, 0, 0, 0);
    const today = await ctx.db.query("discordIntakeRuns").withIndex("by_connectorId_startedAt", q => q.eq("connectorId", connector._id).gte("startedAt", dayStart)).take(DAILY_RUN_CAP);
    if (today.length >= DAILY_RUN_CAP) {
      await pause("binding_cap");
      await ctx.scheduler.runAt(dayStart + DAY_MS, internal.discordIntake.resumeConnector, { connectorId: connector._id });
      return skip("binding_cap");
    }

    const triggers = (await Promise.all(run.triggerMessageIds.map(messageId => messageRow(ctx.db, connector._id, messageId)))).filter(row => row !== null);
    const { priorEvents, priorEventIds } = await findRunLink(ctx.db, connector._id, run.triggerMessageIds);
    if (triggers.every(row => row.deletedAt !== undefined)) {
      // An event loses its Discord source only when every post that ever fed it is gone; the event itself is never touched.
      for (const eventId of priorEventIds) {
        const sources = await ctx.db.query("discordIntakeSources").withIndex("by_eventId", q => q.eq("eventId", eventId)).collect();
        const rows = await Promise.all(sources.map(row => messageRow(ctx.db, row.connectorId, row.messageId)));
        if (!rows.every(row => row === null || row.deletedAt !== undefined)) continue;
        const links = await ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).collect();
        for (const link of links) if (link.connectorId === connector._id && link.state === "linked") await ctx.db.patch(link._id, { state: "external_deleted", updatedAt: now });
      }
      return skip("source_deleted");
    }

    const recent = await ctx.db.query("discordIntakeMessages")
      .withIndex("by_connectorId_authorId_createdAt", q => q.eq("connectorId", connector._id).eq("authorId", run.authorId).gte("createdAt", now - CONTEXT_MS))
      // ponytail: newest 100 context posts; the source text keeps only 12,000 characters anyway.
      .order("desc").take(100);
    const messages = [...new Map([...recent, ...triggers].map(row => [row.messageId, row])).values()];
    const newest = messages.filter(row => row.deletedAt === undefined).sort((a, b) => b.createdAt - a.createdAt)[0];
    await ctx.db.patch(runId, { state: "running", startedAt: now });
    return {
      kind: "run" as const, authorityUserId: connector.authorityUserId, mode: connector.mode,
      sourceText: buildSourceText(messages), sourceUrl: messageUrl(newest), posters: pickPosterAttachments(messages),
      context: { trigger: "discord" as const, communitySlug: community.slug, connectorId: connector._id, mode: connector.mode, priorEvents },
      ...(run.draftId ? { draftId: run.draftId } : {}),
    };
  },
});

async function runningRun(db: DatabaseReader, runId: Id<"discordIntakeRuns">) {
  const run = await db.get(runId);
  const connector = run && await db.get(run.connectorId);
  if (run?.state !== "running" || !connector) throw new ConvexError({ code: "DISCORD_INTAKE_RUN_NOT_RUNNING" });
  return { run, connector };
}

/** The run's working draft, owned by the connector's authority, created once. */
export const saveRunDraft = internalMutation({
  args: { runId: v.id("discordIntakeRuns"), sourceText: v.string(), sourceUrl: v.string() },
  returns: v.id("eventIntakeDrafts"),
  handler: async (ctx, { runId, sourceText, sourceUrl }) => {
    const { run, connector } = await runningRun(ctx.db, runId);
    if (run.draftId) return run.draftId;
    const { draftId } = await saveIntakeDraft(ctx.db, connector.authorityUserId, { patch: { sourceText, sourceUrl } }, Date.now(), { connectorDriven: true, connectorId: connector._id });
    await ctx.db.patch(runId, { draftId });
    return draftId;
  },
});

/** Applies the agent's candidate through the connector foundation, records which posts fed the result, and closes the run. */
export const finishRun = internalMutation({
  args: { runId: v.id("discordIntakeRuns"), draftId: v.id("eventIntakeDrafts"), candidate: v.any(), expectedUpdatedAt: v.optional(v.number()) },
  returns: v.object({ outcome: v.string(), eventId: v.optional(v.id("events")), draftId: v.optional(v.id("eventIntakeDrafts")) }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { run, connector } = await runningRun(ctx.db, args.runId);
    const candidate = EventIntakeCandidateSchema.parse(args.candidate);
    const { externalId, link } = await findRunLink(ctx.db, connector._id, run.triggerMessageIds);
    const result = await applyEventCandidate(ctx, {
      connector, candidate, actorUserId: connector.authorityUserId, draftId: args.draftId, link: link ?? undefined, externalId,
      expectedUpdatedAt: args.expectedUpdatedAt, idempotencyKey: args.runId,
    });
    if (result.eventId || result.draftId) {
      const values = { runId: args.runId, ...(result.eventId ? { eventId: result.eventId } : {}), ...(result.draftId ? { draftId: result.draftId } : {}) };
      for (const messageId of run.triggerMessageIds) {
        const existing = await ctx.db.query("discordIntakeSources").withIndex("by_connectorId_messageId", q => q.eq("connectorId", connector._id).eq("messageId", messageId)).first();
        if (existing) await ctx.db.patch(existing._id, values);
        else await ctx.db.insert("discordIntakeSources", { connectorId: connector._id, messageId, ...values, createdAt: now });
      }
    }
    if (result.outcome === "not_event" && await ctx.db.get(args.draftId)) await ctx.db.patch(args.draftId, { expiresAt: now });
    const decision = candidate.decision;
    await ctx.db.patch(args.runId, {
      state: "done", decision, reason: decision.kind === "not_event" ? decision.reason || "not_event" : result.outcome,
      draftId: result.draftId ?? args.draftId, eventId: result.eventId, finishedAt: now,
    });
    await resolveOps(ctx, opsKey(connector._id));
    return result;
  },
});

/** Closes a run that could not finish and alerts ops when the connector's last three runs all failed. */
export const failRun = internalMutation({
  args: { runId: v.id("discordIntakeRuns"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId, reason }) => {
    const now = Date.now();
    const run = await ctx.db.get(runId);
    if (!run || run.state === "done" || run.state === "failed") return null;
    await ctx.db.patch(runId, { state: "failed", reason, finishedAt: now });
    if (run.draftId && await ctx.db.get(run.draftId)) await ctx.db.patch(run.draftId, { expiresAt: now });
    const latest = await ctx.db.query("discordIntakeRuns").withIndex("by_connectorId_startedAt", q => q.eq("connectorId", run.connectorId)).order("desc").take(3);
    if (latest.length === 3 && latest.every(row => row.state === "failed")) {
      const connector = await ctx.db.get(run.connectorId);
      await notifyOps(ctx, {
        key: opsKey(run.connectorId), subject: "Discord intake runs failing",
        body: `Discord intake connector ${run.connectorId} (community ${connector?.communityProfileId}) failed its last 3 runs: ${latest.map(row => row.reason).join(", ")}.`,
      });
    }
    return null;
  },
});

/** Reopens a connector the daily run cap paused; any other pause stays. */
export const resumeConnector = internalMutation({
  args: { connectorId: v.id("eventConnectors") },
  returns: v.null(),
  handler: async (ctx, { connectorId }) => {
    const connector = await ctx.db.get(connectorId);
    if (connector?.state === "paused" && connector.lastError === "binding_cap") await ctx.db.patch(connectorId, { state: "active", lastError: undefined, updatedAt: Date.now() });
    return null;
  },
});

const agentEvent = (event: Doc<"events"> | null, communityProfileId: Id<"profiles">): event is Doc<"events"> =>
  event !== null && event.communityProfileId === communityProfileId && event.publicationState === "published" && event.moderationRemovedAt === undefined && Boolean(event.slug);

/** The agent's `list_events`: events this run's posts already produced, then the community's events from a week ago to 90 days out. */
export const listEventsForAgent = internalQuery({
  args: { runId: v.id("discordIntakeRuns"), limit: v.number() },
  returns: v.array(v.object({ slug: v.string(), title: v.string(), eventDate: v.union(v.string(), v.null()), start: v.union(v.string(), v.null()), lineupSummary: v.string() })),
  handler: async (ctx, { runId, limit }) => {
    const run = await ctx.db.get(runId);
    const connector = run && await ctx.db.get(run.connectorId);
    if (!run || !connector) return [];
    const { communityProfileId } = connector;
    const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
    const { priorEventIds } = await findRunLink(ctx.db, connector._id, run.triggerMessageIds);
    const prior = await Promise.all(priorEventIds.map(id => ctx.db.get(id)));
    // ponytail: unpublished or removed rows in the first 40 of the window shorten the list; read further if communities stage many drafts.
    const window = await ctx.db.query("events")
      .withIndex("by_communityProfileId_eventDate", q => q.eq("communityProfileId", communityProfileId).gte("eventDate", day(-7)).lte("eventDate", day(90)))
      .take(AGENT_EVENT_LIMIT);
    const events = [...new Map([...prior, ...window].filter(event => agentEvent(event, communityProfileId)).map(event => [event._id, event])).values()]
      .slice(0, Math.max(0, Math.min(limit, AGENT_EVENT_LIMIT)));
    return Promise.all(events.map(async event => {
      const fields = await correctionFields(ctx.db, event);
      return {
        slug: event.slug!, title: event.title, eventDate: fields.eventDate ?? null, start: fields.timeTba ? null : fields.start?.time ?? null,
        lineupSummary: (fields.lineup ?? []).slice(0, 6).map(row => row.performerLabel).join(", "),
      };
    }));
  },
});

// Only the fields a public event page shows; private draft fields never reach the agent.
const PUBLIC_EVENT_FIELDS = ["communitySlug", "title", "eventDate", "timeTba", "timezone", "start", "end", "doors", "venueLabel", "worldSlug", "sourceUrl", "summary", "lineup"] as const;

/** The agent's `get_event`: a published event of the connector's community, with the `updatedAt` an update must still match. */
export const getEventForAgent = internalQuery({
  args: { runId: v.id("discordIntakeRuns"), slug: v.string() },
  returns: v.union(v.null(), v.object({ fields: v.any(), updatedAt: v.number() })),
  handler: async (ctx, { runId, slug }): Promise<{ fields: EventIntakeFields; updatedAt: number } | null> => {
    const run = await ctx.db.get(runId);
    const connector = run && await ctx.db.get(run.connectorId);
    const event = connector ? await getEventBySlug(ctx.db, slug) : null;
    if (!connector || !agentEvent(event, connector.communityProfileId)) return null;
    const all = await correctionFields(ctx.db, event);
    const fields = Object.fromEntries(PUBLIC_EVENT_FIELDS.flatMap(key => all[key] === undefined ? [] : [[key, all[key]]])) as EventIntakeFields;
    return { fields, updatedAt: event.updatedAt };
  },
});
