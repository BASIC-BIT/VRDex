# Event Platform Master Plan

> **For agentic workers:** This is the index and interface contract for eleven sub-plans. Execute the sub-plans in order with superpowers:subagent-driven-development; each sub-plan carries its own header, tasks, and steps. Read this document first on every sub-plan: it fixes every name, table, signature, and env var that crosses plan boundaries.

**Goal:** Make VRDex the hub for a community's events: Discord channel posts in through an agent, Google Calendar, Discord scheduled events, and VRChat calendars in and out through deterministic connectors, a bot-owned Discord board, and a recurrence model so weekly nights are one series.

**Architecture:** One shared intake agent package runs in the web server and in Convex. A connectors table with directions, a link table that remembers what VRDex saw and wrote per external copy, and a leased job queue in Convex drive every sync. The Discord gateway is an inbound relay only; Convex writes to Discord over REST. VRChat writes ride the existing club operations queue. Recurrence lands last and upgrades links to series-aware.

**Tech Stack:** Next.js, Convex (scheduler, crons, HTTP actions, Node actions), TypeScript, discord.js 14 (gateway), Discord REST v10 from Convex, Google Calendar API v3, `@langfuse/client` at the workspace's existing `@langfuse` major (5.x), PostHog capture API via the existing outbox, Terraform on the existing AWS account.

**Specs:**

- `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md`
- `docs/superpowers/specs/2026-10-29-event-connectors-design.md`
- `docs/superpowers/specs/2026-10-29-recurring-events-design.md`

## Global Constraints

- No em-dash (U+2014) and no double hyphen (`--`) in any public-facing string. Every new public string is in a spec's copy table and needs BASIC's approval of the exact wording before the PR that ships it merges; implement the proposed strings verbatim and say so in the PR.
- No AI mention in any user-facing string.
- Every new env var is documented by name, scope, owner, and rotation path in `docs/deployment/convex-environments.md` (Convex) or the Vercel Terraform (web); values stay in provider secret stores.
- Anything that runs unattended in production ships with an alarm whose action emails `basic@basicbit.net`, in the same PR. For Convex-side jobs and crons the mechanism is `notifyOps` (plan 02, below); for the ECS gateway it is a CloudWatch alarm with an SNS email action (plan 05). An alarm with no email action is not an alarm.
- No message to humans from any job: no Discord replies in channels beyond the board embeds the design names, no VRChat creation notifications, no DMs.
- Discord IDs validate with `/^\d{17,20}$/`. Discord message text is capped at 12,000 characters. Prepared poster data URLs are capped at 20,000,000 characters.
- Agent budget: 6 turns, 5 tool calls (one call per turn, so the sixth turn is the answer), 20 s per model call, model from `VRDEX_EVENT_INTAKE_MODEL` (default `gpt-5.6-luna`), gated by `VRDEX_EVENT_INTAKE_AI_ENABLED`.
- Flags, all default off: `VRDEX_DISCORD_INTAKE_ENABLED`, `VRDEX_EVENT_CONNECTORS_ENABLED`, plus per-kind `VRDEX_CONNECTOR_<KIND>_ENABLED` for `DISCORD_BOARD`, `DISCORD_SCHEDULED_EVENTS`, `GOOGLE_CALENDAR`, `VRCHAT_CALENDAR`, and `VRDEX_RECURRING_EVENTS_ENABLED`.
- Caps: per connector 20 runs or jobs per day for Discord announcements; publish keeps the 100 per community per day cap and skips the 10 per account cap for connector-driven writes; `authorizeExtraction`'s 20 per actor per day is skipped for connector-driven runs.
- Markdown passes `pnpm exec markdownlint-cli2`. Docs under `docs/` are published; no bare angle-bracket placeholders outside fenced code.
- Tests live in `tests/backend` (Convex, `convex-test`) and `tests/web` (web server libs); both run under `node:test` through `tsx` (see `package.json` test scripts); gateway tests in `apps/discord-gateway/src/*.test.ts` with `node --test`. Each rule the specs name gets one test that fails if the rule breaks.
- Commit per task with a conventional-commit subject; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Failure modes the specs imply that no single task's happy path exercises. Each is pinned to a test in the owning sub-plan.

