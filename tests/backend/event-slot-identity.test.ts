import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = { "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"), "../../convex/events.ts": () => import("../../convex/events") };
async function fixture() {
  const t = convexTest({ schema, modules });
  const subject = newClerkUserId();
  const personId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject, name: "Owner", emailVerificationTime: Date.now() });
    const common = { aliases: [], tags: [], claimState: "unclaimed" as const, publicationState: "published" as const, publicSurfacingState: "public" as const, creationSource: "community" as const, updatedAt: Date.now() };
    const profileId = await ctx.db.insert("profiles", { ...common, slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] } });
    await ctx.db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    return ctx.db.insert("profiles", { ...common, slug: "guest", displayName: "Guest", sortName: "guest", profileType: "person", person: { roleTags: [] }, outboundLinks: [{ type: "vrcdn", label: "Stream", source: "owner_authored", url: "vrcdn:guest" }] });
  });
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const startAt = Date.UTC(2027,9,15,20);
  const created = await owner.mutation(api.events.createCommunityEvent, { communitySlug: "club", title: "Slot night", startAt, timezone: "UTC", slotLinks: [{ personSlug: "guest", displayLabel: "Guest", roleLabel: "DJ", startAt, endAt: startAt + 3600000, selectedStreamId: "guest", sourceLabel: "Slot source", sourceUrl: "https://example.com/slot", notes: "Stored note" }] });
  const editable = await owner.query(api.events.getEditableBySlug, { slug: created.slug });
  assert.ok(editable);
  const slotId = editable.preservedSlotAssociationIds[0]!;
  return { t, owner, created, editable, slotId, personId, startAt };
}
for (const hidden of [false, true]) test(`legacy identity keeps ${hidden ? "private" : "public"} performer and unavailable stream through insertion, duration and start cascades`, async () => {
  const { t, owner, created, editable, slotId, personId, startAt } = await fixture();
  await t.run(ctx => ctx.db.patch(personId, { ...(hidden ? { publicationState: "draft_private" } : {}), outboundLinks: [] }));
  for (const [index, delta] of [900000, 1800000, 2700000].entries()) {
    await owner.mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug, communitySlug: "club", timezone: "UTC", startAt: startAt + index * 900000, preservedSlotAssociationIds: [slotId], preservedParticipantAssociationIds: editable.preservedParticipantAssociationIds,
      storedSlotAssociations: [{ position: 1, slotId }],
      slotLinks: [{ displayLabel: "Inserted", startAt: startAt + index * 900000, endAt: startAt + delta }, { ...(hidden ? {} : { personSlug: "guest" }), displayLabel: "Guest", roleLabel: "DJ", startAt: startAt + delta, endAt: startAt + delta + 2700000, selectedStreamId: "guest" }],
    });
    const slot = await t.run(ctx => ctx.db.get(slotId));
    assert.equal(slot?.personProfileId, personId);
    assert.equal(slot?.position, 1);
    assert.equal(slot?.startAt, startAt + delta);
    assert.equal(slot?.selectedStreamId, "guest");
    assert.equal(slot?.sourceLabel, "Slot source");
    assert.equal(slot?.sourceUrl, "https://example.com/slot");
    assert.equal(slot?.notes, "Stored note");
    assert.equal(slot?.roleLabel, "DJ");
  }
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "club", preservedSlotAssociationIds: [slotId], storedSlotAssociations: [], slotLinks: [] });
  assert.equal(await t.run(ctx => ctx.db.get(slotId)), null);
});

