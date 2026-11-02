# VRChat Calendar (Event Platform 09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `vrchat_calendar` connector kind: VRDex events export to, import from, or sync both ways with a community's VRChat group calendar, with every VRChat call riding the existing club operations queue and its collector worker.

**Architecture:** Four new club operation payload kinds (three writes and one read) carry calendar work to the collector worker in `workers/group-telemetry/`, which executes them under the existing claim, authorize, complete protocol. A connector sync job never calls VRChat: its handler runs one Convex mutation that advances a small state machine stored on the job payload (read for a match, then write), enqueues the next club operation, and returns plan 02's `AwaitingClubOperation` sentinel so the runner's `awaitJob` keeps the job `running`. When the operation reaches a terminal state, `patchOperation` in `convex/clubOperations.ts` (the funnel every terminal transition already passes through) expires the job's lease and schedules `internal.eventSync.runJob`, which re-enters the handler and settles the job from the operation's result. Imports diff a `list_calendar_events` result against link rows and hand changed items to `import_item` jobs.

**Tech Stack:** Convex (internal mutations, actions, crons), the group telemetry collector (plain Node 24 `.mjs`, no dependencies), VRChat API (`/calendar/{groupId}`, `/file/image`), Next.js client component, `node:test` with `convex-test`.

**Spec:** `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (The model, Connecting, Directions and field ownership, VRChat calendar, Settings page). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md`. Operation protocol: `docs/planning/group-instance-analytics/operation-backend-contract.md`. VRChat reference: `D:\bench\vrchat-mcp\src\services\events\curated.ts`, `src\services\groups\curated.ts`, `specs\vrchat-openapi.yaml` (paths `/calendar/{groupId}`, `/calendar/{groupId}/event`, `/calendar/{groupId}/{calendarId}`, `/calendar/{groupId}/{calendarId}/event`, `/file/image`), and `src\core\client.ts` `uploadGalleryImageMultipart`.

## Global Constraints

- Depends on plan 02 being merged: `eventConnectors`, `eventSyncLinks`, `eventSyncJobs`, `enqueueSyncJob`, `internal.eventSync.runJob`, `claimJob`, `completeJob`, `failJob`, `SyncKindHandler`, `syncKindHandlers`, `carriedFields`, `carriedFieldsHash`, `requireConnectorAuthority`, `applyEventCandidate`, `api.eventConnectors.create`, and the Integrations page `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx`. Use the master plan's names. From plan 02 Task 3 this plan also consumes, without redefining: the `AwaitingClubOperation` sentinel (a `unique symbol` a handler returns, never throws) and `OPERATION_WAIT_MS` from `convex/eventSyncKinds/types.ts`, the trailing `job: Doc<"eventSyncJobs">` on every handler method, `internal.eventSync.awaitJob`, `claimJob`'s acceptance of a `running` job whose lease has expired, and `correctionFields(db, event)` from `convex/eventCorrections.ts` (the fields the runner hashes after an export). From plan 08: `candidateFromConnectorFields(kind, fields, decision)` in `convex/_eventCandidateApply.ts`, used as is.
- Division of labour with plan 02 (master contract): the runner writes `lastExportedAt` and `lastExportedHash = carriedFieldsHash(kind, eventFields)` after a successful `exportUpsert`, so the kind returns only `{ externalId }`; the runner also enqueues `export_upsert` for unlinked upcoming VRDex events after reconcile, so this kind's `reconcile` only lists VRChat items, links matches, and imports the rest; `applyEventCandidate` owns the echo guard (`skipped_echo`) and the bidirectional staleness rule (`skipped_stale`), so imports pass `link`, `externalUpdatedAt`, and `expectedUpdatedAt` and never re-implement either.
- Start from `origin/main` in a fresh worktree; end in a PR to `main`; never merge. Commit by pathspec. Each commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Collector worker code lives in this repo at `workers/group-telemetry/` (`club-provider.mjs`, `club-operation-jobs.mjs`, `vrchat-client.mjs`, `worker.mjs`), built from `workers/group-telemetry/Dockerfile` and released automatically by `.github/workflows/group-telemetry-release.yml` after `main` Baseline Checks. It has no npm dependencies; keep it that way.
- Payload kinds, exactly: `create_calendar_event { title, description, startsAt, endsAt, imageUrl?, accessType: "group" }`, `update_calendar_event { calendarEventId, title, description, startsAt, endsAt, imageUrl?, accessType: "group" }`, `delete_calendar_event { calendarEventId }`, `list_calendar_events { from, to }`. Times are ISO instants. Integration feature `calendar`; staff permission `manage_events`; provider grant `group-calendar-manage` for the three writes, none for the read.
- VRChat requests: `sendCreationNotification: false` on every create and update, `accessType: "group"`, `category: "other"`. Titles are truncated in Convex to 64 characters with `…` (U+2026). No member notification, post, or DM from any path.
- Connector operations are not staff actions: they never carry `eventId` or an event-relative schedule (event cancellation fanout must not cancel a delete), never appear in `api.clubOperations.list`, cannot be created or edited through `api.clubOperations.enqueue` or `edit`, and file no `clubOperationNotifications` row. The connector's `lastError` is their failure surface.
- Flag `VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED` on Convex, default off, enabled only by `=== "true"`. It gates the handler, `enqueuePolls`, connector create, and the Connect button. Turn it on only after the release-readiness check shows a collector running this plan's worker.
- Carried fields: title, start, end, summary. Export only: poster artwork, and the world names plus event URL appended as the description's last paragraph. Poster, world, lineup, and venue never import.
- The runner (plan 02) emits `event_sync_job` analytics and owns the five-consecutive-failures email alarm to `basic@basicbit.net`; this plan adds no analytics and no other unattended path (the cron only enqueues runner jobs).
- Public strings this plan ships, all listed in the PR for BASIC's approval: `Connect VRChat calendar`, `Import`, `Export`, `Both` (spec copy table), and utility labels `VRChat calendar` (kind label), `Calendar` (feature label), `Manage group calendar` (provider grant label). No em-dash, no double hyphen, no AI mention. The VRChat description carries only the event's own summary, world names, and URL, no added prose.
- Backend tests: `node --conditions=import --import tsx --test tests/backend/vrchat-calendar-connector.test.ts`. Worker tests: `pnpm test:group-telemetry` (`node --test workers/group-telemetry/*.test.mjs`). Edit `convex/_generated/api.d.ts` by hand for the new module (local Convex port 3210 is shared); CI's `check:backend:generated` proves it.

## Review Focus

1. A staffer's VRDex title is 80 characters; the organiser moves the start time in VRChat. The import must change the time and keep the full VRDex title, not the 64-character copy (Task 6, `a VRChat time change keeps the full VRDex title`).
2. VRDex creates an entry after a poll's list was read but before it completed; the poll must not flag that new link as deleted (Task 6, `a link exported after the list was read is not flagged`).
3. A create comes back `indeterminate` (VRChat may have made the entry). The retry must find and link it, not create a second one (Task 5, `an indeterminate create retries through a read and links the entry`).
4. Two quick edits to a brand-new event: the second export must wait while the first create is in flight, not create a second entry (Task 5, `waits while another operation for the event is in flight`).
5. A group with more than 200 calendar entries in the window returns a truncated list; nothing may be flagged deleted from a partial read (Task 6, `a truncated list flags nothing`).

---

## Files

| File | Responsibility |
| --- | --- |
| `convex/_clubOperations.ts` (modify) | Calendar payload kinds, `staffOperationPayload`, `calendarEventItem`, `operationResult`, calendar validation. |
| `convex/_clubOperationPolicy.ts`, `convex/_clubConnection.ts` (modify) | Feature `calendar`, requirements, baseline grant. |
| `convex/clubOperations.ts` (modify) | Staff-only validators on public functions, `enqueueConnectorOperation`, terminal resume in `patchOperation`, calendar results on `complete`. |
| `convex/schema.ts` (modify) | `clubOperations.connectorSync`, `clubOperations.result`, `eventSyncLinks.externalArtworkUrl`. |
| `convex/eventSyncKinds/vrchatCalendar.ts` (create) | Pure mappers and `vrchatCalendarHandler`. |
| `convex/vrchatCalendarConnector.ts` (create) | Readiness, availability, the three advance mutations, `applyImport`, `enqueuePolls`, `resumeConnectorSyncJob`. |
| `convex/eventSyncKinds/index.ts`, `convex/eventConnectors.ts`, `convex/_eventConnectors.ts`, `convex/crons.ts` (modify) | Registration, connect gate, target `timezone`, poll cron. |
| `workers/group-telemetry/vrchat-client.mjs`, `club-provider.mjs`, `club-operation-jobs.mjs`, `worker.mjs` (modify) | Multipart upload, calendar plans, artwork, list paging, budgets, results. |
| `apps/web/src/app/account/communities/[slug]/club-vrchat-calendar.tsx` (create), `club-connection-features.tsx`, `(workspace)/integrations/page.tsx` (modify) | Connect control, labels. |
| Docs | `docs/backend/event-schema.md`, `docs/backend/community-group-telemetry.md`, `docs/planning/group-instance-analytics/operation-backend-contract.md`, `docs/deployment/convex-environments.md`. |
| Tests | `tests/backend/vrchat-calendar-operations.test.ts`, `tests/backend/vrchat-calendar-connector.test.ts`, `tests/backend/_vrchatCalendarFixture.ts`, worker `*.test.mjs`. |

