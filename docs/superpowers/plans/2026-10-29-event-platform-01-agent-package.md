# Event Platform 01: Agent Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the event intake agent into `@vrdex/event-intake-agent`, give it a `decision`, the `list_events` and `get_event` tools, run context, and Langfuse and PostHog sinks, and add the product analytics outbox that carries `event_intake_run` to PostHog.

**Architecture:** The agent file moves unchanged into a source-only workspace package (like `packages/api-contracts`); the web host keeps `createEventIntakeExtractor` and imports the package by name, Convex hosts (plan 03) import it by relative path the way `convex/*.ts` already import `../packages/api-contracts/src/...`. The `record` console hook becomes the master plan's `EventIntakeSink`. PostHog delivery reuses the claim analytics pattern (lease, retry, five-minute cron) on a new generic `productAnalyticsOutbox` table.

**Tech Stack:** TypeScript, zod 4 (`z.toJSONSchema`), OpenAI Responses API via injected `fetch`, `@langfuse/client` 5.x (`LangfuseClient.api.ingestion.batch`), Convex (`convex-test`), `node:test` via `tsx`, Terraform (Vercel provider).

**Spec:** `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md` (sections The run > Agent changes, Observability, Runtime and deployment) and the interface contract in `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Every name, signature, table, and env var in the master plan's "Package `@vrdex/event-intake-agent` (plan 01)" block is fixed; copy it verbatim into `packages/event-intake-agent/src/index.ts`.
- Agent budget: 6 turns, 5 tool calls, 20 s per model call, model from `VRDEX_EVENT_INTAKE_MODEL` (default `gpt-5.6-luna`), gated by `VRDEX_EVENT_INTAKE_AI_ENABLED`. The loop allows one tool call per turn, so all five calls fit and the sixth turn answers.
- Discord message text is capped at 12,000 characters. Prepared poster data URLs are capped at 20,000,000 characters (both unchanged).
- Existing web and MCP callers pass no `context` and receive `decision: { kind: "new" }` and the same tool list and instructions they get today.
- Missing Langfuse keys disable tracing and never fail a run. No sink error may change the candidate a run returns.
- No public-facing copy ships in this plan. Model instructions and tool descriptions are model-facing, not public copy.
- Every new env var is documented by name, scope, owner, and rotation path in `docs/deployment/convex-environments.md` and declared in `infra/terraform/vercel/`.
- Tests: `tests/web` and `tests/backend` run under `node:test` through `tsx` (`pnpm test:web`, `pnpm test:backend`). Follow each file's existing style.
- Markdown passes `pnpm exec markdownlint-cli2`. No bare angle-bracket placeholders outside fenced code (docs are published).
- Work in a worktree off `origin/main`; the shared checkout gets branch-switched under you.
- Commit per task with a conventional-commit subject; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A model that returns `decision.update` with a slug it never got from `list_events` in this run (invented, or remembered from a prior run) must not be treated as an update: the run returns `{ kind: "new" }` plus a `decision.slug` / `unresolved_event` question (Task 3 test).
2. A Langfuse or PostHog outage, a throwing sink, or missing Langfuse keys must leave the extraction result unchanged (Task 4 broken-sink test, Task 6 missing-keys test).
3. A run with a poster must not ship the up-to-20 MB data URL to Langfuse (ingestion batches cap at 3.5 MB); generations carry a redacted request (Task 4 test).
4. Web and MCP callers must see no new tools, no new instructions, and `decision: new` even if the model answers `update` (Task 2 and Task 3 tests).
5. An outbox row whose delivery action dies mid-lease must be retried, and a row that fails five times must stop (Task 5 test).

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/event-intake-agent/package.json` | Workspace package `@vrdex/event-intake-agent`, `exports: { ".": "./src/index.ts" }`, dependency `@langfuse/client` |
| `packages/event-intake-agent/src/index.ts` | The agent (moved), contract types, model price table and `estimateCostUsd`, re-exports sinks |
| `packages/event-intake-agent/src/sinks.ts` | `createLangfuseSink`, `createPostHogSink`, `composeSinks` |
| `apps/web/src/lib/server/event-intake-agent.ts` | Only `createEventIntakeExtractor` (web host wiring) |
| `packages/api-contracts/src/event-intake.ts` | `decision` on the candidate, `"connector"` evidence origin, `EventIntakeDecision` type |
| `convex/_productAnalytics.ts` | `enqueueProductAnalytics` |
| `convex/productAnalytics.ts` | Outbox claim, success, failure mutations; web-host `enqueue` |
| `convex/productAnalyticsDelivery.ts` | `"use node"` `deliverPending` action |
| `tests/web/event-intake-agent.test.ts` | Existing agent tests (repointed) plus decision, tool, context, sink-call, web-host tests |
| `tests/web/event-intake-sinks.test.ts` | Sink implementation tests |
| `tests/backend/product-analytics.test.ts` | Outbox enqueue and delivery tests |

---

### Task 1: Move the agent into `@vrdex/event-intake-agent`

**Files:**

- Create: `packages/event-intake-agent/package.json`
- Move: `apps/web/src/lib/server/event-intake-agent.ts` lines 1-142 to `packages/event-intake-agent/src/index.ts`
- Modify: `apps/web/src/lib/server/event-intake-agent.ts` (keeps lines 144-168, `createEventIntakeExtractor`)
- Modify: `apps/web/package.json` (dependency), `apps/web/next.config.ts:34` (`transpilePackages`)
- Test: `tests/web/event-intake-agent.test.ts:6`, `:119`

**Interfaces:**

