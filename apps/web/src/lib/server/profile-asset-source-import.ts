import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { PROFILE_ASSET_MAX_STORED_BYTES } from "./profile-asset-validation";

const PROFILE_ASSET_MIME_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
]);
const SOURCE_URL_MAX_REDIRECTS = 5;
const SOURCE_URL_TOTAL_TIMEOUT_MS = 30_000;

export type ProfileAssetSourceUpload = {
  body: Uint8Array;
  mimeType: string;
};

type ProfileAssetSourceImportDependencies = {
  assertSourceUrl?: (sourceUrl: URL) => void;
  resolveHostname?: (
    hostname: string,
  ) => Promise<Array<{ address: string }>>;
  requestPinnedSource?: (
    sourceUrl: URL,
    address: string,
    signal: AbortSignal,
  ) => Promise<IncomingMessage>;
  totalTimeoutMs?: number;
};

function firstHeaderValue(value: IncomingHttpHeaders[string]): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
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

  if (byteSize > PROFILE_ASSET_MAX_STORED_BYTES) {
    throw new Error("Profile media assets must be 12 MB or smaller.");
  }
}

function redirectLocation(
  statusCode: number | undefined,
  location: IncomingHttpHeaders[string],
  sourceUrl: URL,
): URL | null {
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

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
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

async function resolvePublicHttpsSourceUrl(
  sourceUrl: URL,
  resolveHostname: NonNullable<ProfileAssetSourceImportDependencies["resolveHostname"]>,
): Promise<string> {
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

  const addresses = await resolveHostname(hostname);
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

function requestPinnedSourceUrl(
  sourceUrl: URL,
  address: string,
  signal: AbortSignal,
): Promise<IncomingMessage> {
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
        signal,
      },
      resolve,
    );

    request.setTimeout(15_000, () => request.destroy(new Error("Source URL request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

function timeoutError(): Error {
  return new Error("Source URL request exceeded its total timeout.");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : timeoutError();
  }
}

async function responseBodyWithLimit(
  response: IncomingMessage,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  const abortResponse = () => response.destroy(timeoutError());

  signal.addEventListener("abort", abortResponse, { once: true });

  try {
    throwIfAborted(signal);
    for await (const chunk of response) {
      throwIfAborted(signal);
      const value = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteSize += value.byteLength;
      if (byteSize > PROFILE_ASSET_MAX_STORED_BYTES) {
        response.destroy();
        throw new Error("Profile media assets must be 12 MB or smaller.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abortResponse);
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

export async function fetchProfileAssetSourceUrl(
  sourceUrl: string,
  dependencies: ProfileAssetSourceImportDependencies = {},
): Promise<ProfileAssetSourceUpload> {
  let currentUrl = new URL(sourceUrl);
  const abortController = new AbortController();
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? SOURCE_URL_TOTAL_TIMEOUT_MS;
  const totalTimeout = setTimeout(
    () => abortController.abort(timeoutError()),
    totalTimeoutMs,
  );
  const resolveHostname = dependencies.resolveHostname ?? (
    async (hostname: string) => await lookup(hostname, { all: true, verbatim: true })
  );
  const requestSource = dependencies.requestPinnedSource ?? requestPinnedSourceUrl;

  try {
    for (let redirects = 0; redirects <= SOURCE_URL_MAX_REDIRECTS; redirects += 1) {
      throwIfAborted(abortController.signal);
      dependencies.assertSourceUrl?.(currentUrl);
      const address = await resolvePublicHttpsSourceUrl(currentUrl, resolveHostname);
      throwIfAborted(abortController.signal);
      const response = await requestSource(currentUrl, address, abortController.signal);
      throwIfAborted(abortController.signal);
      const redirectedUrl = redirectLocation(
        response.statusCode,
        response.headers.location,
        currentUrl,
      );

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
      const contentLength = contentLengthFromHeader(
        firstHeaderValue(response.headers["content-length"]),
      );
      if (contentLength !== null) {
        assertAllowedByteSize(contentLength);
      }

      return {
        body: await responseBodyWithLimit(response, abortController.signal),
        mimeType,
      };
    }

    throw new Error("Source URL redirected too many times.");
  } finally {
    clearTimeout(totalTimeout);
  }
}
