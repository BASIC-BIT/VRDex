import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

async function fixture() {
  const t = convexTest({ schema, modules: { "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"), "../../convex/events.ts": () => import("../../convex/events") } });
  const subject = newClerkUserId();
  const seeded = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject, name: "Owner", emailVerificationTime: Date.now() });
    const profileId = await ctx.db.insert("profiles", { slug: "location-club", displayName: "Location Club", sortName: "location club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    await ctx.db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
    const worlds = await Promise.all(["harbor", "extra", "private", "replacement", "third"].map(slug => ctx.db.insert("worlds", { slug, displayName: slug, sortName: slug, tags: [], visibilityStatus: "public", platformCompatibility: [], media: [], creatorAttributions: [], outboundLinks: [], publicationState: slug === "private" ? "draft_private" : "published", creationSource: "community", updatedAt: Date.now() })));
    return { worlds };
  });
  const owner = t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const created = await owner.mutation(api.events.createCommunityEvent, { communitySlug: "location-club", title: "Location night", startAt: Date.UTC(2027, 9, 15, 20), timezone: "UTC", worldSlug: "harbor", published: true });
  const first = await owner.query(api.events.getEditableBySlug, { slug: created.slug });
  assert.ok(first);
  await t.run(async ctx => {
    const original = await ctx.db.get(first.preservedWorldAssociationIds[0]!);
    assert.ok(original);
    for (const worldId of seeded.worlds.slice(1, 3)) {
      const { _id, _creationTime, ...fields } = original;
      void _id; void _creationTime;
      await ctx.db.insert("eventWorlds", { ...fields, worldId, confidence: 0.4, confirmationState: worldId === seeded.worlds[1] ? "confirmed" : "unconfirmed", notes: "Retained evidence" });
    }
  });
  const read = () => owner.query(api.events.getEditableBySlug, { slug: created.slug });
  return { t, owner, read, created };
}

test("editor world replacement and clear retain every unrepresented public/private association across repeated saves", async () => {
  const { owner, read, created } = await fixture();
  let current = (await read())!;
  assert.equal(current.editableWorldAssociation?.worldSlug, "harbor");
  const originalIds = current.preservedWorldAssociationIds;
  const represented = current.editableWorldAssociation!.associationId;
  const extraIds = originalIds.filter(id => id !== represented);
  await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "location-club", title: "Changed title", venueLabel: "Custom pier", preservedWorldAssociationIds: originalIds });
  current = (await read())!;
  assert.deepEqual(current.preservedWorldAssociationIds, originalIds);
  assert.equal(current.venueLabel, "Custom pier");
  let mapping = current.editableWorldAssociation;
  let ids = current.preservedWorldAssociationIds;
  for (const worldSlug of ["replacement", "third", null]) {
    const result = await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "location-club", worldSlug, preservedWorldAssociationIds: ids.filter(id => id !== mapping?.associationId) });
    current = (await read())!;
    assert.ok(extraIds.every(id => current.preservedWorldAssociationIds.includes(id)));
    assert.equal(current.preservedWorldAssociationIds.length, worldSlug ? 3 : 2);
    assert.equal(current.venueLabel, "Custom pier");
    mapping = result.editableWorldAssociation ?? undefined;
    assert.equal(mapping?.worldSlug, worldSlug ?? undefined);
    ids = result.preservedWorldAssociationIds;
  }
  const publicEvent = await owner.query(api.events.getPublicBySlug, { slug: created.slug });
  assert.ok(publicEvent);
  assert.equal("editableWorldAssociation" in publicEvent, false);
  assert.equal(publicEvent.worlds.some(world => world.slug === "private"), false);
});

test("selecting a retained public world avoids a duplicate and clearing it preserves the private world", async () => {
  const { owner, read, created } = await fixture();
  const current = (await read())!;
  const result = await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "location-club", worldSlug: "extra", preservedWorldAssociationIds: current.preservedWorldAssociationIds.filter(id => id !== current.editableWorldAssociation?.associationId) });
  assert.equal(result.preservedWorldAssociationIds.length, 2);
  assert.equal(result.editableWorldAssociation?.worldSlug, "extra");
  const cleared = await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "location-club", worldSlug: null, preservedWorldAssociationIds: result.preservedWorldAssociationIds.filter(id => id !== result.editableWorldAssociation?.associationId) });
  assert.equal(cleared.preservedWorldAssociationIds.length, 1);
  assert.equal((await read())!.worlds.length, 0);
});


test("a world becoming private after editor readback survives an explicit manual switch", async () => {
  const { t, owner, read, created } = await fixture();
  const snapshot = (await read())!;
  const represented = snapshot.editableWorldAssociation!;
  await t.run(async ctx => {
    const association = await ctx.db.get(represented.associationId);
    assert.ok(association);
    await ctx.db.patch(association.worldId, { publicationState: "draft_private" });
  });
  const result = await owner.mutation(api.events.updateCommunityEvent, { currentSlug: created.slug, communitySlug: "location-club", worldSlug: null, preservedWorldAssociationIds: snapshot.preservedWorldAssociationIds.filter(id => id !== represented.associationId) });
  assert.deepEqual(result.preservedWorldAssociationIds, snapshot.preservedWorldAssociationIds);
  assert.equal(result.editableWorldAssociation, null);
  const current = (await read())!;
  assert.equal(current.worlds.some(world => world.slug === "harbor"), false);
  assert.equal(current.editableWorldAssociation?.worldSlug, "extra");
});
