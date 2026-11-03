# Discord Scheduled Events (Event Platform 07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `discord_scheduled_events` connector kind: VRDex events export to a Discord server's scheduled events, the gateway relays scheduled event changes back as `import_item` jobs, and both directions respect the echo guard, newer-wins, and flag-not-cancel rules.

**Architecture:** The gateway forwards raw `GUILD_SCHEDULED_EVENT_*` dispatch packets through plan 03's relay; Convex's relay route turns them into `import_item` jobs per matching connector. A pure mapping module (`convex/_discordScheduledEventMap.ts`) owns the VRDex to Discord field map, its inverse, the candidate builder, and recurrence expansion, so export, echo hash, import, and reconcile all read and write the same shape. The kind module (`convex/eventSyncKinds/discordScheduledEvents.ts`) is the `SyncKindHandler` plus the relay mutation, the daily reconcile enqueuer, and the Connect actions.

**Tech Stack:** Convex (internal queries and mutations, actions, HTTP actions, crons), Discord REST v10, discord.js 14.26 raw gateway events, Next.js client component, `node:test` with `convex-test` and `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (The model, Connecting, Directions and field ownership with Cancellation and Recurring items, Discord scheduled events, Settings page). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Master plan Global Constraints apply in full (no em-dash or `--` in public strings, no AI mention, Discord IDs match `/^\d{17,20}$/`, markdownlint, no bare angle-bracket placeholders in `docs/`, commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`).
- Depends on plan 02 (`eventConnectors`, `eventSyncLinks`, `eventSyncJobs`, `enqueueSyncJob`, `internal.eventSync.runJob`, `SyncKindHandler`, `syncKindHandlers`, `applyEventCandidate`, `carriedFieldsHash`, `requireConnectorAuthority`, `api.eventConnectors.create`, the Integrations page) and plan 03 (gateway `relay`, connector lookup cache, `GuildScheduledEvents` intent, `POST /discord-intake/relay`, `GET /discord-intake/connectors`, `convex/_discordRest.ts` `discordRequest` and `DISCORD_BOT_PERMISSIONS`, which already include Manage Events and Create Events, so this plan does not touch the invite URL), and on `candidateFromConnectorFields(kind: ConnectorKind, fields: Partial<EventIntakeFields>, decision: EventIntakeDecision): EventIntakeCandidate` in `convex/_eventCandidateApply.ts` (created by plan 08; if this plan executes first, Task 2 creates it with that exact signature and the PR says so). Names are copied from the master plan and not changed here: `discordRequest(request: { method: string; path: string; body?: unknown; token?: string }): Promise<Response>`, and `applyEventCandidate` performs the echo guard (`skipped_echo`) and the bidirectional staleness check (`skipped_stale`) itself, so this plan never re-implements either.
- Start from `origin/main` in a fresh worktree. End in a PR to `main`; never merge.
- Flag `VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED` (Convex), default off, enabled only by `=== "true"`. It gates the handler (throws `CONNECTOR_KIND_DISABLED` before any request), the relay route (no jobs), the daily reconcile cron, and the Connect button. Plan 02's `VRDEX_EVENT_CONNECTORS_ENABLED` still gates the runner.
- Export shape, from the master contract: `entity_type: 3`, `privacy_level: 2`, `channel_id: null`, `entity_metadata.location` = world names, else venue label, else the absolute event URL; `scheduled_end_time` = end, else start plus 4 hours; `description` = summary, blank line, event URL as the last line; `image` = artwork as a data URI. Discord limits: name 100, location 100, description 1000 characters; a clipped string ends in `…`, and the description clips the summary, never the URL line.
- Cancellation: a cancelled VRDex event PATCHes `status: 4`. Unpublish, contributor retraction, and moderation removal (`export_delete`) DELETE the Discord event. Inbound `status: 4` or a delete marks the link `external_deleted` (the staff flag plan 04 surfaces); VRDex never cancels or retracts because of it.
- Discord scheduled events carry no updated timestamp. The relay receipt time (`Date.now()` in the HTTP action) is the item's `externalUpdatedAt`.
- Recurring Discord events expand into one link per occurrence starting within 60 days, `externalId` = `{scheduledEventId}:{YYYY-MM-DD}` (UTC date of the occurrence), `externalSeriesId` = the scheduled event ID. Exports never create series.
- Reconcile window: today through 90 days ahead. Past Discord items are never imported.
- Artwork: fetched from the public artwork URL; only `image/png`, `image/jpeg`, `image/gif`; at most `8 * 1024 * 1024` bytes; any failure exports without an image.
- A Discord 403 on any call pauses the connector (`state: "paused"`, `lastError: "discord_forbidden"`) and throws; other non-2xx responses throw `discord_` plus the status, except the 404s the tables below name.
- Base URL `DISCORD_API_BASE_URL` else `https://discord.com/api/v10`; token `DISCORD_BOT_TOKEN`; absolute event URLs from `SITE_URL` plus `eventPathForSlugs` (`convex/_eventPaths.ts`).
- Public strings this plan ships, listed in the PR for BASIC's approval: `Discord events` (spec kind label), `Import`, `Export`, `Both`, `Off` (spec direction options), and utility labels `Server`, `Direction`, `Connect`.
- Backend tests: `node --conditions=import --import tsx --test FILE` (the `pnpm test:backend` wrapper refuses non-main worktrees). Gateway tests: `node --import tsx --test src/FILE` from `apps/discord-gateway`. Commit by pathspec.

## Review Focus

1. The bot's own create comes back through the gateway before the runner has written the link, and is imported as a second event. Pinned in Task 1, `drops creates authored by the bot`.
2. A staffer cancels on Discord: VRDex must flag, not cancel; VRDex's own cancel coming back must not flag. Pinned in Task 5, `a Discord cancel flags the event and never cancels it` and `its own cancel coming back is not a deletion`.
3. An event cancelled in VRDex and later restored: Discord's canceled state is terminal, so the export must create a new Discord event. Pinned in Task 4, `re-creates a Discord event that ended or was cancelled there`.
4. A title-only edit on Discord must not write the world-name location, the four-hour end, or a clipped title into VRDex. Pinned in Task 2, `a title-only Discord edit keeps VRDex's own venue, end, and full title`.
5. A staffer connects a server they do not manage, just because the bot is in it. Pinned in Task 7, `refuses to connect a server the staffer has not proved`.

---

## Files

| File | Responsibility |
| --- | --- |
| `apps/discord-gateway/src/scheduledEvents.ts` | Filter and relay raw scheduled event packets |
| `apps/discord-gateway/src/index.ts` | Wire the `raw` listener |
| `convex/_discordScheduledEventMap.ts` | Pure: types, flag, export body, inverse map, candidate, occurrences |
| `convex/eventSyncKinds/discordScheduledEvents.ts` | Handler, relay mutation, import mutation, reconcile, cron enqueuer, Connect action |
| `convex/eventSyncKinds/index.ts` | Registers the kind |
| `convex/schema.ts` | Index `eventConnectors.by_kind_target_guildId` |
| `convex/http.ts` | Relay branch |
| `convex/eventConnectors.ts` | Control proof on create for this kind |
| `convex/crons.ts` | Daily reconcile |
| `apps/web/src/app/account/communities/[slug]/discord-scheduled-events-connect.tsx` | Connect form |
| `docs/backend/event-schema.md`, `docs/deployment/convex-environments.md`, `docs/deployment/discord-gateway.md` | Docs |
| `apps/discord-gateway/src/scheduledEvents.test.ts`, `tests/backend/discord-scheduled-event-map.test.ts`, `tests/backend/event-discord-scheduled-events.test.ts` | Tests |

---

### Task 1: Gateway relay of scheduled event packets

**Files:**

- Create: `apps/discord-gateway/src/scheduledEvents.ts`
- Modify: `apps/discord-gateway/src/index.ts`, `docs/deployment/discord-gateway.md`
- Test: `apps/discord-gateway/src/scheduledEvents.test.ts`

**Interfaces:**

- Consumes: plan 03's `relay(kind, action, guildId, channelId, payload): Promise<void>` from `src/relay.ts`; `get(query: { guildId: string; channelId?: string }): Promise<ConnectorSummary[]>` from `src/connectorCache.ts`, `ConnectorSummary = { connectorId, kind, direction, mode, state, guildId, channelId? }`.
- Produces:

