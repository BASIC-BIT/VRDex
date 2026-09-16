import { canReadProfile } from "./_profilePermissions";
import {
  effectiveContributionPolicy,
  batchAllowance,
} from "./_contributionCapacity";
import {
  activeBatchAssignment,
  reviewerContext,
  trustedReviewActor,
} from "./_mediaReview";
import { readScopedCursor, writeScopedCursor } from "./_reviewCursor";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  contributionBatchCreateSchema,
  contributionItemInputSchema,
  type ContributionItemInput,
} from "../packages/api-contracts/src/contribution-batches";
import {
  authorizeContribution,
  contributionAuthorityArgs,
  type ContributionAuthority,
} from "./_contributionAuth";
import {
  createCommunityProfileRecord,
  applyContributionLinks,
} from "./profiles";
import { sanitizeProfileLinks } from "./_profileLinks";
import {
  isSafePublicSeedImportField,
  exceedsPublicProfileLimits,
} from "./_seedImports";
import { createProfileSortName } from "./_profileSubmissions";

export const MANIFEST_LIMITS = {
  ordinary: { activeRows: 1000, retainedRevisions: 10000 },
  trusted: { activeRows: 10000, retainedRevisions: 100000 },
  revisionBytes: 8192,
  revisionsPerItem: 5,
} as const;
const batchArgs = {
  ...contributionAuthorityArgs,
  batchId: v.id("contributionBatches"),
};
const itemArgs = {
  ...batchArgs,
  itemKey: v.string(),
  expectedRevision: v.number(),
};
const receiptValidator = v.object({
  operationId: v.string(),
  operationState: v.union(
    v.literal("committed"),
    v.literal("refused"),
    v.literal("in_progress"),
  ),
  resourceId: v.optional(v.string()),
  code: v.optional(v.string()),
});
const itemResult = v.object({ itemKey: v.string(), revision: v.number() });
const batchResult = v.object({
  batchId: v.id("contributionBatches"),
  label: v.string(),
  archived: v.boolean(),
  rowCount: v.number(),
});
function batchView(b: Doc<"contributionBatches">) {
  return {
    batchId: b._id,
    label: b.label,
    archived: b.archived,
    rowCount: b.rowCount,
  };
}
export async function requireContributionBatch(
  ctx: QueryCtx | MutationCtx,
  args: ContributionAuthority & { batchId: Id<"contributionBatches"> },
  write: boolean,
) {
  const token = await authorizeContribution(ctx, args, write);
  const row = await ctx.db.get(args.batchId);
  if (!row) throw new ConvexError({ code: "BATCH_UNAVAILABLE" });
  if (row.actorUserId !== args.actorUserId) {
    if (
      write ||
      !token.scopes.includes("assets:review:read") ||
      !(await activeBatchAssignment(ctx, row._id, args.actorUserId))
    )
      throw new ConvexError({ code: "BATCH_UNAVAILABLE" });
  }
  return row;
}
async function item(
  ctx: QueryCtx | MutationCtx,
  batchId: Id<"contributionBatches">,
  key: string,
) {
  if (!key || key.length > 128) throw new ConvexError({ code: "BATCH_INPUT_INVALID" });
  const row = await ctx.db
    .query("contributionItems")
    .withIndex("by_batch_key", (q) =>
      q.eq("batchId", batchId).eq("itemKey", key),
    )
    .unique();
  if (!row) throw new ConvexError({ code: "BATCH_ITEM_UNAVAILABLE" });
  return row;
}
function normalize(raw: unknown) {
  const input = contributionItemInputSchema.parse(raw);
  if (input.kind === "profile_links")
    input.links = sanitizeProfileLinks(input.links, "community_submitted").map(
      ({ type, url, label }) => ({ type, url, label }),
    );
  if (input.kind === "profile_create" && input.profile.outboundLinks)
    input.profile.outboundLinks = sanitizeProfileLinks(
      input.profile.outboundLinks,
      "community_submitted",
    ).map(({ type, url, label }) => ({ type, url, label }));
  const payload = JSON.stringify(input),
    bytes = new TextEncoder().encode(payload).length;
  if (bytes > MANIFEST_LIMITS.revisionBytes)
    throw new ConvexError({ code: "BATCH_METADATA_LIMIT" });
  return { input, payload, bytes };
}
async function charge(
  ctx: MutationCtx,
  actorUserId: Id<"users">,
  rows: number,
  revisions: number,
  bytes: number,
  batchId?: Id<"contributionBatches">,
  batchRowCount?: number,
) {
  const old = await ctx.db
    .query("contributionManifestUsage")
    .withIndex("by_actor", (q) => q.eq("actorUserId", actorUserId))
    .unique();
  const next = {
    activeRows: (old?.activeRows ?? 0) + rows,
    retainedRevisions: (old?.retainedRevisions ?? 0) + revisions,
    retainedBytes: (old?.retainedBytes ?? 0) + bytes,
  };
  const limits = (await effectiveContributionPolicy(ctx.db, actorUserId))
    .limits;
  const allowance = batchId
    ? await batchAllowance(ctx.db, batchId, actorUserId)
    : null;
  if (
    allowance &&
    rows > 0 &&
    (batchRowCount ?? (await ctx.db.get(batchId!))?.rowCount ?? 0) + rows >
      allowance.rows!
  )
    throw new ConvexError({ code: "BATCH_ALLOWANCE_ROWS" });
  if (
    (rows > 0 &&
      next.activeRows > limits.activeRows + (allowance?.rows ?? 0)) ||
    (revisions > 0 && next.retainedRevisions > limits.retainedRevisions) ||
    (bytes > 0 &&
      next.retainedBytes >
        limits.retainedRevisions * MANIFEST_LIMITS.revisionBytes)
  )
    throw new ConvexError({ code: "BATCH_CAPACITY_EXCEEDED" });
  if (Object.values(next).some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new ConvexError({ code: "BATCH_ACCOUNTING_INVALID" });
  if (old) await ctx.db.patch(old._id, next);
  else
    await ctx.db.insert("contributionManifestUsage", { actorUserId, ...next });
}
async function attempt(
  ctx: QueryCtx | MutationCtx,
  revisionId: Id<"contributionItemRevisions">,
) {
  return ctx.db
    .query("contributionItemAttempts")
    .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
    .unique();
}
async function terminal(
  ctx: QueryCtx | MutationCtx,
  old: Doc<"contributionItemAttempts"> | null,
) {
  // An unattempted proposal can be corrected. Existing attempts must finish.
  if (!old) return true;
  if (old.submissionId) {
    const media = await ctx.db.get(old.submissionId);
    return (
      !!media &&
      ["approved", "rejected", "withdrawn", "superseded"].includes(media.status)
    );
  }
  return old.receipt.operationState !== "in_progress";
}
export const create = internalMutation({
  args: { ...contributionAuthorityArgs, input: v.any() },
  returns: batchResult,
  handler: async (ctx, args) => {
    await authorizeContribution(ctx, args, true);
    const input = contributionBatchCreateSchema.parse(args.input);
    const old = await ctx.db
      .query("contributionBatches")
      .withIndex("by_actor_key", (q) =>
        q
          .eq("actorUserId", args.actorUserId)
          .eq("idempotencyKey", input.idempotencyKey),
      )
      .unique();
    if (old) {
      if (old.label !== input.label) throw new ConvexError({ code: "BATCH_CONFLICT" });
      return batchView(old);
    }
    const id = await ctx.db.insert("contributionBatches", {
      actorUserId: args.actorUserId,
      ...input,
      archived: false,
      rowCount: 0,
      createdAt: Date.now(),
    });
    return batchView((await ctx.db.get(id))!);
  },
});
export const append = internalMutation({
  args: { ...batchArgs, items: v.array(v.any()) },
  returns: v.array(itemResult),
  handler: async (ctx, args) => {
    const b = await requireContributionBatch(ctx, args, true);
    if (b.archived) throw new ConvexError({ code: "BATCH_ARCHIVED" });
    if (args.items.length < 1 || args.items.length > 50)
      throw new ConvexError({ code: "BATCH_APPEND_LIMIT" });
    const normalized = args.items.map(normalize);
    if (
      new Set(normalized.map((n) => n.input.itemKey)).size !== normalized.length
    )
      throw new ConvexError({ code: "BATCH_CONFLICT" });
    const result = [];
    for (const n of normalized) {
      await authorizeContribution(
        ctx,
        args,
        true,
        n.input.kind === "media" ? "assets:contribute" : "profile:contribute",
      );
      const old = await ctx.db
        .query("contributionItems")
        .withIndex("by_batch_key", (q) =>
          q.eq("batchId", b._id).eq("itemKey", n.input.itemKey),
        )
        .unique();
      if (old) {
        const rev = await ctx.db.get(old.revisionId);
        if (rev?.payload !== n.payload) throw new ConvexError({ code: "BATCH_CONFLICT" });
        result.push({ itemKey: old.itemKey, revision: old.revision });
        continue;
      }
      await charge(ctx, args.actorUserId, 1, 1, n.bytes, b._id, b.rowCount);
      const revisionId = await ctx.db.insert("contributionItemRevisions", {
        actorUserId: args.actorUserId,
        batchId: b._id,
        itemKey: n.input.itemKey,
        revision: 1,
        payload: n.payload,
        kind: n.input.kind,
        bytes: n.bytes,
        createdAt: Date.now(),
      });
      await ctx.db.insert("contributionItems", {
        actorUserId: args.actorUserId,
        batchId: b._id,
        itemKey: n.input.itemKey,
        revision: 1,
        revisionId,
        createdAt: Date.now(),
      });
      b.rowCount++;
      result.push({ itemKey: n.input.itemKey, revision: 1 });
    }
    await ctx.db.patch(b._id, { rowCount: b.rowCount });
    return result;
  },
});
export const get = internalQuery({
  args: batchArgs,
  returns: batchResult,
  handler: async (ctx, args) =>
    batchView(await requireContributionBatch(ctx, args, false)),
});
export const items = internalQuery({
  args: {
    ...batchArgs,
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        itemKey: v.string(),
        revision: v.number(),
        kind: v.string(),
        receipt: v.optional(receiptValidator),
        mediaStatus: v.optional(v.string()),
        profileId: v.optional(v.string()),
        profileUpdatedAt: v.optional(v.number()),
      }),
    ),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batch = await requireContributionBatch(ctx, args, false);
    const scope = `items:${args.actorUserId}:${args.batchId}`;
    if (
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 40 ||
      (args.cursor?.length ?? 0) > 4096
    )
      throw new ConvexError({ code: "BATCH_PAGE_INVALID" });
    const page = await ctx.db
      .query("contributionItems")
      .withIndex("by_batch_key", (q) => q.eq("batchId", args.batchId))
      .paginate({
        numItems: args.limit,
        cursor: readScopedCursor(args.cursor, scope),
      });
    return {
      page: await Promise.all(
        page.page.map(async (row) => {
          const rev = (await ctx.db.get(row.revisionId))!,
            a = await attempt(ctx, rev._id);
          const media = a?.submissionId
            ? await ctx.db.get(a.submissionId)
            : null;
          if (batch.actorUserId !== args.actorUserId) {
            if (!media) return null;
            const profile = await ctx.db.get(media.profileId);
            if (!profile) return null;
            try {
              await reviewerContext(
                ctx,
                profile,
                await trustedReviewActor(ctx, args.actorUserId, args),
                media,
              );
            } catch {
              return null;
            }
          }
          return {
            itemKey: row.itemKey,
            revision: row.revision,
            kind:
              rev.payloadExpiredAt === undefined
                ? contributionItemInputSchema.parse(JSON.parse(rev.payload))
                    .kind
                : "expired",
            ...(a ? { receipt: a.receipt } : {}),
            ...(media ? { mediaStatus: media.status } : {}),
            ...(a?.profileId
              ? { profileId: a.profileId, profileUpdatedAt: a.profileUpdatedAt }
              : {}),
          };
        }),
      ).then((rows) => rows.filter((row) => row !== null)),
      cursor: writeScopedCursor(page.continueCursor, scope),
      isDone: page.isDone,
    };
  },
});
export const archive = internalMutation({
  args: batchArgs,
  returns: batchResult,
  handler: async (ctx, args) => {
    const b = await requireContributionBatch(ctx, args, true);
    if (!b.archived) {
      await charge(ctx, args.actorUserId, -b.rowCount, 0, 0);
      await ctx.db.patch(b._id, {
        archived: true,
        archivedAt: Date.now(),
        payloadRetentionVersion: 1,
        payloadCleanupAfter: Date.now() + 30 * 86400000,
      });
    }
    return { ...batchView(b), archived: true };
  },
});
export const revise = internalMutation({
  args: { ...itemArgs, item: v.any() },
  returns: itemResult,
  handler: async (ctx, args) => {
    const b = await requireContributionBatch(ctx, args, true);
    if (b.archived) throw new ConvexError({ code: "BATCH_ARCHIVED" });
    const row = await item(ctx, b._id, args.itemKey),
      n = normalize(args.item);
    if (
      !Number.isInteger(args.expectedRevision) ||
      args.expectedRevision < 1 ||
      args.expectedRevision > 5
    )
      throw new ConvexError({ code: "BATCH_REVISION_INVALID" });
    await authorizeContribution(
      ctx,
      args,
      true,
      n.input.kind === "media" ? "assets:contribute" : "profile:contribute",
    );
    if (n.input.itemKey !== row.itemKey) throw new ConvexError({ code: "BATCH_CONFLICT" });
    if (
      row.revision === args.expectedRevision + 1 &&
      (await ctx.db.get(row.revisionId))?.payload === n.payload
    )
      return { itemKey: row.itemKey, revision: row.revision };
    if (row.revision !== args.expectedRevision)
      throw new ConvexError({ code: "BATCH_REVISION_CHANGED" });
    if (row.revision >= 5) throw new ConvexError({ code: "BATCH_REVISION_LIMIT" });
    if (!(await terminal(ctx, await attempt(ctx, row.revisionId))))
      throw new ConvexError({ code: "BATCH_ATTEMPT_NOT_TERMINAL" });
    const old = contributionItemInputSchema.parse(
      JSON.parse((await ctx.db.get(row.revisionId))!.payload),
    );
    if (old.kind !== n.input.kind) throw new ConvexError({ code: "BATCH_KIND_CHANGED" });
    const prior = await attempt(ctx, row.revisionId);
    if (prior?.profileId && old.kind === "profile_create")
      throw new ConvexError({ code: "BATCH_ALREADY_CREATED" });
    await charge(ctx, args.actorUserId, 0, 1, n.bytes);
    const revision = row.revision + 1,
      revisionId = await ctx.db.insert("contributionItemRevisions", {
        actorUserId: args.actorUserId,
        batchId: b._id,
        itemKey: row.itemKey,
        revision,
        payload: n.payload,
        kind: n.input.kind,
        bytes: n.bytes,
        createdAt: Date.now(),
      });
    await ctx.db.patch(row._id, { revision, revisionId });
    return { itemKey: row.itemKey, revision };
  },
});
function safeFields(input: ContributionItemInput) {
  const fields =
    input.kind === "profile_links"
      ? [["outboundLinks", input.links]]
      : input.kind === "profile_create"
        ? Object.entries(input.profile).filter(
            ([key]) => !["displayName", "profileType"].includes(key),
          )
        : [];
  return fields.every(
    ([fieldKey, value]) =>
      isSafePublicSeedImportField({
        fieldKey: String(fieldKey),
        value,
        confidence: "high",
        reviewState: "accepted",
        visibility: "public",
      }) && !exceedsPublicProfileLimits({ fieldKey: String(fieldKey), value }),
  );
}
export const submit = internalMutation({
  args: itemArgs,
  returns: receiptValidator,
  handler: async (ctx, args) => {
    const b = await requireContributionBatch(ctx, args, true);
    const row = await item(ctx, b._id, args.itemKey);
    if (row.revision !== args.expectedRevision)
      throw new ConvexError({ code: "BATCH_REVISION_CHANGED" });
    const rev = (await ctx.db.get(row.revisionId))!;
    const kind =
      rev.kind ??
      (rev.payload
        ? contributionItemInputSchema.parse(JSON.parse(rev.payload)).kind
        : undefined);
    if (!kind) throw new ConvexError({ code: "BATCH_PAYLOAD_EXPIRED" });
    await authorizeContribution(
      ctx,
      args,
      true,
      kind === "media" ? "assets:contribute" : "profile:contribute",
    );
    const old = await attempt(ctx, rev._id);
    if (old) {
      if (kind === "media" && old.submissionId && rev.payload) {
        const media = await ctx.db.get(old.submissionId);
        const input = contributionItemInputSchema.parse(
          JSON.parse(rev.payload),
        );
        if (media?.status === "upload_pending")
          return {
            operationId: String(rev._id),
            operationState: "in_progress" as const,
            code:
              input.kind === "media" && input.transport === "url"
                ? "URL_UPLOAD_REQUIRED"
                : "UPLOAD_REQUIRED",
          };
      }
      return old.receipt;
    }
    if (rev.payloadExpiredAt !== undefined)
      throw new ConvexError({ code: "BATCH_PAYLOAD_EXPIRED" });
    const input = contributionItemInputSchema.parse(JSON.parse(rev.payload));
    if (b.archived) throw new ConvexError({ code: "BATCH_ARCHIVED" });
    let code: string | undefined;
    if (input.source.publication !== "public_allowed") code = "SOURCE_PRIVATE";
    if (!safeFields(input)) code = "SOURCE_UNSAFE";
    if (input.kind === "profile_create") {
      const matches = await ctx.db
        .query("profiles")
        .withIndex("by_profileType_sortName", (q) =>
          q
            .eq("profileType", input.profile.profileType)
            .eq("sortName", createProfileSortName(input.profile.displayName)),
        )
        .take(1);
      if (input.identity.resolution !== "new_identity" || matches.length)
        code = "NEEDS_REVIEW";
    }
    if (input.kind === "media" && !code)
      return {
        operationId: String(rev._id),
        operationState: "in_progress" as const,
        code:
          input.transport === "local"
            ? "UPLOAD_REQUIRED"
            : "URL_UPLOAD_REQUIRED",
      };
    let profileId: Id<"profiles"> | undefined,
      profileUpdatedAt: number | undefined;
    if (!code) {
      if (input.kind === "profile_create")
        profileId = (
          await createCommunityProfileRecord(ctx, input.profile, {
            issuer: "vrdex:api",
            subject: String(args.actorUserId),
            tokenIdentifier: `api:${args.actorUserId}`,
          })
        ).profileId;
      if (input.kind === "profile_links") {
        const targetId = ctx.db.normalizeId("profiles", input.profileId),
          profile = targetId ? await ctx.db.get(targetId) : null;
        if (!profile || !canReadProfile("public", profile) || profile.claimState !== "unclaimed") code = "BATCH_TARGET_UNAVAILABLE";
        else if (profile.updatedAt !== input.expectedUpdatedAt) code = "PROFILE_CHANGED";
        else profileId = (
          await applyContributionLinks(
            ctx,
            profile,
            args.actorUserId,
            input.expectedUpdatedAt,
            input.links,
          )
        )._id;
      }
      if (profileId)
        profileUpdatedAt = (await ctx.db.get(profileId))!.updatedAt;
    }
    const receipt = {
      operationId: String(rev._id),
      operationState: code ? ("refused" as const) : ("committed" as const),
      ...(code ? { code } : {}),
      ...(profileId ? { resourceId: String(profileId) } : {}),
    };
    // No catch after publication: any unexpected failure rolls the entire transaction back.
    await ctx.db.insert("contributionItemAttempts", {
      actorUserId: args.actorUserId,
      revisionId: rev._id,
      oauthClientId: args.oauthClientId,
      receipt,
      ...(profileId ? { profileId, profileUpdatedAt } : {}),
      createdAt: Date.now(),
    });
    return receipt;
  },
});

