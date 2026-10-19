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

/** Allocate within the same transaction as insertion; legacy records are numbered first. */
export async function allocateSessionCommandSequence(db: DatabaseWriter, sessionId: Id<"eventMediaSessions">, reserve = true) {
  const session = await db.get(sessionId);
  if (session === null) throw new Error("Event media worker session was not found.");
  const latest = await db.query("eventMediaCommands")
    .withIndex("by_sessionId_sequence", q => q.eq("sessionId", sessionId)).order("desc").first();
  let next = Math.max(session.nextCommandSequence ?? 1, (latest?.sequence ?? 0) + 1);
  const legacy = await db.query("eventMediaCommands")
    .withIndex("by_sessionId_sequence", q => q.eq("sessionId", sessionId).eq("sequence", undefined)).take(1001);
  if (legacy.length > 1000) throw new Error("Legacy event media commands require migration.");
  for (const command of legacy.sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime)) {
    await db.patch(command._id, { sequence: next++ });
  }
  await db.patch(sessionId, { nextCommandSequence: next + (reserve ? 1 : 0) });
  return next;
}

/** Attach older pending intent before allocating a later operator sequence. */
export async function attachPendingProgramCommands(db: DatabaseWriter, sessionId: Id<"eventMediaSessions">) {
  const session = await db.get(sessionId);
  if (session === null) throw new Error("Event media worker session was not found.");
  for (const status of ["queued", "claimed"] as const) {
    const pending = await db.query("eventMediaCommands")
      .withIndex("by_programId_status_createdAt", q => q.eq("programId", session.programId).eq("status", status)).collect();
    for (const command of pending) {
      if (command.sessionId === undefined && command.eventId === session.eventId) {
        await db.patch(command._id, { sessionId });
      }
    }
  }
}
