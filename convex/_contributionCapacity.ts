import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import {
  PROFILE_ASSET_UPLOAD_MAX_BYTES,
  validateProfileAssetByteSize,
} from "./_profileAssets";

// Conservative baseline ceilings. Higher tiers are a separate rollout.
export const CONTRIBUTION_CAPACITY = {
  actorProcessing: 3,
  targetProcessing: 2,
  actorBytes: 3 * 4 * PROFILE_ASSET_UPLOAD_MAX_BYTES,
  targetBytes: 2 * 4 * PROFILE_ASSET_UPLOAD_MAX_BYTES,
} as const;
export function reservationBytes(sourceBytes: number) {
  return (
    2 * validateProfileAssetByteSize(sourceBytes) +
    2 * PROFILE_ASSET_UPLOAD_MAX_BYTES
  );
}
export async function changeContributionCharge(
  db: DatabaseWriter,
  reservation: Pick<
    Doc<"contributionUploadReservations">,
    "actorUserId" | "profileId"
  >,
  bytes: number,
  processing: number,
  admit = false,
) {
  for (const [scope, maxBytes, maxProcessing] of [
    [
      `actor:${reservation.actorUserId}`,
      CONTRIBUTION_CAPACITY.actorBytes,
      CONTRIBUTION_CAPACITY.actorProcessing,
    ],
    [
      `target:${reservation.profileId}`,
      CONTRIBUTION_CAPACITY.targetBytes,
      CONTRIBUTION_CAPACITY.targetProcessing,
    ],
  ] as const) {
    const row = await db
      .query("contributionCapacity")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .unique();
    const next = {
      bytes: (row?.bytes ?? 0) + bytes,
      processing: (row?.processing ?? 0) + processing,
    };
    if (
      next.bytes < 0 ||
      next.processing < 0 ||
      !Number.isSafeInteger(next.bytes)
    )
      throw new Error("UPLOAD_ACCOUNTING_INVALID");
    const byteLimit = Math.min(row?.byteLimit ?? maxBytes, maxBytes);
    const processingLimit = Math.min(
      row?.processingLimit ?? maxProcessing,
      maxProcessing,
    );
    if (
      ![byteLimit, processingLimit].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new Error("UPLOAD_ACCOUNTING_INVALID");
    if (admit && (next.bytes > byteLimit || next.processing > processingLimit))
      throw new Error("UPLOAD_CAPACITY_EXCEEDED");
    if (row) await db.patch(row._id, next);
    else await db.insert("contributionCapacity", { scope, ...next });
  }
}
