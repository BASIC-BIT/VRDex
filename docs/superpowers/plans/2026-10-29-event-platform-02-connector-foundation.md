# Event Platform 02: Connector Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the connector tables, token encryption, the leased sync job queue, the `enqueueEventSync` hook on every event write, the staff field patch, `applyEventCandidate`, an Integrations settings page that lists connectors with direction and mode controls, all behind `VRDEX_EVENT_CONNECTORS_ENABLED`, and a deduplicated ops alert email that fires on a connector's fifth consecutive failed job and clears on its next success.

**Architecture:** Four new Convex tables (`eventConnectors`, `connectorCredentials`, `eventSyncLinks`, `eventSyncJobs`) with validators and pure helpers in `convex/_eventConnectors.ts`. Every event write path ends in `enqueueEventSync`, which keeps one pending export job per connector per event; `internal.eventSync.runJob` claims a job with a lease and dispatches to a per-kind handler registry that ships empty. Inbound candidates go through `applyEventCandidate`, which reuses the intake draft and publish helpers and a new field-level staff patch built on the owner update path.

**Tech Stack:** Convex (scheduler, crons, `convex-test`), TypeScript, Web Crypto AES-GCM, Next.js client components, Storybook for the visual check, `node:test`.

**Spec:** `docs/superpowers/plans/2026-10-29-event-platform-master.md` (interface contract, read first), `docs/superpowers/specs/2026-10-29-event-connectors-design.md`, `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md` (Authority and labels, Acting on the decision, Held drafts).

**Depends on:** plan 01 landed: `packages/api-contracts/src/event-intake.ts` has `EventIntakeCandidate.decision` and evidence origin `"connector"`; `convex/_productAnalytics.ts` exports `enqueueProductAnalytics(db, { event, distinctId, properties })`.

## Global Constraints

- Every name, table, index, signature, and env var in the master plan's "Connector foundation (plan 02)" section is used verbatim.
- No em-dash and no double hyphen in any public-facing string. Every new public string comes from the connector design's Public copy table and needs BASIC's approval of the exact wording before the PR merges; list the shipped strings in the PR description.
- No AI mention in any user-facing string.
- Flags default off: `VRDEX_EVENT_CONNECTORS_ENABLED` gates the settings section, `enqueueEventSync`, connector creation, and all job execution. Read it as `process.env.VRDEX_EVENT_CONNECTORS_ENABLED === "true"` through one helper.
- Discord IDs validate with `/^\d{17,20}$/`.
- Caps: connector-driven publish keeps the 100 per community per day cap and skips the 10 per account cap; `authorizeExtraction`'s 20 per actor per day is skipped for connector-driven runs.
- No model call in any sync job. No message to humans from any job; the only email is the operator alert to `VRDEX_OPS_ALERT_EMAIL` (default `basic@basicbit.net`), which is this PR's alarm for the unattended runner.
- Tests: backend in `tests/backend` with `convex-test` and `node:test` (`node --conditions=import --import tsx --test <file>`); web libs in `tests/web` with `node --import tsx --test <file>`. Scheduler timers are frozen with `test.mock.timers.enable({ apis: ["setTimeout"] })` as `tests/backend/club-operations.test.ts:19` does.
- After adding a Convex module, run `pnpm exec convex codegen` and restore `convex/README.md` and `convex/tsconfig.json` if the CLI rewrote them.
- Markdown passes `pnpm exec markdownlint-cli2`; docs under `docs/` are published MDX, so braces and angle brackets stay inside code spans or fences.
- Commit per task with a conventional subject ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work in a worktree off `origin/main`; never in the shared checkout.

## Review Focus

1. An event unpublished or removed after its `export_upsert` was enqueued must not be re-exported when that job runs; the job becomes a delete when a link exists and is skipped otherwise (Task 3, `stale upsert after unpublish runs as delete`).
2. A job that fails while a newer pending job for the same connector and event exists must not return to pending and create a second pending row (Task 3, `failed run superseded by a newer pending job`).
3. A runner that dies mid-action must not leave its job `running` forever; the expired lease counts as a failed attempt (Task 3, `expired lease is recovered as a failed attempt`).
4. A `decision.update` naming a slug from another community must never patch that event (Task 7, `foreign update slug publishes into the connector community instead`).
5. An imported item with a date but no start time must publish as time TBA, not fail the job (Task 7, `date-only candidate publishes as time TBA`).

---

## File map

| File | Responsibility |
| --- | --- |
| `convex/schema.ts` | Four new tables; `eventIntakeDrafts.connectorId` |
| `convex/_eventConnectors.ts` (new) | Validators and types, flag helper, authority, carried fields and hash, pending-draft check, update-patch schema |
| `convex/_connectorCrypto.ts` (new) | `encryptSecret`, `decryptSecret` |
| `convex/_eventSync.ts` (new) | `enqueueSyncJob`, `enqueueEventSync` |
| `convex/eventSync.ts` (new) | `claimJob`, `completeJob`, `failJob`, `runJob`, `recoverExpiredJobs` |
| `convex/eventSyncKinds/types.ts`, `index.ts` (new) | `SyncKindHandler`, empty `syncKindHandlers` |
| `convex/_eventCandidateApply.ts` (new) | `applyEventCandidate` |
| `convex/eventConnectors.ts` (new) | Browser API |
| `convex/events.ts` | Hook calls, `applyOwnerEventUpdate` extraction, `patchCommunityEventFieldsAsStaff` |
| `convex/_eventIntake.ts`, `convex/_eventContributionPreflight.ts`, `convex/eventIntakeSources.ts`, `convex/eventIntake.ts`, `convex/eventCorrections.ts` | Connector bypass options and hook calls |
| `convex/crons.ts` | Job recovery cron |
| `convex/clubStaff.ts` | `eventConnectorsEnabled` on the workspace |
| `apps/web/src/app/account/communities/[slug]/club-integrations-model.ts`, `club-integrations.tsx` (new), `club-workspace-model.ts`, `club-workspace.tsx`, `(workspace)/integrations/page.tsx` (new) | Integrations page and nav |
| `apps/web/src/components/club-integrations.stories.tsx` (new) | Visual check fixture |
| `convex/_opsAlerts.ts`, `convex/opsAlerts.ts`, `convex/opsAlertEmail.ts` (new) | `notifyOps`, `resolveOps`, SES delivery |
| `docs/deployment/convex-environments.md`, `docs/backend/event-schema.md` | Env and schema docs |

---

### Task 1: Connector tables, validators, authority, carried-field hash

**Files:**

- Modify: `convex/schema.ts:1162-1173` (draft `connectorId`), insert the four tables after `eventIntakePublishRequests` (`convex/schema.ts:1181-1185`)
- Create: `convex/_eventConnectors.ts`
- Create: `tests/backend/_eventConnectorFixture.ts`
- Test: `tests/backend/event-connectors.test.ts`

**Interfaces:**

- Consumes: `resolveClubSubject` (`convex/_clubAccess.ts`), `userOwnsProfile` (`convex/_profileOwnership.ts`), `getAccountFeatureAccess` (`convex/_accountFeatures.ts`), `UpdateEventContributionSchema` and `EventIntakeFields` (`packages/api-contracts/src/event-intake.ts`).
- Produces, all from `convex/_eventConnectors.ts`:
  - validators `connectorKind`, `connectorDirection`, `connectorMode`, `connectorState`, `connectorTarget`, `credentialProvider`, `syncLinkState`, `syncJobKind`, `syncJobState`; types `ConnectorKind`, `ConnectorDirection`, `ConnectorMode`, `ConnectorState`, `SyncJobKind` via `Infer`
  - `connectorsEnabled(): boolean`
  - `DISCORD_ID = /^\d{17,20}$/`
  - `allowedDirections(kind: ConnectorKind): ReadonlyArray<ConnectorDirection>`
  - `userAuthSubject(db: DatabaseReader, userId: Id<"users">): Promise<AuthSubject | null>`
  - `userHasCommunityPermission(db: DatabaseReader, communityProfileId: Id<"profiles">, userId: Id<"users">, permissions: ClubPermission[]): Promise<boolean>`
  - `requireConnectorAuthority(ctx: QueryCtx | MutationCtx, communityProfileId: Id<"profiles">, userId: Id<"users">): Promise<void>` (master signature)
  - `carriedFields(kind: ConnectorKind): ReadonlyArray<keyof EventIntakeFields>`, `canonicalIntakeValue(value: unknown): unknown`, `carriedFieldsHash(kind: ConnectorKind, fields: EventIntakeFields): string`
  - `pendingLinkDraft(db: DatabaseReader, link: Doc<"eventSyncLinks"> | null, now?: number): Promise<Doc<"eventIntakeDrafts"> | null>`
  - `EventIntakeUpdatePatchSchema` (zod), `type EventIntakeUpdatePatch`, `eventIntakeUpdatePatchValidator`
- Fixture `tests/backend/_eventConnectorFixture.ts` exports `connectorFixture(options?: { flag?: boolean })` returning `{ t, as, communityProfileId, users, insertConnector, createEvent }`, used by every later backend test in this plan.

- [ ] **Step 1: Write the shared fixture**

```ts
// tests/backend/_eventConnectorFixture.ts
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { loadEventsWithFixtureCapacity } from "./_eventCapacityFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
export const START = Date.UTC(2027, 1, 12, 20); // 2027-02-12 20:00 UTC
const grantedBy = { tokenIdentifier: "test|root", issuer: "test", subject: "root" };

export async function connectorFixture(options: { flag?: boolean } = {}) {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
  if (options.flag === false) delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
  else process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": loadEventsWithFixtureCapacity,
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/eventIntakeSources.ts": () => import("../../convex/eventIntakeSources"),
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors"),
    "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
    "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const [owner, integrator, eventStaff, outsider, admin] = await Promise.all(
      ["owner", "integrator", "event-staff", "outsider", "admin"].map(clerkUserId => ctx.db.insert("users", { clerkUserId })));
    const communityProfileId = await ctx.db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId: owner, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    await ctx.db.insert("accountFeatureGrants", { userId: admin, feature: "super_admin", state: "active", grantedBy, grantedAt: now, updatedAt: now });
    const role = (key: string, permissions: Doc<"communityRoles">["permissions"]) => ctx.db.insert("communityRoles", { communityProfileId, key, label: key, permissions, assignableRoleIds: [], state: "active", createdAt: now, updatedAt: now });
    const grant = async (subject: string, roleId: Id<"communityRoles">) => ctx.db.insert("communityAuthorities", { communityProfileId, subjectTokenIdentifier: `test|${subject}`, subject: { tokenIdentifier: `test|${subject}`, issuer: "test", subject }, roleId, state: "active", grantedAt: now, updatedAt: now });
    const integratorGrant = await grant("integrator", await role("integrations", ["manage_integrations"]));
    await grant("event-staff", await role("events", ["manage_events"]));
    return { communityProfileId, integratorGrant, users: { owner, integrator, eventStaff, outsider, admin } };
  });
  const as = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const insertConnector = (overrides: Partial<Doc<"eventConnectors">> = {}) => t.run(ctx => ctx.db.insert("eventConnectors", {
    communityProfileId: ids.communityProfileId, kind: "google_calendar", direction: "bidirectional", mode: "autopublish",
    authorityUserId: ids.users.integrator, target: { calendarId: "club@example.com" }, state: "active",
    createdAt: Date.now(), updatedAt: Date.now(), ...overrides }));
  const createEvent = (args: { title?: string; startAt?: number; venueLabel?: string; published?: boolean; lineup?: Array<{ clientKey: string; position: number; performerLabel: string }> } = {}) =>
    as("owner").mutation(api.events.createCommunityEvent, { title: args.title ?? "Night Flight", startAt: args.startAt ?? START, timezone: "UTC", communitySlug: "club", published: args.published ?? true, venueLabel: args.venueLabel, lineup: args.lineup });
  return { t, as, ...ids, insertConnector, createEvent };
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/backend/event-connectors.test.ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { carriedFields, carriedFieldsHash, requireConnectorAuthority, sha256Hex } from "../../convex/_eventConnectors";
import { connectorFixture } from "./_eventConnectorFixture";

it("hashes with standard SHA-256", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

it("google calendar carries exactly its schedule, summary, and venue fields", () => {
  assert.deepEqual([...carriedFields("google_calendar")].sort(), ["end", "eventDate", "start", "summary", "timeTba", "timezone", "title", "venueLabel"]);
  assert.equal(carriedFields("vrchat_calendar").includes("venueLabel"), false);
  assert.equal(carriedFields("notion").length, 0);
});

it("carried hash is stable across key order and zero day offsets and ignores uncarried fields", () => {
  const base = { title: "Night Flight", eventDate: "2027-02-12", timezone: "UTC", start: { time: "20:00", dayOffset: 0 }, venueLabel: "Main room" };
  const same = { venueLabel: "Main room ", start: { time: "20:00" }, timezone: "UTC", eventDate: "2027-02-12", title: "Night Flight", worldSlug: "elsewhere", summary: null };
  assert.equal(carriedFieldsHash("google_calendar", base), carriedFieldsHash("google_calendar", same));
  assert.notEqual(carriedFieldsHash("google_calendar", base), carriedFieldsHash("google_calendar", { ...base, title: "Other" }));
  assert.equal(carriedFieldsHash("vrchat_calendar", base), carriedFieldsHash("vrchat_calendar", { ...base, venueLabel: "Changed" }));
});

it("date-only fields hash without their time and timezone", () => {
  const dated = { title: "All Day", eventDate: "2027-05-01", timeTba: true };
  assert.equal(carriedFieldsHash("google_calendar", { ...dated, timezone: "UTC", start: { time: "20:00" } }), carriedFieldsHash("google_calendar", { ...dated, timezone: "", start: null }));
  assert.notEqual(carriedFieldsHash("google_calendar", dated), carriedFieldsHash("google_calendar", { ...dated, timeTba: false, timezone: "UTC", start: { time: "20:00" } }));
});

it("connector authority admits owner, super admin, and manage_integrations staff only", async () => {
  const f = await connectorFixture();
  const check = (userId: typeof f.users.owner) => f.t.run(ctx => requireConnectorAuthority(ctx, f.communityProfileId, userId));
  for (const userId of [f.users.owner, f.users.admin, f.users.integrator]) await check(userId);
  for (const userId of [f.users.eventStaff, f.users.outsider]) await assert.rejects(check(userId), /CONNECTOR_FORBIDDEN/);
  await f.t.run(ctx => ctx.db.patch(f.integratorGrant, { state: "revoked", revokedAt: Date.now() }));
  await assert.rejects(check(f.users.integrator), /CONNECTOR_FORBIDDEN/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-connectors.test.ts`
