# Google Calendar Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `google_calendar` connector kind: VRDex's own Google OAuth client, encrypted credentials, import, export, and bidirectional sync through watch channels and a polling fallback, and delete the callerless staging import it replaces.

**Architecture:** A thin raw-`fetch` Google client (`convex/_googleCalendar.ts`) wraps every call in `withGoogleToken`, which refreshes once on 401 and parks connectors in `needs_reauth` when refresh is refused. The kind module (`convex/eventSyncKinds/googleCalendar.ts`) maps carried fields both ways and hands its transactional decisions (match-and-link, cancellation flag, import window) to internal mutations in `convex/googleCalendarConnector.ts`, which call plan 02's `applyEventCandidate`; the echo guard, the bidirectional newer-wins check, and write-time conflicts live inside `applyEventCandidate`. The web app runs the OAuth round-trip and code exchange; Convex encrypts and stores.

**Tech Stack:** Next.js route handlers, Convex (internal functions, HTTP action, crons), Google Calendar API v3 and Google OAuth 2.0 over raw `fetch`, `node:test` with `convex-test`, Terraform (Vercel provider).

**Spec:** `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (sections Credentials, Links, Connecting, Directions and field ownership, Google Calendar, Settings page). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Depends on plan 02: `eventConnectors`, `connectorCredentials`, `eventSyncLinks`, `eventSyncJobs`, `requireConnectorAuthority`, `carriedFields`, `carriedFieldsHash`, `enqueueSyncJob`, `internal.eventSync.runJob`, `SyncKindHandler`, `syncKindHandlers`, `applyEventCandidate`, `encryptSecret`, `decryptSecret`, `notifyOps` (`convex/_opsAlerts.ts`), the Integrations page. Use them by the master plan's names; do not redefine them.
- Scopes exactly `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events`; `access_type=offline`; `prompt=consent`.
- Env: `GOOGLE_CONNECTOR_CLIENT_ID`, `GOOGLE_CONNECTOR_CLIENT_SECRET` on web and Convex; flag `VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED` on Convex, default off, compared with `=== "true"`.
- No `googleapis` dependency. No new npm dependency at all.
- Carried fields only: title, start, end, summary, venueLabel (as `location`). Poster, world, lineup never move in either direction.
- The exported description's last line is the VRDex event URL: `${SITE_URL}` (existing Convex env, see `convex/discordVerification.ts`) plus `eventPathForRecord` from `convex/_eventPaths.ts`.
- Inbound Google `cancelled` never cancels a VRDex event; it sets the link `external_deleted`.
- Past items are never imported. Recurring instances further than 60 days ahead are not imported (spec, Recurring items).
- Public strings, verbatim from the spec copy table: `Connect Google Calendar`, `Import`, `Export`, `Both`, `Off`, `Reconnect`, `Disconnect`. Utility labels `Calendar` and `Save`. One new sentence needs BASIC's approval before merge: `Google Calendar did not connect. Try again.` No em-dash, no `--`, no AI mention.
- Web tests run on `node:test` (`pnpm test:web` is `node --import tsx --test tests/web/**/*.test.ts`), not vitest; the master's "vitest" mention does not match the repo.
- Markdown passes `pnpm exec markdownlint-cli2`; no bare angle-bracket placeholders in published docs.
- Commit per task, conventional subject, message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A staffer who unticks the Events checkbox on Google's granular consent screen comes back with a token missing `calendar.events`; the callback must refuse it and store nothing (Task 6, `refuses a grant missing a required scope`).
2. VRDex cancels an event, exports `status: cancelled`, and the next poll reads that same cancelled item; it must not flag the event as externally deleted (Task 4, `ignores the inbound echo of a VRDex cancellation`).
3. Google's token endpoint returning 503 is an outage, not a revoked grant; the connector must stay `active` (Task 2, `transient refresh failure keeps the connector active`).
4. An event with no end time, or a date-only event, must export and re-import to the same carried-field hash, or every export loops back as an edit (Task 3, `round-trips an event with no end` and `round-trips a date-only event`, both against the runner's stored hash).
5. After a watch renewal Google can still deliver to the old channel, and a removed connector's channel stays live until expiry; a valid token on a stale or removed channel must not enqueue work (Task 5, `ignores a stale channel and the initial sync message`).

---

## File map

| File | Responsibility |
| --- | --- |
| `convex/_googleCalendar.ts` (create) | Flag, typed raw-fetch Google client, `withGoogleToken`, watch channel token. |
| `convex/googleCalendarConnector.ts` (create) | Convex functions: credential storage and refresh bookkeeping, import apply, export record, reconcile linking, watch and poll scheduling, calendar list, connect authorization. |
| `convex/eventSyncKinds/googleCalendar.ts` (create) | Field mapping both ways and `googleCalendarHandler: SyncKindHandler`. |
| `convex/_eventCandidateApply.ts` (modify, plan 02) | Adds `candidateFromConnectorFields`, shared with plans 07, 09, 11. |
| `convex/eventSyncKinds/index.ts` (modify, plan 02) | Register `google_calendar`. |
| `convex/_eventConnectors.ts` (modify, plan 02) | Target validator gains `watchChannelId`, `watchResourceId`, `watchExpiresAt`, `syncToken`. |
| `convex/http.ts`, `convex/crons.ts` (modify) | Notify route; poll and renewal crons (the renewal cron also runs the Task 8 staleness alert). |
| `apps/web/src/lib/server/google-connector-oauth.ts` (create) | Authorize URL, state cookie, code exchange. |
| `apps/web/src/app/api/connectors/google/start/route.ts`, `.../callback/route.ts` (create) | OAuth round-trip. |
| `apps/web/src/app/account/communities/[slug]/club-google-calendar.tsx` (create) | Connect, calendar picker, Reconnect. |
| Deleted | `convex/_eventCalendarImports.ts`, its three tables, `tests/backend/event-calendar-imports.test.ts`. |
| Tests | `tests/backend/google-calendar-connector.test.ts`, `tests/backend/_googleCalendarFixture.ts`, `tests/web/google-connector-oauth.test.ts`. |

Backend test command throughout: `node --conditions=import --import tsx --test tests/backend/google-calendar-connector.test.ts`.

### Task 1: Remove the staging import

The grep on 2026-10-29 found these references and no others in tracked code: `convex/schema.ts` (validator import at lines 49-58, tables at 1427-1497), `convex/_generated/api.d.ts` (lines 53 and 269), `tests/backend/event-calendar-imports.test.ts`, `docs/backend/event-schema.md` (Calendar Import And Export, lines 304-318), `docs/planning/calendar-integration.md` (Implemented Import Foundation, lines 117-130, and the "Do not add Google OAuth" line 115). `docs/planning/event-contribution-intake-research-2026-09-25.md` line 13 is a dated research note; leave it. Re-run the grep before deleting.

**Files:**

- Delete: `convex/_eventCalendarImports.ts`, `tests/backend/event-calendar-imports.test.ts`
- Modify: `convex/schema.ts`, `convex/_generated/api.d.ts`, `docs/backend/event-schema.md`, `docs/planning/calendar-integration.md`
- Test: `tests/backend/google-calendar-connector.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces: the test file later tasks extend.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import schemaModule from "../../convex/schema";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("staging import removal", () => {
  it("drops the callerless calendar staging tables", () => {
    for (const table of ["eventImportBatches", "eventImportCandidates", "eventImportCandidateFields"]) {
      assert.equal(table in schema.tables, false, table);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail** (all three tables still present).

- [ ] **Step 3: Delete the module, tables, validator import, and old test.** Edit `convex/_generated/api.d.ts` by hand (remove the `_eventCalendarImports` import and map entry) instead of booting local Convex: the shared port 3210 blocks a second worktree, and CI's `check:backend:generated` proves the edit. Convex drops removed tables from the schema without touching stored rows; there were no callers, so no rows are expected.

- [ ] **Step 4: Rewrite the docs.** `docs/backend/event-schema.md` Calendar Import And Export keeps the ICS export paragraphs and replaces the staging bullets with: Google Calendar is a `google_calendar` connector (plan 02 tables); it carries title, start, end, summary, and venue label as location; imports enter as intake candidates; exports end the description with the event URL; inbound cancellation flags, never cancels. `docs/planning/calendar-integration.md`: replace Implemented Import Foundation with a short Google Calendar Connector section pointing at the connectors spec, and drop the "Do not add Google OAuth" sentence.

- [ ] **Step 5: Verify**

Run: the backend test command, then `pnpm typecheck:backend`, then `pnpm exec markdownlint-cli2 docs/backend/event-schema.md docs/planning/calendar-integration.md`
Expected: PASS, no type errors, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add -A convex/_eventCalendarImports.ts convex/schema.ts convex/_generated/api.d.ts tests/backend/event-calendar-imports.test.ts tests/backend/google-calendar-connector.test.ts docs/backend/event-schema.md docs/planning/calendar-integration.md
git commit -m "refactor: remove the callerless Google Calendar staging import" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Google client and token refresh

**Files:**

- Create: `convex/_googleCalendar.ts`, `convex/googleCalendarConnector.ts`, `tests/backend/_googleCalendarFixture.ts`
- Modify: `convex/_eventConnectors.ts` (target validator), `convex/eventSyncKinds/index.ts`
- Create (stub): `convex/eventSyncKinds/googleCalendar.ts` with `googleCalendarHandler` whose `importPoll` lists one page; Task 4 replaces the body
- Test: `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: `encryptSecret`, `decryptSecret` (`convex/_connectorCrypto.ts`), `internal.eventSync.runJob`, `SyncKindHandler`.
- Produces, in `convex/_googleCalendar.ts`:

```ts
export type GoogleEventDateTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleCalendarEvent = {
  id: string; status: "confirmed" | "tentative" | "cancelled"; updated: string;
  summary?: string; description?: string; location?: string;
  start?: GoogleEventDateTime; end?: GoogleEventDateTime; recurringEventId?: string;
};
export type GoogleEventBody = Required<Pick<GoogleCalendarEvent, "summary" | "description" | "location" | "start" | "end" | "status">>;
export class GoogleApiError extends Error { constructor(readonly status: number, message: string); }
export function googleCalendarEnabled(): boolean;
export function requireGoogleCalendarEnabled(): void; // throws Error("CONNECTOR_KIND_DISABLED")
export function withGoogleToken<T>(ctx: ActionCtx, credentialId: Id<"connectorCredentials">, fn: (accessToken: string) => Promise<T>): Promise<T>;
export function listEvents(token: string, calendarId: string, params: { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string }): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone: string }>;
export function insertEvent(token: string, calendarId: string, body: GoogleEventBody): Promise<GoogleCalendarEvent>;
export function patchEvent(token: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<GoogleCalendarEvent>;
export function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void>; // 404 and 410 resolve
export function watchEvents(token: string, calendarId: string, channel: { id: string; token: string; address: string }): Promise<{ resourceId: string; expiration: number }>;
export function stopChannel(token: string, channel: { id: string; resourceId: string }): Promise<void>;
export function listCalendars(token: string): Promise<Array<{ id: string; summary: string; primary?: boolean }>>;
```

- Produces, in `convex/googleCalendarConnector.ts`: `internal.googleCalendarConnector.readCredential` (internalQuery `{ credentialId }`), `saveAccessToken` (internalMutation `{ credentialId, encryptedAccessToken, accessTokenExpiresAt }`), `markNeedsReauth` (internalMutation `{ credentialId, error: string }`: every non-removed connector with that `credentialId` goes `needs_reauth` with `lastError`).
- Produces, test fixture `tests/backend/_googleCalendarFixture.ts`:

```ts
export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const SITE = "https://vrdex.test";
export const EVENT_URL = "https://vrdex.test/basic-nights/events/bass-temple-nov-7";
export function setupEnv(): void; // VRDEX_EVENT_CONNECTORS_ENABLED, VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "true"; SITE_URL = SITE; CONVEX_SITE_URL = "https://convex.test"; VRDEX_CONNECTOR_TOKEN_KEY = "A".repeat(43) + "="; GOOGLE_CONNECTOR_CLIENT_ID = "client-id"; GOOGLE_CONNECTOR_CLIENT_SECRET = "client-secret"; mock Date at NOW
export function fakeFetch(handler: (request: { method: string; url: URL; body: unknown; authorization: string | null }) => Response | Promise<Response>): { calls: Array<{ method: string; url: URL; body: unknown; authorization: string | null }>; restore(): void };
export async function seedGoogleConnector(t: TestConvex<typeof schema>, options: { direction: ConnectorDirection; mode?: ConnectorMode; state?: ConnectorState; target?: Record<string, unknown> }): Promise<{ connectorId: Id<"eventConnectors">; credentialId: Id<"connectorCredentials">; communityProfileId: Id<"profiles">; staffUserId: Id<"users">; outsiderUserId: Id<"users"> }>;
// community slug "basic-nights"; staff holds a communityRoles row with permissions ["manage_integrations", "manage_events"] (insert shape from tests/backend/club-posts.test.ts setup()); credential access "old-access", refresh "refresh-1", accessTokenExpiresAt NOW + 3_600_000, externalAccountId "google-sub-1"; target.calendarId "cal-1"; mode default "autopublish"
export async function seedEvent(t: TestConvex<typeof schema>, communityProfileId: Id<"profiles">, overrides?: Partial<Doc<"events">>): Promise<Id<"events">>;
// defaults: title "Bass Temple", slug "bass-temple-nov-7", eventDate "2026-11-07", timezone "America/New_York", scheduleKind "timed", startAt Date.parse("2026-11-08T01:00:00.000Z"), endAt Date.parse("2026-11-08T04:00:00.000Z"), summary "Weekly bass night.", venueLabel "The Temple", eventStatus "scheduled", publicationState "published", sourceType "community", updatedAt NOW - 60_000
export function googleItem(overrides?: Partial<GoogleCalendarEvent>): GoogleCalendarEvent;
// defaults: id "g1", status "confirmed", summary "Bass Temple", location "The Temple", description "Weekly bass night.\n\n" + EVENT_URL, start { dateTime: "2026-11-07T20:00:00-05:00", timeZone: "America/New_York" }, end { dateTime: "2026-11-07T23:00:00-05:00", timeZone: "America/New_York" }, updated "2026-11-02T11:00:00.000Z"
export async function runSyncJob(t: TestConvex<typeof schema>, job: { connectorId: Id<"eventConnectors">; kind: Doc<"eventSyncJobs">["kind"]; eventId?: Id<"events">; payload?: unknown }): Promise<Doc<"eventSyncJobs">>;
// inserts a pending job due at NOW, runs internal.eventSync.runJob, returns the job row afterwards
```

The `convexTest` modules map lists every `convex/` file whose registered functions the tests reach: `_generated/api`, `eventSync`, `eventConnectors`, `googleCalendarConnector`, `http`, plus whatever plan 02's `applyEventCandidate` path registers. Add entries when convex-test reports a missing module.

- [ ] **Step 1: Write the failing tests**

```ts
describe("withGoogleToken", () => {
  beforeEach(setupEnv);
  const page = () => Response.json({ items: [], nextSyncToken: "sync-1", timeZone: "America/New_York" });

  it("refreshes once on 401, stores the new token, and retries", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url, authorization }) => {
      if (url.href === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "new-access", expires_in: 3600 });
      return authorization === "Bearer old-access" ? new Response("", { status: 401 }) : page();
    });
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.authorization ?? c.url.pathname), ["Bearer old-access", "/token", "Bearer new-access"]);
    const credential = await t.run((ctx) => ctx.db.get(credentialId));
    assert.equal(await decryptSecret(credential!.encryptedAccessToken), "new-access");
    assert.equal(credential!.accessTokenExpiresAt, NOW + 3_600_000);
  });

  it("refresh refused sets needs_reauth and does not retry again", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token"
      ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : new Response("", { status: 401 }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.url.pathname === "/token").length, 1);
    assert.equal(fake.calls.length, 2);
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.state, "needs_reauth");
  });

  it("a second 401 after a successful refresh fails the job without another refresh", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token"
      ? Response.json({ access_token: "new-access", expires_in: 3600 })
      : new Response("", { status: 401 }));
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 3);
    assert.notEqual(job.state, "done");
  });

  it("transient refresh failure keeps the connector active", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? new Response("", { status: 503 }) : new Response("", { status: 401 }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.state, "active");
  });

  it("refreshes before the call when the stored token has expired", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    await t.run((ctx) => ctx.db.patch(credentialId, { accessTokenExpiresAt: NOW - 1 }));
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? Response.json({ access_token: "new-access", expires_in: 3600 }) : page());
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.authorization ?? c.url.pathname), ["/token", "Bearer new-access"]);
  });

  it("does nothing when the kind flag is off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "false";
    const fake = fakeFetch(() => page());
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.notEqual(job.state, "done");
  });
});
```

- [ ] **Step 2: Run them and see them fail** (module not found).

- [ ] **Step 3: Implement `convex/_googleCalendar.ts` and the three credential functions.** API base `https://www.googleapis.com/calendar/v3`; token endpoint `https://oauth2.googleapis.com/token` (form body `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`). `listEvents` always sends `singleEvents=true` and `maxResults=250`. `listCalendars` sends `minAccessRole=writer` so any later direction change still works. Non-2xx throws `GoogleApiError(status)`. `withGoogleToken` decisions: refresh first when `accessTokenExpiresAt <= Date.now()`; catch exactly one `GoogleApiError` with status 401, refresh, retry once, let a second error propagate; a refresh answered with 400 or 401, or a credential in state `revoked`, calls `markNeedsReauth` and throws `Error("GOOGLE_REAUTH_REQUIRED")`; any other refresh failure throws without touching state. Every handler method starts with `requireGoogleCalendarEnabled()`. `markNeedsReauth` scans `eventConnectors` filtered on `credentialId` (`// ponytail: full scan, add a by_credentialId index when connectors pass a few hundred`). Extend plan 02's target validator with optional `watchChannelId: v.string()`, `watchResourceId: v.string()`, `watchExpiresAt: v.number()`, `watchRenewedAt: v.number()`, `syncToken: v.string()`. `watchRenewedAt` is plan-internal: the time of the last successful watch creation, read by Task 8. Register `google_calendar: googleCalendarHandler` in `convex/eventSyncKinds/index.ts`.

