import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import { defaultClubVisibility } from "../../convex/_clubModel";
import { getPublicGroupMembership } from "../../convex/_communityTelemetryPublic";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const groupA = "grp_00000000-0000-4000-8000-000000000001";
const groupB = "grp_00000000-0000-4000-8000-000000000002";

async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const clerkUserId = newClerkUserId();
  const [firstId, secondId] = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId, email: "membership@example.test", emailVerificationTime: now,
    });
    const ids = [];
    for (const slug of ["first-group", "second-group"]) {
      const profileId = await ctx.db.insert("profiles", {
        slug, displayName: slug, sortName: slug, aliases: [], tags: [],
        profileType: "community", community: { categoryTags: [] },
        claimState: "claimed_verified", publicationState: "published",
        publicSurfacingState: "public", creationSource: "self", updatedAt: now,
      });
      await ctx.db.insert("profileOwners", {
        profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now,
      });
      await ctx.db.insert("profileExternalLinks", {
        profileId, assetType: "vrchat_group", assetExternalId: groupA,
        linkRole: "primary", state: "active", createdAt: now, updatedAt: now,
      });
      ids.push(profileId);
    }
    return ids as [typeof ids[number], typeof ids[number]];
  });
  const owner = t.withIdentity({ subject: clerkUserId, issuer: "test", emailVerified: true });
  const read = (slug: string) => t.query(api.profiles.getPublicBySlug, { slug });
  return { t, now, firstId, secondId, owner, read };
}

it("shares group observations while applying Group size visibility per profile", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 42, observedAt: s.now - 1000,
      groupCreatedAt: s.now - 100_000,
    });
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
  });
  assert.deepEqual((await s.read("first-group"))?.groupMembership, {
    groupCreatedAt: s.now - 100_000,
    latest: { observedAt: s.now - 1000, value: 42 },
    points: [{ observedAt: s.now - 1000, value: 42 }],
  });
  assert.equal((await s.read("second-group"))?.groupMembership, undefined);
  const preview = await s.owner.query(api.profiles.previewProfileFromBrowser, {
    slug: "first-group", expectedUpdatedAt: s.now, displayName: "Unsaved title",
  });
  assert.deepEqual(preview.groupMembership, (await s.read("first-group"))?.groupMembership);
  await s.t.run(async (ctx) => {
    const link = (await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", (q) => q
        .eq("profileId", s.firstId).eq("assetType", "vrchat_group").eq("state", "active"))
      .first())!;
    await ctx.db.patch(link._id, { assetExternalId: groupB });
  });
  assert.equal((await s.read("first-group"))?.groupMembership, undefined);
  await s.t.run(async (ctx) => {
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupB, memberCount: 7, observedAt: s.now,
    });
  });
  assert.deepEqual((await s.read("first-group"))?.groupMembership?.points, [
    { observedAt: s.now, value: 7 },
  ]);
});

it("does not revive a removed primary link through integration fallback", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    for (const profileId of [s.firstId, s.secondId]) {
      await ctx.db.insert("communityDataVisibility", {
        communityProfileId: profileId,
        categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
        updatedAt: s.now,
      });
      await ctx.db.insert("communityVrchatIntegrations", {
        communityProfileId: profileId, vrchatGroupId: groupA,
        groupVisibility: "public", joinPolicy: "free", state: "active",
        killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1,
        publicMetrics: { currentPopulation: false, populationHistory: false,
          groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
        consecutiveFailures: 0, createdAt: s.now, updatedAt: s.now,
      });
      const link = (await ctx.db.query("profileExternalLinks")
        .withIndex("by_profileId_assetType_state", (q) => q
          .eq("profileId", profileId).eq("assetType", "vrchat_group").eq("state", "active"))
        .first())!;
      if (profileId === s.firstId) await ctx.db.patch(link._id, { state: "removed", removedAt: s.now });
      else await ctx.db.delete(link._id); // A legacy connection with no link row ever.
    }
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 50, observedAt: s.now,
    });
  });
  assert.equal((await s.read("first-group"))?.groupMembership, undefined);
  assert.deepEqual((await s.read("second-group"))?.groupMembership?.latest, {
    observedAt: s.now, value: 50,
  });
  await s.t.run(async (ctx) => {
    const integration = (await ctx.db.query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) => q.eq("communityProfileId", s.firstId))
      .first())!;
    await ctx.db.patch(integration._id, { vrchatGroupId: groupB });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupB, memberCount: 8, observedAt: s.now + 1,
    });
  });
  assert.deepEqual((await s.read("first-group"))?.groupMembership?.latest, {
    observedAt: s.now + 1, value: 8,
  });
});

it("skips whole-span bucket reads for a short history", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 20, observedAt: s.now,
    });
  });
  let groupReads = 0;
  const membership = await s.t.run((ctx) => getPublicGroupMembership(new Proxy(ctx.db, {
    get(target, property) {
      if (property === "query") return (table: Parameters<typeof target.query>[0]) => {
        if (table === "vrchatGroupMemberSnapshots") groupReads++;
        return target.query(table);
      };
      return Reflect.get(target, property);
    },
  }), s.firstId));
  assert.equal(groupReads, 2, "only recent and first point reads are needed");
  assert.deepEqual(membership?.latest, { observedAt: s.now, value: 20 });
});

it("merges current-epoch connected observations and keeps earliest and latest in a bounded series", async () => {
  const s = await setup();
  const start = s.now - 1_000_000;
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: s.firstId, vrchatGroupId: groupA,
      groupVisibility: "public", joinPolicy: "free", state: "active",
      killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1,
      publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false,
        groupMemberGrowth: false, eventRecaps: false },
      consecutiveFailures: 0, telemetryEpochStartedAt: start,
      createdAt: start - 1000, updatedAt: s.now,
    });
    const connected = (observedAt: number, memberCount: number) => ctx.db.insert("communityMemberCountObservations", {
      integrationId, communityProfileId: s.firstId, idempotencyKey: String(observedAt),
      vrchatGroupId: groupA, memberCount, observedAt, source: "first_party",
      collectorVersion: "test", coverageState: "observed", fencingToken: 1,
    });
    await connected(start - 1, 1);
    await connected(start + 1, 2);
    for (let i = 0; i < 1010; i++) await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: i + 3, observedAt: start + 2 + i,
    });
    await connected(start + 1011, 999);
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 1013, observedAt: start + 1011,
    });
  });
  const profile = await s.read("first-group");
  const membership = profile?.groupMembership;
  assert.equal(membership?.points.length, 500);
  assert.deepEqual(membership?.points[0], { observedAt: start + 1, value: 2 });
  assert.ok(membership?.points.some((point) => point.observedAt === start + 44 && point.value === 45),
    "a representative older observation survives beyond the recent 500 rows");
  assert.deepEqual(membership?.latest, { observedAt: start + 1011, value: 1013 });
  assert.deepEqual(membership?.points.at(-1), membership?.latest);
  assert.equal(membership?.points.some((point) => point.value === 1), false);
  assert.equal(profile?.telemetry, undefined);
});
