import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileIdentity.ts": () => import("../../convex/profileIdentity"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const actor = {
  tokenIdentifier: "operator:vrdex",
  issuer: "vrdex",
  subject: "identity-tests",
};
const REASON = "Display name is a pasted URL rather than the person's name.";
const BAD_SLUG = "https-panel-vrcdn-live-preview-mask9691";

async function seedProfile(
  t: ReturnType<typeof convexTest>,
  overrides: { slug?: string; displayName?: string; claimState?: "unclaimed" | "claimed_verified" } = {},
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("profiles", {
      displayName: overrides.displayName ?? "https://panel.vrcdn.live/preview/mask9691",
      slug: overrides.slug ?? BAD_SLUG,
      sortName: "https panel vrcdn live preview mask9691",
      profileType: "person",
      claimState: overrides.claimState ?? "unclaimed",
      creationSource: "import",
      publicationState: "published",
      publicSurfacingState: "public",
      publicSurfacingUpdatedAt: NOW,
      publishedAt: NOW,
      updatedAt: NOW,
      aliases: [],
      tags: [],
      person: { roleTags: ["DJ"] },
    }),
  );
}

function rename(t: ReturnType<typeof convexTest>, args: Record<string, unknown>) {
  return t.mutation(internal.profileIdentity.setProfileIdentityAsOperator, {
    reason: REASON,
    actor,
    now: NOW,
    ...args,
  } as never);
}

