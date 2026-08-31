import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import { createEventSearchDocument } from "../../convex/_searchDocuments";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileArchival.ts": () => import("../../convex/profileArchival"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
  "../../convex/suppressions.ts": () => import("../../convex/suppressions"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;
const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const actor = {
  tokenIdentifier: "operator:vrdex",
  issuer: "vrdex",
  subject: "archival-tests",
};
const REASON = "Display name is a pasted URL, not a person.";

async function seedProfile(
  t: ReturnType<typeof convexTest>,
  overrides: {
    slug?: string;
    claimState?: "unclaimed" | "claimed_verified";
    profileType?: "person" | "community";
    publicSurfacingState?: "public" | "opted_out" | "suppressed" | "archived";
  } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("profiles", {
      displayName: "Junk Row",
      slug: overrides.slug ?? "junk-row",
      sortName: "junk row",
      profileType: overrides.profileType ?? "person",
      claimState: overrides.claimState ?? "unclaimed",
      creationSource: "import",
      publicationState: "published",
      publicSurfacingState: overrides.publicSurfacingState ?? "public",
      publicSurfacingUpdatedAt: NOW,
      publishedAt: NOW,
      updatedAt: NOW,
      aliases: [],
      tags: [],
      ...(overrides.profileType === "community"
        ? { community: { categoryTags: [] } }
        : { person: { roleTags: ["DJ"] } }),
    });
  });
}

async function signIn(t: ReturnType<typeof convexTest>, { superAdmin }: { superAdmin: boolean }) {
  return await t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", { clerkUserId, name: "Operator" });

    if (superAdmin) {
      await ctx.db.insert("accountFeatureGrants", {
        userId,
        feature: "super_admin",
        state: "active",
        grantedBy: actor,
        grantedAt: NOW,
        updatedAt: NOW,
      });
    }

    return { subject: clerkUserId, emailVerified: true };
  });
}

