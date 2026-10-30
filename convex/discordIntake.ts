import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type DatabaseReader, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import {
  buildSourceText, clampQuietWindowSeconds, connectDiscordAnnouncements, discordAttachmentValidator, discordBotInviteUrl, discordCommandReplies, discordIntakeEnabled,
  DISCORD_SNOWFLAKE, discordMessagePayloadValidator, findRunLink, isConnectableChannelType, isDiscordCdnUrl, liveChannelConnectors, pickPosterAttachments, quietWindowMs,
  readableTextChannels, resolveDiscordUserId, type DiscordChannel,
} from "./_discordIntake";
import { discordRequest } from "./_discordRest";
import { applyEventCandidate } from "./_eventCandidateApply";
import {
  connectorDirection, connectorKind, connectorMode, connectorState, connectorsEnabled, requireConnectorAuthority, userAuthSubject, userHasCommunityPermission,
} from "./_eventConnectors";
import { saveIntakeDraft } from "./_eventIntake";
import { getActiveProfileLinks, requireControlProof } from "./_externalControl";
import { getEventBySlug } from "./_eventSlugs";
import { getProfileBySlug } from "./_globalSlugs";
import { cancelPendingSchedule, discordIntakeAlertKey, removeConnector } from "./_eventSync";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { manageableDiscordGuilds } from "./discordVerification";
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
    const connectors = (await liveChannelConnectors(ctx.db, channelId)).filter(connector => connector.target.guildId === guildId);
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
// Longer than an action can run, so a run whose action died without failRun stops blocking its author.
const RUNNING_LEASE_MS = 15 * 60_000;
type SkipReason = "connector_inactive" | "authority_lost" | "binding_cap" | "source_deleted";
const skipReason = v.union(v.literal("connector_inactive"), v.literal("authority_lost"), v.literal("binding_cap"), v.literal("source_deleted"), v.literal("deferred"));
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
    if (!connectorsEnabled() || !connector || connector.state !== "active" || connector.direction === "off" || !community?.slug) return skip("connector_inactive");

    // One run per author at a time: two concurrent runs over the same post would each insert its link.
    // A running row past its lease belongs to an action that died without failRun; close it so it reaches the alarm.
    const running = await ctx.db.query("discordIntakeRuns").withIndex("by_connectorId_authorId_state", q => q.eq("connectorId", connector._id).eq("authorId", run.authorId).eq("state", "running")).collect();
    let live = false;
    for (const row of running) {
      if ((row.startedAt ?? 0) > now - RUNNING_LEASE_MS) live = true;
      else await closeFailedRun(ctx, row, "stalled", now);
    }
    if (live) {
      await cancelPendingSchedule(ctx.db, ctx.scheduler, run.scheduledFunctionId);
      const scheduledFunctionId = await ctx.scheduler.runAfter(quietWindowMs(connector), internal.discordIntakeRun.runPending, { runId });
      await ctx.db.patch(runId, { scheduledFunctionId });
      return { kind: "skip" as const, reason: "deferred" as const };
    }

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
        else await ctx.db.insert("discordIntakeSources", { connectorId: connector._id, messageId, externalId, ...values, createdAt: now });
      }
    }
    if (result.outcome === "not_event" && await ctx.db.get(args.draftId)) await ctx.db.patch(args.draftId, { expiresAt: now });
    const decision = candidate.decision;
    await ctx.db.patch(args.runId, {
      state: "done", decision, reason: decision.kind === "not_event" ? decision.reason || "not_event" : result.outcome,
      draftId: result.draftId ?? args.draftId, eventId: result.eventId, finishedAt: now,
    });
    await resolveOps(ctx, discordIntakeAlertKey(connector._id));
    return result;
  },
});

/** Closes a run that could not finish and alerts ops when the connector's last three runs all failed. */
export const failRun = internalMutation({
  args: { runId: v.id("discordIntakeRuns"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId, reason }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.state === "done" || run.state === "failed") return null;
    await closeFailedRun(ctx, run, reason, Date.now());
    return null;
  },
});

