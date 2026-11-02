# My Events Held Imports (Event Platform 04) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every community staffer with `manage_events` a "From Discord" section in My events where they can open, publish, or dismiss held connector drafts, review proposed updates as a before/after list, and keep events flagged by an external or Discord deletion.

**Architecture:** Connector drafts stay `eventIntakeDrafts` rows owned by the connector's authority. One new accessor, `getConnectorDraftForManager`, grants any `manage_events` staffer on the connector's community access to drafts that carry a `connectorId`; `getActorIntakeDraft` falls back to it for non-owners, so the existing wizard opens them unchanged. `convex/_eventIntakeHeld.ts` holds the pure field rules (promotion, explicit-only patch, diff) and the row projection; `api.eventInventory.listHeldImports` and three mutations in `convex/eventIntakeHeld.ts` sit on top. The web section is one client component above the existing inventory.

**Tech Stack:** Convex (queries, mutations), `convex-test` under `node:test` through `tsx`, Next.js client components with the existing `components/ui` primitives, Playwright fixtures under `apps/web/src/app/playwright`.

**Spec:** `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md` (Acting on the decision, Deletions and retractions, Held drafts in My events, Where provenance shows, Public copy) and `docs/superpowers/specs/2026-10-29-event-connectors-design.md` (Links; Directions and field ownership: External deletion). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md`.

## Global Constraints

- Depends on plans 02 and 03 being merged. From plan 02 (`docs/superpowers/plans/2026-10-29-event-platform-02-connector-foundation.md`): `eventConnectors` with `connectorTarget` (`channelName`, `guildName`, `calendarName`, `groupName` display names), `eventSyncLinks` (`by_eventId`, `by_connectorId_externalId`), `eventIntakeDrafts.connectorId` (Task 1), `pendingLinkDraft(db, link, now?)` in `convex/_eventConnectors.ts` (Task 1), `publishIntakeDraft(ctx, actorUserId, args, now, actorSurface, { connectorId })` (Tasks 4 and 6), `patchCommunityEventFieldsAsStaffRecord(ctx, args)` in `convex/events.ts` (Task 5), and `applyEventCandidate` in `convex/_eventCandidateApply.ts` (Task 7). From plan 03: `target.channelName` and `target.guildName` set at connect time, `discordIntakeMessages` (`by_connectorId_messageId`), `discordIntakeRuns` (`decision` is the whole decision object), `discordIntakeSources` (`by_eventId`). Names are not changed here.
- A held draft keeps the candidate in `fields.tentative` plus `fields.evidence` (plan 02 `applyEventCandidate` rule 7), and any top-level values a staffer saved win over `tentative`. A held row is a draft with `connectorId`, no `resolvedAt`, no `publishedReceiptId`, and `expiresAt > now`; autopublished connector drafts carry a receipt and are never held rows.
- The existing single-actor rule is the `draft.actorUserId !== actorUserId` check in `getActorIntakeDraft` (`convex/_eventIntake.ts`); `DRAFT_ACCESS` is only an error-code pattern in `apps/web/src/lib/server/event-intake-api.ts`. The owner path stays as it is, so plan 03's run pipeline, which reads drafts as the authority, is untouched. The manager path is additive and requires `manage_events` (community owner counts).
- Held actions (`publish`, `dismiss`) always go through `getConnectorDraftForManager`, so the authority without `manage_events` cannot act on held rows.
- Every failure of `getConnectorDraftForManager` throws `Error("Draft not found.")`, matching `getActorIntakeDraft`, so callers cannot probe draft existence.
- A held draft always publishes into its connector's community; the extracted `communitySlug` is overwritten.
- Proposed update: a draft with a link row (`by_draftId`) carrying `eventId`, or whose Discord run (`discordIntakeSources.by_draftId` to `runId`) has `decision.kind === "update"`; the target event is the link's `eventId`, else `events.by_slug` on `decision.slug`. A missing or moderation-removed target makes the row a plain new draft, in the list and in `publish` alike.
- Staff attention lives in two places and is cleared with a `flagReviewedAt` timestamp, never by changing state: a link that goes back to `linked` would be re-flagged by the next poll that still finds the item gone, and a run's `reason` is history.
- Public strings, verbatim from the intake design's copy table: `From Discord`, `Open`, `Publish`, `Dismiss`, `Update to {event title}`. Utility labels (one or two words, listed in the PR): column headers `Title`, `Date`, `Community`, `Channel`, `Author`, `Source`, `Actions`; change labels reuse the editor's `Event title`, `Date`, `Starts`, `Time zone`, `Description`, `Source URL`, `Lineup`, plus `Ends`, `Doors`, `Where`, `World`, `Time TBA`. Not in any spec table, proposed here and needing BASIC's approval before merge: `Keep`, `Discord post deleted` (reason `source_deleted`), `Deleted at the source` (reason `external_deleted`), `Unable to publish.` (action failure). No em-dash, no double hyphen, no AI mention, no badges.
- `listHeldImports` returns rows from every connector kind. Only `From Discord` is approved as a heading; the PR asks BASIC for a broader heading before plans 07 to 09 ship hold mode.
- Times in the UI render in the viewer's zone: start, end, and doors changes travel as instants and render through `ViewerLocalEventDateTime`.
- Start from `origin/main` in a fresh worktree. Regenerate `convex/_generated` with `pnpm verify:backend:local` (port 3210 is shared; reuse a running backend; restore `convex/README.md` and `convex/tsconfig.json` after a first boot). Backend tests run one file at a time with `node --conditions=import --import tsx --test FILE`. Commit by pathspec; each commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. End in a PR to `main`; never merge.

## Review Focus

1. The agent extracts another community's slug from a Discord post: a held publish must still create the event in the connector's community, under the clicker's `manage_events` there. Pinned in Task 3, `a second manager publishes a held draft as the community and is the receipt actor`.
2. Two staffers click Publish on the same row (or one double-clicks): one event, and the second call fails cleanly. Pinned in Task 3, same test (second publish rejects, list empty).
3. A dismissed Google item that a fifteen-minute poll sees again unchanged must not come back; one that changed at the source must. Pinned in Task 3, `a dismissed import is refiled only when the source changes`.
4. A busy channel's held drafts are owned by the authority: they must not fill that person's personal 20-draft quota or show in their personal Drafts list. Pinned in Task 1, `connector drafts stay out of the owner's inventory and draft quota`.
5. Discord posts almost always carry a poster owned by the authority: a second manager must be able to save the draft in the wizard and publishing must carry the poster to the event. Pinned in Task 1, `a second manager saves a connector draft that carries the authority's poster`, and Task 3, the publish test's `posterImageUrl` assertion.

---

## Files

