import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
import type { TimelineEvent, TimelineRange, PlanReference } from "../../convex/_eventTimelineTypes";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/eventTimeline.ts": () => import("../../convex/eventTimeline"),
};
const list = api.eventTimeline.listPublic;
const roster = api.eventTimeline.listPublicRoster;
const resolve = api.eventTimeline.resolveSaved;
const hour = 3_600_000;
const startAt = Date.UTC(2026, 9, 26);
const range = { startAt, endAt: startAt + 48 * hour, timeZone: "UTC" };
const eventBase = { slug: "night", title: "Night", sortTitle: "night", startAt, endAt: startAt + hour, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 } satisfies Omit<Doc<"events">, "_id" | "_creationTime">;
const personBase = { slug: "dj", displayName: "DJ", sortName: "dj", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self", publicationState: "published", publicSurfacingState: "public", updatedAt: 1 } satisfies Omit<Doc<"profiles">, "_id" | "_creationTime">;
const slotBase = { position: 0, startAt, endAt: startAt + hour, displayLabel: "Authored Guest", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: 1 } satisfies Omit<Doc<"eventSlots">, "_id" | "_creationTime" | "eventId">;
function setup() { return convexTest({ schema, modules }); }
async function all(t: ReturnType<typeof setup>, selectedRange = range, limit = 8, loadRosters = true) {
  const items: TimelineEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await t.query(list, { range: selectedRange, limit, ...(cursor === undefined ? {} : { cursor }) });
    assert.ok(result.items.length <= limit);
    if (loadRosters) for (const event of result.items) {
      while (event.rosterCursor !== null) {
        const page = await t.query(roster, { eventId: event.id, range: selectedRange, cursor: event.rosterCursor });
        event.slots.push(...page.items);
        event.performers.push(...page.performers);
        event.rosterCursor = page.cursor;
      }
    }
    items.push(...result.items);
    assert.equal(result.complete, result.cursor === null);
    if (result.complete) { assert.equal(new Set(items.map(item => item.id)).size, items.length); return items; }
    assert.notEqual(result.cursor, cursor);
    cursor = result.cursor ?? undefined;
  }
  assert.fail("Timeline did not finish");
}

it("defers roster pagination to a separate client request", async () => {
  const t = setup();
  const slotId = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    return db.insert("eventSlots", { ...slotBase, eventId });
  });
  const page = await t.query(list, { range });
  const event = page.items[0]!;
  assert.deepEqual(event.slots, []);
  assert.deepEqual(event.performers, []);
  assert.ok(event.rosterCursor);
  const rosterPage = await t.query(roster, { eventId: event.id, range, cursor: event.rosterCursor });
  assert.deepEqual(rosterPage.items.map(slot => slot.id), [slotId]);
});

it("continuesPastHiddenHosts", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const hidden = await db.insert("profiles", { ...personBase, profileType: "community", person: undefined, community: { categoryTags: [] }, slug: "hidden-host", displayName: "SECRET HOST", publicSurfacingState: "suppressed", avatarImageUrl: "https://secret.invalid/host.png" });
    for (let i = 0; i < 51; i++) await db.insert("events", { ...eventBase, slug: `hidden-${i}`, communityProfileId: hidden });
    const eligible = [];
    for (let i = 0; i < 53; i++) eligible.push(await db.insert("events", { ...eventBase, slug: `public-${i}` }));
    return { hidden, eligible };
  });
  const first = await t.query(list, { range, limit: 50 });
  assert.deepEqual(first.items, []);
  assert.equal(first.complete, false);
  const items = await all(t, range, 50);
  assert.deepEqual(items.map(item => item.id).sort(), ids.eligible.sort());
  for (const secret of [ids.hidden, "hidden-host", "SECRET HOST", "https://secret.invalid/host.png"]) assert.ok(!JSON.stringify(items).includes(secret));
});

