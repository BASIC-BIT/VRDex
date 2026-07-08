import {
  apiRateLimitRouteClassRequestCounterKey,
  listDefaultApiRateLimitPolicies,
} from "../apps/web/src/lib/server/api-rate-limit";

const restUrl = process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL?.trim();
const restToken = process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN?.trim();

if (!restUrl || !restToken) {
  throw new Error(
    "VRDEX_RATE_LIMIT_REDIS_REST_URL and VRDEX_RATE_LIMIT_REDIS_REST_TOKEN are required to read request counters.",
  );
}

async function main() {
  const pipelineUrl = new URL("pipeline", restUrl.endsWith("/") ? restUrl : `${restUrl}/`);
  const policies = listDefaultApiRateLimitPolicies();
  const commands = policies.flatMap((policy) => {
    const key = apiRateLimitRouteClassRequestCounterKey(policy.routeClass);

    return [
      ["GET", key],
      ["PTTL", key],
    ];
  });

  const response = await fetch(pipelineUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${restToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Redis REST counter read failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown }>;

  console.log("routeClass,count,ttlMs,windowMs,counterKey");

  for (let index = 0; index < policies.length; index += 1) {
    const policy = policies[index];
    const rawCount = payload[index * 2]?.result;
    const rawTtlMs = payload[index * 2 + 1]?.result;
    const count = Number(rawCount ?? 0);
    const ttlMs = Number(rawTtlMs ?? -2);

    console.log(
      [
        policy.routeClass,
        Number.isFinite(count) ? String(count) : "0",
        Number.isFinite(ttlMs) ? String(ttlMs) : "-2",
        String(policy.windowMs),
        apiRateLimitRouteClassRequestCounterKey(policy.routeClass),
      ].join(","),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
