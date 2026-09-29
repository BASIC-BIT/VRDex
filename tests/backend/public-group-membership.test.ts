import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import { defaultClubVisibility } from "../../convex/_clubModel";
import { getPublicCommunityTelemetry, getPublicGroupMembership } from "../../convex/_communityTelemetryPublic";
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

it("uses retained creation metadata after an unchanged count without leaking across groups or visibility", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 42, observedAt: s.now - 1000,
    });
  });
  assert.equal((await s.read("first-group"))?.groupMembership?.groupCreatedAt, undefined);

  await s.t.run(async (ctx) => {
    await ctx.db.insert("vrchatGroupMemberMetadata", {
      vrchatGroupId: groupA, groupCreatedAt: s.now - 100_000,
      lastObservedAt: s.now, updatedAt: s.now,
    });
  });
  const membership = (await s.read("first-group"))?.groupMembership;
  assert.equal(membership?.groupCreatedAt, s.now - 100_000);
  assert.deepEqual(membership?.points, [{ observedAt: s.now - 1000, value: 42 }]);
  assert.equal((await s.read("second-group"))?.groupMembership, undefined);

  await s.t.run(async (ctx) => {
    const link = (await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", (q) => q
        .eq("profileId", s.firstId).eq("assetType", "vrchat_group").eq("state", "active"))
      .first())!;
    await ctx.db.patch(link._id, { assetExternalId: groupB });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupB, memberCount: 7, observedAt: s.now,
    });
  });
  assert.equal((await s.read("first-group"))?.groupMembership?.groupCreatedAt, undefined);
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

it("keeps a real missing-day gap before the sampled tail", async () => {
  const s = await setup();
  const day = 86_400_000;
  const firstAt = Math.floor(s.now / day) * day - 7 * day;
  const secondAt = firstAt + 3 * day;
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 1, observedAt: firstAt,
    });
    for (let i = 0; i < 500; i++) await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: i + 2, observedAt: secondAt + i * 1000,
    });
  });
  const membership = await s.t.run((ctx) => getPublicGroupMembership(ctx.db, s.firstId));
  assert.deepEqual(membership?.points.find((point) => point.observedAt === secondAt), {
    observedAt: secondAt, value: 2,
  }, "the first three-day gap has no omitted observation and must stay unobserved");
  assert.ok(membership?.points.some((point) => point.sampledBefore),
    "later spans with omitted observations remain marked as sampled");
});

it("finds an omitted group row after an overlapping connected observation", async () => {
  const s = await setup();
  const day = 86_400_000;
  const start = Math.floor(s.now / day) * day - 30 * day;
  const middle = start + day;
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
      publicMetrics: { currentPopulation: false, populationHistory: false,
        groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
      consecutiveFailures: 0, telemetryEpochStartedAt: start,
      createdAt: start, updatedAt: s.now,
    });
    await ctx.db.insert("communityMemberCountObservations", {
      integrationId, communityProfileId: s.firstId, idempotencyKey: "overlap",
      vrchatGroupId: groupA, memberCount: 2, observedAt: middle,
      source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 1,
    });
    for (let i = 0; i < 3; i++) await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: i + 1, observedAt: start + i * day,
    });
    for (let i = 0; i < 500; i++) await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: i + 4, observedAt: start + 20 * day + i * 1000,
    });
  });
  const membership = await s.t.run((ctx) => getPublicGroupMembership(ctx.db, s.firstId));
  const middleIndex = membership?.points.findIndex((point) => point.observedAt === middle) ?? -1;
  assert.ok(middleIndex >= 0, "the connected overlap stays selected");
  assert.equal(membership?.points[middleIndex + 1]?.sampledBefore, true,
    "the omitted group row after the selected overlap makes the next span sampled");
});

it("merges current-epoch connected observations and keeps earliest and latest in a bounded series", async () => {
  const s = await setup();
  const day = 86_400_000;
  const start = s.now - 1012 * day;
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: { ...defaultClubVisibility(), group_size: { audience: "public", staffRoleIds: null } },
      updatedAt: s.now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: s.firstId, vrchatGroupId: groupA,
      groupVisibility: "public", joinPolicy: "free", state: "active",
      enabledFeatures: ["posts"],
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
    await connected(start - day, 1);
    await connected(start + day, 2);
    for (let i = 0; i < 1009; i++) await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: i + 3, observedAt: start + (2 + i) * day,
    });
    await connected(start + 1011 * day, 999);
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupA, memberCount: 1013, observedAt: start + 1011 * day,
    });
  });
  let groupReads = 0;
  let connectedReads = 0;
  const membership = await s.t.run((ctx) => getPublicGroupMembership(new Proxy(ctx.db, {
    get(target, property) {
      if (property === "query") return (table: Parameters<typeof target.query>[0]) => {
        if (table === "vrchatGroupMemberSnapshots") groupReads++;
        if (table === "communityMemberCountObservations") connectedReads++;
        return target.query(table);
      };
      return Reflect.get(target, property);
    },
  }), s.firstId));
  const profile = await s.read("first-group");
  assert.ok(groupReads >= 10 && groupReads <= 42, "endpoint and window reads plus at most 32 gap probes");
  assert.equal(connectedReads, 2, "unsaturated connected history needs no window reads");
  assert.equal(membership?.points.length, 500);
  assert.deepEqual(membership?.points[0], { observedAt: start + day, value: 2 });
  assert.ok(membership?.points.some((point) =>
    point.observedAt === start + 128 * day && point.value === 129 && point.sampledBefore),
    "the older sampled span is marked, so the chart does not call known observations unobserved");
  assert.deepEqual(membership?.latest, { observedAt: start + 1011 * day, value: 1013 });
  assert.deepEqual(membership?.points.at(-1), membership?.latest);
  assert.equal(membership?.points.some((point) => point.value === 1), false);
  assert.equal(profile?.telemetry, undefined);
});