Expected: FAIL, module `convex/_eventConnectors` not found.

- [ ] **Step 4: Add the schema**

Copy the four table shapes from the master plan, using the validators from Step 5. Add the master's six indexes: `eventConnectors.by_communityProfileId` `["communityProfileId"]`, `eventConnectors.by_kind_target_channelId` `["kind", "target.channelId"]`, `eventSyncLinks.by_connectorId_externalId` `["connectorId", "externalId"]`, `eventSyncLinks.by_eventId` `["eventId"]`, `eventSyncJobs.by_connectorId_eventId_state` `["connectorId", "eventId", "state"]`, `eventSyncJobs.by_state_dueAt` `["state", "dueAt"]`. `eventSyncJobs.payload` is `v.any()`; `scheduledFunctionId` is `v.optional(v.id("_scheduled_functions"))`. Add `connectorId: v.optional(v.id("eventConnectors"))` to `eventIntakeDrafts` (plan 04 then adds only `dismissedAt`).

- [ ] **Step 5: Implement `convex/_eventConnectors.ts`**

Decisions the implementer cannot make alone:

- `connectorTarget` is `v.object({ guildId, channelId, calendarId, groupId, guildName, channelName, calendarName, groupName })`, each `v.optional(v.string())`. The four `*Name` fields are display names captured at connect time (at most 100 characters each), shown on the settings page and never used for matching or uniqueness. Kind plans may add more optional fields (plan 08 adds watch fields).
- `allowedDirections`: `discord_announcements` → `["import", "off"]`; `discord_board` → `["export", "off"]`; `notion` → `["off"]`; every other kind → all four. `off` stays allowed for every kind because it is how a staffer pauses a connector without removing it.
- `eventConnectors` also gets `consecutiveFailures: v.optional(v.number())` (plan-owned bookkeeping for the Task 10 alarm).
- `userAuthSubject`: from `users.clerkUserId` and `process.env.CLERK_JWT_ISSUER_DOMAIN` as `{ subject, issuer, tokenIdentifier: issuer + "|" + subject }`, the shape `convex/_clubNotifications.ts:24-30` builds; `null` when either is missing.
- `userHasCommunityPermission`: true if `getAccountFeatureAccess(db, userId).superAdmin`, else if `userOwnsProfile`, else `resolveClubSubject(db, communityProfileId, subject)` has any of `permissions`. `requireConnectorAuthority` is that with `["manage_integrations"]`, throwing `new ConvexError({ code: "CONNECTOR_FORBIDDEN" })`.
- `carriedFields`, with `TIME = ["title", "eventDate", "timeTba", "timezone", "start", "end"]`:

| Kind | Carried |
| --- | --- |
| `google_calendar`, `discord_scheduled_events` | `TIME`, `summary`, `venueLabel` |
| `vrchat_calendar` | `TIME`, `summary` |
| `discord_board` | `TIME`, `doors`, `summary`, `venueLabel`, `worldSlug`, `sourceUrl`, `lineup` |
| `discord_announcements` | `TIME`, `doors`, `summary`, `venueLabel`, `sourceUrl`, `lineup` |
| `notion` | none |

- `canonicalIntakeValue` and the hash input (the one algorithm the tests do not pin):

```ts
export function canonicalIntakeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return value.map(row => canonicalIntakeValue(row)); // lineup rows, sorted by position first
  if (typeof value === "object") {
    const { clientKey: _k, dayOffset, ...rest } = value as Record<string, unknown>;
    const out = Object.fromEntries(Object.keys(rest).sort().flatMap(key => { const item = canonicalIntakeValue(rest[key]); return item === undefined ? [] : [[key, item]]; }));
    if (typeof dayOffset === "number" && dayOffset !== 0) out.dayOffset = dayOffset;
    return out;
  }
  return value;
}
// carriedFieldsHash: first normalise: empty strings are null, and when fields.timeTba === true, start, end, doors, and timezone are null;
// then sha256Hex(JSON.stringify(sorted carried keys -> [key, canonicalIntakeValue(fields[key])], omitting undefined))
```

- `sha256Hex(text: string): string` is a synchronous FIPS 180-4 SHA-256 over `new TextEncoder().encode(text)`, kept in this file and exported for the test. The Convex default runtime has only async `crypto.subtle.digest`, and the master fixes `carriedFieldsHash` as synchronous; no hashing dependency is installed.
- `pendingLinkDraft` returns the draft when `link?.draftId` points at a draft with no `publishedReceiptId` and `expiresAt > now`; else `null`.
- `EventIntakeUpdatePatchSchema = UpdateEventContributionSchema.shape.patch`; `eventIntakeUpdatePatchValidator = v.record(v.string(), v.any())`. The handler parses with the zod schema, as `convex/eventCorrections.ts` does for `patch: v.any()`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-connectors.test.ts && pnpm typecheck:backend`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/_eventConnectors.ts tests/backend/_eventConnectorFixture.ts tests/backend/event-connectors.test.ts
git commit -m "feat(connectors): add connector tables, authority, and carried-field hash" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Connector token encryption

**Files:**

- Create: `convex/_connectorCrypto.ts`
- Modify: `docs/deployment/convex-environments.md` (new `## Event connectors` section before `## Locked Decision`)
- Test: `tests/backend/connector-crypto.test.ts`

**Interfaces:**

- Produces: `encryptSecret(plain: string): Promise<string>`, `decryptSecret(cipher: string): Promise<string>` (master signatures). Output `v1:<iv>:<tag>:<ciphertext>`, each part base64.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { decryptSecret, encryptSecret } from "../../convex/_connectorCrypto";

process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

it("round-trips with a fresh IV in the v1 format", async () => {
  const a = await encryptSecret("ya29.token");
  const b = await encryptSecret("ya29.token");
  assert.match(a, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a.split(":")[1]!, "base64").length, 12);
  assert.equal(Buffer.from(a.split(":")[2]!, "base64").length, 16);
  assert.equal(await decryptSecret(a), "ya29.token");
});

it("rejects tampered ciphertext, tag, and version", async () => {
  const [v, iv, tag, body] = (await encryptSecret("refresh")).split(":");
  const flip = (s: string) => { const bytes = Buffer.from(s, "base64"); bytes[0] ^= 1; return bytes.toString("base64"); };
  await assert.rejects(decryptSecret([v, iv, tag, flip(body!)].join(":")));
  await assert.rejects(decryptSecret([v, iv, flip(tag!), body].join(":")));
  await assert.rejects(decryptSecret(["v2", iv, tag, body].join(":")), /CONNECTOR_CIPHER_VERSION/);
});

it("refuses a key that is not 32 bytes", async () => {
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(16, 1).toString("base64");
  await assert.rejects(encryptSecret("x"), /VRDEX_CONNECTOR_TOKEN_KEY/);
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/connector-crypto.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `convex/_connectorCrypto.ts`**

Use Web Crypto (`crypto.subtle.importKey("raw", key, "AES-GCM", false, [...])`, 12-byte random IV, 128-bit tag), not `node:crypto`. Reason: `node:crypto` forces every importer into a `"use node"` file, and `"use node"` files may only export actions (see `convex/claimAnalyticsDelivery.ts`), while kind handlers reach this module through `convex/eventSync.ts`, which must also hold `claimJob`, `completeJob`, and `failJob` as mutations. Web Crypto exists in both Convex runtimes and in Node, and the master's `Promise` signatures fit it. Web Crypto appends the tag to the ciphertext; split the last 16 bytes into the `tag` part. A missing key or a decoded length other than 32 throws `Error("VRDEX_CONNECTOR_TOKEN_KEY must be 32 bytes, base64 encoded.")`; a prefix other than `v1` throws `Error("CONNECTOR_CIPHER_VERSION")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --conditions=import --import tsx --test tests/backend/connector-crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Document `VRDEX_CONNECTOR_TOKEN_KEY`**

In the new `## Event connectors` section of `docs/deployment/convex-environments.md`: name; scope Convex deployment environment only (never web); owner the deployment operator (BASIC); value 32 random bytes, base64 (`openssl rand -base64 32`), set with `npx convex env set`; stored only in the Convex environment. Rotation: replacing the value makes every stored connector token unreadable, so each OAuth connector must be reconnected from the Integrations page; the `v1:` prefix leaves room for a dual-key rotation later.

- [ ] **Step 6: Commit**

```bash
git add convex/_connectorCrypto.ts tests/backend/connector-crypto.test.ts docs/deployment/convex-environments.md
git commit -m "feat(connectors): encrypt connector tokens with AES-256-GCM" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Sync job queue and runner

**Files:**

- Create: `convex/_eventSync.ts`, `convex/eventSync.ts`, `convex/eventSyncKinds/types.ts`, `convex/eventSyncKinds/index.ts`
- Modify: `convex/eventCorrections.ts:34` (export `correctionFields`)
- Modify: `convex/crons.ts:116` (add the recovery cron after the last interval)
- Modify: `docs/deployment/convex-environments.md` (flag), `docs/backend/event-schema.md` (new `## Connectors` section before `## Event Operations Panel` at line 320)
- Test: `tests/backend/event-sync-jobs.test.ts`

**Interfaces:**

- Consumes: Task 1 validators, `connectorsEnabled`, `userHasCommunityPermission`, `pendingLinkDraft`, `carriedFieldsHash`; `enqueueProductAnalytics` (plan 01).
- Produces:
  - `enqueueSyncJob(db: DatabaseWriter, scheduler: Scheduler, job: { connectorId: Id<"eventConnectors">; eventId?: Id<"events">; kind: SyncJobKind; payload?: unknown; dueAt?: number }): Promise<Id<"eventSyncJobs">>`
  - `enqueueEventSync(db: DatabaseWriter, scheduler: Scheduler, eventId: Id<"events">, change: "upsert" | "delete"): Promise<void>`
  - `internal.eventSync.claimJob { jobId }` returning `null | { job, connector, event: Doc<"events"> | null, link: Doc<"eventSyncLinks"> | null, fields: EventIntakePatch | null }`
  - `internal.eventSync.completeJob { jobId, externalId?: string, exportedHash?: string, durationMs: number }`
  - `internal.eventSync.failJob { jobId, error: string, durationMs: number }`
  - `internal.eventSync.runJob { jobId }`, `internal.eventSync.awaitJob { jobId }`, `internal.eventSync.recoverExpiredJobs {}`
  - `SyncKindHandler` exactly as the master types it, with `ctx: ActionCtx`, `connector: Doc<"eventConnectors">`, a trailing `job: Doc<"eventSyncJobs">` on every method, and every return type widened with `| typeof AwaitingClubOperation`; `types.ts` also exports `AwaitingClubOperation` (a `unique symbol`, `Symbol("AwaitingClubOperation")`) and `OPERATION_WAIT_MS = 30 * 60_000`; `syncKindHandlers: Record<ConnectorKind, SyncKindHandler>` with `{}` for every kind
  - `correctionFields(db: DatabaseReader, event: Doc<"events">): Promise<EventIntakePatch>` exported from `convex/eventCorrections.ts`
  - Constants in `convex/eventSync.ts`: `MAX_ATTEMPTS = 5`, `BACKOFF_MINUTES = [1, 2, 4, 8, 16]`, `LEASE_MS = 600_000`, `RECOVERY_GRACE_MS = 300_000`, `JOB_RETENTION_MS = 30 * 86_400_000`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-sync-jobs.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { makeFunctionReference } from "convex/server";
import { enqueueEventSync, enqueueSyncJob } from "../../convex/_eventSync";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import { syncKindHandlers } from "../../convex/eventSyncKinds/index";
import { AwaitingClubOperation, OPERATION_WAIT_MS } from "../../convex/eventSyncKinds/types";
import { connectorFixture } from "./_eventConnectorFixture";

const claim = makeFunctionReference<"mutation">("eventSync:claimJob");
const fail = makeFunctionReference<"mutation">("eventSync:failJob");
const run = makeFunctionReference<"action">("eventSync:runJob");
const recover = makeFunctionReference<"mutation">("eventSync:recoverExpiredJobs");
const NOW = Date.UTC(2027, 0, 10, 12);
beforeEach(test => test.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW }));
const jobs = (f: Awaited<ReturnType<typeof connectorFixture>>) => f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());