| File | Responsibility |
| --- | --- |
| `convex/schema.ts` | Draft, link, run, source fields and indexes (Task 1) |
| `convex/_eventIntake.ts` | `getConnectorDraftForManager`, owner fallback, poster and quota rules (Task 1) |
| `convex/eventIntake.ts` | `getEventIntakeDraft` returns manager-readable drafts (Task 1) |
| `convex/_eventInventory.ts`, `convex/eventInventory.ts` | Exclude connector drafts from `listPage`; export `intakeSchedule`; `listHeldImports` (Tasks 1, 2) |
| `convex/eventCorrections.ts` | Export `correctionFields` (Task 2) |
| `convex/_eventIntakeHeld.ts` | Field rules, target lookup, row projection (Task 2) |
| `convex/eventIntakeHeld.ts` | `publish`, `dismiss`, `dismissFlag` (Task 3) |
| `convex/_eventConnectors.ts`, `convex/_eventCandidateApply.ts`, `convex/_eventIntake.ts` | Dismissed drafts stop blocking; unchanged dismissed items are not refiled; artwork ownership by draft owner (Task 3) |
| `apps/web/src/app/events/event-intake-form.tsx` | Connector drafts publish through `eventIntakeHeld.publish` (Task 4) |
| `apps/web/src/app/account/events/held-imports-section.tsx` | The section (Task 5) |
| `apps/web/src/app/account/events/managed-events-panel.tsx`, `event-inventory-list.tsx` | Mount the section; share the schedule cell (Task 5) |
| `apps/web/src/app/playwright/event-intake/*`, `apps/web/src/app/playwright/event-inventory/*` | Fixture modes `revision=held` and `held=1` (Tasks 4, 5) |
| `docs/backend/event-schema.md`, `docs/engineering/event-contribution-browser.md` | Behaviour docs (Tasks 3, 5) |
| `tests/backend/event-intake-held.test.ts`, `apps/web/e2e/event-held-imports.flow.spec.ts`, `apps/web/e2e/event-held-imports.visual.spec.ts` | Tests |

---

### Task 1: Connector draft fields and cross-actor access

**Files:**

- Modify: `convex/schema.ts` (`eventIntakeDrafts` at the `defineTable` near line 1162; `eventSyncLinks`, `discordIntakeRuns`, `discordIntakeSources` from plans 02 and 03)
- Modify: `convex/_eventIntake.ts` (`getActorIntakeDraft`, `saveIntakeDraft`)
- Modify: `convex/eventIntake.ts` (`getEventIntakeDraft`)
- Modify: `convex/eventInventory.ts` (`listPage` intake branch)
- Test: `tests/backend/event-intake-held.test.ts` (create)

**Interfaces:**

- Consumes: `resolveClubSubject(db, communityProfileId, subject)` and `ClubActor` from `convex/_clubAccess.ts`; `userOwnsProfile` from `convex/_profileOwnership.ts`; `AuthSubject` from `convex/_communityAuthority.ts`.
- Produces: `getConnectorDraftForManager(db: DatabaseReader, userId: Id<"users">, draftId: Id<"eventIntakeDrafts">, now?: number): Promise<{ draft: Doc<"eventIntakeDrafts">; connector: Doc<"eventConnectors">; community: Doc<"profiles"> }>` in `convex/_eventIntake.ts`. Schema: `eventIntakeDrafts.dismissedAt?`, `resolvedAt?` (set by publish, update, and dismiss), index `by_connectorId_resolvedAt` `["connectorId", "resolvedAt"]`; `eventSyncLinks.dismissedAt?`, `flagReviewedAt?`, indexes `by_draftId`, `by_connectorId_state`; `discordIntakeRuns.flagReviewedAt?`, index `by_connectorId_reason`; `discordIntakeSources` index `by_draftId`.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { EventIntakePatch } from "../../packages/api-contracts/src/event-intake";
import { EVENT_INTAKE_DRAFT_TTL_MS, getConnectorDraftForManager } from "../../convex/_eventIntake";

process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
process.env.EVENT_DATE_ONLY_ENABLED = "true";
process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const DAY = 86_400_000;
const evidence = (fieldPath: string, assessment: "explicit" | "inferred" = "explicit") => ({ fieldPath, origin: "text" as const, excerpt: null, assessment });
const newDraft: EventIntakePatch = { communitySlug: "club", tentative: { communitySlug: "club", title: "Afterglow Social", eventDate: "2027-07-20", timeTba: true }, evidence: [evidence("event.title"), evidence("event.eventDate")] };
const updateDraft: EventIntakePatch = { communitySlug: "club", tentative: { title: "Harbor Night", eventDate: "2027-07-15", timezone: "UTC", start: { time: "21:00", dayOffset: 0 }, venueLabel: "Club Room" }, evidence: [evidence("event.title"), evidence("event.start"), evidence("event.venueLabel", "inferred")] };

async function fixture() {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventInventory.ts": () => import("../../convex/eventInventory"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/eventIntakeHeld.ts": () => import("../../convex/eventIntakeHeld"),
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = Date.now();
  const ids = await t.run(async ({ db }) => {
    const user = (clerkUserId: string) => db.insert("users", { clerkUserId, name: clerkUserId });
    const [owner, authority, staff, second, outsider] = [await user("owner"), await user("authority"), await user("staff"), await user("second"), await user("outsider")];
    const community = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
    await db.insert("profileOwners", { profileId: community, userId: owner, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    const grant = (name: string, capabilities: string[]) => db.insert("communityAuthorities", { communityProfileId: community, subject: { subject: name, issuer: "test", tokenIdentifier: `test|${name}` }, subjectTokenIdentifier: `test|${name}`, roleLabel: "Staff", capabilities, state: "active", grantedAt: now, updatedAt: now });
    await grant("authority", ["manage_integrations"]); await grant("staff", ["manage_events"]); await grant("second", ["manage_events"]);
    const discord = await db.insert("eventConnectors", { communityProfileId: community, kind: "discord_announcements", direction: "import", mode: "hold", authorityUserId: authority, target: { guildId: "111111111111111111", channelId: "222222222222222222", channelName: "events" }, state: "active", createdAt: now, updatedAt: now });
    const google = await db.insert("eventConnectors", { communityProfileId: community, kind: "google_calendar", direction: "import", mode: "hold", authorityUserId: authority, target: { calendarId: "club@group.calendar.google.com" }, state: "active", createdAt: now, updatedAt: now });
    const event = await db.insert("events", { communityProfileId: community, communityName: "Club", title: "Harbor Night", sortTitle: "harbor night", slug: "harbor", scheduleKind: "timed", eventDate: "2027-07-15", startAt: Date.UTC(2027, 6, 15, 20), sortAt: Date.UTC(2027, 6, 15, 20), timezone: "UTC", venueLabel: "Hand-set hall", sourceType: "community", sourceLabel: "Club", eventStatus: "scheduled", publicationState: "published", createdAt: now, updatedAt: now });
    return { owner, authority, staff, second, outsider, community, discord, google, event };
  });
  const as = (name: string) => t.withIdentity({ subject: name, issuer: "test", tokenIdentifier: `test|${name}` });
  const draft = (fields: EventIntakePatch, extra: Record<string, unknown> = {}) => t.run(({ db }) => db.insert("eventIntakeDrafts", { actorUserId: ids.authority, connectorId: ids.discord, version: 1, fields, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 30 * DAY, ...extra }));
  const discordSource = (draftId: Id<"eventIntakeDrafts">, decision: unknown = { kind: "new" }, messageId = "333333333333333333") => t.run(async ({ db }) => {
    const runId = await db.insert("discordIntakeRuns", { connectorId: ids.discord, authorId: "555555555555555555", triggerMessageIds: [messageId], state: "done", decision, draftId, createdAt: now });
    await db.insert("discordIntakeMessages", { connectorId: ids.discord, messageId, guildId: "111111111111111111", channelId: "222222222222222222", authorId: "555555555555555555", authorDisplayName: "Promoter", content: "Afterglow Social, July 20", attachments: [], createdAt: now, updatedAt: now });
    await db.insert("discordIntakeSources", { connectorId: ids.discord, messageId, draftId, runId, createdAt: now });
  });
  const poster = (draftId: Id<"eventIntakeDrafts">) => t.run(async ({ db }) => {
    const sourceId = await db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: ids.authority, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 10, state: "ready", uploadedAt: now, expiresAt: now + DAY, uploadExpiresAt: now + DAY, lastActivityAt: now });
    const artworkId = await db.insert("eventPosterArtwork", { actorUserId: ids.authority, draftId, sourceId, state: "ready", createdAt: now, expiresAt: now + DAY });
    const row = (await db.get(draftId))!;
    await db.patch(draftId, { artworkAssetId: artworkId, fields: { ...row.fields, posterSourceId: sourceId } });
    return { sourceId, artworkId };
  });
  // What plan 02's autopublish leaves behind: a connector draft with a publication receipt.
  const autopublished = (fields: EventIntakePatch) => t.run(async ({ db }) => {
    const draftId = await db.insert("eventIntakeDrafts", { actorUserId: ids.authority, connectorId: ids.discord, version: 1, fields, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 30 * DAY });
    const receiptId = await db.insert("eventContributionReceipts", { actorUserId: ids.authority, draftId, draftVersion: 1, eventId: ids.event, eventPath: "/club/events/harbor", communityProfileId: ids.community, fingerprint: "autopublished", createdAt: now });
    await db.patch(draftId, { publishedReceiptId: receiptId });
    return draftId;
  });
  return { t, ids, as, draft, discordSource, poster, autopublished, now };
}

