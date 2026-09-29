import type { DatabaseWriter } from "./_generated/server";

const DAY = 86_400_000;

export async function recordGroupMemberObservation(
  db: DatabaseWriter,
  value: { vrchatGroupId: string; memberCount: number; observedAt: number; groupCreatedAt?: number },
) {
  const latest = await db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", q => q.eq("vrchatGroupId", value.vrchatGroupId))
    .order("desc").first();
  const metadata = await db.query("vrchatGroupMemberMetadata")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", value.vrchatGroupId)).unique();
  if (!latest || (value.observedAt > latest.observedAt &&
    (latest.memberCount !== value.memberCount || value.observedAt - latest.observedAt >= DAY))) {
    await db.insert("vrchatGroupMemberSnapshots", value);
  }
  if (metadata) {
    await db.patch(metadata._id, {
      ...(value.groupCreatedAt !== undefined && metadata.groupCreatedAt === undefined ? { groupCreatedAt: value.groupCreatedAt } : {}),
      lastObservedAt: Math.max(metadata.lastObservedAt ?? 0, value.observedAt),
      updatedAt: value.observedAt,
    });
  } else {
    await db.insert("vrchatGroupMemberMetadata", {
      vrchatGroupId: value.vrchatGroupId,
      ...(value.groupCreatedAt === undefined ? {} : { groupCreatedAt: value.groupCreatedAt }),
      lastObservedAt: value.observedAt,
      updatedAt: value.observedAt,
    });
  }
}
