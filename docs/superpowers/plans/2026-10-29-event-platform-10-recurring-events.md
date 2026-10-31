# Recurring Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly night is one `eventSeries` row that owns the schedule and series-owned fields, with real `events` occurrences materialised sixty days ahead, editable per night or per series.

**Architecture:** Pure date generation and wall-clock resolution live in `convex/_eventSeries.ts`; occurrences are inserted through the same record helper as `createCommunityEvent`, so slugs, short links, search documents, and audit rows are identical. Series edits fan out field by field to future occurrences that have not overridden that field; night edits record overrides inside the shared `updateCommunityEventRecord`. Every occurrence write ends with plan 02's `enqueueEventSync`.

**Tech Stack:** Convex (mutations, scheduler, crons), `convex-test` with `node:test`, Next.js app router, Zod in `@vrdex/api-contracts`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-recurring-events-design.md`. Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md` (Recurrence section). Depends on plan 02 for `enqueueEventSync(db, scheduler, eventId, change)` in `convex/_eventSync.ts`.

## Global Constraints

- Master plan Global Constraints apply in full (no em-dash or `--` in public strings, no AI mention, commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, markdownlint, no bare angle-bracket placeholders in `docs/`).
- Flag `VRDEX_RECURRING_EVENTS_ENABLED` (Convex), default off, compared with `=== "true"`. Off: the Repeats control is hidden, `repeat` on API and MCP is rejected with `Recurring events are not enabled.`, `api.eventSeries.create` and `update` throw the same, and the cron materialises nothing.
- `horizonDays` is written as `60` on every new series.
- Rules are only `weekly`, `biweekly`, `monthly_weekday`; `weekday` is `0..6` with `0` Sunday; `ordinal` is `1 | 2 | 3 | 4 | -1`; times are `HH:MM` local wall-clock in the series `timezone`; `count` is `1..520`; `endsOn` is not before `startsOn`.
- DST rule: a rule start time that does not exist on a date skips that occurrence and returns the date in `skipped`; an ambiguous time takes the earlier instant. Resolution uses `resolveEventLocalTime` from `packages/api-contracts/src/event-intake.ts`.
- Past occurrences (`startAt <= now`) are never created, changed, unpublished, or detached.
- Nothing is hard-deleted. Ending unpublishes to `draft_private` or detaches.
- Public copy, verbatim from the spec table, needs BASIC's approval before merge: `Repeats`, `Does not repeat`, `Weekly`, `Every two weeks`, `Monthly`, `Ends`, `Part of a series.`, `Edit this night`, `Edit the series`, `Reset to series`, `Upcoming nights`. Two existing approved strings are reused: `Add to calendar` on the series page and `Save changes` in the series editor. The occurrence page's series link reuses `Upcoming nights` as its label; say so in the PR.
- Every new public string ships in a PR whose description lists it and cites the spec copy table.
- The daily materialiser cron is unattended, so a failed materialisation calls plan 02's `notifyOps(ctx, { key, subject, body })` from `convex/_opsAlerts.ts` with key `series_materialize_failed:` followed by the series ID (Task 2).

## Review Focus

1. A staffer re-saving a night without changing anything (the editor resubmits every field) must not record overrides. Pinned in Task 6.
2. A series converted from an event on the fifth Friday of a month with "Monthly" must mean "last Friday", not fail. Pinned in Task 4.
3. A night that ends after midnight (`endTime` earlier than `startTime`) must end on the next day, and doors later than start belong to the previous day. Pinned in Task 2.
4. An event already owned by another series, or with a different title, on a series date must not be adopted. Pinned in Task 3.
5. Converting an event whose date is already past must not backfill earlier occurrences. Pinned in Task 4.

---

### Task 1: Series schema and occurrence dates

**Files:**

- Create: `convex/_eventSeriesModel.ts`
- Create: `convex/_eventSeries.ts`
- Modify: `convex/schema.ts` (new `eventSeries` table near `events` at line 1200; three fields on `events`)
- Test: `tests/backend/event-series-dates.test.ts`

**Interfaces:**

- Produces (`convex/_eventSeriesModel.ts`, a leaf module importing only `convex/values`):
  - `seriesFrequencyValidator`, `seriesOrdinalValidator`, `eventSeriesRuleValidator` (`{ frequency, weekday: v.number(), ordinal?, startTime: v.string(), endTime?: v.string(), doorsTime?: v.string() }`), `seriesRepeatValidator` (`{ frequency, weekday?: v.number(), ordinal?, endsOn?: v.string(), count?: v.number() }`).
  - `type SeriesRule`, `type SeriesRepeat` via `Infer`.
  - `SERIES_HORIZON_DAYS = 60`.
  - `SERIES_OWNED_EVENT_FIELDS = ["title", "summary", "timezone", "venueLabel", "worldSlug", "mediaLinks", "watchMode", "watchSurfaceEnabled", "bannerImageUrl", "thumbnailImageUrl", "sourceUrl", "startAt", "doorsOpenAt", "endAt"] as const` and `type SeriesOwnedEventField`.
  - `recurringEventsEnabled(): boolean`, `requireRecurringEventsEnabled(): void` (throws `Error("Recurring events are not enabled.")`).
- Produces (`convex/_eventSeries.ts`): `occurrenceDates(series: Pick<Doc<"eventSeries">, "rule" | "startsOn" | "endsOn" | "count">, from: string, to: string): string[]`; `validateSeriesRule(rule: SeriesRule): void` (throws on the bounds in Global Constraints).
- Schema: `eventSeries` exactly as the master contract, plus `worldSlug: v.optional(v.string())` (the spec lists world as series-owned; the master field list omits it); `mediaLinks` reuses the `events.mediaLinks` validator shape; `state: v.union(v.literal("active"), v.literal("ended"), v.literal("removed"))`. Indexes `by_communityProfileId_state` `["communityProfileId", "state"]` and `by_state` `["state"]` (the daily cron reads active series across communities). `events` gains `seriesId: v.optional(v.id("eventSeries"))`, `occurrenceDate: v.optional(v.string())`, `overrides: v.optional(v.array(v.string()))` and index `by_seriesId_occurrenceDate` `["seriesId", "occurrenceDate"]`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { occurrenceDates } from "../../convex/_eventSeries";

const rule = (r: object) => ({ startTime: "20:00", ...r }) as never;
const friday = { frequency: "weekly", weekday: 5 };

