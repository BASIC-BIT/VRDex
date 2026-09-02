import sharp from "sharp";

import { PROFILE_ASSET_MAX_STORED_BYTES } from "../profile-asset-limits";
import { publicSiteUrl } from "../public-site-url";
import { fetchProfileAssetSourceUrl } from "./profile-asset-source-import";
import { validateAndNormalizeProfileAsset } from "./profile-asset-validation";

const fixtureAssetPath = /^\/api\/e2e\/fixture-assets\/[^/]+$/;
const eventShareImagePath = /^\/[^/]+\/events\/[^/]+\/opengraph-image\/?$/;
const artworkBounds = { height: 574, width: 414 } as const;

export type EventShareArtworkSource = {
  kind: "fixture" | "remote";
  url: URL;
};

export function canRasterizeEventShareArtwork(
  source: EventShareArtworkSource,
  mimeType: string,
): boolean {
  return source.kind === "fixture" || mimeType !== "image/svg+xml";
}

export function isEventShareImageUrl(url: URL): boolean {
  try {
    return eventShareImagePath.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

export function eventShareArtworkSource(
  imageUrl: string,
  siteUrl: URL,
): EventShareArtworkSource | null {
  try {
    const url = new URL(imageUrl, siteUrl);

    if (url.username !== "" || url.password !== "") {
      return null;
    }

    if (isEventShareImageUrl(url)) {
      return null;
    }

    if (url.origin === siteUrl.origin && fixtureAssetPath.test(url.pathname)) {
      return { kind: "fixture", url };
    }

    const absoluteUrl = new URL(imageUrl);

    if (
      absoluteUrl.protocol !== "https:" ||
      absoluteUrl.username !== "" ||
      absoluteUrl.password !== ""
    ) {
      return null;
    }

    return { kind: "remote", url: absoluteUrl };
  } catch {
    return null;
  }
}

async function fetchFixtureArtwork(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
  });
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();

  if (!response.ok || !mimeType) {
    throw new Error("Event share artwork fixture was unavailable.");
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > PROFILE_ASSET_MAX_STORED_BYTES) {
    throw new Error("Event share artwork fixture size was invalid.");
  }

  return { body, mimeType };
}

export async function inlineEventShareArtwork(
  imageUrl: string | undefined,
): Promise<string | undefined> {
  if (!imageUrl) return undefined;

  const siteUrl = publicSiteUrl();
  const source = eventShareArtworkSource(imageUrl, siteUrl);
  if (!source) return undefined;

  const upload = source.kind === "fixture"
    ? await fetchFixtureArtwork(source.url)
    : await fetchProfileAssetSourceUrl(source.url.href, {
        assertSourceUrl: (url) => {
          if (isEventShareImageUrl(url)) {
            throw new Error("Event share artwork must not reference a generated event preview.");
          }
        },
        totalTimeoutMs: 30_000,
      });
  const normalized = await validateAndNormalizeProfileAsset(upload.body, upload.mimeType);
  if (!canRasterizeEventShareArtwork(source, normalized.mimeType)) {
    return undefined;
  }
  const png = await sharp(normalized.body, {
    animated: false,
    failOn: "warning",
    limitInputPixels: 8_192 ** 2,
  })
    .resize({
      fit: "inside",
      height: artworkBounds.height,
      width: artworkBounds.width,
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  if (png.byteLength > PROFILE_ASSET_MAX_STORED_BYTES) {
    return undefined;
  }

  return `data:image/png;base64,${png.toString("base64")}`;
}
