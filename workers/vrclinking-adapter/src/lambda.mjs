import { resolveAdapterDeps } from "./bootstrap.mjs";
import { handleAdapterRequest, MAX_BODY_BYTES } from "./handler.mjs";

/**
 * AWS Lambda entry point, for a Function URL.
 *
 * Lambda rather than a container behind a load balancer: this service answers a
 * handful of request/response calls, holds no state, and needs an execution
 * role for Secrets Manager and an HTTPS endpoint — all of which a Function URL
 * gives for nothing while scaling to zero. `server.mjs` stays for local runs.
 *
 * Function URL auth is `NONE` by design. Convex cannot sign SigV4, and the
 * bearer token plus the per-delegation capability are what actually authorize a
 * request — IAM auth here would add a credential Convex has no way to present.
 *
 * Built once per container, not per invocation, so the secret resolver's cache
 * and the AWS client survive between warm calls. A configuration fault rejects
 * every request rather than throwing an unhandled error, and is retried rather
 * than cached — see the handler.
 */
let deps = resolveAdapterDeps().catch((error) => error);

export async function handler(event, context) {
  const resolved = await deps;

  if (resolved instanceof Error) {
    // Only a *successful* bootstrap is worth caching. A transient Secrets
    // Manager failure at cold start would otherwise poison this container for
    // its whole lifetime — every later invocation answering
    // `adapter_misconfigured` long after AWS recovered, and with reserved
    // concurrency a few such containers produce intermittent 500s that look
    // like a configuration fault rather than a blip.
    deps = resolveAdapterDeps().catch((error) => error);
    console.error(`vrclinking-adapter misconfigured: ${resolved.message}`);

    return respond(500, { error: "adapter_misconfigured" });
  }

  const method = event?.requestContext?.http?.method ?? "";
  const path = event?.rawPath ?? "/";
  // Header names arrive lowercased from a Function URL, but a direct test
  // invocation may not bother.
  const headers = event?.headers ?? {};
  const authorization = headers.authorization ?? headers.Authorization ?? "";
  const rawBody = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event?.body ?? "");

  // Same bound the node transport applies while streaming. Lambda has its own
  // payload limit, but keeping the check here means both transports refuse the
  // same thing rather than one relying on the platform.
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return respond(400, { error: "invalid_body" });
  }

  const { status, payload } = await handleAdapterRequest({
    method,
    path,
    authorization,
    rawBody,
    // Read *after* the bootstrap await above, so a cold start that spent part
    // of this invocation resolving secrets shortens the fan-out rather than
    // handing it a budget the platform will not honour. Absent on a direct
    // test invocation, where the fan-out falls back to its own default.
    ...(typeof context?.getRemainingTimeInMillis === "function"
      ? { remainingMs: context.getRemainingTimeInMillis() }
      : {}),
    ...resolved,
  });

  return respond(status, payload);
}

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}