- [ ] **Step 4: Run the tests and see them pass.**

- [ ] **Step 5: Commit**

```bash
git add convex/_googleCalendar.ts convex/googleCalendarConnector.ts convex/eventSyncKinds/googleCalendar.ts convex/eventSyncKinds/index.ts convex/_eventConnectors.ts tests/backend/_googleCalendarFixture.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): add Google Calendar client with refresh-once tokens" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Field mapping and export

**Files:**

- Modify: `convex/eventSyncKinds/googleCalendar.ts`, `convex/googleCalendarConnector.ts`
- Test: `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: Task 2 client and fixture; `carriedFieldsHash` (plan 02; it normalises date-only fields, so the mappers do not), `eventPathForRecord`; plan 02's runner, which after a successful `exportUpsert` writes the link's `externalId`, `lastExportedAt`, and `lastExportedHash`, and after `exportDelete` sets the link `vrdex_retracted`.
- Produces, in `convex/eventSyncKinds/googleCalendar.ts`:

```ts
export function googleBodyFromEvent(event: Doc<"events">, eventUrl: string): GoogleEventBody;
export function fieldsFromGoogleEvent(item: GoogleCalendarEvent, calendarTimeZone: string, siteUrl: string): EventIntakeFields;
export const googleCalendarHandler: SyncKindHandler;
```

