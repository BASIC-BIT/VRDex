# Recurrence-Aware Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google or Discord recurring event imports as one `eventSeries` with VRDex-materialised nights, a VRDex series exports as one Google or Discord recurring event, and existing phase-one occurrence links are grouped into series.

**Architecture:** A pure rule module maps Google RRULE lines and Discord `recurrence_rule` objects to and from plan 10's fixed rule set. One shared mutation (`applyExternalSeries`) creates, updates, or flags a series from any external series, and one shared recorder writes the series link. The two kind modules gain a series branch in import and export, gated by `VRDEX_RECURRING_EVENTS_ENABLED`; when the flag is off, or a rule falls outside the fixed set, every branch falls through to plans 07 and 08 unchanged. Series exports ride the existing job queue as `export_upsert` jobs carrying `payload.seriesId` and no `eventId`.

**Tech Stack:** Convex (internal functions, scheduler), Google Calendar API v3 over raw `fetch`, Discord REST v10, `node:test` with `convex-test` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-recurring-events-design.md` (The model, Connectors) and `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (Links, Recurring items, Google Calendar, Discord scheduled events). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md` (Recurrence and plan 11).

## Global Constraints

- Depends on plans 07, 08, 10. Use their names as the master plan and their plans fix them: `eventSyncLinks`, `enqueueSyncJob`, `internal.eventSync.runJob`, `SyncKindHandler`, `applyEventCandidate`, `carriedFieldsHash`, `googleCalendarHandler`, `fieldsFromGoogleEvent`, `googleBodyFromEvent`, `candidateFromConnectorFields`, `withGoogleToken`, `discordRequest`, `materializeSeries`, `internal.eventSeries.materialize`, `fanOutSeriesEdit`, `retireOccurrences`, `seriesOverridesFor`, `recordOccurrenceOverrides`, `occurrenceTimes`, `occurrenceDates`, `recurringEventsEnabled`. Do not redefine them.
- Flag `VRDEX_RECURRING_EVENTS_ENABLED` (plan 10). Off: no series job is enqueued, a series job completes as a no-op, and both kinds take their phase-one paths byte for byte.
- Fixed set only: `weekly`; `biweekly` = weekly interval 2; `monthly_weekday` with ordinal `1..4` or `-1`. Everything else (daily, several weekdays, fifth weekday, by month day, yearly, other intervals, `EXDATE`, `RDATE`, `BYSETPOS`, all-day masters) keeps phase-one expansion.
- Series import runs only for connectors in `autopublish` mode. `hold` connectors keep phase-one expansion, because the spec has no private series draft ("A series exists only once published").
- Inbound deletion or cancellation of a series never ends the series and never cancels a night: it sets links `external_deleted`, the existing staff-attention flag.
- `startsOn` is written on create only; it is excluded from the series hash and from updates (Discord moves `recurrence_rule.start` forward as nights pass).
- Carried series fields: `title`, `summary`, `venueLabel`, `timezone`, `rule`, `endsOn`, `count`. Discord cannot write `endsOn` or `count` (discord.js 14 `GuildScheduledEventRecurrenceRuleOptions` exposes only `startAt`, `interval`, `frequency` and the by-fields), so Discord imports never carry them.
- Ceilings, stated in docs, not built: Discord has no per-occurrence exceptions, so an overridden night exports as a separate one-off scheduled event and the Discord series still shows that date; a cancelled night that is not otherwise overridden stays visible in a Discord series; a future `endsOn` or `count` cannot reach Discord, which keeps recurring until the series ends; a monthly last-weekday series cannot be a Discord series (Discord `n` is `1..5`, no `-1`) and exports night by night; a series first imported from Discord has wall-clock times in UTC (Discord events carry no zone), so it drifts an hour across DST until staff set its zone; a non-overridden night unpublished on its own stays in the external series, because `export_delete` runs only with a link.
- No new public strings. No new env var. No new npm dependency.
- Tests: `node --conditions=import --import tsx --test tests/backend/<file>.test.ts`. Commit per task, conventional subject, message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A Google series edit and an exception edit can arrive in one poll; the fan-out bumps every night's `updatedAt`, and the exception must still land rather than lose to newer-wins (Task 3, `applies an exception that arrives with a series edit`).
2. Nights of a plan 10 series were already exported one by one before the flag turned on; the series export must retract those standalone copies, not leave every night twice in Google (Task 4, `retracts a standalone copy once the series exists`).
3. Materialisation enqueues a job per night at the same moment as the series job; a night job that wins the race must not create a standalone copy (Task 4, `a night with no series link exports nothing and enqueues the series`).
4. A community that already has the VRDex series by title turns on import; the external series must link to it, not create a second series (Task 2, `links an existing series by title`).
5. A monthly last-Friday series on Discord must fall back to one-off nights, not fail the job every retry (Task 5, `falls back to one-offs for a last-weekday series`).

---

## File map

| File | Responsibility |
| --- | --- |
| `convex/_recurrenceRules.ts` (create) | Pure parse and format for Google RRULE and Discord `recurrence_rule`. |
| `convex/_eventSeriesSync.ts` (create) | `SeriesSyncFields`, `seriesHash`, `seriesSyncFields`, `enqueueSeriesSync`, `flagSeriesNights`. |
| `convex/eventSeriesSync.ts` (create) | Internal functions shared by both kinds and the migration; super-admin trigger. |
| `convex/schema.ts`, `convex/_eventConnectors.ts` (modify) | `eventSyncLinks.seriesId`, index `by_connectorId_seriesId`. |
| `convex/eventSync.ts`, `convex/eventSyncKinds/types.ts` (modify, plan 02) | Pick `exportSeries` for series jobs; write the series link and enqueue follow-up nights in `completeJob`. |
| `convex/eventSeries.ts`, `convex/_eventSeries.ts` (modify, plan 10) | Call `enqueueSeriesSync` after series writes. |
| `convex/_googleCalendar.ts`, `convex/eventSyncKinds/googleCalendar.ts`, `convex/googleCalendarConnector.ts` (modify, plan 08) | Google series import and export. |
| `convex/eventSyncKinds/discordScheduledEvents.ts` (modify, plan 07) | Discord series import and export. |
| `convex/migrations.ts` (modify) | `groupOccurrenceLinks`. |
| `docs/backend/event-schema.md`, `docs/deployment/convex-environments.md` (modify) | Recurring events and Connectors sections; flag scope. |
| Tests | `tests/backend/recurrence-rules.test.ts`, `tests/backend/_seriesSyncFixture.ts`, `tests/backend/event-series-sync.test.ts`, `tests/backend/google-calendar-series.test.ts`, `tests/backend/discord-scheduled-events-series.test.ts`, `tests/backend/group-occurrence-links.test.ts`. |

### Task 1: Rule mapping

**Files:**

- Create: `convex/_recurrenceRules.ts`
- Test: `tests/backend/recurrence-rules.test.ts`

**Interfaces:**

- Consumes: `SeriesRule` from `convex/_eventSeriesModel.ts` (plan 10); `DiscordRecurrenceRule` from `convex/_discordScheduledEventMap.ts` (plan 07).
- Produces:

```ts
export type RecurrenceAnchor = { date: string; timezone: string; startTime: string; endTime?: string }; // first night, local wall clock
export type ParsedRecurrence = { rule: SeriesRule; startsOn: string; endsOn?: string; count?: number };
export type DiscordRecurrenceWrite = Pick<DiscordRecurrenceRule, "start" | "frequency" | "interval" | "by_weekday" | "by_n_weekday" | "by_month" | "by_month_day">; // the client-writable subset
export function parseGoogleRecurrence(recurrence: string[], anchor: RecurrenceAnchor): ParsedRecurrence | null;
export function parseDiscordRecurrence(rule: DiscordRecurrenceWrite & Partial<DiscordRecurrenceRule>, anchor: RecurrenceAnchor): ParsedRecurrence | null;
export function formatGoogleRecurrence(rule: SeriesRule, endsOn?: string, count?: number, timezone?: string): string[];
export function formatDiscordRecurrence(rule: SeriesRule, start: string): DiscordRecurrenceWrite | null;
```

The brief's `parseGoogleRecurrence(rrule): SeriesRule | null` cannot fill `startTime` (an RRULE carries no time) or a weekly rule with no `BYDAY`; the anchor is the master's start, and the bounds come back beside the rule. `formatDiscordRecurrence` returns `null` for ordinal `-1`, which Discord cannot express, and never writes `end`, `count`, or `by_year_day`, which clients cannot set.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { formatDiscordRecurrence, formatGoogleRecurrence, parseDiscordRecurrence, parseGoogleRecurrence, type DiscordRecurrenceWrite } from "../../convex/_recurrenceRules";

const anchor = { date: "2026-11-07", timezone: "America/New_York", startTime: "20:00", endTime: "23:00" };
const times = { startTime: "20:00", endTime: "23:00" };
const weekly = { frequency: "weekly", weekday: 6, ...times } as const;
const fixed = [weekly, { ...weekly, frequency: "biweekly" }, ...[1, 2, 3, 4, -1].map((ordinal) => ({ ...weekly, frequency: "monthly_weekday", ordinal }))] as const;
const start = "2026-11-08T01:00:00.000Z";

it("parses the Google rules in the fixed set", () => {
  assert.deepEqual(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA"], anchor), { rule: weekly, startsOn: "2026-11-07" });
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SA"], anchor)?.rule.frequency, "biweekly");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY"], anchor)?.rule.weekday, 6);
  assert.deepEqual(parseGoogleRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=1SA"], anchor)?.rule, { frequency: "monthly_weekday", weekday: 6, ordinal: 1, ...times });
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=-1SA"], anchor)?.rule.ordinal, -1);
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"], anchor)?.endsOn, "2026-12-05");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261205"], anchor)?.endsOn, "2026-12-05");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=10"], anchor)?.count, 10);
});

it("returns null for Google rules outside the fixed set", () => {
  for (const recurrence of [[], ["RRULE:FREQ=DAILY"], ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"], ["RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=SA"],
    ["RRULE:FREQ=MONTHLY;BYDAY=5SA"], ["RRULE:FREQ=MONTHLY;BYDAY=SA"], ["RRULE:FREQ=MONTHLY;BYMONTHDAY=7"], ["RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1"],
    ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1SA"], ["RRULE:FREQ=YEARLY"], ["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=521"],
    ["RRULE:FREQ=WEEKLY;BYDAY=SA", "EXDATE;TZID=America/New_York:20261114T200000"], ["RRULE:FREQ=WEEKLY;BYDAY=SA", "RRULE:FREQ=WEEKLY;BYDAY=MO"]])
    assert.equal(parseGoogleRecurrence(recurrence, anchor), null, recurrence.join(" "));
});

it("formats each fixed rule as the RRULE Google emits and round-trips it", () => {
  assert.deepEqual(formatGoogleRecurrence(weekly), ["RRULE:FREQ=WEEKLY;BYDAY=SA"]);
  assert.deepEqual(formatGoogleRecurrence({ ...weekly, frequency: "biweekly" }), ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA"]);
  assert.deepEqual(formatGoogleRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: -1 }), ["RRULE:FREQ=MONTHLY;BYDAY=-1SA"]);
  assert.deepEqual(formatGoogleRecurrence(weekly, "2026-12-05", undefined, "America/New_York"), ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"]);
  assert.deepEqual(formatGoogleRecurrence(weekly, undefined, 10), ["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=10"]);
  for (const rule of fixed) assert.deepEqual(parseGoogleRecurrence(formatGoogleRecurrence(rule), anchor)?.rule, rule);
});

it("formats Discord rules and refuses the last weekday", () => {
  const none = { by_month: null, by_month_day: null };
  assert.deepEqual(formatDiscordRecurrence(weekly, start), { start, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, ...none });
  assert.deepEqual(formatDiscordRecurrence({ ...weekly, frequency: "biweekly" }, start), { start, frequency: 2, interval: 2, by_weekday: [5], by_n_weekday: null, ...none });
  assert.deepEqual(formatDiscordRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: 2 }, start), { start, frequency: 1, interval: 1, by_weekday: null, by_n_weekday: [{ n: 2, day: 5 }], ...none });
  assert.equal(formatDiscordRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: -1 }, start), null);
});

it("parses Discord rules in the fixed set and nothing else", () => {
  for (const rule of fixed.filter((r) => !("ordinal" in r) || r.ordinal !== -1))
    assert.deepEqual(parseDiscordRecurrence(formatDiscordRecurrence(rule, start)!, anchor)?.rule, rule);
  const base: DiscordRecurrenceWrite = { start, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, by_month: null, by_month_day: null };
  assert.equal(parseDiscordRecurrence({ ...base, end: "2026-12-06T04:59:59.000Z", count: 10 }, anchor)?.endsOn, "2026-12-05");
  for (const rule of [{ ...base, frequency: 3, by_weekday: [0, 1, 2, 3, 4] }, { ...base, by_weekday: [0, 4] }, { ...base, interval: 3 },
    { ...base, frequency: 1, by_weekday: null, by_n_weekday: [{ n: 5, day: 4 }] }, { ...base, frequency: 0, by_weekday: null, by_month: [11], by_month_day: [7] }])
    assert.equal(parseDiscordRecurrence(rule, anchor), null, JSON.stringify(rule));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/recurrence-rules.test.ts`
