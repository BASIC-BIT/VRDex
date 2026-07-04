import { listDefaultApiRateLimitPolicies } from "../apps/web/src/lib/server/api-rate-limit";

console.log("routeClass,limit,windowMs,windowSeconds");

for (const policy of listDefaultApiRateLimitPolicies()) {
  console.log(
    [
      policy.routeClass,
      String(policy.limit),
      String(policy.windowMs),
      String(policy.windowMs / 1_000),
    ].join(","),
  );
}
