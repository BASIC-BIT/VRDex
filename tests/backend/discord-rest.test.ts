import assert from "node:assert/strict";
import { afterEach, beforeEach, it, type TestContext } from "node:test";
import { DISCORD_BOT_PERMISSIONS, discordRequest } from "../../convex/_discordRest";

beforeEach(() => { process.env.DISCORD_BOT_TOKEN = "test-bot-token"; });
afterEach(() => { delete process.env.DISCORD_BOT_TOKEN; delete process.env.DISCORD_REST_BOT_TOKEN; });

type Seen = { url: string; init: RequestInit };
function fakeFetch(test: TestContext, responses: Array<() => Response>) {
  const seen: Seen[] = [];
  test.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return (responses[seen.length - 1] ?? (() => new Response(null, { status: 204 })))();
  });
  return seen;
}
const limited = (retryAfter: string) => () => new Response("{\"secret\":\"body\"}", { status: 429, headers: { "Retry-After": retryAfter } });

it("sends the bot token and a JSON body to the v10 API", async (test) => {
  const seen = fakeFetch(test, [() => Response.json({ id: "1" })]);
  const response = await discordRequest({ method: "POST", path: "/channels/1/messages", body: { content: "x" } });
  assert.equal(response.status, 200);
  assert.equal(seen[0].url, "https://discord.com/api/v10/channels/1/messages");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.headers, { Authorization: "Bot test-bot-token", "Content-Type": "application/json" });
  assert.equal(seen[0].init.body, "{\"content\":\"x\"}");
});

it("omits the body and content type without a body, and prefers an explicit token", async (test) => {
  const seen = fakeFetch(test, []);
  await discordRequest({ method: "DELETE", path: "/channels/1/messages/2", token: "other" });
  assert.deepEqual(seen[0].init.headers, { Authorization: "Bot other" });
  assert.equal(seen[0].init.body, undefined);
});

it("sends DISCORD_REST_BOT_TOKEN over DISCORD_BOT_TOKEN, and an explicit token over both", async (test) => {
  process.env.DISCORD_REST_BOT_TOKEN = "rest-bot-token";
  const seen = fakeFetch(test, []);
  await discordRequest({ method: "GET", path: "/x" });
  await discordRequest({ method: "GET", path: "/x", token: "other" });
  assert.deepEqual(seen.map(({ init }) => init.headers), [{ Authorization: "Bot rest-bot-token" }, { Authorization: "Bot other" }]);
});

it("throws a short code when no token is configured", async (test) => {
  const seen = fakeFetch(test, []);
  delete process.env.DISCORD_BOT_TOKEN;
  await assert.rejects(discordRequest({ method: "GET", path: "/x" }), { message: "DISCORD_BOT_TOKEN_MISSING" });
  assert.equal(seen.length, 0);
});

it("waits out a short Retry-After and retries", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = fakeFetch(test, [limited("1.5"), () => Response.json({ id: "1" })]);
  const pending = discordRequest({ method: "GET", path: "/x" });
  await new Promise(setImmediate);
  assert.equal(seen.length, 1);
  test.mock.timers.tick(1_500);
  assert.equal((await pending).status, 200);
  assert.equal(seen.length, 2);
});

it("throws on a Retry-After over 5 seconds without retrying or leaking the body", async (test) => {
  const seen = fakeFetch(test, [limited("6")]);
  await assert.rejects(discordRequest({ method: "GET", path: "/x" }), { message: "discord_rate_limited" });
  assert.equal(seen.length, 1);
});

it("stops after 3 attempts", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = fakeFetch(test, [limited("0"), limited("0"), limited("0"), () => Response.json({})]);
  const pending = discordRequest({ method: "GET", path: "/x" });
  const outcome = assert.rejects(pending, { message: "discord_rate_limited" });
  for (let i = 0; i < 3; i++) { await new Promise(setImmediate); test.mock.timers.tick(0); }
  await outcome;
  assert.equal(seen.length, 3);
});

it("bot permissions are exactly the board and events bits", () => {
  const bits = [10, 11, 13, 14, 16, 33, 44].reduce((sum, bit) => sum + 2 ** bit, 0);
  assert.equal(DISCORD_BOT_PERMISSIONS, bits);
  assert.equal(DISCORD_BOT_PERMISSIONS, 17600776072192);
});