```ts
export type ScheduledEventRelayDeps = {
  botUserId: string | null;
  getConnectors(query: { guildId: string }): Promise<ConnectorSummary[]>; // plan 03's connectorCache.get
  relay(kind: "scheduled_event", action: "create" | "update" | "delete", guildId: string, channelId: undefined, payload: unknown): Promise<void>;
};
export function relayScheduledEventPacket(packet: { t?: string | null; d?: unknown }, deps: ScheduledEventRelayDeps): Promise<boolean>; // true when relayed
```

Decision: listen on `Events.Raw` and filter `t` to `GUILD_SCHEDULED_EVENT_CREATE`, `_UPDATE`, `_DELETE`, not on discord.js's `guildScheduledEvent*` events. Those hand over class instances whose `toJSON()` is camelCase and whose delete may be partial; the raw dispatch `d` is Discord's `APIGuildScheduledEvent` exactly as received, which is what the master contract relays. Drop a `CREATE` whose `d.creator_id === botUserId`: it is our own export, and the export writes the link. Relay only when `getConnectors({ guildId })` returns a row with `kind === "discord_scheduled_events"`, `state === "active"`, and direction `import` or `bidirectional`.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { relayScheduledEventPacket, type ScheduledEventRelayDeps } from "./scheduledEvents";

const GUILD = "876543210987654321";
const BOT = "444444444444444444";
const event = (creator = "333333333333333333") => ({ id: "111111111111111111", guild_id: GUILD, creator_id: creator, name: "Afterglow Harbor Sessions", status: 1, entity_type: 3 });
const summary = (overrides = {}) => ({ connectorId: "c1", kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", state: "active", guildId: GUILD, ...overrides });
function deps(rows = [summary()]) {
  const sent: unknown[][] = [];
  const value: ScheduledEventRelayDeps = { botUserId: BOT, getConnectors: async ({ guildId }) => rows.filter((row) => row.guildId === guildId), relay: async (...args) => { sent.push(args); } };
  return { sent, value };
}

it("relays create, update, and delete with the raw payload", async () => {
  const { sent, value } = deps();
  for (const t of ["GUILD_SCHEDULED_EVENT_CREATE", "GUILD_SCHEDULED_EVENT_UPDATE", "GUILD_SCHEDULED_EVENT_DELETE"]) {
    assert.equal(await relayScheduledEventPacket({ t, d: event() }, value), true);
  }
  assert.deepEqual(sent.map((args) => args.slice(0, 4)), [
    ["scheduled_event", "create", GUILD, undefined],
    ["scheduled_event", "update", GUILD, undefined],
    ["scheduled_event", "delete", GUILD, undefined],
  ]);
  assert.deepEqual(sent[0][4], event());
});

it("ignores other packets, missing guilds, and guilds without an importing connector", async () => {
  const { sent, value } = deps();
  assert.equal(await relayScheduledEventPacket({ t: "MESSAGE_CREATE", d: event() }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: { ...event(), guild_id: undefined } }, value), false);
  const none = deps([summary({ direction: "export" }), summary({ state: "paused" }), summary({ kind: "discord_board", channelId: "123456789012345678" })]);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: event() }, none.value), false);
  assert.deepEqual([...sent, ...none.sent], []);
});

