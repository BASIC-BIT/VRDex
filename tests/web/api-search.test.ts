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
