import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { NextRequest, NextResponse } from "next/server";
import type { GenericId } from "convex/values";

import { ApiProfileAssetUploadIntentCompleteResponseSchema } from "@vrdex/api-contracts";
import { api, internal } from "@convex-generated-api";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import { isProfileAssetStorageConfigured, putProfileAssetObject } from "@/lib/server/profile-asset-storage";
import {
  profileAssetMimeTypeForFile,
  validateAndNormalizeProfileAsset,
} from "@/lib/server/profile-asset-validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

type UploadBody = {
  body: Uint8Array;
  mimeType: string;
};

const PROFILE_ASSET_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const FILE_UPLOAD_REQUEST_MAX_BYTES = PROFILE_ASSET_UPLOAD_MAX_BYTES + 64 * 1024;
const PROFILE_ASSET_MIME_TYPES = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]);
const SOURCE_URL_MAX_REDIRECTS = 5;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizedContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
}

function assertAllowedMimeType(mimeType: string) {
  if (!PROFILE_ASSET_MIME_TYPES.has(mimeType)) {
    throw new Error("Profile media assets must be PNG, SVG, JPEG, or WebP images.");
  }
}

function assertAllowedByteSize(byteSize: number) {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error("Profile media assets must include a positive byte size.");
  }

  if (byteSize > PROFILE_ASSET_UPLOAD_MAX_BYTES) {
    throw new Error("Profile media assets must be 12 MB or smaller.");
  }
}

function validateUploadBody(upload: UploadBody) {
  assertAllowedMimeType(upload.mimeType);
  assertAllowedByteSize(upload.body.byteLength);
}

function requestContentLength(request: NextRequest): number | null {
  const header = request.headers.get("content-length");

  if (header === null) {
    return null;
  }

  const value = Number(header);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Upload request included an invalid Content-Length header.");
  }

  return value;
}

async function requestBodyWithLimit(request: NextRequest): Promise<Uint8Array> {
  const contentLength = requestContentLength(request);

  if (contentLength !== null && contentLength > FILE_UPLOAD_REQUEST_MAX_BYTES) {
    throw new Error("Profile media upload requests are too large.");
  }

  if (request.body === null) {
    throw new Error("Upload requests must include a file field.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteSize += value.byteLength;

    if (byteSize > FILE_UPLOAD_REQUEST_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Profile media upload requests are too large.");
    }

    chunks.push(value);
  }

  const body = new Uint8Array(byteSize);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function bodyFromFileRequest(request: NextRequest): Promise<UploadBody> {
  const requestBody = await requestBodyWithLimit(request);
  const headers = new Headers(request.headers);
  const body = requestBody.buffer.slice(
    requestBody.byteOffset,
    requestBody.byteOffset + requestBody.byteLength,
  ) as ArrayBuffer;
  headers.delete("content-length");

  const formData = await new Request(request.url, {
    body,
    headers,
    method: request.method,
  }).formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Upload requests must include a file field.");
  }

  const mimeType = profileAssetMimeTypeForFile(file.type, file.name);
  assertAllowedMimeType(mimeType);
  assertAllowedByteSize(file.size);

  return {
    body: new Uint8Array(await file.arrayBuffer()),
    mimeType,
  };
}

function firstHeaderValue(value: IncomingHttpHeaders[string]): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function redirectLocation(statusCode: number | undefined, location: IncomingHttpHeaders[string], sourceUrl: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(statusCode ?? 0)) {
    return null;
  }

  const nextLocation = firstHeaderValue(location);
  if (nextLocation === null) {
    throw new Error("Source URL redirected without a Location header.");
  }

  return new URL(nextLocation, sourceUrl);
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts;
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address);

  if (parts === null) {
    return true;
  }

  const [a, b, c] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function hexPart(address: string, index: number): number {
  return Number.parseInt(address.split(":")[index] || "0", 16);
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  const mappedPrefix = "::ffff:";

  if (normalized.startsWith(mappedPrefix)) {
    return isPrivateIpv4(normalized.slice(mappedPrefix.length));
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const first = hexPart(normalized, 0);
  const second = hexPart(normalized, 1);
  const third = hexPart(normalized, 2);

  return (
    first === 0 ||
    first === 0x100 ||
    first === 0x2002 ||
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xfec0 && first <= 0xfeff) ||
    (first >= 0xff00 && first <= 0xffff) ||
    (first === 0x64 && second === 0xff9b && third === 0x1) ||
    (first === 0x2001 && second === 0xdb8)
  );
}

function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const version = isIP(normalized);

  if (version === 4) {
    return !isPrivateIpv4(normalized);
  }

  if (version === 6) {
    return !isPrivateIpv6(normalized);
  }

  return false;
}

async function resolvePublicHttpsSourceUrl(sourceUrl: URL): Promise<string> {
  if (sourceUrl.protocol !== "https:") {
    throw new Error("Profile media asset imports must use HTTPS URLs.");
  }

  if (sourceUrl.username || sourceUrl.password) {
    throw new Error("Profile media asset imports must not include URL credentials.");
  }

  if (sourceUrl.port && sourceUrl.port !== "443") {
    throw new Error("Profile media asset imports must use the default HTTPS port.");
  }

  const hostname = sourceUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Profile media asset imports must use public HTTPS URLs.");
  }

  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error("Profile media asset imports must use public HTTPS URLs.");
    }
    return hostname;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address.address))) {
    throw new Error("Profile media asset imports must use public HTTPS URLs.");
  }

  return addresses[0]!.address;
}

