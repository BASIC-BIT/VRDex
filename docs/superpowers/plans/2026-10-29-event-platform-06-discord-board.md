# Discord Board (Event Platform 06) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `discord_board` connector kind: a bot-owned Discord channel that holds one embed per upcoming public event, edited in place, retired a day after the event ends, and backfilled daily.

**Architecture:** One module, `convex/eventSyncKinds/discordBoard.ts`, holds the embed renderer, the `SyncKindHandler` that plan 02's `runJob` dispatches to, the refresh planner, the daily cron entry, and the channel picker action. The handler writes Discord over REST through `discordRequest`; the refresh only enqueues `export_upsert` and `export_delete` jobs, so every Discord write goes through the runner's lease, retry, link bookkeeping, analytics, and failure alarm.

**Tech Stack:** Convex (internal queries and mutations, actions, crons), Discord REST v10, Next.js client component, `node:test` with `convex-test`.

**Spec:** `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (The model, Directions and field ownership, Discord board, Settings page, Observability, Public copy). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Depends on plan 02 being merged: `eventConnectors`, `eventSyncLinks`, `eventSyncJobs`, `enqueueSyncJob`, `internal.eventSync.runJob`, `SyncKindHandler` in `convex/eventSyncKinds/types.ts`, `syncKindHandlers` in `convex/eventSyncKinds/index.ts`, `requireConnectorAuthority`, `api.eventConnectors.create`, and the Integrations page `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx`. Also depends on plan 03's `convex/_discordRest.ts` (`discordRequest`, its 429 rule, and `DISCORD_BOT_PERMISSIONS`); this plan neither changes that file nor the bot's permissions or invite URL. Names and signatures are copied from the master plan and are not changed here.
- Start from `origin/main` in a fresh worktree (the shared checkout gets branch-switched). End in a PR to `main`; never merge.
- Public strings this plan ships, all to be listed in the PR for BASIC's approval: `Event board` (spec copy table), `Cancelled` (spec Discord board text), `Time`, `Date`, `End`, `Host`, `World`, `Worlds`, `(Time TBA)` (already shipped by the Discord export in `convex/_eventDiscordExport.ts`), and new utility labels `Venue`, `Server`, `Channel`, `Connect`, plus the settings-visible `lastError` codes `discord_forbidden` and `discord_channel_missing`. No em-dash, no double hyphen, no AI mention.
- Discord IDs validate with `/^\d{17,20}$/`. No Discord request is built from a target or link ID that fails it.
- No message to humans beyond the board embeds. Every POST and PATCH body carries `allowed_mentions: { parse: [] }` and no `content`.
- Flag `VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED`, default off (`=== "true"` enables). It gates the handler, the cron, the channel picker, and the Connect button. Plan 02's `VRDEX_EVENT_CONNECTORS_ENABLED` still gates the runner.
- Board window: post an event when it starts within 14 days ahead; retire it when its end is more than 24 hours past. Ends come from `eventSortEndAt` and starts from `eventSortAt` in `convex/_eventSchedule.ts`, so date-only events work.
- The runner emits `event_sync_job` analytics and owns the five-consecutive-failures email alarm; the kind emits nothing and adds no other unattended path (the cron only enqueues runner jobs).
- Discord base URL and token come from plan 03's `discordRequest`; absolute event URLs use `SITE_URL`.
- Backend tests run one file at a time with `node --conditions=import --import tsx --test FILE` (`pnpm test:backend` runs the whole suite). Each commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; commit by pathspec.

## Review Focus

1. A staffer edits an event that ended days ago (fixing a credit): the board must not re-post it; any live message is removed. Pinned in Task 2, `retired events are never posted and lose a live message`.
2. Someone deletes the board channel: POST answers 404, and the connector must pause with `discord_channel_missing`, not retry five times and alarm. Pinned in Task 2, `pauses when the channel is gone`.
3. The community goes private, which writes no event and so enqueues no delete: the next upsert must remove the message instead of editing it. Pinned in Task 2, `removes the message when the event stops being public`.
4. A title or lineup name containing `@everyone`: must not ping the channel. Pinned in Task 2, `posts a new message when the event has no link` (asserts `allowed_mentions`).
5. A connector row whose `channelId` is not a snowflake (bad write, manual patch): no request may be built from it. Pinned in Task 2, `makes no request for a non-snowflake channel`.

---

## Files

| File | Responsibility |
| --- | --- |
| `convex/_eventDiscordExport.ts` | Gains exported `formatDiscordLineupLines` and `cleanPublicText`, reused by the embed |
| `convex/eventSyncKinds/discordBoard.ts` | Embed render, handler, refresh planner, cron entry, channel picker, flag query |
| `convex/eventSyncKinds/index.ts` | Registers `discord_board` |
| `convex/crons.ts` | Daily board refresh |
| `apps/web/src/app/account/communities/[slug]/discord-board-connect.tsx` | Connect form for the board |
| `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx` | Mounts the form, kind label |
| `docs/backend/event-schema.md`, `docs/deployment/convex-environments.md` | Board behaviour, flag |
| `tests/backend/event-discord-board-embed.test.ts`, `tests/backend/event-discord-board.test.ts` | Tests |

---

### Task 1: Embed renderer

**Files:**

- Modify: `convex/_eventDiscordExport.ts` (extract the lineup block of `formatDiscordEventPost`)
- Create: `convex/eventSyncKinds/discordBoard.ts` (types and renderer only in this task)
- Test: `tests/backend/event-discord-board-embed.test.ts`; regression `tests/backend/event-discord-export.test.ts`

**Interfaces:**

- Consumes: `PublicEvent` from `convex/_eventPublic.ts`; `createDiscordTimestampSet` from `convex/_discordTimestamps.ts`.
- Produces:
  - `export function cleanPublicText(value: string): string` and `export function formatDiscordLineupLines(event: PublicEvent): string[]` in `convex/_eventDiscordExport.ts`, the existing lineup rows (lineup, else timed slots, else participants) unchanged.
  - In `convex/eventSyncKinds/discordBoard.ts`:

```ts
export type PublicEventProjection = PublicEvent & { url: string; artworkImageUrl?: string }; // url and artwork absolute https
export type DiscordEmbed = {
  title: string; url: string; description?: string;
  fields: Array<{ name: string; value: string }>;
  image?: { url: string };
};
export function renderEventEmbed(event: PublicEventProjection): DiscordEmbed;
```

Layout, in this order, empty parts omitted:

| Part | Content |
| --- | --- |
| `title` | `cleanPublicText(title)`, clipped to 256 |
| `url` | `event.url` |
| `description` | `**Cancelled**` then a blank line when cancelled; then `formatDiscordLineupLines` rows joined by newline; clipped to 4096 at a row boundary with a final `…` row |
| field `Time` | timed: `longDateTime (relative)` tokens of start |
| field `Date` | date-only instead of `Time`: `eventDate (Time TBA)` |
| field `End` | timed with `endAt`: `shortDateTime` token |
| field `Host` | `communityName` |
| field `World` or `Worlds` | world display names joined by comma and space; else field `Venue` with `venueLabel` |
| `image` | `artworkImageUrl` |

Clip helper: a string over its limit becomes its first `limit - 1` characters plus `…`. Field values clip to 1024. If title plus description plus every field name and value exceeds 6000, shrink the description (row boundary, final `…`) to fit; four fields can never reach 25.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { renderEventEmbed, type PublicEventProjection } from "../../convex/eventSyncKinds/discordBoard";

const START = Date.UTC(2026, 5, 14, 22, 0, 0); // 1781474400
const END = Date.UTC(2026, 5, 15, 1, 0, 0); // 1781485200
const world = (displayName: string) => ({ slug: displayName.toLowerCase().replace(/\W+/g, "-"), displayName, tags: [], association: { sourceType: "community" as const, confirmationState: "confirmed" as const } });

function projection(overrides: Partial<PublicEventProjection> = {}): PublicEventProjection {
  return {
    id: "event-id", slug: "7m2kp9q", title: "Afterglow Harbor Sessions",
    startAt: START, endAt: END, scheduleKind: "timed", eventDate: "2026-06-14", status: "scheduled",
    communityName: "Afterglow Social", communitySlug: "afterglow-social",
    source: { sourceType: "community", label: "Community listing" },
    worlds: [], participantCount: 0, slotCount: 0, nextSlots: [], watchMode: "event_stream", watchSurfaceEnabled: false,
    authoredMediaLinks: [], mediaLinks: [], participants: [], slots: [],
    lineup: [
      { key: "one", position: 0, displayLabel: "Aurora", roleLabel: "DJ", startAt: START, endAt: Date.UTC(2026, 5, 14, 22, 45, 0) },
      { key: "two", position: 1, displayLabel: "Closing guest" },
    ],
    url: "https://vrdex.net/afterglow-social/events/7m2kp9q",
    artworkImageUrl: "https://media.example.test/poster.png",
    ...overrides,
  } as PublicEventProjection;
}

it("renders the exact board layout", () => {
  assert.deepEqual(renderEventEmbed(projection({ worlds: [world("Harbor Club")] })), {
    title: "Afterglow Harbor Sessions",
    url: "https://vrdex.net/afterglow-social/events/7m2kp9q",
    description: "- <t:1781474400:t>-<t:1781477100:t> - Aurora - DJ\n- Closing guest",
    fields: [
      { name: "Time", value: "<t:1781474400:F> (<t:1781474400:R>)" },
      { name: "End", value: "<t:1781485200:f>" },
      { name: "Host", value: "Afterglow Social" },
      { name: "World", value: "Harbor Club" },
    ],
    image: { url: "https://media.example.test/poster.png" },
  });
});

it("names several worlds, falls back to the venue, and omits empty parts", () => {
  assert.deepEqual(renderEventEmbed(projection({ worlds: [world("Harbor Club"), world("Night Market")] })).fields.at(-1), { name: "Worlds", value: "Harbor Club, Night Market" });
  assert.deepEqual(renderEventEmbed(projection({ venueLabel: "The Lighthouse" })).fields.at(-1), { name: "Venue", value: "The Lighthouse" });
  const bare = renderEventEmbed(projection({ lineup: [], artworkImageUrl: undefined }));
  assert.equal(Object.hasOwn(bare, "description"), false);
  assert.equal(Object.hasOwn(bare, "image"), false);
});

it("renders a date-only event without timestamps", () => {
  const embed = renderEventEmbed(projection({ scheduleKind: "date_only", startAt: undefined, endAt: undefined }));
  assert.deepEqual(embed.fields.slice(0, 2), [{ name: "Date", value: "2026-06-14 (Time TBA)" }, { name: "Host", value: "Afterglow Social" }]);
  assert.equal(embed.description, "- Aurora - DJ\n- Closing guest");
});

it("keeps a Cancelled line above the lineup", () => {
  assert.ok(renderEventEmbed(projection({ status: "cancelled" })).description!.startsWith("**Cancelled**\n\n- <t:1781474400:t>"));
});

it("stays inside Discord's embed limits", () => {
  const embed = renderEventEmbed(projection({
    title: "a".repeat(300),
    communityName: "c".repeat(2000),
    worlds: Array.from({ length: 40 }, (_, i) => world(`World ${i} ${"w".repeat(40)}`)),
    lineup: Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, position: i, displayLabel: `Performer ${i} ${"p".repeat(30)}` })),
  }));
  assert.equal(embed.title.length, 256);
  assert.ok(embed.title.endsWith("…"));
  assert.ok(embed.description!.length <= 4096);
  assert.ok(embed.description!.endsWith("\n…"));
  assert.ok(embed.fields.length <= 25);
  for (const field of embed.fields) assert.ok(field.name.length <= 256 && field.value.length <= 1024);
  const total = embed.title.length + embed.description!.length + embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board-embed.test.ts`
