import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter, DatabaseReader } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { resolveContributionPolicy } from "./_contributionPolicy";
import {
  PROFILE_ASSET_UPLOAD_MAX_BYTES,
  validateProfileAssetByteSize,
} from "./_profileAssets";

// Conservative baseline ceilings. Higher tiers are a separate rollout.
export const CONTRIBUTION_CAPACITY = {
  actorProcessing: 3,
  targetProcessing: 2,
  actorBytes: resolveContributionPolicy({}).ordinary.actorBytes,
  targetBytes: resolveContributionPolicy({}).ordinary.targetBytes,
} as const;
export function reservationBytes(sourceBytes: number) {
  return (
    2 * validateProfileAssetByteSize(sourceBytes) +
    2 * PROFILE_ASSET_UPLOAD_MAX_BYTES
  );
}
export async function effectiveContributionPolicy(
  db: DatabaseReader,
  actor: Id<"users">,
) {
  const policy = resolveContributionPolicy();
  const grants = await getAccountFeatureAccess(db, actor);
  return {
    ...policy,
    tier: grants.canContributeBulk ? "trusted" : "ordinary",
    limits: grants.canContributeBulk ? policy.trusted : policy.ordinary,
  };
}
export async function contributionChargeRefusal(
  db: DatabaseReader,
  reservation: Pick<
    Doc<"contributionUploadReservations">,
    "actorUserId" | "profileId"
  >,
  bytes: number,
  processing: number,
  allowanceBytes = 0,
) {
  const policy = await effectiveContributionPolicy(db, reservation.actorUserId);
  if (policy.paused) return "CONTRIBUTION_INTAKE_PAUSED";
  for (const [scope, maxBytes, maxProcessing, category] of [
    [
      `actor:${reservation.actorUserId}`,
      policy.limits.actorBytes + allowanceBytes,
      policy.limits.actorProcessing,
      "ACTOR",
    ],
    [
      `target:${reservation.profileId}`,
      policy.limits.targetBytes,
      policy.limits.targetProcessing,
      "TARGET",
    ],
    [
      "deployment",
      policy.deploymentBytes,
      policy.deploymentProcessing,
      "DEPLOYMENT",
    ],
  ] as const) {
    const row = await db
      .query("contributionCapacity")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .unique();
    const published =
      scope === "deployment"
        ? await db
            .query("contributionCapacity")
            .withIndex("by_scope", (q) => q.eq("scope", "published"))
            .unique()
        : null;
    if (
      (row?.bytes ?? 0) + (published?.bytes ?? 0) + bytes >
      Math.min(row?.byteLimit ?? maxBytes, maxBytes)
    )
      return `CONTRIBUTION_${category}_BYTES`;
    if (
      (row?.processing ?? 0) + processing >
      Math.min(row?.processingLimit ?? maxProcessing, maxProcessing)
    )
      return `CONTRIBUTION_${category}_CONCURRENCY`;
  }
  return null;
}
export async function batchAllowance(
  db: DatabaseReader,
  batchId: Id<"contributionBatches">,
  actor: Id<"users">,
) {
  if (resolveContributionPolicy().version !== "synthetic-v1") return null;
  const rows = await db
    .query("contributionCapacityRequests")
    .withIndex("by_batch_state", (q) =>
      q.eq("batchId", batchId).eq("state", "approved"),
    )
    .take(2);
  if (rows.length > 1) throw new Error("CAPACITY_ALLOWANCE_CONFLICT");
  const row = rows[0];
  return row?.actorUserId === actor &&
    row.expiresAt !== undefined &&
    row.expiresAt > Date.now()
    ? row
    : null;
}
export async function assertCapacityNotRevoked(
  db: DatabaseReader,
  actor: Id<"users">,
  admittedAt: number,
) {
  const grant = await db
    .query("accountFeatureGrants")
    .withIndex("by_userId_feature_state", (q) =>
      q
        .eq("userId", actor)
        .eq("feature", "trusted_contributor")
        .eq("state", "revoked"),
    )
    .order("desc")
    .first();
  if (grant?.revokedAt !== undefined && grant.revokedAt >= admittedAt)
    throw new Error("CONTRIBUTION_CAPACITY_REVOKED");
}
export async function changeContributionCharge(
  db: DatabaseWriter,
  reservation: Pick<
    Doc<"contributionUploadReservations">,
    "actorUserId" | "profileId"
  > & { ledgerVersion?: number },
  bytes: number,
  processing: number,
  admit = false,
) {
  if (
    admit &&
    (await contributionChargeRefusal(db, reservation, bytes, processing))
  )
    throw new Error("UPLOAD_CAPACITY_EXCEEDED");
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
    ["deployment", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ] as const) {
    if (scope === "deployment" && !admit && reservation.ledgerVersion !== 1)
      continue;
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
    if (row) await db.patch(row._id, next);
    else await db.insert("contributionCapacity", { scope, ...next });
  }
}