Expected: FAIL, cannot find module `convex/_recurrenceRules`.

- [ ] **Step 3: Implement the four functions in `convex/_recurrenceRules.ts`**

Field mappings:

| VRDex | Google RRULE | Discord `recurrence_rule` |
| --- | --- | --- |
| `weekly` | `FREQ=WEEKLY;BYDAY=XX` (no `INTERVAL`, or `INTERVAL=1`) | `frequency: 2`, `interval: 1`, `by_weekday: [d]` |
| `biweekly` | `FREQ=WEEKLY;INTERVAL=2;BYDAY=XX` | `frequency: 2`, `interval: 2`, `by_weekday: [d]` |
| `monthly_weekday`, ordinal `n` | `FREQ=MONTHLY;BYDAY=nXX`, `n` in `1..4` or `-1` | `frequency: 1`, `interval: 1`, `by_n_weekday: [{ n, day: d }]`, `n` in `1..4` |
| `weekday` (0 Sunday) | `SU MO TU WE TH FR SA` = 0..6 | `d = (weekday + 6) % 7` (Discord 0 Monday); back: `(d + 1) % 7` |
| `endsOn` | `UNTIL`: date form read as is; UTC form read as its local date in `anchor.timezone`; written as the UTC instant of `endsOn` 23:59:59 local in `timezone` (default `"UTC"`) | read from `end` the same way; never written |
| `count` | `COUNT`, `1..520` | read from `count`; never written |

