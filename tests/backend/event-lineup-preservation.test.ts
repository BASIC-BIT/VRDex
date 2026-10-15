import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import type { EventLineupInput } from "../../convex/_eventInputs";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const startAt = Date.UTC(2027, 9, 15, 18);
const originalLineup = ["guest", "other"].map((personSlug, position) => ({ clientKey: personSlug, position, performerLabel: personSlug, personSlug, roleLabel: "DJ", startAt: startAt + position * 3_600_000, endAt: startAt + (position + 1) * 3_600_000 }));
async function fixture() {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
  } });
  const subject = newClerkUserId();
  await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: subject, name: "Owner", emailVerificationTime: Date.now() });
    await ctx.db.insert("users", { clerkUserId: "contributor", name: "Contributor" });
    const common = { aliases: [], tags: [], claimState: "unclaimed" as const, publicationState: "published" as const, publicSurfacingState: "public" as const, creationSource: "community" as const, updatedAt: Date.now() };
    const communityId = await ctx.db.insert("profiles", { ...common, slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] } });
    await ctx.db.insert("profileOwners", { profileId: communityId, userId: ownerId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    for (const slug of ["guest", "other", "new"]) await ctx.db.insert("profiles", { ...common, slug, displayName: slug, sortName: slug, profileType: "person", person: { roleTags: [] } });
  });
  const contributor = t.withIdentity({ subject: "contributor", issuer: "test", tokenIdentifier: "test|contributor" });
  const owner = t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const draft = await contributor.mutation(makeFunctionReference<"mutation">("eventIntake:saveEventIntakeDraft"), { patch: {
    communitySlug: "club", title: "Preservation night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "18:00" }, end: { time: "23:00" },
    lineup: originalLineup.map((row, position) => ({ ...row, startAt: undefined, endAt: undefined, start: { time: `${18 + position}:00` }, end: { time: `${19 + position}:00` } })),
  } });
  const published = await contributor.action(makeFunctionReference<"action">("eventIntake:publishEventIntake"), { draftId: draft.draftId, expectedVersion: 1, idempotencyKey: "preservation" });
  const event = (await t.run(ctx => ctx.db.get(published.eventId)))!;
  async function read() {
    return t.run(async ctx => ({ untimed: await ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).collect(), slots: await ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect(), participants: await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect() }));
  }
  async function update(lineup: EventLineupInput, eventStart = startAt) {
    const snapshot = await owner.query(api.events.getEditableBySlug, { slug: event.slug! });
    await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", timezone: "UTC", startAt: eventStart, lineup, preserveLineupConfirmation: true, preservedSlotAssociationIds: snapshot!.preservedSlotAssociationIds, preservedParticipantAssociationIds: snapshot!.preservedParticipantAssociationIds });
  }
  return { t, owner, event, read, update };
}

test("canonical scheduling keeps unchanged contributed matches unconfirmed through insertion duration removal start and repeated saves", async () => {
  const { read, update } = await fixture();
  const before = await read();
  assert.ok(before.participants.every(row => row.confirmationState === "unconfirmed"));
  const shortened = originalLineup.map((row, index) => ({ ...row, startAt: row.startAt - index * 900_000, endAt: row.endAt - 900_000 }));
  const inserted = [{ clientKey: "blank", position: 0, performerLabel: "Unmatched", personSlug: undefined, roleLabel: "", startAt, endAt: startAt + 900_000 }, ...shortened.map(row => ({ ...row, position: row.position + 1, startAt: row.startAt + 900_000, endAt: row.endAt + 900_000 }))];
  for (const [index, lineup] of [shortened, inserted, shortened, shortened.map(row => ({ ...row, startAt: row.startAt + 900_000, endAt: row.endAt + 900_000 }))].entries()) {
    await update(lineup, index === 3 ? startAt + 900_000 : startAt);
    await update(lineup, index === 3 ? startAt + 900_000 : startAt);
    const after = await read();
    for (const previous of before.participants) {
      const current = after.participants.find(row => row.personProfileId === previous.personProfileId)!;
      assert.equal(current.confirmationState, "unconfirmed");
      assert.equal(current.confirmedAt, undefined);
      assert.equal(current._id, previous._id);
    }
  }
});