- Produces, in `convex/googleCalendarConnector.ts`: `internal.googleCalendarConnector.exportContext` (internalQuery `{ connectorId, eventId }` returning `{ eventUrl: string; credentialId; calendarId }`). No export bookkeeping: the runner owns the link writes. The echo guarantee is that `carriedFieldsHash("google_calendar", fieldsFromGoogleEvent(echo))` equals the runner's stored `lastExportedHash`; the round-trip tests below pin exactly that.

Mapping decisions the tests pin:

- `fieldsFromGoogleEvent` sets every key it owns (`title`, `eventDate`, `timeTba`, `timezone`, `start`, `end`, `venueLabel`, `summary`), `null` for absent; `dayOffset` is omitted when 0; `occurrence` is never set.
- Timed: `start.dateTime` is the ISO instant of `startAt`, `timeZone` is `event.timezone ?? "UTC"`. No `endAt` exports `end` equal to `start`; on import `end` equal to `start` reads back as `end: null`.
- Date-only (`scheduleKind: "date_only"`): `{ date: eventDate }` to `{ date: eventDate + 1 day }`; import of an all-day item gives `timeTba: true`, `start: null`, `end: null`.
- Import reads local date and clock in `start.timeZone ?? calendarTimeZone` with `Intl.DateTimeFormat`, end `dayOffset` from the end's local date.
- `description` is `summary + "\n\n" + eventUrl`, or `eventUrl` alone; import strips a trailing line that starts with `siteUrl + "/"` plus surrounding blank lines, then caps at 240 characters. `location` is `venueLabel ?? ""` so a patch clears it.
- `status` is `"cancelled"` when `eventStatus === "cancelled"`, else `"confirmed"`.

`exportUpsert(ctx, connector, event, link)`: with a link, patch `link.externalId`; without one, list the window `eventDate - 1 day` to `eventDate + 2 days` and, if an item's local date equals `eventDate` and its title matches case-insensitively, patch that item instead of inserting (spec, Links: export dedupe); else insert. Return `{ externalId }` and nothing else. `exportDelete(ctx, connector, link)`: `deleteEvent` only.

- [ ] **Step 1: Write the failing tests**

