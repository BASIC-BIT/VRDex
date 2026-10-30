import type { ConnectorSummary } from "./connectorCache";
import { logFailure, toMessagePayload, type RelayableMessage } from "./relay";

/** Replays posts made while the gateway was down. `recordMessage` upserts, so repeating a replay is safe. */
export async function catchUpMissedMessages({ fetchConnectors, fetchMessagesAfter, relay }: {
  fetchConnectors: () => Promise<ConnectorSummary[]>;
  fetchMessagesAfter: (channelId: string, afterId: string) => Promise<RelayableMessage[]>;
  relay: typeof import("./relay").relay;
}): Promise<number> {
  let relayed = 0;
  for (const { connectorId, kind, guildId, channelId, lastMessageId } of await fetchConnectors()) {
    if (kind !== "discord_announcements" || channelId === undefined || lastMessageId === undefined) continue;
    try {
      const messages = await fetchMessagesAfter(channelId, lastMessageId);
      messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const message of messages) {
        const payload = toMessagePayload(message);
        if (payload === null) continue;
        await relay("message", "create", guildId, channelId, payload);
        relayed += 1;
      }
    } catch (error) {
      logFailure("discord_gateway_catch_up_failed", error, { connectorId });
    }
  }
  return relayed;
}