for (const kind of ["new", "replacement", "duplicate-first", "duplicate-last"] as const) test(`canonical preservation still confirms a genuinely authored ${kind} match`, async () => {
  const { event, read, update } = await fixture();
  const before = await read();
  let lineup = kind === "replacement" ? originalLineup.map((row, index) => index === 0 ? { ...row, personSlug: "other" } : row) : [...originalLineup, { ...originalLineup[0]!, clientKey: "new-key", position: 2, personSlug: kind === "new" ? "new" : "guest", startAt: startAt + 7_200_000, endAt: startAt + 9_000_000 }];
  if (kind === "duplicate-first") lineup = [lineup[2]!, ...lineup.slice(0, 2)].map((row, position) => ({ ...row, position }));
  await update(lineup);
  const after = await read();
  const target = kind === "replacement" ? before.participants.find(row => row.personProfileId === before.slots.find(slot => slot.clientKey === "other")!.personProfileId)!.personProfileId : kind.startsWith("duplicate") ? before.slots.find(slot => slot.clientKey === "guest")!.personProfileId : after.slots.find(slot => slot.clientKey === "new-key")!.personProfileId;
  assert.equal(after.participants.find(row => row.personProfileId === target)!.confirmationState, "confirmed");
  const confirmedAt = after.participants.find(row => row.personProfileId === target)!.confirmedAt;
  if (kind === "replacement") assert.equal(after.participants.some(row => row.personProfileId === before.slots.find(slot => slot.clientKey === "guest")!.personProfileId), false);
  if (kind === "new") {
    const added = after.participants.find(row => row.personProfileId === target)!;
    assert.equal(added.sourceType, event.sourceType);
    assert.equal(added.sourceLabel, event.sourceLabel);
  }
  await update(lineup);
  assert.equal((await read()).participants.find(row => row.personProfileId === target)!.confirmedAt, confirmedAt);
});

test("canonical schedules retain slot and participant provenance established through explicit legacy commands", async () => {
  const { owner, event, read, update } = await fixture();
  const snapshot = await owner.query(api.events.getEditableBySlug, { slug: event.slug! });
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", timezone: "UTC", preservedSlotAssociationIds: snapshot!.preservedSlotAssociationIds, preservedParticipantAssociationIds: snapshot!.preservedParticipantAssociationIds,
    slotLinks: originalLineup.map(row => ({ personSlug: row.personSlug, roleLabel: row.roleLabel, startAt: row.startAt, endAt: row.endAt, displayLabel: row.performerLabel, sourceLabel: "Slot source", sourceUrl: "https://example.com/slot", notes: "Slot note" })),
    participantLinks: ["guest", "other"].map(personSlug => ({ personSlug, roleLabel: "DJ", sourceLabel: "Person source", sourceUrl: "https://example.com/person", notes: "Person note" })),
  });
  assert.equal((await owner.query(api.events.getEditableBySlug, { slug: event.slug! }))!.usesCanonicalLineup, true);
  const before = await read();
  assert.notEqual(before.slots[0]!.sourceType, event.sourceType);
  for (const delta of [900_000, 1_800_000]) {
    const lineup = [{ clientKey: "inserted", position: 0, performerLabel: "Unmatched", personSlug: undefined, roleLabel: "", startAt: startAt + delta, endAt: startAt + delta + 900_000 }, ...originalLineup.map(row => ({ ...row, position: row.position + 1, startAt: row.startAt + delta + 900_000, endAt: row.endAt + delta }))];
    await update(lineup, startAt + delta);
    await update(lineup, startAt + delta);
    const after = await read();
    for (const previous of [...before.slots, ...before.participants]) {
      const current = [...after.slots, ...after.participants].find(row => row._id === previous._id);
      assert.ok(current);
      for (const field of ["sourceType", "sourceLabel", "sourceUrl", "notes"] as const) assert.equal(current[field], previous[field]);
    }
    const added = after.slots.find(row => row.clientKey === "inserted")!;
    assert.equal(added.sourceType, event.sourceType);
    assert.equal(added.sourceLabel, event.sourceLabel);
  }
});


test("untiming keeps matches but a deliberate reset removes participants before new authored matches", async () => {
  const { read, update } = await fixture();
  const before = await read();
  const untimed = originalLineup.map(({ clientKey, position, performerLabel, personSlug, roleLabel }) => ({ clientKey, position, performerLabel, personSlug, roleLabel }));
  await update(untimed);
  for (const previous of before.participants) {
    const current = (await read()).participants.find(row => row._id === previous._id)!;
    assert.equal(current.confirmationState, "unconfirmed");
  }
  await update(untimed);
  assert.ok((await read()).participants.every(row => row.confirmationState === "unconfirmed"));
  await update([]);
  assert.deepEqual((await read()).participants, []);
  assert.deepEqual((await read()).slots, []);
  await update(originalLineup);
  assert.ok((await read()).participants.every(row => row.confirmationState === "confirmed" && !before.participants.some(old => old._id === row._id)));
});