it("weekly emits each matching weekday inside the window", () => {
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30" }, "2026-10-30", "2026-11-27"),
    ["2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-29" }, "2026-10-29", "2026-11-06"), ["2026-10-30", "2026-11-06"]);
});
it("biweekly stays anchored to startsOn, not to the window", () => {
  assert.deepEqual(occurrenceDates({ rule: rule({ frequency: "biweekly", weekday: 5 }), startsOn: "2026-10-30" }, "2026-11-01", "2026-12-31"),
    ["2026-11-13", "2026-11-27", "2026-12-11", "2026-12-25"]);
});
it("monthly_weekday picks the nth and the last weekday", () => {
  const monthly = (ordinal: number) => ({ rule: rule({ frequency: "monthly_weekday", weekday: 5, ordinal }), startsOn: "2026-11-01" });
  assert.deepEqual(occurrenceDates(monthly(2), "2026-11-01", "2027-01-31"), ["2026-11-13", "2026-12-11", "2027-01-08"]);
  assert.deepEqual(occurrenceDates(monthly(-1), "2026-11-01", "2027-01-31"), ["2026-11-27", "2026-12-25", "2027-01-29"]);
});
it("count counts from startsOn and endsOn is inclusive", () => {
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30", count: 3 }, "2026-11-06", "2027-01-01"), ["2026-11-06", "2026-11-13"]);
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30", endsOn: "2026-11-13" }, "2026-10-30", "2026-12-31"),
    ["2026-10-30", "2026-11-06", "2026-11-13"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-dates.test.ts`
Expected: FAIL, cannot find module `convex/_eventSeries`.

- [ ] **Step 3: Implement the schema, `_eventSeriesModel.ts`, `occurrenceDates`, and `validateSeriesRule`**

Pure UTC calendar arithmetic on `YYYY-MM-DD` strings (`Date.UTC`, `getUTCDay`); never local `Date`. Generate from `startsOn` forward so `count` and the biweekly anchor are independent of `from`; stop at `min(to, endsOn)` or after `count` dates.

- [ ] **Step 4: Run test and the schema check**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-dates.test.ts && pnpm typecheck:backend`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/_eventSeriesModel.ts convex/_eventSeries.ts tests/backend/event-series-dates.test.ts
git commit -m "feat(events): add eventSeries schema and occurrence dates" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Materialiser, wall-clock times, stream programme copy, cron, flag

**Files:**

- Modify: `convex/_eventSeries.ts`
- Create: `convex/eventSeries.ts`
- Modify: `convex/events.ts` (export `insertCommunityEventRecord` at line 1170, add its `occurrence` option)
- Modify: `convex/crons.ts`
- Modify: `docs/deployment/convex-environments.md` (document `VRDEX_RECURRING_EVENTS_ENABLED`: Convex, all deployments, owner BASIC, default off, no secret so no rotation; turning it off stops new series and the cron but leaves existing occurrences as plain events)
- Create: `tests/backend/_eventSeriesFixture.ts`
- Test: `tests/backend/event-series-materialize.test.ts`

**Interfaces:**

- Consumes: Task 1 exports; `enqueueEventSync` (plan 02); `insertCommunityEventRecord`, `getOrCreateEventMediaProgram`-adjacent tables `eventMediaPrograms` and `eventMediaOutputs`; `eventOutputIsAuthorized` from `convex/_eventOutputSetup.ts`; `sanitizeEventDraftInput` from `convex/_eventInputs.ts`.
- Produces (`convex/_eventSeries.ts`):
  - `occurrenceTimes(series: Pick<Doc<"eventSeries">, "rule" | "timezone">, date: string): { startAt: number; doorsOpenAt?: number; endAt?: number } | null` (null when the start does not exist).
  - `seriesAuthSubject(series: Doc<"eventSeries">): AuthSubject` returning `{ tokenIdentifier: "series:" + series._id, issuer: "vrdex-series", subject: series.authorityUserId, displayName: "VRDex" }`.
  - `materializeSeries(ctx: MutationCtx, seriesId: Id<"eventSeries">, now: number): Promise<{ created: Id<"events">[]; adopted: Id<"events">[]; skipped: string[] }>`.
- Consumes (plan 02): `notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void>` and `resolveOps(ctx: MutationCtx | ActionCtx, key: string): Promise<void>` from `convex/_opsAlerts.ts`.
- Produces (`convex/eventSeries.ts`):
  - `materialize = internalMutation({ args: { seriesId: v.id("eventSeries") } })` returning the `materializeSeries` result (no-op `{ created: [], adopted: [], skipped: [] }` when the flag is off or `state !== "active"`).
  - `listActiveSeriesIds = internalQuery({ args: {} })` returning `Id<"eventSeries">[]` from `by_state` `active`.
  - `createMaterializeAll(alerts: { notify: typeof notifyOps; resolve: typeof resolveOps })` returning an `internalAction({ args: {} })` that, when the flag is on, runs `ctx.runMutation(internal.eventSeries.materialize, { seriesId })` for each active series one at a time; a throw is caught, the loop continues, and `alerts.notify(ctx, { key: "series_materialize_failed:" + seriesId, subject: "Series materialisation failed", body: seriesId + ": " + message })` is awaited; a success awaits `alerts.resolve(ctx, "series_materialize_failed:" + seriesId)` (a no-op inside `resolveOps` unless that key is alerting, so it is called on every success). `export const materializeAll = createMaterializeAll({ notify: notifyOps, resolve: resolveOps })`. The factory is the fake-sender seam, the same pattern as `createScheduleEventMediaWorker` in `convex/events.ts`.
  - `isEnabled = query({ args: {} })` returning `recurringEventsEnabled()`.
- Produces (`convex/events.ts`): `export async function insertCommunityEventRecord(ctx: MutationCtx, options)` (plan 02 Task 4 already changed the first parameter to `ctx` and put the trailing `enqueueEventSync(..., "upsert")` inside it) where `options` gains `occurrence?: { seriesId: Id<"eventSeries">; occurrenceDate: string }`, written into the insert with `overrides: []`.
- Produces (`tests/backend/_eventSeriesFixture.ts`, shared by every later backend test in this plan):
  - `seriesModules`: the `event-api-ownership.test.ts` modules map plus `convex/eventSeries.ts` and `convex/eventSync.ts`.
  - `loadEventSeriesWithNotifier(sent: Array<{ key: string; subject: string; body: string }>, resolved: string[])`: a module loader for `convex/eventSeries.ts` that spreads the real module and replaces `materializeAll` with `createMaterializeAll({ notify: async (_ctx, alert) => { sent.push(alert); }, resolve: async (_ctx, key) => { resolved.push(key); } })`, like `tests/backend/_eventCapacityFixture.ts`.
  - `seedSeriesCommunity(t)` returning `owner = { profileId, userId, identity }` for the owner of published community `faceless` (copy `seedOwnedCommunity` from `event-api-ownership.test.ts`), and `seedUser(t, name)` for a stranger.
  - `insertSeries(t, owner, fields?: Partial<Doc<"eventSeries">>)` with defaults `{ communityProfileId: owner.profileId, authorityUserId: owner.userId, title: "Harbor Night", timezone: "America/New_York", rule: { frequency: "weekly", weekday: 5, startTime: "20:00" }, startsOn: "2026-11-06", horizonDays: 60, state: "active", createdAt: NOW, updatedAt: NOW }`.
  - `createApiEvent(t, owner, fields)` calling `internal.events.createCommunityEventForApiOwner` with `actorKind: "personal_api_token"`, `communitySlug: "faceless"`, returning its result.
  - Readers over `by_seriesId_occurrenceDate`: `occurrence(t, seriesId, date)` (throws when missing), `occurrenceOrNull(t, seriesId, date)`, `occurrences(t, seriesId)`; `slotsFor(t, eventId)` over `eventSlots.by_eventId`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-series-materialize.test.ts; each test: process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true"; test.mock.timers.enable({ apis: ["Date"], now: NOW })
it("creates Fridays to the 60 day horizon with rule times and series fields", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z"); series rule { weekly, 5, startTime "22:00", doorsTime "21:30", endTime "02:00" }, summary "Weekly", venueLabel "Harbor", sourceUrl "https://example.com/harbor"
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.equal(result.created.length, 8); // 2026-11-06 .. 2026-12-25
  const first = await occurrence(t, seriesId, "2026-11-06");
  assert.equal(first.startAt, Date.parse("2026-11-07T03:00:00Z"));
  assert.equal(first.doorsOpenAt, Date.parse("2026-11-07T02:30:00Z"));
  assert.equal(first.endAt, Date.parse("2026-11-07T07:00:00Z")); // ends next local day
  assert.deepEqual([first.summary, first.venueLabel, first.sourceUrl, first.publicationState], ["Weekly", "Harbor", "https://example.com/harbor", "published"]);
  assert.deepEqual([first.posterImageUrl, first.notes, first.overrides], [undefined, undefined, []]);
  assert.ok(first.slug); // short link and slug created by insertCommunityEventRecord
});
it("is idempotent on seriesId plus occurrenceDate", async () => {
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  const again = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual([again.created.length, again.adopted.length], [0, 0]);
  assert.equal((await occurrences(t, seriesId)).length, 8);
});
it("skips and reports a nonexistent local start", async () => {
  // NOW = Date.parse("2027-03-01T12:00:00Z"); rule { weekly, weekday 0, startTime "02:30" }, startsOn "2027-03-07"
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.skipped, ["2027-03-14"]);
  assert.equal(result.created.length, 7);
  assert.equal(await occurrenceOrNull(t, seriesId, "2027-03-14"), null);
});
it("takes the earlier instant for an ambiguous local start", async () => {
  // NOW = Date.parse("2027-11-01T12:00:00Z"); rule { weekly, weekday 0, startTime "01:30" }, startsOn "2027-11-07"
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.equal((await occurrence(t, seriesId, "2027-11-07")).startAt, Date.parse("2027-11-07T05:30:00Z"));
});
it("copies the latest occurrence's stream programme and authorized outputs, not its sources", async () => {
  // seed: occurrence 2026-11-06 with eventMediaPrograms { state: "ready", publicLinks: [link] } and one vrcdn output
  // { key: "main", label: "Main", state: "ready", credential: { storage: "operator_secret_store", secretRef: "vrcdn/main" } }
  // and one eventMediaSources row; bindVrcdnTestAccount(profileId, "vrcdn/main")
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  const copy = await programFor(t, await occurrence(t, seriesId, "2026-11-13"));
  assert.equal(copy.program.state, "ready");
  assert.deepEqual(copy.outputs.map(o => [o.key, o.label]), [["main", "Main"]]);
  assert.equal(copy.program.currentOutputId, copy.outputs[0]!._id);
  assert.equal(copy.sources.length, 0);
});
it("the cron alerts ops on a failed series, still materialises the others, and resolves on recovery", async () => {
  const sent: Array<{ key: string; subject: string; body: string }> = [];
  const resolved: string[] = [];
  const t = convexTest(schema, { ...seriesModules, "../../convex/eventSeries.ts": () => loadEventSeriesWithNotifier(sent, resolved) });
  const owner = await seedSeriesCommunity(t); // NOW = Date.parse("2026-10-30T12:00:00Z")
  const good = await insertSeries(t, owner);
  const broken = await insertSeries(t, owner, { timezone: "Not/AZone" }); // resolveEventLocalTime throws a RangeError
  await t.action(internal.eventSeries.materializeAll, {});
  assert.deepEqual(sent.map(alert => alert.key), [`series_materialize_failed:${broken}`]);
  assert.match(sent[0]!.body, new RegExp(broken));
  assert.equal((await occurrences(t, good)).length, 8);
  assert.equal((await occurrences(t, broken)).length, 0);
  assert.ok(resolved.includes(`series_materialize_failed:${good}`));
  assert.ok(!resolved.includes(`series_materialize_failed:${broken}`));
  await t.run(ctx => ctx.db.patch(broken, { timezone: "America/New_York" }));
  await t.action(internal.eventSeries.materializeAll, {});
  assert.equal(sent.length, 1);
  assert.ok(resolved.includes(`series_materialize_failed:${broken}`));
  assert.equal((await occurrences(t, broken)).length, 8);
});
it("does nothing when the flag is off", async () => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  assert.equal((await t.mutation(internal.eventSeries.materialize, { seriesId })).created.length, 0);
});
```

`programFor(t, event)` is local to this file: the program via `eventMediaPrograms.by_eventId_updatedAt`, its outputs via `eventMediaOutputs.by_programId_key`, sources via `eventMediaSources.by_eventId_state`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-materialize.test.ts`
Expected: FAIL, `internal.eventSeries` is undefined.