it("drops creates authored by the bot but relays its updates", async () => {
  const { sent, value } = deps();
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_CREATE", d: event(BOT) }, value), false);
  assert.equal(await relayScheduledEventPacket({ t: "GUILD_SCHEDULED_EVENT_UPDATE", d: event(BOT) }, value), true);
  assert.equal(sent.length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/discord-gateway && node --import tsx --test src/scheduledEvents.test.ts`
Expected: FAIL, cannot find module `./scheduledEvents`.

- [ ] **Step 3: Implement `relayScheduledEventPacket`** in `apps/discord-gateway/src/scheduledEvents.ts`.

- [ ] **Step 4: Wire it in `apps/discord-gateway/src/index.ts`**

`client.on(Events.Raw, (packet: GatewayDispatchPayload) => void relayScheduledEventPacket(packet, deps).catch(logRelayError))` with `botUserId` from `client.user?.id ?? null`, `relay` from plan 03, and `getConnectors` = plan 03's `connectorCache.get`. Add `GatewayIntentBits.GuildScheduledEvents` if plan 03 has not. Log errors as the existing `console.log(JSON.stringify({ event: ... }))` lines do.

- [ ] **Step 5: Run gateway tests and typecheck**

Run: `cd apps/discord-gateway && node --import tsx --test src/*.test.ts && npx tsc --noEmit --project tsconfig.json`
Expected: all pass, no type errors.

- [ ] **Step 6: Document** in `docs/deployment/discord-gateway.md`, in the relay section plan 03 wrote: the gateway relays `GUILD_SCHEDULED_EVENT_CREATE`, `UPDATE`, and `DELETE` for guilds with an active import or bidirectional `discord_scheduled_events` connector, drops creates authored by the bot, and still never writes to Discord.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(discord-gateway): relay scheduled event changes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- apps/discord-gateway/src/scheduledEvents.ts apps/discord-gateway/src/scheduledEvents.test.ts apps/discord-gateway/src/index.ts docs/deployment/discord-gateway.md
```

---

### Task 2: Field mapping, candidate, and occurrences

**Files:**

- Create: `convex/_discordScheduledEventMap.ts`
- Modify (only if plan 08 has not landed): `convex/_eventCandidateApply.ts`
- Test: `tests/backend/discord-scheduled-event-map.test.ts`

**Interfaces:**

- Consumes: `EventIntakeFields`, `EventIntakeCandidate`, `EventIntakeDecision` from `../packages/api-contracts/src/event-intake` (plan 01 adds `decision` and origin `connector`); `candidateFromConnectorFields` from `convex/_eventCandidateApply.ts` (plan 08).
- Produces:

```ts
export const SCHEDULED_EVENT_END_FALLBACK_MS = 4 * 3_600_000;
export const IMPORT_HORIZON_MS = 60 * 86_400_000;
export const RECONCILE_HORIZON_MS = 90 * 86_400_000;
export const DISCORD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export function discordScheduledEventsEnabled(): boolean; // VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED === "true"
export function isDiscordId(value: unknown): value is string; // /^\d{17,20}$/
export type DiscordRecurrenceRule = { start: string; end: string | null; frequency: 0 | 1 | 2 | 3; interval: number; by_weekday: number[] | null; by_n_weekday: Array<{ n: 1 | 2 | 3 | 4 | 5; day: number }> | null; by_month: number[] | null; by_month_day: number[] | null; by_year_day: number[] | null; count: number | null };
export type DiscordScheduledEvent = { id: string; guild_id: string; creator_id?: string | null; name: string; description?: string | null; scheduled_start_time: string; scheduled_end_time: string | null; privacy_level: number; status: 1 | 2 | 3 | 4; entity_type: 1 | 2 | 3; entity_metadata: { location?: string } | null; recurrence_rule: DiscordRecurrenceRule | null };
export type DiscordScheduledEventBody = { name: string; privacy_level: 2; entity_type: 3; channel_id: null; entity_metadata: { location: string }; scheduled_start_time: string; scheduled_end_time: string; description: string; image?: string };
export type ScheduledEventFieldsInput = Pick<DiscordScheduledEvent, "name" | "description" | "scheduled_start_time" | "scheduled_end_time" | "entity_metadata">;
export type ScheduledEventSource = { title: string; summary?: string; venueLabel?: string; worldNames: string[]; startAt?: number; endAt?: number; timezone?: string; status: "scheduled" | "cancelled"; url: string; artworkImageUrl?: string };
export function parseScheduledEvent(value: unknown): DiscordScheduledEvent | null; // trust boundary: snowflake id and guild_id, string name, parseable start
export function toScheduledEventBody(source: ScheduledEventSource & { startAt: number }, image?: string): DiscordScheduledEventBody;
export function scheduledEventToFields(item: ScheduledEventFieldsInput, linked: ScheduledEventSource | null): EventIntakeFields;
export function scheduledEventCandidateFields(fields: EventIntakeFields, linked: boolean): Partial<EventIntakeFields>; // input to candidateFromConnectorFields
export function scheduledEventOccurrences(item: DiscordScheduledEvent, now: number): Array<{ externalId: string; externalSeriesId?: string; startAt: number; endAt: number | null }>;
```

Decisions:

- `scheduledEventToFields` returns exactly the keys `title`, `eventDate`, `timezone`, `start`, `end`, `summary`, `venueLabel`, absent values as `null`, `end.dayOffset` only when nonzero, so the hash is stable. Times are read in `linked.timezone`, else `"UTC"`. Normalisation rule, the one that keeps lossy export fields from flowing back: when an inbound value equals what `toScheduledEventBody(linked)` writes for that field (clipped name, fallback location, start-plus-4-hours end, summary-plus-URL description), the field takes `linked`'s own value instead. A summary over 240 characters clips to 240.
- Because of that rule, an unchanged echo maps back to the linked event's own carried values, so the hash `applyEventCandidate` computes for the inbound candidate equals the runner's `lastExportedHash` (`carriedFieldsHash(kind, eventFields)`). Use the same representation as plan 02's event-to-fields mapping (absent as `null`, `dayOffset` only when nonzero); align with it if it differs.
- Candidates are built only by `candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(fields, linked), decision)`. That helper marks every given field explicit, so `scheduledEventCandidateFields` drops `null` values and, when `linked`, drops `timezone`: a patch must never move a linked event's zone, while a new event needs one.
- If `convex/_eventCandidateApply.ts` has no `candidateFromConnectorFields` yet (plan 08 not merged), add it there with the master signature: each given field goes to `candidate.event` (`start` and `end` as `HH:MM`, `startDate` and `endDate` from `eventDate` plus `dayOffset`) with evidence `{ fieldPath: "event." + key, origin: "connector", excerpt: null, assessment: "explicit" }`; empty `lineup` and `questions`; the given `decision`. Say so in the PR.
- `scheduledEventOccurrences`: a one-off item is one entry, `externalId` = its ID, no window filter. A recurring item steps from `recurrence_rule.start` at its UTC clock time (Discord weekdays: Monday 0): Daily, each day, filtered by `by_weekday` when set; Weekly, every `7 * interval` days; Monthly, the `by_n_weekday[0]` weekday of each month, skipping months without it; Yearly, `by_month[0]`/`by_month_day[0]` every `interval` years. `count` counts from the rule start, past occurrences included; stop after `end`. Keep occurrences with `now < startAt < now + IMPORT_HORIZON_MS`. Duration is `scheduled_end_time - scheduled_start_time`, `endAt` `null` without an end. `ponytail:` UTC stepping drifts an hour across DST for zones Discord shows locally; plan 11 replaces expansion with series import.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  scheduledEventCandidateFields, scheduledEventOccurrences, scheduledEventToFields, toScheduledEventBody,
  type DiscordScheduledEvent, type ScheduledEventSource,
} from "../../convex/_discordScheduledEventMap";
import { candidateFromConnectorFields } from "../../convex/_eventCandidateApply";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 6, 20, 0); // 15:00 in New York
const URL_LINE = "https://vrdex.test/afterglow-social/events/7m2kp9q";
const source = (overrides: Partial<ScheduledEventSource> = {}) => ({
  title: "Afterglow Harbor Sessions", summary: "Deep house by the water.", venueLabel: "The Lighthouse", worldNames: [],
  startAt: START, endAt: START + 3 * HOUR, timezone: "America/New_York", status: "scheduled" as const, url: URL_LINE, ...overrides,
}) as ScheduledEventSource & { startAt: number };
const inbound = (overrides = {}) => ({
  name: "Afterglow Harbor Sessions", description: `Deep house by the water.\n\n${URL_LINE}`,
  scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: "2026-11-06T23:00:00.000Z",
  entity_metadata: { location: "The Lighthouse" }, ...overrides,
});

it("maps the carried fields to an external scheduled event", () => {
  assert.deepEqual(toScheduledEventBody(source(), "data:image/png;base64,iVBORw=="), {
    name: "Afterglow Harbor Sessions", privacy_level: 2, entity_type: 3, channel_id: null,
    entity_metadata: { location: "The Lighthouse" },
    scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: "2026-11-06T23:00:00.000Z",
    description: `Deep house by the water.\n\n${URL_LINE}`, image: "data:image/png;base64,iVBORw==",
  });
});

it("ends four hours after the start when the event has no end", () => {
  assert.equal(toScheduledEventBody(source({ endAt: undefined })).scheduled_end_time, "2026-11-07T00:00:00.000Z");
});

it("locates the event at the world, else the venue, else the event page", () => {
  const location = (overrides: Partial<ScheduledEventSource>) => toScheduledEventBody(source(overrides)).entity_metadata.location;
  assert.equal(location({ worldNames: ["Harbor Club"] }), "Harbor Club");
  assert.equal(location({ worldNames: ["Harbor Club", "Night Market"] }), "Harbor Club, Night Market");
  assert.equal(location({}), "The Lighthouse");
  assert.equal(location({ venueLabel: undefined }), URL_LINE);
});

it("keeps the URL as the last description line and omits a missing image", () => {
  const body = toScheduledEventBody(source({ summary: undefined }));
  assert.equal(body.description, URL_LINE);
  assert.equal(Object.hasOwn(body, "image"), false);
});

it("clips to Discord's limits", () => {
  const body = toScheduledEventBody(source({ title: "a".repeat(300), summary: "s".repeat(2000), venueLabel: "v".repeat(300) }));
  assert.equal(body.name.length, 100);
  assert.ok(body.name.endsWith("…"));
  assert.equal(body.entity_metadata.location.length, 100);
  assert.ok(body.description.length <= 1000);
  assert.ok(body.description.endsWith(`\n\n${URL_LINE}`));
});

it("reads Discord times in the linked event's zone and strips its URL line", () => {
  assert.deepEqual(scheduledEventToFields(inbound(), source()), {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", timezone: "America/New_York",
    start: { time: "15:00" }, end: { time: "18:00" }, summary: "Deep house by the water.", venueLabel: "The Lighthouse",
  });
});

it("reads an unlinked Discord event in UTC and keeps its description whole", () => {
  assert.deepEqual(scheduledEventToFields(inbound({ description: "Bring a friend.\n\nhttps://example.test/x", scheduled_end_time: "2026-11-07T01:30:00.000Z" }), null), {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", timezone: "UTC",
    start: { time: "20:00" }, end: { time: "01:30", dayOffset: 1 }, summary: "Bring a friend.\n\nhttps://example.test/x", venueLabel: "The Lighthouse",
  });
});

it("a title-only Discord edit keeps VRDex's own venue, end, and full title", () => {
  const linked = source({ title: "T".repeat(120), venueLabel: undefined, worldNames: ["Harbor Club"], endAt: undefined });
  const echoed = toScheduledEventBody(linked);
  assert.deepEqual(scheduledEventToFields(echoed, linked), {
    title: "T".repeat(120), eventDate: "2026-11-06", timezone: "America/New_York",
    start: { time: "15:00" }, end: null, summary: "Deep house by the water.", venueLabel: null,
  });
  const edited = scheduledEventToFields({ ...echoed, name: "Harbor Sessions Live" }, linked);
  assert.equal(edited.title, "Harbor Sessions Live");
  assert.equal(edited.venueLabel, null);
  assert.equal(edited.end, null);
});

it("builds a connector candidate with every carried field explicit", () => {
  const fields = scheduledEventToFields(inbound({ scheduled_end_time: "2026-11-07T01:30:00.000Z" }), null);
  const candidate = candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(fields, false), { kind: "new" });
  const { title, eventDate, start, end, startDate, endDate, timezone, venueLabel, summary } = candidate.event;
  assert.deepEqual({ title, eventDate, start, end, startDate, endDate, timezone, venueLabel, summary }, {
    title: "Afterglow Harbor Sessions", eventDate: "2026-11-06", start: "20:00", end: "01:30", startDate: "2026-11-06", endDate: "2026-11-07",
    timezone: "UTC", venueLabel: "The Lighthouse", summary: `Deep house by the water.\n\n${URL_LINE}`,
  });
  const explicit = (c: typeof candidate) => c.evidence.filter((e) => e.origin === "connector" && e.assessment === "explicit").map((e) => e.fieldPath).sort();
  assert.deepEqual(explicit(candidate), ["event.end", "event.eventDate", "event.start", "event.summary", "event.timezone", "event.title", "event.venueLabel"]);
  assert.deepEqual([candidate.lineup, candidate.questions, candidate.decision], [[], [], { kind: "new" }]);
  const linked = candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(scheduledEventToFields(inbound(), source()), true), { kind: "update", slug: "7m2kp9q" });
  assert.ok(!explicit(linked).includes("event.timezone"));
});

const NOW = Date.UTC(2026, 9, 29, 12, 0);
const SERIES = "222222222222222222";
const weekly = (overrides = {}) => ({ start: "2026-10-30T20:00:00.000Z", end: null, frequency: 2 as const, interval: 1, by_weekday: [4], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null, ...overrides });
const series = (rule: DiscordScheduledEvent["recurrence_rule"]): DiscordScheduledEvent => ({
  id: SERIES, guild_id: "876543210987654321", name: "Harbor Fridays", scheduled_start_time: rule!.start,
  scheduled_end_time: new Date(Date.parse(rule!.start) + 3 * HOUR).toISOString(), privacy_level: 2, status: 1, entity_type: 3,
  entity_metadata: { location: "Harbor Club" }, recurrence_rule: rule,
});
const dates = (item: DiscordScheduledEvent) => scheduledEventOccurrences(item, NOW).map((night) => night.externalId.slice(SERIES.length + 1));

it("expands a weekly series within 60 days, one ID per night", () => {
  const nights = scheduledEventOccurrences(series(weekly()), NOW);
  assert.equal(nights.length, 9);
  assert.deepEqual(nights[0], { externalId: `${SERIES}:2026-10-30`, externalSeriesId: SERIES, startAt: Date.UTC(2026, 9, 30, 20), endAt: Date.UTC(2026, 9, 30, 23) });
  assert.equal(nights.at(-1)?.externalId, `${SERIES}:2026-12-25`);
});

it("skips past nights and honours count, interval, and monthly weekdays", () => {
  assert.equal(dates(series(weekly({ start: "2026-10-02T20:00:00.000Z" })))[0], "2026-10-30");
  assert.deepEqual(dates(series(weekly({ start: "2026-10-02T20:00:00.000Z", count: 6 }))), ["2026-10-30", "2026-11-06"]);
  assert.deepEqual(dates(series(weekly({ interval: 2 }))), ["2026-10-30", "2026-11-13", "2026-11-27", "2026-12-11", "2026-12-25"]);
  assert.deepEqual(dates(series(weekly({ frequency: 1, by_weekday: null, by_n_weekday: [{ n: 2, day: 4 }], start: "2026-11-13T20:00:00.000Z" }))), ["2026-11-13", "2026-12-11"]);
});

it("passes a one-off event through as itself", () => {
  assert.deepEqual(scheduledEventOccurrences({ ...series(null as never), recurrence_rule: null, scheduled_start_time: "2026-11-06T20:00:00.000Z", scheduled_end_time: null }, NOW),
    [{ externalId: SERIES, startAt: START, endAt: null }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/discord-scheduled-event-map.test.ts`
Expected: FAIL, cannot find module `convex/_discordScheduledEventMap`.

- [ ] **Step 3: Implement the module** per the Interfaces and Decisions above. Use `eventDateForInstant` from `convex/_eventSchedule.ts` for local dates and `Intl.DateTimeFormat` with `hourCycle: "h23"` for local times.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/discord-scheduled-event-map.test.ts`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(connectors): map VRDex events to Discord scheduled events and back" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/_discordScheduledEventMap.ts convex/_eventCandidateApply.ts tests/backend/discord-scheduled-event-map.test.ts
```

---

### Task 3: Relay route to import jobs

**Files:**

- Create: `convex/eventSyncKinds/discordScheduledEvents.ts` (relay mutation only in this task)
- Modify: `convex/schema.ts` (`eventConnectors` index), `convex/http.ts` (plan 03's relay handler), `docs/deployment/convex-environments.md`
- Test: `tests/backend/event-discord-scheduled-events.test.ts`

**Interfaces:**

- Consumes: `enqueueSyncJob` (plan 02); `parseScheduledEvent`, `discordScheduledEventsEnabled`, `isDiscordId` (Task 2).
- Produces:

```ts
// convex/schema.ts, on eventConnectors
.index("by_kind_target_guildId", ["kind", "target.guildId"]) // skip if plan 03 already indexes target.guildId; use its index
// convex/eventSyncKinds/discordScheduledEvents.ts
export type ScheduledEventJobPayload = { action: "create" | "update" | "delete"; event: DiscordScheduledEvent; receivedAt: number };
export const relayScheduledEvent = internalMutation({ args: { action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")), guildId: v.string(), payload: v.any(), receivedAt: v.number() } });
// -> number of import_item jobs enqueued
```

`relayScheduledEvent` enqueues one `import_item` job with a `ScheduledEventJobPayload` per connector from `by_kind_target_guildId` (`kind` `discord_scheduled_events`) whose `state` is `active` and direction is `import` or `bidirectional`. It enqueues nothing when the flag is off, the guild ID is not a snowflake, `parseScheduledEvent` returns `null`, or `payload.guild_id !== guildId`.

In `convex/http.ts`, plan 03's `/discord-intake/relay` handler branches on `body.kind` after the bearer check, the `VRDEX_DISCORD_INTAKE_ENABLED` check, and the body parse; `"message"` goes to plan 03's `recordMessage`. Add the `"scheduled_event"` branch there: run `relayScheduledEvent` with `receivedAt: Date.now()` and answer with the status plan 03 uses for an accepted message relay; answer 400 when `action` is not one of the three. Plan 03's `/discord-intake/connectors` route already answers `guildId` alone with every Discord kind's connectors for that guild; this plan does not change it, and the test below only pins that the scheduled-events row comes back in that shape.

- [ ] **Step 1: Write the harness and failing tests**

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
  "../../convex/http.ts": () => import("../../convex/http"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
  "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors"),
  "../../convex/eventSyncKinds/discordScheduledEvents.ts": () => import("../../convex/eventSyncKinds/discordScheduledEvents"),
};
const HOUR = 3_600_000; const DAY = 24 * HOUR;
const GUILD = "876543210987654321"; const LIVE = "111111111111111111"; const OTHER = "222222222222222222";
const ENV = { VRDEX_EVENT_CONNECTORS_ENABLED: "true", VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED: "true", VRDEX_DISCORD_INTAKE_ENABLED: "true", DISCORD_INTAKE_SECRET: "relay-secret", DISCORD_BOT_TOKEN: "test-bot-token", SITE_URL: "https://vrdex.test" };
beforeEach(() => { Object.assign(process.env, ENV); });
afterEach(() => { for (const key of Object.keys(ENV)) delete process.env[key]; });
const iso = (ms: number) => new Date(ms).toISOString();

type Call = { method: string; path: string; body?: Record<string, unknown> };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // base64 iVBORw==
function fakeDiscord(test: TestContext, respond: (call: Call) => Response | undefined = () => undefined, artwork = () => new Response(PNG, { headers: { "content-type": "image/png" } })) {
  const calls: Call[] = [];
  test.mock.method(globalThis, "fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "media.example.test") return artwork();
    const call: Call = { method: init.method ?? "GET", path: url.pathname.replace("/api/v10", ""), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    return respond(call) ?? (call.method === "DELETE" ? new Response(null, { status: 204 })
      : call.method === "GET" && call.path.endsWith("/scheduled-events") ? Response.json([])
      : call.method === "GET" ? Response.json({ id: call.path.split("/").at(-1), status: 1 })
      : Response.json({ ...call.body, id: call.method === "POST" ? "900000000000000001" : call.path.split("/").at(-1) }));
  });
  return calls;
}
const said = (calls: Call[]) => calls.map((call) => `${call.method} ${call.path}`);

const communityBase = { slug: "afterglow-social", displayName: "Afterglow Social", sortName: "afterglow social", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
function eventBase(startAt: number) {
  return { title: "Afterglow Harbor Sessions", sortTitle: "afterglow harbor sessions", summary: "Deep house by the water.", venueLabel: "The Lighthouse", posterImageUrl: "https://media.example.test/poster.png",
    scheduleKind: "timed", startAt, sortAt: startAt, eventDate: iso(startAt).slice(0, 10), endAt: startAt + 3 * HOUR, timezone: "UTC",
    eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } as const;
}
type Seed = Partial<Doc<"events">> & { link?: string; linkState?: Doc<"eventSyncLinks">["state"] };

async function seed(t: ReturnType<typeof convexTest>, events: Seed[], connector: Partial<Doc<"eventConnectors">> = {}) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: "staff" });
    const communityProfileId = await ctx.db.insert("profiles", communityBase);
    const connectorId = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", authorityUserId: userId, target: { guildId: GUILD }, state: "active", createdAt: now, updatedAt: now, ...connector });
    const eventIds: Id<"events">[] = [];
    for (const [index, { link, linkState, ...event }] of events.entries()) {
      const eventId = await ctx.db.insert("events", { ...eventBase(event.startAt ?? now + 2 * DAY), slug: `night-${index}`, communityProfileId, ...event });
      if (link) await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: link, state: linkState ?? "linked", createdAt: now, updatedAt: now });
      eventIds.push(eventId);
    }
    return { now, userId, communityProfileId, connectorId, eventIds };
  });
}
async function runJob(t: ReturnType<typeof convexTest>, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: Doc<"eventSyncJobs">["kind"]; payload?: unknown }) {
  const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", { payload: null, ...job, dueAt: 0, attempts: 0, state: "pending", createdAt: 0, updatedAt: 0 }));
  await t.action(internal.eventSync.runJob, { jobId });
  return t.run((ctx) => ctx.db.get(jobId));
}
const all = <T extends "eventSyncJobs" | "eventSyncLinks" | "eventIntakeDrafts" | "events">(t: ReturnType<typeof convexTest>, table: T) => t.run((ctx) => ctx.db.query(table).collect());
const discordEvent = (startAt: number, overrides: Record<string, unknown> = {}) => ({
  id: LIVE, guild_id: GUILD, channel_id: null, creator_id: "333333333333333333", name: "Afterglow Harbor Sessions", description: "Deep house by the water.",
  scheduled_start_time: iso(startAt), scheduled_end_time: iso(startAt + 3 * HOUR), privacy_level: 2, status: 1, entity_type: 3, entity_id: null,
  entity_metadata: { location: "The Lighthouse" }, image: null, recurrence_rule: null, ...overrides,
});
const relayPost = (t: ReturnType<typeof convexTest>, body: unknown) => t.fetch("/discord-intake/relay", {
  method: "POST", headers: { authorization: "Bearer relay-secret", "content-type": "application/json" }, body: JSON.stringify(body),
});

it("relays a scheduled event to an import job on each matching connector", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const base = (await ctx.db.get(s.connectorId))!;
    const { _id, _creationTime, ...copy } = base;
    await ctx.db.insert("eventConnectors", { ...copy, direction: "export" });
    await ctx.db.insert("eventConnectors", { ...copy, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...copy, target: { guildId: "999999999999999999" } });
  });
  const response = await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY) });
  assert.ok(response.ok);
  const jobs = await all(t, "eventSyncJobs");
  assert.deepEqual(jobs.map((job) => [job.connectorId, job.kind, job.payload.action, job.payload.event.id]), [[s.connectorId, "import_item", "update", LIVE]]);
  assert.equal(typeof jobs[0].payload.receivedAt, "number");
});

it("relays nothing when the flag is off or the payload belongs to another guild", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY, { guild_id: "999999999999999999" }) });
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  await relayPost(t, { kind: "scheduled_event", action: "update", guildId: GUILD, payload: discordEvent(s.now + DAY) });
  assert.deepEqual(await all(t, "eventSyncJobs"), []);
});

it("answers the gateway's guild-only connector lookup", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const response = await t.fetch(`/discord-intake/connectors?guildId=${GUILD}`, { headers: { authorization: "Bearer relay-secret" } });
  assert.deepEqual(await response.json(), { connectors: [{ connectorId: s.connectorId, kind: "discord_scheduled_events", direction: "bidirectional", mode: "hold", state: "active", guildId: GUILD }] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: FAIL, cannot find module `convex/eventSyncKinds/discordScheduledEvents`.

- [ ] **Step 3: Add the index, `relayScheduledEvent`, and the `convex/http.ts` relay branch.** Regenerate with `pnpm verify:backend:local` (restore `convex/README.md` and `convex/tsconfig.json` if the CLI rewrites them), then `pnpm typecheck:backend`.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Document the flag** in `docs/deployment/convex-environments.md`, next to plan 02's `VRDEX_EVENT_CONNECTORS_ENABLED` entry:

```markdown
- `VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED`: `true` enables Discord scheduled event jobs, the relay of scheduled event changes into import jobs, the daily reconcile, and the Connect button. Default off. Also needs `DISCORD_BOT_TOKEN` and `SITE_URL`. Owner: deployment operator. No secret; roll back by setting it to `false`.
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(connectors): route relayed Discord scheduled events to import jobs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/schema.ts convex/http.ts convex/eventSyncKinds/discordScheduledEvents.ts convex/_generated docs/deployment/convex-environments.md tests/backend/event-discord-scheduled-events.test.ts
```

---

### Task 4: Export: upsert, cancel, delete, pause

**Files:**

- Modify: `convex/eventSyncKinds/discordScheduledEvents.ts`, `convex/eventSyncKinds/index.ts`
- Test: `tests/backend/event-discord-scheduled-events.test.ts`

**Interfaces:**

- Consumes: `discordRequest` (plan 03); `SyncKindHandler`, `syncKindHandlers`, `carriedFieldsHash` (plan 02); Task 2's map; `getPublicEventBySlug` from `convex/_eventPublic.ts` (worlds, venue, summary, status); `toPublicEventShareCard` from `convex/_eventShareCard.ts` (artwork: poster, then banner, then thumbnail); `eventPathForSlugs` from `convex/_eventPaths.ts`.
- Produces:

```ts
export async function loadScheduledEventSource(db: DatabaseReader, event: Doc<"events">): Promise<ScheduledEventSource | null>; // null when not public
export const getExportState = internalQuery({ args: { eventId: v.id("events") } }); // -> { source: ScheduledEventSource | null; communityProfileId }
export const pauseConnector = internalMutation({ args: { connectorId: v.id("eventConnectors"), lastError: v.string() } });
export async function artworkDataUri(url: string): Promise<string | undefined>;
export function liveExternalId(link: Doc<"eventSyncLinks"> | null): string | null; // state linked and externalId is a snowflake
export const discordScheduledEventsHandler: SyncKindHandler; // exportUpsert returns { externalId }; the runner writes lastExportedAt and lastExportedHash
```

`loadScheduledEventSource` resolves `url` as `SITE_URL` (trailing slash trimmed) plus `eventPathForSlugs`, and a relative artwork path against `SITE_URL`.

`exportUpsert(ctx, connector, event, link)`. "Live" is `liveExternalId(link) !== null`. When nothing exists on Discord, return `{ externalId: "none:" + event._id }` (never a snowflake). Task 5's `ignores its own export coming back` proves the runner's hash and `applyEventCandidate`'s inbound hash agree.

| Source | Link | Action | Returns |
| --- | --- | --- | --- |
| any | `external_deleted` | nothing (staff decides in My events) | `link.externalId` |
| null (not public) | live | DELETE it, 404 counts as done | `none:` |
| cancelled | live | GET it; PATCH `{ status: 4 }` only when its status is 1 | `link.externalId` |
| scheduled, start in the past or no `startAt` | any | nothing (Discord refuses past starts) | `link.externalId` or `none:` |
| scheduled | live | GET it; on 404 or status 3 or 4, POST a new one; else PATCH the full body | the Discord ID |
| scheduled | none | GET the guild's list; the first item starting on the same UTC date with a case-insensitive trimmed title match and no link on this connector is PATCHed; else POST | the Discord ID |
| null or cancelled | none | nothing | `none:` |

`exportDelete(ctx, connector, link)`: DELETE the live ID; 404 counts as done; nothing for a non-live link.

All methods first throw `CONNECTOR_KIND_DISABLED` when the flag is off and `SCHEDULED_EVENTS_TARGET_INVALID` when `target.guildId` fails `isDiscordId`, before any request. A 403 anywhere runs `pauseConnector` with `discord_forbidden`, then throws. `ponytail:` the cover is re-fetched and re-sent on every PATCH; store the artwork URL on the link if Discord's rate limits ever bite.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const upsert = (t: ReturnType<typeof convexTest>, s: { connectorId: Id<"eventConnectors">; eventIds: Id<"events">[] }, index = 0) =>
  runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[index], kind: "export_upsert" });
const linkOf = async (t: ReturnType<typeof convexTest>, eventId: Id<"events">) => (await all(t, "eventSyncLinks")).find((link) => link.eventId === eventId) ?? null;
const PATH = `/guilds/${GUILD}/scheduled-events`;

it("creates the Discord event from the carried fields with the artwork", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  const start = s.now + 2 * DAY;
  assert.equal((await upsert(t, s))?.state, "done");
  assert.deepEqual(said(calls), [`GET ${PATH}`, `POST ${PATH}`]);
  assert.deepEqual(calls[1].body, {
    name: "Afterglow Harbor Sessions", privacy_level: 2, entity_type: 3, channel_id: null, entity_metadata: { location: "The Lighthouse" },
    scheduled_start_time: iso(start), scheduled_end_time: iso(start + 3 * HOUR),
    description: "Deep house by the water.\n\nhttps://vrdex.test/afterglow-social/events/night-0", image: "data:image/png;base64,iVBORw==",
  });
  const link = await linkOf(t, s.eventIds[0]);
  assert.equal(link?.externalId, "900000000000000001");
  assert.ok(link?.lastExportedHash);
});

it("exports without a cover when the artwork is too large", async (test) => {
  const calls = fakeDiscord(test, undefined, () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }));
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{}]));
  assert.equal(Object.hasOwn(calls[1].body!, "image"), false);
});

it("updates the linked Discord event in place", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `PATCH ${PATH}/${LIVE}`]);
});

it("re-creates a Discord event that ended or was cancelled there", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path.endsWith(LIVE) ? Response.json({ id: LIVE, status: 4 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `POST ${PATH}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, "900000000000000001");
});

it("links a same-night Discord event instead of creating a duplicate", async (test) => {
  let start = 0;
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path === PATH ? Response.json([discordEvent(start, { id: OTHER, name: " afterglow HARBOR sessions " })]) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  start = s.now + 2 * DAY;
  await upsert(t, s);
  assert.deepEqual(said(calls), [`GET ${PATH}`, `PATCH ${PATH}/${OTHER}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, OTHER);
});

it("a cancelled VRDex event cancels the Discord event", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  await upsert(t, await seed(t, [{ eventStatus: "cancelled", link: LIVE }]));
  assert.deepEqual(said(calls), [`GET ${PATH}/${LIVE}`, `PATCH ${PATH}/${LIVE}`]);
  assert.deepEqual(calls[1].body, { status: 4 });
});

it("export_delete deletes the Discord event and treats a missing one as deleted", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path.endsWith(OTHER) ? new Response(null, { status: 404 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }, { link: OTHER }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[0], kind: "export_delete" }))?.state, "done");
  assert.equal((await runJob(t, { connectorId: s.connectorId, eventId: s.eventIds[1], kind: "export_delete" }))?.state, "done");
  assert.deepEqual(said(calls), [`DELETE ${PATH}/${LIVE}`, `DELETE ${PATH}/${OTHER}`]);
});

it("pauses the connector when Discord refuses the write", async (test) => {
  fakeDiscord(test, (call) => (call.method === "POST" ? new Response(null, { status: 403 }) : undefined));
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  assert.notEqual((await upsert(t, s))?.state, "done");
  const connector = await t.run((ctx) => ctx.db.get(s.connectorId));
  assert.equal(connector?.state, "paused");
  assert.match(connector?.lastError ?? "", /discord_forbidden/);
});

it("makes no request for started events, a disabled flag, or a bad guild ID", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const now = Date.now();
  await upsert(t, await seed(t, [{ startAt: now - HOUR }]));
  const bad = await upsert(t, await seed(t, [{}], { target: { guildId: "../../users/@me" } }));
  assert.match(bad?.lastError ?? "", /SCHEDULED_EVENTS_TARGET_INVALID/);
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  const off = await upsert(t, await seed(t, [{}]));
  assert.match(off?.lastError ?? "", /CONNECTOR_KIND_DISABLED/);
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: the new tests FAIL, the runner finds no `discord_scheduled_events` handler.

- [ ] **Step 3: Implement** `loadScheduledEventSource`, `getExportState`, `pauseConnector`, `artworkDataUri`, `liveExternalId`, `exportUpsert` and `exportDelete` per the table; register `discord_scheduled_events: discordScheduledEventsHandler` in `convex/eventSyncKinds/index.ts`. Regenerate and typecheck as in Task 3.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(connectors): export VRDex events to Discord scheduled events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds convex/_generated tests/backend/event-discord-scheduled-events.test.ts
```

---

### Task 5: Import: matching, deletion flag, recurrence

**Files:**

- Modify: `convex/eventSyncKinds/discordScheduledEvents.ts`
- Test: `tests/backend/event-discord-scheduled-events.test.ts`

**Interfaces:**

- Consumes: `applyEventCandidate`, `carriedFieldsHash` (plan 02); `candidateFromConnectorFields` (plan 08, or Task 2); Task 2's map; Task 4's `loadScheduledEventSource`; `readEventSchedule`, `eventDateForInstant` from `convex/_eventSchedule.ts`; index `events.by_communityProfileId_sortAt`.
- Produces:

```ts
export async function findTitleDateMatch(db: DatabaseReader, communityProfileId: Id<"profiles">, title: string, startAt: number): Promise<Doc<"events"> | null>;
// community events with sortAt in startAt ± 36 h whose readEventSchedule(event).eventDate equals eventDateForInstant(startAt, event.timezone ?? "UTC") and whose trimmed title matches case-insensitively
export const applyScheduledEventImport = internalMutation({ args: { connectorId: v.id("eventConnectors"), payload: v.any() } });
// discordScheduledEventsHandler.importItem(ctx, connector, payload) runs it; no importPoll (the gateway pushes)
```

`applyScheduledEventImport`, in order, per occurrence from `scheduledEventOccurrences(item, now)` (a one-off is one occurrence; each occurrence's item copy takes its start and end):

1. Return when the connector is not `active` or its direction is not `import` or `bidirectional`, or `parseScheduledEvent` fails.
2. Deletion: on action `delete` or `status: 4`, mark `external_deleted` every link of this connector whose `externalId` is the item ID or starts with the item ID plus `:` (range on `by_connectorId_externalId`), except a `delete` on a `vrdex_retracted` link and a `status: 4` on a link whose event is `cancelled` (both are VRDex's own write coming back). Never touch the event. Stop.
3. `status: 3` (Discord completed it) is ignored. An occurrence that starts at or before now with no link is ignored.
4. Link by `by_connectorId_externalId`; with none, `findTitleDateMatch`, and on a match insert a `linked` link to it first.
5. `fields = scheduledEventToFields(occurrence, linked source or null)`; `applyEventCandidate` with `candidateFromConnectorFields("discord_scheduled_events", scheduledEventCandidateFields(fields, linked !== null), linked ? { kind: "update", slug } : { kind: "new" })`, `actorUserId: connector.authorityUserId`, the link, `externalId`, `externalUpdatedAt: payload.receivedAt` (the relay receipt time, since Discord sends no updated time), `idempotencyKey: "discord_scheduled_events:" + connectorId + ":" + externalId + ":" + carriedFieldsHash("discord_scheduled_events", fields)`. Its `skipped_echo` and `skipped_stale` outcomes are the echo guard and newer-wins; do not repeat them here.
6. Afterwards set `externalSeriesId` (recurring only) and `lastImportedAt` on the link for that `externalId`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const importJob = (t: ReturnType<typeof convexTest>, connectorId: Id<"eventConnectors">, action: string, event: unknown, receivedAt = Date.now()) =>
  runJob(t, { connectorId, kind: "import_item", payload: { action, event, receivedAt } });

it("ignores its own export coming back", async (test) => {
  const calls = fakeDiscord(test);
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  await upsert(t, s);
  const sent = calls.find((call) => call.method === "POST")!.body!;
  const echo = { ...discordEvent(s.now + 2 * DAY), ...sent, id: "900000000000000001", image: "a1b2c3d4" };
  assert.equal((await importJob(t, s.connectorId, "update", echo))?.state, "done");
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  assert.equal((await t.run((ctx) => ctx.db.get(s.eventIds[0])))?.updatedAt, 1);
});

it("files a held draft and a link for a new Discord event", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + DAY, { id: OTHER, name: "Harbor Sunrise" }));
  assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
  const [link] = await all(t, "eventSyncLinks");
  assert.equal(link.externalId, OTHER);
  assert.ok(link.draftId);
  assert.equal(link.eventId, undefined);
});

it("links an unlinked Discord event to the same VRDex night instead of creating one", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{}]);
  await importJob(t, s.connectorId, "create", discordEvent(s.now + 2 * DAY, { name: "AFTERGLOW harbor sessions", description: "New details." }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
  assert.equal((await all(t, "events")).length, 1);
});

it("a Discord cancel flags the event and never cancels it", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { status: 4 }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "external_deleted");
  const event = await t.run((ctx) => ctx.db.get(s.eventIds[0]));
  assert.deepEqual([event?.eventStatus, event?.publicationState], ["scheduled", "published"]);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("its own cancel coming back is not a deletion", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ eventStatus: "cancelled", link: LIVE }]);
  await importJob(t, s.connectorId, "update", discordEvent(s.now + 2 * DAY, { status: 4 }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "linked");
});

it("a Discord delete flags the event; its own delete does not", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE }, { link: OTHER, linkState: "vrdex_retracted" }]);
  await importJob(t, s.connectorId, "delete", discordEvent(s.now + 2 * DAY));
  await importJob(t, s.connectorId, "delete", discordEvent(s.now + 2 * DAY, { id: OTHER }));
  assert.equal((await linkOf(t, s.eventIds[0]))?.state, "external_deleted");
  assert.equal((await linkOf(t, s.eventIds[1]))?.state, "vrdex_retracted");
});

it("bidirectional keeps a newer VRDex edit and applies a newer Discord one", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, [{ link: LIVE, updatedAt: Date.now() }]);
  const updatedAt = (await t.run((ctx) => ctx.db.get(s.eventIds[0])))!.updatedAt;
  const edited = discordEvent(s.now + 2 * DAY, { name: "Harbor Sessions Live" });
  await importJob(t, s.connectorId, "update", edited, updatedAt - 1);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
  await importJob(t, s.connectorId, "update", edited, updatedAt + 1);
  assert.equal((await all(t, "eventIntakeDrafts")).length, 1);
});

it("expands a recurring Discord event into one link per night within 60 days", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  const start = s.now + DAY;
  const rule = { start: iso(start), end: null, frequency: 2, interval: 1, by_weekday: [(new Date(start).getUTCDay() + 6) % 7], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null };
  await importJob(t, s.connectorId, "create", discordEvent(start, { id: OTHER, name: "Harbor Fridays", recurrence_rule: rule }));
  const links = await all(t, "eventSyncLinks");
  assert.equal(links.length, 9);
  assert.equal(new Set(links.map((link) => link.externalId)).size, 9);
  assert.ok(links.every((link) => link.externalSeriesId === OTHER && link.externalId.startsWith(`${OTHER}:`)));
  assert.equal((await all(t, "eventIntakeDrafts")).length, 9);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: the eight new tests FAIL (no `importItem`).

- [ ] **Step 3: Implement** `findTitleDateMatch`, `applyScheduledEventImport`, and `importItem` per the ordered rules. Regenerate and typecheck as in Task 3.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: 20 passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(connectors): import Discord scheduled events with echo and deletion guards" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/discordScheduledEvents.ts convex/_generated tests/backend/event-discord-scheduled-events.test.ts
```

---

### Task 6: Reconcile and the daily reconcile cron

**Files:**

- Modify: `convex/eventSyncKinds/discordScheduledEvents.ts`, `convex/crons.ts`, `docs/backend/event-schema.md`
- Test: `tests/backend/event-discord-scheduled-events.test.ts`

**Interfaces:**

- Consumes: `enqueueSyncJob` (plan 02); `findTitleDateMatch` (Task 5); `scheduledEventOccurrences`, `RECONCILE_HORIZON_MS` (Task 2); index `events.by_communityProfileId_sortAt`.
- Produces:

```ts
export const applyReconcile = internalMutation({ args: { connectorId: v.id("eventConnectors"), items: v.array(v.any()), receivedAt: v.number() } }); // -> { linked: number; imports: number; exports: number }
export const enqueueReconciles = internalMutation({ args: {} }); // -> jobs enqueued
// discordScheduledEventsHandler.reconcile(ctx, connector): GET /guilds/{guildId}/scheduled-events, then applyReconcile
```

`applyReconcile`, never writing to Discord itself:

- For each parsed item and each occurrence starting from now through `RECONCILE_HORIZON_MS`: an existing link is left alone; a `findTitleDateMatch` hit gets a `linked` link (with `externalSeriesId` for recurring items); otherwise, for `import` and `bidirectional`, the item gets one `import_item` job (`ScheduledEventJobPayload` with `action: "create"`), once per item, not per occurrence. Items with `status` 3 or 4 are skipped.
- For `export` and `bidirectional`: every published, scheduled community event starting from now through `RECONCILE_HORIZON_MS` with no link on this connector gets an `export_upsert` job, skipped when one is pending. This is what makes turning on export mode put existing upcoming nights on Discord; the upsert's own list-and-match still prevents duplicates.

`enqueueReconciles`: 0 when the flag is off; otherwise one `reconcile` job per `discord_scheduled_events` connector with `state: "active"` and direction not `off`, skipped when one is pending. Cron: `crons.daily("reconcile Discord scheduled event connectors", { hourUTC: 5, minuteUTC: 20 }, internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {})`. It only enqueues runner jobs, so the runner's failure alarm covers it.

- [ ] **Step 1: Write the failing tests** (append)

```ts
it("reconcile links matching Discord events without creating anything", async (test) => {
  let s!: Awaited<ReturnType<typeof seed>>;
  const calls = fakeDiscord(test, (call) => (call.method === "GET" && call.path === PATH ? Response.json([
    discordEvent(s.now + 2 * DAY, { name: "AFTERGLOW HARBOR SESSIONS" }),
    discordEvent(s.now + 3 * DAY, { id: OTHER, name: "Harbor Sunrise" }),
    discordEvent(s.now - DAY, { id: "555555555555555555", name: "Last Week", status: 2 }),
  ]) : undefined));
  const t = convexTest({ schema, modules });
  s = await seed(t, [{}, { title: "Second Night", sortTitle: "second night", startAt: Date.now() + 5 * DAY }]);
  assert.equal((await runJob(t, { connectorId: s.connectorId, kind: "reconcile" }))?.state, "done");
  assert.deepEqual(said(calls), [`GET ${PATH}`]);
  assert.equal((await linkOf(t, s.eventIds[0]))?.externalId, LIVE);
  const pending = (await all(t, "eventSyncJobs")).filter((job) => job.state === "pending");
  assert.deepEqual(pending.filter((job) => job.kind === "import_item").map((job) => job.payload.event.id), [OTHER]);
  assert.deepEqual(pending.filter((job) => job.kind === "export_upsert").map((job) => job.eventId), [s.eventIds[1]]);
  assert.deepEqual(await all(t, "eventIntakeDrafts"), []);
});

it("enqueues one daily reconcile per active connector", async () => {
  const t = convexTest({ schema, modules });
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    const { _id, _creationTime, ...copy } = (await ctx.db.get(s.connectorId))!;
    await ctx.db.insert("eventConnectors", { ...copy, direction: "export", target: { guildId: "999999999999999999" } });
    await ctx.db.insert("eventConnectors", { ...copy, state: "paused" });
    await ctx.db.insert("eventConnectors", { ...copy, direction: "off" });
    await ctx.db.insert("eventConnectors", { ...copy, kind: "discord_board", target: { guildId: GUILD, channelId: "123456789012345678" } });
  });
  assert.equal(await t.mutation(internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {}), 2);
  assert.equal(await t.mutation(internal.eventSyncKinds.discordScheduledEvents.enqueueReconciles, {}), 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement** `applyReconcile`, `reconcile`, `enqueueReconciles`, and the cron entry. Regenerate and typecheck as in Task 3.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: 22 passing.

- [ ] **Step 5: Document** in `docs/backend/event-schema.md`, the Connectors section plan 02 added: a `discord_scheduled_events` entry covering target `{ guildId }`, directions import, export, bidirectional, off; carried fields; the export shape and fallbacks; cancel PATCHes status 4 and unpublish, retraction, and moderation DELETE; inbound cancel or delete flags with `external_deleted`; receipt time as `externalUpdatedAt`; recurring expansion and its `externalId` format; gateway push plus the daily reconcile; the bot needs Manage Events and Create Events, and a 403 pauses the connector with `discord_forbidden`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(connectors): reconcile Discord scheduled events daily" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/discordScheduledEvents.ts convex/crons.ts convex/_generated docs/backend/event-schema.md tests/backend/event-discord-scheduled-events.test.ts
```

---

### Task 7: Connect on the Integrations page

**Files:**

- Modify: `convex/eventSyncKinds/discordScheduledEvents.ts`, `convex/eventConnectors.ts` (plan 02's `create`), `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx`
- Create: `apps/web/src/app/account/communities/[slug]/discord-scheduled-events-connect.tsx`
- Test: `tests/backend/event-discord-scheduled-events.test.ts`

**Interfaces:**

- Consumes: `requireConnectorAuthority` (plan 02); `listActiveControlProofsForUser`, `requireControlProof`, `MINIMUM_COMMUNITY_CONTROL_LEVEL`, `meetsControlLevel` from `convex/_externalControl.ts`; `api.eventConnectors.create`; `Button` from `@/components/ui/button`, `Field`, `FieldText`, `Select` from `@/components/ui/field`.
- Produces:

```ts
export const isEnabled = query({ args: {} }); // -> discordScheduledEventsEnabled()
export const provedGuildIds = internalQuery({ args: { communityProfileId: v.id("profiles") } });
// session user (resolved as plan 02's convex/eventConnectors.ts does) passes requireConnectorAuthority;
// -> guild IDs of their active, unexpired discord_guild proofs at MINIMUM_COMMUNITY_CONTROL_LEVEL
export const listConnectableGuilds = action({ args: { communityProfileId: v.id("profiles") } });
// -> Array<{ id: string; name: string }>: GET /users/@me/guilds?limit=200 with the bot token, intersected with provedGuildIds, sorted by name
```

```tsx
export function DiscordScheduledEventsConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> }): JSX.Element | null;
```

Decisions:

- The picker lists servers the bot is in and the staffer has proved they manage; `create` enforces the same server-side: for `kind: "discord_scheduled_events"`, `target.guildId` must pass `isDiscordId` and `requireControlProof(db, userId, "discord_guild", guildId, MINIMUM_COMMUNITY_CONTROL_LEVEL)`. Skip the `create` change if plan 02 already validates Discord targets this way. `ponytail:` one page of 200 bot guilds; paginate with `after` when the bot passes 200 servers.
- Component: renders nothing when `isEnabled` is false; a `Discord events` button opens a form with `Server` (from `listConnectableGuilds`), `Direction` (`Import`, `Export`, `Both`, `Off` for `import`, `export`, `bidirectional`, `off`), and `Connect`, which calls `api.eventConnectors.create` with `{ communityProfileId, kind: "discord_scheduled_events", direction, mode: "hold", target: { guildId } }`. The row's mode picker is plan 02's. Add `discord_scheduled_events: "Discord events"` to the page's kind label map if plan 02 did not.
- Bot permissions: no change here. Plan 03's invite URL already uses `DISCORD_BOT_PERMISSIONS`, which includes Manage Events and Create Events. A server whose bot lacks them answers 403 on the first write, which pauses the connector with `discord_forbidden` (Task 4); reinviting fixes it.

- [ ] **Step 1: Write the failing tests** (append)

```ts
const staff = { subject: "staff", issuer: "https://test.clerk.accounts.dev", tokenIdentifier: "https://test.clerk.accounts.dev|staff" };
async function staffer(t: ReturnType<typeof convexTest>, provedGuilds: string[]) {
  const s = await seed(t, []);
  await t.run(async (ctx) => {
    await ctx.db.insert("communityAuthorities", { communityProfileId: s.communityProfileId, subject: staff, subjectTokenIdentifier: staff.tokenIdentifier, capabilities: ["manage_integrations"], state: "active", grantedAt: s.now, updatedAt: s.now });
    for (const guildId of provedGuilds) await ctx.db.insert("externalControlProofs", { userId: s.userId, assetType: "discord_guild", assetExternalId: guildId, controlLevel: "manager", state: "active", evidenceSource: "discord_oauth", verifiedAt: s.now, revalidateAfter: s.now + DAY, createdAt: s.now, updatedAt: s.now });
  });
  return { s, as: t.withIdentity({ ...staff, email: "staff@example.test", emailVerified: true }) };
}

it("lists servers the bot is in that the staffer manages", async (test) => {
  const calls = fakeDiscord(test, (call) => (call.path === "/users/@me/guilds" ? Response.json([
    { id: "999999999999999999", name: "Elsewhere" }, { id: GUILD, name: "Afterglow" }, { id: "777777777777777777", name: "Bot Only" },
  ]) : undefined));
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, [GUILD, "999999999999999999"]);
  assert.deepEqual(await as.action(api.eventSyncKinds.discordScheduledEvents.listConnectableGuilds, { communityProfileId: s.communityProfileId }), [
    { id: GUILD, name: "Afterglow" }, { id: "999999999999999999", name: "Elsewhere" },
  ]);
  assert.deepEqual(said(calls), ["GET /users/@me/guilds"]);
});

it("refuses to connect a server the staffer has not proved", async () => {
  const t = convexTest({ schema, modules });
  const { s, as } = await staffer(t, ["999999999999999999"]);
  const args = { communityProfileId: s.communityProfileId, kind: "discord_scheduled_events" as const, direction: "export" as const, mode: "hold" as const };
  await assert.rejects(as.mutation(api.eventConnectors.create, { ...args, target: { guildId: GUILD } }), /CONTROL_NOT_VERIFIED/);
  assert.ok(await as.mutation(api.eventConnectors.create, { ...args, target: { guildId: "999999999999999999" } }));
});

it("reports whether Discord events are enabled", async () => {
  const t = convexTest({ schema, modules });
  assert.equal(await t.query(api.eventSyncKinds.discordScheduledEvents.isEnabled, {}), true);
  delete process.env.VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED;
  assert.equal(await t.query(api.eventSyncKinds.discordScheduledEvents.isEnabled, {}), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement** `isEnabled`, `provedGuildIds`, `listConnectableGuilds`, and the `create` guard. Regenerate and typecheck as in Task 3.

- [ ] **Step 4: Run to verify pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts tests/backend/discord-scheduled-event-map.test.ts`
Expected: 25 and 12 passing.

- [ ] **Step 5: Build `DiscordScheduledEventsConnect` and mount it** beside the page's other Connect buttons.

Run: `pnpm --filter web lint` and `pnpm --filter web typecheck`
Expected: clean.

- [ ] **Step 6: Visual verification**

Start the local backend and web app, sign in as a seeded staffer with a proved guild, open the community's Integrations page, and screenshot the closed button and the open form at desktop width and at 375 px. Hand the screenshots and the AGENTS.md UI rules to a Sonnet reviewer. Expected: no horizontal overflow, subtle radii, labels only, no explanatory prose; fix and re-shoot until it passes.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(integrations): connect Discord scheduled events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/discordScheduledEvents.ts convex/eventConnectors.ts convex/_generated ":(literal)apps/web/src/app/account/communities/[slug]/discord-scheduled-events-connect.tsx" ":(literal)apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx" tests/backend/event-discord-scheduled-events.test.ts
```

---

## Finish

- [ ] Run `node --conditions=import --import tsx --test tests/backend/event-discord-scheduled-events.test.ts tests/backend/discord-scheduled-event-map.test.ts`, the gateway tests, `pnpm typecheck:backend`, `pnpm --filter web typecheck`, and `pnpm exec markdownlint-cli2 docs/backend/event-schema.md docs/deployment/convex-environments.md docs/deployment/discord-gateway.md`. Expected: all clean.
- [ ] Push and open a PR to `main`. The description lists every public string from Global Constraints, cites the spec copy table, marks `Discord events` and the direction options as awaiting BASIC's approval of the exact wording, states whether this PR created `candidateFromConnectorFields` or reused plan 08's, and attaches the Task 7 screenshots. Do not merge.