export async function validateBatchMedia(
  ctx: MutationCtx,
  args: ContributionAuthority,
  batchId: string,
  itemKey: string,
  expectedRevision: number,
  allowArchived = false,
) {
  const id = ctx.db.normalizeId("contributionBatches", batchId);
  if (!id) throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
  const b = await requireContributionBatch(ctx, { ...args, batchId: id }, true);
  if (b.archived && !allowArchived) throw new ConvexError({ code: "BATCH_ARCHIVED" });
  await authorizeContribution(ctx, args, true, "assets:contribute");
  const row = await item(ctx, id, itemKey);
  if (row.revision !== expectedRevision)
    throw new ConvexError({ code: "BATCH_REVISION_CHANGED" });
  const rev = (await ctx.db.get(row.revisionId))!,
    input = contributionItemInputSchema.parse(JSON.parse(rev.payload));
  if (input.kind !== "media" || input.source.publication !== "public_allowed")
    throw new ConvexError({ code: "UPLOAD_BATCH_UNAVAILABLE" });
  let profileId = input.profileId,
    expectedUpdatedAt = input.expectedUpdatedAt;
  if (input.dependsOnItemKey) {
    const dep = await item(ctx, id, input.dependsOnItemKey),
      a = await attempt(ctx, dep.revisionId);
    if (!a?.profileId || a.receipt.operationState !== "committed")
      throw new ConvexError({ code: "BATCH_DEPENDENCY_UNRESOLVED" });
    profileId = a.profileId;
    expectedUpdatedAt = a.profileUpdatedAt;
  }
  return {
    revision: rev,
    input,
    profileId: profileId!,
    expectedUpdatedAt: expectedUpdatedAt!,
  };
}
export async function linkBatchMedia(
  ctx: MutationCtx,
  args: ContributionAuthority,
  revisionId: Id<"contributionItemRevisions">,
  intentId: Id<"profileAssetUploadIntents">,
  submissionId: Id<"profileMediaSubmissions">,
) {
  if (await attempt(ctx, revisionId)) throw new ConvexError({ code: "BATCH_ATTEMPT_EXISTS" });
  await ctx.db.insert("contributionItemAttempts", {
    actorUserId: args.actorUserId,
    revisionId,
    oauthClientId: args.oauthClientId,
    intentId,
    submissionId,
    receipt: {
      operationId: String(revisionId),
      operationState: "committed",
      resourceId: String(submissionId),
    },
    createdAt: Date.now(),
  });
}