describe("superadmin profile archival", () => {
  it("continues past a hidden legacy profile when a published world shares its slug", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, {
      slug: "legacy-duplicate",
      publicSurfacingState: "archived",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("worlds", {
        slug: "legacy-duplicate",
        displayName: "Legacy Duplicate World",
        sortName: "legacy duplicate world",
        tags: [],
        visibilityStatus: "public",
        platformCompatibility: ["pc"],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "self",
        updatedAt: NOW,
      });
    });

    assert.deepEqual(
      await t.query(api.profiles.getPublicShareCardBySlug, { slug: "legacy-duplicate" }),
      { entityType: "world", profile: null },
    );
  });

  it("hides an archived profile from every public read", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);
    const identity = await signIn(t, { superAdmin: true });

    const result = await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "junk-row",
      archived: true,
      reason: REASON,
    });

    assert.equal(result.changed, true);
    assert.equal(result.publicSurfacingState, "archived");

    const stored = await t.run(async (ctx) => await ctx.db.get(profileId));
    assert.equal(stored?.publicSurfacingState, "archived");
    assert.equal(stored?.publicSurfacingReason, REASON);

    // The slug is kept on purpose: releasing it would let a later import take
    // the name and resurrect the identity under a new row.
    assert.equal(stored?.slug, "junk-row");

    const publicRead = await t.query(api.profiles.getPublicBySlug, { slug: "junk-row" });
    assert.equal(publicRead, null);

    // Cleared on the way back, because the field explains why a row is hidden
    // and a public profile carrying one contradicts its own state. The note is
    // not lost: the audit event keeps it, which is where a past decision belongs.
    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "junk-row",
      archived: false,
      reason: "Archived in error; the row is a real person.",
    });

    const restored = await t.run(async (ctx) => await ctx.db.get(profileId));
    assert.equal(restored?.publicSurfacingState, "public");
    assert.equal(restored?.publicSurfacingReason, undefined);
    assert.notEqual(await t.query(api.profiles.getPublicBySlug, { slug: "junk-row" }), null);
  });

  it("reindexes hosted event links when a community is hidden or restored", async () => {
    const t = convexTest({ schema, modules });
    const communityId = await seedProfile(t, {
      slug: "afterglow",
      profileType: "community",
    });
    const identity = await signIn(t, { superAdmin: true });

    const eventId = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", {
        slug: "harbor-sessions",
        title: "Harbor Sessions",
        sortTitle: "harbor sessions",
        startAt: NOW + 3_600_000,
        communityProfileId: communityId,
        communityName: "Afterglow",
        sourceType: "community",
        sourceLabel: "Afterglow",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const [event, community] = await Promise.all([
        ctx.db.get(eventId),
        ctx.db.get(communityId),
      ]);

      assert.notEqual(event, null);
      assert.notEqual(community, null);
      await ctx.db.insert(
        "searchDocuments",
        createEventSearchDocument(event!, { community: community! }),
      );
      return eventId;
    });

    const indexedEvent = async () =>
      await t.run(async (ctx) =>
        await ctx.db
          .query("searchDocuments")
          .withIndex("by_eventId", (query) => query.eq("eventId", eventId))
          .unique(),
      );

    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "afterglow",
      archived: true,
      reason: REASON,
    });
    assert.equal((await indexedEvent())?.publicState, "hidden");
    assert.equal((await indexedEvent())?.routePath, "/");

    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "afterglow",
      archived: false,
      reason: "Archived in error; the community is active.",
    });
    assert.equal((await indexedEvent())?.publicState, "public");
    assert.equal((await indexedEvent())?.routePath, "/afterglow/events/harbor-sessions");
  });

  it("refuses a caller without the super_admin grant", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t);
    const identity = await signIn(t, { superAdmin: false });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "junk-row",
        archived: true,
        reason: REASON,
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "SUPER_ADMIN_REQUIRED",
    );
  });

  it("makes a superadmin say out loud that the profile is claimed", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, { claimState: "claimed_verified" });
    const identity = await signIn(t, { superAdmin: true });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "junk-row",
        archived: true,
        reason: REASON,
      }),
      (error: { data?: { code?: string } }) =>
        error.data?.code === "CLAIMED_PROFILE_NEEDS_CONFIRMATION",
    );

    // Complete authority, but not by accident: confirmation is all it takes.
    const confirmed = await t
      .withIdentity(identity)
      .mutation(api.profileArchival.setProfileArchived, {
        slug: "junk-row",
        archived: true,
        reason: REASON,
        confirmClaimed: true,
      });

    assert.equal(confirmed.publicSurfacingState, "archived");
  });

  it("restores an archived profile and refuses to resolve a suppression", async () => {
    const t = convexTest({ schema, modules });
    const archivedId = await seedProfile(t, {
      slug: "archived-row",
      publicSurfacingState: "archived",
    });
    await seedProfile(t, { slug: "opted-out-row", publicSurfacingState: "opted_out" });
    const identity = await signIn(t, { superAdmin: true });

    const restored = await t
      .withIdentity(identity)
      .mutation(api.profileArchival.setProfileArchived, {
        slug: "archived-row",
        archived: false,
        reason: "Archived in error; the row is a real person.",
      });

    assert.equal(restored.publicSurfacingState, "public");
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(archivedId)))?.publicSurfacingState,
      "public",
    );

    // Un-archiving a profile somebody asked to have hidden would resolve their
    // request as a side effect, through a path with no reviewer and no record.
    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "opted-out-row",
        archived: false,
        reason: "Trying to undo an opt-out through the archival path.",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "NOT_ARCHIVED",
    );
  });

  it("refuses to archive over a suppression rather than overwrite it", async () => {
    const t = convexTest({ schema, modules });
    const optedOutId = await seedProfile(t, {
      slug: "opted-out-row",
      publicSurfacingState: "opted_out",
    });
    await seedProfile(t, { slug: "suppressed-row", publicSurfacingState: "suppressed" });
    const identity = await signIn(t, { superAdmin: true });

    for (const slug of ["opted-out-row", "suppressed-row"]) {
      await assert.rejects(
        t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
          slug,
          archived: true,
          reason: REASON,
        }),
        (error: { data?: { code?: string } }) =>
          error.data?.code === "SUPPRESSION_OUTRANKS_ARCHIVAL",
      );
    }

    // The state survives, which is the point: archiving over it and then
    // un-archiving would have republished a profile somebody opted out of,
    // through a path that never read the request.
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(optedOutId)))?.publicSurfacingState,
      "opted_out",
    );
  });

  it("puts the discovery terms back when a profile is restored", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t);
    const identity = await signIn(t, { superAdmin: true });

    const usage = async () =>
      await t.run(async (ctx) => {
        const terms = await ctx.db.query("vocabularyTerms").collect();
        return terms.map((term) => term.usageCount ?? 0).reduce((total, n) => total + n, 0);
      });

    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "junk-row",
      archived: true,
      reason: REASON,
    });

    // The fixture is inserted straight into the table, so nothing recorded its
    // terms on the way in and there is nothing for the archival to release.
    // Measured anyway, because it is the floor the restore has to climb off.
    assert.equal(await usage(), 0);

    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "junk-row",
      archived: false,
      reason: "Archived in error; the row is a real person.",
    });

    // Releasing alone was right while hiding was permanent. Reversible means the
    // restore has to record too, or the profile comes back searchable with its
    // discovery facets missing and no later reindex increments them.
    assert.equal(await usage(), 1);
  });

  it("lets an accepted suppression replace an archival rather than sit behind it", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t, {
      slug: "archived-row",
      publicSurfacingState: "archived",
    });
    const identity = await signIn(t, { superAdmin: true });

    // Acceptance schedules the retraction, so an operator can archive the
    // profile in between. Leaving the archival in place recorded the accepted
    // request in audit history alone -- and `--unarchive` reads the surfacing
    // state, so the opt-out would have been undone by a path that never saw it.
    const requestId = await t.run(async (ctx) =>
      await ctx.db.insert("profileSuppressionRequests", {
        profileId,
        requestType: "owner_opt_out",
        state: "accepted",
        resolvedBy: actor,
        resolvedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await t.mutation(internal.suppressions.retractProfilesForSuppression, { requestId, now: NOW });

    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(profileId)))?.publicSurfacingState,
      "opted_out",
    );

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "archived-row",
        archived: false,
        reason: "Trying to undo the opt-out through the archival path.",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "NOT_ARCHIVED",
    );
  });

  it("rechecks the identity before restoring, since editing while hidden did not", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, { slug: "archived-row", publicSurfacingState: "archived" });
    const identity = await signIn(t, { superAdmin: true });

    // The name-only request nobody could match while the row was hidden.
    // `assertProfileEditNotSuppressed` lets an edit through on a profile that
    // surfaces nothing, explicitly because republication re-checks -- so a rename
    // onto a withdrawn identity is legal right up until the restore.
    await t.run(async (ctx) => {
      await ctx.db.insert("profileSuppressionRequests", {
        displayName: "Retired Name",
        profileType: "person",
        requestType: "owner_opt_out",
        state: "accepted",
        resolvedBy: actor,
        resolvedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });

      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_slug", (query) => query.eq("slug", "archived-row"))
        .unique();

      await ctx.db.patch(profile!._id, { displayName: "Retired Name" });
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "archived-row",
        archived: false,
        reason: "Restoring a row that now carries a withdrawn identity.",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "IDENTITY_SUPPRESSED",
    );
  });

  it("sees a suppression filed against the profile itself, not only its name", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t, {
      slug: "archived-row",
      publicSurfacingState: "archived",
    });
    const identity = await signIn(t, { superAdmin: true });

    // Acceptance schedules the retraction, so this is the ordinary case rather
    // than a race: a restore between the two has to see the request. A
    // names-only check does not -- `hasAcceptedSuppression` excludes a request
    // naming a live profile from its name scan, because it already resolved to
    // its target and matching on name too would block a namesake.
    await t.run(async (ctx) => {
      await ctx.db.insert("profileSuppressionRequests", {
        profileId,
        requestType: "owner_opt_out",
        state: "accepted",
        resolvedBy: actor,
        resolvedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "archived-row",
        archived: false,
        reason: "Restoring before the retraction worker has run.",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "IDENTITY_SUPPRESSED",
    );

    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(profileId)))?.publicSurfacingState,
      "archived",
    );
  });

  it("requires a reason long enough to mean something", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t);
    const identity = await signIn(t, { superAdmin: true });

    await assert.rejects(
      t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
        slug: "junk-row",
        archived: true,
        reason: "junk",
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "REASON_REQUIRED",
    );
  });

  it("writes one audit event per state change and none for a no-op", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);
    const identity = await signIn(t, { superAdmin: true });

    await t.withIdentity(identity).mutation(api.profileArchival.setProfileArchived, {
      slug: "junk-row",
      archived: true,
      reason: REASON,
    });
    const repeated = await t
      .withIdentity(identity)
      .mutation(api.profileArchival.setProfileArchived, {
        slug: "junk-row",
        archived: true,
        reason: REASON,
      });

    assert.equal(repeated.changed, false);

    const events = await t.run(async (ctx) =>
      await ctx.db
        .query("profileAuditEvents")
        .withIndex("by_profileId_createdAt", (query) => query.eq("profileId", profileId))
        .collect(),
    );

    assert.deepEqual(events.map((event) => event.action), ["profile_archived"]);
    assert.equal(events[0]?.note, REASON);
  });
});