for (const conversion of ["canonical", "legacy-date-only"] as const) test(`${conversion} preserves stored slot provenance through untimed saves and back`, async () => {
  const { t, owner, event, read, update } = await fixture();
  const snapshot = await owner.query(api.events.getEditableBySlug, { slug: event.slug! });
  await owner.mutation(api.events.updateCommunityEvent, {
    currentSlug: event.slug!, communitySlug: "club", timezone: "UTC",
    preservedSlotAssociationIds: snapshot!.preservedSlotAssociationIds,
    slotLinks: originalLineup.map(row => ({ personSlug: row.personSlug, roleLabel: row.roleLabel, startAt: row.startAt, endAt: row.endAt, displayLabel: row.performerLabel, sourceLabel: "Distinct slot source", sourceUrl: "https://example.com/distinct-slot", notes: "Private slot note" })),
  });
  const before = await read();
  const provenance = { sourceType: "community", sourceLabel: "Distinct slot source", sourceUrl: "https://example.com/distinct-slot", notes: "Private slot note" };
  const untimed = originalLineup.map(({ clientKey, position, performerLabel, personSlug, roleLabel }) => ({ clientKey, position, performerLabel, personSlug, roleLabel }));
  if (conversion === "canonical") await update(untimed);
  else {
    const previousFlag = process.env.EVENT_DATE_ONLY_ENABLED;
    process.env.EVENT_DATE_ONLY_ENABLED = "true";
    try {
      await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", scheduleKind: "date_only", eventDate: "2027-10-15" });
    } finally {
      if (previousFlag === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED;
      else process.env.EVENT_DATE_ONLY_ENABLED = previousFlag;
    }
  }
  const assertUntimed = async () => {
    const stored = await read();
    assert.equal(stored.slots.length, 0);
    assert.equal(stored.untimed.length, 2);
    for (const row of stored.untimed) {
      assert.partialDeepStrictEqual(row, provenance);
      for (const key of ["startAt", "endAt", "eventStartAt", "eventEndAt", "selectedStreamId"]) assert.equal(key in row, false);
    }
    for (const previous of before.participants) assert.ok(stored.participants.some(row => row._id === previous._id));
    for (const projection of [await t.query(api.events.getPublicBySlug, { slug: event.slug! }), await owner.query(api.events.getEditableBySlug, { slug: event.slug! })]) {
      assert.ok(projection);
      assert.equal(projection.lineup.length, 2);
      for (const row of projection.lineup) {
        for (const key of ["sourceType", "sourceLabel", "sourceUrl", "notes", "startAt", "endAt"]) assert.equal(key in row, false);
      }
      assert.equal(JSON.stringify(projection).includes("Distinct slot"), false);
      assert.equal(JSON.stringify(projection).includes("distinct-slot"), false);
    }
    const operations = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug!, now: startAt + 1 });
    assert.equal(operations.currentSlot, undefined);
    assert.equal(operations.nextSlot, undefined);
    assert.equal(JSON.stringify(operations).includes("Distinct slot"), false);
  };
  await assertUntimed();
  // An unchanged canonical save carries provenance from the existing untimed row.
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", lineup: untimed, preserveLineupConfirmation: true });
  await assertUntimed();
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", scheduleKind: "timed", timezone: "UTC", startAt, lineup: originalLineup, preserveLineupConfirmation: true });
  await update(originalLineup);
  const restored = await read();
  assert.equal(restored.untimed.length, 0);
  for (const row of restored.slots) assert.partialDeepStrictEqual(row, provenance);
  const publicRestored = await t.query(api.events.getPublicBySlug, { slug: event.slug! });
  assert.ok(publicRestored);
  assert.equal(publicRestored.slots.length, 2);
  for (const row of publicRestored.slots) {
    // Timed source attribution was already public; storage adds no new DTO fields.
    assert.deepEqual(row.source, { sourceType: "community", label: "Distinct slot source", url: "https://example.com/distinct-slot" });
    assert.equal("notes" in row, false);
  }
  assert.equal(JSON.stringify(publicRestored).includes("Private slot note"), false);
  const operations = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug!, now: startAt + 1 });
  assert.equal(operations.currentSlot?.startAt, startAt);
  assert.equal(operations.nextSlot?.startAt, startAt + 3_600_000);
  for (const row of [operations.currentSlot, operations.nextSlot]) {
    assert.ok(row);
    for (const key of ["sourceType", "sourceLabel", "sourceUrl", "notes"]) assert.equal(key in row, false);
  }
  for (const previous of before.participants) assert.ok(restored.participants.some(row => row._id === previous._id));
});


