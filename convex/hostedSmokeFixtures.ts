import { internalMutation } from "./_generated/server";
import { createProfileSearchDocument, upsertSearchDocument } from "./_searchDocuments";
import { requireHostedSmokeFixture } from "./_previewPersistence";

const fixtureSlug = "vrdex-hosted-smoke-club";
const fixtureMarker = "vrdex-hosted-smoke-fixture";

export const ensurePublicSearchFixture = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireHostedSmokeFixture();

    const now = Date.now();
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (index) => index.eq("slug", fixtureSlug))
      .unique();
    const profileFields = {
      slug: fixtureSlug,
      displayName: "VRDex Hosted Smoke Club",
      sortName: "vrdex hosted smoke club",
      aliases: ["VRDex CI Fixture Club"],
      tags: ["club", "vrdex-smoke-fixture"],
      headline: "Deterministic fake profile for hosted API and MCP readiness checks.",
      outboundLinks: [],
      claimState: "unclaimed" as const,
      publicationState: "published" as const,
      publicSurfacingState: "public" as const,
      publicSurfacingUpdatedAt: now,
      publicSurfacingReason: fixtureMarker,
      creationSource: "moderator" as const,
      publishedAt: now,
      updatedAt: now,
      profileType: "community" as const,
      community: {
        subtype: "test-fixture",
        categoryTags: ["club"],
      },
    };
    let profileId;
    let created = false;

    if (existing === null) {
      profileId = await ctx.db.insert("profiles", profileFields);
      created = true;
    } else {
      if (existing.publicSurfacingReason !== fixtureMarker) {
        throw new Error("Hosted smoke fixture slug is owned by a non-fixture profile.");
      }

      profileId = existing._id;
      await ctx.db.patch(profileId, profileFields);
    }

    const profile = await ctx.db.get(profileId);

    if (profile === null) {
      throw new Error("Hosted smoke fixture profile could not be loaded.");
    }

    await upsertSearchDocument(ctx.db, createProfileSearchDocument(profile));

    if (created) {
      await ctx.db.insert("profileAuditEvents", {
        profileId,
        action: "hosted_smoke_fixture_created",
        sourceType: "moderator",
        note: "Deterministic fake profile created by the CI-admin hosted readiness path.",
        createdAt: now,
      });
    }

    return {
      created,
      profileId,
      slug: fixtureSlug,
    };
  },
});
