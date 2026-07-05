import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runMeRouteProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

describe("current API caller route", () => {
  it("requires a bearer credential", () => {
    const output = runMeRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/me/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/me"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^401/m);
    assert.match(output, /"title":"Bearer token required"/);
  });

  it("rejects bearer-token query parameters", () => {
    const output = runMeRouteProbe(`
      import { GET } from "./apps/web/src/app/api/v0/me/route.ts";

      const response = await GET(new Request("https://app.example.test/api/v0/me?token=secret"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  for (const route of [
    "me/profiles",
    "me/communities",
    "me/events",
  ]) {
    it(`requires a bearer credential for /api/v0/${route}`, () => {
      const output = runMeRouteProbe(`
        import { GET } from "./apps/web/src/app/api/v0/${route}/route.ts";

        const response = await GET(new Request("https://app.example.test/api/v0/${route}"));
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      `);

      assert.match(output, /^401/m);
      assert.match(output, /"title":"Bearer token required"/);
    });

    it(`rejects bearer-token query parameters for /api/v0/${route}`, () => {
      const output = runMeRouteProbe(`
        import { GET } from "./apps/web/src/app/api/v0/${route}/route.ts";

        const response = await GET(new Request("https://app.example.test/api/v0/${route}?access_token=secret"));
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      `);

      assert.match(output, /^400/m);
      assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
    });
  }
});