test("old untimed records and new rows use event provenance without inventing slot metadata", async () => {
  const { t, event, read, update } = await fixture();
  await update([]);
  // Compatibility fixture models an existing record written before optional fields.
  await t.run(ctx => ctx.db.insert("eventLineupEntries", { eventId: event._id, clientKey: "old", position: 0, performerLabel: "Old untimed", updatedAt: Date.now() }));
  const lineup = [{ clientKey: "old", position: 0, performerLabel: "Old untimed" }, { clientKey: "new", position: 1, performerLabel: "New untimed" }];
  await update(lineup);
  for (const row of (await read()).untimed) {
    assert.equal(row.sourceType, event.sourceType);
    assert.equal(row.sourceLabel, event.sourceLabel);
    assert.equal(row.sourceUrl, undefined);
    assert.equal(row.notes, undefined);
  }
  await update(lineup.map((row, index) => ({ ...row, startAt: startAt + index * 3_600_000, endAt: startAt + (index + 1) * 3_600_000 })));
  for (const row of (await read()).slots) {
    assert.equal(row.sourceType, event.sourceType);
    assert.equal(row.sourceLabel, event.sourceLabel);
    assert.equal(row.sourceUrl, undefined);
    assert.equal(row.notes, undefined);
  }
});

test("canonical clearing an end preserves exact starts, later clocks, provenance and confirmation on repeated saves", async () => {
  const { t, owner, event, read, update } = await fixture();
  const initial = await read();
  const first = initial.slots.find(row => row.clientKey === "guest")!;
  await t.run(ctx => ctx.db.patch(first._id, { startAt: startAt + 10_123, endAt: startAt + 3_630_456, selectedStreamId: "retained-source", sourceLabel: "Slot source", sourceUrl: "https://example.com/slot", notes: "Stored note" }));
  const before = await read();
  const lineup = originalLineup.map((row, index) => index === 0 ? { ...row, startAt: startAt + 10_123, endAt: undefined } : row);
  for (const save of [1, 2]) {
    await update(lineup);
    const after = await read();
    assert.equal(after.slots.length, 2, `save ${save}`);
    assert.equal(after.untimed.length, 0);
    for (const previous of before.slots) {
      const current = after.slots.find(row => row._id === previous._id)!;
      assert.ok(current);
      for (const field of ["startAt", "personProfileId", "selectedStreamId", "sourceType", "sourceLabel", "sourceUrl", "notes"] as const) assert.equal(current[field], previous[field]);
      assert.equal(current.endAt, previous._id === first._id ? undefined : previous.endAt);
    }
    for (const previous of before.participants) {
      const current = after.participants.find(row => row._id === previous._id)!;
      assert.equal(current.confirmationState, previous.confirmationState);
      assert.equal(current.confirmedAt, previous.confirmedAt);
    }
    const editable = await owner.query(api.events.getEditableBySlug, { slug: event.slug! });
    assert.equal(editable!.slots.find(row => row.clientKey === "guest")!.endAt, undefined);
    assert.equal(editable!.endAt, event.endAt);
  }
});