- [ ] **Step 3: Implement `occurrenceTimes`**

Start: `resolveEventLocalTime(date, { time: rule.startTime }, timezone)`, empty means null, otherwise index 0. Doors: `dayOffset: -1` when `doorsTime > startTime`. End: `dayOffset: 1` when `endTime <= startTime`. A nonexistent doors or end time omits that field on that night.

- [ ] **Step 4: Implement `materializeSeries`, the `occurrence` option, and the programme copy**

Window: `from` = later of `startsOn` and `eventDateForInstant(now, timezone)`; `to` = `eventDateForInstant(now + horizonDays * 86_400_000, timezone)`. A date whose resolved `startAt <= now` (tonight, already started) is not created. Per date: skip if `by_seriesId_occurrenceDate` has a row (any state); else `adoptStandaloneEvent` (Task 3; until then a stub returning `null`); else `occurrenceTimes`, null goes to `skipped` with `console.warn("series occurrence skipped", { seriesId, date })`; else build an `EventDraftInput` from series fields, `sanitizeEventDraftInput`, resolve the world by `series.worldSlug` the way `createCommunityEventForApiOwnerRecord` does, call `insertCommunityEventRecord(ctx, ...)` with `submitter: seriesAuthSubject(series)`, `publicationState: "published"`, `actorSurface: "system"`, `occurrence: { seriesId, occurrenceDate: date }`; skip creation when the community is no longer published. Created occurrences are already enqueued by the record helper; only an adopted event (patched directly, not through a record helper) gets `enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert")`.

Programme template: the series occurrence with the greatest `occurrenceDate` that has an `eventMediaPrograms` row. Copy into a new program: `mediaSettings`, `broadcastPolicy`, `communityProfileId`, `publicLinks`, `directFallbackLinks`; copy each template output that passes `eventOutputIsAuthorized(newEvent, output)` with `key, type, accountModel, label, region, credential, vrcdnSetup, twitchSetup, simulcastEnabled, compliance, playbackLinks`, `state: output.state === "active" ? "ready" : output.state`. Program `state` is `"ready"` when the copy of `template.currentOutputId` is `ready`, else `"draft"`; `currentOutputId` points at that copy. Sources, scenes, sessions, commands are not copied (slot-bound, night-owned). Copy happens once at creation; later template changes are not fanned out (spec ceiling).

- [ ] **Step 5: Implement `convex/eventSeries.ts` functions and the cron**

`crons.daily("materialize event series", { hourUTC: 6, minuteUTC: 20 }, internal.eventSeries.materializeAll, {})`. Each series runs in its own mutation so one failure rolls back only that series and the alert is sent outside the failed transaction. Mark the loop with `// ponytail: sequential runMutation per active series; fan out with the scheduler if the daily run nears the action time limit`.

- [ ] **Step 6: Wire the failure alert**