it("keeps one pending job per connector per event and cancels the replaced schedule", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect().then(rows => Promise.all(rows.map(row => ctx.db.delete(row._id)))));
  const first = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  const firstFn = (await f.t.run(ctx => ctx.db.get(first)))!.scheduledFunctionId!;
  const second = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
  assert.equal(second, first);
  const pending = (await jobs(f)).filter(row => row.state === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.kind, "export_delete");
  assert.equal((await f.t.run(ctx => ctx.db.system.get(firstFn)))!.state.kind, "canceled");
});

it("enqueueEventSync is a no-op when the flag is off and skips import-only and off connectors", async () => {
  const f = await connectorFixture({ flag: false });
  await f.insertConnector({ direction: "export" });
  await f.createEvent();
  assert.equal((await jobs(f)).length, 0);
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  const g = await connectorFixture();
  await g.insertConnector({ direction: "import" });
  await g.insertConnector({ direction: "off", target: { calendarId: "b" } });
  await g.createEvent();
  assert.equal((await jobs(g)).length, 0);
});

it("backs off 1, 2, 4, 8 minutes and marks the job failed on the fifth failure", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ direction: "export" });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  for (const [index, minutes] of [1, 2, 4, 8].entries()) {
    assert.ok(await f.t.mutation(claim, { jobId }));
    await f.t.mutation(fail, { jobId, error: `boom ${index}`, durationMs: 5 });
    const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
    assert.equal(job.state, "pending");
    assert.equal(job.attempts, index + 1);
    assert.equal(job.dueAt, Date.now() + minutes * 60_000);
  }
  assert.ok(await f.t.mutation(claim, { jobId }));
  await f.t.mutation(fail, { jobId, error: "boom final", durationMs: 5 });
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "failed");
  assert.equal(job.attempts, 5);
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.lastError, "boom final");
  const analytics = await f.t.run(ctx => ctx.db.query("productAnalyticsOutbox").collect());
  assert.deepEqual(analytics.filter(row => row.event === "event_sync_job").map(row => row.properties.outcome), ["failed"]);
});

it("an unregistered kind fails with a clear error", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
  await f.t.action(run, { jobId });
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "pending");
  assert.equal(job.attempts, 1);
  assert.match(job.lastError ?? "", /No import_poll handler is registered for connector kind google_calendar/);
});

it("the runner writes the link after a kind's export, and retracts it after a delete", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const google = syncKindHandlers.google_calendar;
  google.exportUpsert = async () => ({ externalId: "g-9" });
  google.exportDelete = async () => {};
  try {
    const upsert = { _id: await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" })) };
    await f.t.action(run, { jobId: upsert._id });
    const expected = await f.t.run(async ctx => carriedFieldsHash("google_calendar", await correctionFields(ctx.db, (await ctx.db.get(eventId))!)));
    const link = async () => (await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique()))!;
    assert.deepEqual([(await link()).externalId, (await link()).lastExportedAt, (await link()).lastExportedHash, (await link()).state], ["g-9", Date.now(), expected, "linked"]);
    const remove = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
    await f.t.action(run, { jobId: remove });
    assert.equal((await link()).state, "vrdex_retracted");
  } finally {
    delete google.exportUpsert;
    delete google.exportDelete;
  }
});

it("reconcile enqueues exports for unlinked upcoming events even without a kind reconcile", async () => {
  const f = await connectorFixture();
  const upcoming = await f.createEvent({ title: "Upcoming" });
  const linked = await f.createEvent({ title: "Linked", startAt: Date.now() + 5 * 86_400_000 });
  const past = await f.createEvent({ title: "Past", startAt: Date.now() - 3 * 86_400_000 });
  const far = await f.createEvent({ title: "Far", startAt: Date.now() + 120 * 86_400_000 });
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId: linked.eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.action(run, { jobId });
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.state, "done");
  const exports = (await jobs(f)).filter(row => row.kind === "export_upsert" && row.state === "pending").map(row => row.eventId);
  assert.deepEqual(exports, [upcoming.eventId]);
  void past; void far;
});

it("pauses the connector when its authority lost manage_integrations", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.run(ctx => ctx.db.patch(f.integratorGrant, { state: "revoked", revokedAt: Date.now() }));
  assert.equal(await f.t.mutation(claim, { jobId }), null);
  const connector = (await f.t.run(ctx => ctx.db.get(connectorId)))!;
  assert.equal(connector.state, "paused");
  assert.equal(connector.lastError, "authority_lost");
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.state, "done");
});

it("a pending held draft blocks exports for that event", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(async ctx => {
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.integrator, connectorId, version: 1, fields: { title: "Held" }, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    await ctx.db.insert("eventSyncLinks", { connectorId, eventId, draftId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const job = { _id: await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" })) };
  assert.equal(await f.t.mutation(claim, { jobId: job._id }), null);
  const after = (await f.t.run(ctx => ctx.db.get(job._id)))!;
  assert.equal(after.state, "done");
  assert.equal(after.lastError, "pending_draft");
});

it("stale upsert after unpublish runs as delete", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.run(ctx => ctx.db.patch(eventId, { publicationState: "draft_private" }));
  const claimed = await f.t.mutation(claim, { jobId });
  assert.equal(claimed.job.kind, "export_delete");
});

it("failed run superseded by a newer pending job", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.mutation(claim, { jobId });
  await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.mutation(fail, { jobId, error: "boom", durationMs: 1 });
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.lastError, "superseded");
  assert.equal((await jobs(f)).filter(row => row.eventId === eventId && row.state === "pending").length, 1);
});

it("a handler returning AwaitingClubOperation keeps the job running without spending an attempt", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const google = syncKindHandlers.google_calendar;
  google.importPoll = async () => AwaitingClubOperation;
  try {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
    await f.t.action(run, { jobId });
    const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
    assert.deepEqual([job.state, job.attempts, job.leaseExpiresAt], ["running", 0, Date.now() + OPERATION_WAIT_MS]);
  } finally {
    delete google.importPoll;
  }
});

it("a running job is claimable only after its lease expires", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
  assert.ok(await f.t.mutation(claim, { jobId }));
  assert.equal(await f.t.mutation(claim, { jobId }), null);
  t.mock.timers.tick(600_001);
  const reclaimed = await f.t.mutation(claim, { jobId });
  assert.equal(reclaimed.job.attempts, 2);
});

it("a failing reconcile beside a pending import_poll counts as a failure", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const reconcile = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.mutation(claim, { jobId: reconcile });
  const poll = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
  await f.t.mutation(fail, { jobId: reconcile, error: "boom", durationMs: 1 });
  const job = (await f.t.run(ctx => ctx.db.get(reconcile)))!;
  assert.deepEqual([job.state, job.attempts, job.lastError], ["pending", 1, "boom"]);
  assert.notEqual(poll, reconcile);
  assert.equal((await f.t.run(ctx => ctx.db.get(poll)))!.state, "pending");
});

it("a date-only event's export hash equals its fields with a null timezone", async () => {
  const f = await connectorFixture();
  const event = await f.t.run(async ctx => ctx.db.get(await ctx.db.insert("events", { title: "All Day", sortTitle: "all day", slug: "allday01", communityProfileId: f.communityProfileId, sourceType: "community", sourceLabel: "Community-submitted event", eventStatus: "scheduled", publicationState: "published", scheduleKind: "date_only", eventDate: "2027-05-01", updatedAt: Date.now() })));
  const fields = await f.t.run(ctx => correctionFields(ctx.db, event!));
  assert.equal(carriedFieldsHash("google_calendar", fields), carriedFieldsHash("google_calendar", { ...fields, timezone: null }));
});

it("expired lease is recovered as a failed attempt", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.mutation(claim, { jobId });
  t.mock.timers.tick(600_000 + 300_001);
  await f.t.mutation(recover, {});
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "pending");
  assert.equal(job.lastError, "lease_expired");
  assert.equal(job.dueAt, Date.now() + 60_000);
});