it("lets any manage_events staffer read a connector draft and nobody else", async () => {
  const { t, ids, as, draft, autopublished } = await fixture();
  const draftId = await draft(newDraft);
  const published = await autopublished(newDraft);
  assert.equal((await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId }))?.connectorId, ids.discord);
  assert.equal((await as("owner").query(api.eventIntake.getEventIntakeDraft, { draftId }))?._id, draftId);
  assert.equal(await as("outsider").query(api.eventIntake.getEventIntakeDraft, { draftId }), null);
  await t.run(async ({ db }) => {
    // The authority holds manage_integrations only: the held path is closed to them.
    await assert.rejects(getConnectorDraftForManager(db, ids.authority, draftId), /Draft not found/);
    assert.equal((await getConnectorDraftForManager(db, ids.staff, draftId)).connector._id, ids.discord);
    await assert.rejects(getConnectorDraftForManager(db, ids.staff, published), /Draft not found/);
    await db.patch(draftId, { resolvedAt: Date.now() });
    await assert.rejects(getConnectorDraftForManager(db, ids.staff, draftId), /Draft not found/);
  });
});

it("keeps personal drafts owner-only", async () => {
  const { t, ids, as } = await fixture();
  const personal = await t.run(({ db }) => db.insert("eventIntakeDrafts", { actorUserId: ids.owner, version: 1, fields: { title: "Mine" }, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + DAY }));
  assert.equal(await as("staff").query(api.eventIntake.getEventIntakeDraft, { draftId: personal }), null);
  await t.run(({ db }) => assert.rejects(getConnectorDraftForManager(db, ids.staff, personal), /Draft not found/));
});

it("a second manager saves a connector draft that carries the authority's poster", async () => {
  const { as, draft, poster } = await fixture();
  const draftId = await draft(newDraft);
  const { sourceId } = await poster(draftId);
  const loaded = await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId });
  assert.equal(loaded?.artworkSourceId, sourceId);
  const saved = await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 1, patch: { ...loaded!.fields, title: "Edited" } });
  assert.equal(saved.version, 2);
});

it("connector drafts stay out of the owner's inventory and draft quota", async () => {
  const { ids, as, draft } = await fixture();
  for (let n = 0; n < 20; n++) await draft(newDraft, { actorUserId: ids.owner });
  const page = await as("owner").query(api.eventInventory.listPage, { view: "drafts", query: "", timeZone: "UTC", asOf: Date.parse("2026-10-22T12:00:00Z"), paginationOpts: { cursor: null, numItems: 50 } });
  assert.equal(page.page.filter(row => row.kind === "intake_draft").length, 0);
  await as("owner").mutation(api.eventIntake.saveEventIntakeDraft, { patch: { title: "Personal" } });
});
```

`listPage` pages per source, so if the first page is the intake source and is empty, assert over the traversal the way `tests/backend/event-inventory.test.ts` `traverse` does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts`
Expected: FAIL (`getConnectorDraftForManager` is not exported; `resolvedAt` is not in the schema).

- [ ] **Step 3: Add the schema fields and indexes** listed under Produces.

- [ ] **Step 4: Implement `getConnectorDraftForManager` in `convex/_eventIntake.ts`**

Loads the draft, its connector, and the connector's community; passes only when the draft has `connectorId`, `expiresAt > now`, no `resolvedAt`, no `publishedReceiptId`, and the user owns the community (`userOwnsProfile`) or `resolveClubSubject` grants `manage_events`. The subject comes from the user row: `{ subject: user.clerkUserId, issuer, tokenIdentifier: issuer + "|" + user.clerkUserId }` with `issuer = process.env.CLERK_JWT_ISSUER_DOMAIN`, the same pairing `resolveClubSubject` trusts. Connector `state` is not checked: drafts from a paused or removed connector stay actionable.

- [ ] **Step 5: Route non-owners through it, and compare poster ownership with the draft owner**

- `getActorIntakeDraft`: when `draft.actorUserId !== actorUserId`, `await getConnectorDraftForManager(db, actorUserId, draftId, now)` instead of throwing; the `artworkSourceId` check compares `artwork.actorUserId` with `draft.actorUserId`.
- `saveIntakeDraft`: the poster source check compares `source.actorUserId` with `draft.actorUserId`; the `DRAFT_QUOTA` count reads `by_actor_expiresAt` with `.filter(q => q.eq(q.field("connectorId"), undefined))` before `take`.
- `getEventIntakeDraft` (`convex/eventIntake.ts`): drop its owner pre-check; return `getActorIntakeDraft(...)` or `null` when it throws.
- `listPage` intake branch (`convex/eventInventory.ts`): skip drafts with `connectorId`.

- [ ] **Step 6: Run the tests to verify they pass, then the neighbours**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts tests/backend/event-intake.test.ts tests/backend/event-inventory.test.ts tests/backend/event-intake-sources.test.ts`
Expected: PASS.

- [ ] **Step 7: Regenerate and commit**

```bash
pnpm verify:backend:local
git add convex/schema.ts convex/_eventIntake.ts convex/eventIntake.ts convex/eventInventory.ts convex/_generated tests/backend/event-intake-held.test.ts
git commit -m "feat(events): let community event managers open connector drafts" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Held import rows and `listHeldImports`

**Files:**

- Create: `convex/_eventIntakeHeld.ts`
- Modify: `convex/eventInventory.ts` (add `listHeldImports`), `convex/_eventInventory.ts` (export `intakeSchedule`), `convex/eventCorrections.ts` (export `correctionFields`, unchanged)
- Test: `tests/backend/event-intake-held.test.ts`

**Interfaces:**

- Consumes: Task 1's accessor and indexes; `managedCommunitiesForBrowser(ctx, { includeNonPublic: true })` from `convex/events.ts`; `correctionFields(db, event): Promise<EventIntakePatch>`; `intakeSchedule(fields): InventorySchedule`; `eventPathForSlugs`; `selectEventLocalTime` from `packages/api-contracts/src/event-intake.ts`.
- Produces, in `convex/_eventIntakeHeld.ts`:

