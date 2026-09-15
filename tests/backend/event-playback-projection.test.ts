import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

import { publicProfileOutboundLinks, toPublicProfile } from "../../convex/_profilePublic";
import { sanitizeEventSlotInputs } from "../../convex/_eventSlots";
import { resolveEventStream } from "../../convex/_eventPlayback";
import { PublicEventSchema } from "../../packages/api-contracts/src/schemas";
import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/search.ts": () => import("../../convex/search"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-07-24T12:00:00.000Z");

async function seedOwnedCommunity(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId,
      name: "Community Owner",
      email: "owner@example.com",
      emailVerificationTime: NOW,
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: "faceless",
      displayName: "The Faceless",
      sortName: "the faceless",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: NOW,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: NOW,
      updatedAt: NOW,
    });

    return {
      profileId,
      userId,
      identity: {
        subject: clerkUserId, emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
    };
  });
}


describe("event performer stream contracts", () => {
  it("persists a browser selection and serializes the resolved public roster", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        slug: "stream-person", displayName: "Stream Person", sortName: "stream person",
        aliases: [], tags: [], claimState: "unclaimed", publicationState: "published",
        publicSurfacingState: "public", creationSource: "community", updatedAt: NOW,
        profileType: "person", person: { roleTags: [] },
        outboundLinks: [{ type: "other", label: "Stream", source: "owner_authored", url: "vrcdn:alpha" }],
      });
    });
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Lineup", communitySlug: "faceless", startAt: NOW, timezone: "UTC", published: true,
      watchMode: "performer_sequence",
      slotLinks: [{ personSlug: "stream-person", displayLabel: "Person", startAt: NOW, selectedStreamId: "alpha" }],
    });
    const event = PublicEventSchema.parse(await t.query(api.events.getPublicBySlug, { slug: created.slug }));
    assert.equal(event.watchMode, "performer_sequence");
    assert.equal(event.slots?.[0]?.stream?.streamId, "alpha");
    assert.ok(event.slots?.[0]?.playbackKey);
    assert.deepEqual(event.slots?.[0]?.performer?.outboundLinks, event.participants?.[0]?.outboundLinks);
  });
});



async function lineupFixture() {
  const t = convexTest({ schema, modules });
  const owner = await seedOwnedCommunity(t);
  const personId = await t.run((ctx) => ctx.db.insert("profiles", {
    slug: "performer", displayName: "Performer", sortName: "performer", aliases: [], tags: [],
    claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public",
    creationSource: "community", updatedAt: NOW, profileType: "person", person: { roleTags: [] },
    outboundLinks: [
      { type: "vrcdn", label: "PC", url: "rtspt://stream.vrcdn.live/live/alpha", source: "owner_authored" },
      { type: "vrcdn", label: "Quest", url: "https://stream.vrcdn.live/live/alpha.live.ts", source: "owner_authored" },
      { type: "website", label: "Site", url: "https://example.com/", source: "owner_authored" },
    ],
  }));
  const draft = {
    title: "Lineup", communitySlug: "faceless", startAt: NOW, timezone: "UTC",
    watchMode: "performer_sequence" as const, participantLinks: [],
    slotLinks: [
      { personSlug: "performer", displayLabel: "First", startAt: NOW, selectedStreamId: "alpha" },
      { personSlug: "performer", displayLabel: "Again", startAt: NOW + 60_000 },
      { displayLabel: "Open decks", startAt: NOW + 120_000 },
    ],
  };
  const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
    ...draft, ownerUserId: owner.userId, actorKind: "personal_api_token",
  });
  const read = async () => PublicEventSchema.parse(await t.query(api.events.getPublicBySlug, { slug: created.slug }));
  return { t, owner, personId, draft, created, read };
}

it("deduplicates source variants while preserving repeat appearances and freeform slots", async () => {
  const { t, personId, read } = await lineupFixture();
  const event = await read();
  assert.equal(event.slots?.length, 3);
  assert.equal(new Set(event.slots?.map((slot) => slot.playbackKey)).size, 3);
  assert.equal(event.slots?.[0]?.stream?.pcUrl, "rtspt://stream.vrcdn.live/live/alpha");
  assert.equal(event.slots?.[1]?.stream?.streamId, "alpha");
  assert.equal(event.slots?.[2]?.displayLabel, "Open decks");
  assert.equal(event.slots?.[2]?.stream, undefined);
  const profile = await t.run((ctx) => ctx.db.get(personId));
  assert.ok(profile);
  assert.deepEqual(event.participants?.[0]?.outboundLinks, publicProfileOutboundLinks(profile, "discovery"));
  const choices = await t.query(api.events.getPersonStreamChoices, { slug: "performer" });
  assert.deepEqual(choices.map((choice) => choice.streamId), ["alpha"]);
});

for (const visibility of ["unlisted", "private"] as const) {
  it(`excludes ${visibility} links from roster, choices, and new membership`, async () => {
    const { t, owner, personId, draft, read } = await lineupFixture();
    await t.run((ctx) => ctx.db.patch(personId, { fieldVisibility: { outboundLinks: visibility } }));
    const profile = await t.run((ctx) => ctx.db.get(personId));
    assert.ok(profile);
    assert.equal(toPublicProfile(profile).outboundLinks.length, visibility === "unlisted" ? 3 : 0);
    const event = await read();
    assert.deepEqual(event.participants?.[0]?.outboundLinks, []);
    assert.equal(event.slots?.[0]?.stream, undefined);
    assert.deepEqual(await t.query(api.events.getPersonStreamChoices, { slug: "performer" }), []);
    await assert.rejects(t.mutation(internal.events.createCommunityEventForApiOwner, {
      ...draft, ownerUserId: owner.userId, actorKind: "personal_api_token",
    }), /Selected stream must belong/);
  });
}