### Task 1: Calendar payload kinds, feature, and policy

**Files:**

- Modify: `convex/_clubOperations.ts`, `convex/_clubOperationPolicy.ts`, `convex/_clubConnection.ts`, `convex/clubOperations.ts` (`enqueue`, `edit`, `list` validators and filter), `apps/web/src/app/account/communities/[slug]/club-connection-features.tsx`
- Test: `tests/backend/vrchat-calendar-operations.test.ts` (create)

**Interfaces:**

- Consumes: nothing new.
- Produces, in `convex/_clubOperations.ts`:

```ts
export const CALENDAR_OPERATION_KINDS = ["create_calendar_event", "update_calendar_event", "delete_calendar_event", "list_calendar_events"] as const;
export const staffOperationPayload; // v.union of today's 17 members, unchanged
export const clubOperationPayload;  // v.union(...staff members, ...four calendar members)
export type StaffOperationPayload = Infer<typeof staffOperationPayload>;
export const calendarEventItem = v.object({ id: v.string(), title: v.string(), description: v.string(), startsAt: v.string(), endsAt: v.string(), updatedAt: v.string() });
export type VrchatCalendarItem = Infer<typeof calendarEventItem>;
export const operationResult = v.object({ worldId: v.optional(v.string()), instanceId: v.optional(v.string()), postId: v.optional(v.string()),
  calendarEventId: v.optional(v.string()), calendarEvents: v.optional(v.array(calendarEventItem)), calendarEventsTruncated: v.optional(v.boolean()) });
```

- Produces: `ClubIntegrationFeature` and `integrationFeature` gain `"calendar"`; `FEATURES` appends it; `FEATURE_BASELINE.calendar = ["group-calendar-manage"]`; `ClubOperation` gains `{ kind: "create_calendar_event" | "update_calendar_event" | "delete_calendar_event" | "list_calendar_events" }`.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validatePayload, policyOperation, type OperationPayload } from "../../convex/_clubOperations";
import { assessClubOperation, clubOperationRequirement } from "../../convex/_clubOperationPolicy";

