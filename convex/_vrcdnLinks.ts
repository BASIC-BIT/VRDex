import { safeHttpsUrl } from "./_publicFields";

const vrcdnRootHost = "vrcdn.live";
const vrcdnStreamHost = "stream.vrcdn.live";
const vrcdnPanelHost = "panel.vrcdn.live";
const vrcdnAllowedProtocols = new Set(["https:", "http:", "rtspt:", "rtsp:", "rtmp:"]);
const vrcdnReservedPagePaths = new Set(["about", "api", "dashboard", "login", "panel", "privacy", "status", "terms", "wiki"]);
const vrcdnDirectVideoExtension = /\.(mp4|ogg|webm)$/i;
const vrcdnStreamExtension = /(?:\.live)?\.(m3u8|ts|mp4|ogg|webm)$/i;
const vrcdnStreamIdPattern = /^[a-zA-Z0-9_-]{2,128}$/;

export type VrcdnStreamLinks = {
  streamId: string;
  pageUrl: string;
  previewUrl: string;
  hlsUrl: string;
  questUrl: string;
  pcUrl: string;
  directVideoUrl?: string;
};

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function isVrcdnHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if ([vrcdnPanelHost, "status.vrcdn.live", "wiki.vrcdn.live"].includes(normalized)) {
    return false;
  }

  return normalized === vrcdnRootHost || normalized.endsWith(".vrcdn.live");
}

/**
 * Read a stream id out of a VRCDN panel preview URL.
 *
 * `panel.vrcdn.live` stays out of `isVrcdnHost` — the panel is VRCDN's operator
 * console, and treating the whole host as a stream reference would make
 * `/dashboard` a "VRCDN link". But `/preview/<streamId>` is a stream reference,
 * and it is what VRCDN hands people when they ask where their stream is, so it
 * is what they paste and what partner exports carry.
 *
 * It is read for its id only. Every caller here builds canonical links from
 * `createVrcdnStreamLinks`, so a pasted preview URL becomes the public
 * `vrcdn.live/<id>` page rather than being stored and published as-is.
 */
function getVrcdnPreviewStreamId(url: URL): string | null {
  if (normalizeHostname(url.hostname) !== vrcdnPanelHost) {
    return null;
  }

  const segments = cleanPathSegments(url.pathname);

  return segments[0]?.toLowerCase() === "preview" ? toVrcdnStreamId(segments[1]) : null;
}

function cleanPathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function toVrcdnStreamId(segment: string | undefined): string | null {
  if (!segment) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment).trim();
  } catch {
    decoded = segment.trim();
  }

  const streamId = decoded.replace(vrcdnStreamExtension, "").replace(/\.live$/i, "");

  return vrcdnStreamIdPattern.test(streamId) ? streamId : null;
}

function getVrcdnStreamId(url: URL): string | null {
  const hostname = normalizeHostname(url.hostname);
  const segments = cleanPathSegments(url.pathname);
  const liveIndex = segments.findIndex((segment) => segment.toLowerCase() === "live");

  if (liveIndex >= 0) {
    return toVrcdnStreamId(segments[liveIndex + 1]);
  }

  if (hostname === vrcdnRootHost) {
    const [first, second] = segments;
    const firstLower = first?.toLowerCase();

    if (firstLower === "watch" || firstLower === "embed") {
      return toVrcdnStreamId(second);
    }

    if (!first || vrcdnReservedPagePaths.has(firstLower ?? "")) {
      return null;
    }

    return toVrcdnStreamId(first);
  }

  return null;
}

export function createVrcdnStreamLinks(streamId: string, directVideoUrl?: string): VrcdnStreamLinks | null {
  const cleanStreamId = toVrcdnStreamId(streamId);

  if (!cleanStreamId) {
    return null;
  }

  return {
    streamId: cleanStreamId,
    pageUrl: `https://${vrcdnRootHost}/${cleanStreamId}`,
    previewUrl: `https://${vrcdnPanelHost}/preview/${cleanStreamId}`,
    hlsUrl: `https://${vrcdnStreamHost}/live/${cleanStreamId}.m3u8`,
    questUrl: `https://${vrcdnStreamHost}/live/${cleanStreamId}.live.ts`,
    pcUrl: `rtspt://${vrcdnStreamHost}/live/${cleanStreamId}`,
    ...(directVideoUrl === undefined ? {} : { directVideoUrl }),
  };
}

export function parseVrcdnStreamLinks(input: string): VrcdnStreamLinks | null {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (!vrcdnAllowedProtocols.has(url.protocol.toLowerCase())) {
    return null;
  }

  const previewStreamId = getVrcdnPreviewStreamId(url);

  if (previewStreamId !== null) {
    return createVrcdnStreamLinks(previewStreamId);
  }

  if (!isVrcdnHost(url.hostname)) {
    return null;
  }

  const streamId = getVrcdnStreamId(url);

  if (!streamId) {
    return null;
  }

  const directVideoUrl = url.protocol === "https:" && vrcdnDirectVideoExtension.test(url.pathname) ? url.href : undefined;

  return createVrcdnStreamLinks(streamId, directVideoUrl);
}

export function safePublicMediaUrl(url: string): string | undefined {
  const vrcdnLinks = parseVrcdnStreamLinks(url);

  return vrcdnLinks?.directVideoUrl ?? vrcdnLinks?.pageUrl ?? safeHttpsUrl(url);
}