Expected: FAIL, cannot find module `convex/eventSyncKinds/discordBoard`.

- [ ] **Step 3: Extract `formatDiscordLineupLines` and export `cleanPublicText` in `convex/_eventDiscordExport.ts`**

`formatDiscordEventPost` calls the extracted function; its output must not change.

- [ ] **Step 4: Implement `renderEventEmbed` in `convex/eventSyncKinds/discordBoard.ts`** per the layout table.

- [ ] **Step 5: Run both suites**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board-embed.test.ts tests/backend/event-discord-export.test.ts`
Expected: all pass, export suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add convex/_eventDiscordExport.ts convex/eventSyncKinds/discordBoard.ts tests/backend/event-discord-board-embed.test.ts
git commit -m "feat(events): render the Discord board embed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/_eventDiscordExport.ts convex/eventSyncKinds/discordBoard.ts tests/backend/event-discord-board-embed.test.ts
```

---

### Task 2: Board handler: upsert and delete

**Files:**

- Modify: `convex/eventSyncKinds/discordBoard.ts`, `convex/eventSyncKinds/index.ts`, `docs/deployment/convex-environments.md`
- Test: `tests/backend/event-discord-board.test.ts`

**Interfaces:**

- Consumes: `SyncKindHandler`, `syncKindHandlers`, `internal.eventSync.runJob` (plan 02); `discordRequest` (plan 03), always called as `discordRequest({ method, path, body })` so the token comes from `DISCORD_BOT_TOKEN`; `renderEventEmbed` (Task 1); `getPublicEventBySlug`, `getPublishedCommunity` from `convex/_eventPublic.ts`; `toPublicEventShareCard` from `convex/_eventShareCard.ts` for `artworkImageUrl` (poster, then banner, then thumbnail); `eventPathForSlugs` from `convex/_eventPaths.ts`; `eventSortAt`, `eventSortEndAt` from `convex/_eventSchedule.ts`.
- Produces, in `convex/eventSyncKinds/discordBoard.ts`:

