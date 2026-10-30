# Event Platform 03: Discord Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A community connects one Discord channel; the gateway relays its posts to Convex, a durable quiet window batches each author's posts, and one run per batch extracts the event with the shared agent and files a held draft or publishes and updates through the connector foundation.

**Architecture:** The gateway stays a stateless relay (messages, slash commands, heartbeat) authenticated by one scoped bearer. Convex owns everything else: message rows, the per-author pending run whose scheduled function is cancelled and rescheduled on every change, a run split into small mutations (`claimRun`, `saveRunDraft`, `finishRun`, `failRun`) around one action that calls the agent, and `discordIntakeSources` as the durable message-to-event link. Poster bytes reach S3 through a token-gated internal web route, because only the web server holds the bucket role and Vercel caps request bodies at 4.5 MB.

**Tech Stack:** discord.js 14, Convex (HTTP actions, scheduler, `convex-test`), Next.js route handler, `@vrdex/event-intake-agent` (plan 01), connector foundation (plan 02), Discord REST v10.

**Spec:** `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md`, `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (The model, Discord announcements), interface contract `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Everything in the master plan's Global Constraints applies; names in its interface contract are used verbatim.
- Discord IDs validate with `/^\d{17,20}$/`; message text is truncated to 12,000 characters; prepared poster data URLs are capped at 20,000,000 characters (the agent already throws above it).
- Quiet window default 120 s, clamped to 30..600 s. Run context: the author's messages on that channel from the last 6 hours. At most 3 posters, largest first, `image/png`, `image/jpeg`, `image/webp`, each at most `EVENT_POSTER_MAX_BYTES`.
- Per connector cap: 20 runs per UTC day, then `state: "paused"`, `lastError: "binding_cap"` until the next UTC midnight.
- `list_events`: the connector's community, `eventDate` from today minus 7 days to today plus 90 days, plus events this run's messages previously produced, at most 40 rows.
- HTTP actions: 503 when `VRDEX_DISCORD_INTAKE_ENABLED !== "true"` (checked first), then 401 unless `Authorization: Bearer ${DISCORD_INTAKE_SECRET}` passes `safeEqual`.
- Bot authorisation: scopes `bot applications.commands`, permissions `DISCORD_BOT_PERMISSIONS = 17600776072192` (the master's seven permissions for every kind). Channel readability for the picker still checks only View Channel and Read Message History (`66560`).
- Command replies are ephemeral and use the spec copy verbatim (Task 5 holds the exact strings). Strings not in a spec copy table are listed in Task 5 and Task 6 and need BASIC's approval in the PR.
- Discord message URL: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`.
- Poster downloads accept only `https:` URLs on `cdn.discordapp.com` or `media.discordapp.net`, with `redirect: "error"`.

## Review Focus

1. A gateway redelivery of the same `MessageCreate` (reconnect, resume) must not duplicate the message row or its trigger entry. Pinned in Task 1 (`accumulates creates, edits and deletes into one trigger set without duplicates`).
2. An edit to a message posted before the connector existed must be ignored, since history before the binding is never read. Pinned in Task 1 (`ignores edits and deletes of messages posted before the connector existed`).
3. A relayed attachment URL off the Discord CDN must never be stored or fetched. Pinned in Task 1 (`drops bot messages and attachments off the Discord CDN`) and Task 4 (`refuses URLs off the Discord CDN without fetching`).
4. A follow-up post that edits an already published event must patch that event and not create a second one, and must leave untouched fields alone. Pinned in Task 3 (`patches only explicit fields when an edited post updates the published event`).
5. A run that throws partway (poster bridge down, agent error) must still close its run row so the next post can schedule a fresh run. Pinned in Task 4 (`closes the run even when extraction fails`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `convex/schema.ts` | Three intake tables, `discordGatewayHeartbeats`, `discordVerificationWatermarks.by_discordUserId` index |
| `convex/_discordIntake.ts` | Pure helpers and validators: payload validator, quiet window, source text, poster pick, run link lookup, channel permission filter, connect helper, command reply copy |
| `convex/discordIntake.ts` | All intake functions (default runtime; no `"use node"`, because Convex forbids queries and mutations in a Node file and the master pins `recordMessage` and `runPending` to this module) |
| `convex/_discordRest.ts` | `discordRequest` and `DISCORD_BOT_PERMISSIONS` (master contract; plans 06 and 07 consume, never recreate) |
| `convex/http.ts` | Four `/discord-intake/*` routes |
| `convex/discordVerification.ts` | Extract `manageableDiscordGuilds` from `getManageableGuilds` |
| `apps/web/src/lib/server/discord-intake-posters.ts`, `apps/web/src/app/api/internal/discord-intake/poster/route.ts` | Poster bridge for the Convex run |
| `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/discord-connect.tsx` | Site connect flow |
| `apps/discord-gateway/src/{relay,connectorCache,commands,register-commands,index}.ts` | Gateway relay, cache, commands, heartbeat |
| `infra/terraform/vercel/{main,variables}.tf` | `VRDEX_DISCORD_POSTER_TOKEN` on web |
| `docs/backend/event-schema.md`, `docs/deployment/convex-environments.md`, `docs/deployment/discord-gateway.md` | Behaviour and env docs |

---

### Task 1: Intake tables and the quiet window

**Files:**

- Modify: `convex/schema.ts` (new tables after `eventSyncJobs`; index on `discordVerificationWatermarks` at the existing `by_userId_discordUserId` line)
- Create: `convex/_discordIntake.ts`, `convex/discordIntake.ts`
- Create: `tests/backend/helpers/discord-intake.ts`
- Test: `tests/backend/discord-intake-messages.test.ts`

**Interfaces:**

- Consumes: plan 02 `eventConnectors` (index `by_kind_target_channelId`), `Doc<"eventConnectors">`; `getLinkedProviderAccount` (`convex/accounts.ts:50`).
- Produces:
  - Tables exactly as the master lists, including `discordIntakeMessages.authorUserId: v.optional(v.id("users"))`, with validators: `attachments: v.array(v.object({ url: v.string(), contentType: v.string(), byteLength: v.number() }))`; `discordIntakeRuns.decision: v.optional(v.union(v.object({ kind: v.literal("new") }), v.object({ kind: v.literal("update"), slug: v.string() }), v.object({ kind: v.literal("not_event"), reason: v.string() })))` (the whole candidate decision), `reason: v.optional(v.string())`; extra index `discordIntakeRuns.by_connectorId_startedAt` for the daily cap.
  - Table `discordGatewayHeartbeats { instanceId: string, at: number, receivedAt: number }` indexes `by_instanceId`, `by_receivedAt` (plan 05 reads the newest `receivedAt`).
  - Index `discordVerificationWatermarks.by_discordUserId` on `["discordUserId"]`.
  - `_discordIntake.ts`: `DISCORD_SNOWFLAKE = /^\d{17,20}$/`; `DISCORD_CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"]`; `discordMessagePayloadValidator` (master's message payload; for `delete` every field but `messageId` is optional); `quietWindowMs(connector: Doc<"eventConnectors">): number`; `resolveDiscordUserId(db: DatabaseReader, discordUserId: string): Promise<Id<"users"> | null>`: distinct users with a completed watermark (`appliedAt` set or `appliedGeneration > 0`) via `by_discordUserId`; exactly one, and `getLinkedProviderAccount(ctx, userId, "discord")?.providerAccountId === discordUserId`, else `null`.
  - `internal.discordIntake.recordMessage({ guildId, channelId, action: "create" | "update" | "delete", payload }) => { recorded: number }`.
  - Test helper exports: `GUILD = "100000000000000001"`, `CHANNEL = "100000000000000002"`, `AUTHOR_A = "200000000000000001"`, `AUTHOR_B = "200000000000000002"`, `M1 = "300000000000000001"`, `M2 = "300000000000000002"`, `SECRET = "s".repeat(40)`, `modules`, `seedDiscordIntake(options?: { mode?: "hold" | "autopublish"; quietWindowSeconds?: number; state?: "active" | "paused" }) => { t, authorityUserId, clerkUserId, communityProfileId, communitySlug: "night-club", connectorId }`, `message(messageId, overrides?)`, `record(t, action, payload)`, `seedCommunity(t, { slug, displayName }) => Id<"profiles">` (published public community, no grant), `revokeManageIntegrations(t, communityProfileId, userId)` (removes the grant `seedDiscordIntake` made), `seedGuildProof(t, userId, guildId, controlLevel: "manager" | "administrator" | "owner")` (an active `externalControlProofs` row with `assetType: "discord_guild"`).

- [ ] **Step 1: Write the test helper**

`seedDiscordIntake` creates a `convexTest({ schema, modules })`, a user with `newClerkUserId()`, a published public community profile with display name `Night Club` and slug `night-club`, grants that user `manage_integrations` with the same rows plan 02's `requireConnectorAuthority` tests seed, and inserts the connector directly: `kind: "discord_announcements"`, `direction: "import"`, `mode` default `"hold"`, `target: { guildId: GUILD, guildName: "Night Server", channelId: CHANNEL, channelName: "announcements" }`, `state` default `"active"`, `createdAt: Date.now() - 60_000`. `modules` lists `_generated/api`, `discordIntake`, `http`, `events`, `eventIntake`, `eventIntakeSources`, `eventConnectors`, `eventSync` in the shape `tests/backend/collector-proof-checks.test.ts` uses.

```ts
export const message = (messageId: string, overrides: Record<string, unknown> = {}) => ({
  messageId, authorId: AUTHOR_A, authorDisplayName: "Ari", isBot: false,
  content: `post ${messageId}`, createdAt: Date.now(), attachments: [], ...overrides,
});
export const record = (t: TestConvex<typeof schema>, action: "create" | "update" | "delete", payload: Record<string, unknown>) =>
  t.mutation(internal.discordIntake.recordMessage, { guildId: GUILD, channelId: CHANNEL, action, payload });
```

- [ ] **Step 2: Write the failing tests**

```ts
const runs = (t) => t.run(ctx => ctx.db.query("discordIntakeRuns").collect());
const jobs = (t) => t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());

it("debounces one author's posts into one pending run and reschedules the quiet window", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const [run] = await runs(t);
  assert.equal((await runs(t)).length, 1);
  const scheduled = await jobs(t);
  assert.deepEqual(scheduled.map(job => job.state.kind).sort(), ["canceled", "pending"]);
  const pending = scheduled.find(job => job.state.kind === "pending")!;
  assert.equal(pending._id, run.scheduledFunctionId);
  assert.ok(Math.abs(pending.scheduledTime - (Date.now() + 120_000)) < 5_000);
});

it("clamps the quiet window to 30..600 seconds", async () => {
  for (const [configured, expected] of [[5, 30_000], [900, 600_000]] as const) {
    const { t } = await seedDiscordIntake({ quietWindowSeconds: configured });
    await record(t, "create", message(M1));
    const [job] = await jobs(t);
    assert.ok(Math.abs(job.scheduledTime - (Date.now() + expected)) < 5_000);
  }
});

it("accumulates creates, edits and deletes into one trigger set without duplicates", async () => {
  const { t } = await seedDiscordIntake();
  const createdAt = Date.now();
  await record(t, "create", message(M1, { createdAt }));
  await record(t, "update", message(M1, { createdAt, content: "edited", editedAt: createdAt + 1_000 }));
  await record(t, "create", message(M2));
  await record(t, "create", message(M1, { createdAt, content: "edited", editedAt: createdAt + 1_000 }));
  await record(t, "delete", { messageId: M2 });
  const [run] = await runs(t);
  assert.deepEqual(run.triggerMessageIds, [M1, M2]);
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.messageId === M1)!.content, "edited");
  assert.ok(rows.find(row => row.messageId === M2)!.deletedAt);
});

it("links the author to a VRDex user only when exactly one user verified that Discord ID", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  const watermark = (userId) => t.run(ctx => ctx.db.insert("discordVerificationWatermarks", { userId, discordUserId: AUTHOR_A, issuedGeneration: 1, appliedGeneration: 1, appliedAt: Date.now(), issuedAt: Date.now(), updatedAt: Date.now() }));
  await watermark(authorityUserId);
  await record(t, "create", message(M1));
  const other = await t.run(ctx => ctx.db.insert("users", { clerkUserId: newClerkUserId() }));
  await watermark(other);
  await record(t, "create", message(M2));
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.equal(rows.find(row => row.messageId === M1)!.authorUserId, authorityUserId);
  assert.equal(rows.find(row => row.messageId === M2)!.authorUserId, undefined);
});

it("keys pending runs by author", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { authorId: AUTHOR_A }));
  await record(t, "create", message(M2, { authorId: AUTHOR_B }));
  assert.deepEqual((await runs(t)).map(run => run.authorId).sort(), [AUTHOR_A, AUTHOR_B]);
});

it("ignores edits and deletes of messages posted before the connector existed", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  await record(t, "update", message(M1, { createdAt: connector!.createdAt - 1, editedAt: Date.now() }));
  await record(t, "delete", { messageId: M2 });
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 0);
  assert.equal((await runs(t)).length, 0);
});

it("drops bot messages and attachments off the Discord CDN", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { isBot: true }));
  await record(t, "create", message(M2, { attachments: [
    { url: "https://evil.example/a.png", contentType: "image/png", byteLength: 10 },
    { url: "https://cdn.discordapp.com/attachments/1/2/a.png", contentType: "image/png", byteLength: 1_000 },
  ] }));
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.deepEqual(rows.map(row => row.messageId), [M2]);
  assert.deepEqual(rows[0].attachments.map(item => item.byteLength), [1_000]);
});

it("records messages but schedules nothing while the connector is paused", async () => {
  const { t } = await seedDiscordIntake({ state: "paused" });
  await record(t, "create", message(M1));
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 1);
  assert.equal((await runs(t)).length, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-messages.test.ts`
Expected: FAIL, `internal.discordIntake` is undefined.

- [ ] **Step 4: Add the schema rows and index, then implement `recordMessage`**

Decisions the tests leave open:

- Connectors: every row from `by_kind_target_channelId` with `kind: "discord_announcements"`, matching `target.guildId`, and `state !== "removed"`. One message row per connector.
- Validate `guildId`, `channelId`, `messageId`, `authorId` with `DISCORD_SNOWFLAKE`; throw on mismatch. `isBot: true` returns `{ recorded: 0 }`. Content is sliced to 12,000. Attachments keep only `https:` URLs whose host is in `DISCORD_CDN_HOSTS`.
- `create` and `update` upsert by `by_connectorId_messageId` and set `authorUserId` from `resolveDiscordUserId` (cleared when it returns `null`); an unknown message whose `createdAt < connector.createdAt` is ignored. `delete` patches `deletedAt` on a known row and is ignored otherwise; its author is read from the stored row.
- Scheduling happens only when `state === "active"` and `direction !== "off"`: find `by_connectorId_authorId_state` with `"pending"`, append the message ID if absent, `ctx.scheduler.cancel(run.scheduledFunctionId)`, then `ctx.scheduler.runAfter(quietWindowMs(connector), internal.discordIntake.runPending, { runId })` and store the new ID. Add `runPending` here as a no-op `internalAction({ args: { runId: v.id("discordIntakeRuns") } })`; Task 4 gives it its body.

- [ ] **Step 5: Regenerate Convex types and run tests**

Run: `pnpm verify:backend:local` (restore `convex/README.md` and `convex/tsconfig.json` if the CLI rewrote them), then `node --conditions=import --import tsx --test tests/backend/discord-intake-messages.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/_discordIntake.ts convex/discordIntake.ts convex/_generated tests/backend/helpers/discord-intake.ts tests/backend/discord-intake-messages.test.ts
git commit -m "feat(discord-intake): record channel messages behind a per-author quiet window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Relay HTTP actions and heartbeat

**Files:**

- Modify: `convex/http.ts` (new routes before `export default http`)
- Modify: `convex/discordIntake.ts`
- Modify: `docs/deployment/convex-environments.md` (new section "Discord intake")
- Test: `tests/backend/discord-intake-http.test.ts`

**Interfaces:**

- Consumes: Task 1 `recordMessage`, `discordGatewayHeartbeats`.
- Produces: the four master routes; `internal.discordIntake.listChannelConnectors({ guildId?, channelId? }) => Array<{ connectorId, kind, direction, mode, state, guildId, channelId?, lastMessageId? }>` (Discord kinds only; with `guildId` alone: that guild's connectors, `state !== "removed"`; with both: narrowed to that channel; with neither: every `active` Discord connector; `channelId` without `guildId` is a 400 at the route; `lastMessageId` is the first row of `discordIntakeMessages.by_connectorId_messageId` in descending order, which is numeric order while snowflakes share a length, absent when the connector has no messages); `internal.discordIntake.recordHeartbeat({ instanceId, at }) => null` (upsert by `instanceId`, `receivedAt: Date.now()`). `/discord-intake/command` calls `internal.discordIntake.handleCommand` (Task 5; until then return 501).

- [ ] **Step 1: Write the failing tests**

```ts
const auth = (secret = SECRET) => ({ authorization: `Bearer ${secret}`, "content-type": "application/json" });
const routes = [
  ["GET", `/discord-intake/connectors?guildId=${GUILD}&channelId=${CHANNEL}`, undefined],
  ["POST", "/discord-intake/relay", { kind: "message", action: "create", guildId: GUILD, channelId: CHANNEL, payload: message(M1) }],
  ["POST", "/discord-intake/command", { command: "status", guildId: GUILD, channelId: CHANNEL, invokerDiscordUserId: AUTHOR_A, invokerHasManageGuild: true, options: { channelName: "announcements" } }],
  ["POST", "/discord-intake/heartbeat", { instanceId: "gw-1", at: 1 }],
] as const;
const call = (t, [method, path, body], headers = auth()) => t.fetch(path, { method, headers, body: body && JSON.stringify(body) });

it("answers 503 on every route while the flag is off", async () => {
  const { t } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "false";
  for (const route of routes) assert.equal((await call(t, route)).status, 503);
});

it("answers 401 to a wrong or missing bearer", async () => {
  const { t } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  for (const route of routes) {
    assert.equal((await call(t, route, auth("x".repeat(40)))).status, 401);
    assert.equal((await call(t, route, { "content-type": "application/json" })).status, 401);
  }
});

it("returns the channel's connectors", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  const response = await call(t, routes[0]);
  assert.deepEqual(await response.json(), { connectors: [{ connectorId, kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: GUILD, channelId: CHANNEL }] });
});

it("lists a guild's connectors when only guildId is given", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  const response = await call(t, ["GET", `/discord-intake/connectors?guildId=${GUILD}`, undefined]);
  assert.deepEqual((await response.json()).connectors.map(row => [row.connectorId, row.guildId, row.channelId]), [[connectorId, GUILD, CHANNEL]]);
  assert.equal((await call(t, ["GET", `/discord-intake/connectors?channelId=${CHANNEL}`, undefined])).status, 400);
});

it("lists every active connector with its newest message ID when called without a query", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const response = await call(t, ["GET", "/discord-intake/connectors", undefined]);
  assert.deepEqual(await response.json(), { connectors: [{ connectorId, kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: GUILD, channelId: CHANNEL, lastMessageId: M2 }] });
});

it("relays a message into recordMessage and rejects malformed IDs", async () => {
  const { t } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  assert.equal((await call(t, routes[1])).status, 200);
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 1);
  assert.equal((await call(t, ["POST", "/discord-intake/relay", { ...routes[1][2], channelId: "12" }])).status, 400);
});

it("upserts one heartbeat row per instance", async () => {
  const { t } = await seedDiscordIntake();
  process.env.DISCORD_INTAKE_SECRET = SECRET; process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await call(t, routes[3]);
  await call(t, ["POST", "/discord-intake/heartbeat", { instanceId: "gw-1", at: 2 }]);
  const rows = await t.run(ctx => ctx.db.query("discordGatewayHeartbeats").collect());
  assert.equal(rows.length, 1); assert.equal(rows[0].at, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-http.test.ts`
Expected: FAIL with 404 from `t.fetch`.

- [ ] **Step 3: Implement the routes**

One gate function in `convex/http.ts`, `discordIntakeGate(request: Request): Response | null`: 503 unless the flag is exactly `"true"`, 401 unless `DISCORD_INTAKE_SECRET` is set and `safeEqual(presented, secret)`. Body parse failures and snowflake mismatches return 400. Relay with `kind: "scheduled_event"` returns 202 `{ ignored: true }` until plan 07 registers it.

- [ ] **Step 4: Document env**

In `docs/deployment/convex-environments.md`, section "Discord intake": `VRDEX_DISCORD_INTAKE_ENABLED` (Convex, default off, owner BASIC, gates the HTTP routes and runs); `DISCORD_INTAKE_SECRET` (Convex and gateway, at least 32 random bytes, owner BASIC, stored in Convex env and the gateway's Secrets Manager entry; rotation: set the new value on Convex and the gateway in one window, relays fail with 401 between the two writes and those posts are not retried).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-http.test.ts tests/backend/discord-intake-messages.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/http.ts convex/discordIntake.ts convex/_generated docs/deployment/convex-environments.md tests/backend/discord-intake-http.test.ts
git commit -m "feat(discord-intake): add authenticated relay, lookup and heartbeat routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Run lifecycle

**Files:**

- Modify: `convex/_discordIntake.ts`, `convex/discordIntake.ts`
- Modify: `docs/backend/event-schema.md` (new section "Discord Intake" after "Discord Event Export")
- Test: `tests/backend/discord-intake-run.test.ts`

**Interfaces:**

- Consumes: plan 02 `requireConnectorAuthority`, `applyEventCandidate` (with `draftId?` and `expectedUpdatedAt?`), `saveIntakeDraft(..., { connectorDriven: true, connectorId })`, `correctionFields` (exported by plan 02), `eventSyncLinks` (`by_connectorId_externalId`, `by_eventId`); plan 01 `EventIntakeRunContext`, `EventListRow`, `EventIntakeCandidate.decision`.
- Produces:
  - `buildSourceText(messages: Doc<"discordIntakeMessages">[]): string`: non-deleted messages sorted by `createdAt`, each `${authorDisplayName} (${new Date(createdAt).toISOString()}): ${content}`, joined with a blank line; over 12,000 characters drops the oldest messages first, then truncates.
  - `pickPosterAttachments(messages): Array<{ url, contentType, byteLength }>`: non-deleted messages, allowed types, `byteLength <= EVENT_POSTER_MAX_BYTES`, sorted by `byteLength` descending, first 3.
  - `findRunLink(db, connectorId, triggerMessageIds): Promise<{ externalId: string; link: Doc<"eventSyncLinks"> | null; priorEvents: Array<{ sourceMessageId: string; eventSlug: string }>; priorEventIds: Id<"events">[] }>`. The external ID of a Discord announcement link is `triggerMessageIds[0]` of the run that created it; a run whose trigger messages have source rows reuses that older run's external ID.
  - `internal.discordIntake.claimRun({ runId }) => { kind: "skip"; reason: "connector_inactive" | "authority_lost" | "binding_cap" | "source_deleted" } | { kind: "run"; authorityUserId: Id<"users">; mode: "hold" | "autopublish"; sourceText: string; sourceUrl: string; posters: Array<{ url, contentType, byteLength }>; context: EventIntakeRunContext; draftId?: Id<"eventIntakeDrafts"> }`
  - `internal.discordIntake.saveRunDraft({ runId, sourceText, sourceUrl }) => Id<"eventIntakeDrafts">`
  - `internal.discordIntake.finishRun({ runId, draftId, candidate: v.any(), expectedUpdatedAt: v.optional(v.number()) }) => { outcome, eventId?, draftId? }`
  - `internal.discordIntake.failRun({ runId, reason: v.string() }) => null`
  - `internal.discordIntake.resumeConnector({ connectorId }) => null`
  - `internal.discordIntake.listEventsForAgent({ runId, limit }) => EventListRow[]`, `internal.discordIntake.getEventForAgent({ runId, slug }) => { fields: EventIntakeFields; updatedAt: number } | null`

- [ ] **Step 1: Write the failing tests**

Fixture additions in the test file: `seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall", eventDate: "2026-11-07", start: "21:00", timezone: "Europe/London" })` inserting a published community event the way plan 02's `applyEventCandidate` tests do, and `linkEvent(t, connectorId, eventId, messageId)` inserting a `discordIntakeRuns` row (`state: "done"`, `triggerMessageIds: [messageId]`), an `eventSyncLinks` row (`externalId: messageId`, `state: "linked"`), and a `discordIntakeSources` row.

```ts
const pendingRun = (t) => t.run(async ctx => (await ctx.db.query("discordIntakeRuns").collect()).find(run => run.state === "pending")!);
const candidate = (decision: unknown) => ({
  event: { title: "Night at Ari", communitySlug: "night-club", eventDate: "2026-11-07", start: "22:00", end: null, startDate: null, endDate: null, timezone: "Europe/London", venueLabel: "Other Room", summary: null, sourceUrl: null },
  lineup: [], questions: [], decision,
  evidence: [
    { fieldPath: "event.start", origin: "text", excerpt: "now 22:00", assessment: "explicit" },
    { fieldPath: "event.venueLabel", origin: "text", excerpt: null, assessment: "inferred" },
  ],
});

it("builds source text in post order with author and time, without deleted messages", () => {
  const rows = [
    { messageId: M2, authorDisplayName: "Ari", content: "flyer", createdAt: Date.UTC(2026, 10, 1, 20, 1) },
    { messageId: M1, authorDisplayName: "Ari", content: "Friday 9pm", createdAt: Date.UTC(2026, 10, 1, 20, 0) },
    { messageId: "300000000000000003", authorDisplayName: "Ari", content: "oops", createdAt: 0, deletedAt: 1 },
  ] as Doc<"discordIntakeMessages">[];
  assert.equal(buildSourceText(rows), "Ari (2026-11-01T20:00:00.000Z): Friday 9pm\n\nAri (2026-11-01T20:01:00.000Z): flyer");
  assert.ok(buildSourceText([{ ...rows[0], content: "x".repeat(12_000) }, rows[1]]).length <= 12_000);
});

it("passes prior events from discordIntakeSources to the agent", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  const claim = await t.mutation(internal.discordIntake.claimRun, { runId });
  assert.equal(claim.kind, "run");
  assert.deepEqual(claim.context, { trigger: "discord", communitySlug: "night-club", connectorId, mode: "hold", priorEvents: [{ sourceMessageId: M1, eventSlug: "night-at-ari" }] });
  assert.equal(claim.sourceUrl, `https://discord.com/channels/${GUILD}/${CHANNEL}/${M1}`);
  const rows = await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 100 });
  assert.ok(rows.length <= 40 && rows.some(row => row.slug === "night-at-ari"));
});

it("patches only explicit fields when an edited post updates the published event", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  const before = (await t.run(ctx => ctx.db.get(eventId)))!.startAt;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: now 22:00", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }) });
  assert.equal(result.outcome, "updated");
  const events = await t.run(ctx => ctx.db.query("events").collect());
  assert.equal(events.length, 1);
  assert.equal(events[0].venueLabel, "Main Hall");
  assert.equal(events[0].startAt, before! + 3_600_000);
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeSources").collect())).length, 1);
  assert.equal((await t.run(ctx => ctx.db.get(runId)))!.state, "done");
});

it("files a conflict as a hold draft when staff edit the event between get_event and apply", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const read = await t.query(internal.discordIntake.getEventForAgent, { runId, slug: "night-at-ari" });
  assert.equal(read!.fields.venueLabel, "Main Hall");
  const startBefore = (await t.run(ctx => ctx.db.get(eventId)))!.startAt;
  await t.run(ctx => ctx.db.patch(eventId, { venueLabel: "Staff Room", updatedAt: read!.updatedAt + 1 }));
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: now 22:00", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }), expectedUpdatedAt: read!.updatedAt });
  assert.equal(result.outcome, "conflict");
  assert.ok(result.draftId);
  const event = await t.run(ctx => ctx.db.get(eventId));
  assert.equal(event!.venueLabel, "Staff Room");
  assert.equal(event!.startAt, startBefore);
});

it("holds the run's own draft with its posters and records sources for every trigger message", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
  const posterId = await t.run(ctx => ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: authorityUserId, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 86_400_000, uploadExpiresAt: Date.now() }));
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  assert.equal(result.outcome, "draft");
  const sources = await t.run(ctx => ctx.db.query("discordIntakeSources").collect());
  assert.deepEqual(sources.map(row => row.messageId).sort(), [M1, M2]);
  assert.ok(sources.every(row => row.draftId === result.draftId && row.runId === runId));
  assert.equal(result.draftId, draftId);
  assert.equal((await t.run(ctx => ctx.db.get(posterId)))!.draftId, draftId);
  assert.ok((await t.run(ctx => ctx.db.get(draftId)))!.expiresAt > Date.now());
});

it("records source_deleted and flags the link when every source message is deleted", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "delete", { messageId: M1 });
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "source_deleted" });
  const run = await t.run(ctx => ctx.db.get(runId));
  assert.equal(run!.reason, "source_deleted"); assert.equal(run!.state, "done");
  const [link] = await t.run(ctx => ctx.db.query("eventSyncLinks").collect());
  assert.equal(link.state, "external_deleted");
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.publicationState, "published");
});

it("pauses the connector at 20 runs in a UTC day", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  await t.run(async ctx => { for (let i = 0; i < 20; i += 1) await ctx.db.insert("discordIntakeRuns", { connectorId, authorId: AUTHOR_B, triggerMessageIds: [], state: "done", startedAt: dayStart + i, createdAt: dayStart + i }); });
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "binding_cap" });
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector!.state, "paused"); assert.equal(connector!.lastError, "binding_cap");
  const resume = (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).find(job => job.name.includes("resumeConnector"))!;
  assert.equal(resume.scheduledTime, dayStart + 86_400_000);
});

it("pauses the connector when its authority lost manage_integrations", async () => {
  const { t, connectorId, communityProfileId, authorityUserId } = await seedDiscordIntake();
  await revokeManageIntegrations(t, communityProfileId, authorityUserId);
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "authority_lost" });
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector!.state, "paused"); assert.equal(connector!.lastError, "authority_lost");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-run.test.ts`
Expected: FAIL, `claimRun` is undefined.

- [ ] **Step 3: Implement the helpers and mutations**

Decisions the tests leave open:

- `claimRun` order: run must be `pending` (else skip `connector_inactive`); connector must be `active` and not `off`; `requireConnectorAuthority(ctx, connector.communityProfileId, connector.authorityUserId)`, on `CONNECTOR_FORBIDDEN` patch `state: "paused"`, `lastError: "authority_lost"`; cap counts `by_connectorId_startedAt` rows whose `startedAt` is at or after the UTC day start, `take(20)`, and on 20 pauses with `binding_cap` and `ctx.scheduler.runAt(dayStart + 86_400_000, internal.discordIntake.resumeConnector, { connectorId })`; deletion rule; then patch `state: "running"`, `startedAt`. Every skip patches the run `state: "done"`, `reason`, `finishedAt`.
- Deletion rule: when every trigger message is deleted, for each event in `findRunLink(...).priorEventIds`, if every `discordIntakeSources` row of that event (`by_eventId`) points at a deleted message, patch that connector's link for the event to `external_deleted`. Never touch the event.
- Context messages: `by_connectorId_authorId_createdAt` from `now - 6 * 3_600_000`, merged with the trigger rows. `sourceUrl` is the newest message's URL.
- `saveRunDraft` reuses `run.draftId` when set, else `saveIntakeDraft(db, authorityUserId, { patch: { sourceText, sourceUrl } }, now, { connectorDriven: true, connectorId })` and stores the ID on the run. `claimRun`'s `context` carries `mode: connector.mode`.
- `finishRun` calls `applyEventCandidate(ctx, { connector, candidate, actorUserId: connector.authorityUserId, draftId, link: link ?? undefined, externalId, expectedUpdatedAt, idempotencyKey: runId })`, so a held draft or a published event carries the run's posters and source text, upserts one `discordIntakeSources` row per trigger message when the outcome carries `eventId` or `draftId`, and sets the run to `done` with `decision: candidate.decision`, `reason: outcome` (or the `not_event` reason), `draftId`, `eventId`, `finishedAt`. For outcome `not_event` it sets the working draft's `expiresAt` to now.
- `failRun` sets `state: "failed"`, `reason`, `finishedAt`, and expires the working draft.
- `resumeConnector` restores `active` only when the row is still `paused` with `lastError === "binding_cap"`.
- `listEventsForAgent` reads `events.by_communityProfileId_eventDate` over the date window, `take(40)`, adds prior events not in the window, caps at `Math.min(limit, 40)`; `lineupSummary` is the first six lineup labels from `correctionFields` joined with a comma and a space. `getEventForAgent` returns `{ fields: correctionFields(db, event) without sourceText, posterSourceId, and posterDeclaration, updatedAt: event.updatedAt }`, only for events in the connector's community, otherwise `null`.

- [ ] **Step 4: Document behaviour**

`docs/backend/event-schema.md` "Discord Intake": the three tables and what each row means, the quiet window and per-author key, the 6-hour context, the external ID rule above, explicit-only updates (plan 02), the deletion rule, the daily cap, and that messages from before the connector existed are never read.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-*.test.ts tests/backend/event-intake.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/_discordIntake.ts convex/discordIntake.ts convex/_generated docs/backend/event-schema.md tests/backend/discord-intake-run.test.ts
git commit -m "feat(discord-intake): claim, apply and close debounced intake runs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Poster bridge and the run action

**Files:**

- Create: `apps/web/src/lib/server/discord-intake-posters.ts`, `apps/web/src/app/api/internal/discord-intake/poster/route.ts`
- Modify: `convex/discordIntake.ts` (`runPending`, `enqueueAnalytics`)
- Modify: `infra/terraform/vercel/variables.tf`, `infra/terraform/vercel/main.tf` (follow the nullable sensitive `twitch_client_secret` pattern)
- Modify: `docs/deployment/convex-environments.md` ("Discord intake" section)
- Test: `tests/web/discord-intake-posters.test.ts`, `tests/backend/discord-intake-run.test.ts`

**Interfaces:**

- Consumes: `createEventPosterHandlers` and `put` from `apps/web/src/lib/server/event-poster-storage.ts` and `profile-asset-storage.ts`; `internal.eventIntakeSources.beginPosterUpload`, `authorizeExtraction`; plan 01 `extractEventIntake`, `createLangfuseSink`, `createPostHogSink`, `composeSinks`; plan 01 `enqueueProductAnalytics`; Task 3 run mutations.
- Produces:
  - `createDiscordPosterBridge(deps: { admin?: Admin; fetch?: typeof fetch; put?: typeof putProfileAssetObject; handlers?: (actorUserId: Id<"users">) => Pick<ReturnType<typeof createEventPosterHandlers>, "completePosterUpload" | "readPoster"> })` returning `{ store(input: { actorUserId; draftId; url; contentType; byteLength }): Promise<{ posterAssetId }>; read(input: { actorUserId; posterAssetId }): Promise<{ dataUrl: string }> }`.
  - Route `POST /api/internal/discord-intake/poster`, body `{ op: "store", ...storeInput } | { op: "read", ...readInput }`, bearer `VRDEX_DISCORD_POSTER_TOKEN` compared with `timingSafeEqual` as `apps/web/src/app/api/internal/media-cleanup/route.ts` does; 401, 400, 503 when storage is unconfigured.
  - `internal.discordIntake.runPending({ runId }) => null`; `internal.discordIntake.enqueueAnalytics({ event, distinctId, properties }) => null`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/web/discord-intake-posters.test.ts
const png = Buffer.from([137, 80, 78, 71]);
const input = { actorUserId: "u" as never, draftId: "d" as never, url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: png.length };

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
    admin: { mutation: async (_ref, args) => { calls.push(`begin:${args.sha256}`); return { posterAssetId: "p1", uploadStorageKey: "up/key" }; } } as never,
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
```

```ts
// tests/backend/discord-intake-run.test.ts (append)
it("closes the run even when extraction fails", async () => {
  const { t } = await seedDiscordIntake();
  process.env.SITE_URL = "https://vrdex.test"; process.env.VRDEX_DISCORD_POSTER_TOKEN = "p".repeat(40);
  globalThis.fetch = async () => { throw new Error("network down"); };
  await record(t, "create", message(M1, { attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: 10 }] }));
  const runId = (await pendingRun(t))._id;
  await t.action(internal.discordIntake.runPending, { runId });
  const run = await t.run(ctx => ctx.db.get(runId));
  assert.ok(run!.state === "done" || run!.state === "failed");
  assert.ok(run!.finishedAt);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/web/discord-intake-posters.test.ts` and `node --conditions=import --import tsx --test tests/backend/discord-intake-run.test.ts`
Expected: FAIL, module and function not found.

- [ ] **Step 3: Implement the bridge and route**

`store`: host and protocol check against `DISCORD_CDN_HOSTS` (throw `POSTER_URL_REFUSED`), `byteLength <= EVENT_POSTER_MAX_BYTES`, fetch with `redirect: "error"` and `AbortSignal.timeout(15_000)`, body length must equal `byteLength` (throw `POSTER_SOURCE_MISMATCH`), sha256 with `profileAssetUploadChecksum`, `beginPosterUpload`, `put({ storageKey: uploadStorageKey, body, contentType, cacheControl: "private, no-store" })`, then the existing `completePosterUpload`, which validates, freezes, and auto-selects artwork as it does for browser uploads. `read` is the existing `readPoster`. Default `handlers` is `createEventPosterHandlers({ authority: async () => ({ actorUserId }), admin })`.

- [ ] **Step 4: Implement `runPending`**

Order: `claimRun` (return on skip); inside one try: `saveRunDraft`; `store` each of `claim.posters` through the route at `new URL("/api/internal/discord-intake/poster", process.env.SITE_URL)`, skipping a poster that fails; `extractEventIntake({ draftId, sourceText, posterAssetId: first stored, context: claim.context }, deps)`; `finishRun`. Any throw calls `failRun` with the error's code or message (max 200 characters). `deps`:

- `authorize`: `authorizeExtraction` with `actorUserId: claim.authorityUserId`, `draftId`, `posterAssetId`, and `connectorId: claim.context.connectorId` (plan 02 skips the per-actor model cap for connector runs). `mode` reaches the sinks through `claim.context.mode`; no sink wrapper.
- `search_people`, `search_communities`: `api.search.searchUniversal` with `entityType: "profile"` and `profileType`, mapped to `{ slug, displayName: row.title }`, as `createEventIntakeExtractor` does.
- `list_events`, `get_event`: Task 3 internal queries keyed by `runId`. `get_event` hands the agent `result.fields` and records `result.updatedAt` in a run-local `Map<string, number>` keyed by slug; when the candidate's decision is `update`, `finishRun` receives `expectedUpdatedAt: map.get(decision.slug)`, otherwise none.
- `readPoster`: the route's `read` op.
- `sink`: `composeSinks(createPostHogSink(event => ctx.runMutation(internal.discordIntake.enqueueAnalytics, event)), ...(LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY ? [createLangfuseSink({ publicKey, secretKey, baseUrl: LANGFUSE_BASE_URL })] : []))`.

`enqueueAnalytics` wraps `enqueueProductAnalytics(ctx.db, args)`.

- [ ] **Step 5: Env and Terraform**

`docs/deployment/convex-environments.md`, "Discord intake": `VRDEX_DISCORD_POSTER_TOKEN` (Convex and web, at least 32 random bytes, owner BASIC; rotation: write web first, then Convex; runs in between store no posters and continue text-only); `SITE_URL` is reused as the bridge origin; `OPENAI_API_KEY`, `VRDEX_EVENT_INTAKE_AI_ENABLED`, `VRDEX_EVENT_INTAKE_MODEL` are now also read by Convex for Discord runs. Terraform: variable `discord_poster_token` (sensitive, nullable, default `null`) and one `vercel_project_environment_variable` per target for `VRDEX_DISCORD_POSTER_TOKEN`, created only when the variable is set.

- [ ] **Step 6: Run tests and checks**

Run: `node --import tsx --test tests/web/discord-intake-posters.test.ts`, `node --conditions=import --import tsx --test tests/backend/discord-intake-*.test.ts`, `pnpm typecheck:web`, `pnpm typecheck:backend`, `terraform -chdir=infra/terraform/vercel validate`
Expected: PASS, no type errors, `Success! The configuration is valid.`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/server/discord-intake-posters.ts apps/web/src/app/api/internal/discord-intake convex/discordIntake.ts convex/_generated infra/terraform/vercel docs/deployment/convex-environments.md tests/web/discord-intake-posters.test.ts tests/backend/discord-intake-run.test.ts
git commit -m "feat(discord-intake): run the intake agent with Discord posters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Commands and connect authority

**Files:**

- Modify: `convex/_discordIntake.ts`, `convex/discordIntake.ts`, `convex/http.ts` (command route calls `handleCommand`)
- Test: `tests/backend/discord-intake-commands.test.ts`

**Interfaces:**

- Consumes: `getLinkedProviderAccount` (`convex/accounts.ts:50`), `linkProfileToAsset` and `getActiveProfileLinks` (`convex/_externalControl.ts`), `getAccountFeatureAccess` (`convex/_accountFeatures.ts:12`), `profileOwners.by_userId_state`, `communityAuthorities.by_subjectTokenIdentifier_state`, `api.search.searchUniversal`, plan 02 `requireConnectorAuthority`.
- Produces:
  - `connectDiscordAnnouncements(ctx: MutationCtx, args: { userId: Id<"users">; communityProfileId: Id<"profiles">; guildId: string; guildName: string; channelId: string; channelName: string; mode: "hold" | "autopublish"; quietWindowSeconds?: number }): Promise<Id<"eventConnectors">>`: stores `target: { guildId, guildName, channelId, channelName }`; `requireConnectorAuthority`; a non-removed `discord_announcements` connector on the channel for the same community is updated in place, for another community throws `CHANNEL_TAKEN`; inserts with `direction: "import"`, `state: "active"`, `authorityUserId: userId`; when the community has no active `discord_guild` link for `guildId`, calls `linkProfileToAsset(ctx, { profileId, assetType: "discord_guild", assetExternalId: guildId, linkRole: "secondary", linkedByUserId: userId, now })`.
  - `internal.discordIntake.resolveDiscordInvoker({ discordUserId }) => { userId } | null`: wraps Task 1's `resolveDiscordUserId`.
  - `internal.discordIntake.manageableCommunities({ userId, query }) => Array<{ slug, displayName }>`: owned communities plus `communityAuthorities` communities for the subject `${CLERK_JWT_ISSUER_DOMAIN}|${clerkUserId}`, filtered through `requireConnectorAuthority`, matched case-insensitively on `query`, at most 25.
  - `internal.discordIntake.applyCommand({ userId, command, guildId, channelId, invokerHasManageGuild, options }) => { reply: string }`.
  - `internal.discordIntake.handleCommand(masterCommandBody) => { reply: string } | { choices: Array<{ name: string; value: string }> }`.
  - `discordCommandReplies` (below).

- [ ] **Step 1: Write the failing tests**

```ts
const SITE = "https://vrdex.test";
const body = (over = {}) => ({ command: "connect", guildId: GUILD, channelId: CHANNEL, invokerDiscordUserId: AUTHOR_A, invokerHasManageGuild: true, options: { community: "night-club", mode: "hold", channelName: "announcements", guildName: "Night Server" }, ...over });
const linkDiscord = (t, userId, discordUserId = AUTHOR_A) => t.run(ctx => ctx.db.insert("discordVerificationWatermarks", { userId, discordUserId, issuedGeneration: 1, appliedGeneration: 1, appliedAt: Date.now(), issuedAt: Date.now(), updatedAt: Date.now() }));
beforeEach(() => { process.env.SITE_URL = SITE; });

it("refuses an invoker whose Discord ID two VRDex users verified", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  const other = await t.run(ctx => ctx.db.insert("users", { clerkUserId: newClerkUserId() }));
  await linkDiscord(t, authorityUserId); await linkDiscord(t, other);
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body()), { reply: `Link your Discord account on VRDex first: ${SITE}/account/connections` });
});

it("refuses connect without Manage Server or without manage_integrations", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const denied = { reply: "You need to manage integrations for that community." };
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body({ invokerHasManageGuild: false })), denied);
  await seedCommunity(t, { slug: "other-club", displayName: "Other Club" }); // no grant
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body({ options: { community: "other-club", mode: "hold", channelName: "announcements" } })), denied);
});

it("connects with the spec reply and creates one secondary guild link", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await t.run(async ctx => { for (const row of await ctx.db.query("eventConnectors").collect()) await ctx.db.delete(row._id); });
  await linkDiscord(t, authorityUserId);
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body()), { reply: "Connected #announcements to Night Club. Hold for review." });
  await t.action(internal.discordIntake.handleCommand, body({ channelId: "100000000000000003", options: { community: "night-club", mode: "autopublish", channelName: "news", guildName: "Night Server" } }));
  const connectors = await t.run(ctx => ctx.db.query("eventConnectors").collect());
  assert.equal(connectors.length, 2);
  const { communityProfileId: community, kind, direction, mode, authorityUserId: authority, target, state } = connectors[0];
  assert.deepEqual({ community, kind, direction, mode, authority, target, state }, { community: communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", authority: authorityUserId, target: { guildId: GUILD, guildName: "Night Server", channelId: CHANNEL, channelName: "announcements" }, state: "active" });
  const links = await t.run(ctx => ctx.db.query("profileExternalLinks").collect());
  assert.equal(links.length, 1);
  assert.equal(links[0].assetType, "discord_guild"); assert.equal(links[0].assetExternalId, GUILD);
  assert.equal(links[0].linkRole, "secondary"); assert.equal(links[0].linkedByUserId, authorityUserId);
  assert.equal(links[0].verifiedByProofId, undefined);
});

it("disconnects and reports status with the spec replies", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body({ command: "status", options: { channelName: "announcements" } })), { reply: "Connected #announcements to Night Club. Hold for review." });
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body({ command: "disconnect", options: { channelName: "announcements" } })), { reply: "Disconnected #announcements." });
  assert.equal((await t.run(ctx => ctx.db.query("eventConnectors").collect()))[0].state, "removed");
});

it("autocompletes only communities the invoker may manage", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await seedCommunity(t, { slug: "other-club", displayName: "Other Club" }); // no grant
  assert.deepEqual(await t.action(internal.discordIntake.handleCommand, body({ command: "autocomplete", options: { query: "club" } })), { choices: [{ name: "Night Club", value: "night-club" }] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-commands.test.ts`
Expected: FAIL, `handleCommand` is undefined.

- [ ] **Step 3: Implement**

Exact copy (spec table rows "Command reply, connected", "disconnected", "not linked", "no permission"; the last two keys are new strings that need BASIC's approval in the PR):

```ts
export const discordCommandReplies = {
  connected: (channel: string, community: string, mode: "hold" | "autopublish") =>
    `Connected #${channel} to ${community}. ${mode === "hold" ? "Hold for review" : "Publish automatically"}.`,
  disconnected: (channel: string) => `Disconnected #${channel}.`,
  notLinked: (siteUrl: string) => `Link your Discord account on VRDex first: ${new URL("/account/connections", siteUrl)}`,
  noPermission: "You need to manage integrations for that community.",
  pausedSuffix: " Paused.",
  notConnected: "Not connected.",
} as const;
```

`handleCommand`: unresolved invoker returns `notLinked` (or `{ choices: [] }` for autocomplete); `autocomplete` uses `manageableCommunities`, or for a super admin (`getAccountFeatureAccess(...).superAdmin`) `api.search.searchUniversal` with `profileType: "community"`, `limit: 25`, names truncated to 100 characters; other commands go to `applyCommand`. `applyCommand`: `invokerHasManageGuild === false`, `CONNECTOR_FORBIDDEN`, an unknown slug, and `CHANNEL_TAKEN` all return `noPermission`; `status` returns `connected` (plus `pausedSuffix` when paused) or `notConnected`; `disconnect` sets `state: "removed"` after `requireConnectorAuthority`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/discord-intake-*.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_discordIntake.ts convex/discordIntake.ts convex/http.ts convex/_generated tests/backend/discord-intake-commands.test.ts
git commit -m "feat(discord-intake): connect, disconnect and status slash command backend

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Discord REST, channel listing, and the site connect flow

**Files:**

- Create: `convex/_discordRest.ts`
- Modify: `convex/_discordIntake.ts`, `convex/discordIntake.ts`, `convex/discordVerification.ts:479` (extract the handler body into `manageableDiscordGuilds(db, userId, now)`; `getManageableGuilds` calls it)
- Create: `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/discord-connect.tsx`
- Modify: `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx` (plan 02; render `DiscordConnect` with the connect buttons)
- Modify: `docs/deployment/convex-environments.md` (`DISCORD_APPLICATION_ID` on Convex; `DISCORD_BOT_TOKEN` must be the gateway application's bot)
- Test: `tests/backend/discord-rest.test.ts`, `tests/backend/discord-intake-commands.test.ts`

**Interfaces:**

- Consumes: Task 5 `connectDiscordAnnouncements`; `requireControlProof(db, userId, "discord_guild", guildId, "manager")`; `requireUser`; `getActiveProfileLinks`.
- Produces:
  - `discordRequest(request: { method: string; path: string; body?: unknown; token?: string }): Promise<Response>`: base `DISCORD_API_BASE_URL ?? "https://discord.com/api/v10"`, header `authorization: Bot ${token ?? DISCORD_BOT_TOKEN}`; on 429 reads `Retry-After` seconds (header, else JSON `retry_after`), waits and retries when it is 5 s or less, at most 3 attempts in all, and throws `DISCORD_RATE_LIMITED` otherwise.
  - `DISCORD_BOT_PERMISSIONS = 17600776072192`.
  - `readableTextChannels(channels: DiscordChannel[], access: { guildId: string; botUserId: string; botRoleIds: string[]; roles: Array<{ id: string; permissions: string }> }): Array<{ channelId: string; name: string }>`: types 0 and 5 where the bot holds View Channel and Read Message History.
  - `discordBotInviteUrl(applicationId: string, guildId: string): string`.
  - `api.discordIntake.connectContext({ communityProfileId }) => { enabled: boolean; guilds: Array<{ guildId: string; guildName?: string }>; preselectedGuildId: string | null }`.
  - `api.discordIntake.listConnectableChannels({ communityProfileId, guildId }) => { state: "bot_missing"; inviteUrl: string } | { state: "ready"; channels: Array<{ channelId: string; name: string }> }`.
  - `api.discordIntake.connectChannel({ communityProfileId, guildId, guildName, channelId, channelName, mode }) => Id<"eventConnectors">` (names from `connectContext` and the channel listing).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/discord-rest.test.ts
it("retries a 429 after Retry-After and returns the next response", async () => {
  const calls: Array<{ url: string; auth: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization")! });
    return calls.length === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "0.01" } }) : new Response("[]");
  };
  const response = await discordRequest({ method: "GET", path: `/guilds/${GUILD}/channels`, token: "test-token" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.url), Array(2).fill(`https://discord.com/api/v10/guilds/${GUILD}/channels`));
  assert.equal(calls[0].auth, "Bot test-token");
});

it("throws after three 429s and never waits past 5 seconds", async () => {
  let count = 0;
  globalThis.fetch = async () => { count += 1; return new Response("{}", { status: 429, headers: { "retry-after": "0" } }); };
  await assert.rejects(discordRequest({ method: "GET", path: "/users/@me", token: "t" }), /DISCORD_RATE_LIMITED/);
  assert.equal(count, 3);
  count = 0;
  globalThis.fetch = async () => { count += 1; return new Response("{}", { status: 429, headers: { "retry-after": "6" } }); };
  const started = Date.now();
  await assert.rejects(discordRequest({ method: "GET", path: "/users/@me", token: "t" }), /DISCORD_RATE_LIMITED/);
  assert.equal(count, 1);
  assert.ok(Date.now() - started < 1_000);
});

it("defaults the token to DISCORD_BOT_TOKEN", async () => {
  process.env.DISCORD_BOT_TOKEN = "env-token";
  let auth = "";
  globalThis.fetch = async (_url, init) => { auth = new Headers(init?.headers).get("authorization")!; return new Response("{}"); };
  await discordRequest({ method: "GET", path: "/users/@me" });
  assert.equal(auth, "Bot env-token");
});

it("lists only text and announcement channels the bot can read", () => {
  const VIEW_AND_HISTORY = String(1024 + 65536);
  const access = { guildId: GUILD, botUserId: "400000000000000001", botRoleIds: ["500000000000000001"], roles: [{ id: GUILD, permissions: VIEW_AND_HISTORY }, { id: "500000000000000001", permissions: "0" }] };
  const channel = (id: string, type: number, permission_overwrites: unknown[] = []) => ({ id, name: `c${id.slice(-1)}`, type, permission_overwrites });
  const channels = [
    channel("600000000000000001", 0),
    channel("600000000000000002", 0, [{ id: GUILD, type: 0, allow: "0", deny: "1024" }]),
    channel("600000000000000003", 5, [{ id: GUILD, type: 0, allow: "0", deny: "1024" }, { id: "500000000000000001", type: 0, allow: "1024", deny: "0" }]),
    channel("600000000000000004", 2),
  ];
  assert.deepEqual(readableTextChannels(channels, access).map(row => row.channelId), ["600000000000000001", "600000000000000003"]);
  const admin = { ...access, roles: [{ id: GUILD, permissions: "0" }, { id: "500000000000000001", permissions: "8" }] };
  assert.equal(readableTextChannels(channels, admin).length, 3);
});

it("builds the bot invite with the fixed scopes and permissions", () => {
  assert.equal(discordBotInviteUrl("700000000000000001", GUILD), `https://discord.com/oauth2/authorize?client_id=700000000000000001&scope=bot+applications.commands&permissions=17600776072192&guild_id=${GUILD}&disable_guild_select=true`);
  assert.equal(DISCORD_BOT_PERMISSIONS, 17600776072192);
});
```

```ts
// tests/backend/discord-intake-commands.test.ts (append)
it("site connect requires a manager-level guild proof", async () => {
  const { t, clerkUserId, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await t.run(async ctx => { for (const row of await ctx.db.query("eventConnectors").collect()) await ctx.db.delete(row._id); });
  const user = t.withIdentity(clerkTestIdentity(clerkUserId));
  const args = { communityProfileId, guildId: GUILD, guildName: "Night Server", channelId: CHANNEL, channelName: "announcements", mode: "hold" as const };
  await assert.rejects(user.mutation(api.discordIntake.connectChannel, args), /CONTROL_NOT_VERIFIED/);
  await seedGuildProof(t, authorityUserId, GUILD, "manager"); // externalControlProofs row, assetType discord_guild, state active
  assert.ok(await user.mutation(api.discordIntake.connectChannel, args));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-rest.test.ts tests/backend/discord-intake-commands.test.ts`
Expected: FAIL, modules and functions not found.

- [ ] **Step 3: Implement the backend**

The permission computation `readableTextChannels` uses (Discord's documented order):

```ts
let p = BigInt(roles.find(r => r.id === guildId)?.permissions ?? "0");
for (const r of roles) if (botRoleIds.includes(r.id)) p |= BigInt(r.permissions);
if (p & 8n) return true;
const ow = channel.permission_overwrites ?? [];
const everyone = ow.find(o => o.id === guildId);
if (everyone) p = (p & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
let allow = 0n, deny = 0n;
for (const o of ow) if (o.type === 0 && botRoleIds.includes(o.id)) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
p = (p & ~deny) | allow;
const member = ow.find(o => o.type === 1 && o.id === botUserId);
if (member) p = (p & ~BigInt(member.deny)) | BigInt(member.allow);
return (p & 66560n) === 66560n;
```

`listConnectableChannels` (action): authority through an internal query that runs `requireUser`, `requireConnectorAuthority`, and `requireControlProof(..., "manager")`; then `GET /users/@me`, `GET /guilds/{guildId}/members/{botUserId}`, `GET /guilds/{guildId}/roles`, `GET /guilds/{guildId}/channels` through `discordRequest` with the default token. A 403 or 404 on the member read returns `bot_missing` with `discordBotInviteUrl(DISCORD_APPLICATION_ID, guildId)`. `connectContext` returns `enabled: false` (and nothing else) when the flag is off; `preselectedGuildId` is the community's active `discord_guild` link when the user has a manageable proof for it, else the only manageable guild, else `null`. `connectChannel` runs the same three checks and calls `connectDiscordAnnouncements`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/discord-rest.test.ts tests/backend/discord-intake-*.test.ts tests/backend/profile-claims*.test.ts`
Expected: PASS (the claims run proves the `getManageableGuilds` extraction changed nothing).

- [ ] **Step 5: Build `DiscordConnect`**

States, using `Button`, `Field`, `Select` from `@/components/ui` and the community ID from `useClubWorkspace()` as `club-connection.tsx` does:

1. `enabled === false`: render nothing.
2. No manageable guilds: `Connect Discord` links to `/api/discord/verify/start?returnTo=` plus the current path.
3. A guild chosen (preselected, or a `Server` select when several): call `listConnectableChannels` on mount and again on each window `focus` event. `bot_missing`: `Connect Discord` opens `inviteUrl` with `target="_blank"` and `rel="noopener"`.
4. `ready`: `Channel` select, mode select `Hold for review` / `Publish automatically` with the help line for the selected mode (`New events wait in My events until you approve them.` / `New events and changes go live as soon as they are read.`), and `Connect Discord` submits `connectChannel`. The plan 02 list shows the new row reactively.

New public string not in a spec table, for BASIC's approval in the PR: `Server`.

- [ ] **Step 6: Visual verification**

Run `pnpm dev:backend:local` and `pnpm dev:web`, open the community's Integrations page as a seeded owner, and capture screenshots at desktop and 390 px width of states 2, 3, and 4 (stub `listConnectableChannels` results with seeded data or a local Discord bot). Review each screenshot with a VLM against the AGENTS UI rule (calm, no bubble shapes, no explanatory copy beyond the approved strings). Expected: no layout overflow, labels as listed, help line switches with the mode.

- [ ] **Step 7: Run checks and commit**

Run: `pnpm typecheck:web`, `pnpm typecheck:backend`
Expected: no errors.

```bash
git add convex/_discordRest.ts convex/_discordIntake.ts convex/discordIntake.ts convex/discordVerification.ts convex/_generated "apps/web/src/app/account/communities/[slug]/(workspace)/integrations" docs/deployment/convex-environments.md tests/backend/discord-rest.test.ts tests/backend/discord-intake-commands.test.ts
git commit -m "feat(discord-intake): connect a Discord channel from Integrations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Gateway relay, cache, commands, and heartbeat

**Files:**

- Create: `apps/discord-gateway/src/relay.ts`, `src/connectorCache.ts`, `src/commands.ts`, `src/register-commands.ts`
- Modify: `apps/discord-gateway/src/index.ts`, `apps/discord-gateway/package.json` (script `"register-commands": "tsx src/register-commands.ts"`)
- Modify: `docs/deployment/discord-gateway.md`
- Create: `apps/discord-gateway/src/catchUp.ts`
- Test: `apps/discord-gateway/src/relay.test.ts`, `src/connectorCache.test.ts`, `src/commands.test.ts`, `src/catchUp.test.ts`

**Interfaces:**

- Consumes: the Task 2 routes and Task 5 command responses.
- Produces:
  - `relay.ts`: `type MessagePayload` (master shape); `type RelayableMessage` (structural subset of discord.js `Message`: `id`, `system`, `content`, `createdTimestamp`, `editedTimestamp`, `author { id, bot, username, globalName? }`, `member?: { displayName }`, `attachments: Map<string, { url, contentType: string | null, size }>`); `toMessagePayload(message: RelayableMessage): MessagePayload | null`; `relay(kind: "message" | "scheduled_event", action: "create" | "update" | "delete", guildId: string, channelId: string | undefined, payload: unknown): Promise<void>`; `postIntake(path: string, body: unknown): Promise<Response>`; `fetchConnectors(query?: { guildId: string; channelId?: string }): Promise<ConnectorSummary[]>` (no argument: the startup listing). Env read at call time.
  - `connectorCache.ts`: `type ConnectorSummary = { connectorId: string; kind: string; direction: string; mode: string; state: string; guildId: string; channelId?: string; lastMessageId?: string }`; `createConnectorCache(options: { fetchConnectors: (query: { guildId: string; channelId?: string }) => Promise<ConnectorSummary[]>; ttlMs?: number; now?: () => number }): { get(query: { guildId: string; channelId?: string }): Promise<ConnectorSummary[]> }`, keyed by `guildId` plus `channelId` (empty when absent), `ttlMs` default `60_000`.
  - `commands.ts`: `vrdexCommand: SlashCommandBuilder`; `buildCommandRequest(invocation: { subcommand: "connect" | "disconnect" | "status" | "autocomplete"; guildId: string; guildName: string; channelId: string; channelName: string; userId: string; memberPermissions: string; options: Record<string, string | number> })` returning the master command body; `handleVrdexInteraction(interaction: ChatInputCommandInteraction | AutocompleteInteraction): Promise<void>`.
  - `catchUp.ts`: `catchUpMissedMessages(deps: { fetchConnectors: () => Promise<ConnectorSummary[]>; fetchMessagesAfter: (channelId: string, afterId: string) => Promise<RelayableMessage[]>; relay: typeof relay }): Promise<number>` returning the number relayed.

- [ ] **Step 1: Write the failing tests**

```ts
// src/relay.test.ts
const flyer = { url: "https://cdn.discordapp.com/attachments/1/2/flyer.png", contentType: "image/png", size: 1234 };
const notes = { url: "https://cdn.discordapp.com/attachments/1/2/notes.txt", contentType: "text/plain", size: 10 };
const message = (over: Partial<RelayableMessage> = {}): RelayableMessage => ({
  id: "300000000000000001", system: false, content: "Friday 9pm", createdTimestamp: 1_700_000_000_000, editedTimestamp: null,
  author: { id: "200000000000000001", bot: false, username: "ari", globalName: "Ari" }, member: { displayName: "Ari B" },
  attachments: new Map([["1", flyer], ["2", notes]]), ...over,
});

it("drops bots, system messages, and posts with neither text nor image", () => {
  assert.equal(toMessagePayload(message({ author: { id: "200000000000000001", bot: true, username: "b" } })), null);
  assert.equal(toMessagePayload(message({ system: true })), null);
  assert.equal(toMessagePayload(message({ content: "  ", attachments: new Map([["2", notes]]) })), null);
  assert.notEqual(toMessagePayload(message({ content: "" })), null);
});

it("builds the relay payload with image attachments only", () => {
  assert.deepEqual(toMessagePayload(message()), {
    messageId: "300000000000000001", authorId: "200000000000000001", authorDisplayName: "Ari B", isBot: false,
    content: "Friday 9pm", createdAt: 1_700_000_000_000,
    attachments: [{ url: flyer.url, contentType: "image/png", byteLength: 1234 }],
  });
});

it("posts to the Convex relay with the intake secret", async () => {
  process.env.CONVEX_SITE_URL = "https://example.convex.site"; process.env.DISCORD_INTAKE_SECRET = "secret";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response("{}"); };
  await relay("message", "create", "100000000000000001", "100000000000000002", { messageId: "300000000000000001" });
  assert.equal(calls[0].url, "https://example.convex.site/discord-intake/relay");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer secret");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { kind: "message", action: "create", guildId: "100000000000000001", channelId: "100000000000000002", payload: { messageId: "300000000000000001" } });
});
```

```ts
// src/connectorCache.test.ts
it("caches lookups for 60 seconds per channel", async () => {
  let now = 0, calls = 0;
  const cache = createConnectorCache({ now: () => now, fetchConnectors: async () => { calls += 1; return [{ connectorId: "c1", kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: "g", channelId: "c" }]; } });
  await cache.get({ guildId: "g", channelId: "c" }); now = 59_999; await cache.get({ guildId: "g", channelId: "c" }); assert.equal(calls, 1);
  now = 60_001; await cache.get({ guildId: "g", channelId: "c" }); assert.equal(calls, 2);
  await cache.get({ guildId: "g", channelId: "other" }); assert.equal(calls, 3);
  await cache.get({ guildId: "g" }); assert.equal(calls, 4);
});

it("does not cache a failed lookup", async () => {
  let calls = 0;
  const cache = createConnectorCache({ fetchConnectors: async () => { calls += 1; if (calls === 1) throw new Error("down"); return []; } });
  await assert.rejects(cache.get({ guildId: "g", channelId: "c" }));
  assert.deepEqual(await cache.get({ guildId: "g", channelId: "c" }), []);
  assert.equal(calls, 2);
});
```

```ts
// src/catchUp.test.ts (`message` is the relay test factory, moved to `src/testMessages.ts` and imported by both tests)
it("relays posts made while the gateway was down, oldest first, through the normal path", async () => {
  const base = { kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: "100000000000000001" };
  const connectors = [
    { ...base, connectorId: "c1", channelId: "100000000000000002", lastMessageId: "300000000000000001" },
    { ...base, connectorId: "c2", channelId: "100000000000000003" },
    { ...base, connectorId: "c3", kind: "discord_board", channelId: "100000000000000004", lastMessageId: "300000000000000009" },
  ];
  const reads: string[] = [];
  const relayed: unknown[][] = [];
  const count = await catchUpMissedMessages({
    fetchConnectors: async () => connectors,
    fetchMessagesAfter: async (channelId, afterId) => {
      reads.push(`${channelId}:${afterId}`);
      return [message({ id: "300000000000000003" }), message({ id: "300000000000000002" }), message({ id: "300000000000000004", author: { id: "200000000000000009", bot: true, username: "b" } })];
    },
    relay: async (...args) => { relayed.push(args); },
  });
  assert.deepEqual(reads, ["100000000000000002:300000000000000001"]);
  assert.equal(count, 2);
  assert.deepEqual(relayed.map(([kind, action, guildId, channelId, payload]) => [kind, action, guildId, channelId, (payload as MessagePayload).messageId]), [
    ["message", "create", "100000000000000001", "100000000000000002", "300000000000000002"],
    ["message", "create", "100000000000000001", "100000000000000002", "300000000000000003"],
  ]);
});
```

```ts
// src/commands.test.ts
it("registers /vrdex for Manage Server holders only", () => {
  const json = vrdexCommand.toJSON();
  assert.equal(json.name, "vrdex");
  assert.equal(json.default_member_permissions, "32");
  assert.deepEqual(json.options!.map(option => option.name), ["connect", "disconnect", "status"]);
  const connect = json.options![0] as { options: Array<Record<string, unknown>> };
  assert.deepEqual(connect.options.map(option => [option.name, option.required ?? false]), [["community", true], ["mode", true], ["quiet_window", false]]);
  assert.equal(connect.options[0].autocomplete, true);
  assert.deepEqual(connect.options[1].choices, [{ name: "Hold for review", value: "hold" }, { name: "Publish automatically", value: "autopublish" }]);
  assert.deepEqual([connect.options[2].min_value, connect.options[2].max_value], [30, 600]);
});

it("reports the invoker's Manage Server permission to Convex", () => {
  const base = { subcommand: "connect" as const, guildId: "100000000000000001", guildName: "Night Server", channelId: "100000000000000002", channelName: "announcements", userId: "200000000000000001", options: { community: "night-club", mode: "hold" } };
  assert.equal(buildCommandRequest({ ...base, memberPermissions: "32" }).invokerHasManageGuild, true);
  assert.equal(buildCommandRequest({ ...base, memberPermissions: "2048" }).invokerHasManageGuild, false);
  assert.deepEqual(buildCommandRequest({ ...base, memberPermissions: "8" }), {
    command: "connect", guildId: base.guildId, channelId: base.channelId, invokerDiscordUserId: base.userId, invokerHasManageGuild: true,
    options: { community: "night-club", mode: "hold", channelName: "announcements", guildName: "Night Server" },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:discord-gateway`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the modules**

Decisions:

- `toMessagePayload` display name: `member?.displayName ?? author.globalName ?? author.username`; `editedAt` only when `editedTimestamp` is set; images are attachments whose `contentType` starts with `image/`.
- `buildCommandRequest` uses `new PermissionsBitField(BigInt(memberPermissions)).has(PermissionFlagsBits.ManageGuild)` (Administrator counts) and copies `channelName` and `guildName` (from `interaction.guild.name`) into `options`.
- `vrdexCommand`: `setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)`, `setContexts(InteractionContextType.Guild)`. Descriptions are public copy for BASIC's approval: command `VRDex`, `connect` `Connect this channel`, `disconnect` `Disconnect this channel`, `status` `Show this channel's connection`, `community` `Community`, `mode` `Mode`, `quiet_window` `Seconds to wait for edits`.
- `handleVrdexInteraction`: chat input defers an ephemeral reply, posts `/discord-intake/command`, and `editReply`s the returned `reply`; a non-2xx or thrown call `deleteReply`s (no new copy). Autocomplete responds with at most 25 `choices`, or `[]` on failure.
- `register-commands.ts`: `new REST().setToken(DISCORD_BOT_TOKEN).put(Routes.applicationCommands(DISCORD_APPLICATION_ID), { body: [vrdexCommand.toJSON()] })`.

- [ ] **Step 4: Implement the startup catch-up**

`catchUpMissedMessages` reads `fetchConnectors()`, keeps `discord_announcements` rows with a `channelId` and a `lastMessageId`, calls `fetchMessagesAfter` once per connector, sorts the result by `BigInt(id)` ascending (Discord returns newest first), and relays each `toMessagePayload` result that is not `null` as `relay("message", "create", guildId, channelId, payload)`. One connector's failure logs one JSON line and the loop continues. In `index.ts`, `fetchMessagesAfter` is `client.channels.fetch(channelId)` then `channel.messages.fetch({ after: afterId, limit: 100 })` (the REST call `GET /channels/{channelId}/messages?after={lastMessageId}&limit=100`). Posts beyond the newest 100 missed ones are not recovered; `recordMessage`'s upsert already makes the replay safe to repeat.

- [ ] **Step 5: Wire `index.ts`**

Intents `Guilds`, `GuildMessages`, `MessageContent`, `GuildScheduledEvents`; `partials: [Partials.Message]`. `ClientReady` runs `catchUpMissedMessages` once (not awaited by the ready handler). Startup throws when `CONVEX_SITE_URL` or `DISCORD_INTAKE_SECRET` is missing, as it does for the token. `MessageCreate` and `MessageUpdate` (fetch the new message when partial) relay `toMessagePayload` only when `cache.get({ guildId, channelId })` holds an `active` `discord_announcements` connector; `MessageDelete` relays `{ messageId }` under the same check. `InteractionCreate` sends `vrdex` chat input and autocomplete interactions to `handleVrdexInteraction` before the existing media routing. Heartbeat: `postIntake("/discord-intake/heartbeat", { instanceId, at: Date.now() })` on start and every 60,000 ms with `instanceId = randomUUID()` per process; failures log one JSON line and never exit. Relay failures log one JSON line with the message ID and never throw out of the handler.

- [ ] **Step 6: Document behaviour**

`docs/deployment/discord-gateway.md`: runtime now requests `GuildMessages`, `MessageContent` (privileged, enabled in the developer portal, no verification under 100 servers), and `GuildScheduledEvents`; it relays posts only from connected channels, drops bot, system, and empty posts, registers `/vrdex` through `pnpm --filter @vrdex/discord-gateway register-commands`, replays up to 100 posts per connected channel made while it was down, and posts a heartbeat every minute. Required env: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `CONVEX_SITE_URL`, `DISCORD_INTAKE_SECRET`. Remove the statements that the runtime registers no commands and requests no privileged intents. Plan 05 owns the deployment sections.

- [ ] **Step 7: Run tests and checks**

Run: `pnpm test:discord-gateway`, `pnpm typecheck:discord-gateway`, `pnpm exec markdownlint-cli2 docs/deployment/discord-gateway.md docs/deployment/convex-environments.md docs/backend/event-schema.md`
Expected: all tests PASS (including the existing media routing tests), no type errors, 0 lint errors.

- [ ] **Step 8: Commit**

```bash
git add apps/discord-gateway docs/deployment/discord-gateway.md
git commit -m "feat(discord-gateway): relay channel posts, /vrdex commands and heartbeat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