const GROUP = "grp_11111111-1111-1111-1111-111111111111";
const CAL = "cal_33333333-3333-3333-3333-333333333333";
const base = { title: "Bass Temple", description: "Weekly bass night.", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" as const };

describe("calendar operation payloads", () => {
  it("accepts the four calendar kinds", () => {
    validatePayload({ kind: "create_calendar_event", ...base, imageUrl: "https://vrdex.test/poster.png" }, GROUP);
    validatePayload({ kind: "update_calendar_event", calendarEventId: CAL, ...base }, GROUP);
    validatePayload({ kind: "delete_calendar_event", calendarEventId: CAL }, GROUP);
    validatePayload({ kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" }, GROUP);
  });

  it("rejects malformed calendar payloads", () => {
    const bad: unknown[] = [
      { kind: "create_calendar_event", ...base, title: "x".repeat(65) },
      { kind: "create_calendar_event", ...base, title: "" },
      { kind: "create_calendar_event", ...base, description: "x".repeat(2001) },
      { kind: "create_calendar_event", ...base, endsAt: base.startsAt },
      { kind: "create_calendar_event", ...base, startsAt: "next friday" },
      { kind: "create_calendar_event", ...base, imageUrl: "http://vrdex.test/poster.png" },
      { kind: "delete_calendar_event", calendarEventId: "cal_1" },
      { kind: "list_calendar_events", from: "2027-01-31T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" },
      { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-02-03T00:00:00.000Z" },
    ];
    for (const payload of bad) assert.throws(() => validatePayload(payload as OperationPayload, GROUP), JSON.stringify(payload));
  });

  it("calendar kinds need the calendar feature and manage_events", () => {
    for (const kind of ["create_calendar_event", "update_calendar_event", "delete_calendar_event"] as const)
      assert.deepEqual(clubOperationRequirement({ kind }), { feature: "calendar", permission: "manage_events", providerPermissions: ["group-calendar-manage"] });
    assert.deepEqual(clubOperationRequirement({ kind: "list_calendar_events" }), { feature: "calendar", permission: "manage_events", providerPermissions: [] });
  });

  it("assessment denies a calendar write without the feature, the permission, or the grant", () => {
    const now = 1_000_000;
    const authority = {
      actorKind: "staff" as const, permissions: ["manage_events" as const], enabledFeatures: ["calendar" as const], integrationActive: true,
      expectedGroupId: GROUP, expectedBotUserId: "usr_22222222-2222-2222-2222-222222222222", permittedProviderRoleIds: [], now,
      provider: { groupId: GROUP, userId: "usr_22222222-2222-2222-2222-222222222222", membershipStatus: "member", permissions: ["group-calendar-manage"], observedAt: now },
    };
    const op = policyOperation({ kind: "create_calendar_event", ...base }, "public");
    assert.equal(assessClubOperation(authority, op).allowed, true);
    assert.equal(assessClubOperation({ ...authority, enabledFeatures: ["posts"] }, op).reason, "feature_disabled");
    assert.equal(assessClubOperation({ ...authority, permissions: ["manage_integrations"] }, op).reason, "staff_permission");
    assert.equal(assessClubOperation({ ...authority, provider: { ...authority.provider, permissions: [] } }, op).reason, "provider_permissions");
  });
});
```

Add one `convex-test` case in the same file using the setup shape from `tests/backend/club-operations.test.ts` (owner identity, integration with `enabledFeatures: ["calendar"]`): `api.clubOperations.enqueue` with `payloads: [{ kind: "create_calendar_event", ...base }]` rejects with an argument validation error, and `api.clubConnection.setFeature({ feature: "calendar", enabled: true })` leaves `enabledFeatures` containing `"calendar"`.

- [ ] **Step 2: Run** `node --conditions=import --import tsx --test tests/backend/vrchat-calendar-operations.test.ts`. Expected: FAIL (unknown kinds, unknown feature).

- [ ] **Step 3: Implement.** Split today's union members into a `const` tuple so `staffOperationPayload` and `clubOperationPayload` share them; the schema keeps `clubOperationPayload`. `validatePayload` rules: title 1 to 64; description 1 to 2000; `startsAt` and `endsAt` parse with `Date.parse` and `endsAt > startsAt`; `imageUrl` parses as a `URL` with protocol `https:` and length at most 2048; `calendarEventId` matches the existing `id(value, "cal")` helper; list `from < to` and `to - from <= 92 * 86_400_000`. `enqueue` and `edit` take `staffOperationPayload`; `list` returns `staffOperationPayload` and excludes `CALENDAR_OPERATION_KINDS` for owners too (add `q.neq` on `payload.kind` to the owner query and drop them from the staff `visibleKinds` list). Feature labels gain `calendar: "Calendar"`, permission labels gain `"group-calendar-manage": "Manage group calendar"`. `operationLabels` in `club-operation-model.ts` stays unchanged because its type derives from `enqueue`.

- [ ] **Step 4: Run** the test file, then `pnpm typecheck:backend` and `pnpm typecheck:web`. Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add convex/_clubOperations.ts convex/_clubOperationPolicy.ts convex/_clubConnection.ts convex/clubOperations.ts "apps/web/src/app/account/communities/[slug]/club-connection-features.tsx" tests/backend/vrchat-calendar-operations.test.ts
git commit -m "feat(club): add VRChat calendar operation kinds and feature" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/_clubOperations.ts convex/_clubOperationPolicy.ts convex/_clubConnection.ts convex/clubOperations.ts "apps/web/src/app/account/communities/[slug]/club-connection-features.tsx" tests/backend/vrchat-calendar-operations.test.ts
```

### Task 2: Connector operations and the terminal callback

**Files:**

- Modify: `convex/schema.ts`, `convex/clubOperations.ts`
- Create: `convex/vrchatCalendarConnector.ts` (only `vrchatCalendarReadiness` and `resumeConnectorSyncJob` in this task), `tests/backend/_vrchatCalendarFixture.ts`
- Test: `tests/backend/vrchat-calendar-operations.test.ts`

**Interfaces:**

- Consumes: Task 1 validators; plan 02's `eventSyncJobs`, `eventConnectors`.
- Produces, in `convex/schema.ts`: `clubOperations` gains `connectorSync: v.optional(v.object({ connectorId: v.id("eventConnectors"), jobId: v.id("eventSyncJobs") }))` and its `result` becomes `v.optional(operationResult)`; `eventSyncLinks` gains `externalArtworkUrl: v.optional(v.string())` (used in Task 5).
- Produces, in `convex/clubOperations.ts`:

```ts
export type ConnectorOperationRefusal = "integration_unavailable" | "feature_disabled" | "staff_permission";
export async function enqueueConnectorOperation(ctx: MutationCtx, args: {
  connector: Doc<"eventConnectors">; payload: OperationPayload; syncJobId: Id<"eventSyncJobs">;
}): Promise<{ operationId: Id<"clubOperations"> } | { refused: ConnectorOperationRefusal }>;
```

- Produces, in `convex/vrchatCalendarConnector.ts`:

```ts
export type ReadinessCode = "no_integration" | "integration_inactive" | "no_collector_account" | "feature_disabled";
export async function vrchatCalendarReadiness(db: DatabaseReader, communityProfileId: Id<"profiles">):
  Promise<{ ready: true; integration: Doc<"communityVrchatIntegrations"> } | { ready: false; code: ReadinessCode }>;
export async function resumeConnectorSyncJob(ctx: MutationCtx, operation: Doc<"clubOperations">): Promise<void>;
```

- Produces, test fixture `tests/backend/_vrchatCalendarFixture.ts`:

```ts
export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const SITE = "https://vrdex.test";
export const EVENT_URL = "https://vrdex.test/basic-nights/events/bass-temple-nov-7";
export const GROUP_ID = "grp_11111111-1111-1111-1111-111111111111";
export const BOT_ID = "usr_22222222-2222-2222-2222-222222222222";
export const calId = (n: number) => `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const CAL_1 = calId(1);
export const modules: Record<string, () => Promise<unknown>>; // _generated/api, http, clubOperations, clubConnection, eventSync, eventConnectors, vrchatCalendarConnector, plus what plan 02's apply path registers
export function setupEnv(test: TestContext): void;
// VRDEX_EVENT_CONNECTORS_ENABLED and VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED "true", SITE_URL = SITE,
// CLERK_JWT_ISSUER_DOMAIN "https://test.clerk.accounts.dev", Date.now mocked at NOW
export async function seedVrchatConnector(t: TestConvex<typeof schema>, options?: {
  direction?: ConnectorDirection; mode?: ConnectorMode; features?: string[]; assigned?: boolean;
  authority?: "owner" | "integrations_only"; connector?: boolean;
}): Promise<{ connectorId?: Id<"eventConnectors">; communityProfileId: Id<"profiles">; integrationId: Id<"communityVrchatIntegrations">; collectorAccountId: Id<"collectorAccounts">; authorityUserId: Id<"users"> }>;
// community "basic-nights" owned by users row clerkUserId "owner"; collector account vrchatUserId BOT_ID, state ready,
// workerKeyHash "hash", credentialGeneration 1; integration GROUP_ID, state active, enabledFeatures default ["calendar"],
// assignedCollectorAccountId unless assigned false, telemetryEpochStartedAt NOW - 1000; active lease workerId "worker",
// fencingToken 1, expiresAt NOW + 600_000; connector (unless connector false) kind vrchat_calendar, direction default "export",
// mode default "autopublish", state active, target { groupId: GROUP_ID, timezone: "America/New_York" };
// "integrations_only" makes a second user (clerkUserId "staff") with a communityRoles row of ["manage_integrations"] the authority;
// with connector false that staff user still exists, for Task 7's create test.
// Row shapes: tests/backend/club-operations.test.ts setup().
export function asOwner(t: TestConvex<typeof schema>): TestConvexForDataModel<DataModel>; // identity subject "owner"
export function asStaff(t: TestConvex<typeof schema>): TestConvexForDataModel<DataModel>; // identity subject "staff"
export async function seedEvent(t, communityProfileId, overrides?: Partial<Doc<"events">>): Promise<Id<"events">>;
// defaults as plan 08: title "Bass Temple", slug "bass-temple-nov-7", eventDate "2026-11-07", timezone "America/New_York",
// scheduleKind "timed", startAt Date.parse("2026-11-08T01:00:00.000Z"), endAt Date.parse("2026-11-08T04:00:00.000Z"),
// summary "Weekly bass night.", eventStatus "scheduled", publicationState "published", sourceType "community", updatedAt NOW - 60_000
export function eventDoc(overrides?: Partial<Doc<"events">>): Doc<"events">; // same defaults, no database
export function vrchatItem(overrides?: Partial<VrchatCalendarItem>): VrchatCalendarItem;
// id CAL_1, title "Bass Temple", description "Weekly bass night.\n\n" + EVENT_URL,
// startsAt "2026-11-08T01:00:00.000Z", endsAt "2026-11-08T04:00:00.000Z", updatedAt "2026-11-02T11:00:00.000Z"
export async function runSyncJob(t, job: { connectorId; kind: Doc<"eventSyncJobs">["kind"]; eventId?; payload? }): Promise<Doc<"eventSyncJobs">>;
// inserts a pending job (attempts 0) due at NOW, runs internal.eventSync.runJob, returns the row
export async function rerunJob(t, jobId: Id<"eventSyncJobs">): Promise<Doc<"eventSyncJobs">>;
export async function workerSettle(t, outcome: { status: "succeeded" | "rejected" | "indeterminate"; code?: string; result?: Infer<typeof operationResult> }): Promise<Doc<"clubOperations">>;
// internal.clubOperations.claim, then authorizeSubmission with authority { groupId: GROUP_ID, userId: BOT_ID,
// ownerUserId: "usr_99999999-9999-9999-9999-999999999999", membershipStatus: "member", permissions: ["group-calendar-manage"],
// observedAt: Date.now() }, then complete; worker args as tests/backend/club-operations.test.ts queued(); returns the row
export async function operations(t): Promise<Doc<"clubOperations">[]>; // creation order
```

- [ ] **Step 1: Write the failing tests** (append to `tests/backend/vrchat-calendar-operations.test.ts`)

```ts
describe("connector operations", () => {
  beforeEach(setupEnv);
  const create = { kind: "create_calendar_event" as const, title: "Bass Temple", description: EVENT_URL, startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" as const };
  const job = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">) =>
    t.run((ctx) => ctx.db.insert("eventSyncJobs", { connectorId, kind: "export_upsert", payload: {}, dueAt: NOW, attempts: 0, state: "running", leaseExpiresAt: NOW + 1_800_000, createdAt: NOW, updatedAt: NOW }));

  it("enqueues an immediate operation as the connector authority with no event", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    const [op] = await operations(t);
    assert.deepEqual(out, { operationId: op._id });
    assert.equal(op.actor.tokenIdentifier, "https://test.clerk.accounts.dev|owner");
    assert.deepEqual(op.schedule, { kind: "immediate" });
    assert.equal(op.eventId, undefined);
    assert.deepEqual(op.connectorSync, { connectorId, jobId });
    assert.equal(op.state, "pending");
    assert.equal(op.dueAt, NOW);
  });

  it("refuses without the feature, without manage_events, or without a collector", async () => {
    for (const [options, refused] of [
      [{ features: ["posts"] }, "feature_disabled"],
      [{ authority: "integrations_only" as const }, "staff_permission"],
      [{ assigned: false }, "integration_unavailable"],
    ] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId } = await seedVrchatConnector(t, options);
      const jobId = await job(t, connectorId!);
      const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
      assert.deepEqual(out, { refused });
      assert.equal((await operations(t)).length, 0);
    }
  });

  it("a terminal connector operation resumes its job, files no notice, and stays out of the staff list", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    await t.run((ctx) => ctx.db.patch(jobId, { payload: { operationId: (out as { operationId: Id<"clubOperations"> }).operationId, step: "write" } }));
    const listed = await asOwner(t).query(api.clubOperations.list, { communityProfileId, paginationOpts: { numItems: 10, cursor: null } });
    assert.equal(listed.page.length, 0);
    await workerSettle(t, { status: "rejected", code: "provider_permissions" });
    assert.ok((await t.run((ctx) => ctx.db.get(jobId)))!.leaseExpiresAt! <= NOW);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    assert.deepEqual(scheduled.filter((f) => f.name === "eventSync:runJob").map((f) => (f.args[0] as { jobId: string }).jobId), [jobId]);
    assert.deepEqual(await t.run((ctx) => ctx.db.query("clubOperationNotifications").collect()), []);
  });

  it("complete stores calendar results and refuses oversized lists", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    assert.equal((await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } })).result?.calendarEventId, CAL_1);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" }, syncJobId: jobId }));
    const items = Array.from({ length: 201 }, (_, n) => vrchatItem({ id: calId(n + 1) }));
    await assert.rejects(workerSettle(t, { status: "succeeded", result: { calendarEvents: items } }), /Invalid operation result/);
  });
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL (`enqueueConnectorOperation` missing).

- [ ] **Step 3: Implement.** Decisions the signatures leave open:
  - `enqueueConnectorOperation` builds the subject the way `convex/_clubNotifications.ts` does for owners: `{ subject: user.clerkUserId, issuer: process.env.CLERK_JWT_ISSUER_DOMAIN, tokenIdentifier: issuer + "|" + clerkUserId }` from `connector.authorityUserId`, resolves it with `resolveClubSubject`, and refuses `staff_permission` unless owner or `manage_events`. It calls `vrchatCalendarReadiness` (any not-ready code maps to `integration_unavailable` except `feature_disabled`), runs `validatePayload`, inserts one row with `requestId` and `batchId` `"sync_" + syncJobId + "_" + now`, `schedule: { kind: "immediate" }`, `dueAt` and `readyAt` now, `actor` and `createdBy` the subject, `revision: 1`, `connectorSync`, and lowers `integration.nextPollAt` to now exactly as `enqueueClubOperations` does.
  - `vrchatCalendarReadiness`: `readManagedIntegration`; `no_integration`; state not `active` or `degraded` is `integration_inactive`; no `assignedCollectorAccountId` is `no_collector_account`; `enabledClubFeatures` without `calendar` is `feature_disabled`.
  - `patchOperation` re-reads the row after patching; a row with `connectorSync` in `succeeded`, `rejected`, `indeterminate`, `missed`, or `cancelled` calls `resumeConnectorSyncJob` and skips `recordClubOperationFailure`; other rows behave as today.
  - `resumeConnectorSyncJob`: only when the job is `running` and `job.payload.operationId === operation._id`, patch `leaseExpiresAt: Date.now()` and `ctx.scheduler.runAfter(0, internal.eventSync.runJob, { jobId })`. Anything else is a stale callback and does nothing.
  - `complete` takes `result: v.optional(operationResult)` and adds to its existing check: `calendarEventId` only on create or update operations and matching the `cal_` UUID form; `calendarEvents` and `calendarEventsTruncated` only on list operations; at most 200 items; `JSON.stringify(result).length <= 500_000`. Violations throw `Invalid operation result.` (the existing message).