```ts
export const BOARD_POST_AHEAD_MS = 14 * 24 * 3_600_000;
export const BOARD_RETIRE_AFTER_MS = 24 * 3_600_000;
export function boardEnabled(): boolean; // VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED === "true"
export function liveMessageId(link: Doc<"eventSyncLinks"> | null): string | null; // state linked and externalId is a snowflake
export const getBoardEvent = internalQuery({ args: { eventId: v.id("events") } });
// -> { projection: PublicEventProjection | null; status: "scheduled" | "cancelled"; sortAt: number; sortEndAt: number } | null
export const pauseBoardConnector = internalMutation({ args: { connectorId: v.id("eventConnectors"), lastError: v.string() } }); // state paused, lastError, updatedAt
export const discordBoardHandler: SyncKindHandler; // exportUpsert, exportDelete here; boardRefresh in Task 3
```

`getBoardEvent` builds `url` as `SITE_URL` (trailing slash trimmed) plus `eventPathForSlugs(communitySlug, slug)`, and resolves a relative artwork path (same-origin `/api/v0/events/...`) against `SITE_URL`; projection is `null` when `getPublicEventBySlug` returns `null`.

`exportUpsert(ctx, connector, event, link)` decision table. "Retired" is `sortEndAt + BOARD_RETIRE_AFTER_MS < now`; "postable" is `status === "scheduled"` and `sortAt <= now + BOARD_POST_AHEAD_MS`. When no message results, return `{ externalId: "none:" + event._id }`: unique per event, never a snowflake, so `liveMessageId` treats it as no message.

