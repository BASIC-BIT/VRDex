import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { getPublicEventBySlug } from "../../convex/_eventPublic";
import { PublicEventSchema } from "../../packages/api-contracts/src/schemas";
import { eventSortAt, eventSortEndAt } from "../../convex/_eventSchedule";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = { "../../convex/_generated/api.ts": () => import("../../convex/_generated/api") };
const now = Date.UTC(2026, 8, 25, 20);
async function fixture() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async ({ db }) => {
    const personId = await db.insert("profiles", {
      slug: "aurora", displayName: "Aurora", sortName: "aurora", profileType: "person",
      person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed",
      publicationState: "published", publicSurfacingState: "public", creationSource: "community",
      avatarImageUrl: "https://example.com/portrait.png", updatedAt: now,
    });
    const eventId = await db.insert("events", {
      slug: "lineup", title: "Lineup", sortTitle: "lineup", startAt: now, endAt: now + 7200000,
      timezone: "UTC", sourceType: "community", sourceLabel: "Fixture", eventStatus: "scheduled",
      publicationState: "published", createdAt: now, updatedAt: now,
    });
    return { eventId, personId };
  });
  const read = () => t.run(async ({ db }) => PublicEventSchema.parse(await getPublicEventBySlug(db, await db.get(ids.eventId))));
  return { t, ...ids, read };
}

it("projects legacy participant-only events into the lineup with their portrait", async () => {
  const { t, read, eventId, personId } = await fixture();
  await t.run(({ db }) => db.insert("eventParticipants", {
    eventId, personProfileId: personId, eventStartAt: now, eventEndAt: now + 7200000,
    eventPublicationState: "published", eventStatus: "scheduled", roleLabel: "Host",
    sourceType: "community", sourceLabel: "Fixture", confirmationState: "confirmed", updatedAt: now,
  }));
  const event = await read();
  assert.equal(event.lineup?.length, 1);
  assert.equal(event.lineup[0].performer?.imageUrl, "https://example.com/portrait.png");
  assert.equal(event.lineup[0].startAt, undefined);
});

it("keeps two real sets and unmatched timed names without duplicating a matched participant", async () => {
  const { t, read, eventId, personId } = await fixture();
  await t.run(async ({ db }) => {
    await db.insert("eventParticipants", {
      eventId, personProfileId: personId, eventPublicationState: "published", eventStatus: "scheduled",
      roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confirmationState: "confirmed", updatedAt: now,
    });
    for (const position of [0, 1, 2]) await db.insert("eventSlots", {
      eventId, position, startAt: now + position * 1800000,
      ...(position < 2 ? { personProfileId: personId } : {}), displayLabel: position < 2 ? "Aurora" : "Guest",
      roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: now,
    });
  });
  const event = await read();
  assert.deepEqual(event.lineup?.map(row => row.displayLabel), ["Aurora", "Aurora", "Guest"]);
  assert.equal(event.lineup[2].performer, undefined);
  assert.equal(event.slots?.length, 3);
});

it("replaces legacy generated session labels with the matched name or Slot label", async () => {
  const { t, eventId, personId, read } = await fixture();
  await t.run(async ({ db }) => {
    for (const position of [0, 1]) await db.insert("eventSlots", { eventId, position, startAt: now + position * 1800000,
      ...(position === 0 ? { personProfileId: personId } : {}), displayLabel: `Session ${position + 1}`, roleLabel: "DJ",
      sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: now });
  });
  assert.deepEqual((await read()).lineup.map(row => row.displayLabel), ["Aurora", "Slot 2"]);
});

it("clears selected streams when a canonical row changes person or removes the match", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  for (const personSlug of ["other", undefined]) {
    const { t, eventId, personId } = await fixture();
    await t.run(async ({ db }) => {
      const { _id, _creationTime, ...person } = (await db.get(personId))!;
      await db.insert("profiles", { ...person, slug: "other" });
      await db.insert("eventSlots", { eventId, clientKey: "same", position: 0, startAt: now, personProfileId: personId,
        selectedStreamId: "aurora-main", displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: now });
      await replaceEventLineup(db, (await db.get(eventId))!, [{ clientKey: "same", position: 0, performerLabel: "Guest", personSlug, startAt: now }], now);
      assert.equal((await db.query("eventSlots").first())!.selectedStreamId, undefined);
    });
  }
});

