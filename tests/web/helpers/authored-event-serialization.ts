import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { GET } from "../../../apps/web/src/app/api/v0/events/[slug]/route";
import { createVrdexMcpHandler } from "../../../apps/web/src/lib/server/vrdex-mcp";

async function main() {
const event = JSON.parse(readFileSync(0, "utf8"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://fixture.convex.cloud/")) {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.path, "events:getPublicBySlug");
    assert.equal(body.args[0].slug, event.slug);
    return new Response(JSON.stringify({ status: "success", value: event }), { headers: { "content-type": "application/json" } });
  }
  return originalFetch(url, init);
};
const context = { params: Promise.resolve({ slug: event.slug }) };
const response = await GET(new Request(`http://localhost/api/v0/events/${event.slug}`), context);
assert.equal(response.status, 200);
const serialized = await response.json();
assert.deepEqual(serialized.slots, event.slots);
assert.deepEqual(serialized.participants, event.participants);
const handler = createVrdexMcpHandler({ convex: { query: async (_ref, args) => {
  assert.equal(args.slug, event.slug);
  return event;
} } });
const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vrdex_get_event", arguments: { slug: event.slug } } };
const hosted = await handler.fetch(new Request("http://localhost/mcp", { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify(request) }));
assert.equal(hosted.status, 200);
const hostedText = await hosted.text();
const hostedJson = JSON.parse(hostedText.startsWith("event:") || hostedText.startsWith("data:") ? hostedText.split("\n").find(line => line.startsWith("data: "))!.slice(6) : hostedText);
assert.deepEqual(hostedJson.result.structuredContent.slots, event.slots);
const server = createServer(async (req, res) => {
  assert.equal(req.url, `/api/v0/events/${event.slug}`);
  const route = await GET(new Request(`http://localhost${req.url}`), context);
  res.writeHead(route.status, { "content-type": "application/json" });
  res.end(await route.text());
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const child = spawn(process.execPath, ["--import", "tsx", "packages/vrdex-mcp/src/stdio.ts"], { env: { ...process.env, VRDEX_API_BASE_URL: `http://127.0.0.1:${address.port}`, VRDEX_API_TOKEN: "" }, stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout });
try {
  const reply = new Promise<{ error?: unknown; result: { structuredContent: { slots: unknown; participants: unknown } } }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdio timeout")), 15000);
    lines.on("line", line => {
      const data = JSON.parse(line);
      if (data.id === 1) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        child.stdin.write(JSON.stringify(request) + "\n");
      }
      if (data.id === 2) { clearTimeout(timer); resolve(data); }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "controlled-story", version: "1" } } }) + "\n");
  const result = await reply;
  assert.equal(result.error, undefined);
  assert.deepEqual(result.result.structuredContent.slots, event.slots);
  assert.deepEqual(result.result.structuredContent.participants, event.participants);
} finally {
  lines.close();
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  child.kill();
  await closed;
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = originalFetch;
}
console.log("authored event serialization passed");

}
void main();
