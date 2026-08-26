import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
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

async function seedUser(t: ReturnType<typeof convexTest>, name: string) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      emailVerificationTime: NOW,
    });

    return {
      userId,
      identity: {
        subject: clerkUserId,
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
    };
  });
}

describe("API-created event ownership", () => {
  it("lets a current community owner create a private draft with an audit record", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);

    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Faceless Friday",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
      summary: "Browser-authored draft.",
    });
    const managed = await t.withIdentity(identity).query(api.events.listManagedCommunities, {});
    assert.deepEqual(managed.map((community) => community.slug), ["faceless"]);
    const managedEvents = await t.withIdentity(identity).query(api.events.listManagedEvents, {});
    assert.equal(managedEvents[0]?.title, "Faceless Friday");
    assert.equal(managedEvents[0]?.publicationState, "draft_private");
    const result = await t.run(async (ctx) => ({
      event: await ctx.db.get(created.eventId),
      audits: await ctx.db
        .query("eventAuditEvents")
        .withIndex("by_eventId_createdAt", (query) => query.eq("eventId", created.eventId))
        .collect(),
    }));

    assert.equal(result.event?.publicationState, "draft_private");
    assert.equal(result.event?.eventStatus, "scheduled");
    assert.equal(result.event?.publishedAt, undefined);
    assert.equal(result.audits.length, 1);
    assert.equal(result.audits[0]?.action, "created");
    assert.equal(result.audits[0]?.actorSurface, "browser");
    const history = await t.withIdentity(identity).query(api.events.listEventAudit, {
      currentSlug: created.slug,
    });
    assert.equal(history[0]?.action, "created");
    assert.equal("tokenIdentifier" in (history[0] ?? {}), false);
  });

  it("publishes, cancels, and restores an authorized draft without leaking cancelled discovery", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Faceless Saturday",
      communitySlug: "faceless",
      startAt,
      endAt: startAt + 3_600_000,
      timezone: "UTC",
    });
    const managed = await t.withIdentity(identity).query(api.events.listManagedCommunities, {});
    assert.deepEqual(managed.map((community) => community.slug), ["faceless"]);

    assert.equal(
      await t.query(api.events.getPublicBySlug, { slug: created.slug }),
      null,
    );
    const editable = await t.withIdentity(identity).query(api.events.getEditableBySlug, {
      slug: created.slug,
    });
    assert.equal(editable?.publicationState, "draft_private");

    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: created.slug,
      published: true,
    });
    const published = await t.query(api.events.getPublicBySlug, { slug: created.slug });
    assert.equal(published?.status, "scheduled");
    const timezoneVocabulary = await t.run((ctx) =>
      ctx.db
        .query("vocabularyTerms")
        .withIndex("by_scope_key", (query) => query.eq("scope", "event_tag").eq("key", "utc"))
        .unique(),
    );
    assert.equal(timezoneVocabulary?.label, "UTC");

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
        currentSlug: created.slug,
        cancelled: true,
      }),
      /cancellation reason is required/i,
    );
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: created.slug,
      cancelled: true,
      reason: "The venue is unavailable.",
    });
    assert.equal(
      (await t.query(api.events.getPublicBySlug, { slug: created.slug }))?.status,
      "cancelled",
    );
    assert.deepEqual(
      await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 }),
      [],
    );
    const cancelledSearchDocument = await t.run((ctx) =>
      ctx.db
        .query("searchDocuments")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .unique(),
    );
    assert.equal(cancelledSearchDocument?.publicState, "hidden");

    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: created.slug,
      cancelled: false,
    });
    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 });
    assert.equal(upcoming[0]?.slug, created.slug);
    assert.equal(upcoming[0]?.status, "scheduled");
    const restoredSearchDocument = await t.run((ctx) =>
      ctx.db
        .query("searchDocuments")
        .withIndex("by_eventId", (query) => query.eq("eventId", created.eventId))
        .unique(),
    );
    assert.equal(restoredSearchDocument?.publicState, "public");
  });

  it("fills the requested discovery limit after excluding cancelled events", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const first = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Cancelled opener",
      communitySlug: "faceless",
      startAt: NOW + 3_600_000,
    });
    const second = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Scheduled headliner",
      communitySlug: "faceless",
      startAt: NOW + 7_200_000,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: first.slug,
      published: true,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: second.slug,
      published: true,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventCancelled, {
      currentSlug: first.slug,
      cancelled: true,
      reason: "Cancelled for test coverage.",
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 1 });
    assert.deepEqual(upcoming.map((event) => event.slug), [second.slug]);
  });

  it("keeps a published event online when an atomic unpublish-and-save fails", async () => {
    const t = convexTest({ schema, modules });
    const { identity } = await seedOwnedCommunity(t);
    const startAt = NOW + 86_400_000;
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Atomic event",
      communitySlug: "faceless",
      startAt,
    });
    await t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
      currentSlug: created.slug,
      published: true,
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: created.slug,
        published: false,
        title: "Broken draft edit",
        communitySlug: "faceless",
        startAt,
        participantLinks: [{ personSlug: "missing-performer" }],
      }),
      /person profile/i,
    );
    assert.equal(
      (await t.query(api.events.getPublicBySlug, { slug: created.slug }))?.title,
      "Atomic event",
    );

    await t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
      currentSlug: created.slug,
      published: false,
      title: "Saved private draft",
      communitySlug: "faceless",
      startAt,
    });
    assert.equal(await t.query(api.events.getPublicBySlug, { slug: created.slug }), null);
    assert.equal(
      (await t.withIdentity(identity).query(api.events.getEditableBySlug, { slug: created.slug }))
        ?.title,
      "Saved private draft",
    );
  });

  it("refuses an authenticated user without current community authority", async () => {
    const t = convexTest({ schema, modules });
    const { identity: ownerIdentity } = await seedOwnedCommunity(t);
    const { identity } = await seedUser(t, "Unrelated User");

    const owned = await t.withIdentity(ownerIdentity).mutation(api.events.createCommunityEvent, {
      title: "Owner Event",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
        title: "Impersonated Event",
        communitySlug: "faceless",
        startAt: NOW + 86_400_000,
      }),
      /do not have permission to create events for this community/,
    );
    await assert.rejects(
      t.withIdentity(identity).query(api.events.listEventAudit, {
        currentSlug: owned.slug,
      }),
      /do not have permission/i,
    );
  });

  it("lets active manage_events staff create a draft and refuses them after revocation", async () => {
    const t = convexTest({ schema, modules });
    const { profileId } = await seedOwnedCommunity(t);
    const { identity } = await seedUser(t, "Event Staff");
    const authorityId = await t.run((ctx) =>
      ctx.db.insert("communityAuthorities", {
        communityProfileId: profileId,
        subjectTokenIdentifier: identity.tokenIdentifier,
        subject: {
          tokenIdentifier: identity.tokenIdentifier,
          issuer: identity.issuer,
          subject: identity.subject,
        },
        roleKey: "event_staff",
        roleLabel: "Event staff",
        capabilities: ["manage_events"],
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      }),
    );
    assert.deepEqual(
      (await t.withIdentity(identity).query(api.events.listManagedCommunities, {})).map(
        (community) => community.slug,
      ),
      ["faceless"],
    );
    const created = await t.withIdentity(identity).mutation(api.events.createCommunityEvent, {
      title: "Staff Programmed Night",
      communitySlug: "faceless",
      startAt: NOW + 86_400_000,
    });
    assert.equal(
      (await t.run((ctx) => ctx.db.get(created.eventId)))?.publicationState,
      "draft_private",
    );
    assert.equal(
      (await t.withIdentity(identity).query(api.events.listManagedEvents, {}))[0]?.eventId,
      created.eventId,
    );

    await t.run((ctx) =>
      ctx.db.patch(authorityId, { state: "revoked", revokedAt: NOW + 1, updatedAt: NOW + 1 }),
    );
    assert.deepEqual(
      await t.withIdentity(identity).query(api.events.listManagedCommunities, {}),
      [],
    );
    assert.deepEqual(
      await t.withIdentity(identity).query(api.events.listManagedEvents, {}),
      [],
    );
    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.setCommunityEventPublished, {
        currentSlug: created.slug,
        published: true,
      }),
      /do not have permission/i,
    );
  });

  it("does not preserve submitter authority on a community-linked event", async () => {
    const t = convexTest({ schema, modules });
    const { profileId } = await seedOwnedCommunity(t);
    const { identity, userId } = await seedUser(t, "Former Submitter");
    const eventId = await t.run((ctx) =>
      ctx.db.insert("events", {
        slug: "former-submitter-event",
        title: "Former Submitter Event",
        sortTitle: "former submitter event",
        startAt: NOW + 86_400_000,
        communityProfileId: profileId,
        communityName: "The Faceless",
        sourceType: "community",
        sourceLabel: "Community submitted",
        submitter: {
          tokenIdentifier: `test|${userId}`,
          issuer: "test",
          subject: identity.subject,
        },
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: NOW,
        updatedAt: NOW,
      }),
    );

    await assert.rejects(
      t.withIdentity(identity).mutation(api.events.updateCommunityEvent, {
        currentSlug: "former-submitter-event",
        title: "Changed by Former Submitter",
        communitySlug: "faceless",
        startAt: NOW + 86_400_000,
      }),
      /do not have permission to update this event/,
    );
    const event = await t.run((ctx) => ctx.db.get(eventId));
    assert.equal(event?.title, "Former Submitter Event");
  });

  it("keeps an in-progress event in the public upcoming query", async () => {
    const t = convexTest({ schema, modules });
    const { userId } = await seedOwnedCommunity(t);
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: userId,
      title: "Faceless In Progress",
      communitySlug: "faceless",
      startAt: NOW - 3_600_000,
      endAt: NOW + 3_600_000,
      timezone: "UTC",
      slotLinks: [
        {
          displayLabel: "Finished DJ",
          startAt: NOW - 3_600_000,
          endAt: NOW - 60_000,
        },
        {
          displayLabel: "Current DJ",
          startAt: NOW,
          endAt: NOW + 3_600_000,
        },
      ],
    });

    const upcoming = await t.query(api.events.listPublicUpcoming, { now: NOW, limit: 8 });
    assert.equal(upcoming[0]?.slug, created.slug);
    assert.deepEqual(upcoming[0]?.nextSlots.map((slot) => slot.displayLabel), ["Current DJ"]);
  });

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

    for (const timezone of [null, "", "   "]) {
      await assert.rejects(
        t.mutation(internal.events.updateCommunityEventForApiOwner, {
          actorKind: "personal_api_token",
          ownerUserId: userId,
          currentSlug: created.slug,
          timezone,
        }),
        /Time zone cannot be cleared while event slots are preserved/,
      );
    }

    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));
    assert.equal(stored?.timezone, "UTC");
  });
});
