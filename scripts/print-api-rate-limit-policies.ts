import {
  listApiRateLimitPolicies,
  type ApiRateLimitQuotaTier,
} from "../apps/web/src/lib/server/api-rate-limit";

console.log("quotaTier,routeClass,limit,windowMs,windowSeconds");

const quotaTiers: ApiRateLimitQuotaTier[] = ["standard", "trusted_partner"];

for (const quotaTier of quotaTiers) {
  for (const policy of listApiRateLimitPolicies(quotaTier)) {
    console.log(
      [
        policy.quotaTier,
        policy.routeClass,
        String(policy.limit),
        String(policy.windowMs),
        String(policy.windowMs / 1_000),
      ].join(","),
    );
  }
}