it("does not expose old integration membership after the primary group changes", async () => {
  const s = await setup();
  const observedAt = s.now - 60_000;
  await s.t.run(async (ctx) => {
    await ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.firstId,
      categories: {
        ...defaultClubVisibility(),
        group_size: { audience: "public", staffRoleIds: null },
        membership_movement: { audience: "public", staffRoleIds: null },
        population_history: { audience: "public", staffRoleIds: null },
      },
      updatedAt: s.now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: s.firstId, vrchatGroupId: groupA,
      groupVisibility: "public", joinPolicy: "free", state: "active",
      killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1,
      publicMetrics: { currentPopulation: false, populationHistory: true, groupMemberCount: true,
        groupMemberGrowth: true, eventRecaps: false },
      consecutiveFailures: 0, createdAt: s.now - 120_000, updatedAt: s.now,
    });
    for (const [i, count] of [10, 12].entries()) await ctx.db.insert("communityMemberCountObservations", {
      integrationId, communityProfileId: s.firstId, idempotencyKey: `old-${i}`,
      vrchatGroupId: groupA, memberCount: count, observedAt: observedAt + i,
      source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 1,
    });
    await ctx.db.insert("communityTelemetryRollups", {
      communityProfileId: s.firstId, grain: "hour",
      bucketStartAt: observedAt, bucketEndAt: observedAt + 60_000,
      rollupVersion: "community-telemetry-v1", activeInstanceCount: 0,
      peakConcurrency: 0, playerMinutes: 0, coverageRatio: 1,
      groupMemberCount: 12, groupMemberGrowth: 2, worldDistribution: [], computedAt: s.now,
    });
    const link = (await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", (q) => q
        .eq("profileId", s.firstId).eq("assetType", "vrchat_group").eq("state", "active"))
      .first())!;
    await ctx.db.patch(link._id, { assetExternalId: groupB });
    await ctx.db.insert("vrchatGroupMemberSnapshots", {
      vrchatGroupId: groupB, memberCount: 55, observedAt: s.now,
    });
  });
  const stale = await s.t.run((ctx) => getPublicCommunityTelemetry(ctx.db, s.firstId, s.now));
  assert.equal(stale?.groupMemberCount, undefined);
  assert.equal(stale?.groupMemberGrowth, undefined);
  assert.equal(stale?.populationHistory?.[0]?.groupMemberCount, undefined);
  assert.equal(stale?.populationHistory?.[0]?.groupMemberGrowth, undefined);
  assert.equal((await s.read("first-group"))?.groupMembership?.latest.value, 55);
  await s.t.run(async (ctx) => {
    const link = (await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", (q) => q
        .eq("profileId", s.firstId).eq("assetType", "vrchat_group").eq("state", "active"))
      .first())!;
    await ctx.db.patch(link._id, { assetExternalId: groupA });
  });
  const matching = await s.t.run((ctx) => getPublicCommunityTelemetry(ctx.db, s.firstId, s.now));
  assert.equal(matching?.groupMemberCount?.value, 12);
  assert.equal(matching?.groupMemberGrowth?.value, 2);
  assert.equal(matching?.populationHistory?.[0]?.groupMemberCount, 12);
  const foundedAt = s.now - 86_400_000;
  await s.t.run((ctx) => ctx.db.insert("vrchatGroupMemberMetadata", {
    vrchatGroupId: groupA, groupCreatedAt: foundedAt, updatedAt: s.now,
  }));
  const sinceFounding = await s.t.run((ctx) => getPublicCommunityTelemetry(ctx.db, s.firstId, s.now));
  assert.deepEqual(sinceFounding?.groupMemberGrowth, { value: 11, startAt: foundedAt, endAt: observedAt + 1 });
  await s.t.run(async (ctx) => {
    const link = (await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", (q) => q
        .eq("profileId", s.firstId).eq("assetType", "vrchat_group").eq("state", "active"))
      .first())!;
    await ctx.db.patch(link._id, { state: "removed", removedAt: s.now });
  });
  const removed = await s.t.run((ctx) => getPublicCommunityTelemetry(ctx.db, s.firstId, s.now));
  assert.equal(removed?.groupMemberCount, undefined);
  assert.equal(removed?.groupMemberGrowth, undefined);
  assert.equal(removed?.populationHistory?.[0]?.groupMemberCount, undefined);
  assert.equal(removed?.populationHistory?.[0]?.groupMemberGrowth, undefined);
  assert.equal((await s.read("first-group"))?.groupMembership, undefined);
});