it("enqueueEventSync sends delete only where a link exists", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent({ published: false });
  const linked = await f.insertConnector({ direction: "export" });
  await f.insertConnector({ direction: "export", target: { calendarId: "other" } });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId: linked, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  await f.t.run(ctx => enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert"));
  const rows = (await jobs(f)).filter(row => row.eventId === eventId);
  assert.deepEqual(rows.map(row => [row.connectorId, row.kind]), [[linked, "export_delete"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-sync-jobs.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `convex/_eventSync.ts`**

`enqueueSyncJob`: only when `job.eventId` is set (never for connector-level jobs such as `reconcile`, `import_poll`, `board_refresh`, or series jobs carrying `payload.seriesId` without `eventId`) and a `pending` row exists on `by_connectorId_eventId_state` with that exact `eventId`, cancel its `scheduledFunctionId` if `db.system.get(id)?.state.kind === "pending"` (the `convex/_profileLinkDestinationCache.ts:27` pattern) and patch that row in place with the new `kind`, `payload ?? null`, `dueAt`, `attempts: 0`, `lastError: undefined`, new `scheduledFunctionId`; otherwise insert. Schedule with `scheduler.runAt(dueAt ?? Date.now(), internal.eventSync.runJob, { jobId })`.

`enqueueEventSync`, in order: return unless `connectorsEnabled()`; load the event, return without `communityProfileId`; the effective change is `upsert` only when `change === "upsert"`, `publicationState === "published"`, and `moderationRemovedAt` is unset, otherwise `delete`; read connectors on `by_communityProfileId` (`take(50)`) with `state === "active"` and direction `export` or `bidirectional`; for `upsert` enqueue `export_upsert` on each; for `delete` enqueue `export_delete` only on connectors with a `linked` link for this event (`by_eventId`).

- [ ] **Step 4: Implement `convex/eventSyncKinds/types.ts` and `index.ts`**

`types.ts` is the master's `SyncKindHandler`, fully typed with the trailing `job` parameter and the sentinel return, plus `AwaitingClubOperation` and `OPERATION_WAIT_MS`. `index.ts` exports `syncKindHandlers` with `{}` for each of the six kinds.

- [ ] **Step 5: Implement `convex/eventSync.ts` and export `correctionFields`**

`claimJob`, in order, returning `null` after any terminal patch:

1. Job missing, or neither `pending` nor `running` with `leaseExpiresAt <= now`: `null`, no write. A `running` job with a live lease is never claimed; an expired one is (a crashed runner, or a job whose club-operation wait has elapsed).
2. Flag off: `done`, `lastError: "connectors_disabled"`. Connector missing or `state !== "active"`: `done`, `"connector_inactive"`. Direction `off`: `done`, `"connector_off"`.
3. `!userHasCommunityPermission(db, connector.communityProfileId, connector.authorityUserId, ["manage_integrations"])`: patch connector `{ state: "paused", lastError: "authority_lost", updatedAt }`, job `done` with `"authority_lost"`.
4. Export jobs that carry `eventId` (series jobs without one skip this step and go to their kind): load event and this connector's link. `export_upsert` on an event that is missing, unpublished, or moderation-removed becomes `export_delete` when a link exists, else `done` with `"event_not_public"`. `export_upsert` where `pendingLinkDraft(link)` is non-null: `done`, `"pending_draft"`. `export_delete` with no `linked` link: `done`, `"no_link"`.
5. Generic reconcile, for every kind: a `reconcile` job on an `export` or `bidirectional` connector reads the community's events on `by_communityProfileId_sortAt` with `sortAt` from `now - 86_400_000` to `now + 90 * 86_400_000` (`take(200)`), keeps those that are published, not moderation-removed, `scheduled`, and have no link for this connector, and calls `enqueueSyncJob` with `export_upsert` for each. It runs here, in the claim mutation, before the kind's own `reconcile` gets the job; the kind's `exportUpsert` still lists the target and links a match before creating a copy, so this never duplicates a hand-made copy.
6. Patch `{ state: "running", attempts: attempts + 1, leaseExpiresAt: now + LEASE_MS, kind }` and return the bundle; `fields` is `await correctionFields(db, event)` for `export_upsert`, else `null`.

Every terminal patch in steps 2 to 4 emits `event_sync_job` with outcome `skipped` and the reason.

`runJob`: claim; `null` returns. Inside one `try`: pick the handler method for the job kind (`export_upsert` → `exportUpsert`, and so on) and call it with the claimed `job` as the trailing argument; a missing method throws `Error("No " + job.kind + " handler is registered for connector kind " + connector.kind + ".")`, except `reconcile`, where a missing method means the generic part from claim step 5 was the whole job and it completes. Kinds return only `{ externalId }` from `exportUpsert`; the runner, not the kind, writes the link in `completeJob`. For `export_upsert` compute `exportedHash = carriedFieldsHash(connector.kind, fields)` from the claimed fields before calling the handler. Success calls `completeJob`; any throw calls `failJob` with the message cut to 500 characters.

`completeJob` (job must be `running`): `done`, clear lease; `export_upsert` patches only `externalId`, `lastExportedAt`, and `lastExportedHash: exportedHash` on this connector's link for the event (match on `by_eventId`), or inserts one with those fields plus the required `state: "linked"` when none exists; it never changes an existing link's state. `export_delete` sets the link `vrdex_retracted`, the only state the runner writes on an existing link; kinds set `external_deleted` themselves on import. connector gets `lastSyncedAt: now`, `lastError: undefined`.

`failJob` and the lease recovery share one helper. Only when the job carries `eventId`: if another `pending` job exists on `by_connectorId_eventId_state` with this `connectorId` and `eventId`, close it `done` with `lastError: "superseded"`. A job without `eventId` is never superseded, so a failing `reconcile` beside a pending `import_poll` still counts as a failure. Else if `attempts >= MAX_ATTEMPTS`: `failed`, `lastError`, and the connector's `lastError`. Else `pending` with `dueAt = now + BACKOFF_MINUTES[attempts - 1] * 60_000`, rescheduled with `runAt`, `lastError` kept. Five attempts mean the fifth failure is final, so 16 minutes is never used; the constant keeps the master's series.

`awaitJob` (job must be `running`): the handler returned `AwaitingClubOperation`, so give back the attempt the claim spent (`attempts - 1`), set `leaseExpiresAt: now + OPERATION_WAIT_MS`, schedule `runJob` with `runAt(leaseExpiresAt)`, store its `scheduledFunctionId`, and emit no analytics; the job stays `running`. `runJob` calls it instead of `completeJob` whenever the handler result is the sentinel.

`recoverExpiredJobs`: up to 100 `running` rows on `by_state_dueAt` with `leaseExpiresAt <= now - RECOVERY_GRACE_MS` go through the failure helper with `"lease_expired"`; then delete up to 200 `done` and 200 `failed` rows with `dueAt < now - JOB_RETENTION_MS`.

Analytics: completion, final failure, and skips each call `enqueueProductAnalytics(db, { event: "event_sync_job", distinctId: String(connector.authorityUserId), properties: { jobKind, connectorKind, direction, outcome, attempts, durationMs, reason } })`, outcome one of `done`, `skipped`, `failed`. A retry emits nothing, so each job emits exactly one event.

- [ ] **Step 6: Add the cron**

`crons.interval("recover event sync jobs", { minutes: 5 }, internal.eventSync.recoverExpiredJobs, {});`

- [ ] **Step 7: Run tests and codegen**

Run: `pnpm exec convex codegen && node --conditions=import --import tsx --test tests/backend/event-sync-jobs.test.ts tests/backend/event-corrections.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 8: Docs**

`docs/deployment/convex-environments.md` `## Event connectors`: `VRDEX_EVENT_CONNECTORS_ENABLED`, Convex only, default unset (off), owner BASIC, gates the Integrations page, connector creation, `enqueueEventSync`, and job execution; turning it off leaves pending jobs to close as `connectors_disabled`.

`docs/backend/event-schema.md` `## Connectors`: the four tables and their indexes; the link as echo guard (`lastExportedHash`) and dedupe; draft-keyed links block exports; `enqueueEventSync` as the single hook; one pending job per connector per event; lease, five attempts, backoff, `superseded`, recovery cron, 30-day retention; kinds register in `convex/eventSyncKinds/index.ts`.

- [ ] **Step 9: Commit**

```bash
git add convex/_eventSync.ts convex/eventSync.ts convex/eventSyncKinds convex/eventCorrections.ts convex/crons.ts convex/_generated tests/backend/event-sync-jobs.test.ts docs/deployment/convex-environments.md docs/backend/event-schema.md
git commit -m "feat(connectors): add leased sync job queue and runner" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Call `enqueueEventSync` from every event write path

**Files:**

- Modify: `convex/events.ts:992-1011` (`createCommunityEventForApiOwnerRecord` takes `ctx: MutationCtx`, callers `:3047`, `:3094` pass `ctx`)
- Modify: `convex/events.ts:1170-1253` (`insertCommunityEventRecord` takes `ctx: MutationCtx`; enqueue before the final `return` at `:1243`; caller `:2839` passes `ctx`)
- Modify: `convex/events.ts:1255-1445` (`updateCommunityEventRecord`; enqueue before the final `return` at `:1440`)
- Modify: `convex/events.ts:3554` (`setCommunityEventPublished`, changed branch) and `:3639` (`setCommunityEventCancelled`)
- Modify: `convex/_eventIntake.ts:107-178` (`publishIntakeDraft` takes `ctx: Pick<MutationCtx, "db" | "scheduler">` first; enqueue before `:178`), `convex/eventIntake.ts:32` (pass `ctx`)
- Modify: `convex/eventCorrections.ts:128` (`updateActorContribution`), `:141` (`retractActorContribution`), `:224` (`removeContributedEvent`)
- Test: `tests/backend/event-sync-hooks.test.ts`

**Interfaces:**

- Consumes: `enqueueEventSync` (Task 3).
- Produces: every listed path ends in exactly one `enqueueEventSync`. The record helpers cover `createCommunityEvent`, `createCommunityEventForApiOwner`, `createCommunityEventForMcpOwner`, `updateCommunityEventForApiOwner`, `updateCommunityEventForMcpOwner`, `updateCommunityEvent`, and (Task 5) `patchCommunityEventFieldsAsStaff`. `publishIntakeDraft` callers pass a mutation `ctx`.

| Path | Insertion | Change |
| --- | --- | --- |
| `insertCommunityEventRecord` | `convex/events.ts:1243` | `upsert` |
| `updateCommunityEventRecord` | `convex/events.ts:1440` | `upsert` (an unpublish becomes delete inside `enqueueEventSync`) |
| `setCommunityEventPublished` | `convex/events.ts:3554` | `upsert` (same rule) |
| `setCommunityEventCancelled` | `convex/events.ts:3639` | `upsert` |
| `publishIntakeDraft` | `convex/_eventIntake.ts:178` | `upsert` |
| `updateActorContribution` | `convex/eventCorrections.ts:128` | `upsert` |
| `retractActorContribution` | `convex/eventCorrections.ts:141` | `delete` |
| `removeContributedEvent` | `convex/eventCorrections.ts:224` | `delete` |

- [ ] **Step 1: Write the failing test**

```ts
// tests/backend/event-sync-hooks.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api, internal } from "../../convex/_generated/api";
import { connectorFixture, START } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
async function setup() {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ direction: "export" });
  const pending = async (eventId: string) => (await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect()))
    .filter(row => row.eventId === eventId && row.state === "pending").map(row => row.kind);
  const link = (eventId: any) => f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: `g-${eventId}`, state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  return { ...f, connectorId, pending, link };
}

it("browser create, update, cancel, and unpublish each leave one pending job of the right kind", async () => {
  const f = await setup();
  const { eventId, slug } = await f.createEvent();
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.as("owner").mutation(api.events.updateCommunityEvent, { currentSlug: slug, title: "Renamed" });
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.as("owner").mutation(api.events.setCommunityEventCancelled, { currentSlug: slug, cancelled: true, reason: "Storm" });
  assert.deepEqual(await f.pending(eventId), ["export_upsert"]);
  await f.link(eventId);
  await f.as("owner").mutation(api.events.setCommunityEventPublished, { currentSlug: slug, published: false });
  assert.deepEqual(await f.pending(eventId), ["export_delete"]);
});

it("an unpublished browser create enqueues nothing", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent({ published: false });
  assert.deepEqual(await f.pending(eventId), []);
});

it("API owner create and update enqueue through the shared record helpers", async () => {
  const f = await setup();
  const created = await f.t.mutation(internal.events.createCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: f.users.owner, title: "API Night", startAt: START, timezone: "UTC", communitySlug: "club" });
  assert.deepEqual(await f.pending(created.eventId), ["export_upsert"]);
  await f.t.mutation(internal.events.updateCommunityEventForApiOwner, { actorKind: "personal_api_token", ownerUserId: f.users.owner, currentSlug: created.slug, summary: "Updated" });
  assert.deepEqual(await f.pending(created.eventId), ["export_upsert"]);
});

it("contributor publish, update, retraction, and moderation removal enqueue", async () => {
  const f = await setup();
  const contributor = f.as("outsider");
  const draft = await contributor.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "club", title: "Guest Night", eventDate: "2027-03-01", timeTba: true } });
  const published = await f.t.mutation(internal.eventIntake.commitPublishIntake, { actorUserId: f.users.outsider, actorSurface: "api", draftId: draft.draftId, expectedVersion: draft.version, idempotencyKey: "guest-night" });
  assert.deepEqual(await f.pending(published.eventId), ["export_upsert"]);
  const event = (await f.t.run(ctx => ctx.db.get(published.eventId)))!;
  await f.t.mutation(internal.eventCorrections.updateActorContributedEvent, { actorUserId: f.users.outsider, eventId: event._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "More" } });
  assert.deepEqual(await f.pending(event._id), ["export_upsert"]);
  await f.link(event._id);
  await f.t.mutation(internal.eventCorrections.retractActorContributedEvent, { actorUserId: f.users.outsider, eventId: event._id });
  assert.deepEqual(await f.pending(event._id), ["export_delete"]);
  const second = await contributor.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "club", title: "Second Night", eventDate: "2027-03-02", timeTba: true } });
  const other = await f.t.mutation(internal.eventIntake.commitPublishIntake, { actorUserId: f.users.outsider, actorSurface: "api", draftId: second.draftId, expectedVersion: second.version, idempotencyKey: "second-night" });
  await f.link(other.eventId);
  await f.as("admin").mutation(api.eventCorrections.removeContributedEvent, { eventId: other.eventId, reason: "Spam listing" });
  assert.deepEqual(await f.pending(other.eventId), ["export_delete"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --conditions=import --import tsx --test tests/backend/event-sync-hooks.test.ts`
Expected: FAIL, no `eventSyncJobs` rows.

- [ ] **Step 3: Insert the calls listed in the table**

Each call is `await enqueueEventSync(ctx.db, ctx.scheduler, eventId, change)` placed after the path's last write and before its `return`. The replay early returns in `createCommunityEventForMcpOwner` and `publishIntakeDraft` stay without a call.

- [ ] **Step 4: Run the new test and the suites these paths already have**

Run: `node --conditions=import --import tsx --test tests/backend/event-sync-hooks.test.ts tests/backend/event-foundation.test.ts tests/backend/event-api-ownership.test.ts tests/backend/event-intake.test.ts tests/backend/event-corrections.test.ts tests/backend/hosted-mcp-event-writes.test.ts && pnpm typecheck:backend`
Expected: PASS. The existing suites do not set the flag, so they see no new rows.

- [ ] **Step 5: Commit**

```bash
git add convex/events.ts convex/_eventIntake.ts convex/eventIntake.ts convex/eventCorrections.ts tests/backend/event-sync-hooks.test.ts
git commit -m "feat(connectors): enqueue event sync from every event write path" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Staff field patch

**Files:**

- Modify: `convex/events.ts:1036-1126` (extract `applyOwnerEventUpdate`), add `patchCommunityEventFieldsAsStaffRecord` and the `patchCommunityEventFieldsAsStaff` internal mutation after `updateCommunityEventForMcpOwner` (`:3223`)
- Test: `tests/backend/event-staff-field-patch.test.ts`

**Interfaces:**

- Consumes: `userHasCommunityPermission`, `EventIntakeUpdatePatchSchema`, `eventIntakeUpdatePatchValidator`, `canonicalIntakeValue` (Task 1); `correctionFields` (Task 3); `normalizeIntakePublication` (`convex/_eventContributionPreflight.ts`).
- Produces:
  - `patchCommunityEventFieldsAsStaff = internalMutation({ args: { actorUserId: v.id("users"), slug: v.string(), expectedUpdatedAt: v.number(), patch: eventIntakeUpdatePatchValidator } })` returning `{ eventId, updatedAt, changed }` (master)
  - `patchCommunityEventFieldsAsStaffRecord(ctx: MutationCtx, args: { actorUserId: Id<"users">; slug: string; expectedUpdatedAt: number; patch: unknown }): Promise<{ eventId: Id<"events">; updatedAt: number; changed: boolean }>` exported for `applyEventCandidate`
  - Errors: `ConvexError({ code: "EVENT_STAFF_REQUIRED" })`, `ConvexError({ code: "VERSION_CONFLICT" })`, `ConvexError({ code: "EVENT_NOT_FOUND" })`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-staff-field-patch.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { internal } from "../../convex/_generated/api";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const patchRef = internal.events.patchCommunityEventFieldsAsStaff;
async function setup() {
  const f = await connectorFixture();
  const created = await f.createEvent({ venueLabel: "Main room", lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "b", position: 1, performerLabel: "DJ B" }] });
  const event = async () => (await f.t.run(ctx => ctx.db.get(created.eventId)))!;
  return { ...f, created, event };
}

