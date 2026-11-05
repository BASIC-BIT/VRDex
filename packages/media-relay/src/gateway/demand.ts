import { StreamKeySchema, type StreamKey } from "../contracts";
import { RELAY_POLICY } from "../policy";
export type DemandObservation = { streamKey: StreamKey; at: number };
export type DemandStore = {
  /** Probe transport even when the registry has no sources yet. */
  checkHealth: () => Promise<void>;
  /** Conditional max-time update; ConditionalCheckFailedException is success (newer observation won). */
  updateMax: (observation: DemandObservation) => Promise<void>;
  /** Strongly consistent read, null for absent. Never substitute current time. */
  read: (streamKey: StreamKey) => Promise<number | null>;
};
export function dynamoDemandUpdate({
  tableName,
  streamKey,
  at,
}: DemandObservation & { tableName: string }) {
  StreamKeySchema.parse(streamKey);
  if (!tableName || !Number.isSafeInteger(at) || at < 0)
    throw Error("Invalid demand update");
  return {
    TableName: tableName,
    Key: { streamKey },
    UpdateExpression: "SET lastActivityAt = :at",
    ConditionExpression:
      "attribute_not_exists(lastActivityAt) OR lastActivityAt < :at",
    ExpressionAttributeValues: { ":at": at },
  };
}
export function createDemand({
  store,
  clock,
  maxEntries = 1000,
  maxConcurrent = 32,
}: {
  store: DemandStore;
  clock: () => number;
  maxEntries?: number;
  maxConcurrent?: number;
}) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isSafeInteger(maxConcurrent) ||
    maxConcurrent < 1
  )
    throw Error("Invalid demand bounds");
  const entries = new Map<StreamKey, { at: number; pending?: Promise<void> }>();
  let busy = 0;
  async function bounded<T>(fn: () => Promise<T>): Promise<T> {
    if (busy >= maxConcurrent) throw Error("Demand capacity");
    busy++;
    try {
      return await fn();
    } finally {
      busy--;
    }
  }
  let healthProbe: Promise<void> | undefined;
  async function checkHealth() {
    healthProbe ??= bounded(() => store.checkHealth()).finally(() => {
      healthProbe = undefined;
    });
    await healthProbe;
  }
  async function recordDemand({
    streamKey,
    at,
  }: DemandObservation): Promise<void> {
    StreamKeySchema.parse(streamKey);
    if (!Number.isSafeInteger(at) || at < 0 || at > clock())
      throw Error("Invalid demand time");
    let entry = entries.get(streamKey);
    if (!entry) {
      for (const [key, value] of entries)
        if (!value.pending && clock() - value.at >= RELAY_POLICY.idleGraceMs)
          entries.delete(key);
      if (entries.size >= maxEntries) throw Error("Demand capacity");
      entry = { at: -Infinity };
      entries.set(streamKey, entry);
    }
    if (entry.pending) {
      await entry.pending;
      return recordDemand({ streamKey, at });
    }
    if (at - entry.at < 10000) return;
    const current = entry;
    const pending = bounded(() => store.updateMax({ streamKey, at })).then(
      () => {
        current.at = Math.max(current.at, at);
      },
    );
    current.pending = pending;
    try {
      await pending;
    } finally {
      delete current.pending;
    }
  }
  async function lastDemand(streamKey: StreamKey): Promise<number | null> {
    StreamKeySchema.parse(streamKey);
    const at = await bounded(() => store.read(streamKey));
    if (at !== null && (!Number.isSafeInteger(at) || at < 0 || at > clock()))
      throw Error("Invalid stored demand");
    return at;
  }
  async function read({
    streamKeys,
    signal,
  }: {
    streamKeys: StreamKey[];
    signal: AbortSignal;
  }) {
    if (streamKeys.length > maxEntries) return { healthy: false, activity: [] };
    const activity: { streamKey: StreamKey; lastActivityAt: number }[] = [];
    try {
      signal.throwIfAborted();
      await checkHealth();
      signal.throwIfAborted();
      for (const streamKey of streamKeys) {
        signal.throwIfAborted();
        const at = await lastDemand(streamKey);
        signal.throwIfAborted();
        if (at !== null) activity.push({ streamKey, lastActivityAt: at });
      }
      return { healthy: true, activity };
    } catch {
      return { healthy: false, activity: [] };
    }
  }
  return { recordDemand, lastDemand, read };
}