async function closeFailedRun(ctx: MutationCtx, run: Doc<"discordIntakeRuns">, reason: string, now: number) {
  // A run that failed before its claim still ranks in the alarm's window of recently started runs.
  await ctx.db.patch(run._id, { state: "failed", reason, startedAt: run.startedAt ?? now, finishedAt: now });
  if (run.draftId && await ctx.db.get(run.draftId)) await ctx.db.patch(run.draftId, { expiresAt: now });
  const latest = await ctx.db.query("discordIntakeRuns").withIndex("by_connectorId_startedAt", q => q.eq("connectorId", run.connectorId)).order("desc").take(3);
  if (latest.length === 3 && latest.every(row => row.state === "failed")) {
    const connector = await ctx.db.get(run.connectorId);
    await notifyOps(ctx, {
      key: discordIntakeAlertKey(run.connectorId), subject: "Discord intake runs failing",
      body: `Discord intake connector ${run.connectorId} (community ${connector?.communityProfileId}) failed its last 3 runs: ${latest.map(row => row.reason).join(", ")}.`,
    });
  }
}

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

const COMMAND_CHOICE_LIMIT = 25;
const commandOptions = v.object({
  community: v.optional(v.string()), mode: v.optional(connectorMode), quiet_window: v.optional(v.number()),
  channelName: v.optional(v.string()), guildName: v.optional(v.string()), query: v.optional(v.string()),
});
const channelCommand = v.union(v.literal("connect"), v.literal("disconnect"), v.literal("status"));