it("includesEarlierOngoingEvents", async () => {
  const t = setup();
  const expected = await t.run(async ({ db }) => {
    const ids = [];
    for (let i = 0; i < 60; i++) ids.push(await db.insert("events", { ...eventBase, slug: `ongoing-${i}`, startAt: startAt - (24 + i) * hour, endAt: startAt + 1 }));
    ids.push(await db.insert("events", { ...eventBase, slug: "lower-bound" }));
    await db.insert("events", { ...eventBase, slug: "ended", startAt: startAt - hour, endAt: startAt });
    await db.insert("events", { ...eventBase, slug: "upper-bound", startAt: range.endAt, endAt: range.endAt + hour });
    return ids;
  });
  assert.deepEqual((await all(t)).map(item => item.id).sort(), expected.sort());
});

it("doesNotCarryUnknownEndsForward", async () => {
  const t = setup();
  const id = await t.run(async ({ db }) => {
    await db.insert("events", { ...eventBase, slug: "prior", startAt: startAt - 1, endAt: undefined });
    await db.insert("events", { ...eventBase, slug: "upper", startAt: range.endAt, endAt: undefined });
    return db.insert("events", { ...eventBase, slug: "lower", endAt: undefined });
  });
  const items = await all(t);
  assert.deepEqual(items.map(item => item.id), [id]);
  assert.deepEqual(items[0]?.schedule, { kind: "open_end", startAt });
});

it("uses authored dates touched by the half-open viewer interval", async () => {
  const t = setup();
  await t.run(async ({ db }) => {
    for (const date of ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]) await db.insert("events", { ...eventBase, slug: date, scheduleKind: "date_only", eventDate: date, startAt: undefined, endAt: undefined });
  });
  for (const [timeZone, expected] of [
    ["UTC", ["2026-10-26", "2026-10-27"]],
    ["America/Los_Angeles", ["2026-10-25", "2026-10-26", "2026-10-27"]],
    ["Pacific/Kiritimati", ["2026-10-26", "2026-10-27", "2026-10-28"]],
  ] as const) {
    const items = await all(t, { ...range, timeZone });
    assert.deepEqual(items.map(item => item.slug), expected);
    assert.ok(items.every(item => item.schedule.kind === "date_only"));
  }
});

it("continuesAfterEightySlots", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    const slots = [];
    for (let i = 0; i < 163; i++) slots.push(await db.insert("eventSlots", { ...slotBase, eventId, position: i }));
    await db.insert("eventSlots", { ...slotBase, eventId, reviewState: "draft" });
    await db.insert("eventSlots", { ...slotBase, eventId, startAt: startAt - 1, endAt: undefined });
    const performerId = await db.insert("profiles", personBase);
    for (let i = 0; i < 81; i++) await db.insert("eventLineupEntries", { eventId, clientKey: `${i}`, position: i, performerLabel: "Guest", ...(i === 80 ? { personProfileId: performerId } : {}), updatedAt: 1 });
    await db.insert("eventParticipants", { eventId, personProfileId: performerId, eventPublicationState: "published", eventStatus: "scheduled", confirmationState: "confirmed", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1 });
    return { eventId, slots, performerId };
  });
  const event = (await all(t, range, 8, false))[0];
  assert.ok(event);
  assert.equal(event.slots.length, 0);
  assert.deepEqual(event.performers, []);
  const slots = [...event.slots];
  const performers = [...event.performers];
  let cursor = event.rosterCursor;
  for (let page = 0; cursor !== null && page < 10; page++) {
    const result = await t.query(roster, { eventId: ids.eventId, range, cursor });
    if (page === 0) assert.equal(result.items.length, 79); // The prior unknown-end row consumes one candidate.
    assert.ok(result.items.length <= 80);
    assert.equal(result.complete, result.cursor === null);
    slots.push(...result.items); performers.push(...result.performers); cursor = result.cursor;
  }
  assert.equal(cursor, null);
  assert.equal(new Set(slots.map(slot => slot.id)).size, slots.length);
  assert.deepEqual(slots.map(slot => slot.id).sort(), ids.slots.sort());
  assert.deepEqual([...new Set(performers.map(person => person.id))], [ids.performerId]);
});