it("admits manage_events, manage_integrations, and super admin; refuses others", async () => {
  const f = await setup();
  for (const actorUserId of [f.users.eventStaff, f.users.integrator, f.users.admin]) {
    const current = await f.event();
    await f.t.mutation(patchRef, { actorUserId, slug: f.created.slug, expectedUpdatedAt: current.updatedAt, patch: { summary: `by ${actorUserId}` } });
  }
  const current = await f.event();
  await assert.rejects(f.t.mutation(patchRef, { actorUserId: f.users.outsider, slug: f.created.slug, expectedUpdatedAt: current.updatedAt, patch: { summary: "no" } }), /EVENT_STAFF_REQUIRED/);
});

it("throws VERSION_CONFLICT before writing on a stale expectedUpdatedAt", async () => {
  const f = await setup();
  const before = await f.event();
  await assert.rejects(f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt - 1, patch: { title: "Stale" } }), /VERSION_CONFLICT/);
  assert.deepEqual(await f.event(), before);
});

it("writes only patched fields: a start change keeps venue and lineup", async () => {
  const f = await setup();
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { start: { time: "21:00" } } });
  const after = await f.event();
  assert.equal(result.changed, true);
  assert.equal(after.startAt, before.startAt! + 3_600_000);
  assert.equal(after.venueLabel, "Main room");
  assert.equal(after.title, before.title);
  const lineup = await f.t.run(ctx => ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", f.created.eventId)).collect());
  assert.deepEqual(lineup.map(row => row.performerLabel), ["DJ A", "DJ B"]);
});

it("replaces the lineup as one whole field", async () => {
  const f = await setup();
  const before = await f.event();
  await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "c", position: 1, performerLabel: "DJ C" }] } });
  const lineup = await f.t.run(ctx => ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", f.created.eventId)).collect());
  assert.deepEqual(lineup.map(row => row.performerLabel), ["DJ A", "DJ C"]);
});

it("an equal patch changes nothing and enqueues nothing", async () => {
  const f = await setup();
  await f.insertConnector({ direction: "export" });
  const before = await f.event();
  const result = await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { venueLabel: "Main room", start: { time: "20:00", dayOffset: 0 } } });
  assert.deepEqual(result, { eventId: f.created.eventId, updatedAt: before.updatedAt, changed: false });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 0);
});

it("a real change enqueues the export", async () => {
  const f = await setup();
  await f.insertConnector({ direction: "export" });
  const before = await f.event();
  await f.t.mutation(patchRef, { actorUserId: f.users.integrator, slug: f.created.slug, expectedUpdatedAt: before.updatedAt, patch: { title: "Renamed" } });
  const jobs = await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  assert.deepEqual(jobs.map(row => [row.kind, row.state]), [["export_upsert", "pending"]]);
});
```

`eventLineupEntries` is the untimed lineup table read by `correctionFields` (`convex/eventCorrections.ts:50`); if `createCommunityEvent` stores untimed rows elsewhere, assert through `correctionFields(...).lineup` instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-staff-field-patch.test.ts`
Expected: FAIL, `patchCommunityEventFieldsAsStaff` is not a function.

- [ ] **Step 3: Extract `applyOwnerEventUpdate`**

Signature: `applyOwnerEventUpdate(ctx: MutationCtx, event: Doc<"events">, args: EventDraftUpdateInput, authority: { kind: "api_owner"; ownerUserId: Id<"users">; actorSurface: "api" | "mcp" } | { kind: "staff"; actorUserId: Id<"users"> })`. It holds the body of `updateCommunityEventForApiOwnerRecord` from `const currentCommunity` (`:1050`) through the audit insert. The only branches: community resolution (`api_owner` keeps `requireApiOwnedPublishedCommunity`; `staff` uses the current community and refuses any `input.communitySlug` that differs from it) and the audit actor (`api_owner` keeps `apiOwnerAuthSubject` and its surface; `staff` records `actorUserId` with `actorSurface: "system"`). `updateCommunityEventForApiOwnerRecord` keeps its slug lookup and ownership check, then calls the helper. Existing API and MCP update tests must pass unchanged.

- [ ] **Step 4: Implement `patchCommunityEventFieldsAsStaffRecord`**

Order: load by slug (`EVENT_NOT_FOUND` when missing or without a community); gate with `userHasCommunityPermission(db, communityProfileId, actorUserId, ["manage_events", "manage_integrations"])` (`EVENT_STAFF_REQUIRED`); `expectedUpdatedAt !== event.updatedAt` throws `VERSION_CONFLICT`, before any write; parse the patch with `EventIntakeUpdatePatchSchema`; `current = await correctionFields(db, event)`; drop each patch key whose `canonicalIntakeValue` equals the current one; nothing left returns `{ eventId, updatedAt: event.updatedAt, changed: false }`; otherwise map and call `applyOwnerEventUpdate(ctx, event, update, { kind: "staff", actorUserId })` and return the stored `updatedAt` with `changed: true`. The Task 4 hook inside `updateCommunityEventRecord` is the required trailing `enqueueEventSync`.

Mapping from the remaining intake keys to `EventDraftUpdateInput`, with `n = normalizeIntakePublication({ ...current, ...patch, communitySlug: community.slug })`:

| Intake keys present | Owner update fields |
| --- | --- |
| any of `eventDate`, `timeTba`, `timezone`, `start` | `scheduleKind`, `eventDate`, `startAt` from `n.schedule`; `timezone` (null when date-only); plus `endAt: n.endAt ?? null`, `doorsOpenAt: n.doorsOpenAt ?? null` so end and doors keep their local wall times |
| `end` | `endAt: n.endAt ?? null` |
| `doors` | `doorsOpenAt: n.doorsOpenAt ?? null` |
| `title` | `title` |
| `venueLabel`, `summary`, `sourceUrl`, `worldSlug` | the same name, `null` when empty |
| `lineup` | `lineup: n.lineup` |

- [ ] **Step 5: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-staff-field-patch.test.ts tests/backend/event-api-ownership.test.ts tests/backend/hosted-mcp-event-writes.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/events.ts tests/backend/event-staff-field-patch.test.ts
git commit -m "feat(events): add field-level staff patch for connector updates" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Connector bypass for per-account caps

**Files:**

- Modify: `convex/_eventContributionPreflight.ts:59` (options), `:97-98` (skippable account cap)
- Modify: `convex/_eventIntake.ts:49` (`saveIntakeDraft` options), `:72` (draft limit), `:107` (`publishIntakeDraft` options), `:111` (request cap), `:131` (community listing), `:167` (artwork condition)
- Modify: `convex/eventIntakeSources.ts:116-129` (`authorizeExtraction`)
- Test: `tests/backend/event-connector-quotas.test.ts`

**Interfaces:**

- Produces:
  - `preflightEventContribution(db, actorUserId, raw, now, correctingEventId?, options: { skipAccountQuota?: boolean } = {})`
  - `saveIntakeDraft(db, actorUserId, args, now = Date.now(), options: { connectorDriven?: boolean; connectorId?: Id<"eventConnectors"> } = {})`: `connectorDriven` skips `DRAFT_QUOTA` (master contract); `connectorId` is written onto the draft, new or existing, and implies `connectorDriven`
  - `publishIntakeDraft(ctx, actorUserId, args, now = Date.now(), actorSurface: "browser" | "api" | "mcp" | "system" = "api", options: { connectorId?: Id<"eventConnectors"> } = {})`
  - `authorizeExtraction` gains `connectorId: v.optional(v.id("eventConnectors"))`

Decisions: with `connectorId`, `publishIntakeDraft` requires `draft.connectorId === connectorId` (else `Error("CONNECTOR_DRAFT_MISMATCH")`), skips the 100 per actor `REQUEST_QUOTA` (also an account cap) and passes `skipAccountQuota: true`; `TARGET_QUOTA` stays. A new event is the community's own listing as the intake design's Authority section requires: `sourceType: "community"`, `sourceLabel: "Community-submitted event"` (the existing default for site-created community events in `convex/_eventInputs.ts:462-466`, not new copy), `submitter: await userAuthSubject(db, actorUserId)` when available, no `contributorUserId`; `contributionFingerprint` stays so dedupe still works. The artwork branch tests `receipt.draftId === draft._id && (options.connectorId ? createdEvent : event.contributorUserId === actorUserId)`. `authorizeExtraction` with `connectorId` requires `draft.connectorId === connectorId` and an `active` connector (else `Error("CONNECTOR_DRAFT_MISMATCH")`) and reserves no quota.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-connector-quotas.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { internal } from "../../convex/_generated/api";
import { publishIntakeDraft, saveIntakeDraft } from "../../convex/_eventIntake";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const fields = (title: string) => ({ communitySlug: "club", title, eventDate: "2027-04-01", timeTba: true });
async function fillReceipts(f: Awaited<ReturnType<typeof connectorFixture>>, count: number, by: "actor" | "community") {
  const { eventId } = await f.createEvent({ title: "Seed" });
  await f.t.run(async ctx => {
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.owner, version: 1, fields: {}, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    for (let i = 0; i < count; i++) await ctx.db.insert("eventContributionReceipts", { actorUserId: by === "actor" ? f.users.integrator : f.users.owner, draftId, draftVersion: 1, eventId, eventPath: "/club/events/x", communityProfileId: f.communityProfileId, fingerprint: `f${i}`, createdAt: Date.now() });
  });
}

it("connector publish skips the per-account cap but keeps the per-community cap", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  await fillReceipts(f, 10, "actor");
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: personal.draftId, expectedVersion: personal.version, idempotencyKey: "personal" })), /ACCOUNT_QUOTA/);
  const viaConnector = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Synced") }, Date.now(), { connectorId }));
  const published = await f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: viaConnector.draftId, expectedVersion: viaConnector.version, idempotencyKey: "synced" }, Date.now(), "system", { connectorId }));
  const event = (await f.t.run(ctx => ctx.db.get(published.eventId)))!;
  assert.equal(event.sourceType, "community");
  assert.equal(event.contributorUserId, undefined);
  await fillReceipts(f, 100, "community");
  const capped = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Capped") }, Date.now(), { connectorId }));
  await assert.rejects(f.t.run(ctx => publishIntakeDraft(ctx, f.users.integrator, { draftId: capped.draftId, expectedVersion: capped.version, idempotencyKey: "capped" }, Date.now(), "system", { connectorId })), /TARGET_QUOTA/);
});

it("the 21st connector-driven draft is allowed and the 21st web draft is not", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  for (let i = 0; i < 20; i++) await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields(`Draft ${i}`) }));
  await assert.rejects(f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Web 21") })), /DRAFT_QUOTA/);
  await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Connector 21") }, Date.now(), { connectorDriven: true }));
  const saved = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Connector 22") }, Date.now(), { connectorId }));
  assert.equal((await f.t.run(ctx => ctx.db.get(saved.draftId)))!.connectorId, connectorId);
});

