import { randomUUID, timingSafeEqual } from "node:crypto";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { EVENT_POSTER_MAX_BYTES, isDiscordCdnUrl } from "../../../../../packages/api-contracts/src/event-intake";
import { convexAdminHttpClient, optionalConvexAdminHttpClient } from "./convex-http";
import { createEventPosterHandlers } from "./event-poster-storage";
import { createProfileAssetReadUrl, isProfileAssetStorageConfigured, profileAssetUploadChecksum, putProfileAssetObject } from "./profile-asset-storage";

type Admin = Pick<ReturnType<typeof convexAdminHttpClient>, "mutation" | "query">;
type StoreInput = { actorUserId: Id<"users">; draftId: Id<"eventIntakeDrafts">; url: string; contentType: string; byteLength: number };
type ReadInput = { actorUserId: Id<"users">; posterAssetId: Id<"eventPosterSources"> };
// Convex fetches the link straight away. The copy sits under the quarantine prefix, whose bucket lifecycle rule deletes it within two days.
const READ_LINK_SECONDS = 60;

/** Moves Discord poster bytes into private storage for Convex runs, which cannot reach the bucket themselves. */
export function createDiscordPosterBridge(deps: {
  admin?: Admin;
  fetch?: typeof fetch;
  put?: typeof putProfileAssetObject;
  presign?: typeof createProfileAssetReadUrl;
  handlers?: (actorUserId: Id<"users">) => Pick<ReturnType<typeof createEventPosterHandlers>, "completePosterUpload" | "readPoster">;
} = {}) {
  const put = deps.put ?? putProfileAssetObject;
  const handlers = deps.handlers ?? ((actorUserId: Id<"users">) => createEventPosterHandlers({ authority: async () => ({ actorUserId }), admin: deps.admin }));
  return {
    async store(input: StoreInput) {
      if (!isDiscordCdnUrl(input.url)) throw new Error("POSTER_URL_REFUSED");
      if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > EVENT_POSTER_MAX_BYTES) throw new Error("POSTER_SOURCE_MISMATCH");
      let response: Response;
      try {
        response = await (deps.fetch ?? fetch)(input.url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      } catch {
        // Discord attachment URLs are signed; never echo the request or its error.
        throw new Error("POSTER_FETCH_FAILED");
      }
      if (!response.ok) throw new Error("POSTER_FETCH_FAILED");
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) !== input.byteLength) throw new Error("POSTER_SOURCE_MISMATCH");
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength !== input.byteLength) throw new Error("POSTER_SOURCE_MISMATCH");
      const reserved = await (deps.admin ?? convexAdminHttpClient()).mutation(internal.eventIntakeSources.beginPosterUpload, {
        actorUserId: input.actorUserId, draftId: input.draftId, contentType: input.contentType, byteLength: input.byteLength, sha256: profileAssetUploadChecksum(body),
      });
      await put({ storageKey: reserved.uploadStorageKey, body, contentType: input.contentType, cacheControl: "private, no-store" });
      // Validates, freezes, and auto-selects artwork exactly as a browser upload does.
      await handlers(input.actorUserId).completePosterUpload({ posterAssetId: reserved.posterAssetId });
      return { posterAssetId: reserved.posterAssetId as Id<"eventPosterSources"> };
    },
    /** A prepared poster can exceed the 4.5 MB response cap, so this returns a short-lived link to its bytes, not a data URL. */
    async read(input: ReadInput) {
      const dataUrl = await handlers(input.actorUserId).readPoster(input.posterAssetId);
      const prefix = /^data:(image\/[a-z]+);base64,/.exec(dataUrl.slice(0, 64));
      if (!prefix) throw new Error("POSTER_NOT_READY");
      const storageKey = `profile-assets/quarantine/discord-intake-posters/${randomUUID()}`;
      await put({ storageKey, body: Buffer.from(dataUrl.slice(prefix[0].length), "base64"), contentType: prefix[1]!, cacheControl: "private, no-store" });
      return { url: await (deps.presign ?? createProfileAssetReadUrl)(storageKey, READ_LINK_SECONDS), mimeType: prefix[1]! };
    },
  };
}

const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 2_048;

function parseRequest(body: unknown): { op: "store"; input: StoreInput } | { op: "read"; input: ReadInput } | null {
  if (typeof body !== "object" || body === null) return null;
  const row = body as Record<string, unknown>;
  if (row.op === "store" && [row.actorUserId, row.draftId, row.url, row.contentType].every(text) && typeof row.byteLength === "number")
    return { op: "store", input: { actorUserId: row.actorUserId, draftId: row.draftId, url: row.url, contentType: row.contentType, byteLength: row.byteLength } as StoreInput };
  if (row.op === "read" && [row.actorUserId, row.posterAssetId].every(text))
    return { op: "read", input: { actorUserId: row.actorUserId, posterAssetId: row.posterAssetId } as ReadInput };
  return null;
}

/** `POST /api/internal/discord-intake/poster`, called only by Convex Discord intake runs. */
export async function handleDiscordPosterRequest(request: Request, bridge?: ReturnType<typeof createDiscordPosterBridge>) {
  const token = process.env.VRDEX_DISCORD_POSTER_TOKEN;
  const expected = Buffer.from(`Bearer ${token ?? ""}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (!token || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return new Response(null, { status: 401 });
  if (!bridge) {
    const admin = optionalConvexAdminHttpClient();
    if (!admin || !isProfileAssetStorageConfigured()) return new Response(null, { status: 503 });
    bridge = createDiscordPosterBridge({ admin });
  }
  const parsed = parseRequest(await request.json().catch(() => null));
  if (!parsed) return new Response(null, { status: 400 });
  try {
    const result = parsed.op === "store" ? await bridge.store(parsed.input) : await bridge.read(parsed.input);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /^POSTER_[A-Z_]+$/.test(error.message)) return Response.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    throw error;
  }
}