it("keeps safe manual slot labels while withholding hidden linked identities and worlds", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    const hidden = await db.insert("profiles", { ...personBase, slug: "private-dj", displayName: "SECRET PERSON", publicationState: "draft_private", avatarImageUrl: "https://secret.invalid/person.png" });
    const worldId = await db.insert("worlds", { slug: "private-world", displayName: "SECRET WORLD", sortName: "secret world", tags: [], visibilityStatus: "private", platformCompatibility: [], media: [], creatorAttributions: [], outboundLinks: [], creationSource: "community", publicationState: "draft_private", updatedAt: 1 });
    await db.insert("eventWorlds", { eventId, worldId, eventPublicationState: "published", eventStatus: "scheduled", sourceType: "community", confirmationState: "confirmed", confidence: 1, updatedAt: 1 });
    const slotId = await db.insert("eventSlots", { ...slotBase, eventId, personProfileId: hidden });
    return { eventId, hidden, slotId, worldId };
  });
  const items = await all(t);
  assert.equal(items[0]?.slots[0]?.displayLabel, "Authored Guest");
  assert.equal(items[0]?.slots[0]?.performer, undefined);
  const saved = await t.query(resolve, { references: [{ kind: "set", eventId: ids.eventId, slotId: ids.slotId }] });
  assert.equal(saved[0]?.kind, "available");
  for (const secret of [ids.hidden, ids.worldId, "private-dj", "SECRET PERSON", "private-world", "SECRET WORLD", "https://secret.invalid/person.png"]) assert.ok(!JSON.stringify({ items, saved }).includes(secret));
});

it("resolvesSavedOutsideRange", async () => {
  const t = setup();
  const id = await t.run(({ db }) => db.insert("events", { ...eventBase, startAt: startAt + 90 * 24 * hour, endAt: undefined, communityName: "Manual Club" }));
  assert.deepEqual(await all(t), []);
  const result = await t.query(resolve, { references: [{ kind: "event", eventId: id }] });
  assert.equal(result[0]?.kind, "available");
  if (result[0]?.kind !== "available") assert.fail("Expected saved event");
  assert.deepEqual(result[0].event.schedule, { kind: "open_end", startAt: startAt + 90 * 24 * hour });
  assert.equal(result[0].event.communityName, "Manual Club");
  assert.equal(result[0].event.href, undefined);
});

it("rechecks publication and stable set membership without name replacement", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    const other = await db.insert("events", { ...eventBase, slug: "other" });
    const privateId = await db.insert("events", { ...eventBase, publicationState: "draft_private" });
    const slotId = await db.insert("eventSlots", { ...slotBase, eventId });
    const deletedId = await db.insert("eventSlots", { ...slotBase, eventId });
    await db.delete(deletedId);
    await db.insert("eventSlots", { ...slotBase, eventId });
    await db.patch(eventId, { eventStatus: "cancelled" });
    return { eventId, other, privateId, slotId, deletedId };
  });
  assert.deepEqual((await all(t)).map(event => event.id), [ids.other]);
  const references: PlanReference[] = [
    { kind: "event", eventId: ids.eventId }, { kind: "set", eventId: ids.eventId, slotId: ids.slotId },
    { kind: "event", eventId: "invalid" }, { kind: "event", eventId: ids.privateId },
    { kind: "set", eventId: ids.other, slotId: ids.slotId }, { kind: "set", eventId: ids.eventId, slotId: ids.deletedId },
    { kind: "set", eventId: ids.eventId, slotId: "invalid" },
  ];
  const results = await t.query(resolve, { references });
  assert.equal(results.length, references.length);
  for (const result of results.slice(0, 2)) { assert.equal(result.kind, "available"); if (result.kind === "available") assert.equal(result.status, "cancelled"); }
  assert.deepEqual(results.slice(2), references.slice(2).map(reference => ({ reference, kind: "unavailable" })));
  assert.deepEqual(await t.query(roster, { eventId: ids.eventId, range }), { items: [], performers: [], cursor: null, complete: true });
});

