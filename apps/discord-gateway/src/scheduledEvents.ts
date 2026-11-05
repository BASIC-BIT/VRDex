import type { ConnectorSummary } from "./connectorCache";

const ACTIONS = new Map<string, "create" | "update" | "delete">([
  ["GUILD_SCHEDULED_EVENT_CREATE", "create"],
  ["GUILD_SCHEDULED_EVENT_UPDATE", "update"],
  ["GUILD_SCHEDULED_EVENT_DELETE", "delete"],
]);

export type ScheduledEventRelayDeps = {
  botUserId: string | null;
  getConnectors(query: { guildId: string }): Promise<ConnectorSummary[]>;
  relay(kind: "scheduled_event", action: "create" | "update" | "delete", guildId: string, channelId: undefined, payload: unknown): Promise<void>;
};

/**
 * Relays one raw scheduled event dispatch for a guild with an importing connector, and answers whether it did.
 * Raw `d` is the API shape the Convex side parses; discord.js's own events hand over camelCase instances and may be partial on delete.
 */
export async function relayScheduledEventPacket({ t, d }: { t?: string | null; d?: unknown }, deps: ScheduledEventRelayDeps): Promise<boolean> {
  const action = ACTIONS.get(t ?? "");
  if (action === undefined) return false;
  const { guild_id: guildId, creator_id: creatorId } = Object(d) as { guild_id?: unknown; creator_id?: unknown };
  if (typeof guildId !== "string") return false;
  // The bot's own create is a VRDex export, and the export writes the link. Its updates still relay: staff can edit that event in Discord.
  if (action === "create" && deps.botUserId !== null && creatorId === deps.botUserId) return false;
  const connectors = await deps.getConnectors({ guildId });
  if (!connectors.some(row => row.kind === "discord_scheduled_events" && row.state === "active" && (row.direction === "import" || row.direction === "bidirectional"))) return false;
  await deps.relay("scheduled_event", action, guildId, undefined, d);
  return true;
}