| Projection | Live message | Action | Returns |
| --- | --- | --- | --- |
| null, or retired | yes | DELETE it (404 counts as done) | `none:` id |
| null, or retired | no | nothing | `none:` id |
| public | yes | PATCH it; on 404, POST | message id |
| public, postable | no | POST | new message id |
| public, not postable | no | nothing | `none:` id |

`exportDelete(ctx, connector, link)`: DELETE the live message if any; 404 counts as done.

Every Discord response, one rule: 403 on any method, or 404 on POST, calls `pauseBoardConnector` with `discord_forbidden` or `discord_channel_missing` and throws; any other non-2xx throws `discord_` plus the status. Every method first throws `CONNECTOR_KIND_DISABLED` when `boardEnabled()` is false and `BOARD_TARGET_INVALID` when `target.channelId` fails the snowflake regex, before any request.

- [ ] **Step 1: Write the test harness and failing tests**

```ts
import assert from "node:assert/strict";
import { afterEach, beforeEach, it, type TestContext } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
  "../../convex/eventSyncKinds/discordBoard.ts": () => import("../../convex/eventSyncKinds/discordBoard"),
};
const MINUTE = 60_000; const HOUR = 60 * MINUTE; const DAY = 24 * HOUR;
const GUILD = "876543210987654321"; const CHANNEL = "123456789012345678"; const LIVE = "111111111111111111";
const ENV = { VRDEX_EVENT_CONNECTORS_ENABLED: "true", VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED: "true", DISCORD_BOT_TOKEN: "test-bot-token", SITE_URL: "https://vrdex.test" };
beforeEach((test) => { test.mock.timers.enable({ apis: ["setTimeout"] }); Object.assign(process.env, ENV); });
afterEach(() => { for (const key of Object.keys(ENV)) delete process.env[key]; });

type Call = { method: string; path: string; body?: { embeds: Array<{ title: string; description?: string }>; allowed_mentions: unknown } };
function fakeDiscord(test: TestContext, respond: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  test.mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? "GET", path: new URL(String(input)).pathname.replace("/api/v10", ""), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    return respond(call) ?? (call.method === "DELETE" ? new Response(null, { status: 204 })
      : Response.json({ id: call.method === "POST" ? `9000000000000000${String(calls.length).padStart(2, "0")}` : call.path.split("/").at(-1) }));
  });
  return calls;
}
const said = (calls: Call[]) => calls.map((call) => `${call.method} ${call.path}`);

const communityBase = { slug: "afterglow-social", displayName: "Afterglow Social", sortName: "afterglow social", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
const eventBase = (now: number) => ({ title: "Afterglow Harbor Sessions", sortTitle: "afterglow harbor sessions", startAt: now + 2 * DAY, endAt: now + 2 * DAY + 3 * HOUR, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } as const);
type Seed = Partial<Doc<"events">> & { link?: string };

async function seed(t: ReturnType<typeof convexTest>, events: Seed[], connector: Partial<Doc<"eventConnectors">> = {}) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: "staff" });
    const communityProfileId = await ctx.db.insert("profiles", communityBase);
    const connectorId = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "discord_board", direction: "export", mode: "hold", authorityUserId: userId, target: { guildId: GUILD, channelId: CHANNEL }, state: "active", createdAt: now, updatedAt: now, ...connector });
    const eventIds: Id<"events">[] = [];
    for (const [index, { link, ...event }] of events.entries()) {
      const eventId = await ctx.db.insert("events", { ...eventBase(now), slug: `night-${index}`, communityProfileId, ...event });
      if (link) await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: link, state: "linked", createdAt: now, updatedAt: now });
      eventIds.push(eventId);
    }
    return { now, userId, communityProfileId, connectorId, eventIds };
  });
}
async function runJob(t: ReturnType<typeof convexTest>, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: Doc<"eventSyncJobs">["kind"] }) {
  const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", { ...job, payload: null, dueAt: 0, attempts: 0, state: "pending", createdAt: 0, updatedAt: 0 }));
  await t.action(internal.eventSync.runJob, { jobId });
  return t.run((ctx) => ctx.db.get(jobId));
}
async function drain(t: ReturnType<typeof convexTest>) {
  const pending = await t.run((ctx) => ctx.db.query("eventSyncJobs").withIndex("by_state_dueAt", (q) => q.eq("state", "pending")).collect());
  for (const job of pending) await t.action(internal.eventSync.runJob, { jobId: job._id });
}
const linkFor = (t: ReturnType<typeof convexTest>, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  t.run(async (ctx) => (await ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()).find((link) => link.connectorId === connectorId) ?? null);
const upsert = (t: ReturnType<typeof convexTest>, s: { connectorId: Id<"eventConnectors">; eventIds: Id<"events">[] }, index = 0) =>
  runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[index], kind: "export_upsert" });

it("posts a new message when the event has no link", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ title: "@everyone Harbor Night" }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`POST /channels/${CHANNEL}/messages`]);
  assert.equal(calls[0].body?.embeds[0].title, "@everyone Harbor Night");
  assert.deepEqual(calls[0].body?.allowed_mentions, { parse: [] });
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000001");
});

it("edits the linked message in place", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, LIVE);
});

it("re-posts when the linked message is gone", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "PATCH" ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`, `POST /channels/${CHANNEL}/messages`]);
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[0]))?.externalId, "900000000000000002");
});