```ts
describe("google calendar mapping and export", () => {
  beforeEach(setupEnv);

  // Export through the runner; the fake echoes the sent body the way Google returns it.
  async function exportAndEcho(overrides: Partial<Doc<"events">> = {}) {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    const fake = fakeFetch(({ method, body }) => method === "GET"
      ? Response.json({ items: [], timeZone: "America/New_York" })
      : Response.json({ ...googleItem({ id: "created-1" }), ...(body as object), updated: "2026-11-02T12:00:01.000Z" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    const body = fake.calls.find((c) => c.method === "POST")!.body as GoogleEventBody;
    const echoed = fieldsFromGoogleEvent({ ...googleItem({ id: "created-1" }), ...body }, "America/New_York", SITE);
    return { t, link, body, echoed };
  }

  it("round-trips a timed event to the runner's stored hash", async () => {
    const { link, echoed } = await exportAndEcho();
    assert.ok(link.lastExportedHash);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips an event with no end", async () => {
    const { link, body, echoed } = await exportAndEcho({ endAt: undefined });
    assert.deepEqual(body.end, body.start);
    assert.equal(echoed.end, null);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips a date-only event", async () => {
    const { link, body, echoed } = await exportAndEcho({ scheduleKind: "date_only", startAt: undefined, endAt: undefined });
    assert.deepEqual(body.start, { date: "2026-11-07" });
    assert.deepEqual(body.end, { date: "2026-11-08" });
    assert.equal(echoed.timeTba, true);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("exports only carried fields and ends the description with the event URL", async () => {
    const { link, body } = await exportAndEcho({ posterImageUrl: "/poster.png" });
    assert.deepEqual(Object.keys(body).sort(), ["description", "end", "location", "start", "status", "summary"]);
    assert.equal(body.summary, "Bass Temple");
    assert.equal(body.location, "The Temple");
    assert.equal(body.status, "confirmed");
    assert.deepEqual(body.start, { dateTime: "2026-11-08T01:00:00.000Z", timeZone: "America/New_York" });
    assert.equal(body.description.split("\n").at(-1), EVENT_URL);
    assert.equal(link.externalId, "created-1");
  });

  it("links a matching external item instead of creating a duplicate", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId);
    const fake = fakeFetch(({ method }) => method === "GET"
      ? Response.json({ items: [googleItem({ id: "existing-1", summary: "bass temple" })], timeZone: "UTC" })
      : Response.json(googleItem({ id: "existing-1" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(fake.calls.find((c) => c.method === "PATCH")!.url.pathname, "/calendar/v3/calendars/cal-1/events/existing-1");
  });

  it("exports a cancelled VRDex event as status cancelled", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(() => Response.json(googleItem({ status: "cancelled" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    assert.equal((patch.body as GoogleEventBody).status, "cancelled");
  });

  it("deletes on export_delete and treats 410 as done", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(() => new Response("", { status: 410 }));
    const job = await runSyncJob(t, { connectorId, kind: "export_delete", eventId });
    fake.restore();
    assert.equal(fake.calls[0].method, "DELETE");
    assert.equal(job.state, "done");
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the two mappers, `exportUpsert`, `exportDelete`, and `exportContext`.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/googleCalendar.ts convex/googleCalendarConnector.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): export VRDex events to Google Calendar" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Import, poll, and reconcile

**Files:**

- Modify: `convex/eventSyncKinds/googleCalendar.ts`, `convex/googleCalendarConnector.ts`, `convex/_eventCandidateApply.ts`
- Test: `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: Task 3 mappers; `applyEventCandidate` (owns the echo guard, `skipped_echo`; the bidirectional staleness check, `skipped_stale`; and write-time `conflict`, which files a `hold` draft), `enqueueSyncJob`.
- Produces, in `convex/googleCalendarConnector.ts`:
  - `internal.googleCalendarConnector.applyImport` internalMutation `{ connectorId, item: v.any(), calendarTimeZone: v.string() }` returning `"skipped" | "unchanged" | "cancel_echo" | "flagged"` or `applyEventCandidate`'s outcome unchanged (`"draft" | "published" | "updated" | "not_event" | "conflict" | "skipped_pending_draft" | "skipped_stale" | "skipped_echo"`).
  - `internal.googleCalendarConnector.reconcileItems` internalMutation `{ connectorId, items: v.any(), calendarTimeZone: v.string() }`.
  - `internal.googleCalendarConnector.patchGoogleTarget` internalMutation `{ connectorId, target: { watchChannelId?, watchResourceId?, watchExpiresAt?, watchRenewedAt?, syncToken? }, syncedAt?: number }` merging into `target` and setting `lastSyncedAt`.
- Produces, in `convex/_eventCandidateApply.ts` (master contract; plans 07, 09, 11 consume it): `export function candidateFromConnectorFields(kind: ConnectorKind, fields: Partial<EventIntakeFields>, decision: EventIntakeDecision): EventIntakeCandidate`. Every given field gets one evidence row, `origin: "connector"`, `assessment: "explicit"`, `excerpt: null`; `lineup: []`, `questions: []`. No Google knowledge in it; `applyImport` passes `"google_calendar"`, the fields from `fieldsFromGoogleEvent` with `communitySlug` set, and the decision.

`applyImport` runs these rules in order; this order is the decision the implementer cannot infer. It does not compare hashes or timestamps against the event; `applyEventCandidate` does both from `link` and `externalUpdatedAt`.