1. A Discord message edited after its run already published an event must patch that event, not create a second one (plan 03, quiet window and sources tests).
2. An export that comes back as an inbound change (same carried-field hash) must be ignored, not re-imported and re-exported in a loop (plan 02, echo guard test; plan 08, round-trip test).
3. A staffer's hand-set venue on the site must survive a connector import that does not carry venue, and a Discord post that only changes the time must not touch lineup (plan 02, carried-fields test; plan 03, explicit-only patch test).
4. Turning on a connector for a community whose upcoming nights already exist externally must link, not duplicate (plan 02, reconcile test; plan 10, adoption test).
5. A pending held draft must block exports for that event and must not be filed twice by polling (plan 02, draft-keyed link test).

## Sub-plans and order

| # | File | Delivers | Depends on |
| --- | --- | --- | --- |
| 01 | `2026-10-29-event-platform-01-agent-package.md` | `packages/event-intake-agent`, `decision` on the candidate, `list_events` and `get_event` tools, Langfuse and PostHog sinks, product analytics outbox | none |
| 02 | `2026-10-29-event-platform-02-connector-foundation.md` | `eventConnectors`, `connectorCredentials`, `eventSyncLinks`, `eventSyncJobs`, job runner, `enqueueEventSync` hook, `applyEventCandidate`, staff field patch, Integrations settings section with list and direction/mode controls only | 01 |
| 03 | `2026-10-29-event-platform-03-discord-announcements.md` | Gateway message intents and relay, `discordIntakeMessages`, `discordIntakeRuns`, `discordIntakeSources`, quiet window, run action, slash commands, site Discord connect flow | 01, 02 |
| 04 | `2026-10-29-event-platform-04-my-events-held.md` | My events "From Discord" section: cross-actor draft access, open, publish, dismiss, proposed-update view, staff-attention flags | 02, 03 |
| 05 | `2026-10-29-event-platform-05-gateway-deployment.md` | Terraform for the gateway container, secrets, heartbeat, alarm, command registration script, docs | 03 |
| 06 | `2026-10-29-event-platform-06-discord-board.md` | `discord_board` kind: embed render, upsert, delete, daily refresh | 02 |
| 07 | `2026-10-29-event-platform-07-discord-scheduled-events.md` | `discord_scheduled_events` kind: export, gateway relay of scheduled event changes, import, cancel semantics | 02, 03 |
| 08 | `2026-10-29-event-platform-08-google-calendar.md` | `google_calendar` kind: VRDex Google OAuth client, credential encryption, watch and poll, import, export, bidirectional, removal of the staging import | 02 |
| 09 | `2026-10-29-event-platform-09-vrchat-calendar.md` | `vrchat_calendar` kind: three club operation payload kinds, a read operation, collector worker implementation, poll import | 02 |
| 10 | `2026-10-29-event-platform-10-recurring-events.md` | `eventSeries`, occurrence fields on `events`, materialiser with adoption, series and night editing, wizard Repeats control, API and MCP repeat fields, series page | 02 |
| 11 | `2026-10-29-event-platform-11-recurrence-connectors.md` | Series-aware links, Google and Discord series import and export, grouping migration | 07, 08, 10 |

Plans 06, 08, 09, and 10 are independent of each other once 02 lands and may run in parallel worktrees. Plans 03 to 05 are a chain. Plan 11 is last.

## Interface contract

Names below are fixed. A sub-plan that needs something not listed here defines it inside its own files and does not export it across plans.

### Package `@vrdex/event-intake-agent` (plan 01)

Location `packages/event-intake-agent`, `src/index.ts` exports:

```ts
export type EventIntakeTrigger = "web" | "mcp" | "discord" | "connector";
export type EventIntakeRunContext = {
  trigger: EventIntakeTrigger;
  communitySlug?: string;
  connectorId?: string;
  mode?: "hold" | "autopublish"; // copied into EventIntakeRunMeta.mode by the agent
  priorEvents?: Array<{ sourceMessageId: string; eventSlug: string }>;
};
export type EventIntakeAgentInput = { draftId: string; sourceText?: string; posterAssetId?: string; context?: EventIntakeRunContext };
export type EventListRow = { slug: string; title: string; eventDate: string | null; start: string | null; lineupSummary: string };
export type EventIntakeAgentDependencies = {
  authorize: (input: EventIntakeAgentInput, reserveQuota: boolean) => Promise<{ actorUserId: string; version: number }>;
  search_people: (query: string, limit: number) => Promise<Array<{ slug: string; displayName: string }>>;
  search_communities: (query: string, limit: number) => Promise<Array<{ slug: string; displayName: string }>>;
  list_events?: (limit: number) => Promise<EventListRow[]>;
  get_event?: (slug: string) => Promise<EventIntakeFields | null>;
  readPoster?: (posterAssetId: string) => Promise<string>;
  sink?: EventIntakeSink;
  apiKey?: string; enabled?: boolean; model?: string; fetchImplementation?: typeof fetch;
};
export type EventIntakeRunMeta = { trigger: EventIntakeTrigger; actorUserId: string; draftId: string; connectorId?: string; communitySlug?: string; mode?: "hold" | "autopublish" };
export type EventIntakeGeneration = { turn: number; model: string; request: unknown; response: unknown; inputTokens: number; outputTokens: number; latencyMs: number };
export type EventIntakeRunResult = { reason: string; decision?: EventIntakeDecision; turns: number; toolCalls: number; durationMs: number; inputTokens: number; outputTokens: number; costUsd: number | null };
export type EventIntakeRunHandle = { generation(turn: EventIntakeGeneration): void; end(result: EventIntakeRunResult): Promise<void> };
export type EventIntakeSink = { start(meta: EventIntakeRunMeta): EventIntakeRunHandle };
export function extractEventIntake(input: EventIntakeAgentInput, deps: EventIntakeAgentDependencies): Promise<EventIntakeCandidate>;
export function resolveIntakeLocalTime(date: string, time: string, zone: string): string[];
export function createLangfuseSink(options: { publicKey: string; secretKey: string; baseUrl?: string }): EventIntakeSink;
export function createPostHogSink(enqueue: (event: { event: "event_intake_run"; distinctId: string; properties: Record<string, unknown> }) => Promise<void>): EventIntakeSink;
export function composeSinks(...sinks: EventIntakeSink[]): EventIntakeSink;
```

`packages/api-contracts/src/event-intake.ts` gains on `EventIntakeCandidate`:

```ts
decision: { kind: "new" } | { kind: "update"; slug: string } | { kind: "not_event"; reason: string }
```

and `EventIntakeEvidence.origin` gains `"connector"`. `EventIntakeCandidateJsonSchema` is regenerated. Existing web and MCP callers pass no `context` and receive `decision: { kind: "new" }`.

Product analytics outbox (plan 01): new table `productAnalyticsOutbox` `{ event: string, distinctId: string, properties: v.any(), createdAt, attemptCount, nextAttemptAt, leaseExpiresAt?, deliveredAt? }`, helper `enqueueProductAnalytics(db: DatabaseWriter, row: { event: string; distinctId: string; properties: Record<string, unknown> })` in `convex/_productAnalytics.ts`, drained by `internal.productAnalyticsDelivery.deliverPending` on the same five-minute cadence as `claimAnalyticsDelivery` and posting to the same PostHog endpoint with `POSTHOG_PROJECT_API_KEY`.