```ts
export type HeldChangeField = "title" | "eventDate" | "timeTba" | "timezone" | "start" | "end" | "doors" | "venueLabel" | "worldSlug" | "summary" | "sourceUrl" | "lineup";
// start, end, doors carry instants (ms); lineup carries performer labels joined with ", "; timeTba carries "Time TBA" or null.
export type HeldChange = { field: HeldChangeField; before: string | number | null; after: string | number | null };
type HeldOrigin = { community: { slug: string; displayName: string }; connectorKind: Doc<"eventConnectors">["kind"]; targetName: string | null; updatedAt: number };
type HeldDraftRow = { draftId: Id<"eventIntakeDrafts">; title: string | null; schedule: InventorySchedule; author: string | null; sourceUrl: string | null; openHref: string };
export type HeldImportRow = HeldOrigin & (
  | (HeldDraftRow & { kind: "new" })
  | (HeldDraftRow & { kind: "update"; target: { slug: string; title: string; href: string }; changes: HeldChange[] })
  | { kind: "flag"; eventId: Id<"events">; reason: "source_deleted" | "external_deleted"; title: string; href: string }
);
export const HELD_IMPORT_LIMIT = 50;
export function promoteHeldFields(fields: EventIntakePatch, communitySlug: string): EventIntakePatch;
export function heldUpdatePatch(fields: EventIntakePatch): Partial<Pick<EventIntakeFields, HeldChangeField>>;
export function heldChanges(current: EventIntakePatch, patch: ReturnType<typeof heldUpdatePatch>): HeldChange[];
export async function heldTarget(db: DatabaseReader, draft: Doc<"eventIntakeDrafts">): Promise<{ event: Doc<"events">; links: Doc<"eventSyncLinks">[] } | null>;
export async function heldImportRows(db: DatabaseReader, community: Doc<"profiles">, now: number): Promise<HeldImportRow[]>;
// convex/eventInventory.ts
export const listHeldImports = query({ args: { communityProfileId: v.optional(v.id("profiles")) } }); // HeldImportRow[]
```

- [ ] **Step 1: Write the failing tests** (append to `tests/backend/event-intake-held.test.ts`; import `heldChanges`, `heldUpdatePatch`, `promoteHeldFields` from `../../convex/_eventIntakeHeld`)

```ts
const A = { clientKey: "a", position: 0, performerLabel: "A" };
const B = { clientKey: "b", position: 1, performerLabel: "B" };

it("promotes extracted values under staff edits and pins the connector community", () => {
  assert.deepEqual(promoteHeldFields({ title: "Staff title", tentative: { title: "Extracted", communitySlug: "elsewhere", eventDate: "2027-07-20", timeTba: true }, evidence: [evidence("event.title")] }, "club"),
    { title: "Staff title", communitySlug: "club", eventDate: "2027-07-20", timeTba: true, tentative: null, evidence: null, questions: null });
  // A staffer re-dated the draft: extracted clocks belong to the old date and are not promoted.
  assert.equal(promoteHeldFields({ eventDate: "2027-07-21", tentative: { eventDate: "2027-07-20", start: { time: "21:00", dayOffset: 0 } } }, "club").start, undefined);
});

it("builds the update patch from explicit evidence only", () => {
  assert.deepEqual(heldUpdatePatch({ tentative: { title: "T", start: { time: "21:00", dayOffset: 0 }, venueLabel: "V", communitySlug: "elsewhere", lineup: [A] },
    evidence: [evidence("event.title"), evidence("event.startDate"), evidence("event.venueLabel", "inferred"), evidence("event.communitySlug"), evidence("lineup.0.performerLabel")] }),
    { title: "T", start: { time: "21:00", dayOffset: 0 }, lineup: [A] });
  assert.deepEqual(heldUpdatePatch({ title: "Staff edit", tentative: { title: "T" }, evidence: [evidence("event.title")] }), { title: "Staff edit" });
  assert.deepEqual(heldUpdatePatch({ tentative: { title: "T" }, evidence: [{ ...evidence("event.title"), assessment: "conflicting" }] }), {});
});

it("reports only changed fields, with instants for clocks", () => {
  const current: EventIntakePatch = { title: "Harbor Night", eventDate: "2027-07-15", timezone: "UTC", start: { time: "20:00", dayOffset: 0 }, venueLabel: "Hand-set hall", lineup: [A] };
  assert.deepEqual(heldChanges(current, { title: "Harbor Night", start: { time: "21:00", dayOffset: 0 }, lineup: [A, B] }), [
    { field: "start", before: Date.UTC(2027, 6, 15, 20), after: Date.UTC(2027, 6, 15, 21) },
    { field: "lineup", before: "A", after: "A, B" },
  ]);
  assert.deepEqual(heldChanges(current, { lineup: [{ ...A, clientKey: "other" }] }), []);
});

it("lists a held new draft with its Discord provenance and never an autopublished one", async () => {
  const { as, draft, discordSource, autopublished, now } = await fixture();
  const draftId = await draft(newDraft);
  await discordSource(draftId);
  await autopublished(newDraft);
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), [{
    kind: "new", draftId, title: "Afterglow Social", schedule: { kind: "date_only", eventDate: "2027-07-20" },
    community: { slug: "club", displayName: "Club" }, connectorKind: "discord_announcements", targetName: "#events",
    author: "Promoter", sourceUrl: "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333",
    openHref: `/events/new?draft=${draftId}`, updatedAt: now,
  }]);
});

it("lists proposed updates from a linked draft and from a run decision with the explicit diff", async () => {
  const { t, ids, as, draft, discordSource } = await fixture();
  const linked = await draft(updateDraft, { connectorId: ids.google });
  await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId: linked, eventId: ids.event, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const decided = await draft(updateDraft);
  await discordSource(decided, { kind: "update", slug: "harbor" });
  const rows = await as("second").query(api.eventInventory.listHeldImports, { communityProfileId: ids.community });
  for (const draftId of [linked, decided]) {
    const row = rows.find(item => item.kind === "update" && item.draftId === draftId);
    assert.ok(row?.kind === "update");
    assert.deepEqual(row.target, { slug: "harbor", title: "Harbor Night", href: "/club/events/harbor/edit" });
    assert.deepEqual(row.changes, [{ field: "start", before: Date.UTC(2027, 6, 15, 20), after: Date.UTC(2027, 6, 15, 21) }]);
  }
  const googleRow = rows.find(item => item.kind === "update" && item.draftId === linked);
  assert.ok(googleRow?.kind === "update");
  assert.deepEqual([googleRow.author, googleRow.sourceUrl, googleRow.targetName], [null, null, "club@group.calendar.google.com"]);
});

it("lists staff-attention rows for both deletion reasons", async () => {
  const { t, ids, as, now } = await fixture();
  const pier = await t.run(async ({ db }) => {
    const id = await db.insert("events", { communityProfileId: ids.community, communityName: "Club", title: "Pier Night", sortTitle: "pier night", slug: "pier", scheduleKind: "date_only", eventDate: "2027-08-01", sortAt: Date.UTC(2027, 7, 1), sourceType: "community", sourceLabel: "Club", eventStatus: "scheduled", publicationState: "published", createdAt: now, updatedAt: now });
    await db.insert("eventSyncLinks", { connectorId: ids.google, eventId: ids.event, externalId: "g-2", state: "external_deleted", createdAt: now, updatedAt: now });
    await db.insert("discordIntakeRuns", { connectorId: ids.discord, authorId: "555555555555555555", triggerMessageIds: ["666666666666666666"], state: "done", reason: "source_deleted", eventId: id, createdAt: now });
    await db.insert("eventSyncLinks", { connectorId: ids.google, eventId: id, externalId: "g-3", state: "external_deleted", flagReviewedAt: now, createdAt: now, updatedAt: now });
    return id;
  });
  const flags = (await as("staff").query(api.eventInventory.listHeldImports, {})).filter(row => row.kind === "flag");
  assert.deepEqual(flags.map(row => row.kind === "flag" && [row.eventId, row.reason, row.title, row.href]).sort(), [
    [ids.event, "external_deleted", "Harbor Night", "/club/events/harbor/edit"],
    [pier, "source_deleted", "Pier Night", "/club/events/pier/edit"],
  ].sort());
});

it("shows nothing to staff without manage_events", async () => {
  const { ids, as, draft } = await fixture();
  await draft(newDraft);
  for (const name of ["authority", "outsider"]) {
    assert.deepEqual(await as(name).query(api.eventInventory.listHeldImports, {}), []);
    await assert.rejects(as(name).query(api.eventInventory.listHeldImports, { communityProfileId: ids.community }), /access/);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts`
