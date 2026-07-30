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
  return createServer(async (request, response) => {
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAdapterServer(await resolveAdapterDeps());
  const port = Number(process.env.PORT ?? 8080);

  server.listen(port, () => {
    console.log(`vrclinking-adapter listening on ${port}`);
  });
}
