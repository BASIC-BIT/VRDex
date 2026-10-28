import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { NextRequest, NextResponse } from "../../apps/web/node_modules/next/server.js";
import config from "../../apps/web/playwright.config.mjs";

const clerkRequire = createRequire(realpathSync(new URL("../../apps/web/node_modules/@clerk/nextjs/dist/cjs/server/utils.js", import.meta.url)));
const { decorateRequest } = clerkRequire("./utils.js");
const { createClerkRequest } = clerkRequire("@clerk/backend/internal");

test("the local Playwright origin survives Next and Clerk middleware without an external self-rewrite", () => {
  const origin = config.use.baseURL;
  assert.equal(typeof origin, "string");
  const request = new NextRequest(origin, { headers: { host: new URL(origin).host } });
  // The real Clerk decorator runs after authentication; this signed-out fixture
  // exercises its rewrite only, without keys or provider requests.
  const response = decorateRequest(createClerkRequest(request), NextResponse.next(), { status: "signed-out" });
  assert.equal(new URL(response.headers.get("x-middleware-rewrite")).origin, new URL(origin).origin);
  const web = config.webServer.find(server => server.url === origin);
  assert.ok(web.command.includes("--hostname localhost"));
  assert.equal(config.webServer[0].port, 3210);
});

test("an explicit hosted target keeps its origin and starts no local servers", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e",
    'import config from "./apps/web/playwright.config.mjs"; console.log(JSON.stringify({ origin: config.use.baseURL, servers: config.webServer.length }));',
  ], { env: { ...process.env, PLAYWRIGHT_BASE_URL: "https://staging.example.test" }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), { origin: "https://staging.example.test", servers: 0 });
});