for (const [name, status, method, lastError] of [
  ["pauses the connector when Discord refuses the write", 403, "POST", "discord_forbidden"],
  ["pauses when the channel is gone", 404, "POST", "discord_channel_missing"],
] as const) {
  it(name, async (test) => {
    fakeDiscord(test, (call) => (call.method === method ? new Response(null, { status }) : undefined));
    const t = convexTest({ schema, modules });
    const s = await seed(t, [{}]);
    assert.notEqual((await upsert(t, s))?.state, "done");
    const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
    assert.equal(connector?.state, "paused");
    assert.match(connector?.lastError ?? "", new RegExp(lastError));
  });
}

it("deletes the message on export_delete and treats a missing message as deleted", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path.endsWith("222222222222222222") ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }, { link: "222222222222222222" }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[0], kind: "export_delete" }))?.state, "done");
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[1], kind: "export_delete" }))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`, `DELETE /channels/${CHANNEL}/messages/222222222222222222`]);
});

it("retired events are never posted and lose a live message", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ended = { startAt: now - 2 * DAY, endAt: now - DAY - MINUTE };
  const s = await seed(t, [ended, { ...ended, link: LIVE }]);
  assert.equal((await upsert(t, s, 0))?.state, "done");
  assert.equal((await upsert(t, s, 1))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`]);
});

it("waits to post an event more than 14 days out", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const s = await seed(t, [{ startAt: now + 14 * DAY + MINUTE, endAt: now + 14 * DAY + 3 * HOUR }]);
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(calls, []);
});

it("does not post a cancelled event but keeps a live one with the Cancelled line", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled" }, { eventStatus: "cancelled", link: LIVE }]);
  await upsert(t, s, 0);
  await upsert(t, s, 1);
  assert.deepEqual(said(calls), [`PATCH /channels/${CHANNEL}/messages/${LIVE}`]);
  assert.ok(calls[0].body?.embeds[0].description?.startsWith("**Cancelled**"));
});

it("removes the message when the event stops being public", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await t.run((ctx) => ctx.db.patch(s.communityProfileId, { publicSurfacingState: "suppressed" }));
  await upsert(t, s);
  assert.deepEqual(said(calls), [`DELETE /channels/${CHANNEL}/messages/${LIVE}`]);
});

it("makes no request when the flag is off", async (test) => {
  const calls = fakeDiscord(test);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  const t = convexTest({ schema, modules });
  const job = await upsert(t, await seed(t, [{}]));
  assert.deepEqual(calls, []);
  assert.match(job?.lastError ?? "", /CONNECTOR_KIND_DISABLED/);
});