it("connector extraction skips the 20 per day reservation only for its own drafts", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const personal = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Personal") }));
  const owned = await f.t.run(ctx => saveIntakeDraft(ctx.db, f.users.integrator, { patch: fields("Owned") }, Date.now(), { connectorId }));
  for (let i = 0; i < 20; i++) await f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId });
  await assert.rejects(f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId }), /EXTRACTION_QUOTA/);
  await f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: owned.draftId, connectorId });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeModelAttempts").collect())).length, 20);
  await assert.rejects(f.t.mutation(internal.eventIntakeSources.authorizeExtraction, { actorUserId: f.users.integrator, draftId: personal.draftId, connectorId }), /CONNECTOR_DRAFT_MISMATCH/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-connector-quotas.test.ts`
Expected: FAIL (`ACCOUNT_QUOTA` thrown for the connector publish).

- [ ] **Step 3: Implement the options as listed under Interfaces**

- [ ] **Step 4: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-connector-quotas.test.ts tests/backend/event-intake.test.ts tests/backend/event-intake-sources.test.ts tests/backend/hosted-mcp-event-intake.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventContributionPreflight.ts convex/_eventIntake.ts convex/eventIntakeSources.ts tests/backend/event-connector-quotas.test.ts
git commit -m "feat(connectors): let connector writes bypass per-account intake caps" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `applyEventCandidate`

**Files:**

- Create: `convex/_eventCandidateApply.ts`
- Test: `tests/backend/event-candidate-apply.test.ts`

**Interfaces:**

- Consumes: `candidatePatch` (`apps/web/src/lib/event-intake-source.ts:4`, pure, importable from Convex as `convex/_eventIntake.ts` already imports from `apps/web`); `saveIntakeDraft`, `publishIntakeDraft` (Task 6 options); `patchCommunityEventFieldsAsStaffRecord` (Task 5); `carriedFields`, `carriedFieldsHash`, `pendingLinkDraft` (Task 1); `enqueueProductAnalytics` (plan 01).
- Produces: `applyEventCandidate(ctx: MutationCtx, args)` with the master's exact argument and return types, including `draftId?: Id<"eventIntakeDrafts">`, the caller's working draft (poster sources, source text), and the outcome union with `skipped_stale` and `skipped_echo`. Plans 03 and 06 to 09 call it from their own internal mutations.
- Plan-local addition the master does not list: `expectedUpdatedAt?: number`, the event `updatedAt` the caller saw (plan 03 passes the value its `get_event` read). Inside one mutation, `event.updatedAt` always matches itself, so without this argument the write-time `conflict` the master requires cannot occur. It defaults to `event.updatedAt`.

"The working draft" below is `args.draftId` when given (loaded with `getActorIntakeDraft(db, actorUserId, draftId)`, so it must belong to the authority) and otherwise a new draft. Saving into it is `saveIntakeDraft(db, actorUserId, { draftId, expectedVersion: draft.version, patch }, now, { connectorId })`, or the same without `draftId` and `expectedVersion` for a new one; the patch never touches `posterSourceId`, so a poster already on the given draft survives the save.

Rules, in order:

1. `fields` = `candidatePatch(candidate).tentative` with `communitySlug` forced to the connector community's slug and `timeTba: !start`. The candidate's own `communitySlug` is never trusted.
2. `decision.kind === "not_event"`: outcome `not_event`.
3. `link` = `args.link`, else `by_connectorId_externalId` when `externalId` is given. A `pendingLinkDraft(link)`: outcome `skipped_pending_draft`.
4. Target event: `link.eventId`, else the `decision.update` slug when it resolves to an event of the connector's community; a slug from any other community is ignored and the candidate is treated as new.
5. Echo guard: a target with `link.lastExportedHash === carriedFieldsHash(kind, fields)` patches only the link's `lastImportedAt` and `externalUpdatedAt`; outcome `skipped_echo`, no event write, no draft.
6. Stale guard: a target on a `bidirectional` connector with `externalUpdatedAt !== undefined && externalUpdatedAt <= event.updatedAt` patches only the link's `lastImportedAt` and `externalUpdatedAt`; outcome `skipped_stale`, no draft. VRDex wins, and the export already enqueued by the VRDex edit overwrites the copy. Import-only connectors have no stale guard: the source owns its carried fields.
7. Mode `hold`: save `candidatePatch(candidate)` (tentative fields, evidence, questions; tentative `communitySlug` forced) into the working draft; upsert the link with `draftId` (keep `eventId` when the target exists, so My events shows a proposed update), `lastImportedAt`, `externalUpdatedAt`. Insert a link only when `externalId` is given. Outcome `draft`.
8. Mode `autopublish` with a target: build the patch from keys with an `explicit` evidence entry (`event.startDate` maps to `start`, `event.endDate` to `end`, `event.X` to `X`, any `lineup.*` to `lineup`) intersected with `carriedFields(kind)` and the update-patch keys, each set to `fields[key] ?? null`, and call `patchCommunityEventFieldsAsStaffRecord` with `expectedUpdatedAt: args.expectedUpdatedAt ?? event.updatedAt`. A `VERSION_CONFLICT` thrown there is the write-time conflict; the patch throws before writing, so catching it inside the mutation is safe. A conflict files the hold draft of rule 7 and returns `conflict` with `eventId` and `draftId`. Success upserts the link and returns `updated`.
9. Mode `autopublish` without a target: if `eventIntakePublishRequests.by_actor_key` already holds `(actorUserId, idempotencyKey)`, return that receipt's event as `published` and make sure the link exists (a retried job never makes a second draft). Otherwise save concrete `{ ...fields, evidence: candidate.evidence }` into the working draft, then `publishIntakeDraft(ctx, actorUserId, { draftId, expectedVersion, idempotencyKey }, now, "system", { connectorId })` on that draft, so a given draft's selected artwork becomes the event's poster exactly as a web publish does. A `ConvexError` with code `NEAR_DUPLICATE`, `REPOST_BLOCKED`, or `TARGET_QUOTA` keeps the saved draft as a hold (link with `draftId`) and returns `draft`. Success upserts the link with `eventId` and returns `published`.
10. Every return calls `enqueueProductAnalytics(ctx.db, { event: "event_sync_apply", distinctId: String(actorUserId), properties: { connectorId, connectorKind, mode, outcome } })`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-candidate-apply.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { applyEventCandidate } from "../../convex/_eventCandidateApply";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";
import type { EventIntakeCandidate } from "../../packages/api-contracts/src/event-intake";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const night = { title: "Night Flight", eventDate: "2027-02-12", start: "20:00", startDate: "2027-02-12", timezone: "UTC" };
function candidate(event: Partial<EventIntakeCandidate["event"]>, explicit: string[], extra: Partial<EventIntakeCandidate> = {}): EventIntakeCandidate {
  return { event: { title: null, communitySlug: null, eventDate: null, start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null, ...event },
    lineup: [], questions: [], decision: { kind: "new" },
    evidence: explicit.map(fieldPath => ({ fieldPath, origin: "connector" as const, excerpt: null, assessment: "explicit" as const })), ...extra };
}
async function setup(connector: Partial<Doc<"eventConnectors">> = {}) {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector(connector);
  const apply = (args: { candidate: EventIntakeCandidate; externalId?: string; externalUpdatedAt?: number; expectedUpdatedAt?: number; idempotencyKey?: string }) => f.t.run(async ctx => {
    const doc = (await ctx.db.get(connectorId))!;
    return applyEventCandidate(ctx, { connector: doc, actorUserId: doc.authorityUserId, idempotencyKey: args.idempotencyKey ?? "key-1", candidate: args.candidate, externalId: args.externalId, externalUpdatedAt: args.externalUpdatedAt, expectedUpdatedAt: args.expectedUpdatedAt });
  });
  const linkTo = (eventId: Id<"events">, extra: Partial<Doc<"eventSyncLinks">> = {}) => f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now(), ...extra }));
  const get = <T extends "events" | "eventIntakeDrafts">(id: Id<T>) => f.t.run(ctx => ctx.db.get(id));
  return { ...f, connectorId, apply, linkTo, get };
}

it("not_event writes nothing but analytics", async () => {
  const f = await setup();
  const result = await f.apply({ candidate: candidate(night, [], { decision: { kind: "not_event", reason: "chatter" } }), externalId: "g-1" });
  assert.equal(result.outcome, "not_event");
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
  assert.equal((await f.t.run(ctx => ctx.db.query("productAnalyticsOutbox").collect())).filter(row => row.event === "event_sync_apply").length, 1);
});

it("hold files one draft owned by the authority and a later poll does not file a second", async () => {
  const f = await setup({ mode: "hold" });
  const first = await f.apply({ candidate: candidate(night, ["event.title"]), externalId: "g-1" });
  assert.equal(first.outcome, "draft");
  const draft = (await f.get(first.draftId!))!;
  assert.equal(draft.actorUserId, f.users.integrator);
  assert.equal(draft.connectorId, f.connectorId);
  const second = await f.apply({ candidate: candidate(night, ["event.title"]), externalId: "g-1" });
  assert.equal(second.outcome, "skipped_pending_draft");
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 1);
});

it("autopublish publishes a community listing, links it, and replays on retry", async () => {
  const f = await setup();
  const first = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), externalId: "g-1", idempotencyKey: "job-1" });
  assert.equal(first.outcome, "published");
  assert.equal((await f.get(first.eventId!))!.sourceType, "community");
  const link = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", f.connectorId).eq("externalId", "g-1")).unique());
  assert.equal(link!.eventId, first.eventId);
  const retry = await f.apply({ candidate: candidate(night, ["event.title", "event.start"]), externalId: "g-1", idempotencyKey: "job-1" });
  assert.equal(retry.eventId, first.eventId);
  assert.equal((await f.t.run(ctx => ctx.db.query("events").collect())).length, 1);
});

it("echo guard: an inbound copy of VRDex's own export changes nothing", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  const echoed = candidate({ ...night, title: "Night Flight (exported)" }, ["event.title"]);
  await f.linkTo(eventId, { lastExportedHash: carriedFieldsHash("google_calendar", { ...candidatePatch(echoed).tentative, communitySlug: "club", timeTba: false }) });
  const before = (await f.get(eventId))!;
  const result = await f.apply({ candidate: echoed, externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000 });
  assert.equal(result.outcome, "skipped_echo");
  assert.deepEqual(await f.get(eventId), before);
});

it("carried-fields rule: a kind that does not carry venue never touches it", async () => {
  const f = await setup({ kind: "vrchat_calendar", target: { groupId: "grp_1", calendarId: "cal" } });
  const { eventId } = await f.createEvent({ venueLabel: "Main room" });
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  await f.apply({ candidate: candidate({ ...night, title: "Renamed", venueLabel: "Elsewhere" }, ["event.title", "event.venueLabel"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000 });
  const after = (await f.get(eventId))!;
  assert.equal(after.title, "Renamed");
  assert.equal(after.venueLabel, "Main room");
});

it("explicit-only patch: inferred title stays, explicit start moves, lineup is whole-field and only when explicit", async () => {
  const f = await setup({ kind: "discord_announcements", direction: "import", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  const created = await f.createEvent({ venueLabel: "Main room", lineup: [{ clientKey: "a", position: 0, performerLabel: "DJ A" }, { clientKey: "b", position: 1, performerLabel: "DJ B" }] });
  const update = { kind: "update" as const, slug: created.slug };
  const before = (await f.get(created.eventId))!;
  const swapped = candidate({ ...night, title: "Different", start: "21:00" }, ["event.start", "lineup.1.performerLabel"], {
    decision: update, lineup: [{ performerLabel: "DJ A", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }, { performerLabel: "DJ C", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }],
  });
  swapped.evidence.push({ fieldPath: "event.title", origin: "connector", excerpt: null, assessment: "inferred" });
  assert.equal((await f.apply({ candidate: swapped, externalId: "m-1", externalUpdatedAt: before.updatedAt + 60_000 })).outcome, "updated");
  const after = (await f.get(created.eventId))!;
  assert.equal(after.title, "Night Flight");
  assert.equal(after.startAt, before.startAt! + 3_600_000);
  assert.equal(after.venueLabel, "Main room");
  const lineup = () => f.t.run(ctx => ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", created.eventId)).collect());
  assert.deepEqual((await lineup()).map(row => row.performerLabel), ["DJ A", "DJ C"]);
  const inferredOnly = candidate({ ...night, start: "21:00" }, ["event.start"], { decision: update, lineup: [{ performerLabel: "DJ X", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }] });
  await f.apply({ candidate: inferredOnly, externalId: "m-2", externalUpdatedAt: after.updatedAt + 60_000, idempotencyKey: "key-2" });
  assert.deepEqual((await lineup()).map(row => row.performerLabel), ["DJ A", "DJ C"]);
});

it("stale: on a bidirectional connector a source older than the VRDex edit is skipped with no draft", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  const result = await f.apply({ candidate: candidate({ ...night, title: "Older" }, ["event.title"]), externalId: "g-1", externalUpdatedAt: before.updatedAt - 1 });
  assert.equal(result.outcome, "skipped_stale");
  assert.deepEqual(await f.get(eventId), before);
  assert.equal((await f.t.run(ctx => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
});

it("conflict: a write-time version mismatch files a hold draft and leaves the event alone", async () => {
  const f = await setup();
  const { eventId } = await f.createEvent();
  await f.linkTo(eventId);
  const before = (await f.get(eventId))!;
  const raced = { candidate: candidate({ ...night, title: "Raced" }, ["event.title"]), externalId: "g-1", externalUpdatedAt: before.updatedAt + 60_000, expectedUpdatedAt: before.updatedAt - 1 };
  const result = await f.apply(raced);
  assert.equal(result.outcome, "conflict");
  assert.deepEqual(await f.get(eventId), before);
  const link = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique());
  assert.equal(link!.draftId, result.draftId);
  assert.equal((await f.apply(raced)).outcome, "skipped_pending_draft");
});

it("foreign update slug publishes into the connector community instead", async () => {
  const f = await setup();
  const foreign = await f.t.run(async ctx => {
    const profileId = await ctx.db.insert("profiles", { slug: "other-club", displayName: "Other", sortName: "other", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    const eventId = await ctx.db.insert("events", { title: "Theirs", sortTitle: "theirs", slug: "zzzz9999", communityProfileId: profileId, sourceType: "community", sourceLabel: "x", eventStatus: "scheduled", publicationState: "published", scheduleKind: "date_only", eventDate: "2027-02-12", updatedAt: Date.now() });
    return eventId;
  });
  const before = (await f.get(foreign))!;
  const result = await f.apply({ candidate: candidate({ ...night, title: "Mine" }, ["event.title"], { decision: { kind: "update", slug: "zzzz9999" } }), externalId: "g-9" });
  assert.equal(result.outcome, "published");
  assert.notEqual(result.eventId, foreign);
  assert.deepEqual(await f.get(foreign), before);
});

it("publishing a given working draft carries its poster through to the event artwork", async () => {
  const f = await setup({ kind: "discord_announcements", direction: "import", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  const { draftId, artworkId } = await f.t.run(async ctx => {
    const now = Date.now();
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.integrator, version: 1, fields: { sourceText: "Night Flight Friday 20:00 UTC" }, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 });
    const sourceId = await ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: f.users.integrator, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: now, expiresAt: now + 86_400_000, uploadExpiresAt: now, lastActivityAt: now });
    const artworkId = await ctx.db.insert("eventPosterArtwork", { actorUserId: f.users.integrator, draftId, sourceId, state: "ready", createdAt: now, expiresAt: now + 86_400_000 });
    await ctx.db.patch(draftId, { artworkAssetId: artworkId, fields: { sourceText: "Night Flight Friday 20:00 UTC", posterSourceId: sourceId } });
    return { draftId, artworkId };
  });
  const result = await f.t.run(async ctx => {
    const connector = (await ctx.db.get(f.connectorId))!;
    return applyEventCandidate(ctx, { connector, actorUserId: f.users.integrator, draftId, idempotencyKey: "run-1", externalId: "m-1", candidate: candidate(night, ["event.title", "event.start"]) });
  });
  assert.equal(result.outcome, "published");
  assert.equal(result.draftId, draftId);
  assert.equal((await f.get(result.eventId!))!.posterImageUrl, `/api/v0/events/${result.eventId}/artwork/${artworkId}`);
  assert.equal((await f.t.run(ctx => ctx.db.get(artworkId)))!.state, "published");
});

it("date-only candidate publishes as time TBA", async () => {
  const f = await setup();
  const result = await f.apply({ candidate: candidate({ title: "All Day", eventDate: "2027-05-01" }, ["event.title", "event.eventDate"]), externalId: "g-2" });
  assert.equal(result.outcome, "published");
  assert.equal((await f.get(result.eventId!))!.scheduleKind, "date_only");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-candidate-apply.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `applyEventCandidate` by the rules above**

- [ ] **Step 4: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-candidate-apply.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/_eventCandidateApply.ts tests/backend/event-candidate-apply.test.ts
git commit -m "feat(connectors): apply inbound candidates with hold, publish, and patch rules" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Browser connector API

**Files:**

- Create: `convex/eventConnectors.ts`
- Test: `tests/backend/event-connectors-api.test.ts`

**Interfaces:**

- Consumes: `requireActiveBrowserSessionSubject` (`convex/_browserSessionAuthority.ts`), Task 1 helpers, `enqueueSyncJob` (Task 3).
- Produces (master args verbatim):
  - `api.eventConnectors.listForCommunity { communityProfileId }` returns `{ enabled: false, connectors: [] }` when the flag is off, else requires `requireConnectorAuthority` and returns `{ enabled: true, connectors: Array<{ connectorId, kind, direction, mode, state, target, lastSyncedAt?, lastError? }> }` without `removed` rows, oldest first
  - `api.eventConnectors.create { communityProfileId, kind, direction, mode, target, credentialId? }` returns the connector ID
  - `api.eventConnectors.update { connectorId, direction?, mode?, quietWindowSeconds?, state?: "active" }` (master)
  - `api.eventConnectors.remove { connectorId }`
  - Errors: `CONNECTORS_DISABLED`, `CONNECTOR_FORBIDDEN`, `CONNECTOR_KIND_RESERVED`, `CONNECTOR_DIRECTION_INVALID`, `CONNECTOR_TARGET`, `CONNECTOR_EXISTS`, `CONNECTOR_CREDENTIAL`, `CONNECTOR_REMOVED`, `CONNECTOR_QUIET_WINDOW`, `CONNECTOR_RESUME_INVALID`, all `ConvexError({ code })`

Decisions: mutations throw `CONNECTORS_DISABLED` when the flag is off. `create`: `notion` is reserved; a direction outside `allowedDirections(kind)` is `CONNECTOR_DIRECTION_INVALID` (so `discord_announcements` takes only import and `discord_board` only export, besides `off`); `guildId` and `channelId` must match `DISCORD_ID` when present; each `*Name` is at most 100 characters; a non-removed connector of the same kind and same target IDs (names ignored) in the community is `CONNECTOR_EXISTS`; a `credentialId` whose row is missing, not `active`, or has an `ownerUserId` other than the caller is `CONNECTOR_CREDENTIAL` (plan 08 relies on this); `authorityUserId` is the caller; `discord_announcements` gets `quietWindowSeconds: 120`; direction other than `off` enqueues one `reconcile`. `update`: the same `CONNECTOR_DIRECTION_INVALID` rule against the stored kind; `quietWindowSeconds` an integer from 30 to 600; a direction change from `off` to anything else enqueues `reconcile` (re-enabling). `state: "active"` resumes a `paused` connector only: it re-runs `requireConnectorAuthority` for the caller, makes the caller the new `authorityUserId` (otherwise the next claim would pause it again for the original staffer's lost role), clears `lastError`, and enqueues `reconcile`; on `needs_reauth`, `removed`, or `active` it throws `CONNECTOR_RESUME_INVALID`, so it never clears `needs_reauth` (the kind plans' Reconnect does that). `remove`: sets `state: "removed"` and keeps links; pending jobs close as `connector_inactive` when claimed.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/event-connectors-api.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api } from "../../convex/_generated/api";
import { connectorFixture } from "./_eventConnectorFixture";

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const google = { kind: "google_calendar" as const, direction: "bidirectional" as const, mode: "hold" as const, target: { calendarId: "club@example.com", calendarName: "Club nights" } };

it("create enqueues one reconcile job and lists the connector", async () => {
  const f = await connectorFixture();
  const connectorId = await f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google });
  const jobs = await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  assert.deepEqual(jobs.map(row => [row.connectorId, row.kind, row.state]), [[connectorId, "reconcile", "pending"]]);
  const listed = await f.as("integrator").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId });
  assert.equal(listed.enabled, true);
  assert.equal(listed.connectors[0].target.calendarName, "Club nights");
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.authorityUserId, f.users.integrator);
});

it("refuses a staffer without manage_integrations", async () => {
  const f = await connectorFixture();
  await assert.rejects(f.as("event-staff").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google }), /CONNECTOR_FORBIDDEN/);
  await assert.rejects(f.as("event-staff").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId }), /CONNECTOR_FORBIDDEN/);
});

it("validates kind, direction, Discord IDs, and uniqueness", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const create = (args: Record<string, unknown>) => as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, ...args } as never);
  await assert.rejects(create({ kind: "notion" }), /CONNECTOR_KIND_RESERVED/);
  const channel = { guildId: "123456789012345678", channelId: "223456789012345678" };
  await assert.rejects(create({ kind: "discord_board", direction: "import", target: channel }), /CONNECTOR_DIRECTION_INVALID/);
  await assert.rejects(create({ kind: "discord_announcements", direction: "export", target: channel }), /CONNECTOR_DIRECTION_INVALID/);
  await assert.rejects(create({ kind: "discord_board", direction: "export", target: { ...channel, guildId: "123" } }), /CONNECTOR_TARGET/);
  await create({});
  await assert.rejects(create({ target: { calendarId: "club@example.com", calendarName: "Renamed" } }), /CONNECTOR_EXISTS/);
});

it("state active resumes a paused connector under the caller and never clears needs_reauth", async () => {
  const f = await connectorFixture();
  const paused = await f.insertConnector({ state: "paused", lastError: "authority_lost", authorityUserId: f.users.owner });
  await assert.rejects(f.as("event-staff").mutation(api.eventConnectors.update, { connectorId: paused, state: "active" }), /CONNECTOR_FORBIDDEN/);
  await f.as("integrator").mutation(api.eventConnectors.update, { connectorId: paused, state: "active" });
  const resumed = (await f.t.run(ctx => ctx.db.get(paused)))!;
  assert.deepEqual([resumed.state, resumed.authorityUserId, resumed.lastError], ["active", f.users.integrator, undefined]);
  assert.deepEqual((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).map(row => [row.connectorId, row.kind]), [[paused, "reconcile"]]);
  const reauth = await f.insertConnector({ state: "needs_reauth", target: { calendarId: "other" } });
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.update, { connectorId: reauth, state: "active" }), /CONNECTOR_RESUME_INVALID/);
  assert.equal((await f.t.run(ctx => ctx.db.get(reauth)))!.state, "needs_reauth");
});

it("update enforces the kind's allowed directions", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const board = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind: "discord_board", direction: "export", mode: "hold", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId: board, direction: "bidirectional" }), /CONNECTOR_DIRECTION_INVALID/);
  const intake = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", target: { guildId: "123456789012345678", channelId: "323456789012345678" } });
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId: intake, direction: "export" }), /CONNECTOR_DIRECTION_INVALID/);
  await as.mutation(api.eventConnectors.update, { connectorId: intake, direction: "off" });
});

it("create refuses a credential owned by someone else", async () => {
  const f = await connectorFixture();
  const credential = (ownerUserId: typeof f.users.owner) => f.t.run(ctx => ctx.db.insert("connectorCredentials", { provider: "google", ownerUserId, encryptedAccessToken: "v1:a:b:c", encryptedRefreshToken: "v1:a:b:c", accessTokenExpiresAt: Date.now() + 3_600_000, scopes: [], externalAccountId: "sub-1", state: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  const others = await credential(f.users.owner);
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, credentialId: others }), /CONNECTOR_CREDENTIAL/);
  const mine = await credential(f.users.integrator);
  await f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, credentialId: mine });
});

it("update re-enables with a reconcile and remove hides the connector", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const connectorId = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, direction: "off" });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 0);
  await as.mutation(api.eventConnectors.update, { connectorId, direction: "export" });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 1);
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId, quietWindowSeconds: 10 }), /CONNECTOR_QUIET_WINDOW/);
  await as.mutation(api.eventConnectors.remove, { connectorId });
  assert.equal((await as.query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId })).connectors.length, 0);
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.state, "removed");
});

it("the flag hides the list and blocks creation", async () => {
  const f = await connectorFixture({ flag: false });
  assert.deepEqual(await f.as("integrator").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId }), { enabled: false, connectors: [] });
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google }), /CONNECTORS_DISABLED/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-connectors-api.test.ts`
Expected: FAIL, `eventConnectors` functions missing.

- [ ] **Step 3: Implement `convex/eventConnectors.ts` with the decisions above, then run codegen**

Run: `pnpm exec convex codegen`

- [ ] **Step 4: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/event-connectors-api.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/eventConnectors.ts convex/_generated tests/backend/event-connectors-api.test.ts
git commit -m "feat(connectors): add browser API to list, create, update, and remove connectors" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Integrations page and navigation

**Files:**

- Modify: `convex/clubStaff.ts:148-170` (`workspaceReturn` gains `eventConnectorsEnabled: v.optional(v.boolean())`), `:359` (return `eventConnectorsEnabled: connectorsEnabled()`)
- Modify: `apps/web/src/app/account/communities/[slug]/club-workspace-model.ts:4-90` (`clubNavigation` fifth parameter), `club-workspace.tsx:73-78` (pass `data.eventConnectorsEnabled ?? false`)
- Create: `apps/web/src/app/account/communities/[slug]/club-integrations-model.ts`, `club-integrations.tsx`, `(workspace)/integrations/page.tsx`
- Create: `apps/web/src/components/club-integrations.stories.tsx`
- Test: `tests/web/club-integrations-model.test.ts`, `tests/web/club-workspace-model.test.ts` (extend)

**Interfaces:**

- Consumes: `api.eventConnectors.*` (Task 8), `useClubWorkspace`, `ClubAccessNotice` (`club-workspace.tsx`), `Card`, `SectionHeading` (`@/components/ui/card`), `Field`, `Select` (`@/components/ui/field`), `Button`, `Notice`.
- Produces:
  - `clubNavigation(slug, owner, permissions, readableCategories = [], eventConnectorsEnabled = false)` adds `{ label: "Integrations", href: root + "/integrations" }` after "Group connection", visible when `eventConnectorsEnabled && (owner || permissions.includes("manage_integrations"))`
  - `club-integrations-model.ts`: `KIND_LABELS: Record<ConnectorKind, string>`, `DIRECTION_LABELS`, `DIRECTION_HELP`, `MODE_LABELS`, `STATE_LABELS`, `directionOptions(kind): Array<{ value: ConnectorDirection; label: string }>`, `syncedLabel(lastSyncedAt: number | undefined, now: number): string | null`
  - `ClubIntegrationsView({ connectors, onUpdate, onRemove, now })` (pure, for the story) and `ClubIntegrations` (container); `page.tsx` renders `ClubIntegrations` like `(workspace)/posts/page.tsx`

Copy, verbatim from the connector design's Public copy table: heading `Integrations`; direction options `Import`, `Export`, `Both`, `Off`; direction help `Events there appear here.` (import), `Events here appear there.` (export), `Changes on either side reach the other.` (both), none for off; mode options `Hold for review`, `Publish automatically`; state labels `Active`, `Paused`, `Needs reconnecting`; `Disconnect`; `Resume` (not in the copy table; list it for BASIC's approval with the kind labels); last synced as `Synced` plus the relative time; kind labels `Event board` (`discord_board`), `Discord events` (`discord_scheduled_events`). The table names no label for `google_calendar`, `vrchat_calendar`, or `discord_announcements`; use the nouns from its approved Connect buttons (`Google Calendar`, `VRChat calendar`, `Discord`) and list them for BASIC's approval in the PR. `notion` never renders. No Connect or Reconnect buttons in this plan.

