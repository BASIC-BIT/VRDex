import assert from "node:assert/strict";
import { it } from "node:test";
import { timelineFixtureBoundary } from "../../apps/web/src/lib/timeline/fixture-boundary";
it("requires both loopback URLs, explicit enablement and matching browser token plus secret", () => {
  const env = {
    NODE_ENV: "development",
    VERCEL_ENV: "development",
    VRDEX_ENABLE_E2E_HELPERS: "true",
    VRDEX_E2E_BROWSER_TOKEN: "token",
    VRDEX_E2E_CONVEX_SECRET: "secret",
    CONVEX_URL: "http://127.0.0.1:3210",
  };
  const target = "http://127.0.0.1:3002/api/e2e/home-timeline";
  assert.deepEqual(timelineFixtureBoundary(env, target, "token"), {
    url: env.CONVEX_URL,
    secret: "secret",
  });
  for (const patch of [
    { NODE_ENV: "production" },
    { VERCEL_ENV: "production" },
    { VRDEX_ENABLE_E2E_HELPERS: "false" },
    { VRDEX_E2E_BROWSER_TOKEN: "" },
    { VRDEX_E2E_CONVEX_SECRET: "" },
    { CONVEX_URL: "https://host.convex.cloud" },
    { CONVEX_URL: "https://127.0.0.1.evil.test" },
    { CONVEX_URL: "" },
  ])
    assert.equal(
      timelineFixtureBoundary({ ...env, ...patch }, target, "token"),
      null,
    );
  for (const token of [null, "", "wrong"])
    assert.equal(timelineFixtureBoundary(env, target, token), null);
  assert.equal(
    timelineFixtureBoundary(
      env,
      "https://vrdex.net/api/e2e/home-timeline",
      "token",
    ),
    null,
  );
});