`materializeAll` catches each per-series failure and awaits `alerts.notify`, and awaits `alerts.resolve` after each success, as specified in Interfaces; the fake-sender test in Step 1 proves the key, the body carrying the series ID, that the other series still materialise, and that the recovered series resolves without a second alert. Dedup (one email per key per six hours) is `notifyOps`'s job, not this cron's.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-materialize.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add convex/_eventSeries.ts convex/eventSeries.ts convex/events.ts convex/crons.ts docs/deployment/convex-environments.md tests/backend/_eventSeriesFixture.ts tests/backend/event-series-materialize.test.ts
git commit -m "feat(events): materialise series occurrences to a 60 day horizon" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Adoption of standalone events

**Files:**

- Modify: `convex/_eventSeries.ts`
- Test: `tests/backend/event-series-adoption.test.ts`

**Interfaces:**

- Consumes: `occurrenceTimes`, `SERIES_OWNED_EVENT_FIELDS`, `linkedPublishedEventWorld` from `convex/events.ts`.
- Produces:
  - `seriesOverridesFor(db: DatabaseReader, series: Doc<"eventSeries">, event: Doc<"events">, date: string): Promise<SeriesOwnedEventField[]>` returning sorted field names whose event value differs from the series value. Normalise before comparing: missing string equals `""`, missing `mediaLinks` equals `[]`, missing `watchMode` equals `"event_stream"`, missing `watchSurfaceEnabled` equals `false`; times compare against `occurrenceTimes(series, date)`; `worldSlug` compares against the linked published world's slug.
  - `adoptStandaloneEvent(db: DatabaseWriter, series: Doc<"eventSeries">, date: string): Promise<Id<"events"> | null>`: candidates from `events.by_communityProfileId_eventDate` (`communityProfileId`, `eventDate === date`) with `seriesId === undefined`, `moderationRemovedAt === undefined`, `publicationState === "published"`, `eventStatus === "scheduled"`, and `title.trim().toLowerCase() === series.title.trim().toLowerCase()`; first match is patched with `seriesId`, `occurrenceDate: date`, `overrides: await seriesOverridesFor(...)`, `updatedAt`. Contributed events qualify (spec).

- [ ] **Step 1: Write the failing test**

```ts
it("adopts a same-day same-title event and records differing fields as overrides", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z")
  const standalone = await createApiEvent(t, owner, { title: "harbor night", startAt: Date.parse("2026-11-07T02:00:00Z"), timezone: "America/New_York", summary: "Special edition" });
  const other = await createApiEvent(t, owner, { title: "Other Night", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York" });
  const claimed = await createApiEvent(t, owner, { title: "Harbor Night", startAt: Date.parse("2026-11-14T01:00:00Z"), timezone: "America/New_York" });
  const otherSeries = await insertSeries(t, owner);
  await t.run(ctx => ctx.db.patch(claimed.eventId, { seriesId: otherSeries, occurrenceDate: "2026-11-13", overrides: [] }));
  const seriesId = await insertSeries(t, owner, { summary: "Weekly" }); // title "Harbor Night", Fridays 20:00
  const result = await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(result.adopted, [standalone.eventId]);
  const adopted = await t.run(ctx => ctx.db.get(standalone.eventId));
  assert.deepEqual([adopted!.seriesId, adopted!.occurrenceDate, adopted!.overrides], [seriesId, "2026-11-06", ["startAt", "summary", "title"]]);
  assert.equal((await t.run(ctx => ctx.db.get(other.eventId)))!.seriesId, undefined);
  assert.equal((await t.run(ctx => ctx.db.get(claimed.eventId)))!.seriesId, otherSeries);
  assert.equal((await occurrences(t, seriesId)).length, 8); // 11-13 gets a fresh occurrence beside the other series' event
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-adoption.test.ts`
Expected: FAIL, `adopted` is empty.

- [ ] **Step 3: Implement `seriesOverridesFor` and `adoptStandaloneEvent`, and replace the Task 2 stub**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-adoption.test.ts tests/backend/event-series-materialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventSeries.ts tests/backend/event-series-adoption.test.ts
git commit -m "feat(events): adopt matching standalone events into a series" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Create a series from an event (wizard and "Repeats" conversion)

**Files:**

- Modify: `convex/_eventSeries.ts`
- Modify: `convex/eventSeries.ts`
- Test: `tests/backend/event-series-create.test.ts`

**Interfaces:**

- Consumes: `materializeSeries`, `validateSeriesRule`, `resolveClubActor` and `requireClubPermission` from `convex/_clubAccess.ts`, `getEventBySlug` and `validateEventSlug` as used in `convex/events.ts`.
- Produces:
  - `createSeriesFromEvent(ctx: MutationCtx, event: Doc<"events">, repeat: SeriesRepeat, authorityUserId: Id<"users">, now: number): Promise<{ seriesId: Id<"eventSeries">; created: number }>`. Requires `event.publicationState === "published"`, `scheduleKind !== "date_only"`, `timezone` set, `seriesId === undefined`, else throws `Error("Only a published timed event can repeat.")`. Derives `startsOn` = `event.eventDate`; `weekday` from that date; `ordinal` for `monthly_weekday` = `repeat.ordinal ?? (day >= 29 ? -1 : Math.ceil(day / 7))`; rule times from `startAt`, `doorsOpenAt`, `endAt` formatted `HH:MM` in `timezone`; series fields copied from the event (world from `linkedPublishedEventWorld`). A supplied `repeat.weekday` or `repeat.ordinal` that does not match the derived value throws `Error("Repeat weekday must match the event's start day.")`. Patches the event as the first occurrence (`seriesId`, `occurrenceDate: startsOn`, `overrides: []`), then `materializeSeries`.
  - `create = mutation({ args: { eventSlug: v.string(), repeat: seriesRepeatValidator } })` returning `{ seriesId, created }`: `requireRecurringEventsEnabled()`, resolve the event, `requireClubPermission(await resolveClubActor(ctx, event.communityProfileId), "manage_events")`, authority = `requireUser(ctx).userId`.

- [ ] **Step 1: Write the failing tests**

```ts
it("turns an existing event into the first occurrence of a weekly series", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z"); event "Harbor Night", startAt Date.parse("2026-11-07T01:00:00Z"), America/New_York, summary "Weekly", one slot
  const { seriesId, created } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  assert.equal(created, 7);
  const series = await t.run(ctx => ctx.db.get(seriesId));
  assert.deepEqual([series!.title, series!.rule, series!.startsOn, series!.horizonDays], ["Harbor Night", { frequency: "weekly", weekday: 5, startTime: "20:00" }, "2026-11-06", 60]);
  const first = await t.run(ctx => ctx.db.get(event.eventId));
  assert.deepEqual([first!.seriesId, first!.occurrenceDate, first!.overrides], [seriesId, "2026-11-06", []]);
  assert.equal((await slotsFor(t, event.eventId)).length, 1);
  const second = await occurrence(t, seriesId, "2026-11-13");
  assert.equal(second.startAt, Date.parse("2026-11-14T01:00:00Z"));
  assert.equal((await slotsFor(t, second._id)).length, 0);
});
it("reads a fifth weekday as the last weekday for Monthly", async () => {
  // event on Friday 2027-01-29 20:00 America/New_York
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "monthly_weekday" } });
  assert.equal((await t.run(ctx => ctx.db.get(seriesId)))!.rule.ordinal, -1);
});
it("does not backfill before today when the source event is past", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z"); event on Friday 2026-10-23 20:00 America/New_York
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  const dates = (await occurrences(t, seriesId)).map(e => e.occurrenceDate).sort();
  assert.deepEqual(dates.slice(0, 2), ["2026-10-23", "2026-10-30"]);
});
it("rejects a non-manager and a draft event", async () => {
  // stranger = seedUser(t, "Stranger"); draft = api.events.createCommunityEvent as owner with published: false

  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } }), /access/);
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: draft.slug, repeat: { frequency: "weekly" } }), /Only a published timed event can repeat/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-create.test.ts`
Expected: FAIL, `api.eventSeries.create` is undefined.

