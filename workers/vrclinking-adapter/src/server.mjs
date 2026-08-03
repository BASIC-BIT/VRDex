import { createServer } from "node:http";

import { resolveAdapterDeps } from "./bootstrap.mjs";
import { handleAdapterRequest, MAX_BODY_BYTES } from "./handler.mjs";

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    // Bounded while streaming rather than after: an unbounded read is a memory
    // exhaustion the bearer token does not protect against, because the body is
    // consumed before it can be checked.
    if (size > MAX_BODY_BYTES) {
      throw new Error("body_too_large");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The local / container transport. The protocol lives in `handler.mjs`, shared
 * with the Lambda entry point, so the two cannot drift.
 */
export function createAdapterServer({ resolveSecret, getGuildMemberByDiscordId, bearerToken }) {
  const server = createServer(async (request, response) => {
    let rawBody = "";

    if (request.method === "POST") {
      try {
        rawBody = await readBody(request);
      } catch {
        return json(response, 400, { error: "invalid_body" });
      }
    }

    const { status, payload } = await handleAdapterRequest({
      method: request.method ?? "",
      // Query strings are not part of this protocol; compare the path alone so
      // `/healthz?x=1` is still the health check.
      path: (request.url ?? "/").split("?")[0],
      authorization: request.headers.authorization ?? "",
      rawBody,
      bearerToken,
      resolveSecret,
      getGuildMemberByDiscordId,
    });

    return json(response, status, payload);
  });

  // The bearer check lives in `handleAdapterRequest`, which needs the parsed
  // body, so an unauthenticated caller gets to occupy a connection until its
  // body arrives. `MAX_BODY_BYTES` bounds how much memory that costs but not
  // how long it takes, so a client trickling a declared body could hold
  // connections open indefinitely. These deadlines are the bound; duplicating
  // the token comparison out here to answer sooner would give the protocol two
  // copies of the check it exists to keep in one place.
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAdapterServer(await resolveAdapterDeps());
  const port = Number(process.env.PORT ?? 8080);

  server.listen(port, () => {
    console.log(`vrclinking-adapter listening on ${port}`);
  });

  // An orchestrator's SIGTERM otherwise hits Node's default handling and exits
  // immediately, dropping a claim mid-provider-lookup along with its response.
  // `server.close` stops accepting and lets in-flight requests finish; the
  // timer is the ceiling on how long that is allowed to take.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
