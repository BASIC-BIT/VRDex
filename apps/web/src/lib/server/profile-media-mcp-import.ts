import { randomUUID } from "node:crypto";

import { ConvexError } from "convex/values";

import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import { convexAdminHttpClient } from "./convex-http";
import {
  deleteProfileAssetObjects,
  isProfileAssetStorageConfigured,
  putProfileAssetObject,
  shouldCleanupFailedProfileAssetUpload,
  shouldInspectFailedProfileAssetUpload,
} from "./profile-asset-storage";
import { fetchProfileAssetSourceUrl } from "./profile-asset-source-import";
import {
  PROFILE_ASSET_MAX_STORED_BYTES,
  validateAndPrepareProfileAsset,
} from "./profile-asset-validation";

export class McpProfileMediaImportError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "indeterminate",
  ) {
    super(message);
    this.name = "McpProfileMediaImportError";
  }
}

type McpProfileMediaImportDependencies = {
  adminConvex?: Pick<ReturnType<typeof convexAdminHttpClient>, "mutation" | "query">;
  deleteObjects?: typeof deleteProfileAssetObjects;
  fetchSource?: typeof fetchProfileAssetSourceUrl;
  isStorageConfigured?: typeof isProfileAssetStorageConfigured;
  prepareAsset?: typeof validateAndPrepareProfileAsset;
  putObject?: typeof putProfileAssetObject;
};

function assertPreparedSize(byteSize: number) {
  if (byteSize <= 0 || byteSize > PROFILE_ASSET_MAX_STORED_BYTES) {
    throw new Error("Profile media assets must be 12 MB or smaller.");
  }
}

function isConvexApplicationError(error: unknown) {
  return (
    error instanceof ConvexError ||
    (typeof error === "object" && error !== null && "data" in error)
  );
}

/**
 * Complete a hosted MCP source import without exposing the upload token.
 *
 * The caller receives only asset ids. Source URL, storage keys, processing
 * lease, and every upload credential remain inside this server-only function
 * and the internal Convex boundary.
 */
export async function completeMcpProfileMediaImport(
  intentId: Id<"profileAssetUploadIntents">,
  dependencies: McpProfileMediaImportDependencies = {},
) {
  const adminConvex = dependencies.adminConvex ?? convexAdminHttpClient();
  const deleteObjects = dependencies.deleteObjects ?? deleteProfileAssetObjects;
  const fetchSource = dependencies.fetchSource ?? fetchProfileAssetSourceUrl;
  const isStorageConfigured =
    dependencies.isStorageConfigured ?? isProfileAssetStorageConfigured;
  const prepareAsset = dependencies.prepareAsset ?? validateAndPrepareProfileAsset;
  const putObject = dependencies.putObject ?? putProfileAssetObject;

  if (!isStorageConfigured()) {
    throw new Error("Profile asset storage is not configured.");
  }

  const processingToken = randomUUID();
  const claim = await adminConvex.mutation(
    internal.profileAssets.claimMcpImportIntentForStorage,
    { intentId, processingToken },
  );

  if (claim.status === "not_found") {
    throw new Error("Profile media import is expired or unavailable.");
  }
  if (claim.status === "in_use") {
    throw new Error("Profile media import is already processing.");
  }

  let finalizationAttempted = false;

  try {
    const upload = await fetchSource(claim.sourceUrl!);
    const prepared = await prepareAsset(upload.body, upload.mimeType);
    assertPreparedSize(prepared.source.body.byteLength);
    assertPreparedSize(prepared.download.body.byteLength);
    assertPreparedSize(prepared.display.body.byteLength);

    const duplicate = await adminConvex.query(
      internal.profileAssets.hasDuplicateAssetForMcpImport,
      {
        intentId: claim.intentId,
        processingToken,
        contentSha256: prepared.download.contentSha256,
      },
    );
    if (duplicate) {
      throw new Error("This image already exists in the profile media kit.");
    }

    if (claim.sourceStorageKey !== undefined) {
      await putObject({
        storageKey: claim.sourceStorageKey,
        body: prepared.source.body,
        contentType: prepared.source.mimeType,
        cacheControl: "private, no-store",
      });
    }
    if (claim.downloadStorageKey !== undefined) {
      await putObject({
        storageKey: claim.downloadStorageKey,
        body: prepared.download.body,
        contentType: prepared.download.mimeType,
      });
    }
    await putObject({
      storageKey: claim.storageKey,
      body: prepared.display.body,
      contentType: prepared.display.mimeType,
    });

    finalizationAttempted = true;
    const completed = await adminConvex.mutation(
      internal.profileAssets.markMcpImportIntentUploaded,
      {
        intentId: claim.intentId,
        processingToken,
        mimeType: prepared.display.mimeType,
        byteSize: prepared.display.body.byteLength,
        contentSha256: prepared.download.contentSha256,
        width: prepared.display.width,
        height: prepared.display.height,
        ...(claim.sourceStorageKey === undefined
          ? {}
          : {
              sourceMimeType: prepared.source.mimeType,
              sourceByteSize: prepared.source.body.byteLength,
              sourceContentSha256: prepared.source.contentSha256,
            }),
        ...(claim.downloadStorageKey === undefined
          ? {}
          : {
              downloadMimeType: prepared.download.mimeType,
              downloadByteSize: prepared.download.body.byteLength,
              downloadContentSha256: prepared.download.contentSha256,
            }),
      },
    );

    return { assetIds: completed.assetIds };
  } catch (error) {
    const convexApplicationError = isConvexApplicationError(error);
    if (shouldInspectFailedProfileAssetUpload(finalizationAttempted, convexApplicationError)) {
      const cleanupState = await adminConvex
        .query(internal.profileAssets.getMcpImportIntentStateForStorageCleanup, {
          intentId: claim.intentId,
          processingToken,
        })
        .catch(() => null);
      if (shouldCleanupFailedProfileAssetUpload(cleanupState)) {
        await deleteObjects([
          ...(claim.sourceStorageKey === undefined ? [] : [claim.sourceStorageKey]),
          ...(claim.downloadStorageKey === undefined ? [] : [claim.downloadStorageKey]),
          claim.storageKey,
        ]).catch(() => undefined);
        await adminConvex
          .mutation(internal.profileAssets.releaseMcpImportIntentStorageClaim, {
            intentId: claim.intentId,
            processingToken,
          })
          .catch(() => false);
      }
    }

    if (convexApplicationError) {
      throw error;
    }

    const message = error instanceof Error
      ? error.message
      : "Profile media import failed.";
    throw new McpProfileMediaImportError(
      message,
      finalizationAttempted ? "indeterminate" : "rejected",
    );
  }
}