it("writes ordered unmatched and matched untimed rows and preserves discovery", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, read, eventId } = await fixture();
  await t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, [
    { clientKey: "guest", position: 2, performerLabel: "Guest" },
    { clientKey: "aurora", position: 1, performerLabel: "AURORA", personSlug: "aurora" },
    { clientKey: "other", position: 0, performerLabel: "Unknown" },
  ], now));
  const event = await read();
  assert.deepEqual(event.lineup?.map(row => row.displayLabel), ["Unknown", "AURORA", "Guest"]);
  assert.equal(event.lineup[1].performer?.slug, "aurora");
  assert.equal(event.lineup[1].performer?.imageUrl, "https://example.com/portrait.png");
  assert.equal(event.participants?.length, 1);
  assert.equal(event.slots?.length, 0);
});

it("rejects invalid identities and ambiguous row keys before replacing existing rows", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, read, eventId } = await fixture();
  const replace = (entries: Parameters<typeof replaceEventLineup>[2]) => t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, entries, now));
  await replace([{ clientKey: "one", position: 0, performerLabel: "Guest" }]);
  await assert.rejects(replace([{ clientKey: "one", position: 0, performerLabel: "Aurora", personSlug: "missing" }]), /public person/i);
  await assert.rejects(replace([
    { clientKey: "same", position: 0, performerLabel: "A" }, { clientKey: "same", position: 1, performerLabel: "B" },
  ]), /unique/i);
  assert.equal((await read()).lineup?.[0].displayLabel, "Guest");
});

it("retains selected stream and slot identity when the same timed set is replaced", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, eventId, personId } = await fixture();
  const slotId = await t.run(({ db }) => db.insert("eventSlots", {
    eventId, position: 0, startAt: now, personProfileId: personId, selectedStreamId: "aurora-main",
    displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture",
    confidence: 1, reviewState: "confirmed", updatedAt: now,
  }));
  await t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, [
    { clientKey: "one", position: 0, performerLabel: "Aurora", personSlug: "aurora", startAt: now },
  ], now));
  const slots = await t.run(({ db }) => db.query("eventSlots").collect());
  assert.equal(slots.length, 1);
  assert.equal(slots[0]._id, slotId);
  assert.equal(slots[0].selectedStreamId, "aurora-main");
});

it("keeps date-only lineup discovery caches without inventing set times or matches", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, eventId, read } = await fixture();
  await t.run(async ({ db }) => {
    await db.patch(eventId, { scheduleKind: "date_only", eventDate: "2026-09-25", startAt: undefined, endAt: undefined });
    const event = (await db.get(eventId))!;
    await replaceEventLineup(db, event, [
      { clientKey: "name-only", position: 0, performerLabel: "Aurora" },
      { clientKey: "matched", position: 1, performerLabel: "Aurora", personSlug: "aurora" },
    ], now);
    const participants = await db.query("eventParticipants").collect();
    assert.equal(participants.length, 1);
    assert.equal(participants[0].eventStartAt, undefined);
    assert.equal(participants[0].eventSortAt, eventSortAt(event));
    assert.equal(participants[0].eventSortEndAt, eventSortEndAt(event));
  });
  const event = await read();
  assert.equal(event.lineup?.length, 2);
  assert.equal(event.lineup[0].performer, undefined);
  assert.equal(event.lineup[0].startAt, undefined);
  assert.equal(event.lineup[1].performer?.slug, "aurora");
  assert.equal(event.slots?.length, 0);
  await assert.rejects(t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, [
    { clientKey: "timed", position: 0, performerLabel: "Guest", startAt: now },
  ], now)), /timed event/);
});