it("makes no request for a non-snowflake channel", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const job = await upsert(t, await seed(t, [{}], { target: { guildId: GUILD, channelId: "../../guilds/1" } }));
  assert.deepEqual(calls, []);
  assert.match(job?.lastError ?? "", /BOARD_TARGET_INVALID/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts`
Expected: FAIL, the runner finds no `discord_board` handler.

- [ ] **Step 3: Implement `getBoardEvent`, `pauseBoardConnector`, `boardEnabled`, `liveMessageId`, and `exportUpsert` and `exportDelete` on `discordBoardHandler`** per the table above; register `discord_board: discordBoardHandler` in `convex/eventSyncKinds/index.ts`.

- [ ] **Step 4: Regenerate Convex types**

Run: `pnpm verify:backend:local` (restore `convex/README.md` and `convex/tsconfig.json` if the CLI rewrites them), then `pnpm typecheck:backend`.
Expected: `convex/_generated` includes `eventSyncKinds/discordBoard`; typecheck clean.

- [ ] **Step 5: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts`
Expected: 12 passing.

- [ ] **Step 6: Document the flag** in `docs/deployment/convex-environments.md`, next to plan 02's `VRDEX_EVENT_CONNECTORS_ENABLED` entry:

```markdown
- `VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED`: `true` enables Discord board jobs, the daily board refresh, and the board Connect button. Default off. Also needs `DISCORD_BOT_TOKEN` and `SITE_URL`. Owner: deployment operator. No secret; recreate or roll back by setting it to `false`.
```

- [ ] **Step 7: Commit**

```bash
git add convex/eventSyncKinds convex/_generated docs/deployment/convex-environments.md tests/backend/event-discord-board.test.ts
git commit -m "feat(connectors): add discord_board upsert and delete" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds convex/_generated docs/deployment/convex-environments.md tests/backend/event-discord-board.test.ts
```

---

### Task 3: Daily board refresh

**Files:**

- Modify: `convex/eventSyncKinds/discordBoard.ts`, `convex/crons.ts`, `docs/backend/event-schema.md`
- Test: `tests/backend/event-discord-board.test.ts`

**Interfaces:**

- Consumes: `enqueueSyncJob` (plan 02); indexes `eventConnectors.by_kind_target_channelId`, `eventSyncLinks.by_connectorId_externalId`, `eventSyncLinks.by_eventId`, `eventSyncJobs.by_connectorId_eventId_state`; `dateOnlyEventsEnabled` from `convex/_eventSchedule.ts`; Task 2's `liveMessageId`, `BOARD_POST_AHEAD_MS`, `BOARD_RETIRE_AFTER_MS`.
- Produces:

```ts
export const planBoardRefresh = internalMutation({ args: { connectorId: v.id("eventConnectors") } }); // -> { upserts: number; deletes: number }
export const enqueueBoardRefreshes = internalMutation({ args: {} }); // -> number of jobs enqueued
// discordBoardHandler.boardRefresh(ctx, connector) runs planBoardRefresh
```

`planBoardRefresh`, no Discord calls of its own:

- Retire: every link of the connector with a live message whose event is retired gets an `export_delete` job.
- Backfill: published, scheduled community events from 7 days back to 14 days ahead, using the same index switch as `getPublicCommunityHostedEvents` (`dateOnlyEventsEnabled()` picks the `sortAt` index, else `startAt`), that are not retired and have no live message, get an `export_upsert` job.
- A link whose `externalId` is a `none:` value (Task 2) counts as "no message": `liveMessageId` returns `null` for it, so the refresh never deletes it and backfills its event once the event enters the window.
- Skip any event that already has a pending job for this connector. Cancelled events are never backfilled; their live messages stay until retirement.
- `ponytail:` the 7-day lookback misses an event that started more than 7 days ago and is still running; widen it if multi-week events appear.

`enqueueBoardRefreshes`: returns 0 when `boardEnabled()` is false; otherwise one `board_refresh` job per `discord_board` connector with `state: "active"` and `direction: "export"`, skipped when one is already pending (`eventId` undefined).

- [ ] **Step 1: Write the failing tests** (append to `tests/backend/event-discord-board.test.ts`)

```ts
it("refresh posts inside 14 days, retires after 24 hours, and keeps cancelled embeds", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const s = await seed(t, [
    { startAt: now + 14 * DAY - MINUTE, endAt: now + 14 * DAY + HOUR }, // posted
    { startAt: now + 14 * DAY + MINUTE, endAt: now + 14 * DAY + 2 * HOUR }, // too far
    { startAt: now - 2 * DAY, endAt: now - DAY + MINUTE, link: "333333333333333333" }, // kept
    { startAt: now - 2 * DAY, endAt: now - DAY - MINUTE, link: "444444444444444444" }, // retired
    { startAt: now + 2 * DAY, eventStatus: "cancelled" }, // not posted
    { startAt: now + 3 * DAY, eventStatus: "cancelled", link: "555555555555555555" }, // kept
  ]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, kind: "board_refresh" }))?.state, "done");
  await drain(t);
  assert.deepEqual(said(calls).sort(), [`DELETE /channels/${CHANNEL}/messages/444444444444444444`, `POST /channels/${CHANNEL}/messages`].sort());
  assert.equal((await linkFor(t, s.connectorId, s.eventIds[3]))?.state, "vrdex_retracted");
});

it("refresh is idempotent", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}, {}]);
  await t.mutation(internal.eventSyncKinds.discordBoard.planBoardRefresh, { connectorId: s.connectorId });
  assert.deepEqual(await t.mutation(internal.eventSyncKinds.discordBoard.planBoardRefresh, { connectorId: s.connectorId }), { upserts: 0, deletes: 0 });
  await drain(t);
  assert.equal(calls.length, 2);
  await runJob(t, { connectorId: s.connectorId, kind: "board_refresh" });
  await drain(t);
  assert.equal(calls.length, 2);
});

it("the daily cron enqueues one refresh per active export board", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const base = await ctx.db.get(s.connectorId);
    const { _id, _creationTime, ...row } = base!;
    await ctx.db.insert("eventConnectors", { ...row, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...row, state: "removed" });
    await ctx.db.insert("eventConnectors", { ...row, kind: "google_calendar", target: { calendarId: "c" } });
  });
  const pendingRefreshes = () => t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).filter((job) => job.kind === "board_refresh" && job.state === "pending").map((job) => job.connectorId));
  assert.equal(await t.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 1);
  assert.equal(await t.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 0);
  assert.deepEqual(await pendingRefreshes(), [s.connectorId]);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  const off = convexTest({ schema, modules });
  await seed(off, []);
  assert.equal(await off.mutation(internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {}), 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts`
Expected: the three new tests FAIL (`planBoardRefresh` not a function).

- [ ] **Step 3: Implement `planBoardRefresh`, `enqueueBoardRefreshes`, and `boardRefresh` on the handler** as described.

- [ ] **Step 4: Add the cron in `convex/crons.ts`**

```ts
crons.daily("refresh discord event boards", { hourUTC: 6, minuteUTC: 15 }, internal.eventSyncKinds.discordBoard.enqueueBoardRefreshes, {});
```

- [ ] **Step 5: Regenerate types and run**

Run: `pnpm verify:backend:local`, `pnpm typecheck:backend`, then `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts`
Expected: 15 passing.

- [ ] **Step 6: Document the kind** in plan 02's Connectors section of `docs/backend/event-schema.md`: a `discord_board` paragraph stating it is export only to a bot-owned channel; the embed layout (title linking to the event, lineup in the description, Time or Date, End, Host, World or Venue fields, poster artwork image, Cancelled line); the 14-day post and 24-hour retirement window; the 06:15 UTC refresh; `none:` link IDs meaning no message; pause codes `discord_forbidden` and `discord_channel_missing`; that the bot needs Send Messages, Embed Links, and Manage Messages in the channel (granted through plan 03's `DISCORD_BOT_PERMISSIONS`); and the flag.

- [ ] **Step 7: Lint docs and commit**

Run: `pnpm exec markdownlint-cli2 docs/backend/event-schema.md docs/deployment/convex-environments.md`
Expected: no errors.

```bash
git add convex/eventSyncKinds/discordBoard.ts convex/crons.ts convex/_generated docs/backend/event-schema.md tests/backend/event-discord-board.test.ts
git commit -m "feat(connectors): refresh discord boards daily" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/discordBoard.ts convex/crons.ts convex/_generated docs/backend/event-schema.md tests/backend/event-discord-board.test.ts
```

---

### Task 4: Integrations Connect for the board

The channel-listing action is the only conditional part: if plan 03 has landed an action that lists a guild's channels for a staffer, wire the picker to it and drop `authorizeBoardTarget`, `listBoardChannels`, and their two tests. The `isEnabled` query, its test, `DiscordBoardConnect`, the page wiring, and the visual verification always ship.

**Files:**

- Modify: `convex/eventSyncKinds/discordBoard.ts`, `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx`
- Create: `apps/web/src/app/account/communities/[slug]/discord-board-connect.tsx`
- Test: `tests/backend/event-discord-board.test.ts`

**Interfaces:**

- Consumes: `requireConnectorAuthority` (plan 02); plan 02's `target.channelName` display field and its export-only enforcement for `discord_board` in `api.eventConnectors.create` and `api.eventConnectors.update`; `requireControlProof` and `MINIMUM_COMMUNITY_CONTROL_LEVEL` from `convex/_externalControl.ts`; `api.discordVerification.getManageableGuilds`; `api.eventConnectors.create` (plan 02); `Button` from `@/components/ui/button`, `Field` and `Select` from `@/components/ui/field`.
- Produces:

```ts
export const isEnabled = query({ args: {} }); // -> boolean, boardEnabled()
export const authorizeBoardTarget = internalQuery({ args: { communityProfileId: v.id("profiles"), guildId: v.string() } });
// session user (resolved as plan 02's convex/eventConnectors.ts does) passes requireConnectorAuthority and
// requireControlProof(db, userId, "discord_guild", guildId, MINIMUM_COMMUNITY_CONTROL_LEVEL); guildId must be a snowflake
export const listBoardChannels = action({ args: { communityProfileId: v.id("profiles"), guildId: v.string() } });
// -> Array<{ id: string; name: string }>: GET /guilds/{guildId}/channels, types 0 (text) and 5 (announcement), by position
```

```tsx
export function DiscordBoardConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }): JSX.Element | null;
```

Renders nothing when `isEnabled` is false. Otherwise a button `Event board` opens a form: `Server` select from `getManageableGuilds`, `Channel` select from `listBoardChannels` once a server is chosen, and `Connect`, which calls `api.eventConnectors.create` with `{ communityProfileId, kind: "discord_board", direction: "export", mode: "hold", target: { guildId, channelId, channelName } }`, `channelName` taken from the chosen `listBoardChannels` row. Direction is export (plan 02 refuses any other for this kind; mode is ignored for export kinds). Mount it beside the page's other Connect buttons, add `discord_board: "Event board"` to the page's kind label map if plan 02 did not, and show `target.channelName` as the target name on board rows.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const staff = { subject: "staff", issuer: "https://test.clerk.accounts.dev", tokenIdentifier: "https://test.clerk.accounts.dev|staff" };
async function staffer(t: ReturnType<typeof convexTest>, proved: boolean) {
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    await ctx.db.insert("communityAuthorities", { communityProfileId: s.communityProfileId, subject: staff, subjectTokenIdentifier: staff.tokenIdentifier, capabilities: ["manage_integrations"], state: "active", grantedAt: s.now, updatedAt: s.now });
    if (proved) await ctx.db.insert("externalControlProofs", { userId: s.userId, assetType: "discord_guild", assetExternalId: GUILD, controlLevel: "manager", state: "active", evidenceSource: "discord_oauth", verifiedAt: s.now, revalidateAfter: s.now + DAY, createdAt: s.now, updatedAt: s.now });
  });
  return { s, as: t.withIdentity({ ...staff, email: "staff@example.test", emailVerified: true }) };
}

