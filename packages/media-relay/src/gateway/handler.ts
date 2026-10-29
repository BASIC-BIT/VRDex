import { z } from "zod";
import {
  GatewayAuthorizationSchema,
  PublishedSnapshotSchema,
  snapshotObjectKey,
  continuityAfter,
  type PlaybackMode,
  type RenditionSnapshot,
  type StreamKey,
} from "../contracts";
import { isSnapshotFresh, hasPlayableWindow, RELAY_POLICY } from "../policy";
import { renderPlaylist } from "./playlist";
import type { SignSegment } from "./signing";
export type ManifestOptions = {
  authorize: (args: {
    grantId: string;
    rendition: PlaybackMode;
    signal: AbortSignal;
  }) => Promise<unknown>;
  readSnapshot: (args: {
    objectKey: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
  demand: {
    recordDemand: (args: { streamKey: StreamKey; at: number }) => Promise<void>;
  };
  signSegment: SignSegment;
  clock: () => number;
  origins: readonly string[];
  maxConcurrent?: number;
  maxSources?: number;
  timeoutMs?: number;
};
/** No authorization cache: each native request rechecks grant/context/current epoch before storage. */
export function createManifestHandler(
  options: ManifestOptions,
): (request: Request) => Promise<Response> {
  const maxConcurrent = options.maxConcurrent ?? 32,
    maxSources = options.maxSources ?? 1000,
    timeoutMs = options.timeoutMs ?? 1500;
  if (
    ![maxConcurrent, maxSources, timeoutMs].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) ||
    timeoutMs > 2000
  )
    throw Error("Invalid gateway bounds");
  const origins = new Set(
    options.origins.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin !== value)
        throw Error("Invalid CORS origin");
      return value;
    }),
  );
  // One bounded continuity watermark per source/rendition, never per capability/viewer.
  const seen = new Map<string, RenditionSnapshot>();
  let busy = 0;
  return async (request) => {
    const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Origin",
    });
    const unavailable = (status = 503, reason = "unavailable") =>
      Response.json({ kind: "unavailable", reason }, { status, headers });
    const origin = request.headers.get("origin");
    if (origin) {
      if (!origins.has(origin)) return unavailable(403);
      headers.set("Access-Control-Allow-Origin", origin);
    }
    const url = new URL(request.url),
      match = /^\/p\/([A-Za-z0-9_-]{1,128})\/(video|audio)\/index\.m3u8$/.exec(
        url.pathname,
      );
    if (!match || url.search) return unavailable(404);
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") return unavailable(405);
    const grantId = match[1],
      rendition = match[2];
    if (!grantId || (rendition !== "video" && rendition !== "audio"))
      return unavailable(404);
    if (busy >= maxConcurrent) return unavailable();
    busy++;
    const abort = new AbortController();
    const startedAt = options.clock();
    const withinBudget = () =>
      options.clock() >= startedAt && options.clock() - startedAt < timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      const auth = GatewayAuthorizationSchema.parse(
        await options.authorize({ grantId, rendition, signal: abort.signal }),
      );
      abort.signal.throwIfAborted();
      if (auth.kind === "denied") return unavailable(403);
      if (auth.kind === "unavailable") return unavailable(503, auth.reason);
      const validGrant = () =>
        withinBudget() &&
        auth.grant.id === grantId &&
        auth.grant.issuedAt <= options.clock() &&
        auth.grant.expiresAt > options.clock() &&
        auth.grant.renditions.includes(rendition);
      if (!validGrant()) return unavailable(403);
      await options.demand.recordDemand({
        streamKey: auth.grant.streamKey,
        at: options.clock(),
      });
      abort.signal.throwIfAborted();
      const pointer = auth.snapshot;
      const fresh = () =>
        validGrant() &&
        auth.state === "ready" &&
        pointer !== null &&
        pointer.streamKey === auth.grant.streamKey &&
        pointer.rendition === rendition &&
        pointer.epoch === auth.epoch &&
        auth.leaseExpiresAt !== null &&
        auth.leaseExpiresAt > options.clock() &&
        isSnapshotFresh(pointer, options.clock()) && hasPlayableWindow(pointer);
      if (!fresh() || !pointer) return unavailable();
      const snapshot = PublishedSnapshotSchema.parse(
        await options.readSnapshot({
          objectKey: snapshotObjectKey(pointer),
          signal: abort.signal,
        }),
      );
      abort.signal.throwIfAborted();
      if (!fresh() || JSON.stringify(snapshot) !== JSON.stringify(pointer))
        return unavailable();
      const key = `${snapshot.streamKey}/${rendition}`,
        prior = seen.get(key);
      if (prior) {
        const next = continuityAfter(prior);
        if (
          snapshot.epoch < prior.epoch ||
          snapshot.sequence < prior.sequence ||
          continuityAfter(snapshot).nextSequence < next.nextSequence ||
          snapshot.generatedAt < prior.generatedAt ||
          snapshot.discontinuitySequence < prior.discontinuitySequence ||
          (snapshot.epoch !== prior.epoch &&
            (snapshot.sequence < next.nextSequence ||
              snapshot.discontinuitySequence < next.discontinuitySequence ||
              (snapshot.sequence === next.nextSequence &&
                !snapshot.segments[0]?.discontinuity)))
        )
          return unavailable();
      } else if (seen.size >= maxSources * 2) return unavailable();
      seen.set(key, snapshot);
      const body = renderPlaylist(
        snapshot,
        options.signSegment,
        options.clock() + RELAY_POLICY.segmentUrlValidityMs + 1000,
      );
      if (!fresh()) return unavailable();
      headers.set("Content-Type", "application/vnd.apple.mpegurl");
      return new Response(body, { status: 200, headers });
    };
    // Timeout returns promptly but physical capacity is held until the adapter actually settles.
    const work = operation()
      .catch(() => unavailable())
      .finally(() => {
        busy--;
        if (timer) clearTimeout(timer);
      });
    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve(unavailable());
      }, timeoutMs);
    });
    return Promise.race([work, timeout]);
  };
}
const LambdaEventSchema = z.object({
  version: z.literal("2.0"),
  rawPath: z.string().max(2048),
  rawQueryString: z.string().max(4096),
  headers: z.record(z.string(), z.string()).default({}),
  requestContext: z.object({ http: z.object({ method: z.string() }) }),
});
/** API Gateway HTTP API payload v2 / Lambda Function URL boundary. No provider SDK needed here. */
export function createLambdaHandler(
  handler: (request: Request) => Promise<Response>,
) {
  return async (event: unknown) => {
    const parsed = LambdaEventSchema.safeParse(event);
    let response: Response;
    if (!parsed.success)
      response = new Response(null, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    else {
      const e = parsed.data;
      try {
        response = await handler(
          new Request(
            `https://gateway.invalid${e.rawPath}${e.rawQueryString ? "?" + e.rawQueryString : ""}`,
            { method: e.requestContext.http.method, headers: e.headers },
          ),
        );
      } catch {
        response = new Response(null, {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      statusCode: response.status,
      headers,
      body: await response.text(),
      isBase64Encoded: false,
    };
  };
}