test("browser legacy conversion preserves standalone identity, private associations and provenance, but explicit deletion removes represented rows", async () => {
  const { t, owner, event, read } = await fixture();
  await t.run(async ctx => {
    await ctx.db.patch(event._id, { sourceType: "community" });
    const rows = await ctx.db.query("eventSlots").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect();
    for (const row of rows) await ctx.db.patch(row._id, { clientKey: undefined, selectedStreamId: "saved-stream", sourceLabel: "Original slot", sourceUrl: "https://example.com/slot", notes: "Slot note" });
    await ctx.db.delete(rows.find(row => row.personProfileId !== rows[0]!.personProfileId)!._id);
    const participants = await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect();
    for (const row of participants) await ctx.db.patch(row._id, { confirmationState: "confirmed", sourceLabel: "Original person", sourceUrl: "https://example.com/person", notes: "Person note" });
    const privateProfile = await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", "new")).unique();
    await ctx.db.patch(privateProfile!._id, { publicationState: "draft_private" });
    const { _id, _creationTime, ...participant } = participants[0]!;
    await ctx.db.insert("eventParticipants", { ...participant, personProfileId: privateProfile!._id, notes: "Hidden association" });
  });
  const snapshot = (await owner.query(api.events.getEditableBySlug, { slug: event.slug! }))!;
  await t.run(async ctx => { for (const row of (await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).collect())) await ctx.db.patch(row._id, { confirmationState: "unconfirmed", confirmedAt: undefined }); });
  const before = await read();
  assert.equal(snapshot.usesCanonicalLineup, false);
  const standalone = snapshot.lineup.find(row => row.startAt === undefined)!;
  const slot = snapshot.slots[0]!;
  const lineup = [{ clientKey: slot.playbackKey, position: 0, performerLabel: "Slot billing", personSlug: slot.performer!.slug, roleLabel: slot.roleLabel, startAt: slot.startAt, endAt: slot.endAt, selectedStreamId: slot.selectedStreamId }, { clientKey: standalone.key, position: 1, performerLabel: "Guest A", personSlug: standalone.performer!.slug, roleLabel: standalone.roleLabel }, { clientKey: "manual", position: 2, performerLabel: "Manual guest" }];
  const update = (rows: EventLineupInput) => owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", lineup: rows, preserveLineupConfirmation: true, preservedSlotAssociationIds: snapshot.preservedSlotAssociationIds, preservedParticipantAssociationIds: snapshot.preservedParticipantAssociationIds, retainedLineupAssociations: snapshot.retainedLineupAssociations });
  for (const iteration of [1, 2]) {
    await update(lineup);
    const after = await read();
    for (const old of before.participants) {
      const current = after.participants.find(row => row._id === old._id)!;
      assert.ok(current, `participant retained on save ${iteration}`);
      for (const field of ["sourceType", "sourceLabel", "sourceUrl", "notes", "confirmationState", "confirmedAt"] as const) assert.equal(current[field], old[field]);
    }
    const current = after.slots.find(row => row._id === slot.playbackKey)!;
    for (const field of ["startAt", "endAt", "selectedStreamId", "sourceLabel", "sourceUrl", "notes"] as const) assert.equal(current[field], before.slots[0]![field]);
    assert.equal(after.untimed.find(row => row.clientKey === standalone.key)!.sourceLabel, "Original person");
    assert.equal(after.untimed.find(row => row.clientKey === "manual")!.performerLabel, "Manual guest");
    assert.equal(after.untimed.find(row => row.clientKey === standalone.key)!.performerLabel, "Guest A");
  }
  await update(lineup.filter(row => row.clientKey !== standalone.key));
  assert.equal((await read()).participants.some(row => row._id === standalone.key), false);
  assert.ok((await read()).participants.some(row => row.notes === "Hidden association"));
});


for (const replacement of [false, true]) test(`legacy standalone public-to-private snapshot keeps the association unless explicitly replaced=${replacement}`, async () => {
  const { t, owner, event, read } = await fixture();
  const initial = await read();
  await t.run(async ctx => {
    await ctx.db.patch(event._id, { sourceType: "community" });
    for (const slot of initial.slots) await ctx.db.delete(slot._id);
    for (const participant of initial.participants) await ctx.db.patch(participant._id, { confirmationState: "confirmed", sourceLabel: "Legacy source", sourceUrl: "https://example.com/legacy", notes: "Legacy note" });
  });
  const snapshot = (await owner.query(api.events.getEditableBySlug, { slug: event.slug! }))!;
  const row = snapshot.lineup.find(row => row.performer?.slug === "guest")!;
  const personId = initial.slots.find(slot => slot.clientKey === "guest")!.personProfileId!;
  await t.run(async ctx => {
    await ctx.db.patch(personId, { publicationState: "draft_private" });
    for (const participant of initial.participants) await ctx.db.patch(participant._id, { confirmationState: "unconfirmed", confirmedAt: undefined });
  });
  const lineup = snapshot.lineup.map(item => ({ clientKey: item.key, position: item.position, performerLabel: item.key === row.key ? "Billing override" : item.displayLabel, personSlug: item.key === row.key && replacement ? "new" : item.performer?.slug, roleLabel: item.roleLabel }));
  for (const save of [1, 2]) {
    await owner.mutation(api.events.updateCommunityEvent, { currentSlug: event.slug!, communitySlug: "club", lineup, preserveLineupConfirmation: true, preservedParticipantAssociationIds: snapshot.preservedParticipantAssociationIds, preservedSlotAssociationIds: snapshot.preservedSlotAssociationIds, retainedLineupAssociations: snapshot.retainedLineupAssociations });
    const after = await read();
    const entry = after.untimed.find(item => item.clientKey === row.key)!;
    assert.equal(entry.performerLabel, "Billing override");
    assert.equal(entry.sourceLabel, "Legacy source");
    const participant = after.participants.find(item => item.personProfileId === entry.personProfileId)!;
    assert.equal(participant.confirmationState, replacement ? "confirmed" : "unconfirmed", `save ${save}`);
    assert.equal(entry.personProfileId === personId, !replacement);
    if (!replacement) assert.equal(participant._id, row.key);
  }
});