it("lists only text and announcement channels of a proved guild", async (test) => {
  const calls = fakeDiscord(test, (call) => call.path === `/guilds/${GUILD}/channels` ? Response.json([
    { id: "200000000000000001", name: "general", type: 0, position: 2 },
    { id: "200000000000000002", name: "Voice", type: 2, position: 0 },
    { id: "200000000000000003", name: "Events", type: 4, position: 1 },
    { id: "200000000000000004", name: "announcements", type: 5, position: 1 },
  ]) : undefined);
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, true);
  assert.deepEqual(await as.action(api.eventSyncKinds.discordBoard.listBoardChannels, { communityProfileId: s.communityProfileId, guildId: GUILD }), [
    { id: "200000000000000004", name: "announcements" },
    { id: "200000000000000001", name: "general" },
  ]);
  assert.deepEqual(said(calls), [`GET /guilds/${GUILD}/channels`]);
});

it("refuses to list channels of a guild the staffer has not proved", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, false);
  await assert.rejects(as.action(api.eventSyncKinds.discordBoard.listBoardChannels, { communityProfileId: s.communityProfileId, guildId: GUILD }));
  assert.deepEqual(calls, []);
});

it("reports whether the board is enabled", async () => {
  const t = convexTest({ schema, modules });
  assert.equal(await t.query(api.eventSyncKinds.discordBoard.isEnabled, {}), true);
  delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED;
  assert.equal(await t.query(api.eventSyncKinds.discordBoard.isEnabled, {}), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement `isEnabled`, `authorizeBoardTarget`, `listBoardChannels`**; regenerate with `pnpm verify:backend:local` and run `pnpm typecheck:backend`.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-board.test.ts tests/backend/event-discord-board-embed.test.ts`
Expected: all pass (18 and 5).

- [ ] **Step 5: Build `DiscordBoardConnect` and mount it** on the Integrations page.

Run: `pnpm --filter web lint` and `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 6: Visual verification**

Start the local backend and web app, sign in as a seeded staffer with a proved guild, open the community's Integrations page, and screenshot the closed button and the open form at desktop width and at 375 px. Hand the screenshots and the AGENTS.md UI rules to a Sonnet reviewer. Expected: no horizontal overflow, subtle radii, labels only, no explanatory prose; fix and re-shoot until the reviewer passes it.

- [ ] **Step 7: Commit**

```bash
git add convex/eventSyncKinds/discordBoard.ts convex/_generated ":(literal)apps/web/src/app/account/communities/[slug]/discord-board-connect.tsx" ":(literal)apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx" tests/backend/event-discord-board.test.ts
git commit -m "feat(integrations): connect a Discord event board" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/discordBoard.ts convex/_generated ":(literal)apps/web/src/app/account/communities/[slug]/discord-board-connect.tsx" ":(literal)apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx" tests/backend/event-discord-board.test.ts
```

---

## Finish

- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-discord-board-embed.test.ts tests/backend/event-discord-board.test.ts tests/backend/event-discord-export.test.ts`; expected all pass.
- [ ] Push and open a PR to `main`. The description lists every public string from Global Constraints, cites the spec copy table, marks `Event board` and `Cancelled` as awaiting BASIC's approval of the exact wording, states whether this PR created `listBoardChannels` or reused plan 03's channel listing, and attaches the Task 4 screenshots. Do not merge.