- [ ] **Step 4: Run** the file, `pnpm typecheck:backend`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/clubOperations.ts convex/vrchatCalendarConnector.ts convex/_generated/api.d.ts tests/backend/_vrchatCalendarFixture.ts tests/backend/vrchat-calendar-operations.test.ts
git commit -m "feat(club): run connector-owned calendar operations and resume their sync jobs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/schema.ts convex/clubOperations.ts convex/vrchatCalendarConnector.ts convex/_generated/api.d.ts tests/backend/_vrchatCalendarFixture.ts tests/backend/vrchat-calendar-operations.test.ts
```

### Task 3: Collector worker calendar execution

**Files:**

- Modify: `workers/group-telemetry/vrchat-client.mjs`, `club-provider.mjs`, `club-operation-jobs.mjs`, `worker.mjs`
- Test: `workers/group-telemetry/vrchat-client.test.mjs`, `club-provider.test.mjs`, `club-operation-jobs.test.mjs`

**Interfaces:**

- Consumes: Task 1 payload shapes, Task 2 result shape.
- Produces:

```js
// vrchat-client.mjs: request(path, { method, body, form, maxResponseBytes, allowEmptyResponse })
//   form: FormData, sent as the body with no JSON content-type header; body and form together throw.
// club-provider.mjs
export async function fetchArtwork(url, { fetcher = fetch, timeoutMs = 15_000, maxBytes = 10 * 1024 * 1024 } = {}); // -> { bytes: Uint8Array, contentType: string }
// new ClubProvider({ client, groupId, expectedUserId, clock, fetchImage = fetchArtwork })
// ClubProvider#listCalendar({ from, to }) -> { calendarEvents: Item[], calendarEventsTruncated: boolean }
// club-operation-jobs.mjs: executeClubOperation({ ..., fetchImage }) passes fetchImage to ClubProvider
```

Provider shapes (from `vrchat-openapi.yaml`): create `POST /calendar/{groupId}/event`; update `PUT /calendar/{groupId}/{calendarEventId}/event`; delete `DELETE /calendar/{groupId}/{calendarEventId}`; list `GET /calendar/{groupId}?date={month}T00:00:00.000Z&n=100&offset={o}` answering `{ results, hasNext }` (a bare array is also accepted, as vrchat-mcp's `src/core/readTools.ts` does); artwork `POST /file/image` multipart with `file` (PNG blob named `artwork.png`) and `tag: "gallery"`, answering a file record whose `id` is `file_...`, sent as the event's `imageId`.

- [ ] **Step 1: Write the failing tests**

```js
// club-provider.test.mjs (uses the existing fixture(); add "/calendar" and "/file/image" handling through `handler`)
const cal = "cal_00000000-0000-0000-0000-000000000001";
const fileId = "file_00000000-0000-0000-0000-000000000001";
const event = { title: "Bass Temple", description: "Weekly bass night.", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" };
test("create posts a group-only event with no creation notification and uploads PNG artwork first", async () => {
  const fetched = [];
  const { adapter, calls } = fixture({ handler: async (path) => path === "/file/image" ? { id: fileId } : path.startsWith("/calendar/") ? { id: cal, ownerId: groupId } : undefined });
  adapter.fetchImage = async (url) => { fetched.push(url); return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }; };
  const out = await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.png" });
  assert.equal(out.status, "succeeded");
  assert.deepEqual(fetched, ["https://vrdex.test/poster.png"]);
  const writes = calls.filter((c) => c.method && c.method !== "GET");
  assert.deepEqual(writes.map((c) => [c.method, c.path]), [["POST", "/file/image"], ["POST", `/calendar/${groupId}/event`]]);
  assert.equal(writes[0].form.get("tag"), "gallery");
  assert.equal(writes[0].form.get("file").type, "image/png");
  assert.deepEqual(writes[1].body, { ...event, category: "other", sendCreationNotification: false, imageId: fileId });
});
test("non-PNG artwork is skipped, not fatal", async () => {
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { id: cal } : undefined });
  adapter.fetchImage = async () => ({ bytes: new Uint8Array([255, 216]), contentType: "image/jpeg" });
  assert.equal((await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.jpg" })).status, "succeeded");
  assert.equal(calls.some((c) => c.path === "/file/image"), false);
  assert.equal("imageId" in calls.at(-1).body, false);
});
test("update and delete address the calendar event; long titles are refused", async () => {
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { id: cal } : undefined });
  await adapter.execute({ kind: "update_calendar_event", calendarEventId: cal, ...event });
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path, calls.at(-1).body.sendCreationNotification], ["PUT", `/calendar/${groupId}/${cal}/event`, false]);
  await adapter.execute({ kind: "delete_calendar_event", calendarEventId: cal });
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path], ["DELETE", `/calendar/${groupId}/${cal}`]);
  assert.equal((await adapter.execute({ kind: "create_calendar_event", ...event, title: "x".repeat(65) })).code, "invalid_input");
});
test("list pages each month in the window, keeps in-window items, and reports truncation", async () => {
  const item = (n, startsAt) => ({ id: `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, ownerId: groupId, title: `Night ${n}`, description: "", startsAt, endsAt: startsAt, createdAt: "2026-10-01T00:00:00.000Z" });
  const { adapter, calls } = fixture({ handler: async (path) => {
    if (!path.startsWith("/calendar/")) return undefined;
    const date = new URL(path, "https://x").searchParams.get("date");
    return { results: date.startsWith("2026-11") ? [item(1, "2026-11-01T12:00:00.000Z"), item(2, "2026-11-08T01:00:00.000Z")] : [], hasNext: false };
  } });
  const out = await adapter.execute({ kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" });
  assert.deepEqual(calls.filter((c) => c.path.startsWith("/calendar/")).map((c) => new URL(c.path, "https://x").searchParams.get("date")),
    ["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  assert.deepEqual(out.result, { calendarEvents: [{ id: item(2).id, title: "Night 2", description: "", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T01:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }], calendarEventsTruncated: false });
});
```

```js
// club-operation-jobs.test.mjs: setup() gains a `payload` option (default the ban payload) and the provider fake answers
// "/calendar/" and "/file/image"; executeClubOperation receives fetchImage returning a PNG.
test("calendar create authorizes once, before the artwork upload, and reports the calendar event id", async () => {
  const { args, order, sends } = setup({ payload: { kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.png" } });
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  assert.equal(order.filter((x) => x === "club_operation_authorize").length, 1);
  assert.equal(order[order.indexOf("provider-write") - 1], "club_operation_authorize");
  assert.equal(sends.find((s) => s.op === "budget").body.requestCount, 3);
  assert.deepEqual(sends.at(-1).body.result, { calendarEventId: cal });
});
test("calendar list authorizes before its first calendar read and completes with the items", async () => {
  const { args, order, sends } = setup({ payload: { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" } });
  assert.equal((await executeClubOperation(args)).status, "succeeded");
  assert.ok(order.indexOf("club_operation_authorize") < order.indexOf("provider-calendar-read"));
  assert.equal(sends.find((s) => s.op === "budget").body.requestCount, 2);
  assert.deepEqual(Object.keys(sends.at(-1).body.result).sort(), ["calendarEvents", "calendarEventsTruncated"]);
});
```

Add to `vrchat-client.test.mjs`: `request(path, { method: "POST", form })` hands the `FormData` to the fetcher as `body` and sets no `content-type` header.

- [ ] **Step 2: Run** `node --test workers/group-telemetry/club-provider.test.mjs workers/group-telemetry/club-operation-jobs.test.mjs workers/group-telemetry/vrchat-client.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement.** Decisions:
  - `execute` fetches artwork first, before `readAuthority`, so a slow image host cannot age the 30-second preflight evidence. A fetch failure, a non-`https:` URL, a body over 10 MB, or a content type other than `image/png` drops the artwork and continues (`// ponytail: PNG only, no conversion in a dependency-free worker; add a PNG rendition route on the web app if posters are mostly JPEG or WebP`).
  - `plan()` validates calendar payloads with the existing helpers (`keys`, `text(title, 64)`, `text(description, 2000)`, `instant`, `id(…, "cal")`, `choice(accessType, ["group"])`) and sets permissions `["group-calendar-manage"]` for the writes. Create and update validate `id(result.id, "cal")`, update also `result.id === calendarEventId`; delete uses `allowEmptyResponse` and accepts `null` or an object.
  - `listCalendar`: UTC month keys from `from` to `to` inclusive, pages of 100 until `hasNext` is false, drops items with a non-null `deletedAt` or whose `startsAt` is outside `[from, to)`, de-duplicates by `id`, maps to `{ id, title, description: description.slice(0, 4000), startsAt, endsAt, updatedAt: updatedAt ?? createdAt ?? startsAt }`, rejects an item whose `ownerId` is present and not the group (`provider_scope`), and stops at 200 items with `calendarEventsTruncated: true`.
  - `executeClubOperation`: `freshRequestCount` is 3 for create or update with `imageUrl`, 2 for the other calendar kinds; later list pages reserve one request each through the existing budget loop. `beforeRequest` authorizes on the first request that is a write or a `/calendar/` read and never again in the same operation; `transportAttempted` is set by the same condition. On success it sends `result.calendarEventId` (create: `outcome.result.id`; update: the payload's `calendarEventId`) or the list's `{ calendarEvents, calendarEventsTruncated }`.
  - `worker.mjs` passes nothing new; the default `fetchArtwork` applies.

- [ ] **Step 4: Run** `pnpm test:group-telemetry`. Expected: PASS, existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add workers/group-telemetry/vrchat-client.mjs workers/group-telemetry/club-provider.mjs workers/group-telemetry/club-operation-jobs.mjs workers/group-telemetry/worker.mjs workers/group-telemetry/vrchat-client.test.mjs workers/group-telemetry/club-provider.test.mjs workers/group-telemetry/club-operation-jobs.test.mjs
git commit -m "feat(collector): execute VRChat calendar operations with artwork upload" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- workers/group-telemetry
```

### Task 4: Field mapping

**Files:**

- Create: `convex/eventSyncKinds/vrchatCalendar.ts` (mappers only in this task)
- Test: `tests/backend/vrchat-calendar-connector.test.ts` (create)

**Interfaces:**

- Consumes: `carriedFieldsHash` (plan 02), `correctionFields` (plan 02, `convex/eventCorrections.ts`), `eventDateForInstant` from `convex/_eventSchedule.ts`, `VrchatCalendarItem` (Task 1).
- Produces:

```ts
export const VRCHAT_TITLE_MAX = 64;
export const DEFAULT_DURATION_MS = 4 * 3_600_000;
export type CalendarWrite = { title: string; description: string; startsAt: string; endsAt: string; imageUrl?: string; accessType: "group" };
export function truncateTitle(title: string): string;
export function exportPayloadFromEvent(event: Doc<"events">, extras: { eventUrl: string; worldNames: string[]; artworkUrl?: string }): CalendarWrite;
export function fieldsFromVrchatEvent(item: VrchatCalendarItem, zone: string, siteUrl: string, linked: Doc<"events"> | null): EventIntakeFields;
```

The VRDex-side view of an event is plan 02's `correctionFields(db, event)`, the same fields the runner hashes into `lastExportedHash`; this kind defines no second event-to-fields mapper. Imports build candidates with plan 08's `candidateFromConnectorFields("vrchat_calendar", fields, decision)`.

Mapping decisions the tests pin:

- `truncateTitle`: unchanged up to 64 characters, else `title.slice(0, 63) + "…"`.
- Description: `[summary, [worldNames.join(", "), eventUrl].filter(Boolean).join("\n")].filter(Boolean).join("\n\n")`. `endsAt` is `endAt` or `startAt + DEFAULT_DURATION_MS`. `imageUrl` only when `artworkUrl` is given.
- `fieldsFromVrchatEvent` sets `title`, `eventDate`, `timeTba: false`, `timezone`, `start`, `end`, `summary` in the shape `correctionFields` produces for the same event (`null` for absent, `dayOffset` omitted when 0). It reads local date and clock in `linked?.timezone ?? zone`; restores `linked.title` when `item.title === truncateTitle(linked.title)`; reads `end: null` when `linked` has no `endAt` and the item lasts exactly `DEFAULT_DURATION_MS`; drops the description's last paragraph when its last line starts with `siteUrl + "/"`, then trims and caps the summary at 240 characters (`null` when empty).

- [ ] **Step 1: Write the failing tests**

```ts
describe("vrchat calendar mapping", () => {
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";

  it("truncates titles to 64 characters with an ellipsis", () => {
    assert.equal(truncateTitle("Bass Temple"), "Bass Temple");
    assert.equal(truncateTitle("x".repeat(64)), "x".repeat(64));
    assert.equal(truncateTitle("x".repeat(65)), "x".repeat(63) + "…");
    assert.equal(truncateTitle(long).length, 64);
  });

  it("appends world names and the event URL as the last paragraph", () => {
    assert.deepEqual(exportPayloadFromEvent(eventDoc(), { eventUrl: EVENT_URL, worldNames: ["Harbor Club", "Night Market"], artworkUrl: "https://media.vrdex.test/poster.png" }), {
      title: "Bass Temple", description: "Weekly bass night.\n\nHarbor Club, Night Market\n" + EVENT_URL,
      startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", imageUrl: "https://media.vrdex.test/poster.png", accessType: "group",
    });
    assert.equal(exportPayloadFromEvent(eventDoc({ summary: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).description, EVENT_URL);
    assert.equal(exportPayloadFromEvent(eventDoc({ endAt: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).endsAt, "2026-11-08T05:00:00.000Z");
  });

  it("round-trips a long-titled event with no end to the runner's carried hash", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const event = (await t.run(async (ctx) => ctx.db.get(await seedEvent(t, communityProfileId, { title: long, endAt: undefined }))))!;
    const out = exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: ["Harbor Club"] });
    const back = fieldsFromVrchatEvent(vrchatItem({ ...out }), "UTC", SITE, event);
    assert.equal(back.title, long);
    assert.equal(back.end, null);
    const vrdex = await t.run((ctx) => correctionFields(ctx.db, event));
    assert.equal(carriedFieldsHash("vrchat_calendar", back), carriedFieldsHash("vrchat_calendar", vrdex));
  });

  it("reads an unlinked item in the connector zone and strips only the appended paragraph", () => {
    const fields = fieldsFromVrchatEvent(vrchatItem({ description: "Weekly bass night.\n\nHarbor Club\n" + EVENT_URL }), "America/New_York", SITE, null);
    assert.deepEqual([fields.title, fields.eventDate, fields.timezone, fields.start, fields.end, fields.summary],
      ["Bass Temple", "2026-11-07", "America/New_York", { time: "20:00" }, { time: "23:00" }, "Weekly bass night."]);
    const foreign = fieldsFromVrchatEvent(vrchatItem({ description: "Doors at 8.\n\nBring friends." }), "UTC", SITE, null);
    assert.equal(foreign.summary, "Doors at 8.\n\nBring friends.");
    assert.equal(fieldsFromVrchatEvent(vrchatItem({ description: "y".repeat(300) }), "UTC", SITE, null).summary!.length, 240);
  });
});
```

- [ ] **Step 2: Run** `node --conditions=import --import tsx --test tests/backend/vrchat-calendar-connector.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the three functions.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/vrchatCalendar.ts tests/backend/vrchat-calendar-connector.test.ts
git commit -m "feat(connectors): map VRDex events to VRChat calendar entries" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/vrchatCalendar.ts tests/backend/vrchat-calendar-connector.test.ts
```

### Task 5: Export, delete, and operation-backed jobs

**Files:**

- Modify: `convex/eventSyncKinds/index.ts`, `convex/eventSyncKinds/vrchatCalendar.ts`, `convex/vrchatCalendarConnector.ts`, `docs/deployment/convex-environments.md`
- Test: `tests/backend/vrchat-calendar-connector.test.ts`

**Interfaces:**

- Consumes: Tasks 2 and 4; from plan 02 `convex/eventSyncKinds/types.ts`: `AwaitingClubOperation` (returned, never thrown), `OPERATION_WAIT_MS`, and the trailing `job` argument the runner passes to every method; the runner's `awaitJob` (keeps the job `running`, returns the claim's attempt, lease `now + OPERATION_WAIT_MS`) and `claimJob` (re-claims a `running` job whose lease expired, which is what Task 2's resume callback triggers); `getPublicEventBySlug` (`worlds[].displayName`) from `convex/_eventPublic.ts`; `toPublicEventShareCard` (`artworkImageUrl`) from `convex/_eventShareCard.ts`, resolved against `SITE_URL` when relative, as plan 06 does; `eventPathForRecord` from `convex/_eventPaths.ts`.
- Produces, in `convex/vrchatCalendarConnector.ts`:

```ts
export type VrchatJobPayload = { operationId?: Id<"clubOperations">; step?: "match" | "write"; externalId?: string; imageUrl?: string; item?: VrchatCalendarItem };
const advanceResult = v.union(
  v.object({ kind: v.literal("await"), operationId: v.id("clubOperations") }),
  v.object({ kind: v.literal("done"), externalId: v.string() }),
  v.object({ kind: v.literal("failed"), code: v.string() }));
export const advanceExport = internalMutation({ args: { jobId: v.id("eventSyncJobs") }, returns: advanceResult });
export const advanceDelete = internalMutation({ args: { jobId: v.id("eventSyncJobs") }, returns: advanceResult });
```

- Produces, in `convex/eventSyncKinds/vrchatCalendar.ts`: `vrchatCalendarEnabled(): boolean`, `requireVrchatCalendarEnabled(): void` (throws `Error("CONNECTOR_KIND_DISABLED")`), `vrchatCalendarHandler: SyncKindHandler` with `exportUpsert` and `exportDelete` (Task 6 adds the rest). Each method maps `await` to `return AwaitingClubOperation`, `failed` to `throw new Error(code)` (the runner's backoff), and `done` to `{ externalId }` (`exportDelete` returns nothing). Registered as `syncKindHandlers.vrchat_calendar`. Plan 02's 30-minute wait covers the operation's worst case (15-minute grace, 4-minute claim, 2-minute submission recovery); when the resume callback fires first, the run `awaitJob` scheduled at lease expiry finds the job settled and claims nothing.

Runner facts these rules rely on (plan 02 Task 3): `claimJob` turns `export_upsert` on an unpublished event into `export_delete` and closes `export_delete` with no `linked` link as `no_link`; `completeJob` writes `externalId`, `lastExportedAt`, and `lastExportedHash` on the event's link (inserting it `linked` if absent) and never changes an existing link's state; a successful `export_delete` sets the link `vrdex_retracted`. A returned `externalId` therefore always becomes a link row, so an export that writes nothing returns `"none:" + eventId` (plan 06's convention), and a link whose `externalId` starts with `none:` counts as no link.

`advanceExport` decisions, in order (job payload is `VrchatJobPayload`):

1. With `operationId` and the operation not terminal: `await` it again.
2. Terminal `match` step: on `succeeded`, look for an item whose start date in `event.timezone ?? "UTC"` equals `eventDate` and whose trimmed title equals `truncateTitle(event.title)` case-insensitively. A match enqueues `update_calendar_event` for that item and stores its `externalId` on the payload; no match enqueues `create_calendar_event`. Both are step `write`.
3. Terminal `write` step: `succeeded` returns `done` with `externalId` (create: `result.calendarEventId`; otherwise `payload.externalId ?? link.externalId`) after upserting the event's link row with that `externalId`, `state: "linked"`, and `externalArtworkUrl: payload.imageUrl ?? link?.externalArtworkUrl`; `completeJob` then writes the export fields on that row. An update `rejected` with code `visibility` (VRChat 404) sets the link `external_deleted` and returns `done` with the link's `externalId`. A delete on the cancellation path that `succeeded` or was `rejected` with `visibility` sets the link `vrdex_retracted` and returns `done` with the link's `externalId` (`completeJob` keeps that state).
4. Any other terminal outcome clears `operationId` and `step` from the payload and returns `failed` with `operation.code ?? operation.state`, so the runner's backoff retries from rule 5 (an `indeterminate` create therefore retries through a read and links what VRChat made).
5. No `operationId`: `scheduleKind === "date_only"` or no `startAt`: `done` with the link's `externalId`, else `"none:" + eventId`. Another `running` job for the same connector and event (`by_connectorId_eventId_state`): `failed` with `vrchat_operation_in_flight`. Link `external_deleted`: `done` with its `externalId` (never recreate a copy the organiser removed). `eventStatus === "cancelled"`: a `linked` link enqueues `delete_calendar_event` (step `write`), otherwise `done` with `"none:" + eventId`. A `linked` link with a real `externalId` enqueues `update_calendar_event`. Otherwise (no link, a `none:` link, or `vrdex_retracted`) enqueue `list_calendar_events` from `eventDate` minus one day to `eventDate` plus two days, both at `T00:00:00.000Z` (step `match`).

Every write enqueue stores the operation payload's `imageUrl` on the job payload; an update includes `imageUrl` only when it differs from `link.externalArtworkUrl`. A `refused` enqueue returns `failed` with the refusal code. `advanceDelete` (the runner only calls it with a `linked` link): a `none:` link is `done`; else enqueue `delete_calendar_event`; `succeeded` or `rejected` with `visibility` is `done` (the runner retracts the link); otherwise rule 4.

- [ ] **Step 1: Write the failing tests**

```ts
describe("vrchat calendar export", () => {
  beforeEach(setupEnv);
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";
  const link = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, eventId: Id<"events">, extra: Partial<Doc<"eventSyncLinks">> = {}) =>
    t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW, ...extra }));
  const linkOf = async (t: TestConvex<typeof schema>, eventId: Id<"events">) =>
    (await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()))[0];

  it("no link: reads the dates first, then creates with a truncated title and no notification field", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual([job.state, job.attempts, job.leaseExpiresAt], ["running", 0, NOW + 30 * 60_000]);
    assert.deepEqual((await operations(t))[0].payload, { kind: "list_calendar_events", from: "2026-11-06T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [], calendarEventsTruncated: false } });
    job = await rerunJob(t, job._id);
    const create = (await operations(t))[1];
    assert.equal(create.connectorSync?.jobId, job._id);
    assert.equal(create.eventId, undefined);
    assert.deepEqual(create.payload, { kind: "create_calendar_event", title: long.slice(0, 63) + "…", description: "Weekly bass night.\n\n" + EVENT_URL,
      startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T05:00:00.000Z", accessType: "group" });
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const row = await linkOf(t, eventId);
    assert.deepEqual([row.externalId, row.state, row.lastExportedAt], [CAL_1, "linked", NOW]);
    assert.equal(row.lastExportedHash, carriedFieldsHash("vrchat_calendar", await t.run((ctx) => correctionFields(ctx.db, event))));
  });

  it("matches an existing VRChat entry instead of creating", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem({ title: "BASS TEMPLE" })] } });
    await rerunJob(t, job._id);
    const ops = await operations(t);
    assert.deepEqual([ops.length, ops[1].payload.kind, (ops[1].payload as { calendarEventId: string }).calendarEventId], [2, "update_calendar_event", CAL_1]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
  });

  it("an indeterminate create retries through a read and links the entry", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await rerunJob(t, job._id);
    await workerSettle(t, { status: "indeterminate", code: "submission_outcome_unknown" });
    job = await rerunJob(t, job._id);
    assert.notEqual(job.state, "done");
    assert.equal((job.payload as VrchatJobPayload).operationId, undefined);
    await t.run((ctx) => ctx.db.patch(job._id, { state: "pending", dueAt: NOW }));
    job = await rerunJob(t, job._id);
    assert.equal((await operations(t))[2].payload.kind, "list_calendar_events");
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    assert.equal((await operations(t)).at(-1)!.payload.kind, "update_calendar_event");
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    await rerunJob(t, job._id);
    assert.equal((await operations(t)).filter((op) => op.payload.kind === "create_calendar_event").length, 1);
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
  });

  it("a linked update sends artwork only when it changed and resumes from the callback", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { posterImageUrl: "https://media.vrdex.test/poster.png" });
    await link(t, connectorId!, eventId, { externalArtworkUrl: "https://media.vrdex.test/poster.png" });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const [op] = await operations(t);
    assert.deepEqual([op.payload.kind, "imageUrl" in op.payload], ["update_calendar_event", false]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.ok((await t.run((ctx) => ctx.db.get(job._id)))!.leaseExpiresAt! <= NOW);
    assert.equal((await rerunJob(t, job._id)).state, "done");
  });

  it("a cancelled event deletes the linked entry and retracts the link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual((await operations(t))[0].payload, { kind: "delete_calendar_event", calendarEventId: CAL_1 });
    await workerSettle(t, { status: "succeeded" });
    await rerunJob(t, job._id);
    assert.equal((await linkOf(t, eventId)).state, "vrdex_retracted");
  });

  it("export_delete treats an entry already gone as done", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_delete", eventId });
    assert.equal((await operations(t))[0].payload.kind, "delete_calendar_event");
    await workerSettle(t, { status: "rejected", code: "visibility" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).state, "vrdex_retracted");
  });

  it("an update to an entry deleted in VRChat flags the link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "rejected", code: "visibility" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).state, "external_deleted");
  });

  it("waits while another operation for the event is in flight", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const second = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.notEqual(second.state, "done");
    assert.match(second.lastError ?? "", /vrchat_operation_in_flight/);
    assert.equal((await operations(t)).length, 1);
  });

  it("does not export date-only events, and does nothing with the flag off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const dateOnly = await seedEvent(t, communityProfileId, { scheduleKind: "date_only", startAt: undefined, endAt: undefined });
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: dateOnly })).state, "done");
    assert.equal((await linkOf(t, dateOnly)).externalId, "none:" + dateOnly);
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    const timed = await seedEvent(t, communityProfileId, { slug: "other-night" });
    assert.notEqual((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: timed })).state, "done");
    assert.equal((await operations(t)).length, 0);
  });
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the two advance mutations, the handler methods, and the registration. Add the flag to the event connectors section of `docs/deployment/convex-environments.md`: `VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED`, Convex, owner BASIC, non-secret, default off, enable only after collector release readiness shows this plan's worker; rotation not applicable.
- [ ] **Step 4: Run** the file, plan 02's own runner tests, `pnpm typecheck:backend`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/index.ts convex/eventSyncKinds/vrchatCalendar.ts convex/vrchatCalendarConnector.ts docs/deployment/convex-environments.md tests/backend/vrchat-calendar-connector.test.ts
git commit -m "feat(connectors): export VRDex events to VRChat calendars through club operations" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/index.ts convex/eventSyncKinds/vrchatCalendar.ts convex/vrchatCalendarConnector.ts docs/deployment/convex-environments.md tests/backend/vrchat-calendar-connector.test.ts
```

### Task 6: Import, poll, and reconcile

**Files:**

- Modify: `convex/eventSyncKinds/vrchatCalendar.ts`, `convex/vrchatCalendarConnector.ts`, `convex/crons.ts`
- Test: `tests/backend/vrchat-calendar-connector.test.ts`

**Interfaces:**

- Consumes: Tasks 4 and 5; `applyEventCandidate`, `enqueueSyncJob`, `correctionFields` (plan 02); `candidateFromConnectorFields(kind, fields, decision)` from `convex/_eventCandidateApply.ts` (plan 08, used as is); `events.by_communityProfileId_eventDate` as plan 08 uses it.
- Produces, in `convex/vrchatCalendarConnector.ts`:

```ts
export const advanceList = internalMutation({ args: { jobId: v.id("eventSyncJobs"), purpose: v.union(v.literal("poll"), v.literal("reconcile")) }, returns: advanceResult });
export const applyImport = internalMutation({ args: { connectorId: v.id("eventConnectors"), item: calendarEventItem },
  returns: v.string() }); // "skipped" | "unchanged" | applyEventCandidate's outcome (including "skipped_echo", "skipped_stale")
