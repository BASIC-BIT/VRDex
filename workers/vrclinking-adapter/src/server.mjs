import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { verifyLinkage, validateRequest } from "./adapter.mjs";
import { createSecretResolver } from "./secret-resolver.mjs";
import { createVrclinkingClient } from "./vrclinking-client.mjs";

const MAX_BODY_BYTES = 16 * 1024;

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}

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

    if (size > MAX_BODY_BYTES) {
      throw new Error("body_too_large");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createAdapterServer({ resolveSecret, getGuildMemberByDiscordId, bearerToken }) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { status: "ok" });
    }

    if (request.method !== "POST") {
      return json(response, 405, { error: "method_not_allowed" });
    }

    const authorization = request.headers.authorization ?? "";
    const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

    if (!presented || !safeEqual(presented, bearerToken)) {
      return json(response, 401, { error: "unauthorized" });
    }

    let body;

    try {
      body = JSON.parse(await readBody(request));
    } catch {
      return json(response, 400, { error: "invalid_body" });
    }

    const validated = validateRequest(body);

    if (!validated.ok) {
      return json(response, 400, { error: validated.error });
    }

    try {
      const result = await verifyLinkage({
        request: validated.request,
        resolveSecret,
        getGuildMemberByDiscordId,
      });

      // The control plane treats a non-200 as "adapter unavailable", which is
      // the correct reading when no delegation could be consulted.
      return json(response, result.unavailable === true ? 503 : 200, {
        verified: result.verified,
        evidenceSource: result.evidenceSource,
        evidenceSummary: result.evidenceSummary,
        ...(result.matchedGuildId === undefined
          ? {}
          : {
              matchedGuildId: result.matchedGuildId,
              matchedDelegationIndex: result.matchedDelegationIndex,
            }),
      });
    } catch {
      // Never surface provider or secret detail to the caller.
      return json(response, 500, { error: "adapter_failed" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bearerToken = requiredEnv("VRCHAT_PROOF_ADAPTER_BEARER_TOKEN");
  const secretDir = process.env.VRDEX_VRCLINKING_SECRET_DIR?.trim();
  let awsClient;

  if (process.env.VRDEX_VRCLINKING_ENABLE_AWS_SECRETS === "true") {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({});
    awsClient = {
      getSecretValue: (secretId) => client.send(new GetSecretValueCommand({ SecretId: secretId })),
    };
  }

  // Without a backend every request resolves to 503 while the process looks
  // healthy, which reads as a provider outage rather than a missing
  // deployment variable. Fail at startup instead.
  // `!secretDir`, not `=== undefined`: a templated-but-unset deployment
  // variable arrives as an empty string, which would clear an identity check
  // and leave the guard passing on a process that can resolve nothing.
  if (!secretDir && awsClient === undefined) {
    throw new Error(
      "No secret backend configured. Set VRDEX_VRCLINKING_SECRET_DIR or VRDEX_VRCLINKING_ENABLE_AWS_SECRETS=true.",
    );
  }

  const server = createAdapterServer({
    bearerToken,
    resolveSecret: createSecretResolver({ secretDir, awsClient }),
    getGuildMemberByDiscordId: createVrclinkingClient(),
  });
  const port = Number(process.env.PORT ?? 8080);

  server.listen(port, () => {
    console.log(`vrclinking-adapter listening on ${port}`);
  });

  // `close` alone waits for every pooled keep-alive socket Convex holds open to
  // end on its own, which for an idle connection is never — the callback would
  // not fire and the orchestrator would SIGKILL instead of draining. Close the
  // idle ones, and keep a deadline for a request still in flight.
  const shutdown = () => {
    const forced = setTimeout(() => process.exit(0), 10_000);
    forced.unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
