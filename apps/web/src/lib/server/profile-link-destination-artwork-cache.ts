import { createHash } from "node:crypto";
import type { DestinationKind } from "../../../../../workers/group-telemetry/profile-link-destination.mjs";
import { getProfileAssetObject, putProfileLinkThumbnailCache } from "./profile-asset-storage";
import { prepareProfileLinkDestinationArtwork } from "./profile-link-destination-artwork";

type Source = { key: string; kind: DestinationKind; artworkSourceUrl: string };
type Cache = { attemptedAt: number; fetchedAt?: number; image?: string };
type Dependencies = {
  read: (key: string) => Promise<{ body: Uint8Array } | null>;
  write: (key: string, body: Uint8Array) => Promise<void>;
  prepare: typeof prepareProfileLinkDestinationArtwork;
  now: () => number;
};

export function canonicalDestinationArtworkQuery(params: URLSearchParams, observedAt: number | undefined): boolean {
  return observedAt !== undefined && Number.isFinite(observedAt)
    && params.getAll("profile").length === 1 && params.getAll("v").length === 1
    && [...params.keys()].every(key => key === "profile" || key === "v")
    && params.get("v") === String(observedAt);
}

// Public-reference checks belong before this cache; neither query parameters nor
// metadata observation timestamps select storage keys or trigger provider reads.
export function createDestinationArtworkCache(dependencies: Dependencies) {
  const pending = new Map<string, Promise<Uint8Array | null>>();
  return async (source: Source): Promise<Uint8Array | null> => {
    const hash = createHash("sha256").update(JSON.stringify([source.key, source.kind, source.artworkSourceUrl])).digest("hex");
    const key = `profile-assets/destination-thumbnails/${hash}.json`;
    const existing = pending.get(key);
    if (existing) return existing;
    const work = (async () => {
      const now = dependencies.now();
      const stored = await dependencies.read(key).catch((error: unknown) => {
        // S3 returns AccessDenied for missing objects when the runtime lacks
        // ListBucket. This derived cache key can be rebuilt without that grant.
        // A successful import must still be persisted before we return it.
        if (error && typeof error === "object" && "name" in error && error.name === "AccessDenied") return null;
        throw error;
      });
      let previous: Cache | undefined;
      if (stored && stored.body.byteLength <= 180 * 1024) {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.body));
          if (parsed && typeof parsed === "object" && "attemptedAt" in parsed && typeof parsed.attemptedAt === "number" && Number.isFinite(parsed.attemptedAt)) {
            const candidate = parsed as Cache;
            if ((!candidate.image || (typeof candidate.image === "string" && candidate.image.length <= 175_000)) && (!candidate.fetchedAt || Number.isFinite(candidate.fetchedAt))) previous = candidate;
          }
        } catch { /* A corrupt cache object is replaced by a fresh sanitized import. */ }
      }
      const old = previous?.image ? new Uint8Array(Buffer.from(previous.image, "base64")) : null;
      if (previous && ((previous.fetchedAt && now - previous.fetchedAt < 86_400_000) || now - previous.attemptedAt < 3_600_000)) return old;
      let image: Uint8Array | null;
      try { image = await dependencies.prepare(source.artworkSourceUrl, source.kind); }
      catch {
        await dependencies.write(key, new TextEncoder().encode(JSON.stringify({ ...previous, attemptedAt: now }))).catch(() => undefined);
        return old;
      }
      const next: Cache = { attemptedAt: now, fetchedAt: now, image: Buffer.from(image).toString("base64") };
      await dependencies.write(key, new TextEncoder().encode(JSON.stringify(next)));
      return image;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  };
}

export const cachedProfileLinkDestinationArtwork = createDestinationArtworkCache({
  read: getProfileAssetObject,
  write: putProfileLinkThumbnailCache,
  prepare: prepareProfileLinkDestinationArtwork,
  now: Date.now,
});
