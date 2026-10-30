import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createDiscordPosterBridge, handleDiscordPosterRequest } from "../../apps/web/src/lib/server/discord-intake-posters";

const png = Buffer.from([137, 80, 78, 71]);
const input = { actorUserId: "u" as never, draftId: "d" as never, url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: png.length };
const TOKEN = "p".repeat(40);
const post = (body: unknown, token = TOKEN) => new Request("https://vrdex.test/api/internal/discord-intake/poster", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

it("refuses URLs off the Discord CDN without fetching", async () => {
  let fetched = 0;
  const bridge = createDiscordPosterBridge({ fetch: async () => { fetched += 1; return new Response(png); } });
  for (const url of ["https://evil.example/f.png", "http://cdn.discordapp.com/f.png", "https://cdn.discordapp.com.evil.example/f.png"])
    await assert.rejects(bridge.store({ ...input, url }), /POSTER_URL_REFUSED/);
  assert.equal(fetched, 0);
});

it("stores Discord bytes through begin, an upload-key put, and complete", async () => {
  const calls: string[] = [];
  const bridge = createDiscordPosterBridge({
    fetch: async (_url, init) => { assert.equal(init?.redirect, "error"); return new Response(png); },
    admin: { mutation: async (_ref: unknown, args: { sha256: string }) => { calls.push(`begin:${args.sha256}`); return { posterAssetId: "p1", uploadStorageKey: "up/key" }; } } as never,
    put: async ({ storageKey }) => { calls.push(`put:${storageKey}`); },
    handlers: () => ({ completePosterUpload: async ({ posterAssetId }) => { calls.push(`complete:${posterAssetId}`); return {} as never; }, readPoster: async () => "" }),
  });
  assert.deepEqual(await bridge.store(input), { posterAssetId: "p1" });
  assert.deepEqual(calls, [`begin:${createHash("sha256").update(png).digest("hex")}`, "put:up/key", "complete:p1"]);
});

it("rejects a body whose size differs from the declared attachment size", async () => {
  const bridge = createDiscordPosterBridge({ fetch: async () => new Response(png) });
  await assert.rejects(bridge.store({ ...input, byteLength: png.length + 1 }), /POSTER_SOURCE_MISMATCH/);
});

it("hands a large prepared poster back as a short-lived link, not in the response body", async () => {
  process.env.VRDEX_DISCORD_POSTER_TOKEN = TOKEN;
  const display = Buffer.alloc(3_500_000, 7);
  const dataUrl = `data:image/webp;base64,${display.toString("base64")}`;
  const puts: Array<{ storageKey: string; body: Uint8Array; contentType: string }> = [];
  const bridge = createDiscordPosterBridge({
    put: async (upload) => { puts.push(upload); },
    presign: async (storageKey) => `https://bucket.example/${storageKey}?X-Amz-Signature=sig`,
    handlers: () => ({ completePosterUpload: async () => ({}) as never, readPoster: async () => dataUrl }),
  });
  const response = await handleDiscordPosterRequest(post({ op: "read", actorUserId: "u", posterAssetId: "p1" }), bridge);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.length < 4_096, `response is ${text.length} characters`);
  const { url, mimeType } = JSON.parse(text);
  assert.equal(puts.length, 1);
  assert.match(puts[0]!.storageKey, /^profile-assets\/quarantine\//);
  assert.equal(url, `https://bucket.example/${puts[0]!.storageKey}?X-Amz-Signature=sig`);
  // Convex rebuilds the data URL from the linked bytes; it must equal what readPoster returned.
  assert.equal(`data:${mimeType};base64,${Buffer.from(puts[0]!.body).toString("base64")}`, dataUrl);
});

it("answers 401 without the token and 400 for an unknown op", async () => {
  process.env.VRDEX_DISCORD_POSTER_TOKEN = TOKEN;
  const bridge = createDiscordPosterBridge({ handlers: () => { throw new Error("unreachable"); } });
  assert.equal((await handleDiscordPosterRequest(post({ op: "read" }, "x".repeat(40)), bridge)).status, 401);
  assert.equal((await handleDiscordPosterRequest(post({ op: "delete", actorUserId: "u" }), bridge)).status, 400);
});
