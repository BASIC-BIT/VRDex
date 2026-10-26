import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";

export const EVENT_BROADCAST_LEASE_MS = 30_000;
export const EVENT_BROADCAST_STOP_GRACE_MS = 30_000;
export const EVENT_BROADCAST_RENEW_AFTER_MS = 10_000;
export const EVENT_BROADCAST_COMMAND_BATCH = 20;
export const EVENT_BROADCAST_MAX_SOURCES = 64;
export const EVENT_BROADCAST_MAX_SCENES = 64;
export const EVENT_BROADCAST_MAX_OUTPUTS = 8;
export { observedBroadcastStateValidator } from "./_eventMediaControl";

export const workerSessionArgs = {
  protocolVersion: v.optional(v.number()),
  bridgeToken: v.string(),
  eventId: v.id("events"),
  sessionId: v.id("eventMediaSessions"),
  workerId: v.string(),
  epoch: v.number(),
};
export type BroadcastSession = Doc<"eventMediaSessions">;
export type BroadcastCommand = Doc<"eventMediaCommands">;

export function requireEventMediaBridgeToken(input: string) {
  const expected = process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN?.trim();
  if (!expected) throw new Error("Event media bridge token is not configured.");
  let mismatch = input.length === expected.length ? 0 : 1;
  for (let i = 0; i < Math.max(input.length, expected.length); i += 1) {
    mismatch |= (input.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  if (mismatch !== 0) throw new Error("Event media bridge token is invalid.");
}

/** Number oldest pending intent in bounded chunks. Completed history is never
 * migrated. New intent can stay unnumbered while an older backlog drains; polls
 * keep making progress instead of throwing a permanent migration-limit error.
 */
export async function allocateSessionCommandSequence(db: DatabaseWriter, sessionId: Id<"eventMediaSessions">, reserve = true) {
  const session = await db.get(sessionId);
  if (session === null) throw new Error("Event media worker session was not found.");
  const latest = await db.query("eventMediaCommands")
    .withIndex("by_sessionId_sequence", q => q.eq("sessionId", sessionId)).order("desc").first();
  let next = Math.max(session.nextCommandSequence ?? 1, (latest?.sequence ?? 0) + 1);
  if (session.controlProtocolVersion === 2) {
    await db.patch(sessionId, { nextCommandSequence: next + (reserve ? 1 : 0) });
    return next;
  }
  const candidates = (await Promise.all((["queued", "claimed"] as const).flatMap(status => [
    db.query("eventMediaCommands").withIndex("by_session_scope_status_sequence", q =>
      q.eq("sessionId", sessionId).eq("eventId", session.eventId).eq("programId", session.programId).eq("status", status).eq("sequence", undefined)).take(EVENT_BROADCAST_COMMAND_BATCH + 1),
    db.query("eventMediaCommands").withIndex("by_program_scope_session_status_createdAt", q =>
      q.eq("programId", session.programId).eq("eventId", session.eventId).eq("sessionId", undefined).eq("status", status)).take(EVENT_BROADCAST_COMMAND_BATCH + 1),
  ]))).flat().sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
  for (const command of candidates.slice(0, EVENT_BROADCAST_COMMAND_BATCH)) {
    await db.patch(command._id, { sessionId, sequence: next++ });
  }
  const reserved = reserve && candidates.length <= EVENT_BROADCAST_COMMAND_BATCH;
  await db.patch(sessionId, { nextCommandSequence: next + (reserved ? 1 : 0) });
  return reserved || !reserve ? next : undefined;
}

/** Terminal execution cannot leave intent pending for a session that cannot run. */
export async function settleTerminalSessionCommands(db: DatabaseWriter, sessionId: Id<"eventMediaSessions">, state: "ended" | "error", now: number) {
  await db.patch(sessionId, {pendingControlCommandId:undefined});
  for (const status of ["queued", "claimed"] as const) {
    const pending = await db.query("eventMediaCommands")
      .withIndex("by_sessionId_status_createdAt", q => q.eq("sessionId", sessionId).eq("status", status)).collect();
    for (const command of pending) {
      await db.patch(command._id, { status: state === "error" ? "failed" : "cancelled", completedAt: now, updatedAt: now });
    }
  }
}

export type BroadcastPolicy = {
  silence?: { thresholdDb: number; durationMs: number };
  maxOverrunMs?: number;
};

/** Validate explicit advanced overrides without supplying defaults. */
export function validateBroadcastPolicy(input: unknown): BroadcastPolicy {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid broadcast policy.");
  }
  const result: BroadcastPolicy = {};
  if ("maxOverrunMs" in input && input.maxOverrunMs !== undefined) {
    const value = input.maxOverrunMs;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
      throw new Error("Invalid maximum overrun.");
    }
    result.maxOverrunMs = value;
  }
  if ("silence" in input && input.silence !== undefined) {
    const value = input.silence;
    if (typeof value !== "object" || value === null || !("thresholdDb" in value) || !("durationMs" in value) ||
      typeof value.thresholdDb !== "number" || !Number.isFinite(value.thresholdDb) || value.thresholdDb < -120 || value.thresholdDb > 0 ||
      typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1_000 || value.durationMs > 600_000) {
      throw new Error("Invalid calibrated silence policy.");
    }
    result.silence = { thresholdDb: value.thresholdDb, durationMs: value.durationMs };
  }
  return result;
}

/** Conservative synthetic AAC/MPEGTS calibration; not a musical classifier. */
export function effectiveBroadcastPolicy(input: BroadcastPolicy | undefined): BroadcastPolicy {
  const policy = validateBroadcastPolicy(input ?? {});
  return { ...policy, silence: policy.silence ?? { thresholdDb: -90, durationMs: 15_000 } };
}
