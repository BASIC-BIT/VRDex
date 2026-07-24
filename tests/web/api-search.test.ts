import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runSearchRouteProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CONVEX_URL: "",
      NEXT_PUBLIC_CONVEX_URL: "",
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

describe("public API search route", () => {
  it("configures browser CORS for every /api/v0 route", () => {
    const output = runSearchRouteProbe(`
      import assert from "node:assert/strict";
      import nextConfig from "./apps/web/next.config.ts";

      const config = nextConfig.default ?? nextConfig;
      assert.equal(typeof config.headers, "function");
      const rules = await config.headers();
      const apiRule = rules.find((rule) => rule.source === "/api/v0/:path*");
      assert.ok(apiRule);

      const headers = new Map(apiRule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
      assert.equal(headers.get("access-control-allow-origin"), "*");
      assert.match(headers.get("access-control-allow-methods") ?? "", /\\bPATCH\\b/);
      assert.match(headers.get("access-control-allow-methods") ?? "", /\\bOPTIONS\\b/);
      assert.match(headers.get("access-control-allow-headers") ?? "", /\\bAuthorization\\b/);
      assert.match(headers.get("access-control-allow-headers") ?? "", /\\bIdempotency-Key\\b/);
      assert.match(headers.get("access-control-allow-headers") ?? "", /\\bX-VRDEX-Upload-Token\\b/);
      assert.doesNotMatch(headers.get("access-control-allow-headers") ?? "", /\\bCookie\\b/);
      assert.doesNotMatch(headers.get("access-control-allow-headers") ?? "", /\\bX-CSRF-Token\\b/);
      assert.doesNotMatch(headers.get("access-control-allow-headers") ?? "", /\\bX-Arbitrary-Client-Header\\b/);
      assert.match(headers.get("access-control-expose-headers") ?? "", /\\bRateLimit-Limit\\b/);
      assert.match(headers.get("access-control-expose-headers") ?? "", /\\bWWW-Authenticate\\b/);
      assert.equal(headers.get("access-control-max-age"), "600");
      assert.equal(headers.has("access-control-allow-credentials"), false);
      console.log("cors-ok");
    `);

    assert.match(output, /cors-ok/);
  });

  it("answers /api/v0 preflight requests before route dispatch", () => {
    const output = runSearchRouteProbe(`
      import { apiV0PreflightResponse } from "./apps/web/api-v0-cors.ts";

      const request = new Request("https://app.example.test/api/v0/events", {
        method: "OPTIONS",
      });
      const response = apiV0PreflightResponse(request);

      assert.ok(response);
      console.log(response.status);
      console.log(response.headers.get("access-control-allow-origin"));
      console.log(response.headers.get("access-control-allow-methods"));
      console.log(response.headers.get("access-control-allow-headers"));
      console.log(response.headers.get("access-control-max-age"));
    `);

    assert.match(output, /^204/m);
    assert.match(output, /^\*$/m);
    assert.match(output, /GET, HEAD, POST, PATCH, DELETE, OPTIONS/);
    assert.match(
      output,
      /Authorization, Content-Type, Idempotency-Key, If-None-Match, X-VRDEX-Upload-Token/,
    );
    assert.match(output, /^600$/m);
  });

  it("returns an empty response without touching Convex for empty queries", () => {
    const output = runSearchRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/search/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/search?q="));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"query":""/);
    assert.match(output, /"results":\[\]/);
  });

  it("returns a typed 503 problem when public search data is unavailable", () => {
    const output = runSearchRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/search/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/search?q=a&type=all&limit=1"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^503/m);
    assert.match(output, /"title":"Public search temporarily unavailable"/);
    assert.match(output, /"status":503/);
  });
});