it("validates bounds, limits, IDs and cursor scope", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    const other = await db.insert("events", eventBase);
    await db.insert("eventSlots", { ...slotBase, eventId });
    return { eventId, other };
  });
  for (const invalid of [{ ...range, startAt: NaN }, { ...range, endAt: Infinity }, { ...range, endAt: startAt }, { ...range, endAt: startAt + 7 * 24 * hour + 1 }, { ...range, timeZone: "Mars/Olympus" }]) await assert.rejects(t.query(list, { range: invalid }));
  for (const limit of [NaN, Infinity, 1.5]) await assert.rejects(t.query(list, { range, limit }));
  assert.equal((await t.query(list, { range, limit: -1 })).items.length, 1);
  for (const cursor of ["not-json", "{}", JSON.stringify({ kind: "events", phase: "bogus" })]) await assert.rejects(t.query(list, { range, cursor }));
  const first = await t.query(list, { range, limit: 1 });
  assert.ok(first.cursor);
  await assert.rejects(t.query(list, { range: { ...range, timeZone: "Europe/London" }, cursor: first.cursor }));
  const event = first.items[0]; assert.ok(event?.rosterCursor);
  await assert.rejects(t.query(roster, { eventId: ids.other, range, cursor: event.rosterCursor }));
  await assert.rejects(t.query(roster, { eventId: "invalid", range }));
  await assert.rejects(t.query(resolve, { references: Array.from({ length: 51 }, () => ({ kind: "event", eventId: ids.eventId })) }));
});

it("requires an IANA timezone rather than a fixed-offset timezone", async () => {
  const t = setup();
  await assert.rejects(t.query(list, { range: { ...range, timeZone: "+02:00" } }));
});

it("preserves canonical host identity and revokes existing roster and saved references", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const hostId = await db.insert("profiles", { ...personBase, profileType: "community", person: undefined, community: { categoryTags: [] }, slug: "club", displayName: "Club", avatarImageUrl: "https://example.com/club.png" });
    const eventId = await db.insert("events", { ...eventBase, communityProfileId: hostId });
    const personId = await db.insert("profiles", personBase);
    const slotId = await db.insert("eventSlots", { ...slotBase, eventId, personProfileId: personId });
    return { hostId, eventId, personId, slotId };
  });
  const event = (await all(t))[0]; assert.ok(event);
  assert.equal(event.href, "/club/events/night");
  assert.deepEqual(event.host, { id: ids.hostId, slug: "club", displayName: "Club", imageUrl: "https://example.com/club.png" });
  assert.deepEqual(event.performers, [{ id: ids.personId, slug: "dj", displayName: "DJ" }]);
  const pending = (await all(t, range, 8, false))[0]!.rosterCursor;
  await t.run(({ db }) => db.patch(ids.hostId, { publicSurfacingState: "suppressed" }));
  assert.deepEqual(await all(t), []);
  assert.ok(pending);
  assert.deepEqual(await t.query(roster, { eventId: ids.eventId, range, cursor: pending }), { items: [], performers: [], cursor: null, complete: true });
  const reference = { kind: "set", eventId: ids.eventId, slotId: ids.slotId } as const;
  assert.deepEqual(await t.query(resolve, { references: [reference] }), [{ reference, kind: "unavailable" }]);
});

it("bounds multiple initial rosters and retains only overlapping authored slot times", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const events = [];
    const slots = [];
    for (let i = 0; i < 9; i++) {
      const eventId = await db.insert("events", { ...eventBase, slug: `event-${i}` });
      events.push(eventId);
      const lower = await db.insert("eventSlots", { ...slotBase, eventId, endAt: undefined });
      const earlier = await db.insert("eventSlots", { ...slotBase, eventId, startAt: startAt - hour, endAt: startAt + 1 });
      slots.push([lower, earlier]);
      await db.insert("eventSlots", { ...slotBase, eventId, startAt: startAt - hour, endAt: startAt });
      await db.insert("eventSlots", { ...slotBase, eventId, startAt: range.endAt, endAt: undefined });
    }
    return { events, slots };
  });
  assert.equal((await t.query(list, { range })).items.length, 8);
  const items = await all(t);
  assert.deepEqual(items.map(event => event.id), ids.events);
  for (let i = 0; i < items.length; i++) assert.deepEqual(items[i]?.slots.map(slot => slot.id).sort(), ids.slots[i]?.sort());
});