export const enqueuePolls = internalMutation({ args: {}, returns: v.null() });
```

- Produces: `vrchatCalendarHandler` gains `reconcile` and `importPoll` (both `advanceList`, purpose by name) and `importItem` (payload `{ item }`, calls `applyImport`). `convex/crons.ts`: `crons.interval("poll VRChat calendars", { minutes: 30 }, internal.vrchatCalendarConnector.enqueuePolls, {})`.

`advanceList` decisions: without an operation, enqueue `list_calendar_events` from today's `T00:00:00.000Z` (UTC) to 90 days later. A failed operation clears the payload and returns `failed`. On `succeeded`, with `items = result.calendarEvents`:

- `reconcile` (VRChat side only; plan 02's runner enqueues exports for unlinked VRDex events afterwards): an item with a link is skipped; an item matching a community event by `eventDate` (in the connector's `target.timezone ?? "UTC"`) and case-insensitive trimmed title (against both the VRDex title and its `truncateTitle`) gets a `linked` link and nothing is applied; the rest enqueue `import_item` with `{ item }` only when direction is `import` or `bidirectional`.
- `poll`: an item with no link, or with a `linked` link whose `externalUpdatedAt` is older than `Date.parse(item.updatedAt)`, enqueues `import_item`. When `calendarEventsTruncated` is not true, every `linked` link of the connector whose event's `startAt` is inside `[from, to)`, whose `externalId` is not among the items, and whose `lastExportedAt ?? createdAt` is before the list operation's `submittedAt` becomes `external_deleted`.
- Both set the connector's `lastSyncedAt` and return `done` with `""`.

`applyImport` rules, in order:

1. Connector not `active`, or direction `export` or `off`: `skipped`.
2. `updatedMs = Date.parse(item.updatedAt)`; link by `by_connectorId_externalId` with `externalUpdatedAt >= updatedMs`: `unchanged`.
3. Start date (in the zone below) before today in that zone: `skipped`.
4. Zone is the linked event's `timezone`, else `target.timezone`, else `"UTC"`. `fields = fieldsFromVrchatEvent(item, zone, SITE_URL, linkedEvent)`; passing the linked event is what lets the echo hash match a truncated title or a defaulted end.
5. No link: match as in `reconcile`; a match inserts a `linked` link and decides `{ kind: "update", slug }`; otherwise `{ kind: "new" }`. A linked event decides `update`.
6. `applyEventCandidate(ctx, { connector, candidate: candidateFromConnectorFields("vrchat_calendar", fields, decision), actorUserId: connector.authorityUserId, link, externalId: item.id, externalUpdatedAt: updatedMs, expectedUpdatedAt: event?.updatedAt, idempotencyKey: "vrchat_calendar:" + connectorId + ":" + item.id + ":" + updatedMs })`; return its outcome. The echo guard and the bidirectional newer-wins rule are its `skipped_echo` and `skipped_stale`; do not repeat them here.

Every outcome after rule 3 writes `lastImportedAt` and `externalUpdatedAt = updatedMs` on the link (re-read after rule 6), so an echo or stale item is not re-enqueued by the next poll. `enqueuePolls` returns early when the flag is off; otherwise for each `vrchat_calendar` connector (`by_kind_target_channelId` prefix on `kind`) that is `active` with direction `import` or `bidirectional` and has no `pending` or `running` `import_poll` job, it calls `enqueueSyncJob` with kind `import_poll`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("vrchat calendar import", () => {
  beforeEach(setupEnv);
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";
  const importItem = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: VrchatCalendarItem) =>
    runSyncJob(t, { connectorId, kind: "import_item", payload: { item } });
  const importIds = async (t: TestConvex<typeof schema>) =>
    (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_item").map((j) => (j.payload as { item: VrchatCalendarItem }).item.id).sort();
  const at = (date: string) => ({ eventDate: date, startAt: Date.parse(`${date}T23:00:00.000Z`), endAt: Date.parse(`${date}T23:30:00.000Z`) });

  it("poll diff: new and changed items import, unchanged items do not, missing linked items flag", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    const ins = (eventId: Id<"events">, externalId: string, externalUpdatedAt?: number) => t.run((ctx) => ctx.db.insert("eventSyncLinks",
      { connectorId: connectorId!, eventId, externalId, externalUpdatedAt, lastExportedAt: NOW - 3_600_000, state: "linked", createdAt: NOW - 3_600_000, updatedAt: NOW }));
    const changed = await ins(await seedEvent(t, communityProfileId, { slug: "changed", title: "Changed Night", ...at("2026-11-10") }), calId(2), Date.parse("2026-11-01T00:00:00.000Z"));
    await ins(await seedEvent(t, communityProfileId, { slug: "same", title: "Same Night", ...at("2026-11-11") }), calId(3), Date.parse("2026-11-02T11:00:00.000Z"));
    const gone = await ins(await seedEvent(t, communityProfileId, { slug: "gone", title: "Gone Night", ...at("2026-11-12") }), calId(4));
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
    assert.deepEqual((await operations(t))[0].payload, { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" });
    await workerSettle(t, { status: "succeeded", result: { calendarEventsTruncated: false, calendarEvents: [
      vrchatItem({ id: CAL_1, title: "Fresh Night" }), vrchatItem({ id: calId(2), title: "Changed Night Late" }), vrchatItem({ id: calId(3), title: "Same Night" }),
    ] } });
    job = await rerunJob(t, job._id);
    assert.equal(job.state, "done");
    assert.deepEqual(await importIds(t), [CAL_1, calId(2)]);
    assert.equal((await t.run((ctx) => ctx.db.get(gone)))!.state, "external_deleted");
    assert.equal((await t.run((ctx) => ctx.db.get(changed)))!.state, "linked");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId!)))!.lastSyncedAt, NOW);
  });

  it("a link exported after the list was read is not flagged, and a truncated list flags nothing", async () => {
    for (const [lastExportedAt, truncated] of [[NOW + 1_000, false], [NOW - 3_600_000, true]] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
      const eventId = await seedEvent(t, communityProfileId, at("2026-11-12"));
      const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: calId(4), lastExportedAt, state: "linked", createdAt: NOW - 3_600_000, updatedAt: NOW }));
      const job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
      await workerSettle(t, { status: "succeeded", result: { calendarEvents: [], calendarEventsTruncated: truncated } });
      await rerunJob(t, job._id);
      assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
    }
  });

  it("ignores its own export coming back", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked",
      lastExportedHash: carriedFieldsHash("vrchat_calendar", await t.run((ctx) => correctionFields(ctx.db, event))), createdAt: NOW, updatedAt: NOW }));
    const out = exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: [] });
    await importItem(t, connectorId!, vrchatItem({ ...out, updatedAt: "2026-11-02T11:59:59.000Z" }));
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.updatedAt, event.updatedAt);
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.externalUpdatedAt, Date.parse("2026-11-02T11:59:59.000Z"));
  });

  it("a VRChat time change keeps the full VRDex title", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { title: long });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW }));
    await importItem(t, connectorId!, vrchatItem({ title: truncateTitle(long), startsAt: "2026-11-08T02:00:00.000Z", endsAt: "2026-11-08T05:00:00.000Z", updatedAt: "2026-11-02T11:59:59.000Z" }));
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    assert.deepEqual([event.title, event.startAt], [long, Date.parse("2026-11-08T02:00:00.000Z")]);
  });

  it("bidirectional: the newer side wins by VRChat updatedAt", async () => {
    for (const [eventUpdatedAt, itemUpdatedAt, title] of [[NOW - 60_000, "2026-11-02T11:59:59.000Z", "Bass Temple Late"], [NOW, "2026-11-02T11:00:00.000Z", "Bass Temple"]] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
      const eventId = await seedEvent(t, communityProfileId, { updatedAt: eventUpdatedAt });
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW }));
      await importItem(t, connectorId!, vrchatItem({ title: "Bass Temple Late", updatedAt: itemUpdatedAt }));
      assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, title);
    }
  });

  it("skips past items", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    await importItem(t, connectorId!, vrchatItem({ startsAt: "2026-10-30T23:00:00.000Z", endsAt: "2026-10-31T02:00:00.000Z" }));
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
  });

  it("reconcile links by date and title without creating", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [
      vrchatItem({ title: "BASS TEMPLE" }), vrchatItem({ id: calId(2), title: "Other Night", startsAt: "2026-11-09T01:00:00.000Z", endsAt: "2026-11-09T04:00:00.000Z" }),
    ] } });
    await rerunJob(t, job._id);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId]), [[CAL_1, eventId]]);
    assert.equal((await t.run((ctx) => ctx.db.query("events").collect())).length, 1);
    assert.deepEqual(await importIds(t), [calId(2)]);
  });

  it("enqueuePolls skips export-only connectors and connectors already polling", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t, { direction: "import" });
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    const polls = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_poll");
    assert.deepEqual(polls.map((j) => j.connectorId), [connectorId]);
  });
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** `advanceList`, `applyImport`, `enqueuePolls`, the three handler methods, and the cron.
- [ ] **Step 4: Run** the file and `pnpm typecheck:backend`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add convex/eventSyncKinds/vrchatCalendar.ts convex/vrchatCalendarConnector.ts convex/crons.ts tests/backend/vrchat-calendar-connector.test.ts
git commit -m "feat(connectors): import and reconcile VRChat calendar entries" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventSyncKinds/vrchatCalendar.ts convex/vrchatCalendarConnector.ts convex/crons.ts tests/backend/vrchat-calendar-connector.test.ts
```