Parse: exactly one recurrence line, prefixed `RRULE:`; keys outside `FREQ`, `INTERVAL`, `BYDAY`, `UNTIL`, `COUNT`, `WKST` return `null`; weekly with no `BYDAY` takes the anchor's weekday; rule times are the anchor's (`endTime` only when present); `startsOn` is `anchor.date`. Format writes keys in the order `FREQ`, `INTERVAL`, `BYDAY`, then `UNTIL` when `endsOn` is set, else `COUNT` (RFC 5545 forbids both; a series with both was ended, so `UNTIL` wins). Discord parse rejects any non-empty `by_month`, `by_month_day`, `by_year_day`, and a `by_weekday` or `by_n_weekday` that is not exactly one entry.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --conditions=import --import tsx --test tests/backend/recurrence-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_recurrenceRules.ts tests/backend/recurrence-rules.test.ts
git commit -m "feat(connectors): map Google and Discord recurrence rules to series rules" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Series links and the shared series sync

**Files:**

- Create: `convex/_eventSeriesSync.ts`, `convex/eventSeriesSync.ts`, `tests/backend/_seriesSyncFixture.ts`
- Modify: `convex/schema.ts`, `convex/_eventConnectors.ts` (link validator), `convex/eventSync.ts`, `convex/eventSyncKinds/types.ts`, `convex/eventSeries.ts` (`update`, `end`), `convex/_eventSeries.ts` (`createSeriesFromEvent`)
- Test: `tests/backend/event-series-sync.test.ts`

**Interfaces:**

- Consumes: Task 1; plan 10 `materializeSeries`, `fanOutSeriesEdit`, `retireOccurrences`; plan 02 `enqueueSyncJob`, `enqueueEventSync`.
- Schema: `eventSyncLinks.seriesId: v.optional(v.id("eventSeries"))`, index `by_connectorId_seriesId` `["connectorId", "seriesId"]`. A series link has `seriesId`, `externalId === externalSeriesId` (the master or scheduled event ID), and no `eventId`. A night link has `eventId`, `seriesId`, and `externalSeriesId`, written by import or by `tagNightLink`; the runner writes only `externalId`, `lastExportedAt`, `lastExportedHash`. Per the master convention, an `externalId` starting `none:` means no external copy (`none:` + eventId for a night, `none:` + seriesId for a series).
- Produces (`convex/_eventSeriesSync.ts`):

```ts
export type SeriesSyncFields = { title: string; summary: string | null; venueLabel: string | null; timezone: string; rule: SeriesRule; startsOn: string; endsOn?: string | null; count?: number | null }; // endsOn/count undefined: the source does not carry them
export const seriesSyncFieldsValidator; // v.object of the same shape
export function seriesSyncFields(series: Doc<"eventSeries">): SeriesSyncFields;
export function seriesHash(fields: SeriesSyncFields): string; // sha256 as carriedFieldsHash, stable key order, excludes startsOn
export async function enqueueSeriesSync(db: DatabaseWriter, scheduler: Scheduler, seriesId: Id<"eventSeries">): Promise<void>;
export async function flagSeriesNights(db: DatabaseWriter, connectorId: Id<"eventConnectors">, series: Doc<"eventSeries">, externalSeriesId: string, now: number): Promise<void>;
export const SERIES_EXPORT_KINDS = ["google_calendar", "discord_scheduled_events"] as const;
```

- Produces (`convex/eventSeriesSync.ts`):
  - `readSeriesLink` internalQuery `{ connectorId, seriesId?, externalSeriesId? }` returning the series link or `null`.
  - `applyExternalSeries` internalMutation `{ connectorId, externalSeriesId: v.string(), externalUpdatedAt: v.number(), deleted: v.boolean(), fields: v.optional(seriesSyncFieldsValidator) }` returning `{ outcome: "skipped" | "created" | "linked" | "updated" | "unchanged" | "echo" | "flagged"; seriesId?: Id<"eventSeries"> }`.
  - `seriesExportContext` internalQuery `{ connectorId, seriesId }` returning `{ series, seriesUrl: string, firstNight: Doc<"events"> | null, today: string }` (`seriesUrl` = `SITE_URL` + `/` + community slug + `/series/` + seriesId; `firstNight` = first published occurrence with `startAt > now`; `today` in `series.timezone`).
  - `tagNightLink` internalMutation `{ connectorId, eventId, externalId, seriesId?: Id<"eventSeries">, externalSeriesId?: string }`: sets or clears only `seriesId` and `externalSeriesId` on the night's link (`by_eventId`), inserting a `linked` link with `externalId` when none exists; the runner then writes the export fields.
  - `requestSeriesExport` internalMutation `{ seriesId }` calling `enqueueSeriesSync`, for kind actions.
- Produces (`convex/eventSyncKinds/types.ts`): `SyncKindHandler.exportSeries?(ctx: ActionCtx, connector: Doc<"eventConnectors">, series: Doc<"eventSeries">, link: Doc<"eventSyncLinks"> | null, job: Doc<"eventSyncJobs">): Promise<{ externalId: string }>` (master signature plus the trailing `job` every handler method receives).
- Produces (`tests/backend/_seriesSyncFixture.ts`, used by Tasks 2 to 6):

```ts
export const SERIES_FIELDS: SeriesSyncFields; // title "Bass Temple", summary "Weekly bass night.", venueLabel "The Temple", timezone "America/New_York", rule { frequency: "weekly", weekday: 6, startTime: "20:00", endTime: "23:00" }, startsOn "2026-11-07", endsOn null, count null
export const GUILD_ID = "123456789012345678";
export const seriesSyncModules; // plan 08's modules map plus eventSeries, eventSeriesSync, migrations
export function setupSeriesEnv(): void; // plan 08 setupEnv() plus VRDEX_RECURRING_EVENTS_ENABLED, VRDEX_CONNECTOR_DISCORD_SCHEDULED_EVENTS_ENABLED = "true", DISCORD_BOT_TOKEN = "bot-token"
export async function seedSeries(t, communityProfileId, authorityUserId, overrides?: Partial<Doc<"eventSeries">>): Promise<Id<"eventSeries">>; // SERIES_FIELDS as an active series, horizonDays 60, then internal.eventSeries.materialize
export async function clearJobs(t): Promise<void>; // deletes every eventSyncJobs row (materialisation enqueues one per night)
export async function seedDiscordConnector(t, options: { direction: ConnectorDirection; mode?: ConnectorMode }): ReturnType<typeof seedGoogleConnector>; // seedGoogleConnector, then patch kind "discord_scheduled_events", target { guildId: GUILD_ID }, credentialId undefined
export const applySeries = (t, connectorId, over?: Partial<{ externalUpdatedAt: number; deleted: boolean; fields: Partial<SeriesSyncFields> }>) => /* internal.eventSeriesSync.applyExternalSeries with externalSeriesId "m1", externalUpdatedAt Date.parse("2026-11-02T11:00:00.000Z"), deleted false, fields { ...SERIES_FIELDS, ...over.fields } */;
```

  With plan 08's `NOW` (Monday 2026-11-02) the 60-day window holds eight Saturdays, 2026-11-07 to 2026-12-26. Read nights with plan 10's `occurrence(t, seriesId, date)` and `occurrences(t, seriesId)` from `tests/backend/_eventSeriesFixture.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("external series", () => {
  beforeEach(setupSeriesEnv);
  const seriesLinks = (t) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect()).then((l) => l.filter((x) => x.eventId === undefined));

  it("creates one series, materialises its nights, and writes the series link", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const result = await applySeries(t, connectorId);
    const series = (await t.run((ctx) => ctx.db.get(result.seriesId!)))!;
    assert.equal(result.outcome, "created");
    assert.deepEqual([series.communityProfileId, series.authorityUserId, series.rule, series.startsOn, series.horizonDays], [communityProfileId, staffUserId, SERIES_FIELDS.rule, "2026-11-07", 60]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const [link] = await seriesLinks(t);
    assert.deepEqual([link.externalId, link.externalSeriesId, link.seriesId, link.lastExportedHash], ["m1", "m1", series._id, seriesHash(SERIES_FIELDS)]);
  });

  it("is unchanged on redelivery and fans a time edit out to nights that have not overridden it", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    assert.equal((await applySeries(t, connectorId)).outcome, "unchanged");
    const n21 = await occurrence(t, seriesId!, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { overrides: ["startAt"] }));
    const later = Date.parse("2026-11-02T11:45:00.000Z");
    const result = await applySeries(t, connectorId, { externalUpdatedAt: later, fields: { rule: { ...SERIES_FIELDS.rule, startTime: "21:00" } } });
    assert.equal(result.outcome, "updated");
    assert.equal((await occurrence(t, seriesId!, "2026-11-14")).startAt, Date.parse("2026-11-15T02:00:00.000Z"));
    assert.equal((await occurrence(t, seriesId!, "2026-11-21")).startAt, Date.parse("2026-11-22T01:00:00.000Z"));
  });

  it("flags the series link and every future night on deletion, and never ends the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    const result = await applySeries(t, connectorId, { externalUpdatedAt: Date.parse("2026-11-02T11:50:00.000Z"), deleted: true });
    assert.equal(result.outcome, "flagged");
    assert.equal((await t.run((ctx) => ctx.db.get(seriesId!)))!.state, "active");
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(links.length, 9);
    assert.ok(links.every((l) => l.state === "external_deleted"));
    assert.ok(links.some((l) => l.externalId === "m1:2026-11-07" && l.eventId));
  });

  it("links an existing series by title", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const existing = await seedSeries(t, communityProfileId, staffUserId, { title: "BASS TEMPLE" });
    const result = await applySeries(t, connectorId);
    assert.deepEqual([result.outcome, result.seriesId], ["linked", existing]);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 1);
  });

  it("skips export-only connectors", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "export" });
    assert.equal((await applySeries(t, connectorId)).outcome, "skipped");
  });

  it("enqueues one series job per series-capable export connector, once, and none with the flag off", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const seriesJobs = () => t.run((ctx) => ctx.db.query("eventSyncJobs").collect()).then((j) => j.filter((x) => x.eventId === undefined));
    await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
    await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
    assert.deepEqual((await seriesJobs()).map((j) => [j.connectorId, j.kind, j.payload]), [[connectorId, "export_upsert", { seriesId }]]);
    process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
    await clearJobs(t);
    await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
    assert.equal((await seriesJobs()).length, 0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-sync.test.ts`