describe("operator profile identity", () => {
  it("renames a profile and rebuilds its sort key", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);

    const result = await rename(t, { slug: BAD_SLUG, displayName: "mask9691" });

    assert.equal(result.renamed, true);
    assert.equal(result.reslugged, false);

    const stored = await t.run(async (ctx) => await ctx.db.get(profileId));
    assert.equal(stored?.displayName, "mask9691");
    // Derived rather than supplied: it is the key the directory orders on, and
    // a caller-provided one drifts from the name it is meant to track.
    assert.equal(stored?.sortName, "mask9691");
    assert.equal(stored?.slug, BAD_SLUG);
  });

  it("moves the world credits that carry the old slug", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);

    const { worldId, creditId } = await t.run(async (ctx) => {
      const worldId = await ctx.db.insert("worlds", {
        slug: "neon-harbor",
        displayName: "Neon Harbor",
        sortName: "neon harbor",
        publicationState: "published",
        visibilityStatus: "public",
        creationSource: "import",
        platformCompatibility: [],
        tags: [],
        media: [],
        outboundLinks: [],
        creatorAttributions: [
          {
            role: "world_author",
            displayName: "https://panel.vrcdn.live/preview/mask9691",
            profileSlug: BAD_SLUG,
            profileType: "person",
          },
        ],
        updatedAt: NOW,
      });
      const creditId = await ctx.db.insert("worldProfileCredits", {
        worldId,
        profileSlug: BAD_SLUG,
        profileType: "person",
        role: "world_author",
        updatedAt: NOW,
      });

      return { worldId, creditId };
    });

    const result = await rename(t, { slug: BAD_SLUG, displayName: "mask9691", newSlug: "mask9691" });

    assert.equal(result.reslugged, true);

    // Driven directly rather than through the scheduler. The rename schedules
    // this so a profile credited on many worlds cannot push one mutation past a
    // transaction limit; what matters here is that the relink moves both stores.
    const relink = { profileType: "person" as const, profileId, previousSlug: BAD_SLUG, nextSlug: "mask9691", previousDisplayName: "https://panel.vrcdn.live/preview/mask9691", nextDisplayName: "mask9691", now: NOW };

    await t.mutation(internal.profileIdentity.relinkProfileReferences, { ...relink, phase: "credits" });
    await t.mutation(internal.profileIdentity.relinkProfileReferences, { ...relink, phase: "worlds" });

    // Both places, because the slug is denormalized twice. Leaving either behind
    // orphans the credit: it stops resolving to the profile and keeps rendering
    // whatever the old row said.
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(creditId)))?.profileSlug,
      "mask9691",
    );
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.get(worldId)))?.creatorAttributions[0]?.profileSlug,
      "mask9691",
    );
  });

  it("carries the corrected name onto world attributions, not just the slug", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);

    const worldId = await t.run(async (ctx) =>
      await ctx.db.insert("worlds", {
        slug: "neon-harbor",
        displayName: "Neon Harbor",
        sortName: "neon harbor",
        publicationState: "published",
        visibilityStatus: "public",
        creationSource: "import",
        platformCompatibility: [],
        tags: [],
        media: [],
        outboundLinks: [],
        creatorAttributions: [
          {
            role: "world_author",
            displayName: "https://panel.vrcdn.live/preview/mask9691",
            profileId,
            profileSlug: BAD_SLUG,
            profileType: "person",
          },
          {
            role: "builder",
            displayName: "Someone Else",
            profileSlug: "someone-else",
            profileType: "person",
          },
        ],
        updatedAt: NOW,
      }),
    );

    // A rename with no reslug: the name is the half that was wrong, and it is
    // stored on the attribution, rendered by `toPublicWorld` and indexed into
    // the world's search document.
    await rename(t, { slug: BAD_SLUG, displayName: "mask9691" });
    await t.mutation(internal.profileIdentity.relinkProfileReferences, {
      profileId,
      profileType: "person",
      previousSlug: BAD_SLUG,
      nextSlug: BAD_SLUG,
      previousDisplayName: "https://panel.vrcdn.live/preview/mask9691",
      nextDisplayName: "mask9691",
      phase: "worlds",
      now: NOW,
    });

    const attributions =
      (await t.run(async (ctx) => await ctx.db.get(worldId)))?.creatorAttributions ?? [];

    assert.equal(attributions[0]?.displayName, "mask9691");
    // Untouched: this tool moves the profile it was asked about and nothing else.
    assert.equal(attributions[1]?.displayName, "Someone Else");
  });

  it("stops rather than move references once the old slug is taken again", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t, { slug: "moved-away", displayName: "Moved Away" });

    // The old slug is free the moment the profile stops holding it, and this
    // worker runs afterwards. Anything still carrying it may now belong to the
    // new holder, so moving them would hand this profile somebody else's credits.
    await seedProfile(t, { slug: "old-slug", displayName: "New Occupant" });

    const result = await t.mutation(internal.profileIdentity.relinkProfileReferences, {
      profileId,
      profileType: "person",
      previousSlug: "old-slug",
      nextSlug: "moved-away",
      previousDisplayName: "Moved Away",
      nextDisplayName: "Moved Away",
      phase: "credits",
      now: NOW,
    });

    assert.equal(result.aborted, "previous_slug_reclaimed");
  });

  it("refuses a slug that is taken, reserved or malformed", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t);
    await seedProfile(t, { slug: "taken-slug", displayName: "Someone Else" });

    for (const newSlug of ["taken-slug", "  ", "Not A Slug"]) {
      await assert.rejects(
        rename(t, { slug: BAD_SLUG, newSlug }),
        (error: { data?: { code?: string } }) => error.data?.code === "SLUG_UNAVAILABLE",
      );
    }
  });

  it("treats the profile's own slug as available rather than a collision", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, { slug: "keeps-slug", displayName: "Old Name" });

    const result = await rename(t, {
      slug: "keeps-slug",
      displayName: "New Name",
      newSlug: "keeps-slug",
    });

    assert.equal(result.renamed, true);
    assert.equal(result.reslugged, false);
  });

  it("refuses a no-op and an out-of-bounds name", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, { slug: "same", displayName: "Same Name" });

    await assert.rejects(
      rename(t, { slug: "same", displayName: "Same Name" }),
      (error: { data?: { code?: string } }) => error.data?.code === "NOTHING_TO_CHANGE",
    );

    await assert.rejects(
      rename(t, { slug: "same", displayName: "x" }),
      (error: { data?: { code?: string } }) => error.data?.code === "DISPLAY_NAME_OUT_OF_BOUNDS",
    );
  });

  it("makes an operator say out loud that the profile is claimed", async () => {
    const t = convexTest({ schema, modules });
    await seedProfile(t, { slug: "claimed-row", claimState: "claimed_verified" });

    await assert.rejects(
      rename(t, { slug: "claimed-row", displayName: "Renamed Anyway" }),
      (error: { data?: { code?: string } }) =>
        error.data?.code === "CLAIMED_PROFILE_NEEDS_CONFIRMATION",
    );

    const confirmed = await rename(t, {
      slug: "claimed-row",
      displayName: "Renamed Anyway",
      confirmClaimed: true,
    });

    assert.equal(confirmed.renamed, true);
  });

  it("writes nothing on a dry run", async () => {
    const t = convexTest({ schema, modules });
    const profileId = await seedProfile(t);

    const result = await rename(t, {
      slug: BAD_SLUG,
      displayName: "mask9691",
      newSlug: "mask9691",
      dryRun: true,
    });

    assert.equal(result.changed, false);
    assert.equal(result.displayName, "mask9691");
    assert.equal(result.slug, "mask9691");

    const stored = await t.run(async (ctx) => await ctx.db.get(profileId));
    assert.equal(stored?.slug, BAD_SLUG);
    assert.equal(stored?.displayName, "https://panel.vrcdn.live/preview/mask9691");
  });
});
