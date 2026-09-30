import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { EventPosterDeclarationSchema } from "../../../../../packages/api-contracts/src/event-intake";
import { convexAdminHttpClient } from "./convex-http";
import { createProfileAssetDirectUploadTarget, getProfileAssetObject, putProfileAssetObject, profileAssetUploadChecksum } from "./profile-asset-storage";
import { validateAndPrepareProfileAsset } from "./profile-asset-validation";

export async function validatePosterBytes(body: Uint8Array, declaration: { contentType: string; byteLength: number; sha256: string }) {
  EventPosterDeclarationSchema.parse({ contentType: declaration.contentType, byteLength: declaration.byteLength, sha256: declaration.sha256 });
  if (body.byteLength !== declaration.byteLength || profileAssetUploadChecksum(body) !== declaration.sha256) throw new Error("POSTER_SOURCE_MISMATCH");
  const prepared = await validateAndPrepareProfileAsset(body, declaration.contentType);
  return { body, display: prepared.display };
}
type Dependencies = {
  // This closure must authenticate the current browser session or scoped OAuth request.
  authority: () => Promise<{ actorUserId: Id<"users"> }>;
  admin?: Pick<ReturnType<typeof convexAdminHttpClient>, "mutation" | "query">;
  target?: typeof createProfileAssetDirectUploadTarget;
  read?: typeof getProfileAssetObject;
  put?: typeof putProfileAssetObject;
};
export function createEventPosterHandlers(deps: Dependencies) {
  const admin = () => deps.admin ?? convexAdminHttpClient();
  const read = deps.read ?? getProfileAssetObject;
  const put = deps.put ?? putProfileAssetObject;
  const own = async (posterAssetId: Id<"eventPosterSources">) => admin().query(internal.eventIntakeSources.readActorSource, { ...await deps.authority(), posterAssetId });
  const bytes = async (posterAssetId: Id<"eventPosterSources">) => {
    const source = await own(posterAssetId);
    if (source.state !== "ready" || !source.storageKey) throw new Error("POSTER_NOT_READY");
    const object = await read(source.storageKey);
    if (!object || object.contentType !== source.contentType) throw new Error("POSTER_SOURCE_MISMATCH");
    const checked = await validatePosterBytes(object.body, source);
    return { source, ...checked };
  };
  return {
    async beginPosterUpload(input: { draftId: Id<"eventIntakeDrafts">; contentType: string; byteLength: number; sha256: string }) {
      const declaration = EventPosterDeclarationSchema.parse({ contentType: input.contentType, byteLength: input.byteLength, sha256: input.sha256 });
      const reserved = await admin().mutation(internal.eventIntakeSources.beginPosterUpload, { draftId: input.draftId, ...declaration, ...await deps.authority() });
      const transfer = await (deps.target ?? createProfileAssetDirectUploadTarget)({ storageKey: reserved.uploadStorageKey, contentType: declaration.contentType, byteSize: declaration.byteLength, expiresAt: reserved.expiresAt });
      return { posterAssetId: reserved.posterAssetId, expiresAt: reserved.expiresAt, transfer: { method: "POST" as const, ...transfer, fileField: "file" } };
    },
    async completePosterUpload(input: { posterAssetId: Id<"eventPosterSources">; expectedVersion?: number }) {
      const source = await own(input.posterAssetId);
      if (source.state !== "ready") {
        if (!source.uploadStorageKey || !source.storageKey) throw new Error("POSTER_NOT_READY");
        const object = await read(source.uploadStorageKey);
        if (!object || object.contentType !== source.contentType || (object.contentLength !== undefined && object.contentLength !== source.byteLength)) throw new Error("POSTER_SOURCE_MISMATCH");
        await validatePosterBytes(object.body, source);
        // A signed upload can still be replayed; freeze the digest-checked bytes under a different immutable key.
        const remaining = source.uploadExpiresAt - Date.now();
        if (remaining <= 0) throw new Error("POSTER_WRITE_EXPIRED");
        await put({ storageKey: source.storageKey, body: object.body, contentType: source.contentType, cacheControl: "private, no-store", signal: AbortSignal.timeout(remaining) });
      }
      const completed = await admin().mutation(internal.eventIntakeSources.completePosterUpload, { ...await deps.authority(), posterAssetId: input.posterAssetId, sha256: source.sha256, expectedVersion: input.expectedVersion });
      if (!completed.autoSourceId) return { posterAssetId: input.posterAssetId, ...(completed.artworkAssetId ? { artworkAssetId: completed.artworkAssetId } : {}), version: completed.version };
      const selected = await this.selectPosterArtwork({ draftId: source.draftId, posterAssetId: input.posterAssetId, expectedVersion: completed.version, automatic: true });
      return { posterAssetId: input.posterAssetId, ...(selected.artworkAssetId ? { artworkAssetId: selected.artworkAssetId } : {}), version: selected.version };
    },
    async readPoster(posterAssetId: Id<"eventPosterSources">) {
      const { display } = await bytes(posterAssetId);
      return `data:${display.mimeType};base64,${Buffer.from(display.body).toString("base64")}`;
    },
    async selectPosterArtwork(input: { draftId: Id<"eventIntakeDrafts">; posterAssetId: Id<"eventPosterSources"> | null; expectedVersion: number; automatic?: boolean }) {
      const authority = await deps.authority();
      const selected = await admin().mutation(internal.eventIntakeSources.selectPosterArtwork, { ...input, ...authority });
      if (selected.skipped || selected.artworkAssetId === null) return { artworkAssetId: selected.artworkAssetId ?? null, artworkSourceId: null, version: selected.version };
      if (!selected.artworkAssetId) throw new Error("ARTWORK_NOT_READY");
      const artworkAssetId: Id<"eventPosterArtwork"> = selected.artworkAssetId;
      try {
        if (!selected.storageKey) throw new Error("ARTWORK_NOT_READY");
        const { display } = await bytes(selected.sourceId);
        const remaining = selected.writeExpiresAt - Date.now();
        if (remaining <= 0) throw new Error("ARTWORK_WRITE_EXPIRED");
        await put({ storageKey: selected.storageKey, body: display.body, contentType: display.mimeType, cacheControl: "private, no-store", signal: AbortSignal.timeout(remaining) });
        const completed = await admin().mutation(internal.eventIntakeSources.completeArtwork, { ...await deps.authority(), artworkAssetId, expectedVersion: selected.expectedVersion, sha256: display.contentSha256, byteLength: display.body.byteLength, automatic: input.automatic });
        return { ...completed, artworkSourceId: selected.sourceId as Id<"eventPosterSources"> };
      } catch (error) {
        // Use the original authenticated actor even if session revalidation failed.
        await admin().mutation(internal.eventIntakeSources.recoverFailedArtworkWrite, { ...authority, artworkAssetId });
        throw error;
      }
    },
  };
}
