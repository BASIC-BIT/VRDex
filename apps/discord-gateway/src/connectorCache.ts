export type ConnectorSummary = {
  connectorId: string;
  kind: string;
  direction: string;
  mode: string;
  state: string;
  guildId: string;
  channelId?: string;
  lastMessageId?: string;
};

type ConnectorQuery = { guildId: string; channelId?: string };

export function createConnectorCache({ fetchConnectors, ttlMs = 60_000, now = Date.now }: {
  fetchConnectors: (query: ConnectorQuery) => Promise<ConnectorSummary[]>;
  ttlMs?: number;
  now?: () => number;
}) {
  // ponytail: stale entries are replaced, never evicted; bounded by channels the bot can see. Add eviction if that grows large.
  const entries = new Map<string, { fetchedAt: number; connectors: ConnectorSummary[] }>();
  return {
    async get(query: ConnectorQuery): Promise<ConnectorSummary[]> {
      const key = `${query.guildId}:${query.channelId ?? ""}`;
      const entry = entries.get(key);
      if (entry && now() - entry.fetchedAt < ttlMs) return entry.connectors;
      const connectors = await fetchConnectors(query);
      entries.set(key, { fetchedAt: now(), connectors });
      return connectors;
    },
  };
}