export const resolveDiscordInvoker = internalQuery({
  args: { discordUserId: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users") })),
  handler: async (ctx, { discordUserId }) => {
    const userId = await resolveDiscordUserId(ctx, discordUserId);
    return userId ? { userId } : null;
  },
});

export const invokerIsSuperAdmin = internalQuery({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => (await getAccountFeatureAccess(ctx.db, userId)).superAdmin,
});

/** Communities the user owns or staffs and may manage integrations for, matched on name or slug. */
export const manageableCommunities = internalQuery({
  args: { userId: v.id("users"), query: v.string() },
  returns: v.array(v.object({ slug: v.string(), displayName: v.string() })),
  handler: async (ctx, { userId, query }) => {
    const owned = await ctx.db.query("profileOwners").withIndex("by_userId_state", q => q.eq("userId", userId).eq("state", "active")).collect();
    const subject = await userAuthSubject(ctx.db, userId);
    const staffed = subject
      ? await ctx.db.query("communityAuthorities").withIndex("by_subjectTokenIdentifier_state", q => q.eq("subjectTokenIdentifier", subject.tokenIdentifier).eq("state", "active")).collect()
      : [];
    const needle = query.trim().toLowerCase();
    const communities = [];
    for (const profileId of new Set([...owned.map(row => row.profileId), ...staffed.map(row => row.communityProfileId)])) {
      if (communities.length === COMMAND_CHOICE_LIMIT) break;
      const profile = await ctx.db.get(profileId);
      if (profile?.profileType !== "community" || !`${profile.displayName} ${profile.slug}`.toLowerCase().includes(needle)) continue;
      if (await userHasCommunityPermission(ctx.db, profileId, userId, ["manage_integrations"])) communities.push({ slug: profile.slug, displayName: profile.displayName });
    }
    return communities;
  },
});

/** Runs a channel command for a resolved invoker. Every refusal, including a channel another community holds, reads the same. */
export const applyCommand = internalMutation({
  args: { userId: v.id("users"), command: channelCommand, guildId: v.string(), channelId: v.string(), invokerHasManageGuild: v.boolean(), options: commandOptions },
  returns: v.object({ reply: v.string() }),
  handler: async (ctx, { userId, command, guildId, channelId, invokerHasManageGuild, options }) => {
    const { connected, disconnected, noPermission, notConnected, pausedSuffix } = discordCommandReplies;
    if (!invokerHasManageGuild) return { reply: noPermission };
    const connector = (await liveChannelConnectors(ctx.db, channelId)).find(row => row.target.guildId === guildId);
    const channel = options.channelName ?? connector?.target.channelName ?? channelId;
    try {
      if (command === "connect") {
        const community = options.community === undefined ? null : await getProfileBySlug(ctx.db, options.community);
        if (!community) return { reply: noPermission };
        const mode = options.mode ?? "hold";
        await connectDiscordAnnouncements(ctx, {
          userId, communityProfileId: community._id, guildId, guildName: options.guildName ?? guildId, channelId, channelName: channel, mode,
          quietWindowSeconds: options.quiet_window === undefined ? undefined : clampQuietWindowSeconds(options.quiet_window),
        });
        return { reply: connected(channel, community.displayName, mode) };
      }
      if (!connector) return { reply: notConnected };
      if (command === "status") {
        const community = await ctx.db.get(connector.communityProfileId);
        if (!community) return { reply: notConnected };
        return { reply: connected(channel, community.displayName, connector.mode) + (connector.state === "paused" ? pausedSuffix : "") };
      }
      await requireConnectorAuthority(ctx, connector.communityProfileId, userId);
      await removeConnector(ctx, connector);
      return { reply: disconnected(channel) };
    } catch (error) {
      const code = error instanceof ConvexError ? (error.data as { code?: unknown } | null)?.code : undefined;
      if (code === "CONNECTOR_FORBIDDEN" || code === "CHANNEL_TAKEN") return { reply: noPermission };
      throw error;
    }
  },
});

/** The gateway's `/vrdex` entry point: resolves the invoker, then answers autocomplete or runs the channel command. */
export const handleCommand = internalAction({
  args: {
    command: v.union(channelCommand, v.literal("autocomplete")), guildId: v.string(), channelId: v.string(),
    invokerDiscordUserId: v.string(), invokerHasManageGuild: v.boolean(), options: commandOptions,
  },
  returns: v.union(v.object({ reply: v.string() }), v.object({ choices: v.array(v.object({ name: v.string(), value: v.string() })) })),
  handler: async (ctx, { command, invokerDiscordUserId, ...rest }): Promise<{ reply: string } | { choices: Array<{ name: string; value: string }> }> => {
    const invoker: { userId: Id<"users"> } | null = await ctx.runQuery(internal.discordIntake.resolveDiscordInvoker, { discordUserId: invokerDiscordUserId });
    if (command !== "autocomplete") {
      if (!invoker) return { reply: discordCommandReplies.notLinked(process.env.SITE_URL!) };
      return ctx.runMutation(internal.discordIntake.applyCommand, { ...invoker, command, ...rest });
    }
    if (!invoker) return { choices: [] };
    const query = rest.options.query ?? "";
    const communities: Array<{ slug: string; displayName: string }> = await ctx.runQuery(internal.discordIntake.invokerIsSuperAdmin, invoker)
      ? (await ctx.runQuery(api.search.searchUniversal, { query, entityType: "profile", profileType: "community", limit: COMMAND_CHOICE_LIMIT })).map(row => ({ slug: row.slug, displayName: row.title }))
      : await ctx.runQuery(internal.discordIntake.manageableCommunities, { ...invoker, query });
    return { choices: communities.map(row => ({ name: row.displayName.slice(0, 100), value: row.slug })) };
  },
});

/** The site flow's gate: the flag, the signed-in staffer's `manage_integrations`, and their proved manager-level control of the guild. */
async function requireSiteConnect(ctx: QueryCtx | MutationCtx, communityProfileId: Id<"profiles">, guildId: string) {
  if (!discordIntakeEnabled()) throw new ConvexError({ code: "DISCORD_INTAKE_DISABLED" });
  if (!DISCORD_SNOWFLAKE.test(guildId)) throw new ConvexError({ code: "CONNECTOR_TARGET" });
  const { userId } = await requireActiveBrowserSessionSubject(ctx);
  await requireConnectorAuthority(ctx, communityProfileId, userId);
  await requireControlProof(ctx.db, userId, "discord_guild", guildId, "manager");
  return userId;
}

export const authorizeSiteConnect = internalQuery({
  args: { communityProfileId: v.id("profiles"), guildId: v.string() },
  returns: v.null(),
  handler: async (ctx, { communityProfileId, guildId }) => {
    await requireSiteConnect(ctx, communityProfileId, guildId);
    return null;
  },
});

async function discordJson<T>(path: string): Promise<T> {
  const response = await discordRequest({ method: "GET", path });
  if (!response.ok) throw new ConvexError({ code: `discord_${response.status}` });
  return await response.json() as T;
}

const botLacksAccess = (status: number) => status === 403 || status === 404;

/** What the Integrations page needs before it can list channels. Everything is empty while the flag is off. */
export const connectContext = query({
  args: { communityProfileId: v.id("profiles") },
  returns: v.object({
    enabled: v.boolean(),
    guilds: v.array(v.object({ guildId: v.string(), guildName: v.optional(v.string()) })),
    preselectedGuildId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { communityProfileId }) => {
    if (!discordIntakeEnabled()) return { enabled: false, guilds: [], preselectedGuildId: null };
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    await requireConnectorAuthority(ctx, communityProfileId, userId);
    const guilds = (await manageableDiscordGuilds(ctx.db, userId, Date.now())).map(({ guildId, guildName }) => ({ guildId, guildName }));
    const links = (await getActiveProfileLinks(ctx.db, communityProfileId, "discord_guild"))
      .filter(link => guilds.some(guild => guild.guildId === link.assetExternalId))
      .sort((a, b) => Number(b.linkRole === "primary") - Number(a.linkRole === "primary"));
    return { enabled: true, guilds, preselectedGuildId: links[0]?.assetExternalId ?? (guilds.length === 1 ? guilds[0].guildId : null) };
  },
});

type ConnectableChannels = { state: "bot_missing"; inviteUrl: string } | { state: "ready"; channels: Array<{ channelId: string; name: string }> };

export const listConnectableChannels = action({
  args: { communityProfileId: v.id("profiles"), guildId: v.string() },
  handler: async (ctx, { communityProfileId, guildId }): Promise<ConnectableChannels> => {
    await ctx.runQuery(internal.discordIntake.authorizeSiteConnect, { communityProfileId, guildId });
    const { id: botUserId } = await discordJson<{ id: string }>("/users/@me");
    const member = await discordRequest({ method: "GET", path: `/guilds/${guildId}/members/${botUserId}` });
    if (botLacksAccess(member.status)) {
      const applicationId = process.env.DISCORD_APPLICATION_ID;
      if (!applicationId) throw new Error("DISCORD_APPLICATION_ID_MISSING");
      return { state: "bot_missing", inviteUrl: discordBotInviteUrl(applicationId, guildId) };
    }
    if (!member.ok) throw new ConvexError({ code: `discord_${member.status}` });
    const { roles: botRoleIds } = await member.json() as { roles: string[] };
    const [roles, channels] = await Promise.all([
      discordJson<Array<{ id: string; permissions: string }>>(`/guilds/${guildId}/roles`),
      discordJson<DiscordChannel[]>(`/guilds/${guildId}/channels`),
    ]);
    return { state: "ready", channels: readableTextChannels(channels, { guildId, botUserId, botRoleIds, roles }) };
  },
});

const siteConnectArgs = {
  communityProfileId: v.id("profiles"), guildId: v.string(), guildName: v.string(), channelId: v.string(), channelName: v.string(), mode: connectorMode,
};

export const connectProvenChannel = internalMutation({
  args: siteConnectArgs,
  returns: v.id("eventConnectors"),
  handler: async (ctx, args) => connectDiscordAnnouncements(ctx, { ...args, userId: await requireSiteConnect(ctx, args.communityProfileId, args.guildId) }),
});

/** Connects a channel after Discord itself places it in the proved guild, so a guild proof cannot claim another server's channel. */
export const connectChannel = action({
  args: siteConnectArgs,
  returns: v.id("eventConnectors"),
  handler: async (ctx, args): Promise<Id<"eventConnectors">> => {
    await ctx.runQuery(internal.discordIntake.authorizeSiteConnect, { communityProfileId: args.communityProfileId, guildId: args.guildId });
    if (!DISCORD_SNOWFLAKE.test(args.channelId)) throw new ConvexError({ code: "CONNECTOR_TARGET" });
    const response = await discordRequest({ method: "GET", path: `/channels/${args.channelId}` });
    if (botLacksAccess(response.status)) throw new ConvexError({ code: "CONNECTOR_TARGET" });
    if (!response.ok) throw new ConvexError({ code: `discord_${response.status}` });
    const channel = await response.json() as { guild_id?: string; type: number };
    if (channel.guild_id !== args.guildId || !isConnectableChannelType(channel.type)) throw new ConvexError({ code: "CONNECTOR_TARGET" });
    return ctx.runMutation(internal.discordIntake.connectProvenChannel, args);
  },
});