Row layout: kind label, then the first set of `target.channelName`, `target.calendarName`, `target.groupName`, `target.guildName`; direction picker restricted by `allowedDirections` with its help line; mode picker only when the direction is `import` or `bidirectional`; state label; `Synced ...` when `lastSyncedAt` is set; `lastError` verbatim in muted text when set; `Resume` on `paused` rows only, calling `update` with `state: "active"`; `Disconnect`. Non-managers see `ClubAccessNotice`; `enabled: false` also renders `ClubAccessNotice`. Use existing primitives with subtle radii; no badges for state (plain text, per the UI rule).

- [ ] **Step 1: Write the failing web tests**

```ts
// tests/web/club-integrations-model.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { directionOptions, syncedLabel, STATE_LABELS, DIRECTION_HELP } from "../../apps/web/src/app/account/communities/[slug]/club-integrations-model";

const NOW = Date.UTC(2027, 0, 10, 12);
test("synced label uses relative time", () => {
  assert.equal(syncedLabel(undefined, NOW), null);
  assert.equal(syncedLabel(NOW - 30_000, NOW), "Synced now");
  assert.equal(syncedLabel(NOW - 5 * 60_000, NOW), "Synced 5 minutes ago");
  assert.equal(syncedLabel(NOW - 3 * 3_600_000, NOW), "Synced 3 hours ago");
  assert.equal(syncedLabel(NOW - 2 * 86_400_000, NOW), "Synced 2 days ago");
});
test("direction options follow the kind's allowed directions", () => {
  assert.deepEqual(directionOptions("discord_board").map(o => o.label), ["Export", "Off"]);
  assert.deepEqual(directionOptions("google_calendar").map(o => o.label), ["Import", "Export", "Both", "Off"]);
});
test("approved copy is verbatim", () => {
  assert.deepEqual(STATE_LABELS, { active: "Active", paused: "Paused", needs_reauth: "Needs reconnecting" });
  assert.equal(DIRECTION_HELP.bidirectional, "Changes on either side reach the other.");
});
```

