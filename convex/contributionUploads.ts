import {
  validateBatchMedia,
  linkBatchMedia,
  requireContributionBatch,
} from "./contributionBatches";
import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { localUploadRequestSchema } from "../packages/api-contracts/src/media-upload";
import { isCurrentEmailVerificationAttestation } from "./_identity";
import { userOwnsProfile } from "./_profileOwnership";
import {
  assertProfileAssetIntentCapacity,
  createProfileAssetUploadIntentRecord,
  finalizeProfileAssetUploadIntentUpload,
  getProfileMediaVersion,
  normalizeProfileAssetSourceUrl,
  validateProfileAssetByteSize,
} from "./_profileAssets";
import {
  assertEligibleTarget,
  assertSubmissionRateLimits,
  openSubmissionCountForProfile,
  openSubmissionCountForUser,
} from "./profileMediaSubmissions";
import {
  changeContributionCharge,
  reservationBytes,
  effectiveContributionPolicy,
  contributionChargeRefusal,
  batchAllowance,
  assertCapacityNotRevoked,
  localUploadModes,
} from "./_contributionCapacity";

const authorityArgs = {
  actorUserId: v.id("users"),
  oauthClientId: v.string(),
  oauthTokenId: v.string(),
  emailVerified: v.boolean(),
  emailVerificationAttestedAt: v.number(),
};
type Authority = {
  actorUserId: Id<"users">;
  oauthClientId: string;
  oauthTokenId: string;
  emailVerified: boolean;
  emailVerificationAttestedAt: number;
};
export const uploadReceiptValidator = v.object({
  operationId: v.string(),
  operationState: v.union(
    v.literal("committed"),
    v.literal("refused"),
    v.literal("in_progress"),
  ),
  resourceId: v.optional(v.string()),
  code: v.optional(v.string()),
});
const receipt = (intentId: Id<"profileAssetUploadIntents">, code?: string) => ({
  operationId: String(intentId),
  operationState: "refused" as const,
  code: code ?? "UPLOAD_UNAVAILABLE",
});