test("unrepresented slots survive canonical conversion and retained IDs must belong to this loaded event", async () => {
  const { t, owner, event, read } = await fixture();
  const before = await read();
  const hidden = before.slots[1]!;
  await t.run(async ctx => {
    await ctx.db.patch(hidden._id, { reviewState: "draft" });
  });
  const snapshot = (await owner.query(api.events.getEditableBySlug, { slug: event.slug! }))!;
  assert.ok(snapshot.retainedLineupAssociations.slotIds.includes(hidden._id));
  const command = { currentSlug: event.slug!, communitySlug: "club", lineup: [{ ...originalLineup[0]!, performerLabel: "Override" }], preserveLineupConfirmation: true, preservedSlotAssociationIds: snapshot.preservedSlotAssociationIds, preservedParticipantAssociationIds: snapshot.preservedParticipantAssociationIds, retainedLineupAssociations: snapshot.retainedLineupAssociations };
  await owner.mutation(api.events.updateCommunityEvent, command);
  assert.deepEqual((await read()).slots.find(row => row._id === hidden._id), { ...hidden, reviewState: "draft" });
  const foreignId = await t.run(async ctx => {
    const { _id, _creationTime, ...fields } = hidden;
    const { _id: eventId, _creationTime: created, ...eventFields } = event;
    const other = await ctx.db.insert("events", { ...eventFields, slug: "foreign" });
    return ctx.db.insert("eventSlots", { ...fields, eventId: other });
  });
  for (const ids of [[foreignId], [hidden._id]]) {
    const beforeRejected = await read();
    await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...command, preservedSlotAssociationIds: ids[0] === hidden._id ? [] : [foreignId], retainedLineupAssociations: { participantIds: [], slotIds: ids } }), /Retained lineup association is invalid/);
    assert.deepEqual(await read(), beforeRejected);
  }
});


test("new browser staff creation persists manual and linked billing alongside timed rows", async () => {
  const { owner, t } = await fixture();
  const created = await owner.mutation(api.events.createCommunityEvent, { title: "Staff manual night", communitySlug: "club", startAt, timezone: "UTC", venueLabel: "Local venue", lineup: [
    { clientKey: "timed", position: 0, performerLabel: "Timed guest", startAt, endAt: startAt + 3_600_000 },
    { clientKey: "linked", position: 1, performerLabel: "Guest A", personSlug: "guest" },
    { clientKey: "manual", position: 2, performerLabel: "Unlinked guest" },
  ] });
  const editor = (await owner.query(api.events.getEditableBySlug, { slug: created.slug }))!;
  assert.equal(editor.usesCanonicalLineup, true);
  assert.equal(editor.venueLabel, "Local venue");
  assert.deepEqual(editor.lineup.map(row => [row.key, row.displayLabel, row.performer?.slug]), [[editor.slots[0]!.playbackKey, "Timed guest", undefined], ["linked", "Guest A", "guest"], ["manual", "Unlinked guest", undefined]]);
  assert.equal(editor.slots[0]!.clientKey, "timed");
  assert.equal(editor.slots[0]!.startAt, startAt);
  assert.equal((await t.run(ctx => ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", created.eventId)).collect()))[0]!.confirmationState, "confirmed");
});
