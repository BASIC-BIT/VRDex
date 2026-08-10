import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
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
    publicSurfacingState?: "public" | "opted_out" | "suppressed" | "archived";
  } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("profiles", {
      displayName: "Junk Row",
      slug: overrides.slug ?? "junk-row",
      sortName: "junk row",
      profileType: "person",
      claimState: overrides.claimState ?? "unclaimed",
      creationSource: "import",
      publicationState: "published",
      publicSurfacingState: overrides.publicSurfacingState ?? "public",
      publicSurfacingUpdatedAt: NOW,
      publishedAt: NOW,
      updatedAt: NOW,
      aliases: [],
      tags: [],
      person: { roleTags: ["DJ"] },
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