async function authorize(
  ctx: MutationCtx,
  args: Authority,
  mode: "owner" | "contributor",
) {
  if (!localUploadModes()[mode])
    throw new ConvexError({ code: "UPLOAD_DISABLED" });
  if (
    !args.emailVerified ||
    !isCurrentEmailVerificationAttestation(args.emailVerificationAttestedAt) ||
    !(await ctx.db.get(args.actorUserId))
  )
    throw new ConvexError({ code: "UPLOAD_ACTOR_DENIED" });
  const token = await ctx.db
    .query("oauthAccessTokens")
    .withIndex("by_tokenId", (q) => q.eq("tokenId", args.oauthTokenId))
    .unique();
  if (
    !token ||
    token.subjectType !== "user" ||
    token.userId !== args.actorUserId ||
    token.clientId !== args.oauthClientId ||
    token.status !== "active" ||
    token.expiresAt <= Date.now() ||
    !token.scopes.includes("mcp:write")
  )
    throw new ConvexError({ code: "UPLOAD_DELEGATION_DENIED" });
  if (token.applicationId) {
    const app = await ctx.db.get(token.applicationId);
    if (!app || app.status !== "active")
      throw new ConvexError({ code: "UPLOAD_DELEGATION_DENIED" });
  }
  if (token.dynamicClientId) {
    const client = await ctx.db.get(token.dynamicClientId);
    if (!client || client.status !== "active")
      throw new ConvexError({ code: "UPLOAD_DELEGATION_DENIED" });
  }
  const requiredScope = mode === "owner" ? "assets:write" : "assets:contribute";
  if (!token.scopes.includes(requiredScope))
    throw new ConvexError({ code: "UPLOAD_DELEGATION_DENIED", requiredScope });
}
async function target(
  ctx: MutationCtx,
  actor: Id<"users">,
  profileId: Id<"profiles">,
  mode: "owner" | "contributor",
  placement: "profile_image" | "primary_logo",
  expected: number,
) {
  const profile = await ctx.db.get(profileId);
  if (!profile || profile.updatedAt !== expected)
    throw new ConvexError({ code: "UPLOAD_TARGET_CHANGED" });
  if (
    (profile.profileType === "person" ? "profile_image" : "primary_logo") !==
    placement
  )
    throw new ConvexError({ code: "UPLOAD_PLACEMENT_INVALID" });
  if (mode === "contributor") return assertEligibleTarget(profile, placement);
  if (
    profile.claimState === "unclaimed" ||
    !(await userOwnsProfile(ctx.db, profileId, actor))
  )
    throw new ConvexError({ code: "UPLOAD_TARGET_DENIED" });
  return profile;
}
async function reservation(
  ctx: MutationCtx,
  intentId: Id<"profileAssetUploadIntents">,
  args: Authority,
) {
  const row = await ctx.db
    .query("contributionUploadReservations")
    .withIndex("by_intentId", (q) => q.eq("intentId", intentId))
    .unique();
  if (
    !row ||
    row.actorUserId !== args.actorUserId ||
    (!row.batchRevisionId && row.oauthClientId !== args.oauthClientId)
  )
    throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
  await authorize(ctx, args, row.mode);
  await assertCapacityNotRevoked(ctx.db, row.actorUserId, row.createdAt);
  if (
    row.allowanceId &&
    (await ctx.db.get(row.allowanceId))?.state === "revoked"
  )
    throw new ConvexError({ code: "CONTRIBUTION_CAPACITY_REVOKED" });
  if (row.capacityRevokedAt !== undefined)
    throw new ConvexError({ code: "CONTRIBUTION_CAPACITY_REVOKED" });
  if (process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED === "true")
    throw new ConvexError({ code: "CONTRIBUTION_INTAKE_PAUSED" });
  if (row.batchRevisionId) {
    const rev = await ctx.db.get(row.batchRevisionId);
    if (!rev) throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
    if (row.receipt && (rev.kind !== undefined || !rev.payload)) {
      await requireContributionBatch(
        ctx,
        { ...args, batchId: rev.batchId },
        true,
      );
      // Terminal replay needs retained scope/ownership, not the private manifest.
      // Missing kind is not inferred from the reservation or receipt.
      if (rev.actorUserId !== args.actorUserId || rev.kind !== "media")
        throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
      return row;
    }
    // Unfinished work, or a legacy unpurged revision without retained kind,
    // still requires validation of the original manifest.
    await validateBatchMedia(
      ctx,
      args,
      String(rev.batchId),
      rev.itemKey,
      rev.revision,
      true,
    );
  }
  return row;
}