- [ ] **Step 3: Implement `createSeriesFromEvent` and `create`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-create.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventSeries.ts convex/eventSeries.ts tests/backend/event-series-create.test.ts
git commit -m "feat(events): create a series from a published event" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Ending and retiring occurrences

**Files:**

- Modify: `convex/events.ts` (extract the body of `setCommunityEventPublished`, line 3479)
- Modify: `convex/_eventSeries.ts`
- Modify: `convex/eventSeries.ts`
- Test: `tests/backend/event-series-end.test.ts`

**Interfaces:**

- Produces (`convex/events.ts`): `export async function applyEventPublicationState(ctx: MutationCtx, event: Doc<"events">, publicationState: Doc<"events">["publicationState"], actor: AuthSubject, actorSurface: Doc<"eventAuditEvents">["actorSurface"], now: number): Promise<void>` holding the existing patch, `syncPreservedEventAssociations`, `reindexEventSearchDocument`, and audit lines, plus plan 02's `enqueueEventSync(..., "upsert")` from the changed branch (it turns an unpublish into a delete itself); `setCommunityEventPublished` keeps its validation and calls it, so that handler still ends in exactly one enqueue.
- Produces (`convex/_eventSeries.ts`): `retireOccurrences(ctx: MutationCtx, series: Doc<"eventSeries">, now: number): Promise<{ unpublished: Id<"events">[]; detached: Id<"events">[] }>`. Scope: occurrences of the series with `startAt > now`, published, whose date is not in `occurrenceDates(series, date, date)` or every one when `state !== "active"`. Rule: `overrides` empty and no `eventLineupEntries` and no `eventSlots` rows means `applyEventPublicationState(..., "draft_private", seriesAuthSubject(series), "system", now)` keeping `seriesId` (so materialisation never recreates that date), with no extra enqueue since the helper carries it; otherwise patch `seriesId: undefined, occurrenceDate: undefined, overrides: undefined` and `enqueueEventSync(..., "upsert")`.
- Produces (`convex/eventSeries.ts`): `end = mutation({ args: { seriesId: v.id("eventSeries"), state: v.optional(v.union(v.literal("ended"), v.literal("removed"))) } })`: gate as `create`; sets `state` (default `"ended"`) and `endsOn = eventDateForInstant(now, timezone)`; then `retireOccurrences`.

- [ ] **Step 1: Write the failing test**

```ts
it("unpublishes bare future nights and detaches customised ones", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z"); series converted with api.eventSeries.create, Fridays 2026-11-06 .. 2026-12-25
  const [n13, n20, n27] = await Promise.all(["2026-11-13", "2026-11-20", "2026-11-27"].map(d => occurrence(t, seriesId, d)));
  await t.run(async ctx => {
    await ctx.db.patch(n13._id, { overrides: ["summary"], summary: "Special" });
    await ctx.db.insert("eventLineupEntries", { eventId: n20._id, clientKey: "a", position: 0, performerLabel: "Aurora", updatedAt: NOW });
  });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.end, { seriesId });
  const [overridden, withLineup, bare] = (await t.run(ctx => Promise.all([n13, n20, n27].map(e => ctx.db.get(e._id))))).map(e => e!);
  assert.deepEqual([overridden.publicationState, overridden.seriesId], ["published", undefined]);
  assert.deepEqual([withLineup.publicationState, withLineup.seriesId], ["published", undefined]);
  assert.deepEqual([bare.publicationState, bare.seriesId], ["draft_private", seriesId]);
  const series = await t.run(ctx => ctx.db.get(seriesId));
  assert.deepEqual([series!.state, series!.endsOn], ["ended", "2026-10-30"]);
  assert.equal((await t.mutation(internal.eventSeries.materialize, { seriesId })).created.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-end.test.ts`
Expected: FAIL, `api.eventSeries.end` is undefined.

- [ ] **Step 3: Extract `applyEventPublicationState`, implement `retireOccurrences` and `end`**

- [ ] **Step 4: Run the new test and the existing publication tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-end.test.ts tests/backend/event-foundation.test.ts tests/backend/event-api-ownership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/events.ts convex/_eventSeries.ts convex/eventSeries.ts tests/backend/event-series-end.test.ts
git commit -m "feat(events): end a series without deleting its nights" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Series edit fan-out, night overrides, reset

**Files:**

- Modify: `convex/_eventSeries.ts`
- Modify: `convex/eventSeries.ts`
- Modify: `convex/events.ts` (`updateCommunityEventRecord`, line 1255)
- Test: `tests/backend/event-series-edit.test.ts`

**Interfaces:**

- Consumes: `syncPreservedEventAssociations`, `reconcileEventMediaScheduleChange`, `replaceEventWorldLink` from `convex/events.ts`; `reindexEventSearchDocument` from `convex/_searchDocuments.ts`; `normalizeEventSchedule`, `eventDateForInstant` from `convex/_eventSchedule.ts`; `createEventSortTitle` from `convex/_eventInputs.ts`; `retireOccurrences`.
- Produces (`convex/_eventSeries.ts`):
  - `applySeriesFields(db: DatabaseWriter, series: Doc<"eventSeries">, event: Doc<"events">, fields: SeriesOwnedEventField[], now: number): Promise<boolean>`: sets each field from the series (times from `occurrenceTimes(series, event.occurrenceDate!)`, `title` also sets `sortTitle`, `startAt` also renormalises `eventDate`/`sortAt`). When `startAt` moves by `delta`, every `eventSlots` row of the event moves `startAt` and `endAt` by `delta`; then `reconcileEventMediaScheduleChange`, `syncPreservedEventAssociations` (all three true), `reindexEventSearchDocument`. Never touches `overrides`. Returns whether anything changed.
  - `fanOutSeriesEdit(db: DatabaseWriter, series: Doc<"eventSeries">, changedFields: SeriesOwnedEventField[]): Promise<Id<"events">[]>`: for each occurrence with `startAt > Date.now()`, applies `changedFields` minus that occurrence's `overrides`; returns changed IDs. Caller enqueues sync.
  - `recordOccurrenceOverrides(db: DatabaseWriter, before: Doc<"events">, after: Doc<"events">, worldChanged: boolean): Promise<void>`: unions into `after.overrides` every series-owned field whose value changed between `before` and `after` (same normalisation as `seriesOverridesFor`), plus `worldSlug` when `worldChanged`.