Env (plan 01): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` on Convex and web. Missing keys disable tracing.

### Connector foundation (plan 02)

`convex/schema.ts` tables, with validators exported from `convex/_eventConnectors.ts`:

```ts
eventConnectors: {
  communityProfileId: Id<"profiles">; kind: ConnectorKind; direction: ConnectorDirection; mode: ConnectorMode;
  authorityUserId: Id<"users">; credentialId?: Id<"connectorCredentials">;
  target: { guildId?: string; channelId?: string; calendarId?: string; groupId?: string };
  quietWindowSeconds?: number; state: ConnectorState; lastSyncedAt?: number; lastError?: string;
  createdAt: number; updatedAt: number;
}
// ConnectorKind = "discord_announcements" | "discord_board" | "discord_scheduled_events" | "google_calendar" | "vrchat_calendar" | "notion"
// ConnectorDirection = "import" | "export" | "bidirectional" | "off"
// ConnectorMode = "hold" | "autopublish"
// ConnectorState = "active" | "paused" | "needs_reauth" | "removed"
connectorCredentials: { provider: "google" | "notion"; ownerUserId: Id<"users">; encryptedAccessToken: string; encryptedRefreshToken: string; accessTokenExpiresAt: number; scopes: string[]; externalAccountId: string; state: "active" | "revoked"; createdAt; updatedAt }
eventSyncLinks: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; draftId?: Id<"eventIntakeDrafts">; externalId: string; externalSeriesId?: string; lastExportedAt?: number; lastExportedHash?: string; lastImportedAt?: number; externalUpdatedAt?: number; state: "linked" | "external_deleted" | "vrdex_retracted"; createdAt; updatedAt }
eventSyncJobs: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: "reconcile" | "export_upsert" | "export_delete" | "import_item" | "import_poll" | "board_refresh"; payload: v.any(); dueAt: number; attempts: number; leaseExpiresAt?: number; state: "pending" | "running" | "done" | "failed"; lastError?: string; scheduledFunctionId?: Id<"_scheduled_functions">; createdAt; updatedAt }
```

Indexes: `eventConnectors.by_communityProfileId`, `eventConnectors.by_kind_target_channelId`, `eventSyncLinks.by_connectorId_externalId` (unique by convention), `eventSyncLinks.by_eventId`, `eventSyncJobs.by_connectorId_eventId_state`, `eventSyncJobs.by_state_dueAt`.

Functions:

```ts
// convex/_eventConnectors.ts
export async function requireConnectorAuthority(ctx: QueryCtx | MutationCtx, communityProfileId: Id<"profiles">, userId: Id<"users">): Promise<void>; // manage_integrations or super admin, throws CONNECTOR_FORBIDDEN
export function carriedFields(kind: ConnectorKind): ReadonlyArray<keyof EventIntakeFields>;
export function carriedFieldsHash(kind: ConnectorKind, fields: EventIntakeFields): string; // sha256 of the carried subset, stable key order, after normalisation: when timeTba is true, start, end, doors, and timezone are null; empty strings are null. Every caller (runner after export, applyEventCandidate on import, kind tests) hashes through this one function, so a date-only round trip matches.
export function candidateFromConnectorFields(kind: ConnectorKind, fields: Partial<EventIntakeFields>, decision: EventIntakeDecision): EventIntakeCandidate; // in convex/_eventCandidateApply.ts, created by plan 08 (first structured importer) and consumed by plans 07, 09, 11: every given field gets explicit evidence with origin connector
// convex/eventConnectors.ts (browser session)
export const listForCommunity = query({ args: { communityProfileId } });
export const create = mutation({ args: { communityProfileId, kind, direction, mode, target, credentialId? } }); // returns connectorId; enqueues reconcile
export const update = mutation({ args: { connectorId, direction?, mode?, quietWindowSeconds?, state?: "active" } }); // state active resumes a paused connector after re-running requireConnectorAuthority; never un-sets needs_reauth (kind plans' Reconnect does that)
export const remove = mutation({ args: { connectorId } }); // state removed, links kept
// convex/_eventSync.ts
export async function enqueueEventSync(db: DatabaseWriter, scheduler: Scheduler, eventId: Id<"events">, change: "upsert" | "delete"): Promise<void>; // one pending job per connector per event, replaces
export async function enqueueSyncJob(db, scheduler, job: { connectorId; eventId?; kind; payload?; dueAt? }): Promise<Id<"eventSyncJobs">>;
// convex/eventSync.ts
export const runJob = internalAction({ args: { jobId: v.id("eventSyncJobs") } }); // claims with lease, dispatches by connector.kind to the kind module, completes or fails with backoff 1,2,4,8,16 min, 5 attempts
export const claimJob / completeJob / failJob = internalMutation // the one-pending-per-event replace rule and the superseded close apply only to jobs that carry eventId; connector-level jobs (reconcile, import_poll, board_refresh) and series jobs (payload.seriesId, no eventId) are never superseded by each other and are never closed as event_not_public
// convex/eventSyncKinds/types.ts
export type SyncKindHandler = {
  reconcile?(ctx: ActionCtx, connector: Doc<"eventConnectors">): Promise<void>; // every kind: link matches by date+title; import_item the rest when importing; export_upsert for unlinked upcoming VRDex events when exporting
  exportUpsert?(ctx, connector, event: Doc<"events">, link: Doc<"eventSyncLinks"> | null): Promise<{ externalId: string }>; // the runner, not the kind, writes lastExportedAt and lastExportedHash = carriedFieldsHash(kind, eventFields) after success
  exportDelete?(ctx, connector, link: Doc<"eventSyncLinks">): Promise<void>;
  importItem?(ctx, connector, payload: unknown): Promise<void>;
  importPoll?(ctx, connector): Promise<void>;
  boardRefresh?(ctx, connector): Promise<void>;
  exportSeries?(ctx, connector, series: Doc<"eventSeries">, link: Doc<"eventSyncLinks"> | null): Promise<{ externalId: string }>; // added by plan 11; the runner routes export_upsert jobs that carry payload.seriesId and no eventId here
};
// Every handler method also receives the job as a trailing parameter: (..., job: Doc<"eventSyncJobs">). A handler may return the sentinel `AwaitingClubOperation` (exported from types.ts) to keep the job `running` without spending an attempt; the runner then re-leases it for OPERATION_WAIT_MS (30 minutes) and `claimJob` accepts a `running` job whose lease has expired. On a successful export the runner writes only externalId, lastExportedAt, and lastExportedHash; on export_delete it sets state vrdex_retracted; kinds set external_deleted themselves on import.
// convex/eventSyncKinds/index.ts
export const syncKindHandlers: Record<ConnectorKind, SyncKindHandler>; // plan 02 ships it with no kinds registered; later plans add one module each
// convex/_eventCandidateApply.ts
export async function applyEventCandidate(ctx: MutationCtx, args: {
  connector: Doc<"eventConnectors">; candidate: EventIntakeCandidate; actorUserId: Id<"users">;
  draftId?: Id<"eventIntakeDrafts">; // the caller's working draft (poster sources, source text); when absent, applyEventCandidate creates one
  link?: Doc<"eventSyncLinks">; externalId?: string; externalUpdatedAt?: number; idempotencyKey: string;
  expectedUpdatedAt?: number; // the event updatedAt the caller read (via get_event or a kind fetch) before deciding; a mismatch at write time is `conflict`
}): Promise<{ outcome: "draft" | "published" | "updated" | "not_event" | "conflict" | "skipped_pending_draft" | "skipped_stale" | "skipped_echo"; eventId?: Id<"events">; draftId?: Id<"eventIntakeDrafts"> }>;
// convex/events.ts
export const patchCommunityEventFieldsAsStaff = internalMutation({ args: { actorUserId: v.id("users"), slug: v.string(), expectedUpdatedAt: v.number(), patch: eventIntakeUpdatePatchValidator } }); // returns { eventId, updatedAt, changed }; gate: actor has manage_events or manage_integrations on the community or is super admin; field-level, never whole-record
```

`applyEventCandidate` rules: `decision.not_event` returns `not_event`; `hold` saves the given draft, or a new one, owned by `actorUserId` with the connector ID on the draft and a draft-keyed link, returns `draft`; `autopublish` with a linked event or `decision.update` patches only fields whose evidence is `explicit` (lineup whole-field when any `lineup.*` evidence is explicit), returns `updated`, or `conflict` on `expectedUpdatedAt` mismatch at write time (then files a `hold` draft); an inbound change whose `externalUpdatedAt` is older than the event's `updatedAt` on a `bidirectional` connector returns `skipped_stale` with no draft (VRDex wins and the next export overwrites the copy); an inbound change whose carried-field hash equals the link's `lastExportedHash` returns `skipped_echo`; `autopublish` with no link publishes through `publishIntakeDraft` as the community's own listing with the given `idempotencyKey`, creates the link, returns `published`. If a draft-keyed link exists and is pending, returns `skipped_pending_draft`. Every outcome calls `enqueueProductAnalytics` with `event_sync_apply`. `saveIntakeDraft` in `convex/_eventIntake.ts` gains an options argument `{ connectorDriven?: boolean }` that skips `DRAFT_QUOTA`; `applyEventCandidate` and connector runs pass it. Publishing with a `draftId` publishes that draft, so its poster sources become the event's artwork exactly as a web publish would.

`enqueueEventSync` is called at the end of every existing event write path: `createCommunityEvent`, `createCommunityEventForApiOwner`, `createCommunityEventForMcpOwner`, `updateCommunityEventForApiOwner` and the MCP equivalent, the browser update mutation, `publishIntakeDraft`, contributor retraction, unpublish, cancel, moderation removal, and `patchCommunityEventFieldsAsStaff`. Cancel is `upsert`; unpublish, retraction, and moderation removal are `delete`.

Settings: `apps/web/src/app/account/communities/[slug]/(workspace)/integrations/page.tsx` lists connectors with kind label, target name, direction picker, mode picker, state, last synced, last error, Disconnect. Connect buttons are added by the kind plans. Copy from the connector design's table.

Ops alerts (plan 02): `convex/_opsAlerts.ts` exports `notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void>`, which sends one email to `VRDEX_OPS_ALERT_EMAIL` (default `basic@basicbit.net`) through the SES sender already used by `convex/clubNotificationEmail.ts`, deduplicated to one email per `key` per six hours via a small `opsAlerts { key, lastSentAt, resolvedAt? }` table, plus `resolveOps(ctx, key: string): Promise<void>`, which sends one `[VRDex ops] Resolved:` email when that key is currently alerting and marks it resolved, so every alert path also reports recovery. Callers: the job runner on a connector's fifth consecutive failed job (plan 02), the Google watch-renewal staleness check (plan 08), the gateway heartbeat staleness check (plan 05), the materialiser cron on failure (plan 10). Subject prefix `[VRDex ops]`.

Connector display names: `target` also carries `guildName?`, `channelName?`, `calendarName?`, `groupName?`, captured at connect time for the settings page; never used for matching. `api.eventConnectors.update` enforces the kind's allowed directions (`discord_announcements`: import only; `discord_board`: export only) and rejects others with `CONNECTOR_DIRECTION_INVALID`.

Env (plan 02): `VRDEX_EVENT_CONNECTORS_ENABLED`, `VRDEX_CONNECTOR_TOKEN_KEY`, `VRDEX_OPS_ALERT_EMAIL` (32 bytes base64; `convex/_connectorCrypto.ts` exports `encryptSecret(plain: string): Promise<string>` and `decryptSecret(cipher: string): Promise<string>`, AES-256-GCM, output `v1:<iv>:<tag>:<ciphertext>` base64).

### Discord relay (plan 03, extended by plan 07)

HTTP actions in `convex/http.ts`, all authenticated by `Authorization: Bearer <DISCORD_INTAKE_SECRET>` compared with the existing `safeEqual`, 401 otherwise, 503 when `VRDEX_DISCORD_INTAKE_ENABLED` is not `"true"`:

```text
GET  /discord-intake/connectors?guildId=...[&channelId=...]  -> { connectors: [{ connectorId, kind, direction, mode, state, guildId, channelId?, lastMessageId? }] }   (guildId alone returns that guild's connectors of every Discord kind, which plan 07 needs; channelId narrows to one channel; no query: every active Discord connector, used by the gateway's startup catch-up)
POST /discord-intake/relay    body { kind: "message" | "scheduled_event", action: "create" | "update" | "delete", guildId, channelId?, payload }
POST /discord-intake/command  body { command: "connect" | "disconnect" | "status" | "autocomplete", guildId, channelId, invokerDiscordUserId, invokerHasManageGuild: boolean, options }
POST /discord-intake/heartbeat body { instanceId, at }
```

Message payload: `{ messageId, authorId, authorDisplayName, isBot, content, createdAt, editedAt?, attachments: [{ url, contentType, byteLength }] }`. Scheduled event payload: Discord's `GuildScheduledEvent` JSON as received.

Gateway: `apps/discord-gateway/src/index.ts` adds intents `GuildMessages`, `MessageContent`, `GuildScheduledEvents`; `src/relay.ts` exports `relay(kind, action, guildId, channelId, payload): Promise<void>` using `CONVEX_SITE_URL` and `DISCORD_INTAKE_SECRET`; `src/connectorCache.ts` exports `get(query: { guildId: string; channelId?: string }): Promise<ConnectorSummary[]>` cached for 60 s, where `ConnectorSummary = { connectorId, kind, direction, mode, state, guildId, channelId? }`; `src/commands.ts` defines the `/vrdex` command tree with `default_member_permissions` Manage Guild; `src/register-commands.ts` is the script `pnpm --filter @vrdex/discord-gateway register-commands`. Env: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `CONVEX_SITE_URL`, `DISCORD_INTAKE_SECRET`.

Tables (plan 03): `discordIntakeMessages { connectorId, messageId, guildId, channelId, authorId, authorDisplayName, authorUserId?: Id<"users"> (set at record time when exactly one VRDex user has applied that Discord ID), content, attachments, createdAt, editedAt?, deletedAt?, updatedAt }` index `by_connectorId_messageId`, `by_connectorId_authorId_createdAt`; `discordIntakeRuns { connectorId, authorId, triggerMessageIds: string[], scheduledFunctionId?, state: "pending" | "running" | "done" | "failed", decision?: { kind: "new" } | { kind: "update"; slug: string } | { kind: "not_event"; reason: string } (the whole candidate decision, not only its kind), reason?, draftId?, eventId?, startedAt?, finishedAt?, createdAt }` index `by_connectorId_authorId_state`; `discordIntakeSources { connectorId, messageId, eventId?, draftId?, runId, createdAt }` index `by_connectorId_messageId`, `by_eventId`.

Functions (plan 03): `internal.discordIntake.recordMessage`, `internal.discordIntake.runPending` (its run draft is saved with `saveIntakeDraft(..., { connectorDriven: true, connectorId })` so `draft.connectorId` is set, and `authorizeExtraction` receives `connectorId`, which skips the per-actor extraction cap; downloads attachments, stores poster sources under `authorityUserId`, builds the draft, calls `extractEventIntake` with `context.trigger = "discord"` and `priorEvents` from `discordIntakeSources`, then `applyEventCandidate`), `internal.discordIntake.handleCommand`, `internal.discordIntake.recordHeartbeat`. Quiet window default 120 s, range 30 to 600.

### My events (plan 04)

`api.eventInventory.listHeldImports` query `{ communityProfileId? }` returning held drafts and proposed updates for communities where the user has `manage_events`; mutations `api.eventIntakeHeld.publish { draftId }`, `api.eventIntakeHeld.dismiss { draftId }`. Draft rows gain `connectorId?` and `dismissedAt?`. Flags for staff attention live on `eventSyncLinks.state = external_deleted` and `discordIntakeRuns.reason = source_deleted`, surfaced in the same section.

### Gateway deployment (plan 05)

`infra/terraform/discord-gateway/` following `infra/terraform/restream-worker/` and `group-telemetry-collector/` conventions: ECS Fargate service, one task, image built from `apps/discord-gateway/Dockerfile` (new), secrets `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_INTAKE_SECRET` from Secrets Manager, `CONVEX_SITE_URL` as a variable, outbound only. Heartbeat: the gateway POSTs `/discord-intake/heartbeat` every 60 s; `internal.discordIntake.checkHeartbeat` cron every 5 minutes raises the alarm when the newest heartbeat is older than 300 s, via the existing SNS email topic pattern (`alarm_actions` to the topic that emails `basic@basicbit.net`), using a CloudWatch metric the cron publishes or the ECS running-task-count alarm, builder's choice, with the email action mandatory. Docs: `docs/deployment/discord-gateway.md` rewritten.

### Kind modules (plans 06 to 09)

Each kind plan adds `convex/eventSyncKinds/<kind>.ts` exporting a `SyncKindHandler` and registers it in `syncKindHandlers`, adds its Connect button and target picker to the Integrations page, adds its `VRDEX_CONNECTOR_<KIND>_ENABLED` flag, and emits `event_sync_job` analytics through the runner (the runner does that once; kinds do not).

Discord REST from Convex: `convex/_discordRest.ts` is created by plan 03 (it lands first) and consumed by plans 06 and 07, which do not recreate it. It exports `discordRequest(request: { method: string; path: string; body?: unknown; token?: string }): Promise<Response>`; `token` defaults to `DISCORD_BOT_TOKEN`; on 429 it waits `Retry-After` when that is 5 s or less and retries, at most 3 attempts in all, otherwise it throws. Its test is `tests/backend/discord-rest.test.ts`, owned by plan 03.

Bot authorisation: one permission integer for every kind, `DISCORD_BOT_PERMISSIONS = 17600776072192` (View Channel `1<<10`, Send Messages `1<<11`, Manage Messages `1<<13`, Embed Links `1<<14`, Read Message History `1<<16`, Manage Events `1<<33`, Create Events `1<<44`), exported from `convex/_discordRest.ts` and used by plan 03's invite URL; plans 06 and 07 do not change the URL, and plan 05's bootstrap checklist lists the same seven. Convention for an `exportUpsert` that writes nothing (event outside the board window, non-overridden night of an exported series, date-only event on a kind that needs times): return `{ externalId: "none:" + eventId }`; the runner stores it and every kind treats a `none:` link as "no external copy".

Board (plan 06): `renderEventEmbed(event: PublicEventProjection): DiscordEmbed` in `convex/eventSyncKinds/discordBoard.ts`; window: start within 14 days ahead through 24 hours after end; cancelled events keep their embed with a Cancelled line until retirement; daily cron `board_refresh` per active board connector.

Scheduled events (plan 07): export as `entity_type: 3` (external), `entity_metadata.location` = world name, else venue label, else event URL; `scheduled_end_time` = end or start plus four hours; `image` = poster artwork; cancel sets `status: 4`. Import handles relay payloads for create, update, delete; `status: 4` and delete both set the link `external_deleted` and flag.

Google (plan 08): OAuth client `GOOGLE_CONNECTOR_CLIENT_ID`, `GOOGLE_CONNECTOR_CLIENT_SECRET` on web and Convex; routes `apps/web/src/app/api/connectors/google/start` and `/callback` (session auth, `requireConnectorAuthority`, state in an HTTP-only cookie); scopes `https://www.googleapis.com/auth/calendar.calendarlist.readonly` and `https://www.googleapis.com/auth/calendar.events`; watch channel fields on the connector `target`: `watchChannelId`, `watchResourceId`, `watchExpiresAt`, `syncToken`; webhook `POST /connectors/google/notify` HTTP action validated by the channel token; cron renews watches older than six days and polls every fifteen minutes. Event description's last line is the VRDex event URL. Deletes `convex/_eventCalendarImports.ts`, its three tables, and `tests/backend/event-calendar-imports.test.ts`; updates `docs/backend/event-schema.md` and `docs/planning/calendar-integration.md`.

