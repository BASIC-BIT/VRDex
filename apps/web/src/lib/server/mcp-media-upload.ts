import { randomUUID } from "node:crypto";
import {
  localUploadRequestSchema,
  localUploadCompleteSchema,
  localUploadTargetSchema,
  commandReceiptSchema,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexAdminHttpClient } from "./convex-http";
import {
  createProfileAssetDirectUploadTarget,
  getProfileAssetObject,
  putProfileAssetObject,
  profileAssetUploadChecksum,
} from "./profile-asset-storage";
import { validateAndPrepareProfileAsset } from "./profile-asset-validation";
import { fetchProfileAssetSourceUrl } from "./profile-asset-source-import";

type Authority = {
  actorUserId: Id<"users">;
  oauthClientId: string;
  oauthTokenId: string;
  emailVerified: boolean;
  emailVerificationAttestedAt: number;
};
export type LocalUploadDependencies = {
  authority: () => Promise<Authority>;
  admin?: Pick<ReturnType<typeof convexAdminHttpClient>, "mutation">;
  target?: typeof createProfileAssetDirectUploadTarget;
  read?: typeof getProfileAssetObject;
  put?: typeof putProfileAssetObject;
  prepare?: typeof validateAndPrepareProfileAsset;
  fetchSource?: typeof fetchProfileAssetSourceUrl;
};
export function assertLocalUploadCandidate(
  object: {
    body: Uint8Array;
    contentType: string;
    contentLength?: number;
  } | null,
  declaration: { byteLength: number; contentType: string; sha256: string },
) {
  if (
    !object ||
    object.body.byteLength !== declaration.byteLength ||
    (object.contentLength !== undefined &&
      object.contentLength !== declaration.byteLength) ||
    object.contentType !== declaration.contentType ||
    profileAssetUploadChecksum(object.body) !== declaration.sha256
  )
    throw new Error("UPLOAD_SOURCE_MISMATCH");
  return object;
}
export function createMcpMediaUploadHandlers(deps: LocalUploadDependencies) {
  const admin = () => deps.admin ?? convexAdminHttpClient();
  const handlers = {
    async importUrl(input: unknown) {
      const request = localUploadRequestSchema.parse(input);
      if (!request.sourceUrl) throw new Error("UPLOAD_SOURCE_REQUIRED");
      const admitted = await admin().mutation(
        internal.contributionUploads.begin,
        {
          ...request,
          profileId: request.profileId as Id<"profiles">,
          ...(await deps.authority()),
        },
      );
      // Reserve bounded capacity before any remote acquisition. Digest and size
      // must match the staged revision, exactly as for a local transfer.
      const source = await (deps.fetchSource ?? fetchProfileAssetSourceUrl)(
        request.sourceUrl,
      );
      assertLocalUploadCandidate(
        { body: source.body, contentType: source.mimeType },
        request,
      );
      await (deps.put ?? putProfileAssetObject)({
        storageKey: admitted.quarantineStorageKey,
        body: source.body,
        contentType: source.mimeType,
        cacheControl: "private, no-store",
      });
      return handlers.complete({
        intentId: admitted.intentId,
        idempotencyKey: request.idempotencyKey,
      });
    },
    async begin(input: unknown) {
      const request = localUploadRequestSchema.parse(input);
      const admitted = await admin().mutation(
        internal.contributionUploads.begin,
        {
          ...request,
          profileId: request.profileId as Id<"profiles">,
          ...(await deps.authority()),
        },
      );
      const transfer = await (
        deps.target ?? createProfileAssetDirectUploadTarget
      )({
        storageKey: admitted.quarantineStorageKey,
        contentType: admitted.contentType,
        byteSize: admitted.byteLength,
        expiresAt: admitted.expiresAt,
      });
      return localUploadTargetSchema.parse({
        intentId: admitted.intentId,
        expiresAt: admitted.expiresAt,
        transfer: {
          method: "POST",
          url: transfer.url,
          fields: transfer.fields,
          fileField: "file",
        },
      });
    },
    async complete(input: unknown) {
      const request = localUploadCompleteSchema.parse(input);
      const intentId = request.intentId as Id<"profileAssetUploadIntents">;
      const processingToken = randomUUID();
      const claim = await admin().mutation(internal.contributionUploads.claim, {
        ...request,
        intentId,
        processingToken,
        ...(await deps.authority()),
      });
      if ("receipt" in claim) return commandReceiptSchema.parse(claim.receipt);
      let committing = false;
      try {
        // One read, bound to the digest supplied before the transfer capability existed.
        const candidate = assertLocalUploadCandidate(
          await (deps.read ?? getProfileAssetObject)(
            claim.quarantineStorageKey,
          ),
          claim,
        );
        const prepared = await (deps.prepare ?? validateAndPrepareProfileAsset)(
          candidate.body,
          candidate.contentType,
        );
        for (const part of [
          prepared.source,
          prepared.download,
          prepared.display,
        ]) {
          if (
            part.body.byteLength < 1 ||
            part.body.byteLength > 12 * 1024 * 1024
          )
            throw new Error("UPLOAD_RESERVATION_EXCEEDED");
        }
        const put = deps.put ?? putProfileAssetObject;
        await put({
          storageKey: claim.sourceStorageKey,
          body: prepared.source.body,
          contentType: prepared.source.mimeType,
          cacheControl: "private, no-store",
        });
        await put({
          storageKey: claim.downloadStorageKey,
          body: prepared.download.body,
          contentType: prepared.download.mimeType,
          cacheControl: "private, no-store",
        });
        await put({
          storageKey: claim.storageKey,
          body: prepared.display.body,
          contentType: prepared.display.mimeType,
          cacheControl: "private, no-store",
        });
        // Verify fresh OAuth, actor and target again inside the commit transaction.
        const authority = await deps.authority();
        committing = true;
        return commandReceiptSchema.parse(
          await admin().mutation(internal.contributionUploads.complete, {
            intentId,
            idempotencyKey: request.idempotencyKey,
            processingToken,
            ...authority,
            mimeType: prepared.display.mimeType,
            byteSize: prepared.display.body.byteLength,
            contentSha256: prepared.download.contentSha256,
            width: prepared.display.width,
            height: prepared.display.height,
            sourceMimeType: prepared.source.mimeType,
            sourceByteSize: prepared.source.body.byteLength,
            sourceContentSha256: prepared.source.contentSha256,
            downloadMimeType: prepared.download.mimeType,
            downloadByteSize: prepared.download.body.byteLength,
            downloadContentSha256: prepared.download.contentSha256,
          }),
        );
      } catch {
        // Transactional failure preserves an already-committed receipt. If it wins
        // against an in-flight commit, that commit observes the refusal receipt.
        // Release concurrency while keeping partial writes charged until deletion.
        await admin()
          .mutation(internal.contributionUploads.fail, {
            intentId,
            processingToken,
          })
          .catch(() => null);
        throw new Error(
          committing
            ? "UPLOAD_COMPLETION_UNCERTAIN"
            : "UPLOAD_VALIDATION_FAILED",
        );
      }
    },
  };
  return handlers;
}