it("continues past ineligible participant pages and deduplicates public identities per page", async () => {
  const t = setup();
  const ids = await t.run(async ({ db }) => {
    const eventId = await db.insert("events", eventBase);
    const hidden = await db.insert("profiles", { ...personBase, slug: "hidden-participant", publicationState: "draft_private" });
    const eligible = await db.insert("profiles", personBase);
    for (let i = 0; i < 83; i++) await db.insert("eventParticipants", {
      eventId, personProfileId: i < 81 ? hidden : eligible,
      eventPublicationState: "published", eventStatus: "scheduled", confirmationState: i === 80 ? "unconfirmed" : "confirmed",
      roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", updatedAt: 1,
    });
    return { eventId, hidden, eligible };
  });
  let cursor: string | undefined;
  const performers: TimelineEvent["performers"] = [];
  let pages = 0;
  while (pages < 10) {
    const result = await t.query(roster, { eventId: ids.eventId, range, ...(cursor === undefined ? {} : { cursor }) });
    assert.ok(!JSON.stringify(result).includes(ids.hidden));
    assert.equal(new Set(result.performers.map(person => person.id)).size, result.performers.length);
    performers.push(...result.performers);
    pages++;
    if (result.complete) break;
    assert.ok(result.cursor); cursor = result.cursor;
  }
  assert.equal(pages, 4);
  assert.deepEqual(performers.map(person => person.id), [ids.eligible]);
});

it("detail roster continues 81+ mixed rows without range truncation and binds cursor mode", async () => {
  const t = setup();
  const ids = await t.run(async ({db}) => {
    const person = await db.insert("profiles", personBase);
    const hidden = await db.insert("profiles", {...personBase, slug: "secret", displayName: "SECRET", publicSurfacingState: "suppressed"});
    const eventId = await db.insert("events", {...eventBase, eventStatus: "cancelled"});
    const slots = [];
    for (let i=0;i<81;i++) slots.push(await db.insert("eventSlots", {...slotBase, eventId, position:i, startAt: startAt + 200*hour + i*hour, endAt: startAt + 201*hour + i*hour, personProfileId: person}));
    const manual = await db.insert("eventLineupEntries", {eventId, clientKey:"manual", position: 82, performerLabel: "Manual guest", updatedAt: 1});
    await db.insert("eventLineupEntries", {eventId, clientKey:"hidden", position: 83, performerLabel: "Authored label", personProfileId: hidden, updatedAt: 1});
    return {eventId, person, hidden, slots, manual};
  });
  const first = await t.query(roster, {eventId: ids.eventId, range, detail: true});
  assert.equal(first.detail?.kind, "available"); assert.equal(first.items.length, 80); assert.equal(first.complete, false);
  await assert.rejects(t.query(roster, {eventId: ids.eventId, range, cursor: first.cursor ?? undefined}), /cursor/);
  const normal = await t.query(roster, {eventId: ids.eventId, range});
  assert.equal(normal.items.length, 0); assert.equal(normal.detail, undefined);
  const rows = [...(first.detail?.kind === "available" ? first.detail.rows : [])];
  let cursor = first.cursor;
  while(cursor) { const page = await t.query(roster, {eventId: ids.eventId, range, detail:true, cursor}); if(page.detail?.kind === "available") rows.push(...page.detail.rows); cursor=page.cursor; }
  assert.ok(rows.some(row => row.key === ids.slots[80]));
  assert.ok(rows.some(row => row.key === ids.manual && row.displayLabel === "Manual guest" && row.startAt === undefined));
  assert.ok(!JSON.stringify(rows).includes(ids.hidden)); assert.ok(!JSON.stringify(rows).includes("SECRET"));
  assert.ok(rows.some(row=> row.displayLabel === "Authored label" && row.performer === undefined));
  await t.run(async ({db}) => { await db.patch(ids.eventId, {eventStatus:"scheduled"}); });
  const chart = await t.query(roster, {eventId:ids.eventId, range});
  await assert.rejects(t.query(roster, {eventId:ids.eventId, range, detail:true, cursor:chart.cursor ?? undefined}), /cursor/);
  await t.run(async ({db}) => { await db.patch(ids.eventId, {publicationState:"draft_private"}); });
  const revoked = await t.query(roster, {eventId:ids.eventId, range, detail:true});
  assert.deepEqual(revoked.detail, {kind:"unavailable"}); assert.deepEqual(revoked.items, []);
});
