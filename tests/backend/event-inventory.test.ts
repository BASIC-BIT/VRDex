import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionArgs, type PaginationOptions, type PaginationResult } from "convex/server";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
import type { InventoryRow } from "../../convex/_eventInventory";
import { listPage } from "../../convex/eventInventory";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const list = makeFunctionReference<"query", { view: "all" | "upcoming" | "drafts" | "past"; query: string; timeZone: string; asOf: number; paginationOpts: PaginationOptions }, PaginationResult<InventoryRow>>("eventInventory:listPage");
const save = makeFunctionReference<"mutation">("eventIntake:saveEventIntakeDraft");
const criteria = { view: "all" as const, query: "", timeZone: "UTC", asOf: Date.parse("2026-10-22T12:00:00Z") };
async function fixture() {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventInventory.ts": () => import("../../convex/eventInventory"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/events.ts": () => import("../../convex/events"),
  } });
  const ids = await t.run(async ({ db }) => {
    const owner = await db.insert("users", { clerkUserId: "owner" });
    const staff = await db.insert("users", { clerkUserId: "staff" });
    const contributor = await db.insert("users", { clerkUserId: "contributor" });
    const other = await db.insert("users", { clerkUserId: "other" });
    const community = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    const ownership = await db.insert("profileOwners", { profileId: community, userId: owner, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    const authority = await db.insert("communityAuthorities", { communityProfileId: community, subject: { subject: "staff", issuer: "test", tokenIdentifier: "test|staff" }, subjectTokenIdentifier: "test|staff", roleLabel: "Staff", capabilities: ["manage_events"], state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    return { owner, staff, contributor, other, community, ownership, authority };
  });
  const actor = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}` });
  let sequence = 0;
  const event = (patch: Partial<Doc<"events">> = {}) => t.run(({ db }) => db.insert("events", { communityProfileId: ids.community, title: "Night", sortTitle: "night", slug: `night-${sequence++}`, scheduleKind: "date_only", eventDate: "2026-10-23", sortAt: Date.parse("2026-10-23"), publicationState: "published", eventStatus: "scheduled", sourceType: "contributor", sourceLabel: "Community-submitted", contributorUserId: ids.contributor, updatedAt: Date.now(), ...patch }));
  return { t, ids, actor, event };
}
type Actor = ReturnType<Awaited<ReturnType<typeof fixture>>["actor"]>;
async function traverse(actor: Actor, filters: Partial<Omit<FunctionArgs<typeof list>, "paginationOpts">> = {}, size = 13) {
  const rows: InventoryRow[] = [];
  const pages: PaginationResult<InventoryRow>[] = [];
  let cursor: string | null = null;
  for (let calls = 0; calls < 100; calls++) {
    const page: PaginationResult<InventoryRow> = await actor.query(list, { ...criteria, ...filters, paginationOpts: { cursor, numItems: size } });
    rows.push(...page.page); pages.push(page);
    if (page.isDone) return { rows, pages };
    assert.notEqual(page.continueCursor, cursor);
    cursor = page.continueCursor;
  }
  throw new Error("Inventory did not terminate");
}

it("traverses more than 100 managed events with equal timestamps and no duplicates", async () => {
  const { actor, event } = await fixture();
  for (let n = 0; n < 117; n++) await event({ title: `Night ${n}` });
  const { rows, pages } = await traverse(actor("owner"));
  assert.equal(rows.length, 117);
  assert.equal(new Set(rows.map(row => row.id)).size, 117);
  assert.ok(rows.every(row => row.kind === "managed_event" && row.continuation.kind === "staff_editor"));
  assert.equal(pages[0].page.length, 0);
  assert.ok(pages.length > 9);
});
it("isolates private drafts, preserves expiry and omits source evidence and receipts", async () => {
  const { actor, t, ids, event } = await fixture();
  const mine = actor("contributor"), other = actor("other");
  const saved = await mine.mutation(save, { patch: { title: "My work", sourceText: "PRIVATE SOURCE", evidence: [{ fieldPath: "title", origin: "text", excerpt: "PRIVATE", assessment: "explicit" }], posterDeclaration: { contentType: "image/png", byteLength: 50, sha256: "a".repeat(64) } } });
  await other.mutation(save, { patch: { title: "Other work" } });
  const expired = await mine.mutation(save, { patch: { title: "Expired" } });
  const published = await mine.mutation(save, { patch: { title: "Published source" } });
  const eventId = await event();
  await t.run(async ({ db }) => {
    await db.patch(expired.draftId, { expiresAt: Date.now() - 1 });
    const receipt = await db.insert("eventContributionReceipts", { actorUserId: ids.contributor, draftId: published.draftId, draftVersion: 1, eventId, eventPath: "/club/events/night", communityProfileId: ids.community, fingerprint: "receipt", createdAt: Date.now() });
    await db.patch(published.draftId, { publishedReceiptId: receipt });
  });
  const before = await t.run(({ db }) => db.get(saved.draftId));
  const { rows } = await traverse(mine, { asOf: 0 });
  const drafts = rows.filter(row => row.kind === "intake_draft");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, saved.draftId);
  assert.equal(drafts[0].expiresAt, before.expiresAt);
  assert.equal(drafts[0].version, 1);
  assert.equal(drafts[0].thumbnailUrl, null);
  assert.equal(drafts[0].continuation.kind, "intake_editor");
  assert.ok(!JSON.stringify(rows).includes("PRIVATE"));
  assert.deepEqual(await t.run(({ db }) => db.get(saved.draftId)), before);
  assert.equal((await traverse(actor("owner"))).rows.filter(row => row.kind === "intake_draft").length, 0);
  assert.equal((await traverse(other)).rows.length, 1);
});
it("matches later pages and current community names through empty candidate pages", async () => {
  const { actor, event, t, ids } = await fixture();
  await event({ title: "Unique match", sortAt: 1 });
  for (let n = 0; n < 25; n++) await event();
  const result = await traverse(actor("owner"), { query: " UNIQUE MATCH " }, 5);
  assert.equal(result.rows.length, 1);
  assert.ok(result.pages.filter(page => page.page.length === 0).length > 3);
  await t.run(({ db }) => db.patch(ids.community, { displayName: "Renamed Club" }));
  assert.equal((await traverse(actor("owner"), { query: "renamed" })).rows.length, 26);
});
it("requires a session and invalidates cursors across actors, filters and revoked sources", async () => {
  const { t, actor, event, ids } = await fixture();
  await event();
  await assert.rejects(t.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } }), /signed-in/);
  const first = await actor("owner").query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } });
  for (const [who, extra] of [["other", {}], ["owner", { query: "different" }], ["owner", { timeZone: "America/New_York" }], ["owner", { asOf: 0 }]] as const) {
    await assert.rejects(actor(who).query(list, { ...criteria, ...extra, paginationOpts: { cursor: first.continueCursor, numItems: 5 } }), /InvalidCursor/);
  }
  await t.run(({ db }) => db.delete(ids.ownership));
  await assert.rejects(actor("owner").query(list, { ...criteria, paginationOpts: { cursor: first.continueCursor, numItems: 5 } }), /InvalidCursor/);
  const staffPage = await actor("staff").query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } });
  await t.run(({ db }) => db.patch(ids.authority, { capabilities: [] }));
  await assert.rejects(actor("staff").query(list, { ...criteria, paginationOpts: { cursor: staffPage.continueCursor, numItems: 5 } }), /InvalidCursor/);
  assert.equal((await traverse(actor("staff"))).rows.length, 0);
});
it("preserves terminal native cursors when replaying and splitting source-boundary pages", async () => {
  const { actor, event } = await fixture();
  for (let n = 0; n < 9; n++) await event();
  const owner = actor("owner");
  const first = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 20 } });
  const managed = await owner.query(list, { ...criteria, paginationOpts: { cursor: first.continueCursor, numItems: 20 } });
  assert.equal(managed.page.length, 9);
  assert.equal(managed.isDone, false);
  const replay = await owner.query(list, { ...criteria, paginationOpts: { cursor: first.continueCursor, endCursor: managed.continueCursor, numItems: 2 } });
  assert.deepEqual(replay.page, managed.page);
  assert.ok(replay.splitCursor);
  const left = await owner.query(list, { ...criteria, paginationOpts: { cursor: first.continueCursor, endCursor: replay.splitCursor, numItems: 2 } });
  const right = await owner.query(list, { ...criteria, paginationOpts: { cursor: replay.splitCursor, endCursor: managed.continueCursor, numItems: 2 } });
  assert.deepEqual([...left.page, ...right.page], managed.page);
  const emptyReplay = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, endCursor: first.continueCursor, numItems: 2 } });
  assert.equal(emptyReplay.page.length, 0);
  assert.equal(emptyReplay.continueCursor, first.continueCursor);
  await assert.rejects(owner.query(list, { ...criteria, paginationOpts: { cursor: null, endCursor: managed.continueCursor, numItems: 2 } }), /InvalidCursor/);
});
it("fails explicitly if owner authority discovery cannot be complete", async () => {
  const { t, ids, actor } = await fixture();
  await t.run(async ({ db }) => {
    for (let n = 0; n < 100; n++) await db.insert("profileOwners", { profileId: ids.community, userId: ids.owner, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  await assert.rejects(traverse(actor("owner")), /inventory requires pagination/i);
});
it("deduplicates managed contributions and preserves correction, cancellation and retraction policy", async () => {
  const { actor, event, ids } = await fixture();
  await event({ contributorUserId: ids.owner });
  await event({ title: "Open" });
  await event({ title: "Taken over", contributorEditsClosedAt: Date.now() });
  await event({ title: "Cancelled", eventStatus: "cancelled" });
  await event({ title: "Retracted", publicationState: "draft_private" });
  await event({ title: "Removed", moderationRemovedAt: Date.now(), publicationState: "draft_private" });
  const managed = (await traverse(actor("owner"))).rows;
  assert.equal(managed.length, 6);
  assert.ok(managed.every(row => row.kind === "managed_event"));
  const own = (await traverse(actor("contributor"))).rows;
  assert.equal(own.length, 5);
  const open = own.find(row => row.title === "Open")?.continuation;
  assert.equal(open?.kind, "public_event");
  if (open?.kind === "public_event") { assert.equal(open.canCorrect, true); assert.equal(open.canSuggest, false); }
  for (const title of ["Taken over", "Cancelled"]) {
    const next = own.find(row => row.title === title)?.continuation;
    assert.equal(next?.kind, "public_event");
    if (next?.kind === "public_event") { assert.equal(next.canCorrect, false); assert.equal(next.canSuggest, true); }
  }
  assert.equal(own.find(row => row.title === "Retracted")?.state, "retracted");
  assert.equal(own.find(row => row.title === "Retracted")?.continuation.kind, "unavailable");
  assert.equal((await traverse(actor("contributor"), { view: "drafts" })).rows.length, 0);
  assert.equal((await traverse(actor("contributor"), { view: "upcoming" })).rows.length, 2);
});
it("classifies undated, date-only, unknown-end and overnight schedules without inventing ends", async () => {
  const { actor, event } = await fixture();
  await event({ title: "Unknown end", scheduleKind: "timed", startAt: criteria.asOf - 5 * 3_600_000 });
  await event({ title: "Completed", scheduleKind: "timed", startAt: criteria.asOf - 7 * 3_600_000 });
  await event({ title: "Overnight", scheduleKind: "timed", startAt: criteria.asOf - 12 * 3_600_000, endAt: criteria.asOf + 3_600_000 });
  await event({ title: "Date today", eventDate: "2026-10-22" });
  await event({ title: "Date past", eventDate: "2026-10-21" });
  await actor("owner").mutation(save, { patch: { title: "Undated" } });
  const upcoming = (await traverse(actor("owner"), { view: "upcoming" })).rows;
  assert.deepEqual(upcoming.map(row => row.title).sort(), ["Date today", "Overnight", "Unknown end"]);
  const unknown = upcoming.find(row => row.title === "Unknown end");
  assert.equal(unknown?.schedule.kind, "timed");
  if (unknown?.schedule.kind === "timed") assert.equal(unknown.schedule.endAt, null);
  assert.deepEqual((await traverse(actor("owner"), { view: "past" })).rows.map(row => row.title).sort(), ["Completed", "Date past"]);
  assert.equal((await traverse(actor("owner"), { view: "drafts" })).rows[0]?.title, "Undated");
  assert.equal((await traverse(actor("owner"), { view: "past", timeZone: "Pacific/Kiritimati", asOf: Date.parse("2026-10-22T23:00:00Z") })).rows.filter(row => row.schedule.kind === "date_only").length, 2);
});
it("keeps ambiguous and nonexistent intake clocks incomplete and resolves explicit DST choices", async () => {
  const { actor } = await fixture();
  const owner = actor("owner");
  const patches = [
    { title: "Ambiguous", eventDate: "2026-11-01", start: { time: "01:30" } },
    { title: "Fall resolved", eventDate: "2026-11-01", start: { time: "01:30", occurrence: "later" } },
    { title: "Spring gap", eventDate: "2026-03-08", start: { time: "02:30" } },
    { title: "Spring resolved", eventDate: "2026-03-08", start: { time: "01:30" }, end: { time: "03:30" } },
    { title: "Date only", eventDate: "2026-11-01", timeTba: true },
    { title: "Date without clock", eventDate: "2026-11-01" },
  ];
  for (const patch of patches) await owner.mutation(save, { patch: { ...patch, timezone: "America/New_York" } });
  const { rows } = await traverse(owner);
  for (const title of ["Ambiguous", "Spring gap", "Date without clock"]) assert.equal(rows.find(row => row.title === title)?.schedule.kind, "incomplete");
  const fall = rows.find(row => row.title === "Fall resolved")?.schedule;
  assert.equal(fall?.kind, "timed");
  if (fall?.kind === "timed") assert.equal(fall.startAt, Date.parse("2026-11-01T06:30:00Z"));
  const spring = rows.find(row => row.title === "Spring resolved")?.schedule;
  assert.equal(spring?.kind, "timed");
  if (spring?.kind === "timed") assert.equal(spring.endAt! - spring.startAt, 3_600_000);
  assert.deepEqual((await traverse(owner, { view: "upcoming" })).rows.map(row => row.title).sort(), ["Date only", "Fall resolved"]);
});
it("omits unavailable public routes and unsafe or private artwork", async () => {
  const { actor, event, t, ids } = await fixture();
  await event({ title: "No route", slug: undefined, posterImageUrl: "/api/private/poster" });
  await event({ title: "Unsafe", thumbnailImageUrl: "javascript:alert(1)" });
  await event({ title: "Safe", posterImageUrl: "https://example.com/poster.png" });
  const rows = (await traverse(actor("contributor"))).rows;
  assert.equal(rows.find(row => row.title === "No route")?.continuation.kind, "unavailable");
  assert.equal(rows.find(row => row.title === "No route")?.thumbnailUrl, null);
  assert.equal(rows.find(row => row.title === "Unsafe")?.thumbnailUrl, null);
  assert.equal(rows.find(row => row.title === "Safe")?.thumbnailUrl, "https://example.com/poster.png");
  await t.run(({ db }) => db.patch(ids.community, { publicationState: "draft_private" }));
  assert.ok((await traverse(actor("contributor"))).rows.every(row => row.continuation.kind === "unavailable" && row.community === null));
  assert.equal((await traverse(actor("owner"))).rows.length, 3);
});
it("rejects invalid criteria and enforces bounded native candidate scans", async () => {
  const { actor, event } = await fixture();
  const owner = actor("owner");
  for (const extra of [{ timeZone: "No/Such_Zone" }, { timeZone: "+02:00" }, { asOf: -1 }, { asOf: 1.5 }, { asOf: Number.MAX_SAFE_INTEGER }, { query: "x".repeat(121) }]) {
    await assert.rejects(owner.query(list, { ...criteria, ...extra, paginationOpts: { cursor: null, numItems: 5 } }));
  }
  for (const numItems of [0, 101, 1.5]) await assert.rejects(owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems } }));
  for (let n = 0; n < 10; n++) await event();
  const start = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } });
  const bounded = await owner.query(list, { ...criteria, paginationOpts: { cursor: start.continueCursor, numItems: 100, maximumRowsRead: 3 } });
  assert.equal(bounded.page.length, 3);
  assert.equal(bounded.pageStatus, "SplitRequired");
  assert.ok(bounded.splitCursor);
});
it("retains own contributions with unavailable communities instead of deduplicating into a missing source", async () => {
  const { actor, event, t, ids } = await fixture();
  await event({ contributorUserId: ids.owner });
  await t.run(({ db }) => db.delete(ids.community));
  const { rows } = await traverse(actor("owner"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "own_contribution");
  assert.equal(rows[0].continuation.kind, "unavailable");
  assert.equal(rows[0].community, null);
});
it("rejects foreign source IDs even when the cursor otherwise has the actor's current scope", async () => {
  const { actor, event } = await fixture();
  await event();
  const owner = actor("owner");
  const page = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } });
  const cursor: unknown = JSON.parse(page.continueCursor);
  assert.ok(typeof cursor === "object" && cursor !== null);
  for (const forged of [{ ...cursor, source: "community:foreign-id" }, { ...cursor, version: 2 }, { ...cursor, nativeCursor: null }]) {
    await assert.rejects(owner.query(list, { ...criteria, paginationOpts: { cursor: JSON.stringify(forged), numItems: 5 } }), /InvalidCursor/);
  }
});
it("reactively replays exhausted intake and event sources without crossing their terminal boundaries", async () => {
  const { actor, event } = await fixture();
  const owner = actor("owner");
  const intake = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 10 } });
  const managed = await owner.query(list, { ...criteria, paginationOpts: { cursor: intake.continueCursor, numItems: 10 } });
  assert.equal(managed.page.length, 0);
  await owner.mutation(save, { patch: { title: "New draft" } });
  await event({ title: "New event" });
  const replayIntake = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, endCursor: intake.continueCursor, numItems: 10 } });
  assert.deepEqual(replayIntake.page.map(row => row.title), ["New draft"]);
  const replayManaged = await owner.query(list, { ...criteria, paginationOpts: { cursor: intake.continueCursor, endCursor: managed.continueCursor, numItems: 10 } });
  assert.deepEqual(replayManaged.page.map(row => row.title), ["New event"]);
  const final = await owner.query(list, { ...criteria, paginationOpts: { cursor: managed.continueCursor, numItems: 10 } });
  assert.equal(final.isDone, true);
  const finalReplay = await owner.query(list, { ...criteria, paginationOpts: { cursor: managed.continueCursor, endCursor: final.continueCursor, numItems: 10 } });
  assert.equal(finalReplay.isDone, true);
  assert.deepEqual(finalReplay.page, []);
});
it("traverses both rollout indexes and binds continuations to the selected index", async () => {
  const { actor, event } = await fixture();
  process.env.EVENT_DATE_ONLY_ENABLED = "false";
  await event({ title: "Legacy", scheduleKind: undefined, eventDate: undefined, sortAt: undefined, startAt: criteria.asOf });
  const owner = actor("owner");
  assert.equal((await traverse(owner)).rows.length, 1);
  const page = await owner.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 5 } });
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  await assert.rejects(owner.query(list, { ...criteria, paginationOpts: { cursor: page.continueCursor, numItems: 5 } }), /InvalidCursor/);
});
it("keeps canonical staff drafts and creator intake drafts distinct in Drafts", async () => {
  const { actor, event } = await fixture();
  const canonical = await event({ title: "Staff draft", sourceType: "manual", contributorUserId: undefined, publicationState: "draft_private", scheduleKind: undefined, eventDate: undefined, sortAt: undefined });
  const draft = await actor("owner").mutation(save, { patch: { title: "Intake draft" } });
  const { rows } = await traverse(actor("owner"), { view: "drafts" });
  assert.deepEqual(rows.map(row => row.id), [draft.draftId, canonical]);
  assert.equal(rows[0].kind, "intake_draft");
  assert.equal(rows[0].continuation.kind, "intake_editor");
  assert.equal(rows[1].kind, "managed_event");
  assert.equal(rows[1].continuation.kind, "staff_editor");
  assert.equal(rows[1].schedule.kind, "incomplete");
  assert.ok(!("expiresAt" in rows[1]));
});
it("orders managed community sources by identity between intake and own contributions", async () => {
  const { actor, event, t, ids } = await fixture();
  const second = await t.run(async ({ db }) => {
    const profile = await db.get(ids.community);
    assert.ok(profile);
    const { _id, _creationTime, ...fields } = profile;
    const id = await db.insert("profiles", { ...fields, slug: "second", displayName: "AAA Second" });
    await db.insert("profileOwners", { profileId: id, userId: ids.owner, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    return id;
  });
  await event({ title: "Club event" });
  await event({ title: "Second event", communityProfileId: second });
  await event({ title: "Own event", communityProfileId: undefined, contributorUserId: ids.owner });
  await actor("owner").mutation(save, { patch: { title: "First draft" } });
  const expected = ids.community < second ? ["Club event", "Second event"] : ["Second event", "Club event"];
  assert.deepEqual((await traverse(actor("owner"))).rows.map(row => row.title), ["First draft", ...expected, "Own event"]);
});
it("accepts normalized criteria and keeps intake community matching current after a rename", async () => {
  const { actor, event, t, ids } = await fixture();
  const owner = actor("owner");
  await owner.mutation(save, { patch: { title: "Draft", communitySlug: "club" } });
  await event();
  await t.run(({ db }) => db.patch(ids.community, { displayName: "Renamed Club" }));
  const first = await owner.query(list, { ...criteria, query: " RENAMED   CLUB ", paginationOpts: { cursor: null, numItems: 5 } });
  assert.equal(first.page.length, 1);
  assert.equal(first.page[0].community?.displayName, "Renamed Club");
  const next = await owner.query(list, { ...criteria, query: "renamed club", paginationOpts: { cursor: first.continueCursor, numItems: 5 } });
  assert.equal(next.page.length, 1);
});

for (const who of ["owner", "staff"] as const) it(`checks ${who} authority once per community per inventory invocation`, async context => {
  const { actor, event, t, ids } = await fixture();
  const viewer = actor(who);
  const roleId = who === "staff" ? await t.run(async ({ db }) => {
    const role = await db.insert("communityRoles", { communityProfileId: ids.community,
      key: "event-staff", label: "Event staff", permissions: ["manage_events"],
      assignableRoleIds: [], state: "active", createdAt: Date.now(), updatedAt: Date.now() });
    await db.patch(ids.authority, { roleId: role, capabilities: undefined });
    return role;
  }) : null;
  for (let n = 0; n < 6; n++) await event({ contributorUserId: ids[who] });
  const first = await viewer.query(list, { ...criteria, paginationOpts: { cursor: null, numItems: 20 } });
  const measuredPage = (cursor: string) => viewer.query(async ctx => {
    // Spies forward every read to the real convex-test database and authorizers.
    const query = context.mock.method(ctx.db, "query");
    const get = context.mock.method(ctx.db, "get");
    const result = await listPage._handler(ctx, { ...criteria, paginationOpts: { cursor, numItems: 20 } });
    assert.equal(query.mock.calls.filter(call => call.arguments[0] === "profileOwners").length, 2,
      "one source-discovery lookup plus one current ownership lookup, regardless of candidate count");
    if (roleId) assert.equal(get.mock.calls.filter(call => call.arguments[0] === roleId).length, 2,
      "one discovery role read plus one current authorizer role read");
    return result;
  });
  const managed = await measuredPage(first.continueCursor);
  assert.equal(managed.page.length, 6);
  assert.ok(managed.page.every(row => row.continuation.kind === "staff_editor"));
  assert.deepEqual((await measuredPage(first.continueCursor)).page, managed.page,
    "another invocation must perform the same fresh authority reads");
  assert.deepEqual((await measuredPage(managed.continueCursor)).page, [],
    "own contributions are deduplicated after one current authority check");
  if (roleId) await t.run(({ db }) => db.patch(roleId, { permissions: [] }));
  else await t.run(({ db }) => db.delete(ids.ownership));
  await assert.rejects(viewer.query(list, { ...criteria,
    paginationOpts: { cursor: first.continueCursor, numItems: 20 } }), /InvalidCursor/);
  const fresh = (await traverse(viewer)).rows;
  assert.equal(fresh.length, 6);
  assert.ok(fresh.every(row => row.kind === "own_contribution" && row.continuation.kind === "public_event"));
});

it("checks each managed community separately while deduplicating one contribution page", async context => {
  const { actor, event, t, ids } = await fixture();
  const second = await t.run(async ({ db }) => {
    const profile = await db.get(ids.community);
    assert.ok(profile);
    const { _id, _creationTime, ...fields } = profile;
    const community = await db.insert("profiles", { ...fields, slug: "second-club" });
    await db.insert("profileOwners", { profileId: community, userId: ids.owner,
      roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    return community;
  });
  for (const communityProfileId of [ids.community, second]) {
    for (let n = 0; n < 4; n++) await event({ communityProfileId, contributorUserId: ids.owner });
  }
  const viewer = actor("owner");
  let cursor: string | null = null;
  for (let source = 0; source < 3; source++) {
    const page = await viewer.query(list, { ...criteria, paginationOpts: { cursor, numItems: 20 } });
    cursor = page.continueCursor;
  }
  await viewer.query(async ctx => {
    const query = context.mock.method(ctx.db, "query");
    const result = await listPage._handler(ctx, { ...criteria, paginationOpts: { cursor, numItems: 20 } });
    assert.deepEqual(result.page, []);
    assert.equal(result.isDone, true);
    assert.equal(query.mock.calls.filter(call => call.arguments[0] === "profileOwners").length, 3,
      "one source-discovery lookup plus one current ownership lookup for each community");
  });
});
