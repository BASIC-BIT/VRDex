import type { Doc } from "./_generated/dataModel";

/** Every staff content/state write closes contributor authority in that transaction. */
export function contributorStaffLock(event: Doc<"events">, now: number) {
  if (!event.contributorUserId) return {};
  return {
    contributorEditsClosedAt: event.contributorEditsClosedAt ?? now,
    contributorLockRevision: (event.contributorLockRevision ?? 0) + 1,
    updatedAt: Math.max(now, event.updatedAt + 1),
  };
}