export const begin = internalMutation({
  args: {
    ...authorityArgs,
    signingToken: v.optional(v.string()),
    mode: v.union(v.literal("owner"), v.literal("contributor")),
    profileId: v.id("profiles"),
    expectedUpdatedAt: v.number(),
    placement: v.union(v.literal("profile_image"), v.literal("primary_logo")),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
    credit: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceDescription: v.optional(v.string()),
    batchId: v.optional(v.string()),
    itemKey: v.optional(v.string()),
    expectedItemRevision: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  returns: v.union(
    v.object({ receipt: uploadReceiptValidator }),
    v.object({
      intentId: v.id("profileAssetUploadIntents"),
      expiresAt: v.number(),
      quarantineStorageKey: v.string(),
      contentType: v.string(),
      byteLength: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const {
      actorUserId,
      oauthClientId,
      oauthTokenId: _token,
      emailVerified: _verified,
      emailVerificationAttestedAt: _at,
      signingToken,
      ...input
    } = args;
    if (
      signingToken !== undefined &&
      (!signingToken || signingToken.length > 128)
    )
      throw new ConvexError({ code: "UPLOAD_INPUT_INVALID" });
    const request = localUploadRequestSchema.parse(input);
    await authorize(ctx, args, request.mode);
    const hasBatch =
      request.batchId !== undefined ||
      request.itemKey !== undefined ||
      request.expectedItemRevision !== undefined;
    if (
      hasBatch &&
      (!request.batchId ||
        !request.itemKey ||
        request.expectedItemRevision === undefined ||
        request.mode !== "contributor")
    )
      throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
    const linked = hasBatch
      ? await validateBatchMedia(
          ctx,
          args,
          request.batchId!,
          request.itemKey!,
          request.expectedItemRevision!,
          true,
        )
      : null;
    if (linked) {
      if (
        linked.profileId !== request.profileId ||
        linked.expectedUpdatedAt !== request.expectedUpdatedAt ||
        linked.input.placement !== request.placement ||
        linked.input.sha256 !== request.sha256 ||
        linked.input.byteLength !== request.byteLength ||
        linked.input.contentType !== request.contentType ||
        linked.input.credit !== request.credit ||
        linked.input.sourceUrl !== request.sourceUrl ||
        linked.input.source.description !== request.sourceDescription
      )
        throw new ConvexError({ code: "UPLOAD_BATCH_CONFLICT" });
    }
    const sourceUrl = normalizeProfileAssetSourceUrl(request.sourceUrl);
    if (!sourceUrl && !request.sourceDescription)
      throw new ConvexError({ code: "UPLOAD_PROVENANCE_REQUIRED" });
    const fingerprint = JSON.stringify(request);
    const priorRefusal = await ctx.db
      .query("contributionAdmissionRefusals")
      .withIndex("by_actor_client_key", (q) =>
        q
          .eq("actorUserId", actorUserId)
          .eq("clientId", oauthClientId)
          .eq("key", request.idempotencyKey),
      )
      .unique();
    if (priorRefusal) {
      if (priorRefusal.fingerprint !== fingerprint)
        throw new ConvexError({ code: "UPLOAD_IDEMPOTENCY_CONFLICT" });
      return { receipt: priorRefusal.receipt };
    }
    const refuse = async (code: string) => {
      const result = {
        operationId: crypto.randomUUID(),
        operationState: "refused" as const,
        code,
      };
      await ctx.db.insert("contributionAdmissionRefusals", {
        actorUserId,
        clientId: oauthClientId,
        key: request.idempotencyKey,
        fingerprint,
        receipt: result,
        createdAt: Date.now(),
      });
      if (linked)
        await ctx.db.insert("contributionItemAttempts", {
          actorUserId,
          revisionId: linked.revision._id,
          oauthClientId,
          receipt: result,
          createdAt: Date.now(),
        });
      return { receipt: result };
    };
    let old = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_actor_client_key", (q) =>
        q
          .eq("actorUserId", actorUserId)
          .eq("oauthClientId", oauthClientId)
          .eq("idempotencyKey", request.idempotencyKey),
      )
      .unique();
    if (linked) {
      const previous = await ctx.db
        .query("contributionItemAttempts")
        .withIndex("by_revision", (q) =>
          q.eq("revisionId", linked.revision._id),
        )
        .unique();
      if (previous) {
        if (previous.receipt.operationState === "refused")
          return { receipt: previous.receipt };
        if (!previous.intentId)
          throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
        old = await ctx.db
          .query("contributionUploadReservations")
          .withIndex("by_intentId", (q) => q.eq("intentId", previous.intentId!))
          .unique();
      }
    }
    if (old && linked && old.batchRevisionId !== linked.revision._id)
      throw new ConvexError({ code: "UPLOAD_BATCH_CONFLICT" });
    if (linked && !old && (await ctx.db.get(linked.revision.batchId))?.archived)
      throw new ConvexError({ code: "BATCH_ARCHIVED" });
    if (old && !linked && old.fingerprint !== fingerprint)
      throw new ConvexError({ code: "UPLOAD_IDEMPOTENCY_CONFLICT" });
    if (old?.receipt) {
      // Replay uses current authority, while the original expected version may
      // have changed because this very command published the asset.
      const current = await ctx.db.get(args.profileId);
      await target(
        ctx,
        actorUserId,
        args.profileId,
        request.mode,
        request.placement,
        current?.updatedAt ?? request.expectedUpdatedAt,
      );
      return { receipt: old.receipt };
    }
    const profile = await target(
      ctx,
      actorUserId,
      args.profileId,
      request.mode,
      request.placement,
      request.expectedUpdatedAt,
    );
    if (old) {
      if (old.state !== "pending" || old.expiresAt <= Date.now())
        throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
      // Only the first request may issue a target until its signing outcome is
      // recorded. A failed concurrent request must not cancel a usable target.
      if (old.signingToken)
        return {
          receipt: {
            operationId: String(old.intentId),
            operationState: "in_progress" as const,
          },
        };
      const intent = await ctx.db.get(old.intentId);
      if (!intent?.quarantineStorageKey)
        throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
      return {
        intentId: old.intentId,
        expiresAt: old.expiresAt,
        quarantineStorageKey: intent.quarantineStorageKey,
        contentType: old.declaredType,
        byteLength: old.declaredBytes,
      };
    }
    const now = Date.now();
    const policy = await effectiveContributionPolicy(ctx.db, actorUserId);
    const charge = reservationBytes(request.byteLength);
    const allowance = linked
      ? await batchAllowance(ctx.db, linked.revision.batchId, actorUserId)
      : null;
    const extraBytes = allowance?.bytes ?? 0;
    if (allowance && (allowance.usedBytes ?? 0) + charge > extraBytes)
      return refuse("CONTRIBUTION_BATCH_BYTES");
    const refusal = await contributionChargeRefusal(
      ctx.db,
      { actorUserId, profileId: profile._id },
      charge,
      1,
      extraBytes,
    );
    if (refusal) return refuse(refusal);
    if (request.mode === "contributor") {
      if (
        (await openSubmissionCountForUser(ctx, actorUserId, now)) >=
        policy.limits.openActor
      )
        return refuse("CONTRIBUTION_ACTOR_OPEN_LIMIT");
      if (
        (await openSubmissionCountForProfile(ctx, profile._id, now)) >=
        policy.limits.openTarget
      )
        return refuse("CONTRIBUTION_TARGET_OPEN_LIMIT");
      try {
        await assertSubmissionRateLimits(ctx, actorUserId, profile._id, now);
      } catch {
        return refuse("CONTRIBUTION_ROLLING_LIMIT");
      }
    } else await assertProfileAssetIntentCapacity(ctx.db, profile._id, now);
    await changeContributionCharge(
      ctx.db,
      { actorUserId, profileId: profile._id, ledgerVersion: 1 },
      charge,
      1,
      false,
    );
    if (allowance)
      await ctx.db.patch(allowance._id, {
        usedBytes: (allowance.usedBytes ?? 0) + charge,
      });
    const subject = {
      issuer: "vrdex:api",
      subject: String(actorUserId),
      tokenIdentifier: `api:${actorUserId}`,
    };
    const expiresAt = now + 10 * 60 * 1000;
    const placement = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (q) =>
        q
          .eq("profileId", profile._id)
          .eq("placement", request.placement)
          .eq("state", "active"),
      )
      .first();
    const submissionId =
      request.mode === "owner"
        ? undefined
        : await ctx.db.insert("profileMediaSubmissions", {
            profileId: profile._id,
            targetProfileSlug: profile.slug,
            targetProfileDisplayName: profile.displayName,
            submitterUserId: actorUserId,
            submitter: subject,
            requestedPlacement: request.placement,
            sourceUrl,
            sourceKind: "local",
            sourceDescription: request.sourceDescription,
            credit: request.credit,
            status: "upload_pending",
            targetProfileUpdatedAt: profile.updatedAt,
            targetPlacementAssetId: placement?.assetId,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          });
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: subject,
      targetProfileId: profile._id,
      targetSubmissionId: submissionId,
      originalFileName: "local-image",
      mimeType: request.contentType,
      byteSize: request.byteLength,
      credit: request.credit,
      sourceUrl,
      placements: [request.placement],
      source:
        request.mode === "owner" ? "owner_authored" : "community_submitted",
      purpose:
        request.mode === "owner" ? "owner_publish" : "community_proposal",
      now,
    });
    await ctx.db.patch(intent.intentId, {
      issuer: "mcp_local",
      expiresAt,
      // Never derive quarantine from the legacy token or a final key.
      quarantineStorageKey: `profile-assets/quarantine/local/${crypto.randomUUID()}`,
      mcpExpectedMediaVersion:
        request.mode === "owner"
          ? await getProfileMediaVersion(ctx.db, profile._id)
          : undefined,
    });
    if (submissionId)
      await ctx.db.patch(submissionId, { uploadIntentId: intent.intentId });
    await ctx.db.insert("contributionUploadReservations", {
      intentId: intent.intentId,
      ledgerVersion: 1,
      allowanceId: allowance?._id,
      actorUserId,
      ...(linked ? { batchRevisionId: linked.revision._id } : {}),
      profileId: profile._id,
      oauthClientId,
      idempotencyKey: request.idempotencyKey,
      fingerprint,
      mode: request.mode,
      expectedUpdatedAt: request.expectedUpdatedAt,
      declaredBytes: request.byteLength,
      declaredType: request.contentType,
      sha256: request.sha256,
      chargedBytes: charge,
      quarantineBytes: request.byteLength,
      processing: true,
      signingToken,
      state: "pending",
      expiresAt,
      cleanupAfter: expiresAt + 24 * 60 * 60 * 1000,
      createdAt: now,
    });
    if (linked && submissionId)
      await linkBatchMedia(
        ctx,
        args,
        linked.revision._id,
        intent.intentId,
        submissionId,
      );
    const stored = (await ctx.db.get(intent.intentId))!;
    return {
      intentId: intent.intentId,
      expiresAt,
      quarantineStorageKey: stored.quarantineStorageKey!,
      contentType: request.contentType,
      byteLength: request.byteLength,
    };
  },
});