1. Connector not `active`, or direction `export` or `off`: `skipped`.
2. Link by `by_connectorId_externalId(item.id)`. `updatedMs = Date.parse(item.updated)`. Link with `externalUpdatedAt >= updatedMs`: `unchanged`.
3. `status === "cancelled"`: no link with `eventId` gives `skipped`; linked event already `cancelled` gives `cancel_echo` (VRDex's own cancellation export coming back); otherwise set link `external_deleted`, return `flagged`. Never touch the event.
4. Local start date before today in its zone: `skipped`. `recurringEventId` set and start date more than 60 days ahead: `skipped`.
5. No link: match `events.by_communityProfileId_eventDate` on the community and `fields.eventDate` with case-insensitive trimmed title equality; on a match insert a `linked` link and use `decision: { kind: "update", slug }`; otherwise `decision: { kind: "new" }`. A linked event also gives `update`.
6. `applyEventCandidate(ctx, { connector, candidate, actorUserId: connector.authorityUserId, link, externalId: item.id, externalUpdatedAt: updatedMs, idempotencyKey: "google_calendar:" + connectorId + ":" + item.id + ":" + updatedMs })`, return its outcome. A `conflict` already filed its `hold` draft; return it as is.

Every outcome except `skipped` writes `lastImportedAt`, `externalUpdatedAt = updatedMs`, and `externalSeriesId = item.recurringEventId` on the link (re-read after step 6), so a `skipped_stale` import still records the external time it saw.

`importItem(ctx, connector, payload)`: payload is `{ item, calendarTimeZone }`; calls `applyImport`. `importPoll(ctx, connector)`: page `listEvents` from `target.syncToken`; on `GoogleApiError` 410 drop the token and page a full list with no token and no time bounds (Google forbids `timeMin` and `timeMax` alongside a sync token, so the initial list must match); run `importItem` inline per item; store `nextSyncToken` and `syncedAt` through `patchGoogleTarget`. `// ponytail: full resync pages the whole calendar in one action; split by page into jobs if a calendar outgrows the action time limit.` `reconcile(ctx, connector)`: list `timeMin` = start of today UTC to `timeMax` = +90 days, pass items to `reconcileItems`, which skips cancelled items and items with a link, links matches by rule 5 without applying anything, and for direction `import` or `bidirectional` enqueues `import_item` with payload `{ item, calendarTimeZone }` for the rest. Then, for direction `export` or `bidirectional`, the same mutation enqueues `export_upsert` through `enqueueSyncJob` for every `published`, `scheduled` community event with `sortAt` at or after the start of today (index `events.by_communityProfileId_publicationState_eventStatus_sortAt`) that has no link on this connector after the matching above, so existing listings reach Google without waiting for an edit. Events beyond the 90-day list window rely on `exportUpsert`'s own match before insert.

- [ ] **Step 1: Write the failing tests**

```ts
describe("google calendar import", () => {
  beforeEach(setupEnv);
  const importItem = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: GoogleCalendarEvent) =>
    runSyncJob(t, { connectorId, kind: "import_item", payload: { item, calendarTimeZone: "America/New_York" } });

  const applyImport = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: GoogleCalendarEvent) =>
    t.mutation(internal.googleCalendarConnector.applyImport, { connectorId, item, calendarTimeZone: "America/New_York" });

  it("ignores its own export coming back", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", lastExportedHash: carriedFieldsHash("google_calendar", fieldsFromGoogleEvent(googleItem(), "America/New_York", SITE)), createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ updated: "2026-11-02T11:59:59.000Z" })), "skipped_echo");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.updatedAt, event.updatedAt);
  });

  it("bidirectional: a newer external edit wins", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { updatedAt: NOW - 60_000 });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Late", updated: "2026-11-02T11:59:59.000Z" })), "updated");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, "Bass Temple Late");
  });

  it("bidirectional: a newer VRDex edit wins and the link records the external time", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { updatedAt: NOW });
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Late", updated: "2026-11-02T11:00:00.000Z" })), "skipped_stale");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, "Bass Temple");
    assert.equal((await t.run((ctx) => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.externalUpdatedAt, Date.parse("2026-11-02T11:00:00.000Z"));
  });

  it("flags, never cancels, on an inbound cancellation", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    await importItem(t, connectorId, googleItem({ status: "cancelled", updated: "2026-11-02T11:59:59.000Z" }));
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "external_deleted");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.eventStatus, "scheduled");
  });

  it("ignores the inbound echo of a VRDex cancellation", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    await importItem(t, connectorId, googleItem({ status: "cancelled", updated: "2026-11-02T11:59:59.000Z" }));
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
  });

  it("skips past items and recurring instances beyond 60 days", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    await importItem(t, connectorId, googleItem({ id: "past", start: { dateTime: "2026-10-30T20:00:00-04:00" }, end: { dateTime: "2026-10-30T23:00:00-04:00" } }));
    await importItem(t, connectorId, googleItem({ id: "far", recurringEventId: "series-1", start: { dateTime: "2027-01-08T20:00:00-05:00" }, end: { dateTime: "2027-01-08T23:00:00-05:00" } }));
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
  });

  it("reconcile links by date and title without creating", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const other = googleItem({ id: "g2", summary: "Other Night", start: { dateTime: "2026-11-08T20:00:00-05:00" }, end: { dateTime: "2026-11-08T23:00:00-05:00" } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [googleItem({ summary: "BASS TEMPLE" }), other], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId]), [["g1", eventId]]);
    assert.equal((await t.run((ctx) => ctx.db.query("events").collect())).length, 1);
    const jobs = await t.run((ctx) => ctx.db.query("eventSyncJobs").collect());
    assert.deepEqual(jobs.filter((j) => j.kind === "import_item").map((j) => (j.payload as { item: GoogleCalendarEvent }).item.id), ["g2"]);
  });

  it("reconcile queues exports for unlinked upcoming events", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const matched = await seedEvent(t, communityProfileId);
    const fresh = await seedEvent(t, communityProfileId, { title: "Fresh Night", slug: "fresh-night", eventDate: "2026-11-09", startAt: Date.parse("2026-11-10T01:00:00.000Z"), endAt: undefined, sortAt: Date.parse("2026-11-10T01:00:00.000Z") });
    await seedEvent(t, communityProfileId, { title: "Old Night", slug: "old-night", eventDate: "2026-10-20", startAt: Date.parse("2026-10-21T00:00:00.000Z"), sortAt: Date.parse("2026-10-21T00:00:00.000Z") });
    await seedEvent(t, communityProfileId, { title: "Private Night", slug: "private-night", eventDate: "2026-11-10", publicationState: "draft_private", startAt: Date.parse("2026-11-11T01:00:00.000Z"), sortAt: Date.parse("2026-11-11T01:00:00.000Z") });
    await t.run((ctx) => ctx.db.patch(matched, { sortAt: Date.parse("2026-11-08T01:00:00.000Z") }));
    const fake = fakeFetch(() => Response.json({ items: [googleItem()], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const jobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.state === "pending");
    assert.deepEqual(jobs.map((j) => [j.kind, j.eventId]), [["export_upsert", fresh]]);
  });

  it("full resync on 410 stores the fresh sync token and imports the items", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold", target: { calendarId: "cal-1", syncToken: "stale-token" } });
    const fresh = googleItem({ id: "g-new", summary: "Fresh Night", start: { dateTime: "2026-11-09T20:00:00-05:00" }, end: { dateTime: "2026-11-09T23:00:00-05:00" }, description: undefined });
    const fake = fakeFetch(({ url }) => url.searchParams.get("syncToken") === "stale-token"
      ? new Response("", { status: 410 })
      : Response.json({ items: [fresh], nextSyncToken: "fresh-token", timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls[1].url.searchParams.has("syncToken"), false);
    assert.equal(fake.calls[1].url.searchParams.has("timeMin"), false);
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.target.syncToken, "fresh-token");
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(link.externalId, "g-new");
    assert.ok(link.draftId);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `applyImport`, `reconcileItems` (with the export enqueue), `patchGoogleTarget`, `candidateFromConnectorFields`, `importItem`, `importPoll`, `reconcile`.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/googleCalendar.ts convex/googleCalendarConnector.ts convex/_eventCandidateApply.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): import and reconcile Google Calendar events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Watch channels, notify route, crons

**Files:**

- Modify: `convex/_googleCalendar.ts`, `convex/googleCalendarConnector.ts`, `convex/eventSyncKinds/googleCalendar.ts` (reconcile calls `ensureWatch`), `convex/http.ts`, `convex/crons.ts`
- Test: `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: `patchGoogleTarget`, `enqueueSyncJob`, index `eventConnectors.by_kind_target_channelId` (prefix on `kind` lists all Google connectors), index `eventSyncJobs.by_connectorId_eventId_state`.
- Produces, in `convex/_googleCalendar.ts`:
  - `watchChannelToken(connectorId: string, channelId: string): Promise<string>` returning `connectorId + "." + base64url(HMAC-SHA256(VRDEX_CONNECTOR_TOKEN_KEY bytes, connectorId + ":" + channelId))`. Derived, so the per-connector secret needs no stored field.
  - `ensureWatch(ctx: ActionCtx, connector: Doc<"eventConnectors">, force: boolean): Promise<void>`: when direction is `import` or `bidirectional` and (`force` or no `watchChannelId`), stop the old channel if any (errors ignored), create one with `id = crypto.randomUUID()`, `address = process.env.CONVEX_SITE_URL + "/connectors/google/notify"`, `params.ttl = "604800"`, and store the returned `resourceId`, `expiration`, and `watchRenewedAt: Date.now()`.
- Produces, in `convex/googleCalendarConnector.ts`: `notifyTarget` internalQuery `{ connectorId: v.string() }` returning the connector or null (normalize the id with `ctx.db.normalizeId`); `enqueuePoll` internalMutation `{ connectorId }` (no-op when a pending `import_poll` exists for the connector); `enqueuePolls` internalMutation `{}`; `renewWatches` internalAction `{}`.

Route `POST /connectors/google/notify` in `convex/http.ts`: flag off returns 200 and does nothing (Google retries 5xx, and a disabled kind should not cause retries). Token missing, unparsable, connector missing, or HMAC mismatch with `safeEqual`: 401. Connector not `active`, or `X-Goog-Channel-ID` not equal to `target.watchChannelId`: 200, nothing. `X-Goog-Resource-State` `sync`: 200, nothing. Otherwise `enqueuePoll`, 200.

Crons: `crons.interval("poll google calendar connectors", { minutes: 15 }, internal.googleCalendarConnector.enqueuePolls, {})` for `active` Google connectors with direction `import` or `bidirectional`; `crons.daily("renew google calendar watches", { hourUTC: 5, minuteUTC: 20 }, internal.googleCalendarConnector.renewWatches, {})` which calls `ensureWatch(..., true)` for those connectors whose `watchExpiresAt - Date.now() <= 86_400_000`, that is a seven-day channel older than six days, and creates a watch for any that lack one. Both no-op when the flag is off.

- [ ] **Step 1: Write the failing tests**

```ts
describe("google calendar watch channels", () => {
  beforeEach(setupEnv);
  const notify = async (t: TestConvex<typeof schema>, headers: Record<string, string>) =>
    t.fetch("/connectors/google/notify", { method: "POST", headers });
  const pendingPolls = (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).filter((j) => j.kind === "import_poll" && j.state === "pending").length);

  it("enqueues one poll for an authenticated notification and dedupes repeats", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-1", watchResourceId: "res-1", watchExpiresAt: NOW + 86_400_000 } });
    const headers = { "x-goog-channel-id": "chan-1", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-1"), "x-goog-resource-state": "exists" };
    assert.equal((await notify(t, headers)).status, 200);
    assert.equal((await notify(t, headers)).status, 200);
    assert.equal(await pendingPolls(t), 1);
  });

  it("rejects a bad token", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-1" } });
    const response = await notify(t, { "x-goog-channel-id": "chan-1", "x-goog-channel-token": connectorId + ".forged", "x-goog-resource-state": "exists" });
    assert.equal(response.status, 401);
    assert.equal(await pendingPolls(t), 0);
  });

  it("ignores a stale channel and the initial sync message", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-2" } });
    const stale = { "x-goog-channel-id": "chan-1", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-1"), "x-goog-resource-state": "exists" };
    const sync = { "x-goog-channel-id": "chan-2", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-2"), "x-goog-resource-state": "sync" };
    assert.equal((await notify(t, stale)).status, 200);
    assert.equal((await notify(t, sync)).status, 200);
    assert.equal(await pendingPolls(t), 0);
  });

  it("renews a watch with a day or less left and leaves fresher ones", async () => {
    const t = convexTest({ schema, modules });
    const due = await seedGoogleConnector(t, { direction: "bidirectional", target: { calendarId: "cal-1", watchChannelId: "old-chan", watchResourceId: "old-res", watchExpiresAt: NOW + 43_200_000 } });
    await seedGoogleConnector(t, { direction: "bidirectional", target: { calendarId: "cal-2", watchChannelId: "fresh-chan", watchResourceId: "fresh-res", watchExpiresAt: NOW + 3 * 86_400_000 } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/stop") ? new Response(null, { status: 204 }) : Response.json({ resourceId: "new-res", expiration: String(NOW + 604_800_000) }));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.url.pathname), ["/calendar/v3/channels/stop", "/calendar/v3/calendars/cal-1/events/watch"]);
    assert.deepEqual(fake.calls[0].body, { id: "old-chan", resourceId: "old-res" });
    const watch = fake.calls[1].body as { id: string; token: string; address: string; type: string };
    assert.equal(watch.address, "https://convex.test/connectors/google/notify");
    assert.equal(watch.type, "web_hook");
    assert.equal(watch.token, await watchChannelToken(due.connectorId, watch.id));
    const target = (await t.run((ctx) => ctx.db.get(due.connectorId)))!.target;
    assert.equal(target.watchChannelId, watch.id);
    assert.equal(target.watchResourceId, "new-res");
    assert.equal(target.watchExpiresAt, NOW + 604_800_000);
    assert.equal(target.watchRenewedAt, NOW);
  });

  it("the poll cron covers only active import and bidirectional connectors", async () => {
    const t = convexTest({ schema, modules });
    await seedGoogleConnector(t, { direction: "import" });
    await seedGoogleConnector(t, { direction: "bidirectional" });
    await seedGoogleConnector(t, { direction: "export" });
    await seedGoogleConnector(t, { direction: "import", state: "needs_reauth" });
    await t.mutation(internal.googleCalendarConnector.enqueuePolls, {});
    assert.equal(await pendingPolls(t), 2);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `watchChannelToken`, `ensureWatch`, the notify route, `notifyTarget`, `enqueuePoll`, `enqueuePolls`, `renewWatches`, the two crons, and the `ensureWatch(ctx, connector, false)` call at the end of `reconcile`.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**

```bash
git add convex/_googleCalendar.ts convex/googleCalendarConnector.ts convex/eventSyncKinds/googleCalendar.ts convex/http.ts convex/crons.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): push and poll Google Calendar changes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: OAuth connect and reconnect