Add to `tests/web/club-workspace-model.test.ts`:

```ts
test("integrations appear only with the flag and manage_integrations", () => {
  assert.equal(clubNavigation("afterhours", false, ["manage_integrations"]).some(item => item.label === "Integrations"), false);
  assert.equal(clubNavigation("afterhours", false, ["manage_integrations"], [], true).some(item => item.label === "Integrations"), true);
  assert.equal(clubNavigation("afterhours", false, ["manage_events"], [], true).some(item => item.label === "Integrations"), false);
  assert.equal(clubNavigation("afterhours", true, [], [], true).some(item => item.label === "Integrations"), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/web/club-integrations-model.test.ts tests/web/club-workspace-model.test.ts`
Expected: FAIL, model module missing and no Integrations item.

- [ ] **Step 3: Implement the model, navigation, workspace flag, view, container, page, and story**

`syncedLabel` uses `new Intl.RelativeTimeFormat("en", { numeric: "auto" })` with seconds under a minute shown as `0` seconds ("now"), then minutes, hours, days. The story renders `ClubIntegrationsView` with three rows: an active bidirectional Google connector synced 5 minutes ago, a paused board with a `lastError`, and a `needs_reauth` connector.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --import tsx --test tests/web/club-integrations-model.test.ts tests/web/club-workspace-model.test.ts && pnpm typecheck:web && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Visual verification**

Run `pnpm --filter web storybook`, open the Integrations story at desktop width and at 375 px, save both screenshots, and have a VLM review them against the UI rule in `AGENTS.md` (calm layout, subtle radii, no badges, no explanatory filler, no horizontal scroll at 375 px). Fix findings and re-capture. Attach the screenshots to the PR.

- [ ] **Step 6: Commit**

```bash
git add convex/clubStaff.ts "apps/web/src/app/account/communities/[slug]" apps/web/src/components/club-integrations.stories.tsx tests/web/club-integrations-model.test.ts tests/web/club-workspace-model.test.ts
git commit -m "feat(web): add community Integrations settings page" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Ops alert email and the connector failure alarm

**Files:**

- Modify: `convex/schema.ts` (table `opsAlerts { key: v.string(), lastSentAt: v.number(), resolvedAt: v.optional(v.number()) }`, index `by_key` `["key"]`)
- Create: `convex/_opsAlerts.ts`, `convex/opsAlerts.ts`, `convex/opsAlertEmail.ts`
- Modify: `convex/eventSync.ts` (failure helper and `completeJob` from Task 3)
- Modify: `docs/deployment/convex-environments.md` (`## Event connectors` section)
- Modify: `tests/backend/_eventConnectorFixture.ts` (module map gains `opsAlerts.ts` and `opsAlertEmail.ts`)
- Test: `tests/backend/ops-alerts.test.ts`

**Interfaces:**

- Consumes: the SES client and env names of `convex/clubNotificationEmail.ts` (`SESClient`, `SendEmailCommand` from `@aws-sdk/client-ses`, `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, the default AWS credential chain).
- Produces:
  - `notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void>` and `resolveOps(ctx: MutationCtx | ActionCtx, key: string): Promise<void>` in `convex/_opsAlerts.ts` (master signatures), plus `OPS_ALERT_DEDUPE_MS = 6 * 3_600_000`, `reserveOpsAlert(db: DatabaseWriter, key: string, now: number): Promise<boolean>`, and `markOpsResolved(db: DatabaseWriter, key: string, now: number): Promise<boolean>`
  - `internal.opsAlerts.reserve { key }` and `internal.opsAlerts.resolve { key }`, each returning `boolean`, the action-side paths to those two helpers
  - `convex/opsAlertEmail.ts` (`"use node"`): `deliverOpsAlert(message: { to: string; subject: string; body: string }, client: Pick<SESClient, "send">, from: string): Promise<void>` and `internal.opsAlertEmail.send { to, subject, body }`
  - Plans 05, 08, and 10 call `notifyOps` with their own keys.

Decisions: SES needs the Node runtime and a mutation cannot send, so `notifyOps` only reserves and schedules. It reserves through `ctx.db` when the context has one, otherwise through `ctx.runMutation(internal.opsAlerts.reserve)`; when the reservation succeeds it calls `ctx.scheduler.runAfter(0, internal.opsAlertEmail.send, { to: process.env.VRDEX_OPS_ALERT_EMAIL || "basic@basicbit.net", subject: "[VRDex ops] " + subject, body })`. `reserveOpsAlert` returns `false` when a row for `key` is still alerting (no `resolvedAt` at or after `lastSentAt`) and `now - lastSentAt < OPS_ALERT_DEDUPE_MS`; otherwise it upserts `{ lastSentAt: now, resolvedAt: undefined }` and returns `true`, so a failure after a resolution alerts again at once. `resolveOps` calls `markOpsResolved`, which returns `true` and sets `resolvedAt: now` only when the key is currently alerting; on `true` it schedules the same send with subject `"[VRDex ops] Resolved: " + key` and a one-line body naming the key and time. `completeJob` calls `resolveOps(ctx, "connector-failures:" + connectorId)` on every success; it is a no-op unless that key is alerting. `send` throws when `AWS_SES_REGION` or `AWS_SES_FROM_EMAIL` is missing, so the failure shows in Convex logs, and builds `new SESClient({ region, maxAttempts: 1 })` as `convex/clubNotificationEmail.ts:27` does. The runner keeps a per-connector count: the failure helper's final-failure branch sets `consecutiveFailures = (consecutiveFailures ?? 0) + 1` and, when it becomes exactly 5, calls `notifyOps(ctx, { key: "connector-failures:" + connectorId, subject: "Event connector failing", body })` with the connector ID, kind, community ID, and `lastError`; `completeJob` resets the count to 0. A retry, a skip, or `superseded` does not count. This email goes to the operator only and is not public product copy.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/backend/ops-alerts.test.ts
import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { makeFunctionReference } from "convex/server";
import { notifyOps } from "../../convex/_opsAlerts";
import { deliverOpsAlert } from "../../convex/opsAlertEmail";
import { enqueueSyncJob } from "../../convex/_eventSync";
import { connectorFixture } from "./_eventConnectorFixture";

const NOW = Date.UTC(2027, 0, 10, 12);
beforeEach(test => test.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW }));
const claim = makeFunctionReference<"mutation">("eventSync:claimJob");
const fail = makeFunctionReference<"mutation">("eventSync:failJob");
const sends = (f: Awaited<ReturnType<typeof connectorFixture>>) => f.t.run(async ctx =>
  (await ctx.db.system.query("_scheduled_functions").collect()).filter(fn => fn.name.includes("opsAlertEmail")));

it("sends one email per key per six hours with the ops prefix", async t => {
  const f = await connectorFixture();
  const alert = { key: "k1", subject: "Gateway stale", body: "No heartbeat" };
  await f.t.run(ctx => notifyOps(ctx, alert));
  await f.t.run(ctx => notifyOps(ctx, alert));
  await f.t.run(ctx => notifyOps(ctx, { ...alert, key: "k2" }));
  assert.equal((await sends(f)).length, 2);
  const [first] = await sends(f);
  assert.deepEqual(first!.args[0], { to: "basic@basicbit.net", subject: "[VRDex ops] Gateway stale", body: "No heartbeat" });
  t.mock.timers.tick(6 * 3_600_000);
  await f.t.run(ctx => notifyOps(ctx, alert));
  assert.equal((await sends(f)).length, 3);
});

it("delivers through the given SES client", async () => {
  const sent: unknown[] = [];
  await deliverOpsAlert({ to: "ops@example.com", subject: "[VRDex ops] X", body: "Y" }, { send: async (command: { input: unknown }) => { sent.push(command.input); return {} as never; } } as never, "noreply@vrdex.example");
  assert.deepEqual(sent, [{ Source: "noreply@vrdex.example", Destination: { ToAddresses: ["ops@example.com"] }, Message: { Subject: { Data: "[VRDex ops] X", Charset: "UTF-8" }, Body: { Text: { Data: "Y", Charset: "UTF-8" } } } }]);
});

it("alerts on a connector's fifth consecutive failed job only", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ consecutiveFailures: 3 });
  const failJobToEnd = async () => {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
    await f.t.run(ctx => ctx.db.patch(jobId, { attempts: 4 }));
    await f.t.mutation(claim, { jobId });
    await f.t.mutation(fail, { jobId, error: "provider refused", durationMs: 1 });
  };
  await failJobToEnd();
  assert.equal((await sends(f)).length, 0);
  await failJobToEnd();
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.consecutiveFailures, 5);
  assert.equal((await sends(f)).length, 1);
});

it("a success after the alert sends exactly one resolved email; a success with no alert sends none", async () => {
  const f = await connectorFixture();
  const complete = makeFunctionReference<"mutation">("eventSync:completeJob");
  const succeed = async (connectorId: Awaited<ReturnType<typeof f.insertConnector>>) => {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
    await f.t.mutation(claim, { jobId });
    await f.t.mutation(complete, { jobId, durationMs: 1 });
  };
  const quiet = await f.insertConnector({ target: { calendarId: "quiet" } });
  await succeed(quiet);
  assert.equal((await sends(f)).length, 0);
  const noisy = await f.insertConnector();
  await f.t.run(ctx => notifyOps(ctx, { key: `connector-failures:${noisy}`, subject: "Event connector failing", body: "x" }));
  await succeed(noisy);
  await succeed(noisy);
  const subjects = (await sends(f)).map(fn => (fn.args[0] as { subject: string }).subject);
  assert.deepEqual(subjects, ["[VRDex ops] Event connector failing", `[VRDex ops] Resolved: connector-failures:${noisy}`]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/ops-alerts.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the schema table, the three modules, and the runner count; run codegen**

Run: `pnpm exec convex codegen`

- [ ] **Step 4: Run tests**

Run: `node --conditions=import --import tsx --test tests/backend/ops-alerts.test.ts tests/backend/event-sync-jobs.test.ts && pnpm typecheck:backend`
Expected: PASS.

- [ ] **Step 5: Document `VRDEX_OPS_ALERT_EMAIL`**

In `## Event connectors`: name; Convex only; optional, default `basic@basicbit.net`; owner BASIC; the recipient of `[VRDex ops]` alerts (connector failures here, gateway, Google watch, and recurrence alarms in later plans), one per alert key per six hours; sends through the SES settings in `## Transactional Email Environment`, so those must be set or alerts fail visibly in the Convex logs; change it with `npx convex env set`, no rotation beyond replacing the address.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/_opsAlerts.ts convex/opsAlerts.ts convex/opsAlertEmail.ts convex/eventSync.ts convex/_generated docs/deployment/convex-environments.md tests/backend/_eventConnectorFixture.ts tests/backend/ops-alerts.test.ts
git commit -m "feat(ops): email deduplicated ops alerts and alarm on failing connectors" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Hand-off notes for later plans

- Plan 03 passes the trigger message ID as `externalId` to `applyEventCandidate` so held drafts are link-keyed, calls `authorizeExtraction` with `connectorId`, and creates its run draft with `saveIntakeDraft(..., { connectorDriven: true, connectorId })` so `draft.connectorId` matches. It also passes `expectedUpdatedAt`, the `updatedAt` its `get_event` read, so a staff edit made during the run becomes a `conflict` hold draft instead of being overwritten.
- Plan 04 adds `dismissedAt` to drafts and must extend `pendingLinkDraft` to treat dismissed drafts as not pending; publishing a held draft must move the link from `draftId` to `eventId` and call `publishIntakeDraft` with `{ connectorId }`.
- Kind plans register a handler in `convex/eventSyncKinds/index.ts`, set the target's `*Name` fields at connect time, and add their own `VRDEX_CONNECTOR_<KIND>_ENABLED` check inside the handler. Plans 05, 08, and 10 call `notifyOps` (Task 10) for their staleness and failure alarms.