Expected: FAIL, cannot find module `convex/eventSeriesSync`.

- [ ] **Step 3: Implement schema, helpers, internal functions, runner dispatch, and plan 10 wiring**

`applyExternalSeries` rules, in order:

1. Connector not `active`, or direction `export` or `off`: `skipped`.
2. Link by `by_connectorId_externalId(externalSeriesId)` with no `eventId`.
3. `deleted`: with a linked `seriesId`, set the link `external_deleted`, `flagSeriesNights`, return `flagged`; else `skipped`.
4. Link with `externalUpdatedAt >= externalUpdatedAt`: `unchanged`.
5. Fill `endsOn` and `count` that are `undefined` from the linked series. `seriesHash(fields) === link.lastExportedHash`: write `externalUpdatedAt`, return `echo`.
6. Linked: patch only changed fields, then follow plan 10 `update`'s order with its field mapping (`retireOccurrences` when rule or bounds changed, `fanOutSeriesEdit`, `enqueueEventSync(..., "upsert")` per changed night, `materializeSeries`), `enqueueSeriesSync`; set `lastExportedHash` to the new hash so the export back to this connector is a no-op; `updated`.
7. Unlinked: an `active` series in the community whose trimmed title matches case-insensitively is linked without applying anything (spec, Connecting: link, never overwrite on connect): `linked`. Otherwise insert the series (`authorityUserId: connector.authorityUserId`, `horizonDays: 60`, `state: "active"`), insert the series link, `materializeSeries` (its adoption picks up phase-one nights by title and date), `enqueueSeriesSync`: `created`.

Every outcome except `skipped` writes `lastImportedAt` and `externalUpdatedAt` on the series link.

`flagSeriesNights`: every occurrence with `startAt > now` gets its link on this connector set `external_deleted`; one with no link gets a new link `{ eventId, seriesId, externalSeriesId, externalId: externalSeriesId + ":" + occurrenceDate, state: "external_deleted" }`, so plan 04's staff-attention list shows it.

`enqueueSeriesSync`: no-op when `recurringEventsEnabled()` is false; else, for each connector of the series' community with kind in `SERIES_EXPORT_KINDS`, direction `export` or `bidirectional`, state `active`, and no `pending` or `running` job with no `eventId` and `payload.seriesId === seriesId` (read `by_connectorId_eventId_state`), `enqueueSyncJob(db, scheduler, { connectorId, kind: "export_upsert", payload: { seriesId } })`. The skip is what keeps two jobs from inserting two masters.

Runner (`convex/eventSync.ts`): plan 02 already routes a job with `payload.seriesId` and no `eventId` past the event checks; plan 11 adds only the method pick and the link write. Such an `export_upsert` loads the series and its series link (`by_connectorId_seriesId`, no `eventId`), computes `exportedHash = seriesHash(seriesSyncFields(series))` before the call, and calls `handler.exportSeries(ctx, connector, series, link, job)`; with the flag off or no `exportSeries` it completes as a no-op. `completeJob` for that job upserts the series link the same way it does a night link (`externalId`, `lastExportedAt`, `lastExportedHash: exportedHash`; on insert also `seriesId`, `externalSeriesId: externalId`, `state: "linked"`), then, unless the `externalId` starts `none:`, `enqueueSyncJob` an `export_upsert` for each occurrence with `startAt > now` that has a link on this connector not starting `none:`, a non-empty `overrides`, or `eventStatus === "cancelled"`.

Plan 10 wiring: call `enqueueSeriesSync` at the end of `createSeriesFromEvent` (covers the wizard, API, and MCP creates), `api.eventSeries.update`, and `api.eventSeries.end`.

- [ ] **Step 4: Run them to verify they pass, with plan 10's suites**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-sync.test.ts tests/backend/event-series-*.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/_eventConnectors.ts convex/_eventSeriesSync.ts convex/eventSeriesSync.ts convex/eventSync.ts convex/eventSyncKinds/types.ts convex/eventSeries.ts convex/_eventSeries.ts convex/_generated tests/backend/_seriesSyncFixture.ts tests/backend/event-series-sync.test.ts
git commit -m "feat(connectors): add series links and shared external series sync" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Google series import

**Files:**

- Modify: `convex/_googleCalendar.ts`, `convex/eventSyncKinds/googleCalendar.ts`, `convex/googleCalendarConnector.ts`
- Test: `tests/backend/google-calendar-series.test.ts`

**Interfaces:**