**Files:**

- Create: `apps/web/src/lib/server/google-connector-oauth.ts`, `apps/web/src/app/api/connectors/google/start/route.ts`, `apps/web/src/app/api/connectors/google/callback/route.ts`, `tests/web/google-connector-oauth.test.ts`
- Modify: `convex/googleCalendarConnector.ts`, `infra/terraform/vercel/main.tf`, `infra/terraform/vercel/variables.tf`, `infra/terraform/vercel/terraform.tfvars.example`, `docs/deployment/convex-environments.md`
- Test: `tests/web/google-connector-oauth.test.ts`, `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: `convexAuthToken`, `viewerQuery`, `unauthenticatedRedirectResponse`, `isUnauthenticatedError` from `apps/web/src/lib/server/auth.ts`; `convexHttpClient`, `convexAdminHttpClient` from `apps/web/src/lib/server/convex-http.ts`; `resolveSameOriginUrl`, `appendReturnPathQuery` from `@/lib/return-path`; `requireConnectorAuthority`; Task 5 `ensureWatch` runs later through `reconcile`.
- Produces, web lib:

```ts
export const GOOGLE_CONNECTOR_SCOPES = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"] as const;
export const GOOGLE_CONNECTOR_STATE_COOKIE = "vrdex_google_connector_state";
export type GoogleConnectorState = { state: string; communitySlug: string; connectorId?: string };
export function googleAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string;
export function encodeStateCookie(value: GoogleConnectorState): string; // base64url JSON
export function readStateCookie(cookie: string | undefined, queryState: string | null): GoogleConnectorState | null;
export function exchangeGoogleCode(input: { code: string; redirectUri: string; clientId: string; clientSecret: string; fetchImplementation?: typeof fetch }): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scopes: string[]; externalAccountId: string }>;
```

- Produces, Convex: `internal.googleCalendarConnector.authorizeConnect` internalQuery `{ actorUserId: v.id("users"), communitySlug: v.string(), connectorId: v.optional(v.id("eventConnectors")) }` returning `{ communityProfileId }` (throws `CONNECTOR_KIND_DISABLED` when the flag is off, `CONNECTOR_FORBIDDEN` from `requireConnectorAuthority`, and `CONNECTOR_NOT_FOUND` when `connectorId` is not a Google connector of that community); `internal.googleCalendarConnector.storeCredential` internalAction `{ actorUserId, communitySlug, connectorId?, accessToken, refreshToken, expiresAt, scopes, externalAccountId }` returning `{ credentialId }`, which re-runs `authorizeConnect`, encrypts both tokens, inserts the credential (`provider: "google"`, `ownerUserId: actorUserId`, `state: "active"`), and for a reconnect sets the connector's `credentialId`, `state: "active"`, clears `lastError`, and enqueues `reconcile`; `api.googleCalendarConnector.listCalendars` action `{ credentialId }` (caller must be `ownerUserId`, else `CONNECTOR_FORBIDDEN`) returning `Array<{ id; summary; primary? }>`; `api.googleCalendarConnector.enabled` query returning `boolean`.

Decisions:

- `externalAccountId` comes from `POST https://oauth2.googleapis.com/tokeninfo` with form body `access_token`, field `sub`. The fixed scope list has no `openid`, so Google returns no ID token and userinfo is not readable.
- The code exchange happens in the web callback (it holds the client secret per the master contract); Convex encrypts, because only Convex holds `VRDEX_CONNECTOR_TOKEN_KEY`. Tokens cross web to Convex once, over the admin client.
- Exchange throws `GOOGLE_REFRESH_TOKEN_MISSING` without `refresh_token` and `GOOGLE_SCOPES_MISSING` when the returned `scope` lacks either required scope.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax` (Google returns by top-level GET), `Path=/api/connectors/google`, `Max-Age=600`. The callback always deletes it. `readStateCookie` compares states with a constant-time compare.
- `redirect_uri` is `request.nextUrl.origin + "/api/connectors/google/callback"`; register it per environment in the Google console.
- Start route: `GET ?community=SLUG&connectorId=ID`; resolve the session actor with `viewerQuery` (pattern: `sessionActor` in `apps/web/src/lib/server/event-intake-session.ts`), call `authorizeConnect` through `convexAdminHttpClient()`, set the cookie, redirect to Google. No session redirects to sign-in; any refusal redirects to the Integrations page with `?googleCalendar=failed`.
- Callback outcomes: invalid state redirects to `/account?googleCalendar=failed` without contacting Google; `error=access_denied` returns to the Integrations page with no status; success redirects to `/account/communities/SLUG/integrations?googleCredential=CREDENTIAL_ID` (new) or to the page with no query (reconnect); any other failure uses `googleCalendar=failed`.
- Credential ownership on `eventConnectors.create` is plan 02's (`CONNECTOR_CREDENTIAL`); this plan adds no check there.
- Terraform: copy the Twitch pattern (`manage_twitch`, `twitch_keys`, `twitch_values`, `twitch_standard`, `twitch_staging_custom`) as `google_connector_client_id` and `google_connector_client_secret` variables (sensitive, nullable, default null), `manage_google_connector`, `google_connector_keys`, `google_connector_values`, and resources `google_connector_standard`, `google_connector_staging_custom`, comment `Server-only Google OAuth client for the Google Calendar connector.` Add both to `terraform.tfvars.example`.
- `docs/deployment/convex-environments.md` gains a Google Calendar connector section: `GOOGLE_CONNECTOR_CLIENT_ID` and `GOOGLE_CONNECTOR_CLIENT_SECRET` (Convex and web, BASIC owns the Google Cloud OAuth client, rotate by adding a new client secret in the console, setting it on Convex and through Terraform for web, then deleting the old secret), `VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED` (Convex, default off), and the redirect URIs to register.

- [ ] **Step 1: Write the failing web tests** (`tests/web/google-connector-oauth.test.ts`)

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { GOOGLE_CONNECTOR_SCOPES, encodeStateCookie, exchangeGoogleCode, googleAuthorizeUrl, readStateCookie } from "../../apps/web/src/lib/server/google-connector-oauth";

it("builds the consent URL with the fixed scopes, offline access, and forced consent", () => {
  const url = new URL(googleAuthorizeUrl({ clientId: "client-id", redirectUri: "https://vrdex.test/api/connectors/google/callback", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), GOOGLE_CONNECTOR_SCOPES.join(" "));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "s1");
});

it("accepts only a cookie whose state matches the query", () => {
  const cookie = encodeStateCookie({ state: "s1", communitySlug: "basic-nights" });
  assert.deepEqual(readStateCookie(cookie, "s1"), { state: "s1", communitySlug: "basic-nights" });
  assert.equal(readStateCookie(cookie, "s2"), null);
  assert.equal(readStateCookie(undefined, "s1"), null);
  assert.equal(readStateCookie("not-base64-json", "s1"), null);
  assert.equal(readStateCookie(cookie, null), null);
});

const tokenFetch = (token: Record<string, unknown>): typeof fetch => async (input) =>
  String(input).endsWith("/tokeninfo") ? Response.json({ sub: "google-sub-1" }) : Response.json(token);

it("exchanges a code and reads the account subject", async () => {
  const result = await exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: tokenFetch({ access_token: "a", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES.join(" ") }) });
  assert.equal(result.refreshToken, "rt");
  assert.equal(result.externalAccountId, "google-sub-1");
});

it("refuses a grant missing a required scope", async () => {
  await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: tokenFetch({ access_token: "a", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES[0] }) }), /GOOGLE_SCOPES_MISSING/);
});

it("refuses a grant without a refresh token", async () => {
  await assert.rejects(exchangeGoogleCode({ code: "c", redirectUri: "r", clientId: "i", clientSecret: "s",
    fetchImplementation: tokenFetch({ access_token: "a", expires_in: 3600, scope: GOOGLE_CONNECTOR_SCOPES.join(" ") }) }), /GOOGLE_REFRESH_TOKEN_MISSING/);
});
```

