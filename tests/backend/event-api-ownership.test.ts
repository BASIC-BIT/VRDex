import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-07-24T12:00:00.000Z");

async function seedOwnedCommunity(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
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
      userId,
      identity: {
        subject: `${userId}|web-session`,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
    };
  });
}

describe("API-created event ownership", () => {
  it("lets the durable community owner edit and manage media from a normal session", async () => {
    const t = convexTest({ schema, modules });
    const { identity, userId } = await seedOwnedCommunity(t);
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Created through the public API.",
    });

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Edited through the normal web session.",
    });
    const media = await t.withIdentity(identity).mutation(api.events.configureVrcdnOutput, {
      currentSlug: created.slug,
      key: "main",
      label: "Main output",
    });

    assert.equal(media.state, "draft");
    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));
    assert.equal(stored?.summary, "Edited through the normal web session.");
  });

  it("preserves omitted values and clears explicit nullable fields and the world relation", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    await t.run((ctx) =>
      ctx.db.insert("worlds", {
        slug: "faceless-club",
        displayName: "Faceless Club",
        sortName: "faceless club",
        tags: [],
        visibilityStatus: "public",
        platformCompatibility: ["pc"],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "community",
        updatedAt: NOW,
      }),
    );
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      worldSlug: "faceless-club",
      startAt: NOW + 86_400_000,
      timezone: "UTC",
      summary: "Keep me until explicitly cleared.",
      notes: "Preserved when omitted.",
    });

    await t.mutation(internal.events.updateCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      currentSlug: created.slug,
      summary: null,
      timezone: null,
      worldSlug: null,
    });

    const result = await t.run(async (ctx) => {
      const event = await ctx.db.get(created.eventId);
      const worldLinks = await ctx.db
        .query("eventWorlds")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .collect();
      return { event, worldLinks };
    });
    assert.equal(result.event?.summary, undefined);
    assert.equal(result.event?.timezone, undefined);
    assert.equal(result.event?.notes, "Preserved when omitted.");
    assert.deepEqual(result.worldLinks, []);
  });

  it("does not clear the timezone while preserving existing event slots", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt,
      timezone: "UTC",
      participantLinks: [],
      slotLinks: [
        {
          displayLabel: "Opening set",
          startAt,
          endAt: startAt + 3_600_000,
        },
      ],
    });

    await assert.rejects(
      t.mutation(internal.events.updateCommunityEventForApiOwner, {
        actorKind: "personal_api_token",
        ownerUserId: userId,
        currentSlug: created.slug,
        timezone: null,
      }),
      /Time zone cannot be cleared while event slots are preserved/,
    );

    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));
    assert.equal(stored?.timezone, "UTC");
  });
});