export const mediaRequest = internalMutation({
  args: itemArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const resolved = await validateBatchMedia(
      ctx,
      args,
      String(args.batchId),
      args.itemKey,
      args.expectedRevision,
      true,
    );
    const input = resolved.input;
    return {
      mode: "contributor",
      profileId: resolved.profileId,
      expectedUpdatedAt: resolved.expectedUpdatedAt,
      placement: input.placement,
      contentType: input.contentType,
      byteLength: input.byteLength,
      sha256: input.sha256,
      credit: input.credit,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      sourceDescription: input.source.description,
      batchId: String(args.batchId),
      itemKey: args.itemKey,
      expectedItemRevision: args.expectedRevision,
      idempotencyKey: String(resolved.revision._id),
      transport: input.transport,
    };
  },
});
/** Bounded reconciliation pieces, accumulated by a trusted caller outside one transaction. */
export const reconcilePage = internalQuery({
  args: {
    ...contributionAuthorityArgs,
    cursor: v.union(v.string(), v.null()),
    kind: v.union(v.literal("batches"), v.literal("revisions")),
  },
  returns: v.object({
    cursor: v.string(),
    isDone: v.boolean(),
    activeRows: v.number(),
    retainedRevisions: v.number(),
    retainedBytes: v.number(),
  }),
  handler: async (ctx, args) => {
    await authorizeContribution(ctx, args, false);
    if ((args.cursor?.length ?? 0) > 4096)
      throw new ConvexError({ code: "BATCH_PAGE_INVALID" });
    const scope = `reconcile:${args.actorUserId}:${args.kind}`;
    const cursor = readScopedCursor(args.cursor, scope);
    if (args.kind === "batches") {
      const p = await ctx.db
        .query("contributionBatches")
        .withIndex("by_actor_archived", (q) =>
          q.eq("actorUserId", args.actorUserId).eq("archived", false),
        )
        .paginate({ numItems: 40, cursor });
      return {
        cursor: writeScopedCursor(p.continueCursor, scope),
        isDone: p.isDone,
        activeRows: p.page.reduce((n, b) => n + b.rowCount, 0),
        retainedRevisions: 0,
        retainedBytes: 0,
      };
    }
    const p = await ctx.db
      .query("contributionItemRevisions")
      .withIndex("by_actor", (q) => q.eq("actorUserId", args.actorUserId))
      .paginate({ numItems: 40, cursor });
    return {
      cursor: writeScopedCursor(p.continueCursor, scope),
      isDone: p.isDone,
      activeRows: 0,
      retainedRevisions: p.page.length,
      retainedBytes: p.page.reduce((n, r) => n + r.bytes, 0),
    };
  },
});