Expected: FAIL (`../../convex/_eventIntakeHeld` does not exist).

- [ ] **Step 3: Implement the pure rules in `convex/_eventIntakeHeld.ts`**

- `promoteHeldFields`: top-level non-null values win; non-null `tentative` values fill the rest, except `start`, `end`, `doors`, `timeTba`, and `lineup` when a top-level `eventDate` is set and differs from `tentative.eventDate`; `communitySlug` is always the argument; `tentative`, `evidence`, `questions` become `null`.
- `heldUpdatePatch`: values from the `promoteHeldFields` merge; keys from `explicit` evidence only. Mapping: `event.startDate` and `event.start` to `start`, `event.endDate` and `event.end` to `end`, `event.{title,eventDate,timezone,venueLabel,summary,sourceUrl}` to the same key, any `lineup.*` to `lineup` (whole field); `event.communitySlug` and unknown paths are ignored. Keys whose merged value is null are left out.
- `heldChanges`: walk `HeldChangeField` in the declared order, keep keys present in the patch whose value differs from `current` (lineup rows compared without `clientKey` and `position`). Clock instants come from `selectEventLocalTime(patch.eventDate ?? current.eventDate, local, patch.timezone ?? current.timezone)`, `null` when that throws.

- [ ] **Step 4: Implement `heldTarget`, `heldImportRows`, and `listHeldImports`**

- `heldTarget`: links from `eventSyncLinks.by_draftId`; the event is the first link's `eventId`, else the Discord run's `decision.slug` via `discordIntakeSources.by_draftId` then `events.by_slug`; returns `null` when the event is missing, moderation-removed, or in another community.
- `heldImportRows` per community: connectors from `eventConnectors.by_communityProfileId`; per connector, drafts from `by_connectorId_resolvedAt` with `resolvedAt` undefined, then filtered to no `publishedReceiptId` and `expiresAt > now` (autopublished drafts share the index range), links from `by_connectorId_state` `external_deleted` and runs from `by_connectorId_reason` `source_deleted` with an `eventId`, both without `flagReviewedAt`; each read `take(HELD_IMPORT_LIMIT)`. `targetName` is `"#" + target.channelName` when set (plan 03 sets it at connect), else `target.calendarName ?? target.groupName ?? target.guildName`, else the channel, calendar, or group ID. Author and source URL come from the draft's earliest `discordIntakeSources` row and its `discordIntakeMessages` row: `https://discord.com/channels/{guildId}/{channelId}/{messageId}`. Title and schedule use `promoteHeldFields(draft.fields, community.slug)`. Update `changes` compare against `correctionFields(db, target.event)`. Flag `updatedAt` is the link's `updatedAt` or the run's `finishedAt ?? createdAt`; flags dedupe on `eventId` plus reason.
- `listHeldImports`: `managedCommunitiesForBrowser(ctx, { includeNonPublic: true })`; with `communityProfileId` not among them, throw `Error("You do not have access to this action.")`; concatenate, sort by `updatedAt` descending, cap at `HELD_IMPORT_LIMIT`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts tests/backend/event-corrections.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate and commit**

```bash
pnpm verify:backend:local
git add convex/_eventIntakeHeld.ts convex/eventInventory.ts convex/_eventInventory.ts convex/eventCorrections.ts convex/_generated tests/backend/event-intake-held.test.ts
git commit -m "feat(events): list held imports and staff-attention flags" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Publish, dismiss, and keep

**Files:**

- Create: `convex/eventIntakeHeld.ts`
- Modify: `convex/_eventIntake.ts` (`publishIntakeDraft` artwork ownership), `convex/_eventConnectors.ts` (`pendingLinkDraft`), `convex/_eventCandidateApply.ts` (refile rule)
- Modify: `docs/backend/event-schema.md`
- Test: `tests/backend/event-intake-held.test.ts`

**Interfaces:**

- Consumes: Task 1's `getConnectorDraftForManager`; Task 2's `promoteHeldFields`, `heldUpdatePatch`, `heldTarget`; `saveIntakeDraft`, `EVENT_INTAKE_DRAFT_TTL_MS`; plan 02's `publishIntakeDraft(ctx, actorUserId, args, now, actorSurface, { connectorId })`, `patchCommunityEventFieldsAsStaffRecord(ctx, { actorUserId, slug, expectedUpdatedAt, patch })`, and `pendingLinkDraft(db, link, now?)`; `canUpdateEvent(db, event, subject, userId)` from `convex/events.ts`; `requireActiveBrowserSessionSubject`; `applyEventCandidate`.
- Produces:

```ts
// convex/eventIntakeHeld.ts
export const publish = mutation({ args: { draftId: v.id("eventIntakeDrafts") } }); // { outcome: "published" | "updated"; eventId: Id<"events">; eventPath: string }
export const dismiss = mutation({ args: { draftId: v.id("eventIntakeDrafts") } }); // null
export const dismissFlag = mutation({ args: { eventId: v.id("events") } }); // null
```

- [ ] **Step 1: Write the failing tests** (append; import `applyEventCandidate` from `../../convex/_eventCandidateApply`)

```ts
it("a second manager publishes a held draft as the community and is the receipt actor", async () => {
  const { t, ids, as, draft, discordSource, poster } = await fixture();
  const draftId = await draft({ ...newDraft, tentative: { ...newDraft.tentative, communitySlug: "elsewhere" } });
  await discordSource(draftId);
  const { artworkId } = await poster(draftId);
  const result = await as("second").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.equal(result.outcome, "published");
  await t.run(async ({ db }) => {
    const event = (await db.get(result.eventId))!;
    assert.deepEqual([event.communityProfileId, event.title, event.eventDate], [ids.community, "Afterglow Social", "2027-07-20"]);
    assert.notEqual(event.sourceType, "contributor");
    assert.equal(event.posterImageUrl, `/api/v0/events/${result.eventId}/artwork/${artworkId}`);
    const receipt = await db.query("eventContributionReceipts").withIndex("by_eventId", q => q.eq("eventId", result.eventId)).unique();
    assert.equal(receipt?.actorUserId, ids.second);
    assert.ok((await db.get(draftId))?.resolvedAt);
    const source = await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draftId)).unique();
    assert.equal(source?.eventId, result.eventId);
  });
  await assert.rejects(as("staff").mutation(api.eventIntakeHeld.publish, { draftId }), /Draft not found/);
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), []);
});

