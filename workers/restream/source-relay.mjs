import { createServer } from "node:http";
import { request } from "node:https";
import { Resolver } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { isIPv4 } from "node:net";
export function isPublicIPv4(address) {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
/** Explicit MP4 mode does not broaden the existing MPEGTS allowlist. */
export function validateSourceEndpoint(
  value,
  operatorEndpoints = [],
  inputFormat = "mpegts",
) {
  if (!["mpegts", "vrcdn_fmp4"].includes(inputFormat))
    throw Error("Unsupported input format");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw Error("Unsupported source endpoint");
  const canonical =
    url.hostname === "stream.vrcdn.live" &&
    (inputFormat === "vrcdn_fmp4"
      ? /^\/live\/[a-zA-Z0-9_-]{2,128}\.live\.mp4$/
      : /^\/live\/[a-zA-Z0-9_-]{2,128}\.live\.ts$/
    ).test(url.pathname) &&
    !url.search;
  if (!canonical && !operatorEndpoints.includes(url.href))
    throw Error("Source endpoint is not authorized");
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.includes(":") ||
    (isIPv4(url.hostname) && !isPublicIPv4(url.hostname))
  )
    throw Error("Source endpoint is not public");
  return url;
}
/** The decoder sees only a local MPEGTS relay, never an event-authored URL.
 * Resolve and pin public IPv4 per connection; no redirects, nested playlists,
 * credentials, or unsupported protocols. Backpressure is bounded by Node pipes.
 */
export async function createSourceRelay({
  operatorEndpoints = [],
  inputFormat = "mpegts",
  resolveAddresses,
  createResolver = () => new Resolver({ timeout: 1000, tries: 1 }),
  requestSource = request,
} = {}) {
  const routes = new Map();
  const sourceKey = (source) =>
    JSON.stringify([source.id, source.revision, source.type, source.publicUrl]);
  const retire = (route) => {
    for (const close of route.connections) close();
  };
  let stopped = false;
  const server = createServer(async (req, res) => {
    const route = routes.get(req.url);
    if (!route || stopped) {
      res.writeHead(404).end();
      return;
    }
    // A reconnect waits for the prior provider connection (including DNS
    // and closing sockets) to terminate; a route is one acquisition.
    if (route.connections.size) {
      res.writeHead(409).end();
      return;
    }
    let upstream, responseStream, dnsWork, resolver, dnsTimer;
    let cleanup;
    const abort = () => {
      if (cleanup) return cleanup;
      const closing = [
        ...new Set(
          [upstream, upstream?.socket, responseStream, res].filter(Boolean),
        ),
      ].filter((stream) => !stream.closed);
      cleanup = Promise.all([
        dnsWork?.catch(() => {}),
        ...closing.map(
          (stream) => new Promise((resolve) => stream.once("close", resolve)),
        ),
      ]).then(() => {
        route.connections.delete(abort);
      });
      resolver?.cancel();
      clearTimeout(dnsTimer);
      upstream?.destroy();
      responseStream?.destroy();
      res.destroy();
      return cleanup;
    };
    route.connections.add(abort);
    res.on("close", abort);
    try {
      // A resolver belongs to this connection only. Injected legacy lookup hooks
      // retain their physical-completion ownership semantics during disposal.
      dnsWork = Promise.resolve().then(() => {
        if (resolveAddresses)
          return resolveAddresses(route.url.hostname, { all: true, family: 4 });
        resolver = createResolver();
        if (cleanup) throw Error("Source cancelled");
        return resolver
          .resolve4(route.url.hostname)
          .then((addresses) =>
            addresses.map((address) => ({ address, family: 4 })),
          );
      });
      const addresses = await Promise.race([
        dnsWork,
        new Promise((_, reject) => {
          dnsTimer = setTimeout(() => {
            resolver?.cancel();
            reject(Error("DNS timeout"));
          }, 2000);
          dnsTimer.unref();
        }),
      ]).finally(() => clearTimeout(dnsTimer));
      if (
        stopped ||
        routes.get(req.url) !== route ||
        res.destroyed ||
        !addresses.length ||
        addresses.some((a) => !isPublicIPv4(a.address))
      )
        throw Error("Source address denied");
      upstream = requestSource(
        route.url,
        {
          method: "GET",
          agent: false,
          lookup: (_host, options, callback) => {
            if (options.all)
              callback(null, [{ address: addresses[0].address, family: 4 }]);
            else callback(null, addresses[0].address, 4);
          },
        },
        (response) => {
          responseStream = response;
          if (cleanup) {
            response.destroy();
            return;
          }
          if (
            response.statusCode !== 200 ||
            (inputFormat === "vrcdn_fmp4" &&
              response.headers["content-type"]
                ?.split(";")[0]
                .trim()
                .toLowerCase() !== "video/mp4")
          ) {
            response.destroy();
            res.writeHead(502).end();
            return;
          }
          res.writeHead(200, {
            "Content-Type":
              inputFormat === "vrcdn_fmp4" ? "video/mp4" : "video/mp2t",
          });
          response.on("error", () => res.destroy());
          response.pipe(res);
        },
      );
      upstream.setTimeout(3000, () => upstream.destroy());
      upstream.on("error", () => res.destroy());
      upstream.end();
    } catch {
      res.writeHead(502).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const api = {
    createInput({ source, signal }) {
      const url = api.resolveSource(source),
        path = new URL(url).pathname;
      let disposed;
      const dispose = () => {
        if (disposed) return disposed;
        const route = routes.get(path);
        routes.delete(path);
        disposed = route
          ? Promise.all([...route.connections].map((close) => close())).then(
              () => {},
            )
          : Promise.resolve();
        signal?.removeEventListener("abort", dispose);
        return disposed;
      };
      signal?.addEventListener("abort", dispose, { once: true });
      if (signal?.aborted) void dispose();
      return { transportReady: Promise.resolve({ url }), dispose };
    },
    // Reconciliation owns liveness. Invalid candidates are still rejected by
    // resolveSource individually, so one bad warm target cannot fence current.
    retainSources(sources) {
      const retained = new Set(sources.map(sourceKey));
      for (const [path, route] of routes) {
        if (!retained.has(route.key)) {
          routes.delete(path);
          retire(route);
        }
      }
    },
    resolveSource(source) {
      if (source.type !== "vrcdn_link" && source.type !== "rtmp_source")
        throw Error("Unsupported source kind");
      const url = validateSourceEndpoint(
        source.publicUrl,
        operatorEndpoints,
        inputFormat,
      );
      // Current and next only; existing endpoint reuse avoids decoder churn.
      let route = [...routes].find(
        ([, value]) => value.key === sourceKey(source),
      )?.[0];
      if (!route) {
        if (routes.size >= 64) throw Error("Source route bound exceeded");
        route = `/${randomUUID()}`;
        routes.set(route, {
          key: sourceKey(source),
          url,
          connections: new Set(),
        });
      }
      return `http://127.0.0.1:${server.address().port}${route}`;
    },
    stop() {
      stopped = true;
      for (const route of routes.values()) retire(route);
      server.closeAllConnections();
      server.close();
      routes.clear();
    },
  };
  return api;
}
