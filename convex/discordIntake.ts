import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { DISCORD_SNOWFLAKE, discordMessagePayloadValidator, isDiscordCdnUrl, quietWindowMs, resolveDiscordUserId } from "./_discordIntake";
import { connectorDirection, connectorKind, connectorMode, connectorState } from "./_eventConnectors";
import { cancelPendingSchedule } from "./_eventSync";

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