it("applies only explicit fields of a proposed update and relinks", async () => {
  const { t, ids, as, draft } = await fixture();
  const draftId = await draft(updateDraft, { connectorId: ids.google });
  const linkId = await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId, eventId: ids.event, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const result = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.deepEqual([result.outcome, result.eventId], ["updated", ids.event]);
  await t.run(async ({ db }) => {
    const event = (await db.get(ids.event))!;
    assert.equal(event.startAt, Date.UTC(2027, 6, 15, 21));
    assert.equal(event.venueLabel, "Hand-set hall");
    const link = (await db.get(linkId))!;
    assert.deepEqual([link.eventId, link.draftId], [ids.event, undefined]);
    assert.ok((await db.get(draftId))?.resolvedAt);
    const audit = await db.query("eventAuditEvents").withIndex("by_eventId_createdAt", q => q.eq("eventId", ids.event)).order("desc").first();
    assert.equal(audit?.actorUserId, ids.staff);
  });
});

it("dismiss hides a held draft, marks its link, and keeps the row for thirty days", async () => {
  const { t, ids, as, draft } = await fixture();
  const draftId = await draft(updateDraft, { connectorId: ids.google });
  const linkId = await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId, eventId: ids.event, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  await assert.rejects(as("outsider").mutation(api.eventIntakeHeld.dismiss, { draftId }), /Draft not found/);
  await as("staff").mutation(api.eventIntakeHeld.dismiss, { draftId });
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), []);
  await t.run(async ({ db }) => {
    const row = (await db.get(draftId))!;
    assert.ok(row.dismissedAt);
    assert.equal(row.resolvedAt, row.dismissedAt);
    assert.equal(row.expiresAt, row.dismissedAt! + EVENT_INTAKE_DRAFT_TTL_MS);
    assert.equal((await db.get(linkId))?.dismissedAt, row.dismissedAt);
    await db.patch(draftId, { expiresAt: Date.now() - 1 });
  });
  await t.mutation(internal.eventIntake.expireDrafts, {});
  assert.equal(await t.run(({ db }) => db.get(draftId)), null);
});

it("a dismissed import is refiled only when the source changes", async () => {
  const { t, ids, as } = await fixture();
  const candidate = { event: { title: "Pier Night", communitySlug: "club", eventDate: "2027-08-01", start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null },
    lineup: [], evidence: [{ fieldPath: "event.title", origin: "connector" as const, excerpt: null, assessment: "explicit" as const }], questions: [], decision: { kind: "new" as const } };
  const apply = (externalUpdatedAt: number, idempotencyKey: string) => t.run(async ctx => {
    const link = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", ids.google).eq("externalId", "g-9")).unique();
    return applyEventCandidate(ctx, { connector: (await ctx.db.get(ids.google))!, candidate, actorUserId: ids.authority, externalId: "g-9", externalUpdatedAt, idempotencyKey, ...(link ? { link } : {}) });
  });
  const first = await apply(100, "k1");
  assert.equal(first.outcome, "draft");
  await as("staff").mutation(api.eventIntakeHeld.dismiss, { draftId: first.draftId! });
  assert.equal((await apply(100, "k2")).outcome, "skipped_pending_draft");
  const refiled = await apply(200, "k3");
  assert.equal(refiled.outcome, "draft");
  assert.notEqual(refiled.draftId, first.draftId);
});