Add one route test in the module-hook style of `tests/web/media-review-storage-route.test.ts` (mock `@/lib/server/auth` and `@/lib/server/convex-http`, import `apps/web/src/app/api/connectors/google/callback/route.ts`): a request with `?code=c&state=s2` and cookie state `s1` gets a redirect whose `location` ends `/account?googleCalendar=failed`, a `set-cookie` that expires `vrdex_google_connector_state`, no admin client call, and no `fetch` call.

- [ ] **Step 2: Write the failing backend tests** (append to `tests/backend/google-calendar-connector.test.ts`)

```ts
describe("google calendar connect", () => {
  beforeEach(setupEnv);
  const grant = { accessToken: "a", refreshToken: "rt", expiresAt: NOW + 3_600_000, scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"], externalAccountId: "google-sub-2" };

  it("stores an encrypted credential for an authorised staffer", async () => {
    const t = convexTest({ schema, modules });
    const { staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const { credentialId } = await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", ...grant });
    const credential = (await t.run((ctx) => ctx.db.get(credentialId)))!;
    assert.notEqual(credential.encryptedRefreshToken, "rt");
    assert.equal(await decryptSecret(credential.encryptedRefreshToken), "rt");
    assert.equal(credential.ownerUserId, staffUserId);
  });

  it("refuses a user without manage_integrations", async () => {
    const t = convexTest({ schema, modules });
    const { outsiderUserId } = await seedGoogleConnector(t, { direction: "import" });
    await assert.rejects(t.query(internal.googleCalendarConnector.authorizeConnect, { actorUserId: outsiderUserId, communitySlug: "basic-nights" }), /CONNECTOR_FORBIDDEN/);
  });

  it("reconnect swaps the credential, reactivates, and enqueues reconcile", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, staffUserId, credentialId: old } = await seedGoogleConnector(t, { direction: "import", state: "needs_reauth" });
    const { credentialId } = await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", connectorId, ...grant });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.notEqual(credentialId, old);
    assert.equal(connector.credentialId, credentialId);
    assert.equal(connector.state, "active");
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).some((j) => j.kind === "reconcile" && j.state === "pending"));
  });
});
```

- [ ] **Step 3: Run both suites and see them fail.** `node --import tsx --test tests/web/google-connector-oauth.test.ts` and the backend command.
- [ ] **Step 4: Implement the web lib, both routes, the four Convex functions, Terraform, and the env docs.**
- [ ] **Step 5: Verify**

Run: both test commands, `pnpm typecheck:web`, `pnpm typecheck:backend`, `terraform -chdir=infra/terraform/vercel validate` (after `init -backend=false`), `pnpm exec markdownlint-cli2 docs/deployment/convex-environments.md`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/google-connector-oauth.ts apps/web/src/app/api/connectors/google convex/googleCalendarConnector.ts infra/terraform/vercel docs/deployment/convex-environments.md tests/web/google-connector-oauth.test.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): connect Google Calendar through VRDex's OAuth client" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Integrations page controls

**Files:**