it("keeps a removed explicit choice unavailable across partial updates and editor round trips", async () => {
  const { t, owner, personId, draft, created, read } = await lineupFixture();
  await t.run((ctx) => ctx.db.patch(personId, {
    outboundLinks: [{ type: "vrcdn", label: "New", url: "vrcdn:beta", source: "owner_authored" }],
  }));
  await t.mutation(internal.events.updateCommunityEventForApiOwner, {
    currentSlug: created.slug, ownerUserId: owner.userId, actorKind: "personal_api_token", summary: "Changed",
  });
  const event = await read();
  assert.equal(event.watchMode, "performer_sequence");
  assert.equal(event.slots?.[0]?.stream, undefined);
  assert.equal(event.slots?.[1]?.stream?.streamId, "beta");
  const editable = await t.withIdentity(owner.identity).query(api.events.getEditableBySlug, { slug: created.slug });
  assert.equal(editable?.slots[0]?.selectedStreamId, "alpha");
  assert.deepEqual(editable?.slots[0]?.streamChoices.map((choice) => choice.streamId), ["beta"]);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, {
    ...draft, currentSlug: created.slug, preservedSlotAssociationIds: editable?.preservedSlotAssociationIds,
    preservedParticipantAssociationIds: editable?.preservedParticipantAssociationIds,
  });
  assert.equal((await read()).slots?.[0]?.stream, undefined);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, {
    ...draft, currentSlug: created.slug, preservedSlotAssociationIds: editable?.preservedSlotAssociationIds,
    slotLinks: draft.slotLinks.map((slot) => ({ ...slot, selectedStreamId: null })),
  });
  assert.equal((await read()).slots?.[0]?.stream?.streamId, "beta");
});

it("retains a hidden performer association and selection without exposing identity", async () => {
  const { t, owner, personId, draft, created, read } = await lineupFixture();
  await t.run((ctx) => ctx.db.patch(personId, { publicationState: "draft_private" }));
  const editable = await t.withIdentity(owner.identity).query(api.events.getEditableBySlug, { slug: created.slug });
  assert.ok(editable);
  assert.equal(editable.slots[0]?.performer, undefined);
  assert.equal(editable.slots[0]?.selectedStreamId, "alpha");
  assert.deepEqual(editable.slots[0]?.streamChoices, []);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, {
    ...draft, currentSlug: created.slug,
    slotLinks: draft.slotLinks.map(({ personSlug: _person, ...slot }) => slot),
    preservedSlotAssociationIds: editable.preservedSlotAssociationIds,
    preservedParticipantAssociationIds: editable.preservedParticipantAssociationIds,
  });
  assert.equal((await read()).slots?.[0]?.performer, undefined);
  await t.run((ctx) => ctx.db.patch(personId, { publicationState: "published" }));
  assert.equal((await read()).slots?.[0]?.performer?.slug, "performer");
  assert.equal((await read()).slots?.[0]?.stream?.streamId, "alpha");
});

it("rejects malformed, reserved and foreign choices; ambiguous choices stay unresolved", async () => {
  for (const selectedStreamId of ["a", "login", "alpha/beta", "https://example.com", "a".repeat(129)]) {
    assert.throws(() => sanitizeEventSlotInputs([{ displayLabel: "Slot", startAt: NOW, selectedStreamId }], "Source"), /invalid/);
  }
  const { t, owner, draft, personId, read } = await lineupFixture();
  await assert.rejects(t.mutation(internal.events.createCommunityEventForApiOwner, {
    ...draft, ownerUserId: owner.userId, actorKind: "personal_api_token",
    slotLinks: [{ ...draft.slotLinks[0]!, selectedStreamId: "foreign" }],
  }), /Selected stream must belong/);
  await t.run((ctx) => ctx.db.patch(personId, {
    outboundLinks: ["alpha", "beta"].map((id) => ({ type: "vrcdn" as const, label: id, url: `vrcdn:${id}`, source: "owner_authored" as const })),
  }));
  assert.equal((await read()).slots?.[0]?.stream?.streamId, "alpha");
  assert.equal((await read()).slots?.[1]?.stream, undefined);
  assert.equal(resolveEventStream([], undefined), undefined);
});

it("removes playable data on cancellation and hides unpublished event queries", async () => {
  const { t, created, read } = await lineupFixture();
  await t.run((ctx) => ctx.db.patch(created.eventId, { eventStatus: "cancelled" }));
  assert.ok((await read()).slots?.every((slot) => slot.stream === undefined));
  await t.run((ctx) => ctx.db.patch(created.eventId, { publicationState: "draft_private" }));
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: created.slug }), null);
});

it("does not invent a live source from a direct VRCDN video file", async () => {
  const { t, personId } = await lineupFixture();
  await t.run((ctx) => ctx.db.patch(personId, {
    outboundLinks: [{ type: "vrcdn", label: "Recording", url: "https://stream.vrcdn.live/live/recording.mp4", source: "owner_authored" }],
  }));
  assert.deepEqual(await t.query(api.events.getPersonStreamChoices, { slug: "performer" }), []);
});
