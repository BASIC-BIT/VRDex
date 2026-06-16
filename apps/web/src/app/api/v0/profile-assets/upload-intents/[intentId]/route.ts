import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { NextRequest, NextResponse } from "next/server";
import type { GenericId } from "convex/values";

import { api } from "@convex-generated-api";
import { convexHttpClient } from "@/lib/server/convex-http";
import { isProfileAssetStorageConfigured, putProfileAssetObject } from "@/lib/server/profile-asset-storage";

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
const PROFILE_ASSET_MIME_TYPES = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]);
const SOURCE_URL_MAX_REDIRECTS = 5;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizedContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
}

function mimeTypeForFile(file: File): string {
  const contentType = normalizedContentType(file.type);

  if (contentType !== "application/octet-stream") {
    return contentType;
  }

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }

  if (lowerName.endsWith(".png")) {
    return "image/png";
  }

  return contentType;
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

async function bodyFromFileRequest(request: NextRequest): Promise<UploadBody> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Upload requests must include a file field.");
  }

  const mimeType = mimeTypeForFile(file);
  assertAllowedMimeType(mimeType);
  assertAllowedByteSize(file.size);

  return {
    body: new Uint8Array(await file.arrayBuffer()),
    mimeType,
  };
}

function redirectLocation(response: Response, sourceUrl: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return null;
  }

  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("Source URL redirected without a Location header.");
  }

  return new URL(location, sourceUrl);
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

async function assertPublicHttpsSourceUrl(sourceUrl: URL) {
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
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address.address))) {
    throw new Error("Profile media asset imports must use public HTTPS URLs.");
  }
}

function contentLengthFromHeaders(response: Response): number | null {
  const contentLength = response.headers.get("content-length");

  if (contentLength === null) {
    return null;
  }

  const value = Number(contentLength);

  if (!Number.isSafeInteger(value)) {
    throw new Error("Source URL returned an invalid Content-Length header.");
  }

  return value;
}

async function responseBodyWithLimit(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    throw new Error("Source URL returned an empty response body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteSize += value.byteLength;

    if (byteSize > PROFILE_ASSET_UPLOAD_MAX_BYTES) {
      await reader.cancel();
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
    await assertPublicHttpsSourceUrl(currentUrl);

    const response = await fetch(currentUrl, { redirect: "manual" });
    const redirectedUrl = redirectLocation(response, currentUrl);

    if (redirectedUrl !== null) {
      currentUrl = redirectedUrl;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Source URL returned HTTP ${response.status}.`);
    }

    const mimeType = normalizedContentType(response.headers.get("content-type"));
    assertAllowedMimeType(mimeType);
    const contentLength = contentLengthFromHeaders(response);
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

  const convex = convexHttpClient();
  const intent = await convex.query(api.profileAssets.validateUploadIntentForStorage, {
    intentId: intentId as GenericId<"profileAssetUploadIntents">,
    uploadToken,
  });

  if (intent === null) {
    return errorResponse("Upload intent was not found or expired.", 404);
  }

  try {
    const upload = intent.sourceUrl
      ? await bodyFromSourceUrl(intent.sourceUrl)
      : await bodyFromFileRequest(request);

    validateUploadBody(upload);

    await putProfileAssetObject({
      storageKey: intent.storageKey,
      body: upload.body,
      contentType: upload.mimeType,
    });
    await convex.mutation(api.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken,
      mimeType: upload.mimeType,
      byteSize: upload.body.byteLength,
    });

    return NextResponse.json({
      intentId: intent.intentId,
      storageKey: intent.storageKey,
      mimeType: upload.mimeType,
      byteSize: upload.body.byteLength,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile media upload failed.";

    return errorResponse(message, 400);
  }
}