- Produces (`convex/eventSeries.ts`):
  - `update = mutation({ args: { seriesId, title?, summary?: string | null, timezone?, venueLabel?: string | null, worldSlug?: string | null, mediaLinks?, watchMode?, watchSurfaceEnabled?, bannerImageUrl?: string | null, thumbnailImageUrl?: string | null, sourceUrl?: string | null, rule?: eventSeriesRuleValidator, endsOn?: string | null, count?: number | null } })` returning `{ seriesId, changed: SeriesOwnedEventField[] }`. Order: flag, gate, validate, patch series, `retireOccurrences` when `rule`, `endsOn`, or `count` changed, `fanOutSeriesEdit` with the mapped fields (rule `startTime` maps to `startAt`, `doorsTime` to `doorsOpenAt`, `endTime` to `endAt`; `timezone` maps to itself plus all three times), `enqueueEventSync(..., "upsert")` per returned ID, `materializeSeries`.
  - `resetOverride = mutation({ args: { eventId: v.id("events"), field: v.string() } })`: gate on the event's community; `field` must be in `SERIES_OWNED_EVENT_FIELDS` and in `overrides`; removes it from `overrides`, `applySeriesFields` for that one field, `enqueueEventSync(..., "upsert")`.
- `updateCommunityEventRecord` change: when `event.seriesId` is set, re-read the event after the existing patch and call `recordOccurrenceOverrides(db, event, updated, updateFields.has("worldSlug") && world?.slug !== previousWorldSlug)`. This one call covers the browser `updateCommunityEvent` and the API and MCP owner update paths.

- [ ] **Step 1: Write the failing tests**

```ts
it("fans a series edit to future nights, honours overrides, shifts slots, leaves the past", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z"); series converted from Harbor Night, summary "Weekly", Fridays 20:00 America/New_York
  // n13, n20 = occurrence(t, seriesId, "2026-11-13" | "2026-11-20"); pastOccurrence = n13 without _id, _creationTime, slug
  let past!: Id<"events">;
  await t.run(async ctx => {
    await ctx.db.insert("eventSlots", { eventId: n13._id, position: 0, startAt: Date.parse("2026-11-14T02:00:00Z"), displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Harbor", confidence: 1, reviewState: "confirmed", updatedAt: NOW });
    await ctx.db.patch(n20._id, { summary: "Special", overrides: ["summary"] });
    past = await ctx.db.insert("events", { ...pastOccurrence, seriesId, occurrenceDate: "2026-10-23", startAt: Date.parse("2026-10-24T00:00:00Z"), summary: "Old" });
  });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "New", rule: { frequency: "weekly", weekday: 5, startTime: "21:00" } });
  const [a, b, p] = await t.run(ctx => Promise.all([ctx.db.get(n13._id), ctx.db.get(n20._id), ctx.db.get(past)]));
  assert.deepEqual([a!.summary, a!.startAt], ["New", Date.parse("2026-11-14T02:00:00Z")]);
  assert.equal((await slotsFor(t, n13._id))[0]!.startAt, Date.parse("2026-11-14T03:00:00Z"));
  assert.deepEqual([b!.summary, b!.startAt], ["Special", Date.parse("2026-11-21T02:00:00Z")]);
  assert.deepEqual([p!.summary, p!.startAt], ["Old", Date.parse("2026-10-24T00:00:00Z")]);
});
it("a night edit records only fields that actually changed", async () => {
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, { currentSlug: n13.slug!, title: n13.title, summary: n13.summary });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, []);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, { currentSlug: n13.slug!, summary: "One-off" });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, ["summary"]);
});
it("reset copies the series value back and clears the override", async () => {
  await t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "summary" });
  const reset = await t.run(ctx => ctx.db.get(n13._id));
  assert.deepEqual([reset!.summary, reset!.overrides], ["Weekly", []]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-edit.test.ts`
Expected: FAIL, `api.eventSeries.update` is undefined.

- [ ] **Step 3: Implement `applySeriesFields`, `fanOutSeriesEdit`, `recordOccurrenceOverrides`, `update`, `resetOverride`, and the `updateCommunityEventRecord` hook**

`convex/events.ts` and `convex/_eventSeries.ts` import each other; keep every cross import a function used inside a function body (no top-level evaluation), as `convex/_eventIntake.ts` already does with `./events`.

- [ ] **Step 4: Run the series tests and the existing editor-path tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-*.test.ts tests/backend/event-lineup-preservation.test.ts tests/backend/event-slot-identity.test.ts tests/backend/hosted-mcp-event-writes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventSeries.ts convex/eventSeries.ts convex/events.ts tests/backend/event-series-edit.test.ts
git commit -m "feat(events): fan out series edits and record night overrides" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: `repeat` on the API and MCP owner create paths

**Files:**

- Modify: `packages/api-contracts/src/schemas.ts` (`ApiEventCreateRequestSchema` line 620, `ApiEventUpdateRequestSchema` line 691, `ApiEventWriteResponseSchema` line 735)
- Modify: `convex/events.ts` (`createCommunityEventForApiOwner` line 3040, `createCommunityEventForMcpOwner` line 3066)
- Modify: `convex/_mcpWriteReceipts.ts` (`McpEventWriteResult` line 50 and its validator)
- Regenerate: `docs/api/openapi.json`, `docs/api/openapi.yaml`
- Modify: `docs/developers/vrdex-mcp-event-writes.md` (`vrdex_event_create` section), `docs/developers/api-changelog.md`
- Test: `tests/backend/event-series-api.test.ts`

**Interfaces:**

- Consumes: `createSeriesFromEvent`, `requireRecurringEventsEnabled`, `seriesRepeatValidator`.
- Produces:
  - `ApiEventCreateRequestSchema` gains `repeat: z.object({ frequency: z.enum(["weekly", "biweekly", "monthly_weekday"]), weekday: z.number().int().min(0).max(6), ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).optional(), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), count: z.number().int().min(1).max(520).optional() }).strict().optional()` described as "Repeat this event as a series. Requires timezone; weekday must be the local weekday of startAt."
  - `ApiEventUpdateRequestSchema` is built from `ApiEventCreateRequestSchema.omit({ repeat: true }).partial()`, so update shapes and their OpenAPI stay unchanged.
  - `ApiEventWriteResponseSchema` gains `seriesId: z.string().min(1).optional()`. The REST route `apps/web/src/app/api/v0/events/route.ts` and both MCP servers (`apps/web/src/lib/server/vrdex-mcp.ts` `mcpEventCreateInputSchema`, `packages/vrdex-mcp/src/server.ts`) derive from these schemas and need no code change.
  - Both owner create mutations take `repeat: v.optional(seriesRepeatValidator)`; when present: `requireRecurringEventsEnabled()`, `timezone` required (`Error("Repeat requires a timezone.")`), then `createSeriesFromEvent(ctx, created, repeat, ownerUserId, Date.now())`; return `{ ...result, seriesId }`.
  - `convex/_mcpWriteReceipts.ts`: `McpEventWriteResult` and `mcpEventWriteResultValidator` gain `seriesId?: Id<"eventSeries">` (`v.optional(v.id("eventSeries"))`), so the stored receipt and a replay carry it (`withCurrentEventWritePaths` already spreads the result).

- [ ] **Step 1: Write the failing tests**