test("legacy slot mapping rejects cross-event, unsnapshotted, duplicate and invalid positions atomically", async () => {
  const { t, owner, created, slotId, startAt } = await fixture();
  const other = await owner.mutation(api.events.createCommunityEvent, { communitySlug: "club", title: "Other night", startAt, timezone: "UTC", slotLinks: [{ displayLabel: "Other", startAt }] });
  const otherRead = await owner.query(api.events.getEditableBySlug, { slug: other.slug });
  const foreignId = otherRead!.preservedSlotAssociationIds[0]!;
  const common = { currentSlug: created.slug, communitySlug: "club", slotLinks: [{ displayLabel: "Guest", startAt }], preservedSlotAssociationIds: [slotId] };
  for (const storedSlotAssociations of [
    [{ position: 0, slotId: foreignId }], [{ position: 0, slotId }, { position: 0, slotId }], [{ position: 1, slotId }], [{ position: -1, slotId }], [{ position: 0.5, slotId }],
  ]) await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...common, storedSlotAssociations }), /slot association/i);
  await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...common, preservedSlotAssociationIds: [], storedSlotAssociations: [{ position: 0, slotId }] }), /slot association/i);
  await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...common, preservedSlotAssociationIds: [slotId, foreignId], storedSlotAssociations: [{ position: 0, slotId: foreignId }] }), /slot association/i);
  await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...common, lineup: [], storedSlotAssociations: [] }), /slot association/i);
  await assert.rejects(owner.mutation(api.events.updateCommunityEvent, { ...common, slotLinks: [...common.slotLinks, { displayLabel: "Other", startAt: startAt + 3600000 }], storedSlotAssociations: [{ position: 0, slotId }, { position: 1, slotId }] }), /slot association/i);
  assert.ok(await t.run(ctx => ctx.db.get(slotId)));
  assert.ok(await t.run(ctx => ctx.db.get(foreignId)));
});

test("legacy identities follow sanitizer sorting and a deliberate performer replacement detaches the old link", async () => {
  const { t, owner, created, slotId, startAt } = await fixture();
  const result = await owner.mutation(api.events.updateCommunityEvent, {
    currentSlug: created.slug, communitySlug: "club", timezone: "UTC", preservedSlotAssociationIds: [slotId], storedSlotAssociations: [{ position: 0, slotId }],
    slotLinks: [{ displayLabel: "Unmatched replacement", roleLabel: "Host", startAt: startAt + 3600000 }, { displayLabel: "New first", startAt }],
  });
  const slot = await t.run(ctx => ctx.db.get(slotId));
  assert.equal(slot?.position, 1);
  assert.equal(slot?.personProfileId, undefined);
  assert.equal(slot?.selectedStreamId, undefined);
  assert.equal(slot?.sourceUrl, "https://example.com/slot");
  assert.deepEqual(result.storedSlotAssociations?.find(row => row.slotId === slotId), { position: 0, slotId });
});

test("legacy clearing an end retains the exact stored slot and source across repeated saves", async () => {
  const { t, owner, created, editable, slotId, personId, startAt } = await fixture();
  await t.run(ctx => ctx.db.patch(slotId, { startAt: startAt + 10_123, endAt: startAt + 3_630_456 }));
  const before = await t.run(ctx => ctx.db.get(slotId));
  for (const save of [1, 2]) {
    await owner.mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug, communitySlug: "club", timezone: "UTC", preservedSlotAssociationIds: [slotId], preservedParticipantAssociationIds: editable.preservedParticipantAssociationIds,
      storedSlotAssociations: [{ position: 0, slotId }],
      slotLinks: [{ personSlug: "guest", displayLabel: "Guest", roleLabel: "DJ", startAt: startAt + 10_123, selectedStreamId: "guest" }],
    });
    const current = await t.run(ctx => ctx.db.get(slotId));
    assert.ok(current, `save ${save}`);
    assert.equal(current.endAt, undefined);
    assert.equal(current.startAt, startAt + 10_123);
    assert.equal(current.personProfileId, personId);
    for (const field of ["selectedStreamId", "sourceType", "sourceLabel", "sourceUrl", "notes"] as const) assert.equal(current[field], before![field]);
    const result = await owner.query(api.events.getEditableBySlug, { slug: created.slug });
    assert.equal(result!.slots[0]!.endAt, undefined);
    assert.equal(result!.slots[0]!.startAt, startAt + 10_123);
    assert.equal(result!.endAt, editable.endAt);
    assert.deepEqual(result!.preservedSlotAssociationIds, [slotId]);
  }
});
