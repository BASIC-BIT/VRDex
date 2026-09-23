import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveContributionPolicy } from "../../convex/_contributionPolicy";
it("keeps ordinary production ceilings and refuses synthetic overrides outside dedicated identities", () => {
  assert.equal(resolveContributionPolicy({}).ordinary.openActor, 3);
  for (const identity of [
    undefined,
    "prod:real",
    "dev:ordinary",
    "anonymous:unknown",
  ])
    assert.throws(
      () =>
        resolveContributionPolicy({
          VRDEX_CONTRIBUTION_POLICY: "synthetic-v1",
          CONVEX_DEPLOYMENT: identity,
        }),
      /POLICY_IDENTITY_DENIED/,
    );
  const policy = resolveContributionPolicy({
    VRDEX_CONTRIBUTION_POLICY: "synthetic-v1",
    CONVEX_DEPLOYMENT: "local:contributor-capacity-proof",
  });
  assert.equal(policy.trusted.openActor, 1000);
  assert.equal(policy.ordinary.dailyActor, 200);
  assert.equal(policy.trusted.openTarget, 10);
});