```ts
it("API create with repeat creates a series and its occurrences", async () => {
  // NOW = Date.parse("2026-10-30T12:00:00Z")
  const result = await t.mutation(internal.events.createCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: owner.userId, title: "Harbor Night", communitySlug: "faceless", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York", repeat: { frequency: "weekly", weekday: 5 } });
  assert.ok(result.seriesId);
  assert.equal((await occurrences(t, result.seriesId)).length, 8);
});
it("API create rejects a weekday that is not the start day, and repeat while disabled", async () => {
  // createWithRepeat(repeat) = the call above with only `repeat` replaced
  await assert.rejects(createWithRepeat({ frequency: "weekly", weekday: 4 }), /Repeat weekday must match/);
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  await assert.rejects(createWithRepeat({ frequency: "weekly", weekday: 5 }), /Recurring events are not enabled/);
});
it("MCP create with repeat returns the series ID and replays it", async () => {
  const args = { ...attribution(owner.userId), title: "Harbor Night", communitySlug: "faceless", startAt: Date.parse("2026-11-07T01:00:00Z"), timezone: "America/New_York", repeat: { frequency: "weekly" as const, weekday: 5 } };
  const first = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
  const replay = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
  assert.ok(first.seriesId);
  assert.equal(replay.seriesId, first.seriesId);
});
it("the update schema does not accept repeat", () => {
  assert.equal(ApiEventUpdateRequestSchema.safeParse({ repeat: { frequency: "weekly", weekday: 5 } }).success, false);
});
```

`attribution` mirrors `createAttribution` in `tests/backend/hosted-mcp-event-writes.test.ts` with 64-hex `idempotencyKeyHash` and `requestFingerprint`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-api.test.ts`
Expected: FAIL, `repeat` is not an accepted argument.

- [ ] **Step 3: Implement schema, mutation args, and series creation in both owner paths**

- [ ] **Step 4: Regenerate OpenAPI and run contract checks**

Run: `pnpm generate:api-openapi && pnpm typecheck:api-contracts && pnpm test:api-contracts && node --conditions=import --import tsx --test tests/backend/event-series-api.test.ts tests/backend/hosted-mcp-event-writes.test.ts && pnpm test:web`
Expected: PASS. `pnpm check:api-openapi` reports stale on Windows because of CRLF; trust CI for that check.

- [ ] **Step 5: Document the field**

`docs/developers/vrdex-mcp-event-writes.md` under `vrdex_event_create`: the `repeat` object, the weekday rule, `seriesId` in the result, that later nights are created automatically sixty days ahead and edits to one night do not change the series. `docs/developers/api-changelog.md`: one dated entry for `repeat` and `seriesId`. Run `pnpm exec markdownlint-cli2 docs/developers/vrdex-mcp-event-writes.md docs/developers/api-changelog.md`.

- [ ] **Step 6: Commit**

```bash
git add packages/api-contracts/src/schemas.ts convex/events.ts convex/_mcpWriteReceipts.ts docs/api/openapi.json docs/api/openapi.yaml docs/developers/vrdex-mcp-event-writes.md docs/developers/api-changelog.md tests/backend/event-series-api.test.ts
git commit -m "feat(api): accept repeat on owner event create" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: Public series link, series page, series ICS

**Files:**

- Modify: `convex/_eventPublic.ts` (`PublicEvent` type line 112, `toPublicEvent` line 390, `getPublicEventBySlug` line 790)
- Modify: `convex/eventSeries.ts`
- Modify: `apps/web/src/convex/server.ts` (add `fetchPublicEventSeries` beside `fetchPublicEventBySlug`, line 217)
- Modify: `apps/web/src/app/_components/event-public-page.tsx` (action link beside `Add to calendar`, line 455)
- Create: `apps/web/src/app/[slug]/series/[seriesId]/page.tsx`
- Create: `apps/web/src/app/[slug]/series/[seriesId]/calendar.ics/route.ts`
- Test: `tests/backend/event-series-public.test.ts`, `tests/web/calendar-ics.test.ts`

**Interfaces:**

- Produces:
  - `PublicEvent` gains `seriesId?: string`, set in `getPublicEventBySlug` only when the series exists and `state !== "removed"`.
  - `getPublic = query({ args: { seriesId: v.string() } })` returning `null` for an invalid ID, `state === "removed"`, or a community that is not public; else `{ id: string; title: string; summary?: string; communitySlug: string; communityName: string; nights: Array<PublicEventPreview & { id: string }> }` where `nights` are the series' published scheduled occurrences from today (local) via `by_seriesId_occurrenceDate`, mapped through `getPublicEventPreviews(db, events, { now, limit: 20 })` and re-keyed with `id` by slug.
  - `fetchPublicEventSeries(seriesId: string)` returning `{ kind: "live"; series } | { kind: "missing-url" } | { kind: "error" }` like `fetchPublicEventBySlug`.
  - Series page: 404 unless `series.communitySlug === slug`; `h1` series title; `h2` `Upcoming nights`; one `EventPreviewCard` per night; `Add to calendar` link to `calendar.ics`. No eyebrow, no badges, no explanatory copy.
  - Series ICS route: `createPublicEventFeedIcs(nights, { feedName: series.title, feedUrl, eventUrl: night => absolute("/" + slug + "/events/" + night.slug) })`, same headers as the single-event route, filename `publicEventIcsFilename(seriesId)`.
  - Occurrence page: when `event.seriesId && event.communitySlug`, an action-card link labelled `Upcoming nights` to `/${communitySlug}/series/${seriesId}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-series-public.test.ts; NOW = Date.parse("2026-10-30T12:00:00Z"); series converted as in Task 4
// n06, n13 = occurrence(t, seriesId, "2026-11-06" | "2026-11-13")
it("an occurrence links its series and the series lists upcoming nights", async () => {
  const night = await t.query(api.events.getPublicBySlug, { slug: n13.slug! });
  assert.equal(night!.seriesId, seriesId);
  const page = await t.query(api.eventSeries.getPublic, { seriesId });
  assert.equal(page!.title, "Harbor Night");
  assert.deepEqual(page!.nights.map(n => n.slug).slice(0, 2), [n06.slug, n13.slug]);
  assert.equal(page!.nights[0]!.id, n06._id);
});
it("a removed series hides its page and its link", async () => {
  await t.run(ctx => ctx.db.patch(seriesId, { state: "removed" })); // the projection rule alone; Task 5 owns the retire behaviour
  assert.equal(await t.query(api.eventSeries.getPublic, { seriesId }), null);
  assert.equal((await t.query(api.events.getPublicBySlug, { slug: n13.slug! }))!.seriesId, undefined);
});
```

```ts
// tests/web/calendar-ics.test.ts, new case
it("a series feed emits each occurrence and no RRULE", () => {
  const night = (id: string, startAt: number) => ({ id, slug: id, title: "Harbor Night", startAt, worlds: [] });
  const calendar = createPublicEventFeedIcs([night("n1", Date.UTC(2026, 10, 7, 1)), night("n2", Date.UTC(2026, 10, 14, 2))],
    { feedName: "Harbor Night", feedUrl: "https://vrdex.example/faceless/series/s1", eventUrl: e => `https://vrdex.example/faceless/events/${e.slug}` });
  assert.match(calendar, /DTSTART:20261107T010000Z/);
  assert.match(calendar, /DTSTART:20261114T020000Z/);
  assert.doesNotMatch(calendar, /RRULE/);
});
```

- [ ] **Step 2: Run tests to verify the backend test fails**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-public.test.ts`
Expected: FAIL, `seriesId` undefined on the public event. The ICS case passes already; it pins the occurrence-not-RRULE rule.

- [ ] **Step 3: Implement the projection, `getPublic`, the fetch helper, the series page and route, and the occurrence link**

