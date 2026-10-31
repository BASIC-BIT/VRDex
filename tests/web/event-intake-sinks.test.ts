import assert from "node:assert/strict";
import { it } from "node:test";
import { composeSinks, createLangfuseSink, createPostHogSink } from "../../packages/event-intake-agent/src/index";
const meta = { trigger: "discord" as const, actorUserId: "actor", draftId: "draft", connectorId: "c1", communitySlug: "club", mode: "hold" as const };
const generation = { turn: 1, model: "gpt-5.6-luna", request: { input: "Night" }, response: { output: [] }, inputTokens: 10, outputTokens: 5, latencyMs: 42 };
const result = { reason: "success", decision: { kind: "update" as const, slug: "friday-night" }, turns: 2, toolCalls: 1, durationMs: 42, inputTokens: 10, outputTokens: 5, costUsd: null };
it("posthog sink enqueues one event_intake_run on end and nothing per turn", async () => {
  const events: unknown[] = [];
  const run = createPostHogSink(async event => { events.push(event); }).start(meta);
  run.generation(generation); assert.equal(events.length, 0);
  await run.end(result);
  assert.deepEqual(events, [{ event: "event_intake_run", distinctId: "event_intake:draft", properties: { trigger: "discord", connector_id: "c1", community: "club", mode: "hold", decision: "update", reason: "success", turns: 2, tool_calls: 1, input_tokens: 10, output_tokens: 5, duration_ms: 42, cost_usd: null } }]);
});
it("composeSinks fans out and one failing end does not reject", async () => {
  const seen: string[] = [];
  const ok = { start: () => ({ generation: () => { seen.push("generation"); }, end: async () => { seen.push("end"); } }) };
  const bad = { start: () => ({ generation: () => { throw new Error("x"); }, end: async () => { throw new Error("x"); } }) };
  const run = composeSinks(bad, ok).start(meta);
  run.generation(generation); await run.end(result);
  assert.deepEqual(seen, ["generation", "end"]);
});
it("langfuse sink sends one ingestion batch with a trace and a generation per turn", async () => {
  const original = globalThis.fetch; const requests: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }); }) as typeof fetch;
  try {
    const run = createLangfuseSink({ publicKey: "pk-lf-test", secretKey: "sk-lf-test", baseUrl: "https://langfuse.test" }).start(meta);
    run.generation(generation); run.generation({ ...generation, turn: 2 }); await run.end(result);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, "https://langfuse.test/api/public/ingestion");
    const batch = requests[0]!.body.batch;
    assert.deepEqual(batch.map((e: { type: string }) => e.type), ["trace-create", "generation-create", "generation-create"]);
    assert.deepEqual(batch[0].body.tags.sort(), ["connector:c1", "discord", "hold", "update"]);
    assert.ok(batch.slice(1).every((e: any) => e.body.traceId === batch[0].body.id && e.body.model === "gpt-5.6-luna"));
    assert.deepEqual(batch[1].body.usageDetails, { input: 10, output: 5 });
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    const offline = createLangfuseSink({ publicKey: "pk-lf-test", secretKey: "sk-lf-test", baseUrl: "https://langfuse.test" }).start(meta);
    await offline.end(result);
  } finally { globalThis.fetch = original; }
});
