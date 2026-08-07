import { safeHttpsUrl } from "./_publicFields";

const vrcdnRootHost = "vrcdn.live";
const vrcdnStreamHost = "stream.vrcdn.live";
const vrcdnPanelHost = "panel.vrcdn.live";
const vrcdnAllowedProtocols = new Set(["https:", "http:", "rtspt:", "rtsp:", "rtmp:", "vrcdn:"]);
const vrcdnReservedPagePaths = new Set(["about", "api", "dashboard", "login", "panel", "privacy", "status", "terms", "wiki"]);
const vrcdnDirectVideoExtension = /\.(mp4|ogg|webm)$/i;
const vrcdnStreamExtension = /(?:\.live)?\.(m3u8|ts|mp4|ogg|webm)$/i;
const vrcdnStreamIdPattern = /^[a-zA-Z0-9_-]{2,128}$/;

export const VRCDN_REFERENCE_PROTOCOL = "vrcdn:";

export type VrcdnStreamLinks = {
  streamId: string;
  /**
   * What a VRCDN stream is stored and compared as.
   *
   * `vrcdn:<streamId>`, not a URL, because VRCDN publishes no page for a stream.
   * It is a CDN: the id resolves to playback endpoints a VRChat world consumes,
   * and the only pages on the host are the operator panel and the wiki. This was
   * a `pageUrl` of `https://vrcdn.live/<streamId>`, which was invented -- it has
   * the shape of an address and answers 404, and it reached several hundred
   * published profiles before anyone opened one.
   *
   * A scheme rather than a bare id, so it round-trips through everything that
   * expects to parse a link, and so the spellings of one stream collapse on the
   * identifier rather than on a host and path that never meant anything.
   */
  reference: string;
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

  if (segments[0]?.toLowerCase() !== "preview") {
    return null;
  }

  // Reserved names are refused by `toVrcdnStreamId` for every route into it, so
  // `/preview/dashboard` cannot canonicalize to `vrcdn.live/dashboard` here
  // either.
  return toVrcdnStreamId(segments[1]);
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

  // Reserved names are refused here rather than at each parse site, because
  // every one of them ends up building the same canonical `vrcdn.live/<id>`
  // page link. Checking only the paths where a reserved name looks likely left
  // `stream.vrcdn.live/live/dashboard.m3u8` and `rtspt://stream.vrcdn.live/live/login`
  // rebuilt as links to VRCDN's own product pages -- the same publishable
  // not-a-stream the root-host check already refused, arriving by another route.
  //
  // Nothing legitimate is lost: VRCDN reserves these paths, so no stream can
  // carry one as its id.
  return vrcdnStreamIdPattern.test(streamId) && !vrcdnReservedPagePaths.has(streamId.toLowerCase())
    ? streamId
    : null;
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

    // Reserved names fall out in `toVrcdnStreamId`, which every route into a
    // stream id passes through.
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
    reference: `${VRCDN_REFERENCE_PROTOCOL}${cleanStreamId}`,
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

  // The stored form, read straight back. `new URL("vrcdn:buki")` puts the id in
  // `pathname` with no host, so there is nothing to resolve and nothing to
  // normalize -- which is the point of storing the identifier rather than a
  // fabricated address for it.
  if (url.protocol.toLowerCase() === VRCDN_REFERENCE_PROTOCOL) {
    return createVrcdnStreamLinks(url.pathname);
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

  // The reference rather than a page, for the same reason the reference is what
  // gets stored. Every surface that shows a VRCDN stream parses this back and
  // builds the endpoint it needs -- the event watch surface embeds `hlsUrl`, the
  // profile page offers `questUrl` and `pcUrl` to copy -- so handing them an
  // address that answers 404 helped none of them and published a dead link.
  return vrcdnLinks?.directVideoUrl ?? vrcdnLinks?.reference ?? safeHttpsUrl(url);
}
