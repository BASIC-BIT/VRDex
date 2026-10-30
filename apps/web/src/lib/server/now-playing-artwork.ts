import { supportsNowPlayingArtwork, NOW_PLAYING_MAX_SOURCE_BYTES, NOW_PLAYING_MAX_PIXELS } from "@vrdex/media-relay";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { nowPlayingArtworkUrl, NOW_PLAYING_BRAND_VERSION } from "../now-playing-artwork-url";
export { NOW_PLAYING_BRAND_VERSION };
type Input = Parameters<typeof nowPlayingArtworkUrl>[0];
type AuthorizedAsset = { revision: string; storageKey: string; mimeType: string; byteSize: number };
const MAX_SOURCE = NOW_PLAYING_MAX_SOURCE_BYTES;
const MAX_OUTPUT = 1024 * 1024;
const MAX_CACHE = 32 * 1024 * 1024;
const logoRelativePath = "docs/brand/wordmark/vrdex-wordmark.png";
// Next runs from apps/web; focused tools and standalone packaging may run at root.
function readCanonicalLogo() {
  return readFile(resolve(process.cwd(), logoRelativePath))
    .catch(() => readFile(resolve(process.cwd(), "../..", logoRelativePath)));
}

export function createNowPlayingArtworkService(deps: {
  authorize(input: Input): Promise<AuthorizedAsset | null>;
  read(storageKey: string): Promise<{ body: Uint8Array } | null>;
}) {
  const cache = new Map<string, Buffer>();
  let cacheBytes = 0;
  let queued = 0;
  // Serialize cold renders, bounding Sharp work even for many distinct revisions.
  let pending: Promise<unknown> = Promise.resolve();
  async function get(input: Input) {
    if (input.brandVersion !== NOW_PLAYING_BRAND_VERSION || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.assetId) || !/^\d{1,24}$/.test(input.revision)) return null;
    const asset = await deps.authorize(input);
    if (!asset || asset.revision !== input.revision || !supportsNowPlayingArtwork(asset)) return null;
    const key = createHash("sha256").update(JSON.stringify([input.profileId, input.assetId, input.revision, input.brandVersion, asset.storageKey])).digest("hex");
    const render = async () => {
      const cached = cache.get(key);
      if (cached) return cached;
      const object = await deps.read(asset.storageKey);
      if (!object || object.body.byteLength > MAX_SOURCE) return null;
      const pipeline = sharp(object.body, { animated: false, failOn: "warning", limitInputPixels: NOW_PLAYING_MAX_PIXELS });
      const metadata = await pipeline.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) return null;
      const portrait = await pipeline.rotate().resize(512, 512, { fit: "cover" }).png().toBuffer();
      const logo = await sharp(await readCanonicalLogo()).resize({ width: 160 }).png().toBuffer();
      const logoMetadata = await sharp(logo).metadata();
      const body = await sharp(portrait).composite([{ input: logo, left: 512 - 160 - 18, top: 512 - (logoMetadata.height ?? 0) - 18 }]).png().toBuffer();
      if (body.length > MAX_OUTPUT) return null;
      while ((cacheBytes + body.length > MAX_CACHE || cache.size >= 128) && cache.size) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        cacheBytes -= cache.get(oldest)?.length ?? 0; cache.delete(oldest);
      }
      cache.set(key, body); cacheBytes += body.length;
      return body;
    };
    const hit = cache.get(key);
    if (hit) return { body: hit, url: nowPlayingArtworkUrl(input) };
    if (queued >= 8) return null;
    queued++;
    const work = pending.then(render).finally(() => { queued--; });
    pending = work.catch(() => null);
    try { const body = await work; return body ? { body, url: nowPlayingArtworkUrl(input) } : null; } catch { return null; }
  }
  return { get };
}

/** URL construction never admits remote image addresses; the route reauthorizes every fetch. */
export async function getNowPlayingArtwork(input: Input): Promise<string> {
  const [{ api }, { convexHttpClient }] = await Promise.all([
    import("@convex-generated-api"), import("./convex-http"),
  ]);
  const asset = await convexHttpClient().query(api.profileAssets.getPublicAssetForStorage, { slug: input.profileId, assetId: input.assetId });
  if (!asset?.nowPlayingEligible || asset.revision !== input.revision || input.brandVersion !== NOW_PLAYING_BRAND_VERSION || !supportsNowPlayingArtwork(asset)) throw new Error("Asset not found.");
  return nowPlayingArtworkUrl(input);
}