- Create: `apps/web/src/app/account/communities/[slug]/club-google-calendar.tsx`
- Modify: `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx` (plan 02)

**Interfaces:**

- Consumes: `useClubWorkspace().community` (`_id`, `slug`) from `club-workspace.tsx`; `api.googleCalendarConnector.enabled`, `api.googleCalendarConnector.listCalendars`, `api.eventConnectors.create`, `api.eventConnectors.listForCommunity`; `Button`, `Card`, `Field`, `Select`, `Notice` from `@/components/ui/*`.
- Produces: `export function GoogleCalendarConnect(): JSX.Element`.

Behaviour:

- Hidden when `enabled` is false.
- `Connect Google Calendar` is a link to `/api/connectors/google/start?community=SLUG`.
- With `?googleCredential=ID` in the URL: call `listCalendars`, show a `Calendar` select (primary first) and a direction select with `Import`, `Export`, `Both`, `Off` mapped to `import`, `export`, `bidirectional`, `off`, default `import`, and `Save`, which calls `create` with `kind: "google_calendar"`, `mode: "hold"` (the row's mode picker changes it), `target: { calendarId }`, and `credentialId`, then drops the query param.
- Each Google row in plan 02's list in state `needs_reauth` shows `Reconnect`, a link to `/api/connectors/google/start?community=SLUG&connectorId=ID`. Disconnect, direction, and mode stay plan 02's row controls; confirm the direction picker offers all four directions for `google_calendar`.
- `?googleCalendar=failed` shows `Notice variant="error"` with `Google Calendar did not connect. Try again.`

- [ ] **Step 1: Implement the component and mount it on the Integrations page.**
- [ ] **Step 2: Typecheck and lint.** Run `pnpm typecheck:web` and `pnpm lint:web`; expect PASS.
- [ ] **Step 3: Visual verification.** Run the web app against local Convex with the flags on, open the Integrations page in three states (flag on with no connector, picker after `?googleCredential=` with a stubbed `listCalendars`, a `needs_reauth` row), capture desktop and mobile screenshots, and run a VLM review against the repo UI rules (subtle radii, no badges for state, no explanatory copy). Attach the screenshots to the PR.
- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/account/communities/[slug]/club-google-calendar.tsx" "apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx"
git commit -m "feat(connectors): add Google Calendar connect and reconnect controls" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The PR description lists the shipped strings (`Connect Google Calendar`, `Calendar`, `Import`, `Export`, `Both`, `Off`, `Save`, `Reconnect`, `Google Calendar did not connect. Try again.`), cites the connectors spec copy table, and holds for BASIC's approval of the last sentence.

### Task 8: Watch renewal staleness alert

The spec's Observability section requires the standing email alarm when Google watch renewal has not succeeded in seven days. It folds into the daily renewal cron from Task 5, after the renewals run, so a renewal that just failed is what gets reported.

**Files:**

- Modify: `convex/_googleCalendar.ts`, `convex/googleCalendarConnector.ts` (`renewWatches`)
- Test: `tests/backend/google-calendar-connector.test.ts`

**Interfaces:**

- Consumes: `notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void>` and `resolveOps(ctx, key: string): Promise<void>` from `convex/_opsAlerts.ts` (plan 02; `notifyOps` dedupes per key per six hours and adds the `[VRDex ops]` subject prefix; `resolveOps` sends the Resolved email only when that key is alerting, so calling it on every healthy check is safe); `target.watchRenewedAt` and `ensureWatch` from Task 5.
- Produces, in `convex/_googleCalendar.ts`:

```ts
export type OpsAlert = { key: string; subject: string; body: string };
export function reportStaleWatches(connectors: Doc<"eventConnectors">[], now: number, notify: (alert: OpsAlert) => Promise<void>, resolve: (key: string) => Promise<void>): Promise<number>; // returns alerts sent
```

Rule: a connector is stale when it is `kind: "google_calendar"`, `state: "active"`, direction `import` or `bidirectional`, and either `target.watchExpiresAt < now` or `now - (target.watchRenewedAt ?? connector.createdAt) >= 7 * 86_400_000`. `needs_reauth` and `paused` connectors are excluded; the settings page already shows them with Reconnect. Alert: `key` `google_watch_renewal_stale:` plus the connector ID, `subject` `Google Calendar watch renewal stale`, `body` naming the connector ID, community profile ID, `watchExpiresAt`, `watchRenewedAt`, and `lastError`. Ops email, not public copy. Every eligible connector that is not stale (its renewal succeeded) gets `resolve` with the same key, which closes an earlier alert.

`renewWatches` wraps each connector's `ensureWatch` in its own try/catch (writing the error to `lastError`) so one failure neither stops the others nor skips the check, then re-reads the Google connectors and calls `reportStaleWatches(connectors, Date.now(), (alert) => notifyOps(ctx, alert), (key) => resolveOps(ctx, key))`. Flag off: no renewal and no check.

- [ ] **Step 1: Write the failing test**

```ts
describe("google calendar watch staleness alert", () => {
  const DAY = 86_400_000;
  const connector = (id: string, fields: { direction?: string; state?: string; target?: Record<string, unknown>; createdAt?: number }) => ({
    _id: id, kind: "google_calendar", direction: fields.direction ?? "import", state: fields.state ?? "active",
    communityProfileId: "community-1", target: { calendarId: "cal-1", ...fields.target }, createdAt: fields.createdAt ?? NOW - 30 * DAY, updatedAt: NOW,
  }) as unknown as Doc<"eventConnectors">;

  it("alerts on an expired or unrenewed watch, resolves renewed ones, and ignores the rest", async () => {
    const sent: OpsAlert[] = [];
    const resolved: string[] = [];
    const count = await reportStaleWatches([
      connector("expired", { target: { watchExpiresAt: NOW - 1, watchRenewedAt: NOW - DAY } }),
      connector("unrenewed", { direction: "bidirectional", target: { watchExpiresAt: NOW + DAY, watchRenewedAt: NOW - 7 * DAY } }),
      connector("never-watched", { target: {} }),
      connector("healthy", { target: { watchExpiresAt: NOW + 6 * DAY, watchRenewedAt: NOW - DAY } }),
      connector("export-only", { direction: "export", target: { watchExpiresAt: NOW - 1 } }),
      connector("needs-reauth", { state: "needs_reauth", target: { watchExpiresAt: NOW - 1 } }),
      connector("new-no-watch-yet", { target: {}, createdAt: NOW - DAY }),
    ], NOW, async (alert) => { sent.push(alert); }, async (key) => { resolved.push(key); });
    assert.equal(count, 3);
    assert.deepEqual(sent.map((alert) => alert.key), [
      "google_watch_renewal_stale:expired",
      "google_watch_renewal_stale:unrenewed",
      "google_watch_renewal_stale:never-watched",
    ]);
    assert.ok(sent.every((alert) => alert.subject === "Google Calendar watch renewal stale"));
    assert.match(sent[0].body, /expired/);
    assert.deepEqual(resolved, ["google_watch_renewal_stale:healthy", "google_watch_renewal_stale:new-no-watch-yet"]);
  });
});
```

- [ ] **Step 2: Run it and see it fail** (`reportStaleWatches` not exported).
- [ ] **Step 3: Implement `reportStaleWatches` and wire it, with per-connector try/catch, into `renewWatches`.**
- [ ] **Step 4: Run the backend test command and see the whole file pass,** including Task 5's renewal test.
- [ ] **Step 5: Commit**

```bash
git add convex/_googleCalendar.ts convex/googleCalendarConnector.ts tests/backend/google-calendar-connector.test.ts
git commit -m "feat(connectors): alert when Google watch renewal goes stale" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
