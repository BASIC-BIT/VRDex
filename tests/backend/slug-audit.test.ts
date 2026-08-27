import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/slugAudit.ts": () => import("../../convex/slugAudit"),
};

const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

function profileRow(slug: string, displayName: string) {
  return {
    profileType: "person" as const,
    slug,
    displayName,
    sortName: displayName.toLowerCase(),
    aliases: [],
    tags: [],
    claimState: "unclaimed" as const,
    publicationState: "published" as const,
    publicSurfacingState: "public" as const,
    creationSource: "concierge" as const,
    person: { roleTags: [] },
    updatedAt: 1,
  };
}

function worldRow(slug: string, displayName: string) {
  return {
    slug,
    displayName,
    sortName: displayName.toLowerCase(),
    tags: [],
    visibilityStatus: "public" as const,
    platformCompatibility: ["pc" as const],
    media: [],
    creatorAttributions: [],
    outboundLinks: [],
    publicationState: "published" as const,
    creationSource: "self" as const,
    updatedAt: 1,
  };
}

describe("slug conflict audit", () => {
  /**
   * The migration this reports cannot be done automatically, so the audit is the
   * whole safety net. A version that quietly returned nothing would read exactly
   * like a clean deployment.
   */
  it("finds a slug two entity types hold, in resolution order", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", profileRow("neon-harbor", "Neon Harbor"));
      await ctx.db.insert("worlds", worldRow("neon-harbor", "Neon Harbor World"));
      await ctx.db.insert("worlds", worldRow("quiet-room", "Quiet Room"));
    });

    const report = await t.query(internal.slugAudit.conflicts, {});

    assert.deepEqual(report.checked, { profiles: 1, worlds: 2, events: 0 });
    assert.equal(report.duplicates.length, 1);
    assert.equal(report.duplicates[0]?.slug, "neon-harbor");
    assert.deepEqual(
      report.duplicates[0]?.holders.map((holder) => holder.kind),
      ["person", "world"],
    );
    // Both holders carry their visibility, and neither is labelled the winner.
    // Table order does not decide it: the root route skips whatever each entity's
    // own public projection hides, so a draft-private profile loses to a published
    // world, and naming a winner here would point at renaming the live row.
    assert.deepEqual(
      report.duplicates[0]?.holders.map((holder) => holder.publicationState),
      ["published", "published"],
    );
    assert.equal(report.shadowedByRoute.length, 0);
  });

  it("finds an entity sitting on a live route name", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      // The old per-entity reservation lists did not hold `lookup`, so a row could
      // legitimately have taken it. Next matches the route first, so this profile
      // has no reachable public page at all now.
      await ctx.db.insert("profiles", profileRow("lookup", "Lookup"));
      await ctx.db.insert("profiles", profileRow("dj-aurora", "DJ Aurora"));
    });

    const report = await t.query(internal.slugAudit.conflicts, {});

    assert.equal(report.duplicates.length, 0);
    assert.deepEqual(
      report.shadowedByRoute.map((holder) => holder.slug),
      ["lookup"],
    );
  });

  it("finds an entity holding a route prefix, whose public page still works", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      // `/handoff` falls through to `[slug]` and renders this profile fine, which
      // is exactly why it is easy to miss: `/handoff/edit` is matched by
      // `app/handoff/[token]` instead of the profile editor.
      await ctx.db.insert("profiles", profileRow("handoff", "Handoff"));
    });

    const report = await t.query(internal.slugAudit.conflicts, {});

    assert.equal(report.shadowedByRoute.length, 0);
    assert.deepEqual(
      report.nestedRoutesShadowed.map(({ slug, lostSubpaths }) => ({ slug, lostSubpaths })),
      [{ slug: "handoff", lostSubpaths: ["edit", "opengraph-image"] }],
    );
  });

  it("reports a world whose share image is intercepted by a route prefix", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      await ctx.db.insert("worlds", worldRow("handoff", "Handoff World"));
    });

    const report = await t.query(internal.slugAudit.conflicts, {});

    assert.deepEqual(
      report.nestedRoutesShadowed.map(({ slug, lostSubpaths }) => ({ slug, lostSubpaths })),
      [{ slug: "handoff", lostSubpaths: ["opengraph-image"] }],
    );
    assert.deepEqual(report.duplicates, []);
  });

  it("ignores events that have no slug to collide with", async () => {
    const t = convexTest({ schema, modules });

    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", profileRow("afterglow", "Afterglow"));
      await ctx.db.insert("events", {
        title: "Unslugged Event",
        sortTitle: "unslugged event",
        startAt: 1,
        timezone: "UTC",
        sourceType: "manual" as const,
        sourceLabel: "Fixture",
        publicationState: "draft_private" as const,
        updatedAt: 1,
      });
    });

    const report = await t.query(internal.slugAudit.conflicts, {});

    assert.equal(report.checked.events, 1);
    assert.equal(report.duplicates.length, 0);
    assert.equal(report.shadowedByRoute.length, 0);
  });
});