- Consumes: Tasks 1 and 2; plan 08 `listEvents` (it keeps `singleEvents=true`, so a poll delivers instances, each with `recurringEventId`), `fieldsFromGoogleEvent`, `applyImport`; `candidateFromConnectorFields` from `convex/_eventCandidateApply.ts`; plan 10 `recordOccurrenceOverrides`.
- Produces (`convex/_googleCalendar.ts`): `GoogleCalendarEvent` gains `recurrence?: string[]` and `originalStartTime?: GoogleEventDateTime`; `getEvent(token, calendarId, eventId): Promise<GoogleCalendarEvent | null>` (404 and 410 give `null`).
- Produces (`convex/eventSyncKinds/googleCalendar.ts`): `fetchExternalSeries(ctx: ActionCtx, connector: Doc<"eventConnectors">, externalSeriesId: string, masters?: Map<string, GoogleCalendarEvent | null>): Promise<ExternalSeries>` where `ExternalSeries = { externalSeriesId: string; externalUpdatedAt: number; deleted: boolean; fields: SeriesSyncFields | null }` (exported from `convex/_eventSeriesSync.ts`; `fields: null` means outside the fixed set or all-day).
- Produces (`convex/googleCalendarConnector.ts`): `internal.googleCalendarConnector.applyGoogleOccurrence` internalMutation `{ connectorId, seriesId, item: v.any(), calendarTimeZone: v.string() }` returning `"skipped" | "unchanged" | "flagged" | "cancel_echo"` or `applyEventCandidate`'s outcome unchanged.
- Fixture additions (`tests/backend/_seriesSyncFixture.ts`): `MASTER = googleItem({ id: "m1", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SA"] })`; `googleInstance(date, overrides?)` with `id` `"m1_" + UTC basic start` (2026-11-07 gives `m1_20261108T010000Z`), `recurringEventId: "m1"`, `originalStartTime` and `start` `{ dateTime: date + "T20:00:00-05:00", timeZone: "America/New_York" }`, `end` at `23:00`, `updated: "2026-11-02T11:00:00.000Z"`; `importGoogle(t, connectorId, item)` runs an `import_item` job with `{ item, calendarTimeZone: "America/New_York" }`; `masterFetch(master)` is a `fakeFetch` handler answering `GET .../events/m1` with `master` and every other request with 404.

- [ ] **Step 1: Write the failing tests**

```ts
describe("google series import", () => {
  beforeEach(setupSeriesEnv);
  const onlySeries = (t) => t.run((ctx) => ctx.db.query("eventSeries").collect()).then(([s]) => s);

  it("imports a weekly master as one series and links each instance to its night", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    await importGoogle(t, connectorId, googleInstance("2026-11-14"));
    fake.restore();
    const series = await onlySeries(t);
    assert.deepEqual([series.title, series.rule], ["Bass Temple", SERIES_FIELDS.rule]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const nightLinks = (await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).filter((l) => l.eventId);
    assert.deepEqual(nightLinks.map((l) => [l.externalId, l.seriesId, l.externalSeriesId, l.eventId]).sort(), [
      ["m1_20261108T010000Z", series._id, "m1", (await occurrence(t, series._id, "2026-11-07"))._id],
      ["m1_20261115T010000Z", series._id, "m1", (await occurrence(t, series._id, "2026-11-14"))._id],
    ]);
    assert.equal(fake.calls.length, 1);
  });

  it("imports an exception instance as overrides on its night only", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { summary: "Bass Temple Live", start: { dateTime: "2026-11-21T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    const series = await onlySeries(t);
    const n21 = await occurrence(t, series._id, "2026-11-21");
    assert.deepEqual([n21.title, n21.startAt, [...n21.overrides!].sort()], ["Bass Temple Live", Date.parse("2026-11-22T02:00:00.000Z"), ["startAt", "title"]]);
    assert.deepEqual((await occurrence(t, series._id, "2026-11-14")).overrides, []);
  });

  it("fans a master edit out and leaves overridden nights alone", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    await t.run(async (ctx) => ctx.db.patch((await occurrence(t, series._id, "2026-11-21"))._id, { overrides: ["startAt"] }));
    master = { ...MASTER, start: { dateTime: "2026-11-07T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:45:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { start: { dateTime: "2026-11-14T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:45:00.000Z" }));
    fake.restore();
    assert.equal((await onlySeries(t)).rule.startTime, "21:00");
    assert.equal((await occurrence(t, series._id, "2026-11-28")).startAt, Date.parse("2026-11-29T02:00:00.000Z"));
    assert.equal((await occurrence(t, series._id, "2026-11-21")).startAt, Date.parse("2026-11-22T01:00:00.000Z"));
    assert.deepEqual((await occurrence(t, series._id, "2026-11-14")).overrides, []);
  });

  it("applies an exception that arrives with a series edit", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    master = { ...MASTER, location: "The Big Temple", updated: "2026-11-02T11:45:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { location: "The Big Temple", updated: "2026-11-02T11:45:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-28", { location: "The Big Temple", summary: "Bass Temple Live", updated: "2026-11-02T11:40:00.000Z" }));
    fake.restore();
    const n28 = await occurrence(t, (await onlySeries(t))._id, "2026-11-28");
    assert.deepEqual([n28.title, n28.venueLabel, n28.overrides], ["Bass Temple Live", "The Big Temple", ["title"]]);
  });

  it("flags a single cancelled instance without touching the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-14"));
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { status: "cancelled", updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", (q) => q.eq("connectorId", connectorId).eq("externalId", "m1_20261115T010000Z")).collect());
    assert.equal(link.state, "external_deleted");
    assert.equal((await occurrence(t, (await onlySeries(t))._id, "2026-11-14")).eventStatus, "scheduled");
  });

  it("keeps phase-one expansion for a rule outside the fixed set, with the flag off, and in hold mode", async () => {
    for (const setup of [
      { master: { ...MASTER, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"] }, flag: "true", mode: "autopublish" },
      { master: MASTER, flag: "false", mode: "autopublish" },
      { master: MASTER, flag: "true", mode: "hold" },
    ] as const) {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: setup.mode });
      process.env.VRDEX_RECURRING_EVENTS_ENABLED = setup.flag;
      const fake = fakeFetch(masterFetch(setup.master));
      await importGoogle(t, connectorId, googleInstance("2026-11-07"));
      fake.restore();
      assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
      const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
      assert.deepEqual([link.externalId, link.externalSeriesId, link.seriesId], ["m1_20261108T010000Z", "m1", undefined]);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/google-calendar-series.test.ts`
Expected: FAIL, no `eventSeries` row after import.

- [ ] **Step 3: Implement `getEvent`, `fetchExternalSeries`, `applyGoogleOccurrence`, and the series branch of `importItem`**

`fetchExternalSeries`: master from `masters` or `getEvent`, cached either way. Missing or `status === "cancelled"` is `deleted: true`. Otherwise `fieldsFromGoogleEvent(master, "UTC", SITE_URL)` (a recurring master always carries `start.timeZone`, so the fallback zone never applies) gives the anchor (`eventDate`, `timezone`, `start.time`, `end?.time`) and the series fields; a null `timezone` or `start` (all-day), or `parseGoogleRecurrence` returning `null`, gives `fields: null`. `externalUpdatedAt = Date.parse(master.updated)`.

`importItem` series branch, in order; `importPoll` passes one `masters` map for the whole poll:

1. Flag off, no `item.recurringEventId`, or connector mode `hold`: plan 08 `applyImport`.
2. Read the series link for `item.recurringEventId`. When it is missing, or `Date.parse(item.updated) > link.externalUpdatedAt`: `fetchExternalSeries`. `deleted` with a linked series runs `applyExternalSeries` with `deleted: true` and stops. `fields: null` with a linked series also runs it with `deleted: true` (the source left the fixed set, so staff decide) and stops; with no linked series, plan 08 `applyImport`. Otherwise `applyExternalSeries`.
3. Series link now `linked` with a `seriesId`: `applyGoogleOccurrence`. Otherwise plan 08 `applyImport`.

`applyGoogleOccurrence`, in order:

1. Night by `by_seriesId_occurrenceDate` on the local date of `item.originalStartTime` (in its `timeZone`, else `calendarTimeZone`); none: `skipped`.
2. Upsert the night link by `by_connectorId_externalId(item.id)` with `eventId`, `seriesId`, `externalSeriesId: item.recurringEventId`.
3. `externalUpdatedAt >= updated`: `unchanged`. `status === "cancelled"`: link `external_deleted`, `flagged` (night already cancelled: `cancel_echo`).
4. `applyEventCandidate` with `candidateFromConnectorFields("google_calendar", fields, { kind: "update", slug: night.slug })`, the link, and `externalUpdatedAt` only when the night's `overrides` is non-empty; it runs the echo and stale guards itself. Passing no `externalUpdatedAt` for a night without overrides switches its stale guard off on purpose: such a night has no night edit on VRDex to protect, and its `updatedAt` may come from this poll's own fan-out. Then `recordOccurrenceOverrides(db, before, after, false)` on the re-read night; return its outcome. Write `lastImportedAt` and `externalUpdatedAt` on the link.

- [ ] **Step 4: Run them to verify they pass, with plan 08's suite**

Run: `node --conditions=import --import tsx --test tests/backend/google-calendar-series.test.ts tests/backend/google-calendar-connector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_googleCalendar.ts convex/eventSyncKinds/googleCalendar.ts convex/googleCalendarConnector.ts convex/_eventSeriesSync.ts tests/backend/_seriesSyncFixture.ts tests/backend/google-calendar-series.test.ts
git commit -m "feat(connectors): import Google recurring events as series" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Google series export

**Files:**

- Modify: `convex/_googleCalendar.ts`, `convex/eventSyncKinds/googleCalendar.ts`
- Test: `tests/backend/google-calendar-series.test.ts`

**Interfaces:**

- Consumes: Tasks 1 to 3 (`tagNightLink`, `requestSeriesExport`, `seriesExportContext`); plan 08 `insertEvent`, `patchEvent`, `deleteEvent`, `googleBodyFromEvent`, `exportContext`. Kinds return `{ externalId }`; plan 02's runner writes the link.
- Produces (`convex/_googleCalendar.ts`): `listInstances(token, calendarId, eventId, params: { timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>` (`GET .../events/{eventId}/instances`); `insertEvent` and `patchEvent` accept `GoogleEventBody & { recurrence?: string[] }`.
- Produces (`convex/eventSyncKinds/googleCalendar.ts`): `googleCalendarHandler.exportSeries`; `googleSeriesBody(series: Doc<"eventSeries">, seriesUrl: string): GoogleEventBody & { recurrence: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("google series export", () => {
  beforeEach(setupSeriesEnv);
  const exported = (body: unknown) => Response.json({ id: "m1", updated: "2026-11-02T12:00:01.000Z", ...(body as object) });

  it("exports one recurring master, then patches only the overridden night's instance", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    const fake = fakeFetch(({ method, url, body }) => url.pathname.endsWith("/instances")
      ? Response.json({ items: [googleInstance("2026-11-14"), googleInstance("2026-11-21")] })
      : exported(body));
    await clearJobs(t);
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    const insert = fake.calls.find((c) => c.method === "POST")!.body as GoogleEventBody & { recurrence: string[] };
    assert.deepEqual([insert.summary, insert.recurrence, insert.start], ["Bass Temple", ["RRULE:FREQ=WEEKLY;BYDAY=SA"], { dateTime: "2026-11-08T01:00:00.000Z", timeZone: "America/New_York" }]);
    assert.equal(insert.description.split("\n").at(-1), `${SITE}/basic-nights/series/${seriesId}`);
    const nightJobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.eventId && j.state === "pending");
    assert.deepEqual(nightJobs.map((j) => j.eventId), [n21._id]);
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.method === "POST").length, 1);
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    assert.deepEqual([patch.url.pathname, (patch.body as GoogleEventBody).summary], ["/calendar/v3/calendars/cal-1/events/m1_20261122T010000Z", "Bass Temple Live"]);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId ?? null, l.seriesId ?? null, l.externalSeriesId ?? null]), [
      ["m1", null, seriesId, "m1"], ["m1_20261122T010000Z", n21._id, seriesId, "m1"], ["none:" + n14._id, n14._id, null, null]]);
  });

  it("patches UNTIL when the series ends and does nothing on an unchanged rerun", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeFetch(({ body }) => exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    assert.equal(fake.calls.length, 1);
    await t.run((ctx) => ctx.db.patch(seriesId, { state: "ended", endsOn: "2026-12-05" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    const patch = fake.calls.at(-1)!;
    assert.deepEqual([patch.method, patch.url.pathname, (patch.body as { recurrence: string[] }).recurrence],
      ["PATCH", "/calendar/v3/calendars/cal-1/events/m1", ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"]]);
  });

  it("a night with no series link exports nothing and enqueues the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await clearJobs(t);
    const fake = fakeFetch(() => new Response("", { status: 500 }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    const pending = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.state === "pending");
    assert.deepEqual(pending.map((j) => j.payload), [{ seriesId }]);
  });

  it("retracts a standalone copy once the series exists", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const standalone = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: "standalone-14", state: "linked", lastExportedHash: "old", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(({ method, body }) => method === "DELETE" ? new Response("", { status: 204 }) : exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual(fake.calls.filter((c) => c.method !== "POST").map((c) => [c.method, c.url.pathname]), [["DELETE", "/calendar/v3/calendars/cal-1/events/standalone-14"]]);
    const after = (await t.run((ctx) => ctx.db.get(standalone)))!;
    assert.deepEqual([after.externalId, after.state], ["none:" + n14._id, "linked"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/google-calendar-series.test.ts`
Expected: FAIL, no `POST` with `recurrence`.

- [ ] **Step 3: Implement `listInstances`, `googleSeriesBody`, `exportSeries`, and the series branch of `exportUpsert`**

`googleSeriesBody`: `summary` title, `description` `summary + "\n\n" + seriesUrl` (or `seriesUrl` alone), `location` `venueLabel ?? ""`, `status: "confirmed"`, `start`/`end` from `occurrenceTimes(series, first)` where `first = occurrenceDates(series, series.startsOn, startsOn + 31 days)[0]` with `timeZone: series.timezone` (Google requires the zone on a recurring master; no `endTime` repeats the start, as plan 08 does), `recurrence: formatGoogleRecurrence(series.rule, series.endsOn, series.count, series.timezone)`.

`exportSeries(ctx, connector, series, link, job)`: a link whose `lastExportedHash === seriesHash(seriesSyncFields(series))` returns `{ externalId: link.externalId }` with no request. With a link, `patchEvent(link.externalId)`. Without one, a night link of this series on this connector that carries `externalSeriesId` (a phase-one import of the same master) supplies the master ID to patch; otherwise `insertEvent`. Return `{ externalId: masterId }`; the runner writes the series link and enqueues the follow-up nights (Task 2). A removed or ended series is the same patch: plan 10's `end` sets `endsOn`, so the body's `UNTIL` ends it.

`exportUpsert` for an event, in order (flag off: plan 08 unchanged):

An instance link is the night's own link whose `externalSeriesId` equals the series link's `externalId`; `none:` is the master's "write nothing" return, `{ externalId: "none:" + event._id }`.

1. Event without `seriesId` whose link has a `seriesId` (detached by plan 10's end): `tagNightLink` clearing both tags, then export through plan 08 with `link = null`, since `UNTIL` removes the instance the link pointed at.
2. Event with `seriesId` and no series link on this connector (or one starting `none:`): `requestSeriesExport`, return `none:`.
3. Own link that is neither `none:` nor an instance link (a standalone copy): `deleteEvent` it and continue as if there were no link; the runner overwrites its `externalId` with whatever this call returns.
4. No instance link, `overrides` empty, and not `cancelled`: return `none:`.
5. Instance ID from the instance link, else `listInstances(master, eventDate - 1 day, eventDate + 2 days)` matched on the local date of `originalStartTime` in `series.timezone` equal to `occurrenceDate`; no match (deleted on Google): `console.warn`, return `none:`. `patchEvent(instanceId, googleBodyFromEvent(event, eventUrl))` (a VRDex-cancelled night patches `status: "cancelled"`, which is how Google cancels one instance), `tagNightLink` with `seriesId` and `externalSeriesId: master`, return `{ externalId: instanceId }`.

- [ ] **Step 4: Run them to verify they pass, with plan 08's suite**

Run: `node --conditions=import --import tsx --test tests/backend/google-calendar-series.test.ts tests/backend/google-calendar-connector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_googleCalendar.ts convex/eventSyncKinds/googleCalendar.ts convex/eventSeriesSync.ts tests/backend/google-calendar-series.test.ts
git commit -m "feat(connectors): export series to Google as recurring events with exceptions" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Discord scheduled event series

**Files:**

- Modify: `convex/eventSyncKinds/discordScheduledEvents.ts`
- Test: `tests/backend/discord-scheduled-events-series.test.ts`

**Interfaces:**

- Consumes: Tasks 1 and 2 (`tagNightLink`, `requestSeriesExport`, `seriesExportContext`); plan 07's `discordScheduledEventsHandler` (`exportUpsert`, `exportDelete`, `importItem`), `getExportState`, `liveExternalId`, and from `convex/_discordScheduledEventMap.ts` `parseScheduledEvent`, `scheduledEventToFields`, `toScheduledEventBody`, `DiscordScheduledEvent`, `ScheduledEventJobPayload`; `discordRequest`. Kinds return `{ externalId }`; plan 02's runner writes the link.
- Produces (`convex/eventSyncKinds/discordScheduledEvents.ts`): the plan 07 handler gains `exportSeries`; `fetchExternalSeries(ctx, connector, externalSeriesId): Promise<ExternalSeries>` (`GET /guilds/{guildId}/scheduled-events/{id}`; 404 is `deleted: true`); `seriesFromScheduledEvent(event: DiscordScheduledEvent, timezone: string): ExternalSeries | null` (`null` when `recurrence_rule` is null).
- Fixture additions: `discordSeriesEvent(overrides?): DiscordScheduledEvent` = `{ id: "900000000000000001", guild_id: GUILD_ID, name: "Bass Temple", description: "Weekly bass night.", scheduled_start_time: "2026-11-08T01:00:00+00:00", scheduled_end_time: "2026-11-08T04:00:00+00:00", entity_type: 3, entity_metadata: { location: "The Temple" }, status: 1, privacy_level: 2, recurrence_rule: { start: "2026-11-08T01:00:00+00:00", end: null, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null } }`; `importDiscord(t, connectorId, action, event)` runs an `import_item` job with the `ScheduledEventJobPayload` `{ action, event, receivedAt: NOW }`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("discord scheduled event series", () => {
  beforeEach(setupSeriesEnv);
  const api = "/api/v10/guilds/123456789012345678/scheduled-events";
  const created = (body: unknown, id = "900000000000000001") => Response.json({ ...(body as object), id });

  it("exports one recurring scheduled event and a one-off for an overridden night", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    let next = 1;
    const fake = fakeFetch(({ body }) => created(body, `90000000000000000${next++}`));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    const [series, oneOff] = fake.calls;
    assert.equal(fake.calls.length, 2);
    assert.deepEqual([series.method, series.url.pathname], ["POST", api]);
    const body = series.body as { name: string; scheduled_start_time: string; recurrence_rule: unknown };
    assert.deepEqual([body.name, body.scheduled_start_time], ["Bass Temple", "2026-11-08T01:00:00.000Z"]);
    assert.deepEqual(body.recurrence_rule, { start: "2026-11-08T01:00:00.000Z", frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, by_month: null, by_month_day: null });
    assert.deepEqual([(oneOff.body as { name: string }).name, "recurrence_rule" in (oneOff.body as object)], ["Bass Temple Live", false]);
  });

  it("cancels the Discord series when the series ends", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeFetch(({ body }) => created(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await t.run((ctx) => ctx.db.patch(seriesId, { state: "ended", endsOn: "2026-11-02" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    const last = fake.calls.at(-1)!;
    assert.deepEqual([last.method, last.url.pathname, (last.body as { status: number }).status], ["PATCH", `${api}/900000000000000001`, 4]);
  });

  it("falls back to one-offs for a last-weekday series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId, { rule: { frequency: "monthly_weekday", weekday: 6, ordinal: -1, startTime: "20:00", endTime: "23:00" } });
    const fake = fakeFetch(({ body }) => created(body));
    const seriesJob = await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    const night = (await occurrences(t, seriesId))[0];
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: night._id });
    fake.restore();
    assert.equal(seriesJob.state, "done");
    assert.equal(fake.calls.length, 1);
    assert.equal("recurrence_rule" in (fake.calls[0].body as object), false);
  });

  it("imports a weekly recurring scheduled event as one series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    await importDiscord(t, connectorId, "create", discordSeriesEvent());
    const [series] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    assert.deepEqual([series.title, series.rule.frequency, series.endsOn], ["Bass Temple", "weekly", undefined]);
    const starts = (await occurrences(t, series._id)).map((n) => n.startAt);
    assert.ok(starts.includes(Date.parse("2026-11-08T01:00:00.000Z")) && starts.includes(Date.parse("2026-11-15T01:00:00.000Z")));
    await importDiscord(t, connectorId, "update", discordSeriesEvent({ status: 4 }));
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).find((l) => !l.eventId)!.state, "external_deleted");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-scheduled-events-series.test.ts`
Expected: FAIL, no `recurrence_rule` in the first request.

- [ ] **Step 3: Implement the Discord series branches**

Import (`importItem`; flag off, mode `hold`, or `recurrence_rule === null` keeps plan 07): `seriesFromScheduledEvent` takes `title`, `summary`, `venueLabel` from `scheduledEventToFields(event, null)` and `parseDiscordRecurrence` with the anchor `{ date, startTime, endTime }` read from `recurrence_rule.start` and the scheduled times in `timezone`, leaving `endsOn` and `count` undefined (not carried). `timezone` is the linked series' zone, else `"UTC"`, matching plan 07's reading of unlinked items. `fields: null` takes plan 07's phase-one path. Action `delete` or `status: 4` is `deleted: true`. Call `applyExternalSeries` with `externalSeriesId = event.id` and `externalUpdatedAt = Date.now()`; Discord sends no update time, so the series hash is the echo guard.

`exportSeries(ctx, connector, series, link, job)`, from `seriesExportContext`; "live" is `liveExternalId(link) !== null`:

1. `state !== "active"`, `endsOn <= today`, or no `firstNight`: a live link gets `PATCH {status: 4}` and returns `{ externalId: link.externalId }`; otherwise return `{ externalId: "none:" + series._id }`.
2. `formatDiscordRecurrence(series.rule, firstNight start ISO)` is `null`: return `{ externalId: "none:" + series._id }` (nights export one by one, rule 1 below).
3. Body: `toScheduledEventBody` on `getExportState(firstNight)`'s source with the series' `title`, `summary`, `venueLabel`, and `occurrenceTimes(series, firstNight.occurrenceDate)` laid over it, plus `recurrence_rule`. Hash and link rules as Google's `exportSeries` (same hash: return the link's ID; `PATCH` a live link, else adopt a night link's `externalSeriesId`, else `POST`); return `{ externalId: discordId }`.

`exportUpsert` for a night with `seriesId` (flag off: plan 07 unchanged); "write nothing" returns `{ externalId: "none:" + event._id }`:

1. Rule not formattable for Discord (`ordinal: -1`): plan 07 unchanged.
2. No series link, or one starting `none:`: `requestSeriesExport`, return `none:`.
3. `overrides` intersects `title`, `summary`, `venueLabel`, `startAt`, `endAt`: plan 07's `exportUpsert` (the one-off), returned as is.
4. Otherwise a live own link (an earlier one-off or phase-one copy): plan 07's `exportDelete(ctx, connector, link, job)`, return `none:`. No live link: return `none:`.

- [ ] **Step 4: Run them to verify they pass, with plan 07's suite**

Run: `node --conditions=import --import tsx --test tests/backend/discord-scheduled-events-series.test.ts tests/backend/event-discord-scheduled-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/discordScheduledEvents.ts tests/backend/_seriesSyncFixture.ts tests/backend/discord-scheduled-events-series.test.ts
git commit -m "feat(connectors): round-trip series with Discord scheduled events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Grouping migration and docs

**Files:**

- Modify: `convex/migrations.ts`, `convex/eventSeriesSync.ts`, `docs/backend/event-schema.md`, `docs/deployment/convex-environments.md`
- Test: `tests/backend/group-occurrence-links.test.ts`

**Interfaces:**

- Consumes: both kinds' `fetchExternalSeries`; `seriesOverridesFor`, `materializeSeries`.
- Produces:
  - `internal.migrations.groupOccurrenceLinks` internalAction `{ connectorId: v.id("eventConnectors") }` returning `{ grouped: string[]; unparseable: string[] }`.
  - `internal.eventSeriesSync.occurrenceLinkGroups` internalQuery `{ connectorId }` returning `Array<{ externalSeriesId: string; eventIds: Id<"events">[] }>` over `linked` links with `eventId` and `externalSeriesId` and no `seriesId`.
  - `internal.eventSeriesSync.groupLinks` internalMutation `{ connectorId, externalSeriesId, externalUpdatedAt, fields: seriesSyncFieldsValidator, eventIds }`.
  - `api.eventSeriesSync.groupOccurrenceLinksForConnector` mutation `{ connectorId }`: super-admin only, gated like `requireStatisticsAdmin` in `convex/groupObservations.ts` (`requireActiveBrowserSessionSubject`, then `getAccountFeatureAccess(...).superAdmin`, else `Error("Super-admin access is required.")`); schedules the migration with `runAfter(0)`.

- [ ] **Step 1: Write the failing test**

```ts
describe("groupOccurrenceLinks", () => {
  beforeEach(setupSeriesEnv);

  it("groups phase-one nights into a series, records overrides, leaves unmappable groups, and is idempotent", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const nights = [];
    for (const [date, summary] of [["2026-11-07", "Weekly bass night."], ["2026-11-14", "Special"], ["2026-11-21", "Weekly bass night."]] as const) {
      const startAt = Date.parse(`${date}T20:00:00-05:00`);
      const eventId = await seedEvent(t, communityProfileId, { slug: `bass-temple-${date}`, eventDate: date, startAt, endAt: startAt + 10_800_000, summary });
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: googleInstance(date).id, externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
      nights.push(eventId);
    }
    const other = await seedEvent(t, communityProfileId, { title: "Other Night", slug: "other-night", eventDate: "2026-11-09", startAt: Date.parse("2026-11-09T20:00:00-05:00") });
    const otherLink = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: other, externalId: "m2_20261110T010000Z", externalSeriesId: "m2", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/events/m1") ? Response.json(MASTER)
      : url.pathname.endsWith("/events/m2") ? Response.json({ ...MASTER, id: "m2", summary: "Other Night", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"] })
      : new Response("", { status: 404 }));
    const first = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    const second = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    fake.restore();
    assert.deepEqual([first, second], [{ grouped: ["m1"], unparseable: ["m2"] }, { grouped: [], unparseable: ["m2"] }]);
    const [series, ...more] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    assert.equal(more.length, 0);
    const grouped = await t.run((ctx) => Promise.all(nights.map((id) => ctx.db.get(id))));
    assert.deepEqual(grouped.map((e) => [e!.seriesId, e!.occurrenceDate, e!.overrides]), [
      [series._id, "2026-11-07", []], [series._id, "2026-11-14", ["summary"]], [series._id, "2026-11-21", []]]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(links.filter((l) => !l.eventId && l.seriesId === series._id && l.externalId === "m1").length, 1);
    assert.equal(links.filter((l) => l.externalSeriesId === "m1" && l.eventId && l.seriesId === series._id).length, 3);
    assert.equal((await t.run((ctx) => ctx.db.get(otherLink)))!.seriesId, undefined);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/group-occurrence-links.test.ts`
Expected: FAIL, `groupOccurrenceLinks` is not a function.

- [ ] **Step 3: Implement the migration, `occurrenceLinkGroups`, `groupLinks`, and the trigger**

The action dispatches `fetchExternalSeries` by `connector.kind` (`google_calendar`, `discord_scheduled_events`; any other kind returns `{ grouped: [], unparseable: [] }`); `deleted` or `fields: null` lands in `unparseable`. `groupLinks`: a series link for `externalSeriesId` already present returns (idempotent); else insert the series as `applyExternalSeries` step 7 does, attach each event whose `seriesId` is unset (`seriesId`, `occurrenceDate: eventDate`, `overrides: await seriesOverridesFor(db, series, event, eventDate)`), set `seriesId` on each night link, insert the series link with `lastExportedHash = seriesHash(fields)`, then `materializeSeries` (it skips dates that now exist). The migration is not `migrations.define`: it needs `fetch`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --conditions=import --import tsx --test tests/backend/group-occurrence-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the docs**

`docs/backend/event-schema.md`, plan 10's `## Recurring events` section: a `### Connector series` subsection covering the series link shape (`seriesId`, `externalId === externalSeriesId`, no `eventId`) and night links; the fixed-set mapping table from Task 1; import (Google master fetched per series change, instances linked to nights by original start date, exceptions recorded as overrides, master edits fanned out, `hold` and unmappable rules expanded as before); deletion flags and never ends; export (one master or scheduled event, Google instance patches for overridden or cancelled nights, `UNTIL` on end, Discord cancel on end); every ceiling in Global Constraints, labelled `Current recommendation`; the grouping migration and its super-admin trigger. Plan 02's `## Connectors` section: replace the phase-one "Recurring items" text with a pointer to that subsection and the rule that expansion remains for rules outside the fixed set and when the flag is off. `docs/deployment/convex-environments.md`: the `VRDEX_RECURRING_EVENTS_ENABLED` entry also switches connector series import and export.

- [ ] **Step 6: Full verification**

Run: `pnpm exec markdownlint-cli2 docs/backend/event-schema.md docs/deployment/convex-environments.md && pnpm typecheck:backend && pnpm test:backend && pnpm verify:docs`
Expected: PASS, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add convex/migrations.ts convex/eventSeriesSync.ts convex/_generated docs/backend/event-schema.md docs/deployment/convex-environments.md tests/backend/group-occurrence-links.test.ts
git commit -m "feat(connectors): group phase-one occurrence links into series" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