VRChat (plan 09): club operation payload kinds `create_calendar_event { title, description, startsAt, endsAt, imageUrl?, accessType: "group" }`, `update_calendar_event { calendarEventId, ...same }`, `delete_calendar_event { calendarEventId }`, read `list_calendar_events { from, to }`; integration feature `calendar`; permission `manage_events`, which `api.eventConnectors.create` also requires of the authority for kind `vrchat_calendar` (on top of `manage_integrations`) so every job it enqueues passes `enqueueConnectorOperation`; collector worker implementation in the collector's repo path as `docs/deployment/group-telemetry-collector.md` describes, with artwork uploaded to VRChat before create; title truncated to 64 characters with an ellipsis; `sendCreationNotification: false` always. Poll every 30 minutes.

### Recurrence (plan 10) and series connectors (plan 11)

```ts
eventSeries: { communityProfileId; title; summary?; timezone; venueLabel?; worldSlug?; mediaLinks?; watchMode?; watchSurfaceEnabled?; bannerImageUrl?; thumbnailImageUrl?; sourceUrl?;
  rule: { frequency: "weekly" | "biweekly" | "monthly_weekday"; weekday: 0..6; ordinal?: 1..4 | -1; startTime: "HH:MM"; endTime?: "HH:MM"; doorsTime?: "HH:MM" };
  startsOn: "YYYY-MM-DD"; endsOn?: "YYYY-MM-DD"; count?: number; horizonDays: number; authorityUserId; state: "active" | "ended" | "removed"; createdAt; updatedAt }
events gains: seriesId?: Id<"eventSeries">; occurrenceDate?: "YYYY-MM-DD"; overrides?: string[]
eventSyncLinks gains: seriesId?: Id<"eventSeries">
```

