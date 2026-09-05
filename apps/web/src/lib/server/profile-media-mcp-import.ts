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
import { assertMcpContributionSourceRedirect } from "@vrdex/api-contracts";
import {
  PROFILE_ASSET_MAX_STORED_BYTES,
  validateAndPrepareProfileAsset,
} from "./profile-asset-validation";

export class McpProfileMediaImportError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "indeterminate",
    readonly code = "MCP_MEDIA_IMPORT_REJECTED",
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

function contributionValidationFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("already proposed") || message.includes("duplicate")) {
    return "MCP_MEDIA_IMPORT_DUPLICATE";
  }
  if (message.includes("12 mb") || message.includes("too large") || message.includes("oversized")) {
    return "MCP_MEDIA_IMPORT_OVERSIZED";
  }
  if (message.includes("scripts") || message.includes("external references") || message.includes("unsafe")) {
    return "MCP_MEDIA_IMPORT_UNSAFE";
  }
  if (
    message.includes("supported png")
    || message.includes("must be png, svg, jpeg, or webp")
    || message.includes("valid, still image")
    || message.includes("dimensions")
    || message.includes("width and height")
    || message.includes("svg root element")
    || message.includes("pixels or smaller")
    || message.includes("not a supported png")
    || message.includes("contents do not match")
  ) {
    return "MCP_MEDIA_IMPORT_UNSUPPORTED";
  }
  return "MCP_MEDIA_IMPORT_REJECTED";
}

async function fetchContributionSource(
  fetchSource: typeof fetchProfileAssetSourceUrl,
  sourceUrl: string,
) {
  try {
    return await fetchSource(sourceUrl, {
      assertSourceUrl: (target) => assertMcpContributionSourceRedirect(sourceUrl, target),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile media source fetch failed.";
    const normalized = message.toLowerCase();
    const code = normalized.includes("12 mb") || normalized.includes("too large")
      ? "MCP_MEDIA_IMPORT_OVERSIZED"
      : normalized.includes("must be png, svg, jpeg, or webp")
        ? "MCP_MEDIA_IMPORT_UNSUPPORTED"
        : "MCP_MEDIA_IMPORT_UNREACHABLE";
    // A source can contain a temporary bearer signature. Keep transport error
    // details out of errors that callers or logging might expose.
    throw new McpProfileMediaImportError("Profile media source fetch failed.", "rejected", code);
  }
}

async function prepareContributionAsset(
  prepareAsset: typeof validateAndPrepareProfileAsset,
  body: Uint8Array,
  mimeType: string,
) {
  try {
    return await prepareAsset(body, mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile media validation failed.";
    throw new McpProfileMediaImportError(
      message,
      "rejected",
      contributionValidationFailureCode(error),
    );
  }
}

/**
 * Import one public image into the reviewed community-proposal lifecycle.
 *
 * This deliberately uses contribution-specific Convex functions. The owner
 * importer above may create a public asset during finalization; this path may
 * only move a private submission from upload_pending to submitted.
 */
export async function completeMcpProfileMediaSubmissionImport(
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

  const processingToken = randomUUID();
  const claim = await adminConvex.mutation(
    internal.profileMediaSubmissions.claimMcpMediaSubmissionImport,
    { intentId, processingToken },
  );
  if (claim.status === "not_found") {
    throw new McpProfileMediaImportError(
      "Profile media submission import is expired or unavailable.",
      "rejected",
    );
  }
  if (claim.status === "in_use") {
    throw new McpProfileMediaImportError(
      "Profile media submission import is already processing.",
      "indeterminate",
    );
  }
  if (claim.status === "rejected") {
    throw new McpProfileMediaImportError(claim.errorCode, "rejected", claim.errorCode);
  }

  if (!isStorageConfigured()) {
    const failureRecorded = await adminConvex
      .mutation(internal.profileMediaSubmissions.failMcpMediaSubmissionImport, {
        intentId: claim.intentId,
        processingToken,
        errorCode: "MCP_MEDIA_STORAGE_UNAVAILABLE",
      })
      .catch(() => false);
    throw new McpProfileMediaImportError(
      "Profile asset storage is not configured.",
      failureRecorded ? "rejected" : "indeterminate",
      "MCP_MEDIA_STORAGE_UNAVAILABLE",
    );
  }

  let finalizationAttempted = false;
  const storageKeys = [
    ...(claim.sourceStorageKey === undefined ? [] : [claim.sourceStorageKey]),
    ...(claim.downloadStorageKey === undefined ? [] : [claim.downloadStorageKey]),
    claim.storageKey,
  ];

  try {
    const upload = await fetchContributionSource(fetchSource, claim.sourceUrl);
    const prepared = await prepareContributionAsset(prepareAsset, upload.body, upload.mimeType);
    assertPreparedSize(prepared.source.body.byteLength);
    assertPreparedSize(prepared.download.body.byteLength);
    assertPreparedSize(prepared.display.body.byteLength);

    const duplicate = await adminConvex.query(
      internal.profileMediaSubmissions.hasDuplicateMcpMediaSubmissionImport,
      {
        intentId: claim.intentId,
        processingToken,
        contentSha256: prepared.download.contentSha256,
      },
    );
    if (duplicate) {
      throw new Error("This image was already proposed for the profile.");
    }

    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Profile media storage write failed.";
      throw new McpProfileMediaImportError(
        message,
        "rejected",
        "MCP_MEDIA_STORAGE_WRITE_FAILED",
      );
    }

    finalizationAttempted = true;
    const submission = await adminConvex.mutation(
      internal.profileMediaSubmissions.markMcpMediaSubmissionImported,
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
    return { replayed: false as const, submission };
  } catch (error) {
    const convexApplicationError = isConvexApplicationError(error);
    if (finalizationAttempted) {
      const state = await adminConvex
        .query(internal.profileMediaSubmissions.getMcpMediaSubmissionImportState, {
          intentId: claim.intentId,
          processingToken,
        })
        .catch(() => null);
      if (
        state !== null &&
        state.failureCode === undefined &&
        state.intentState === "uploaded" &&
        state.submission.status !== "upload_pending"
      ) {
        return { replayed: true as const, submission: state.submission };
      }
      if (state?.failureCode !== undefined) {
        throw new McpProfileMediaImportError(
          state.failureCode,
          "rejected",
          state.failureCode,
        );
      }
      if (state === null || !state.leaseMatches || !convexApplicationError) {
        const message = error instanceof Error
          ? error.message
          : "Profile media submission finalization is uncertain.";
        throw new McpProfileMediaImportError(message, "indeterminate");
      }
    }

    const applicationCode = error instanceof McpProfileMediaImportError
      ? error.code
      : convexApplicationError
      && typeof error === "object"
      && error !== null
      && "data" in error
      && typeof error.data === "object"
      && error.data !== null
      && "code" in error.data
      && typeof error.data.code === "string"
      ? error.data.code
      : contributionValidationFailureCode(error);
    const failureRecorded = await adminConvex
      .mutation(internal.profileMediaSubmissions.failMcpMediaSubmissionImport, {
        intentId: claim.intentId,
        processingToken,
        errorCode: applicationCode,
      })
      .catch(() => false);
    if (!failureRecorded) {
      const message = error instanceof Error
        ? error.message
        : "Profile media submission state is uncertain.";
      throw new McpProfileMediaImportError(message, "indeterminate");
    }
    await deleteObjects(storageKeys).catch(() => undefined);

    const message = error instanceof Error ? error.message : "Profile media import failed.";
    throw new McpProfileMediaImportError(message, "rejected", applicationCode);
  }
}