it("refuses private person matches and withdraws their identity and portrait on public reads", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, personId, eventId, read } = await fixture();
  const entries = [{ clientKey: "one", position: 0, performerLabel: "Authored name", personSlug: "aurora" }];
  await t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, entries, now));
  await t.run(({ db }) => db.patch(personId, { publicationState: "draft_private" }));
  const event = await read();
  assert.equal(event.lineup?.[0].displayLabel, "Authored name");
  assert.equal(event.lineup[0].performer, undefined);
  assert.equal(event.participants?.length, 0);
  await assert.rejects(t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, entries, now)), /public person/);
});

it("shares inferred ends across public lineup, slots and active preview without backfilling rows", async () => {
  const { getPublicEventPreviews } = await import("../../convex/_eventPublic");
  const { t, eventId, read } = await fixture();
  const minute = 60_000;
  await t.run(async ({ db }) => {
    for (const position of [0, 1, 2]) await db.insert("eventSlots", {
      eventId, position, startAt: now + position * 30 * minute, ...(position === 0 ? { endAt: now + 15 * minute } : {}),
      displayLabel: `Set ${position}`, roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: now,
    });
  });
  const event = await read();
  const expected = [now + 15 * minute, now + 60 * minute, now + 120 * minute];
  assert.deepEqual(event.lineup.map(row => row.endAt), expected);
  assert.deepEqual(event.slots.map(row => row.endAt), expected);
  const previews = await t.run(async ({ db }) => getPublicEventPreviews(db, [(await db.get(eventId))!], { now: now + 45 * minute }));
  assert.deepEqual(previews[0]?.nextSlots.map(row => row.endAt), expected.slice(1));
  await t.run(async ({ db }) => {
    const authored = await db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", eventId)).collect();
    assert.equal(authored.filter(row => row.endAt !== undefined).length, 1);
  });
});

it("keeps untimed canonical rows as end-inference barriers in every public projection", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, eventId, read } = await fixture();
  await t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, [
    { clientKey: "first", position: 0, performerLabel: "First", startAt: now },
    { clientKey: "unknown", position: 1, performerLabel: "Unscheduled" },
    { clientKey: "last", position: 2, performerLabel: "Last", startAt: now + 3_600_000 },
  ], now));
  const event = await read();
  assert.deepEqual(event.lineup.map(row => row.endAt), [undefined, undefined, now + 7_200_000]);
  assert.deepEqual(event.slots.map(row => row.endAt), [undefined, now + 7_200_000]);
});

it("does not infer reordered canonical starts by silently sorting them into chronology", async () => {
  const { replaceEventLineup } = await import("../../convex/_eventLineup");
  const { t, eventId, read } = await fixture();
  await t.run(async ({ db }) => replaceEventLineup(db, (await db.get(eventId))!, [
    { clientKey: "first", position: 0, performerLabel: "First", startAt: now },
    { clientKey: "third", position: 1, performerLabel: "Third", startAt: now + 3_600_000 },
    { clientKey: "second", position: 2, performerLabel: "Second", startAt: now + 1_800_000 },
  ], now));
  const event = await read();
  assert.deepEqual(event.lineup.map(row => row.endAt), [undefined, undefined, undefined]);
  assert.deepEqual(event.slots.map(row => row.endAt), [undefined, undefined, undefined]);
});


it("host and editor projections retain authored end omissions", async () => {
  const { getEventForHost, getEventForEditor } = await import("../../convex/_eventPublic");
  const { t, eventId, read } = await fixture();
  await t.run(async ({ db }) => {
    for (const position of [0, 1]) await db.insert("eventSlots", {
      eventId, position, startAt: now + position * 3_600_000,
      displayLabel: `Set ${position}`, roleLabel: "DJ", sourceType: "community", sourceLabel: "Fixture", confidence: 1, reviewState: "confirmed", updatedAt: now,
    });
    const event = (await db.get(eventId))!;
    for (const projection of [await getEventForHost(db, event), await getEventForEditor(db, event)]) {
      assert.deepEqual(projection?.lineup.map(row => row.endAt), [undefined, undefined]);
      assert.deepEqual(projection?.slots.map(row => row.endAt), [undefined, undefined]);
    }
  });
  assert.deepEqual((await read()).slots.map(row => row.endAt), [now + 3_600_000, now + 7_200_000]);
});