Functions (plan 10): `internal.eventSeries.materialize { seriesId }` (daily cron for all active plus on create), `api.eventSeries.create`, `api.eventSeries.update`, `api.eventSeries.end`, `api.eventSeries.getPublic { seriesId }`, `convex/_eventSeries.ts` exports `occurrenceDates(series, from, to): string[]`, `adoptStandaloneEvent(db, series, date): Promise<Id<"events"> | null>`, `fanOutSeriesEdit(db, series, changedFields): Promise<Id<"events">[]>` (returns the occurrences it changed; the calling mutation runs `enqueueEventSync` for each). Indexes: `eventSeries.by_communityProfileId_state`, `eventSeries.by_state`, `events.by_seriesId_occurrenceDate`. API and MCP owner create paths accept `repeat?: { frequency, weekday, ordinal?, endsOn?, count? }`. Wizard: `event-editor-steps.tsx` Details stage gains the Repeats control. Series page route `/[slug]/series/[seriesId]`.

Plan 11: `eventSyncKinds/googleCalendar.ts` and `discordScheduledEvents.ts` gain series import (recurrence rule parse into the fixed set, else expand) and series export (RRULE or Discord `recurrence_rule` from the fixed set, exceptions per overridden occurrence); migration `internal.migrations.groupOccurrenceLinks` groups links by `externalSeriesId` where the re-fetched rule maps.

## Execution notes

- Every sub-plan starts from `origin/main` in its own worktree and ends in a PR to `main`. VRDex policy: PRs with review iteration, never merge without BASIC.
- Each PR's description lists the exact public strings it ships and cites the spec copy table and BASIC's approval.
- Docs travel with code: `docs/backend/event-schema.md`, `docs/developers/vrdex-mcp-event-writes.md`, `docs/deployment/convex-environments.md`, `docs/deployment/discord-gateway.md`, and `docs/agentic/profile-derived-behavior.md` are updated in the PR that changes the behaviour they describe.