- Produces: `extractEventIntake`, `resolveIntakeLocalTime`, `EventIntakeAgentInput` (renamed from the file-local `Input`), `EventIntakeAgentDependencies` exported from `packages/event-intake-agent/src/index.ts`. Web code imports `from "@vrdex/event-intake-agent"`; tests and Convex import by relative path `packages/event-intake-agent/src/index`.

- [ ] **Step 1: Repoint the tests at the package**

In `tests/web/event-intake-agent.test.ts` change both agent imports (line 6 static, line 119 dynamic) from `../../apps/web/src/lib/server/event-intake-agent` to `../../packages/event-intake-agent/src/index`. Leave the poster storage, spam, and storage-bridge tests in this file untouched.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `packages/event-intake-agent/src/index`.

- [ ] **Step 3: Create the package and move the file**

`git mv` the agent file to `packages/event-intake-agent/src/index.ts`, then recreate `apps/web/src/lib/server/event-intake-agent.ts` holding only `createEventIntakeExtractor` with `import { extractEventIntake, type EventIntakeAgentInput } from "@vrdex/event-intake-agent";`. In the package file, the api-contracts import becomes `../../api-contracts/src/event-intake` (relative, the Convex-compatible pattern; `@vrdex/api-contracts` has no `event-intake` subpath export). `package.json` mirrors `packages/api-contracts/package.json`: `"name": "@vrdex/event-intake-agent"`, `"private": true`, `"type": "module"`, `"license": "MIT"`, `"version": "0.0.0"`, `"exports": { ".": "./src/index.ts" }`, no scripts. Add `"@vrdex/event-intake-agent": "workspace:*"` to `apps/web/package.json` dependencies and to `transpilePackages` in `apps/web/next.config.ts`. Run `pnpm install`. The workspace glob `packages/*` in `pnpm-workspace.yaml` already covers it.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-api.test.ts && pnpm typecheck:web`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/event-intake-agent apps/web/src/lib/server/event-intake-agent.ts apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml tests/web/event-intake-agent.test.ts
git commit -m "refactor: move event intake agent into @vrdex/event-intake-agent" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: `decision` on the candidate and the `connector` evidence origin

**Files:**

- Modify: `packages/api-contracts/src/event-intake.ts:13` (evidence origin), `:84-97` (candidate schema, JSON schema, types)
- Modify: `packages/event-intake-agent/src/index.ts` (`fallback`, `revalidate`)
- Modify: `docs/api/openapi.json`, `docs/api/openapi.yaml` (regenerated)
- Test: `packages/api-contracts/tests/event-intake.test.ts:41-50`, `tests/web/event-intake-agent.test.ts`

**Interfaces:**

- Consumes: Task 1 package.
- Produces: `EventIntakeCandidate.decision: { kind: "new" } | { kind: "update"; slug: string } | { kind: "not_event"; reason: string }`; `export type EventIntakeDecision = EventIntakeCandidate["decision"]` from `packages/api-contracts/src/event-intake.ts`; evidence `origin` enum `["text", "poster", "lookup", "calculation", "connector"]`.

- [ ] **Step 1: Write the failing contract test**

Add `decision: { kind: "new" }` to the `candidate` fixture in the existing test "bounds private candidate evidence and identifies poster and date provenance", then add:

```ts
it("requires a decision and offers it to the model as a strict anyOf", () => {
  const candidate = { event: { title: null, communitySlug: null, eventDate: null, start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [{ fieldPath: "event.title", origin: "connector", excerpt: "Night", assessment: "explicit" }], questions: [], decision: { kind: "new" } };
  assert.equal(EventIntakeCandidateSchema.safeParse(candidate).success, true);
  for (const decision of [{ kind: "update", slug: "friday-night" }, { kind: "not_event", reason: "chatter" }])
    assert.equal(EventIntakeCandidateSchema.safeParse({ ...candidate, decision }).success, true);
  for (const decision of [undefined, { kind: "update" }, { kind: "new", slug: "x" }, { kind: "maybe" }])
    assert.equal(EventIntakeCandidateSchema.safeParse({ ...candidate, decision }).success, false);
  const json = EventIntakeCandidateJsonSchema as unknown as { required: string[]; properties: { decision: { anyOf: unknown[] } } };
  assert.ok(json.required.includes("decision"));
  assert.equal(json.properties.decision.anyOf.length, 3);
  assert.ok(!JSON.stringify(json).includes("oneOf"));
  assert.ok(!JSON.stringify(json).includes("\"default\""));
});
```

In `tests/web/event-intake-agent.test.ts`, add `decision: { kind: "new" as const }` to `blank()` (line 8) so existing model fixtures stay valid, then add:

```ts
it("defaults decision to new without run context, even when the model answers update", async () => {
  const result = await extractEventIntake({ draftId: "draft", sourceText: "Night" }, { ...base, fetchImplementation: async () => response({ ...blank(), decision: { kind: "update", slug: "friday-night" } }) });
  assert.deepEqual(result.decision, { kind: "new" });
  const unavailable = await extractEventIntake({ draftId: "draft", sourceText: "Night" }, { ...base, apiKey: "" });
  assert.deepEqual(unavailable.decision, { kind: "new" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test packages/api-contracts/tests/event-intake.test.ts tests/web/event-intake-agent.test.ts`
Expected: FAIL (`decision` unknown to the strict schema; `result.decision` undefined).

- [ ] **Step 3: Implement**

Add `decision` to `EventIntakeCandidateSchema` with `z.union([z.strictObject({ kind: z.literal("new") }), z.strictObject({ kind: z.literal("update"), slug: text(64).min(1) }), z.strictObject({ kind: z.literal("not_event"), reason: text(200).min(1) })])`. Use `z.union`, not `z.discriminatedUnion`, and no `.default()`: OpenAI strict mode accepts `anyOf` with every property required, and the test pins that shape. `EventIntakeCandidateJsonSchema` stays `z.toJSONSchema(EventIntakeCandidateSchema)` and regenerates itself. In the agent, `fallback()` returns `decision: { kind: "new" }`, and `revalidate` sets `candidate.decision = { kind: "new" }` when `input.context` is absent (pass a `hasContext: boolean` argument).

- [ ] **Step 4: Regenerate OpenAPI and run tests**

Run: `pnpm generate:api-openapi && node --import tsx --test packages/api-contracts/tests/event-intake.test.ts tests/web/event-intake-agent.test.ts tests/web/event-intake-source.test.ts && pnpm test:vrdex-mcp && pnpm typecheck:web`
Expected: PASS. `git diff --stat docs/api` shows only `openapi.json` and `openapi.yaml`; the content diff is the `decision` property and the `connector` enum value. On Windows `check:api-openapi` reports stale because of CRLF, not the spec; judge by the content diff.

- [ ] **Step 5: Commit**

```bash
git add packages/api-contracts packages/event-intake-agent docs/api tests/web/event-intake-agent.test.ts
git commit -m "feat(event-intake): add decision and connector evidence origin to the candidate" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Run context, `list_events`, `get_event`, and the five-call budget

**Files:**

- Modify: `packages/event-intake-agent/src/index.ts`
- Test: `tests/web/event-intake-agent.test.ts`

**Interfaces:**

- Consumes: `EventIntakeDecision`, `EventIntakeFields` from `packages/api-contracts/src/event-intake.ts`.
- Produces (master contract, verbatim): `EventIntakeTrigger`, `EventIntakeRunContext` (including `mode?: "hold" | "autopublish"`), `EventIntakeAgentInput` with `context?`, `EventListRow`, and `EventIntakeAgentDependencies` gaining `list_events?: (limit: number) => Promise<EventListRow[]>` and `get_event?: (slug: string) => Promise<EventIntakeFields | null>`. Plan 03 supplies both callbacks; the agent trusts the host for scope (community window, prior events) and enforces only arguments and slug provenance.

- [ ] **Step 1: Write the failing tests**

Add near the top of the test file:

```ts
const toolCall = (name: string, args: unknown, id = name) => new Response(JSON.stringify({ status: "completed", output: [{ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) }] }));
const rows = [{ slug: "friday-night", title: "Friday Night", eventDate: "2026-11-06", start: "21:00", lineupSummary: "DJ A, DJ B" }];
const discord = { trigger: "discord" as const, communitySlug: "club", connectorId: "connector" };
```

Then:

```ts
it("offers list_events and get_event and the decision rules only with run context", async () => {
  const seen: { tools: string[]; instructions: string }[] = [];
  const deps = { ...base, list_events: async () => rows, get_event: async () => null, fetchImplementation: async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); seen.push({ tools: body.tools.map((t: { name: string }) => t.name), instructions: body.instructions }); return response(blank());
  } };
  await extractEventIntake({ draftId: "draft", sourceText: "Night" }, deps);
  await extractEventIntake({ draftId: "draft", sourceText: "Night", context: discord }, deps);
  assert.deepEqual(seen[0]!.tools, ["search_people", "search_communities", "resolve_local_time"]);
  assert.deepEqual(seen[1]!.tools, ["search_people", "search_communities", "resolve_local_time", "list_events", "get_event"]);
  assert.doesNotMatch(seen[0]!.instructions, /list_events/);
  assert.match(seen[1]!.instructions, /may only come from list_events/);
});
it("accepts an update slug only when list_events returned it in this run", async () => {
  const update = { ...blank(), decision: { kind: "update", slug: "friday-night" } };
  const invented = await extractEventIntake({ draftId: "draft", sourceText: "Friday moves to 22:00", context: discord }, { ...base, list_events: async () => rows, fetchImplementation: async () => response(update) });
  assert.deepEqual(invented.decision, { kind: "new" });
  assert.ok(invented.questions.some(q => q.fieldPath === "decision.slug" && q.reason === "unresolved_event"));
  let limit = 0, turn = 0;
  const listed = await extractEventIntake({ draftId: "draft", sourceText: "Friday moves to 22:00", context: discord }, { ...base, list_events: async (n: number) => { limit = n; return rows; }, fetchImplementation: async () => ++turn === 1 ? toolCall("list_events", { limit: 40 }) : response(update) });
  assert.equal(limit, 40);
  assert.deepEqual(listed.decision, { kind: "update", slug: "friday-night" });
});
it("keeps not_event with run context", async () => {
  const result = await extractEventIntake({ draftId: "draft", sourceText: "anyone around tonight?", context: discord }, { ...base, fetchImplementation: async () => response({ ...blank(), decision: { kind: "not_event", reason: "chatter" } }) });
  assert.deepEqual(result.decision, { kind: "not_event", reason: "chatter" });
});
it("rejects list_events limits outside 1 to 40 before the callback", async () => {
  let lookups = 0;
  for (const limit of [0, 41, 2.5]) {
    const result = await extractEventIntake({ draftId: "draft", sourceText: "x", context: discord }, { ...base, list_events: async () => { lookups++; return rows; }, fetchImplementation: async () => toolCall("list_events", { limit }) });
    assert.equal(result.questions[0]?.reason, "invalid_tool");
  }
  assert.equal(lookups, 0);
});
it("serves get_event only for slugs list_events returned", async () => {
  const asked: string[] = []; const outputs: string[] = []; let turn = 0;
  const script = [toolCall("get_event", { slug: "unlisted" }, "a"), toolCall("list_events", { limit: 5 }, "b"), toolCall("get_event", { slug: "friday-night" }, "c")];
  await extractEventIntake({ draftId: "draft", sourceText: "Friday", context: discord }, { ...base, list_events: async () => rows,
    get_event: async (slug: string) => { asked.push(slug); return { title: "Friday Night", eventDate: "2026-11-06" }; },
    fetchImplementation: async (_url: unknown, init: RequestInit) => {
      const input = JSON.parse(String(init.body)).input; const last = input[input.length - 1];
      if (last?.type === "function_call_output") outputs.push(last.output);
      return script[turn++] ?? response(blank());
    } });
  assert.deepEqual(asked, ["friday-night"]);
  assert.match(outputs[0]!, /unlisted_event/);
  assert.match(outputs[2]!, /Friday Night/);
});
it("tells the agent which events these messages already produced", async () => {
  let content: { type: string; text?: string }[] = [];
  await extractEventIntake({ draftId: "draft", sourceText: "Night", context: { ...discord, priorEvents: [{ sourceMessageId: "123456789012345678", eventSlug: "friday-night" }] } }, { ...base, fetchImplementation: async (_url: unknown, init: RequestInit) => { content = JSON.parse(String(init.body)).input[0].content; return response(blank()); } });
  assert.equal(content[0]!.text, "Night");
  assert.match(content[1]!.text!, /123456789012345678/);
  assert.match(content[1]!.text!, /friday-night/);
});
```

Rename the existing test "caps the loop at three tools and four model turns" to "caps the loop at five tools and six model turns" and change its assertion to `assert.equal(calls,5);assert.equal(turns,6);` (five calls, then the sixth turn runs with `tool_choice: "none"` and the fixture's further call hits `tool_budget`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts`
Expected: FAIL (tools absent, `decision.update` not revalidated, budget test sees 3 calls).

- [ ] **Step 3: Implement in `packages/event-intake-agent/src/index.ts`**

- Export the master contract types listed under Interfaces verbatim; `EventIntakeAgentInput` replaces `Input`.
- Tool budget constant 5 (both the `tool_choice: "none"` threshold and the `tool_budget` throw). Turn cap 6 (was 4).
- Tools `list_events` (`parameters: object({ limit: { type: "integer", minimum: 1, maximum: 40 } })`, description `"List this community's events from seven days ago to ninety days ahead, plus events these messages already produced."`) and `get_event` (`parameters: object({ slug: string })`, description `"Return the current public fields of one event that list_events returned."`) are appended to the request's `tools` only when `input.context` is set and the matching dependency exists.
- `list_events` args: exactly the key `limit`, integer 1 to 40, else `invalid_tool`. Output: `rows.slice(0, limit)` keeping rows whose `slug` is a string of at most 64 characters, with `title` cut to 120 and `lineupSummary` to 200 characters; each slug joins a per-run `events: Set<string>`.
- `get_event` args: exactly the key `slug`, string of 1 to 64 characters, else `invalid_tool`. A slug not in `events` returns tool output `{ event: null, reason: "unlisted_event" }` without calling the dependency; otherwise `{ event: await deps.get_event(slug) }`.
- With `input.context`, append to `instructions`: `" A decision.update slug may only come from list_events. Prefer update when a message in this run already produced that event, or when title, date, and community match a listed event. Choose not_event for chatter, reminders with no new facts, and messages about events in other communities. When updating, call get_event first and output the complete resulting lineup with the change applied."`
- With `context.priorEvents` non-empty, insert a second `input_text` part after the source text: `` `Events these messages already produced: ${JSON.stringify(context.priorEvents)}` `` (before the poster image).
- `revalidate` gains the `events` set: an `update` whose slug is not in it becomes `{ kind: "new" }` and asks `("decision.slug", "unresolved_event", [slug])`.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts && pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/event-intake-agent tests/web/event-intake-agent.test.ts
git commit -m "feat(event-intake): add run context with list_events and get_event tools" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Sinks replace the `record` hook

**Files:**

- Create: `packages/event-intake-agent/src/sinks.ts`
- Modify: `packages/event-intake-agent/src/index.ts`, `packages/event-intake-agent/package.json`, `apps/web/src/lib/server/event-intake-agent.ts` (drop the `record:` line)
- Test: `tests/web/event-intake-agent.test.ts`, `tests/web/event-intake-sinks.test.ts`

**Interfaces:**

- Produces (master contract, verbatim): `EventIntakeRunMeta`, `EventIntakeGeneration`, `EventIntakeRunResult`, `EventIntakeRunHandle`, `EventIntakeSink`, `sink?: EventIntakeSink` on dependencies (replacing `record`), `createLangfuseSink(options: { publicKey: string; secretKey: string; baseUrl?: string }): EventIntakeSink`, `createPostHogSink(enqueue: (event: { event: "event_intake_run"; distinctId: string; properties: Record<string, unknown> }) => Promise<void>): EventIntakeSink`, `composeSinks(...sinks: EventIntakeSink[]): EventIntakeSink`. Package-internal: `EVENT_INTAKE_MODEL_PRICES: Record<string, { inputPerMillion: number; outputPerMillion: number }>` and `estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null` in `src/index.ts`.
- PostHog properties are snake_case and omit absent values: `trigger`, `connector_id`, `mode`, `decision` (the kind), `reason`, `turns`, `tool_calls`, `input_tokens`, `output_tokens`, `duration_ms`, `cost_usd`, and `community` from `meta.communitySlug` (`EventIntakeRunMeta` gains `communitySlug?: string`; the web host leaves it undefined, Convex hosts set it).

- [ ] **Step 1: Write the failing agent-side tests**

```ts
import { EVENT_INTAKE_MODEL_PRICES } from "../../packages/event-intake-agent/src/index";
const usage = (body: unknown) => { const value = JSON.parse(JSON.stringify(body)); value.usage = { input_tokens: 1000, output_tokens: 200 }; return new Response(JSON.stringify(value)); };
const capture = () => { const log = { metas: [] as unknown[], generations: [] as any[], ends: [] as any[] };
  return { log, sink: { start(meta: unknown) { log.metas.push(meta); return { generation(g: unknown) { log.generations.push(g); }, async end(r: unknown) { log.ends.push(r); } }; } } }; };
it("reports one generation per model turn and ends once with cost", async () => {
  const { log, sink } = capture(); let turn = 0;
  const final = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(blank()) }] }] };
  const call = { status: "completed", output: [{ type: "function_call", name: "search_people", call_id: "a", arguments: JSON.stringify({ query: "DJ", limit: 1 }) }] };
  await extractEventIntake({ draftId: "draft", sourceText: "Night", posterAssetId: "poster" }, { ...base, model: "gpt-5.6-luna", sink, readPoster: async () => "data:image/png;base64,AAAA", fetchImplementation: async () => usage(++turn === 1 ? call : final) });
  assert.deepEqual(log.metas, [{ trigger: "web", actorUserId: "actor", draftId: "draft" }]);
  assert.deepEqual(log.generations.map(g => [g.turn, g.model, g.inputTokens, g.outputTokens]), [[1, "gpt-5.6-luna", 1000, 200], [2, "gpt-5.6-luna", 1000, 200]]);
  assert.ok(log.generations.every(g => typeof g.latencyMs === "number"));
  assert.ok(!JSON.stringify(log.generations).includes("base64,"));
  assert.equal(log.ends.length, 1);
  const price = EVENT_INTAKE_MODEL_PRICES["gpt-5.6-luna"]!;
  assert.deepEqual({ ...log.ends[0], durationMs: 0 }, { reason: "success", decision: { kind: "new" }, turns: 2, toolCalls: 1, durationMs: 0, inputTokens: 2000, outputTokens: 400, costUsd: (2000 * price.inputPerMillion + 400 * price.outputPerMillion) / 1_000_000 });
});
it("reports null cost for an unpriced model, omits decision on failure, and survives a broken sink", async () => {
  const { log, sink } = capture();
  await extractEventIntake({ draftId: "draft", sourceText: "Night", context: { trigger: "discord", connectorId: "connector", communitySlug: "club", mode: "hold" } }, { ...base, sink, fetchImplementation: async () => usage({ status: "failed", output: [] }) });
  assert.deepEqual(log.metas[0], { trigger: "discord", actorUserId: "actor", draftId: "draft", connectorId: "connector", communitySlug: "club", mode: "hold" });
  assert.equal(log.ends[0].costUsd, null); assert.equal(log.ends[0].reason, "incomplete_response"); assert.equal("decision" in log.ends[0], false);
  const broken = { start: () => ({ generation() { throw new Error("down"); }, async end() { throw new Error("down"); } }) };
  const result = await extractEventIntake({ draftId: "draft", sourceText: "Night" }, { ...base, sink: broken, fetchImplementation: async () => response({ ...blank(), event: { ...blank().event, title: "Night" } }) });
  assert.equal(result.event.title, "Night");
});
```

`base.model` is `"fixture"`, which has no price entry.

- [ ] **Step 2: Write the failing sink tests in `tests/web/event-intake-sinks.test.ts`**

```ts
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-sinks.test.ts`
Expected: FAIL (`EVENT_INTAKE_MODEL_PRICES` and sink exports missing; `sink` ignored).

- [ ] **Step 4: Implement**

- `pnpm --filter @vrdex/event-intake-agent add @langfuse/client@^5.9.1` (the lockfile's `@langfuse/core` and `@langfuse/tracing` are 5.9.1). Do not use `@langfuse/langchain` or OpenTelemetry.
- `EVENT_INTAKE_MODEL_PRICES` has one entry, `"gpt-5.6-luna"`, with the per-million-token USD input and output prices from OpenAI's API pricing page on the day of implementation; put the source URL and date in a comment. `estimateCostUsd` returns exactly `(inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1_000_000` (the test compares floats with that expression), and `null` for any model not in the table.
- In `extractEventIntake`: after the enabled check, `deps.sink?.start(meta)` with `meta = { trigger: input.context?.trigger ?? "web", actorUserId, draftId }` plus `connectorId`, `communitySlug`, and `mode` from `input.context`, each only when present, so Langfuse tags and PostHog properties carry `mode` with no host-side wrapper. Right after each provider response is JSON-parsed (before the status check), `generation({ turn, model, request, response: data, inputTokens, outputTokens, latencyMs })` where `request` is the request body with every `input_image.image_url` replaced by `"[image]"` and `latencyMs` times the fetch. In `finally`, `await handle?.end({ reason, ...(reason === "success" ? { decision } : {}), turns, toolCalls, durationMs, inputTokens, outputTokens, costUsd: estimateCostUsd(model, inputTokens, outputTokens) })`. Guard both sink calls with `try`/`catch` so a sink can never change the result. Remove `record` from the dependency type.
- `createLangfuseSink`: one `new LangfuseClient({ publicKey, secretKey, baseUrl })` per sink. `start` creates a `randomUUID()` trace id and buffers generations in memory; `end` sends one `client.api.ingestion.batch({ batch })` with a `trace-create` (`name: "event-intake"`, tags `[trigger, mode, decision.kind, "connector:" + connectorId]` minus absent ones, `metadata: { draftId, reason, turns, toolCalls, durationMs, costUsd }`, `output: decision`) and one `generation-create` per buffered turn (`name: "turn-" + turn`, `model`, `input: request`, `output: response`, `startTime` = buffered-at minus `latencyMs`, `endTime` = buffered-at, `usageDetails: { input, output }`). Every event and body gets its own `randomUUID()`. Swallow all errors. The ingestion endpoint is marked legacy in favour of OTLP, but it is the client's only trace path without OpenTelemetry, and the spec rules out the LangChain wrapper. If the Fern client captures `fetch` at module load and the test's stub is not seen, import the client lazily inside `end`.
- `createPostHogSink`: `end` calls `enqueue` once with `distinctId: "event_intake:" + draftId` and the properties listed under Interfaces; errors swallowed.
- `composeSinks`: `start` starts every sink; `generation` calls each inside `try`; `end` is `Promise.allSettled` over each handle's `end`.
- `src/index.ts` re-exports the three functions from `./sinks`.

- [ ] **Step 5: Run tests**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-sinks.test.ts && pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/event-intake-agent apps/web/src/lib/server/event-intake-agent.ts pnpm-lock.yaml tests/web/event-intake-agent.test.ts tests/web/event-intake-sinks.test.ts
git commit -m "feat(event-intake): replace record hook with Langfuse and PostHog sinks" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Product analytics outbox

**Files:**

- Modify: `convex/schema.ts` (new table beside `claimAnalyticsOutbox`, line 2755), `convex/crons.ts:45-50` (new interval after the claim delivery cron)
- Create: `convex/_productAnalytics.ts`, `convex/productAnalytics.ts`, `convex/productAnalyticsDelivery.ts`
- Modify: `convex/_generated/api.d.ts` (regenerated)
- Test: `tests/backend/product-analytics.test.ts`

**Interfaces:**

- Consumes: `posthogClaimAnalyticsConfig(env)` from `convex/claimAnalyticsDelivery.ts` (same endpoint, same `POSTHOG_PROJECT_API_KEY`, same `POSTHOG_INGEST_HOST`).
- Produces: table `productAnalyticsOutbox` `{ event: v.string(), distinctId: v.string(), properties: v.any(), createdAt: v.number(), attemptCount: v.number(), nextAttemptAt: v.number(), leaseExpiresAt: v.optional(v.number()), deliveredAt: v.optional(v.number()) }` with index `by_deliveredAt_nextAttemptAt` on `["deliveredAt", "nextAttemptAt"]`; `enqueueProductAnalytics(db: DatabaseWriter, row: { event: string; distinctId: string; properties: Record<string, unknown> }): Promise<Id<"productAnalyticsOutbox">>` in `convex/_productAnalytics.ts`; `internal.productAnalytics.claimNext`, `internal.productAnalytics.recordSuccess { outboxId }`, `internal.productAnalytics.recordFailure { outboxId }`, `internal.productAnalytics.enqueue { event: v.literal("event_intake_run"), distinctId: v.string(), properties: v.any() }` (web host entry); `internal.productAnalyticsDelivery.deliverPending` (plans 02 and 03 call `enqueueProductAnalytics` directly from mutations).

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { enqueueProductAnalytics } from "../../convex/_productAnalytics";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/productAnalytics.ts": () => import("../../convex/productAnalytics"),
  "../../convex/productAnalyticsDelivery.ts": () => import("../../convex/productAnalyticsDelivery"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const originalFetch = globalThis.fetch; const originalKey = process.env.POSTHOG_PROJECT_API_KEY;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.POSTHOG_PROJECT_API_KEY; else process.env.POSTHOG_PROJECT_API_KEY = originalKey; });
const setup = async () => { const t = convexTest({ schema, modules });
  const id = await t.run(ctx => enqueueProductAnalytics(ctx.db, { event: "event_intake_run", distinctId: "event_intake:draft", properties: { trigger: "web", turns: 2 } }));
  return { t, id }; };
it("enqueues a pending row", async () => {
  const { t, id } = await setup(); const row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 0); assert.equal(row?.deliveredAt, undefined); assert.ok(row!.nextAttemptAt <= Date.now());
});
it("delivers to the PostHog capture endpoint and marks the row delivered", async () => {
  const { t, id } = await setup(); process.env.POSTHOG_PROJECT_API_KEY = "phc_test"; const sent: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => { sent.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response("{}"); }) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  assert.equal(sent[0]!.url, "https://us.i.posthog.com/i/v0/e/");
  assert.equal(sent[0]!.body.api_key, "phc_test"); assert.equal(sent[0]!.body.event, "event_intake_run");
  assert.deepEqual(sent[0]!.body.properties, { distinct_id: "event_intake:draft", $insert_id: id, $process_person_profile: false, trigger: "web", turns: 2 });
  assert.ok((await t.run(ctx => ctx.db.get(id)))?.deliveredAt);
});
it("leaves rows untouched without a project key", async () => {
  const { t, id } = await setup(); delete process.env.POSTHOG_PROJECT_API_KEY; let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  assert.equal(calls, 0); assert.equal((await t.run(ctx => ctx.db.get(id)))?.attemptCount, 0);
});
it("backs off on failure, recovers an abandoned lease, and stops after five attempts", async () => {
  const { t, id } = await setup(); process.env.POSTHOG_PROJECT_API_KEY = "phc_test";
  globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  let row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 1); assert.ok(row!.nextAttemptAt > Date.now()); assert.equal(row?.deliveredAt, undefined);
  await t.run(ctx => ctx.db.patch(id, { nextAttemptAt: Date.now() - 1 }));
  assert.equal((await t.mutation(internal.productAnalytics.claimNext, {}))?._id, id); // claimed, action "dies"
  await t.run(ctx => ctx.db.patch(id, { nextAttemptAt: Date.now() - 1 })); // lease elapsed
  assert.equal((await t.mutation(internal.productAnalytics.claimNext, {}))?.attemptCount, 3);
  await t.run(ctx => ctx.db.patch(id, { attemptCount: 4, nextAttemptAt: Date.now() - 1 }));
  await t.action(internal.productAnalyticsDelivery.deliverPending, {});
  row = await t.run(ctx => ctx.db.get(id));
  assert.equal(row?.attemptCount, 5); assert.equal(row?.nextAttemptAt, Number.MAX_SAFE_INTEGER);
  assert.equal(await t.mutation(internal.productAnalytics.claimNext, {}), null);
});
it("web enqueue accepts only event_intake_run", async () => {
  const t = convexTest({ schema, modules });
  await t.mutation(internal.productAnalytics.enqueue, { event: "event_intake_run", distinctId: "event_intake:draft", properties: { trigger: "mcp" } });
  await assert.rejects(t.mutation(internal.productAnalytics.enqueue, { event: "claim_resolved" as "event_intake_run", distinctId: "x", properties: {} }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/product-analytics.test.ts`
Expected: FAIL with module not found for `convex/_productAnalytics`.

- [ ] **Step 3: Implement**

- `enqueueProductAnalytics` inserts with `createdAt` and `nextAttemptAt` set to now and `attemptCount: 0`. It takes only `db` (master signature), so it schedules nothing; the cron drains it.
- `claimNext` returns `Doc<"productAnalyticsOutbox"> | null`: the first row on `by_deliveredAt_nextAttemptAt` with `deliveredAt` undefined and `nextAttemptAt <= now`; it patches `attemptCount + 1`, `leaseExpiresAt` and `nextAttemptAt` both to now plus 60 s, and returns the row with those patched values. Pushing `nextAttemptAt` out is the lease: a dead action's row comes back when it passes, so no second index is needed.
- `recordSuccess` sets `deliveredAt`, clears `leaseExpiresAt`, and schedules `deliverPending` at 0 to drain the next row. `recordFailure` sets `nextAttemptAt` to `Number.MAX_SAFE_INTEGER` once `attemptCount >= 5`, else now plus `[5_000, 30_000, 120_000, 600_000][attemptCount - 1]` (the claim outbox's delays).
- `deliverPending` (`"use node"`): returns `{ delivered: 0, configured: false }` before claiming when `posthogClaimAnalyticsConfig(process.env)` is null; otherwise claims one row and POSTs `{ api_key, event, timestamp: new Date(createdAt).toISOString(), properties: { distinct_id, $insert_id: row._id, $process_person_profile: false, ...row.properties } }` with a 10 s timeout, then records success or failure.
- `crons.interval("deliver product analytics outbox", { minutes: 5 }, internal.productAnalyticsDelivery.deliverPending, {})`.
- ponytail: no retention sweep or dead-letter recovery yet (tens of rows a day); add both, modelled on `claimAnalytics.sweepDeliveredEvents` and `recoverUndeliveredDeliveries`, when the table passes a few thousand rows.
- Regenerate `convex/_generated` with `pnpm verify:backend:local`. Port 3210 is shared between worktrees, so reuse a running local backend if there is one. The first boot in a fresh worktree rewrites `convex/README.md` and `convex/tsconfig.json`; restore them before staging.

- [ ] **Step 4: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/product-analytics.test.ts tests/backend/claim-analytics.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/crons.ts convex/_productAnalytics.ts convex/productAnalytics.ts convex/productAnalyticsDelivery.ts convex/_generated tests/backend/product-analytics.test.ts
git commit -m "feat(analytics): add product analytics outbox delivered to PostHog" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Web host sinks, env declarations, and docs

**Files:**

- Modify: `apps/web/src/lib/server/event-intake-agent.ts` (`createEventIntakeExtractor`), `apps/web/src/lib/server/event-intake-api.ts:22`
- Modify: `apps/web/.env.example` (after line 126)
- Modify: `infra/terraform/vercel/main.tf`, `infra/terraform/vercel/variables.tf`, `infra/terraform/vercel/terraform.tfvars.example`
- Modify: `docs/deployment/convex-environments.md:24-29`, `:57-60`; `docs/backend/event-intake-sources.md:142-155`
- Test: `tests/web/event-intake-agent.test.ts`

**Interfaces:**

- Consumes: `createLangfuseSink`, `createPostHogSink`, `composeSinks` (Task 4); `internal.productAnalytics.enqueue` (Task 5).
- Produces: `createEventIntakeExtractor(deps: { authority; admin; readPoster; trigger: "web" | "mcp" })`. `event-intake-api.ts` passes `trigger: deps.actorSurface === "mcp" ? "mcp" : "web"`.

- [ ] **Step 1: Write the failing test**

```ts
it("web host enqueues event_intake_run with its trigger and skips Langfuse without keys", async () => {
  const { getFunctionName } = await import("convex/server");
  const { createEventIntakeExtractor } = await import("../../apps/web/src/lib/server/event-intake-agent");
  const keys = ["OPENAI_API_KEY", "VRDEX_EVENT_INTAKE_AI_ENABLED", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"] as const;
  const saved = keys.map(key => process.env[key]); const originalFetch = globalThis.fetch; const urls: string[] = []; const calls: [string, any][] = [];
  Object.assign(process.env, { OPENAI_API_KEY: "test", VRDEX_EVENT_INTAKE_AI_ENABLED: "true" });
  delete process.env.LANGFUSE_PUBLIC_KEY; delete process.env.LANGFUSE_SECRET_KEY;
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); return response(blank()); }) as typeof fetch;
  try {
    const admin = { query: async () => [], mutation: async (ref: any, args: any) => { calls.push([getFunctionName(ref), args]); return getFunctionName(ref) === "eventIntakeSources:authorizeExtraction" ? { actorUserId: "actor", version: 1 } : null; } };
    const extract = createEventIntakeExtractor({ authority: async () => ({ actorUserId: "actor" as never }), admin: admin as never, readPoster: async () => "", trigger: "mcp" });
    await extract({ draftId: "draft", sourceText: "Night" });
    const enqueued = calls.find(([name]) => name === "productAnalytics:enqueue")?.[1];
    assert.equal(enqueued.event, "event_intake_run"); assert.equal(enqueued.distinctId, "event_intake:draft"); assert.equal(enqueued.properties.trigger, "mcp");
    assert.deepEqual(urls, ["https://api.openai.com/v1/responses"]);
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts`
Expected: FAIL (`enqueued` undefined).

- [ ] **Step 3: Implement the host**

`createEventIntakeExtractor` builds `composeSinks(...)` from a Langfuse sink, only when both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set (`baseUrl: process.env.LANGFUSE_BASE_URL || undefined`), and `createPostHogSink(event => deps.admin.mutation(internal.productAnalytics.enqueue, event).then(() => undefined))`. It passes `sink: { start: meta => composed.start({ ...meta, trigger: deps.trigger }) }`, which keeps `context` absent for web and MCP while still tagging the trigger. Update the one call site in `event-intake-api.ts`.

- [ ] **Step 4: Declare env and update docs**

- `infra/terraform/vercel/variables.tf`: `langfuse_public_key`, `langfuse_secret_key` (both `sensitive = true`, `default = null`, `nullable = true`, described as optional server-only Langfuse keys for event intake tracing) and `langfuse_base_url` (`default = null`, `nullable = true`, no validation block: CI skips variable validation and this one can only be null or a URL). Follow the optional Twitch pattern, not the PostHog one: the `posthog_*` values are required and client-exposed. `main.tf`: `manage_langfuse = nonsensitive(var.langfuse_public_key != null && var.langfuse_secret_key != null)`, a `langfuse_keys` set that adds `LANGFUSE_BASE_URL` only when it is non-null, a `langfuse_values` map, and `langfuse_standard` plus `langfuse_staging_custom` resources mirroring `twitch_standard` and `twitch_staging_custom` (targets `standard_twitch_targets`, `sensitive = true`, comment `"Server-only Langfuse keys for event intake tracing."`). `terraform.tfvars.example`: the three variables set to `null` under an "Optional." comment.
- `apps/web/.env.example`: empty `LANGFUSE_PUBLIC_KEY=`, `LANGFUSE_SECRET_KEY=`, `LANGFUSE_BASE_URL=` under the intake block.
- `docs/deployment/convex-environments.md`: after the `OPENAI_API_KEY` paragraph, a list of `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (secret), and `LANGFUSE_BASE_URL` (optional, defaults to Langfuse Cloud). Scope: the Convex deployment (set with `convex env set`) and the web app (Vercel Terraform variables `langfuse_*`). Owner: BASIC. Rotation: create a new key pair in the Langfuse project settings, set it on both, then revoke the old pair. Missing keys disable tracing. State that `event_intake_run` reaches PostHog through `productAnalyticsOutbox` with the existing `POSTHOG_PROJECT_API_KEY`. In the release checks, change "four turns, three read-only tool calls" to "six turns, five read-only tool calls" and replace the `costUsd: null` sentence with: cost comes from the agent's model price table and is `null` only for unpriced models.
- `docs/backend/event-intake-sources.md` "Extraction and classification": the agent lives in `packages/event-intake-agent`; the candidate now includes `decision`; the budget of five tool calls and six turns; `list_events` and `get_event` only with run context; update slugs only from `list_events`; the `connector` evidence origin; sinks replace the console metric.

- [ ] **Step 5: Verify**

Run: `node --import tsx --test tests/web/event-intake-agent.test.ts tests/web/event-intake-api.test.ts && pnpm typecheck:web && terraform -chdir=infra/terraform/vercel fmt -check && terraform -chdir=infra/terraform/vercel init -backend=false && terraform -chdir=infra/terraform/vercel validate && pnpm exec markdownlint-cli2 docs/deployment/convex-environments.md docs/backend/event-intake-sources.md`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/event-intake-agent.ts apps/web/src/lib/server/event-intake-api.ts apps/web/.env.example infra/terraform/vercel docs/deployment/convex-environments.md docs/backend/event-intake-sources.md tests/web/event-intake-agent.test.ts
git commit -m "feat(event-intake): wire web host to Langfuse and product analytics sinks" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