it("Keep clears both staff-attention flags for that event", async () => {
  const { t, ids, as, now } = await fixture();
  const [linkId, runId] = await t.run(async ({ db }) => [
    await db.insert("eventSyncLinks", { connectorId: ids.google, eventId: ids.event, externalId: "g-2", state: "external_deleted", createdAt: now, updatedAt: now }),
    await db.insert("discordIntakeRuns", { connectorId: ids.discord, authorId: "555555555555555555", triggerMessageIds: ["666666666666666666"], state: "done", reason: "source_deleted", eventId: ids.event, createdAt: now }),
  ] as const);
  await assert.rejects(as("outsider").mutation(api.eventIntakeHeld.dismissFlag, { eventId: ids.event }), /access/);
  await as("staff").mutation(api.eventIntakeHeld.dismissFlag, { eventId: ids.event });
  assert.deepEqual((await as("staff").query(api.eventInventory.listHeldImports, {})).filter(row => row.kind === "flag"), []);
  await t.run(async ({ db }) => {
    const link = (await db.get(linkId))!;
    assert.deepEqual([link.state, Boolean(link.flagReviewedAt)], ["external_deleted", true]);
    const run = (await db.get(runId))!;
    assert.deepEqual([run.reason, Boolean(run.flagReviewedAt)], ["source_deleted", true]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts`
Expected: FAIL (`api.eventIntakeHeld` is undefined).

- [ ] **Step 3: Let another staffer publish the authority's artwork**

In `publishIntakeDraft`, the artwork block compares `artwork.actorUserId` with `draft.actorUserId` instead of `actorUserId`. Plan 02 already made its created-by-this-draft test `receipt.draftId === draft._id && createdEvent` when `options.connectorId` is set. Contributor-mode behaviour is unchanged (owner and actor are the same user there).

- [ ] **Step 4: Implement `convex/eventIntakeHeld.ts`**

- `publish`: actor from `requireActiveBrowserSessionSubject`; `getConnectorDraftForManager`; `heldTarget`. With a target: `patchCommunityEventFieldsAsStaffRecord(ctx, { actorUserId: clicker, slug, expectedUpdatedAt: event.updatedAt, patch: heldUpdatePatch(draft.fields) })`, outcome `updated`, `eventPath` from `eventPathForRecord`. Without: `saveIntakeDraft(db, clicker, { draftId, expectedVersion, patch: promoteHeldFields(draft.fields, community.slug) })`, then `publishIntakeDraft(ctx, clicker, { draftId, expectedVersion: saved.version, idempotencyKey: "held:" + draftId + ":" + saved.version }, now, "browser", { connectorId: draft.connectorId })`, which publishes the community's own listing, skips the per-account caps, and keeps the per-community cap; outcome `published`. Both branches then set `eventId` and unset `draftId` on every `by_draftId` link, set `eventId` on every `by_draftId` Discord source, and set `resolvedAt: now` on the draft.
- `dismiss`: `getConnectorDraftForManager`; draft gets `dismissedAt: now`, `resolvedAt: now`, `expiresAt: now + EVENT_INTAKE_DRAFT_TTL_MS`; every `by_draftId` link gets `dismissedAt: now`, `updatedAt: now`. The existing `expireDrafts` sweep removes the row.
- `dismissFlag`: the event must exist and `canUpdateEvent(db, event, subject, userId)` must pass, else `Error("You do not have access to this action.")`; set `flagReviewedAt: now` on the event's `by_eventId` links in state `external_deleted`, and on `source_deleted` runs (`by_connectorId_reason`) of the community's `discord_announcements` connectors whose `eventId` matches.

- [ ] **Step 5: Make a dismissed draft stop blocking, without refiling an unchanged item**

- `pendingLinkDraft` (`convex/_eventConnectors.ts`) also returns `null` when the linked draft has `dismissedAt`, so the runner's `pending_draft` skip ends and exports resume.
- `applyEventCandidate` rule 3 (`convex/_eventCandidateApply.ts`): for a link with `dismissedAt`, return `skipped_pending_draft` unless `args.externalUpdatedAt` is greater than `link.externalUpdatedAt`; when it is, continue to rule 7, which files a new draft and upserts the link with the new `draftId` and `externalUpdatedAt`, unsetting `dismissedAt`.

- [ ] **Step 6: Run the tests to verify they pass, then the neighbours**

Run: `node --conditions=import --import tsx --test tests/backend/event-intake-held.test.ts tests/backend/event-intake.test.ts tests/backend/event-candidate-apply.test.ts tests/backend/event-connectors.test.ts`
Expected: PASS (use plan 02's actual test file names if they differ).

- [ ] **Step 7: Document the backend behaviour**

In `docs/backend/event-schema.md`, add `### Held imports` inside plan 02's connectors section (or after `## Calendar Import And Export` if that section has another name): the draft fields (`connectorId`, `dismissedAt`, `resolvedAt`) and who may act on them; the community pin on publish; the clicker as receipt and audit actor; explicit-only update and relinking; dismissal retention (30 days, then the draft sweep) and the dismissed-link refile rule; `target.channelName`; staff attention from `external_deleted` links and `source_deleted` runs, cleared by Keep through `flagReviewedAt` with state untouched. Run `pnpm exec markdownlint-cli2 docs/backend/event-schema.md`; expected: no errors.

- [ ] **Step 8: Regenerate and commit**

```bash
pnpm verify:backend:local
git add convex/eventIntakeHeld.ts convex/_eventIntake.ts convex/_eventConnectors.ts convex/_eventCandidateApply.ts convex/_generated docs/backend/event-schema.md tests/backend/event-intake-held.test.ts
git commit -m "feat(events): publish, dismiss, and keep held imports" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Open in the editor publishes through the held path

**Files:**

- Modify: `apps/web/src/app/events/event-intake-form.tsx` (`ConnectedIntake` publish handler, near the `useAction(api.eventIntake.publishEventIntake)` call)
- Modify: `apps/web/src/app/playwright/event-intake/page.tsx`, `apps/web/src/app/playwright/event-intake/revision-preview.tsx`
- Test: `apps/web/e2e/event-held-imports.flow.spec.ts` (create)

**Interfaces:**

- Consumes: `api.eventIntakeHeld.publish` (Task 3); `getEventIntakeDraft` returning `connectorId` (Task 1).
- Produces: fixture mode `/playwright/event-intake?revision=held`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "@playwright/test";

test("a connector draft opened in the editor publishes through the held path @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("event-intake-review-command"))).toBe("eventIntakeHeld:publish");
  expect(await page.evaluate(() => sessionStorage.getItem("event-intake-revision-submission"))).toBe(JSON.stringify({ draftId: "fixture-draft" }));
});
```

- [ ] **Step 2: Add the fixture mode**

`page.tsx` passes `held={revision === "held"}`; `EventIntakeRevisionPreview` and `revisionFixture` take `held`, add `connectorId: "fixture-connector"` to `draft`, and the mutation handler returns `{ outcome: "published", eventId: "fixture-event", eventPath: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" }` for `eventIntakeHeld:publish` before its version check (the held mutation carries no version).

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter web exec playwright test event-held-imports.flow.spec.ts --project=desktop-chromium`
Expected: FAIL (command is `eventIntake:publishEventIntake`).

- [ ] **Step 4: Branch the publish handler**

When `loaded?.connectorId` is set, after `saveFields` call `useMutation(api.eventIntakeHeld.publish)` with `{ draftId: current.draftId }` and return `{ kind: "published", eventId, eventPath }`; do not set `published.current` and do not call `getOwnContributedEvent` (the event is a community listing, not the viewer's contribution). Everything else in the wizard is unchanged.

- [ ] **Step 5: Run the test and the existing contribution flows**

Run: `pnpm --filter web exec playwright test event-held-imports.flow.spec.ts event-contribution.flow.spec.ts --project=desktop-chromium` and `pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/events/event-intake-form.tsx apps/web/src/app/playwright/event-intake/page.tsx apps/web/src/app/playwright/event-intake/revision-preview.tsx apps/web/e2e/event-held-imports.flow.spec.ts
git commit -m "feat(events): publish connector drafts from the editor through the held path" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: "From Discord" section in My events

**Files:**

- Create: `apps/web/src/app/account/events/held-imports-section.tsx`
- Modify: `apps/web/src/app/account/events/managed-events-panel.tsx` (`ManagedEventsPanel`), `apps/web/src/app/account/events/event-inventory-list.tsx` (extract the schedule cell)
- Modify: `apps/web/src/app/playwright/event-inventory/page.tsx`, `apps/web/src/app/playwright/event-inventory/preview.tsx`
- Modify: `docs/engineering/event-contribution-browser.md` (`## My events inventory and continuation`)
- Test: `apps/web/e2e/event-held-imports.flow.spec.ts`

**Interfaces:**

- Consumes: `api.eventInventory.listHeldImports` and `HeldImportRow` (Task 2) via `FunctionReturnType`; `api.eventIntakeHeld.publish`, `dismiss`, `dismissFlag` (Task 3); `TableFrame`, `Table`, `TableHead`, `TableHeaderCell`, `TableCell` from `@/components/ui/table`; `Button`, `buttonVariants`; `Notice`; `ViewerLocalEventDateTime`; `formatCalendarDate`.
- Produces: `HeldImportsSection(): JSX.Element | null`; `InventoryScheduleText({ schedule }: { schedule: EventInventoryRow["schedule"] })` exported from `event-inventory-list.tsx` (the three-way render now inline in `InventoryRow`); fixture mode `/playwright/event-inventory?held=1`.

- [ ] **Step 1: Write the failing tests** (append to `apps/web/e2e/event-held-imports.flow.spec.ts`)

```ts
test.describe("From Discord @flow @fixture", () => {
  test("lists held imports above My events and sends each action", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=1");
    const section = page.getByRole("region", { name: "From Discord" });
    await expect(section).toBeVisible();
    expect(await page.evaluate(() => {
      const held = document.querySelector('[aria-labelledby="held-imports-heading"]');
      const list = document.querySelector('ul[aria-label="My events"]');
      return Boolean(held && list && held.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(section.getByRole("columnheader")).toHaveText(["Title", "Date", "Community", "Channel", "Author", "Source", "Actions"]);
    const fresh = section.getByRole("row", { name: /Afterglow Social/ });
    await expect(fresh.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/events/new?draft=held-new");
    await expect(fresh.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333");
    await expect(fresh.getByRole("cell", { name: "#events" })).toBeVisible();
    await expect(fresh.getByRole("cell", { name: "Promoter" })).toBeVisible();
    const update = section.getByRole("row", { name: /Update to Harbor Night/ });
    await expect(update.getByRole("listitem")).toHaveCount(1);
    await expect(update.getByRole("listitem")).toContainText("Starts");
    const flag = section.getByRole("row", { name: /Pier Night/ });
    await expect(flag.getByText("Discord post deleted", { exact: true })).toBeVisible();
    await expect(flag.getByRole("link", { name: "Pier Night" })).toHaveAttribute("href", "/afterglow/events/pier/edit");
    for (const [row, action, call] of [
      [fresh, "Publish", ["eventIntakeHeld:publish", { draftId: "held-new" }]],
      [update, "Dismiss", ["eventIntakeHeld:dismiss", { draftId: "held-update" }]],
      [flag, "Keep", ["eventIntakeHeld:dismissFlag", { eventId: "flag-1" }]],
    ] as const) {
      await row.getByRole("button", { name: action, exact: true }).click();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("held-command"))).toBe(JSON.stringify(call));
    }
    await expect(section).toHaveCount(0);
  });

  test("is absent when nothing is held", async ({ page }) => {
    await page.goto("/playwright/event-inventory");
    await expect(page.getByRole("heading", { name: "My events", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "From Discord" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Add the fixture mode**

`page.tsx` reads `held` and passes `held={params.held === "1"}`. In `preview.tsx`, `watchQuery` answers `eventInventory:listHeldImports` with the three rows below when `held` is on and `[]` otherwise; a new `mutation(fn, args)` on the client records `JSON.stringify([getFunctionName(fn), args])` under `sessionStorage["held-command"]`, removes the matching row (by `draftId` or `eventId`), and notifies listeners. Cast the string IDs below to `Id<...>` the way the fixture's existing `eventId(...)` helper does.

```ts
const heldRows: HeldImportRow[] = [
  { kind: "new", draftId: "held-new", title: "Afterglow Social", schedule: { kind: "date_only", eventDate: "2099-07-20" }, community, connectorKind: "discord_announcements", targetName: "#events", author: "Promoter", sourceUrl: "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333", openHref: "/events/new?draft=held-new", updatedAt: 3 },
  { kind: "update", draftId: "held-update", title: "Harbor Night", schedule: { kind: "timed", startAt: Date.UTC(2099, 6, 15, 21), endAt: null, eventDate: "2099-07-15", timezone: "UTC" }, community, connectorKind: "discord_announcements", targetName: "#events", author: "Promoter", sourceUrl: "https://discord.com/channels/111111111111111111/222222222222222222/444444444444444444", openHref: "/events/new?draft=held-update", updatedAt: 2, target: { slug: "harbor", title: "Harbor Night", href: "/afterglow/events/harbor/edit" }, changes: [{ field: "start", before: Date.UTC(2099, 6, 15, 20), after: Date.UTC(2099, 6, 15, 21) }] },
  { kind: "flag", eventId: "flag-1", reason: "source_deleted", title: "Pier Night", community, connectorKind: "discord_announcements", targetName: "#events", href: "/afterglow/events/pier/edit", updatedAt: 1 },
];
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter web exec playwright test event-held-imports.flow.spec.ts --project=desktop-chromium`
Expected: FAIL (no region named `From Discord`).

- [ ] **Step 4: Implement `HeldImportsSection` and mount it**

- `ManagedEventsPanel` renders `<HeldImportsSection />` immediately before `<ConnectedInventory />` in the signed-in branch. The section returns `null` while loading or when the query returns no rows.
- Markup: `<section aria-labelledby="held-imports-heading">` with `<h3 id="held-imports-heading" className="text-lg font-semibold">From Discord</h3>`, then `TableFrame` > `Table` with the seven column headers (`Actions` header text is visible; no `sr-only` trick).
- New and update rows: Title cell is the title (`Update to {target.title}` for updates, with the target title linked to `target.href`, followed by a `<ul>` of changes as `{label}: {before} → {after}`; instants through `ViewerLocalEventDateTime`, dates through `formatCalendarDate`, null as an empty side); Date cell `InventoryScheduleText`; Community `displayName`; Channel `targetName`; Author `author`; Source a link labelled `Source` opening `sourceUrl` with `rel="noreferrer" target="_blank"` (empty cell when null); Actions `Open` (link, `buttonVariants({ variant: "secondary", size: "sm" })`), `Publish` (`Button size="sm"`), `Dismiss` (`Button variant="ghost" size="sm"`).
- Flag rows: Title cell is the event title linked to `href`; one cell spanning Date to Source with `Discord post deleted` or `Deleted at the source`; Actions `Keep`.
- Change labels: `title` Event title, `eventDate` Date, `timeTba` Time TBA, `timezone` Time zone, `start` Starts, `end` Ends, `doors` Doors, `venueLabel` Where, `worldSlug` World, `summary` Description, `sourceUrl` Source URL, `lineup` Lineup.
- Each action button is disabled while its call is in flight; a failure shows `<Notice role="alert" variant="error">Unable to publish.</Notice>` (publish) under the table and leaves the row. No badges; radii come from the primitives.

- [ ] **Step 5: Run the tests and the existing inventory flows**

Run: `pnpm --filter web exec playwright test event-held-imports.flow.spec.ts event-inventory.flow.spec.ts event-inventory-checkpoint.flow.spec.ts --project=desktop-chromium` and `pnpm typecheck:web && pnpm lint:web`
Expected: PASS.

- [ ] **Step 6: Document the workspace behaviour**

Append to `## My events inventory and continuation` in `docs/engineering/event-contribution-browser.md`: the section's place above the inventory and its source query; who sees rows (`manage_events` on the connector's community, the authority only through that right); Open uses the existing editor and publishes through `eventIntakeHeld.publish`; connector drafts never appear as creator intake rows and do not count toward the 20-draft quota; Publish, Dismiss, and Keep semantics in one sentence each, linking to `../backend/event-schema.md#held-imports`. Run `pnpm exec markdownlint-cli2 docs/engineering/event-contribution-browser.md`; expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/account/events/held-imports-section.tsx apps/web/src/app/account/events/managed-events-panel.tsx apps/web/src/app/account/events/event-inventory-list.tsx apps/web/src/app/playwright/event-inventory/page.tsx apps/web/src/app/playwright/event-inventory/preview.tsx apps/web/e2e/event-held-imports.flow.spec.ts docs/engineering/event-contribution-browser.md
git commit -m "feat(web): add From Discord section to My events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Visual verification

**Files:**

- Create: `apps/web/e2e/event-held-imports.visual.spec.ts`

**Interfaces:**

- Consumes: `/playwright/event-inventory?held=1` (Task 5); `prepareVisualPage` and `captureRouteScreenshot(page, testInfo, name)` from `apps/web/e2e/public-routes.ts`.
- Produces: `desktop-chromium-my-events-held-imports.png` and `mobile-chromium-my-events-held-imports.png` in the visual capture directory.

- [ ] **Step 1: Write the capture**

```ts
import { expect, test } from "@playwright/test";
import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test("My events with one new draft, one proposed update, and one flagged event @visual", async ({ page }, testInfo) => {
  await prepareVisualPage(page);
  await page.goto("/playwright/event-inventory?held=1");
  const section = page.getByRole("region", { name: "From Discord" });
  await expect(section.getByRole("row")).toHaveCount(4);
  await expect(section.getByText("Update to", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await captureRouteScreenshot(page, testInfo, "my-events-held-imports");
});
```

- [ ] **Step 2: Run it on both projects**

Run: `pnpm --filter web exec playwright test event-held-imports.visual.spec.ts --project=desktop-chromium --project=mobile-chromium`
Expected: PASS, two PNGs written.

- [ ] **Step 3: Review the screenshots**

Open both PNGs and check, writing the result into the PR: the section sits above the My events list; the table scrolls inside its frame on mobile, never the page; no pill or badge shapes; status text is plain; copy matches the Global Constraints list exactly, with no em-dash. Fix and re-run until every check holds. On the PR, add the `ci:visuals` label so the CI capture is the evidence of record (local font rendering differs).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/event-held-imports.visual.spec.ts
git commit -m "test(web): capture From Discord visual evidence" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The PR description lists every public string from the Global Constraints, marks `Keep`, `Discord post deleted`, `Deleted at the source`, and `Unable to publish.` as awaiting BASIC's approval, asks for a heading that also fits non-Discord imports, and attaches the two screenshots.