export const claim = internalMutation({
  args: {
    ...authorityArgs,
    intentId: v.id("profileAssetUploadIntents"),
    idempotencyKey: v.string(),
    processingToken: v.string(),
  },
  returns: v.union(
    v.object({ receipt: uploadReceiptValidator }),
    v.object({
      intentId: v.id("profileAssetUploadIntents"),
      quarantineStorageKey: v.string(),
      storageKey: v.string(),
      sourceStorageKey: v.string(),
      downloadStorageKey: v.string(),
      byteLength: v.number(),
      contentType: v.string(),
      sha256: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (
      !args.idempotencyKey ||
      args.idempotencyKey.length > 128 ||
      args.processingToken.length > 128
    )
      throw new ConvexError({ code: "UPLOAD_INPUT_INVALID" });
    const row = await reservation(ctx, args.intentId, args);
    if (row.completionKey && row.completionKey !== args.idempotencyKey)
      return { receipt: receipt(row.intentId, "UPLOAD_IDEMPOTENCY_CONFLICT") };
    if (row.receipt) return { receipt: row.receipt };
    const intent = await ctx.db.get(row.intentId);
    if (!intent || intent.issuer !== "mcp_local")
      throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
    await target(
      ctx,
      args.actorUserId,
      row.profileId,
      row.mode,
      intent.placements![0] as "profile_image" | "primary_logo",
      row.expectedUpdatedAt,
    );
    if (row.expiresAt <= Date.now())
      return { receipt: await failReservation(ctx, row, "UPLOAD_EXPIRED") };
    if (row.state === "processing")
      return {
        receipt: {
          operationId: String(row.intentId),
          operationState: "in_progress" as const,
        },
      };
    if (row.state !== "pending" || !row.processing)
      throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
    await ctx.db.patch(row._id, {
      state: "processing",
      processingToken: args.processingToken,
      completionKey: args.idempotencyKey,
    });
    await ctx.db.patch(intent._id, {
      processingToken: args.processingToken,
      processingStartedAt: Date.now(),
    });
    return {
      intentId: row.intentId,
      quarantineStorageKey: intent.quarantineStorageKey!,
      storageKey: intent.storageKey,
      sourceStorageKey: intent.sourceStorageKey!,
      downloadStorageKey: intent.downloadStorageKey!,
      byteLength: row.declaredBytes,
      contentType: row.declaredType,
      sha256: row.sha256,
    };
  },
});
export async function failReservation(
  ctx: MutationCtx,
  row: Doc<"contributionUploadReservations">,
  code: string,
) {
  if (row.receipt) return row.receipt;
  const result = receipt(row.intentId, code);
  if (row.processing) await changeContributionCharge(ctx.db, row, 0, -1);
  await ctx.db.patch(row._id, {
    state: "failed",
    processing: false,
    receipt: result,
  });
  if (row.batchRevisionId) {
    const attempt = await ctx.db
      .query("contributionItemAttempts")
      .withIndex("by_revision", (q) => q.eq("revisionId", row.batchRevisionId!))
      .unique();
    if (attempt)
      await ctx.db.patch(attempt._id, {
        receipt: { ...result, operationId: String(row.batchRevisionId) },
      });
  }
  const intent = await ctx.db.get(row.intentId);
  if (intent?.targetSubmissionId) {
    const submission = await ctx.db.get(intent.targetSubmissionId);
    if (submission?.status === "upload_pending")
      await ctx.db.patch(submission._id, {
        status: "withdrawn",
        blobDeleteAfter: row.cleanupAfter,
        updatedAt: Date.now(),
      });
  }
  return result;
}
export const fail = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_intentId", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (row && row.processingToken === args.processingToken)
      await failReservation(ctx, row, "UPLOAD_VALIDATION_FAILED");
    return null;
  },
});
export const settleSigning = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    signingToken: v.string(),
    succeeded: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_intentId", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (
      row?.state === "pending" &&
      !row.receipt &&
      row.signingToken === args.signingToken
    ) {
      await ctx.db.patch(row._id, { signingToken: undefined });
      if (!args.succeeded)
        await failReservation(ctx, row, "UPLOAD_TARGET_UNAVAILABLE");
      return true;
    }
    return false;
  },
});
// Only the acquisition owner may reopen its reservation. Retained bytes and
// concurrency remain charged; a retry must acquire a fresh fence.
export const retryAcquisition = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("contributionUploadReservations")
      .withIndex("by_intentId", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (
      row?.state === "processing" &&
      !row.receipt &&
      row.processingToken === args.processingToken
    ) {
      await ctx.db.patch(row._id, {
        state: "pending",
        processingToken: undefined,
      });
      await ctx.db.patch(row.intentId, {
        processingToken: undefined,
        processingStartedAt: undefined,
      });
    }
    return null;
  },
});
export const complete = internalMutation({
  args: {
    ...authorityArgs,
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
    idempotencyKey: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    contentSha256: v.string(),
    width: v.number(),
    height: v.number(),
    sourceMimeType: v.string(),
    sourceByteSize: v.number(),
    sourceContentSha256: v.string(),
    downloadMimeType: v.string(),
    downloadByteSize: v.number(),
    downloadContentSha256: v.string(),
  },
  returns: uploadReceiptValidator,
  handler: async (ctx, args) => {
    const row = await reservation(ctx, args.intentId, args);
    if (row.completionKey && row.completionKey !== args.idempotencyKey)
      return receipt(row.intentId, "UPLOAD_IDEMPOTENCY_CONFLICT");
    if (row.receipt) return row.receipt;
    if (
      row.state !== "processing" ||
      row.processingToken !== args.processingToken ||
      row.completionKey !== args.idempotencyKey
    )
      throw new ConvexError({ code: "UPLOAD_UNAVAILABLE" });
    if (row.expiresAt <= Date.now())
      return await failReservation(ctx, row, "UPLOAD_EXPIRED");
    const intent = (await ctx.db.get(row.intentId))!;
    await target(
      ctx,
      args.actorUserId,
      row.profileId,
      row.mode,
      intent.placements![0] as "profile_image" | "primary_logo",
      row.expectedUpdatedAt,
    );
    if (
      args.sourceByteSize !== row.declaredBytes ||
      args.sourceContentSha256 !== row.sha256 ||
      args.sourceMimeType !== row.declaredType
    )
      throw new ConvexError({ code: "UPLOAD_SOURCE_MISMATCH" });
    const retained = new Map<string, number>([
      [intent.quarantineStorageKey!, row.declaredBytes],
      [
        intent.sourceStorageKey!,
        validateProfileAssetByteSize(args.sourceByteSize),
      ],
      [
        intent.downloadStorageKey!,
        validateProfileAssetByteSize(args.downloadByteSize),
      ],
      [intent.storageKey, validateProfileAssetByteSize(args.byteSize)],
    ]);
    const bytes = [...retained.values()].reduce((a, b) => a + b, 0);
    if (bytes > row.chargedBytes)
      throw new ConvexError({ code: "UPLOAD_RESERVATION_EXCEEDED" });
    const {
      actorUserId: _actor,
      oauthClientId: _client,
      oauthTokenId: _token,
      emailVerified: _verified,
      emailVerificationAttestedAt: _at,
      idempotencyKey: _key,
      ...prepared
    } = args;
    const result = await finalizeProfileAssetUploadIntentUpload(ctx.db, {
      ...prepared,
      uploadToken: intent.uploadToken,
      bridgeAuthorized: true,
      now: Date.now(),
    });
    const committed = {
      operationId: String(row.intentId),
      operationState: "committed" as const,
      resourceId: String(intent.targetSubmissionId ?? result.assetIds[0]),
    };
    await changeContributionCharge(ctx.db, row, bytes - row.chargedBytes, -1);
    await ctx.db.patch(row._id, {
      state: "committed",
      chargedBytes: bytes,
      processing: false,
      receipt: committed,
    });
    return committed;
  },
});
