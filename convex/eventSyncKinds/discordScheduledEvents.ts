import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { parseScheduledEvent, type DiscordScheduledEvent } from "../_discordScheduledEventMap";
import { DISCORD_ID, discordScheduledEventsEnabled } from "../_eventConnectors";
import { enqueueSyncJob } from "../_eventSync";

export type ScheduledEventJobPayload = { action: "create" | "update" | "delete"; event: DiscordScheduledEvent; receivedAt: number };

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