### Task 7: Connect gate, Integrations control, and docs

**Files:**

- Modify: `convex/eventConnectors.ts`, `convex/_eventConnectors.ts`, `convex/vrchatCalendarConnector.ts`, `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx`
- Create: `apps/web/src/app/account/communities/[slug]/club-vrchat-calendar.tsx`
- Modify docs: `docs/backend/event-schema.md`, `docs/backend/community-group-telemetry.md`, `docs/planning/group-instance-analytics/operation-backend-contract.md`
- Test: `tests/backend/vrchat-calendar-connector.test.ts`

**Interfaces:**

- Consumes: `vrchatCalendarReadiness` (Task 2), `vrchatCalendarEnabled` (Task 5), `requireConnectorAuthority` (plan 02).
- Produces: `export const availability = query({ args: { communityProfileId: v.id("profiles") }, returns: v.object({ enabled: v.boolean(), ready: v.boolean() }) })` in `convex/vrchatCalendarConnector.ts` (requires connector authority; `enabled` is both flags); plan 02's target validator gains `timezone: v.optional(v.string())`; `VrchatCalendarConnect({ communityProfileId }: { communityProfileId: Id<"profiles"> })` in `club-vrchat-calendar.tsx`.

`eventConnectors.create` for kind `vrchat_calendar`: flag off or readiness not ready throws `Error("CONNECTOR_UNAVAILABLE")`; an authority (the caller) who is neither the community owner nor holds `manage_events`, on top of plan 02's `manage_integrations`, throws `Error("CONNECTOR_FORBIDDEN")`, so every job the connector enqueues passes `enqueueConnectorOperation`'s permission check (resolve the caller with `resolveClubActor` and check `requireClubPermission(actor, "manage_events")` semantics); the stored target is `{ groupId: integration.vrchatGroupId, timezone }`, where `timezone` is the caller's value when `Intl.DateTimeFormat` accepts it, else `"UTC"`; any caller `groupId` or `calendarId` is ignored. A VRChat group has exactly one calendar (VRChat's `calendarId` path parameter names an event), so there is no calendar picker and no group picker: the group is the community's connected group.