function contentLengthFromHeader(contentLength: string | null): number | null {
  if (contentLength === null) {
    return null;
  }

  const value = Number(contentLength);

  if (!Number.isSafeInteger(value)) {
    throw new Error("Source URL returned an invalid Content-Length header.");
  }

  return value;
}

function requestPinnedSourceUrl(sourceUrl: URL, address: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: address,
        method: "GET",
        path: `${sourceUrl.pathname}${sourceUrl.search}`,
        port: 443,
        servername: sourceUrl.hostname.replace(/^\[|\]$/g, ""),
        headers: {
          Host: sourceUrl.host,
          "User-Agent": "VRDex profile media importer",
        },
      },
      resolve,
    );

    request.setTimeout(15_000, () => request.destroy(new Error("Source URL request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function responseBodyWithLimit(response: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteSize = 0;

  for await (const chunk of response) {
    const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

    byteSize += value.byteLength;

    if (byteSize > PROFILE_ASSET_UPLOAD_MAX_BYTES) {
      response.destroy();
      throw new Error("Profile media assets must be 12 MB or smaller.");
    }

    chunks.push(value);
  }

  assertAllowedByteSize(byteSize);

  const body = new Uint8Array(byteSize);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function bodyFromSourceUrl(sourceUrl: string): Promise<UploadBody> {
  let currentUrl = new URL(sourceUrl);

  for (let redirects = 0; redirects <= SOURCE_URL_MAX_REDIRECTS; redirects += 1) {
    const address = await resolvePublicHttpsSourceUrl(currentUrl);
    const response = await requestPinnedSourceUrl(currentUrl, address);
    const redirectedUrl = redirectLocation(response.statusCode, response.headers.location, currentUrl);

    if (redirectedUrl !== null) {
      response.resume();
      currentUrl = redirectedUrl;
      continue;
    }

    if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
      response.resume();
      throw new Error(`Source URL returned HTTP ${response.statusCode ?? 0}.`);
    }

    const mimeType = normalizedContentType(firstHeaderValue(response.headers["content-type"]));
    assertAllowedMimeType(mimeType);
    const contentLength = contentLengthFromHeader(firstHeaderValue(response.headers["content-length"]));
    if (contentLength !== null) {
      assertAllowedByteSize(contentLength);
    }

    return {
      body: await responseBodyWithLimit(response),
      mimeType,
    };
  }

  throw new Error("Source URL redirected too many times.");
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isProfileAssetStorageConfigured()) {
    return errorResponse("Profile asset storage is not configured.", 501);
  }

  const { intentId } = await context.params;
  const uploadToken = request.headers.get("x-vrdex-upload-token")?.trim();

  if (!uploadToken) {
    return errorResponse("Upload token is required.", 403);
  }

  const processingToken = crypto.randomUUID();
  const intent = await convexAdminHttpClient().mutation(internal.profileAssets.claimUploadIntentForStorage, {
    intentId: intentId as GenericId<"profileAssetUploadIntents">,
    uploadToken,
    processingToken,
  });

  if (intent === null) {
    return errorResponse("Upload intent was not found, expired, or already in use.", 409);
  }

  let objectWritten = false;
  try {
    const upload = intent.sourceUrl
      ? await bodyFromSourceUrl(intent.sourceUrl)
      : await bodyFromFileRequest(request);

    validateUploadBody(upload);
    const normalized = await validateAndNormalizeProfileAsset(upload.body, intent.mimeType);
    assertAllowedByteSize(normalized.body.byteLength);
    const duplicate = await convexHttpClient().query(api.profileAssets.hasDuplicateAssetForUpload, {
      intentId: intent.intentId,
      uploadToken,
      contentSha256: normalized.contentSha256,
    });
    if (duplicate) {
      throw new Error("This image already exists in the profile media kit.");
    }

    await putProfileAssetObject({
      storageKey: intent.storageKey,
      body: normalized.body,
      contentType: normalized.mimeType,
    });
    objectWritten = true;
    const completed = await convexAdminHttpClient().mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken,
      processingToken,
      mimeType: normalized.mimeType,
      byteSize: normalized.body.byteLength,
      contentSha256: normalized.contentSha256,
      width: normalized.width,
      height: normalized.height,
    });

    const responseBody = ApiProfileAssetUploadIntentCompleteResponseSchema.parse({
      intentId: intent.intentId,
      storageKey: intent.storageKey,
      mimeType: normalized.mimeType,
      byteSize: normalized.body.byteLength,
      assetIds: completed.assetIds,
    });

    return NextResponse.json(responseBody);
  } catch (error) {
    if (!objectWritten) {
      await convexAdminHttpClient().mutation(internal.profileAssets.releaseUploadIntentStorageClaim, {
        intentId: intent.intentId,
        uploadToken,
        processingToken,
      }).catch(() => false);
    }
    const message = error instanceof Error ? error.message : "Profile media upload failed.";

    return errorResponse(message, 400);
  }
}
