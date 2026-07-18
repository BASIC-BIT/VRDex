import { safeHttpsUrl } from "./_publicFields";

const vrcdnRootHost = "vrcdn.live";
const vrcdnStreamHost = "stream.vrcdn.live";
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

  if (["panel.vrcdn.live", "status.vrcdn.live", "wiki.vrcdn.live"].includes(normalized)) {
    return false;
  }

  return normalized === vrcdnRootHost || normalized.endsWith(".vrcdn.live");
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
    previewUrl: `https://panel.vrcdn.live/preview/${cleanStreamId}`,
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

  if (!vrcdnAllowedProtocols.has(url.protocol.toLowerCase()) || !isVrcdnHost(url.hostname)) {
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