`VrchatCalendarConnect` renders nothing when `enabled` is false; otherwise a direction select (`Export` default, `Import`, `Both`) and a `Connect VRChat calendar` button, disabled when `ready` is false, with no helper text (the existing club feature controls' pattern). The button calls `api.eventConnectors.create` with `kind: "vrchat_calendar"`, the direction, `mode: "hold"`, and `target: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }`. The Integrations page renders it beside the other Connect buttons and adds kind label `vrchat_calendar: "VRChat calendar"`. VRDex stores no VRChat group name, so `target.groupName` stays unset and the row's target name falls back to the group ID.

- [ ] **Step 1: Write the failing tests**

```ts
describe("vrchat calendar connect gate", () => {
  beforeEach(setupEnv);
  const args = (communityProfileId: Id<"profiles">) => ({ communityProfileId, kind: "vrchat_calendar" as const, direction: "export" as const, mode: "hold" as const, target: { timezone: "America/New_York", groupId: "grp_99999999-9999-9999-9999-999999999999" } });

  it("refuses without an assigned collector account or the calendar feature", async () => {
    for (const options of [{ assigned: false }, { features: ["posts"] }]) {
      const t = convexTest({ schema, modules });
      const { communityProfileId } = await seedVrchatConnector(t, { ...options, connector: false });
      await assert.rejects(asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_UNAVAILABLE/);
      assert.deepEqual(await asOwner(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: true, ready: false });
    }
  });

  it("refuses an authority without manage_events", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { authority: "integrations_only", connector: false });
    await assert.rejects(asStaff(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_FORBIDDEN/);
    assert.equal((await t.run((ctx) => ctx.db.query("eventConnectors").collect())).length, 0);
  });

  it("refuses with the kind flag off", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    await assert.rejects(asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_UNAVAILABLE/);
  });

  it("creates with the integration's group and enqueues a reconcile", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const connectorId = await asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId));
    assert.deepEqual((await t.run((ctx) => ctx.db.get(connectorId)))!.target, { groupId: GROUP_ID, timezone: "America/New_York" });
    assert.deepEqual((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).map((j) => j.kind), ["reconcile"]);
  });
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the gate, `availability`, the target field, and the component.
- [ ] **Step 4: Write the docs.**
  - `docs/backend/event-schema.md`, plan 02's Connectors section: a `vrchat_calendar` paragraph: needs a connected group with an assigned collector account and the Calendar feature; carries title, start, end, summary; exports add poster artwork and a last paragraph of world names and the event URL; titles cut to 64 characters with an ellipsis; no creation notification; cancellation deletes the VRChat entry; date-only events are not exported; a 30-minute poll imports changes and flags entries removed in VRChat; every VRChat call is a club operation and the sync job waits on it; the flag.
  - `docs/backend/community-group-telemetry.md`: a `### Calendar operations` subsection under Control plane listing the four kinds, the `calendar` feature, `manage_events`, the `group-calendar-manage` grant, that only connectors enqueue them (hidden from the staff list, no failure notices), that a terminal state resumes the waiting sync job, and that the worker fetches PNG artwork over HTTPS and uploads it through `/file/image` before the create.
  - `docs/planning/group-instance-analytics/operation-backend-contract.md`, Worker request budgets: calendar creates and updates with artwork need three requests per minute, other calendar operations two; list pages after the first reserve one request each.
- [ ] **Step 5: Verify.** Run the test file, `pnpm typecheck:backend`, `pnpm typecheck:web`, `pnpm lint:web`, `pnpm exec markdownlint-cli2 docs/backend/event-schema.md docs/backend/community-group-telemetry.md docs/planning/group-instance-analytics/operation-backend-contract.md docs/deployment/convex-environments.md`. Then start the web app against the local fixture backend and screenshot the Integrations page twice (calendar ready: button enabled; feature off: button disabled) for the PR's visual review. Expected: all PASS; screenshots show the button and direction select with no added prose.
- [ ] **Step 6: Commit**

```bash
git add convex/eventConnectors.ts convex/_eventConnectors.ts convex/vrchatCalendarConnector.ts "apps/web/src/app/account/communities/[slug]/club-vrchat-calendar.tsx" "apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx" docs/backend/event-schema.md docs/backend/community-group-telemetry.md docs/planning/group-instance-analytics/operation-backend-contract.md tests/backend/vrchat-calendar-connector.test.ts
git commit -m "feat(connectors): connect VRChat calendars from the Integrations page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- convex/eventConnectors.ts convex/_eventConnectors.ts convex/vrchatCalendarConnector.ts "apps/web/src/app/account/communities/[slug]/club-vrchat-calendar.tsx" "apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx" docs/backend/event-schema.md docs/backend/community-group-telemetry.md docs/planning/group-instance-analytics/operation-backend-contract.md tests/backend/vrchat-calendar-connector.test.ts
```

## Before enabling the flag (not a task; record in the PR)

Two provider facts are taken from vrchat-mcp and the VRChat OpenAPI description, not from a live call: that `group-calendar-manage` is the grant VRChat reports for calendar management, and that a `/file/image` upload tagged `gallery` is accepted as a calendar event's `imageId` (the OpenAPI `ImagePurpose` enum has no calendar purpose). Before setting `VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED=true`, BASIC's community runs one export with artwork against its own group under the existing provider-proof rules. If the image is refused, the create is rejected and the job fails visibly; the fallback is to drop `imageUrl` from the export, not to retry.