export async function registerLegacyContribution(
  db: DatabaseWriter,
  intentId: Id<"profileAssetUploadIntents">,
  actorUserId: Id<"users">,
  profileId: Id<"profiles">,
  bytes = PROFILE_ASSET_UPLOAD_MAX_BYTES,
) {
  const intent = (await db.get(intentId))!;
  const charge = reservationBytes(bytes);
  await changeContributionCharge(
    db,
    { actorUserId, profileId, ledgerVersion: 1 },
    charge,
    1,
    true,
  );
  await db.insert("contributionUploadReservations", {
    intentId,
    actorUserId,
    profileId,
    ledgerVersion: 1,
    oauthClientId: intent.mcpOauthClientId ?? "browser",
    idempotencyKey: intent.mcpIdempotencyKeyHash ?? String(intentId),
    fingerprint: intent.mcpRequestFingerprint ?? String(intentId),
    mode: "contributor",
    expectedUpdatedAt: (await db.get(profileId))!.updatedAt,
    declaredBytes: bytes,
    declaredType: intent.mimeType ?? "image/unknown",
    sha256: "legacy",
    chargedBytes: charge,
    quarantineBytes: 0,
    processing: true,
    state: "pending",
    expiresAt: intent.expiresAt,
    cleanupAfter: intent.expiresAt + 86400000,
    createdAt: Date.now(),
  });
}
export async function settleLegacyContribution(
  db: DatabaseWriter,
  intent: Doc<"profileAssetUploadIntents">,
  sizes: {
    byteSize: number;
    sourceByteSize?: number;
    downloadByteSize?: number;
  },
) {
  if (intent.issuer === "mcp_local") return;
  const row = await db
    .query("contributionUploadReservations")
    .withIndex("by_intentId", (q) => q.eq("intentId", intent._id))
    .unique();
  if (!row || row.receipt) return;
  const bytes =
    sizes.byteSize +
    (sizes.sourceByteSize ?? 0) +
    (sizes.downloadByteSize ?? 0);
  if (bytes > row.chargedBytes) throw new Error("UPLOAD_RESERVATION_EXCEEDED");
  await changeContributionCharge(db, row, bytes - row.chargedBytes, -1);
  await db.patch(row._id, {
    chargedBytes: bytes,
    processing: false,
    state: "committed",
    receipt: {
      operationId: String(intent._id),
      operationState: "committed",
      resourceId: String(intent.targetSubmissionId),
    },
  });
}
export async function transferPublishedCharge(
  db: DatabaseWriter,
  submission: Doc<"profileMediaSubmissions">,
) {
  if (!submission.uploadIntentId) return;
  const row = await db
    .query("contributionUploadReservations")
    .withIndex("by_intentId", (q) =>
      q.eq("intentId", submission.uploadIntentId!),
    )
    .unique();
  if (!row || row.publishedBytes !== undefined) return;
  const bytes = row.chargedBytes - row.quarantineBytes;
  await changeContributionCharge(db, row, -bytes, 0);
  const scope = "published",
    old = await db
      .query("contributionCapacity")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .unique();
  if (old) await db.patch(old._id, { bytes: old.bytes + bytes });
  else await db.insert("contributionCapacity", { scope, bytes, processing: 0 });
  await db.patch(row._id, {
    chargedBytes: row.quarantineBytes,
    publishedBytes: bytes,
  });
}