- [ ] **Step 4: Run tests and web checks**

Run: `node --conditions=import --import tsx --test tests/backend/event-series-public.test.ts && pnpm test:web && pnpm typecheck:web && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventPublic.ts convex/eventSeries.ts apps/web/src/convex/server.ts apps/web/src/app/_components/event-public-page.tsx "apps/web/src/app/[slug]/series" tests/backend/event-series-public.test.ts tests/web/calendar-ics.test.ts
git commit -m "feat(web): series page, series calendar, and occurrence series link" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: Editor: Repeats control, series note, series editor, reset

**Files:**

- Create: `apps/web/src/app/events/event-series-controls.tsx`
- Modify: `apps/web/src/app/events/event-editor-form.tsx` (`EditableEvent` line 69; Details stage line 1046; submit flow around line 790)
- Modify: `convex/_eventPublic.ts` (`getEventForEditor`, line 809)
- Modify: `apps/web/src/app/events/event-edit-page.tsx`, `apps/web/src/app/[slug]/events/[eventSlug]/edit/page.tsx` (pass `searchParams.scope`)
- Modify: `apps/web/src/app/playwright/event-editor/preview.tsx`, `apps/web/src/app/playwright/event-editor/edit/page.tsx` (`?series=1` fixture)
- Create: `apps/web/e2e/event-series-evidence.spec.ts`

**Interfaces:**

- Consumes: `api.eventSeries.isEnabled`, `create`, `update`, `resetOverride`; `Field`, `Input`, `Select` from `@/components/ui/field`; `Button` from `@/components/ui/button`; `EventEditorSteps` (with `steps={[]}`); `EventTimezonePicker`.
- Produces:
  - `getEventForEditor` adds `series: null | { id: string; title: string; summary?: string; timezone: string; venueLabel?: string; worldSlug?: string; sourceUrl?: string; bannerImageUrl?: string; thumbnailImageUrl?: string; rule: SeriesRule; startsOn: string; endsOn?: string; count?: number; state: "active" | "ended" | "removed" }` and `overrides: string[]`; `EditableEvent` gains the same two fields.
  - `RepeatControl({ value, onChange }: { value: { frequency: "none" | SeriesRule["frequency"]; endsOn: string }; onChange(next): void })`: `Select` labelled `Repeats` with options `Does not repeat` (`none`), `Weekly`, `Every two weeks` (`biweekly`), `Monthly` (`monthly_weekday`); when not `none`, `Input type="date"` labelled `Ends`.
  - `EventSeriesNote({ communitySlug, eventSlug, overrides, onReset })`: text `Part of a series.`; links `Edit this night` (the current edit URL, focuses the form) and `Edit the series` (`?scope=series`); for each override, the existing editor label of that field and a `Button` `Reset to series` with accessible name `Reset <label> to series` calling `resetOverride` then `router.refresh()`.
  - `EventSeriesEditor({ communitySlug, eventSlug, series })`: the Details stage scoped to series fields, inside `EventEditorSteps steps={[]}` with the same `Field` primitives and existing labels (`Title`, `Summary`, venue, `Starts`, `Doors open`, `Ends (optional)` as time inputs, time zone picker, source and image URLs), plus `RepeatControl` without `none`; submit `Save changes` calls `api.eventSeries.update` with changed fields only.
- Decision: the series editor is a component on the existing edit route selected by `?scope=series`, not a new route or page design.
- Form wiring: show `RepeatControl` in the Details stage after the doors and end controls when `!event?.series && !timeTba && (demoMode || isEnabled === true)`; show `EventSeriesNote` at the top of the Details stage when `event?.series`. After a successful save with `intent === "publish"` and repeat not `none`, call `api.eventSeries.create({ eventSlug: result.slug, repeat: { frequency, ...(endsOn ? { endsOn } : {}) } })`; in `demoMode` skip the call.

- [ ] **Step 1: Write the Playwright evidence spec**

```ts
// apps/web/e2e/event-series-evidence.spec.ts, same setTheme and capture helpers as event-editor-evidence.spec.ts
for (const color of ["light", "dark"] as const) test(`series editor evidence ${color} @fixture`, async ({ page }, info) => {
  await page.goto("/playwright/event-editor"); await setTheme(page, color);
  await page.getByLabel("Repeats", { exact: true }).selectOption({ label: "Every two weeks" });
  await expect(page.getByLabel("Ends", { exact: true })).toBeVisible();
  await capture(page, info.outputPath(`series-repeats-${color}.png`));
  await page.goto("/playwright/event-editor/edit?series=1"); await setTheme(page, color);
  await expect(page.getByText("Part of a series.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit the series", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset Summary to series", exact: true })).toBeVisible();
  await capture(page, info.outputPath(`series-note-${color}.png`));
});
```

The `?series=1` fixture passes `previewEvent` with `series` set (title `Afterglow Harbor Sessions`, weekly Saturday `18:00`, `America/Indiana/Indianapolis`) and `overrides: ["summary"]`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec playwright test event-series-evidence.spec.ts --project=desktop-chromium`
Expected: FAIL, no control labelled `Repeats`.

- [ ] **Step 3: Implement `getEventForEditor` fields, `event-series-controls.tsx`, form wiring, edit route scope, and fixtures**

- [ ] **Step 4: Run the spec on both projects, then the existing editor specs**

Run: `pnpm --filter web exec playwright test event-series-evidence.spec.ts event-editor-evidence.spec.ts event-editor-unsaved.flow.spec.ts --project=desktop-chromium --project=mobile-chromium && pnpm typecheck:web && pnpm --filter web lint`
Expected: PASS, no horizontal scroll at mobile width (the `capture` helper asserts it).

- [ ] **Step 5: Visual review**

Open the four PNGs from `apps/web/playwright-artifacts` and review them with a VLM against AGENTS.md UI rules: subtle radii, no new badges or eyebrows, labels aligned with neighbouring Details fields, dark mode legible. Fix and re-run Step 4 until clean. Attach the PNGs to the PR.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/events/event-series-controls.tsx apps/web/src/app/events/event-editor-form.tsx apps/web/src/app/events/event-edit-page.tsx "apps/web/src/app/[slug]/events/[eventSlug]/edit/page.tsx" apps/web/src/app/playwright/event-editor convex/_eventPublic.ts apps/web/e2e/event-series-evidence.spec.ts
git commit -m "feat(web): Repeats control, series note, and series editor" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: Event schema documentation

**Files:**

- Modify: `docs/backend/event-schema.md` (new `## Recurring events` section after `## Event Slots`, line 263)

- [ ] **Step 1: Write the section**

Cover: `eventSeries` fields including `worldSlug`; occurrence fields and the `by_seriesId_occurrenceDate` uniqueness rule; the series-owned versus night-owned split (spec table); materialisation window, daily cron and run-on-create, adoption rule; DST rule; override recording and `Reset to series`; fan-out and slot shift; end and remove rules; stream programme copy and its ceiling; the flag. Label decisions with the repo's decision labels.

- [ ] **Step 2: Lint**

Run: `pnpm exec markdownlint-cli2 docs/backend/event-schema.md`
Expected: 0 errors.

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck:backend && pnpm test:backend && pnpm test:web && pnpm verify:docs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/backend/event-schema.md
git commit -m "docs(events): document recurring events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
