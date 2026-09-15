import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubMembership.ts": () => import("../../convex/clubMembership"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const begin = makeFunctionReference<"mutation">("clubMembership:beginScan");
const ingest = makeFunctionReference<"mutation">("clubMembership:ingestBatch");
const resume = makeFunctionReference<"mutation">("clubMembership:resumeScan");
const bucket = makeFunctionReference<"query">(
  "clubMembership:getMovementBucket",
);
const activity = makeFunctionReference<"query">("clubMembership:listActivity");
const start = Date.UTC(2026, 2, 1),
  end = start + 3600_000;

it("stops new audit scans after analytics is disabled", async () => {
  const { t, integrationId } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(integrationId, { enabledFeatures: ["posts"] }),
  );
  await assert.rejects(
    t.mutation(begin, {
      integrationId,
      epochStartedAt: start,
      groupId: "grp_test",
      startAt: start,
      endAt: end,
    }),
    /scope/,
  );
});

it("never treats a coverage gap as zero, merges adjacent scans and hides disconnected public data", async () => {
  const { t, owner, integrationId } = await setup();
  for (const [startAt, endAt] of [
    [start, start + 1000],
    [start + 2000, end],
  ]) {
    const scanId = await t.mutation(begin, {
      integrationId,
      epochStartedAt: start,
      groupId: "grp_test",
      startAt,
      endAt,
    });
    await t.mutation(ingest, {
      scanId,
      pageNumber: 0,
      events: [],
      exhausted: true,
    });
  }
  assert.equal(
    (
      await t.query(bucket, {
        communitySlug: "club",
        startAt: start,
        endAt: end,
      })
    ).complete,
    false,
  );
  const scanId = await t.mutation(begin, {
    integrationId,
    epochStartedAt: start,
    groupId: "grp_test",
    startAt: start + 1000,
    endAt: start + 2000,
  });
  await t.mutation(ingest, {
    scanId,
    pageNumber: 0,
    events: [],
    exhausted: true,
  });
  assert.deepEqual(
    await t.query(bucket, {
      communitySlug: "club",
      startAt: start,
      endAt: end,
    }),
    { joins: 0, departures: 0, complete: true },
  );
  await t.run((ctx) =>
    ctx.db.patch(integrationId, { killSwitchEnabled: true }),
  );
  assert.equal(
    (
      await t.query(bucket, {
        communitySlug: "club",
        startAt: start,
        endAt: end,
      })
    ).complete,
    false,
  );
  assert.equal(
    (
      await owner.query(bucket, {
        communitySlug: "club",
        startAt: start,
        endAt: end,
      })
    ).complete,
    true,
  );
  await t.run(async (ctx) => {
    const integration = (await ctx.db.get(integrationId))!;
    await ctx.db.patch(integrationId, { killSwitchEnabled: false });
    await ctx.db.patch(integration.communityProfileId, {
      publicationState: "draft_private",
    });
  });
  const args = { communitySlug: "club", startAt: start, endAt: end };
  assert.deepEqual(await t.query(bucket, args), {
    joins: null,
    departures: null,
    complete: false,
  });
  assert.deepEqual(await owner.query(bucket, args), {
    joins: 0,
    departures: 0,
    complete: true,
  });
});
async function setup() {
  const t = convexTest({ schema, modules });
  const identity = {
    subject: "owner",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|owner",
  };
  const integrationId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: "owner" });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "club",
      displayName: "Club",
      sortName: "club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: start,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId: communityProfileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: start,
      updatedAt: start,
    });
    return ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId,
      vrchatGroupId: "grp_test",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      killSwitchEnabled: false,
      requestsPerMinute: 30,
      leaseGeneration: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: true,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      telemetryEpochStartedAt: start,
      createdAt: start,
      updatedAt: start,
    });
  });
  const collectorAccountId = await t.run((ctx) =>
    ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_bot",
      accountAlias: "bot",
      state: "ready",
      capacity: 20,
      reservedHeadroom: 0,
      assignedGroupCount: 1,
      requestsPerMinute: 30,
      secretRef: "test",
      workerKeyHash: "key",
      credentialGeneration: 1,
      killSwitchEnabled: false,
      createdAt: start,
      updatedAt: start,
    }),
  );
  const leaseId = await t.run(async (ctx) => {
    await ctx.db.patch(integrationId, {
      assignedCollectorAccountId: collectorAccountId,
    });
    return ctx.db.insert("collectorAccountLeases", {
      integrationId,
      collectorAccountId,
      workerId: "worker",
      fencingToken: 1,
      state: "active",
      claimedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });
  });
  const worker = {
    integrationId,
    epochStartedAt: start,
    groupId: "grp_test",
    collectorAccountId,
    workerId: "worker",
    workerKeyHash: "key",
    fencingToken: 1,
  };
  const rawMutation = t.mutation.bind(t);
  const wrapped = {
    ...t,
    mutation: ((
      ref: Parameters<typeof t.mutation>[0],
      args: Record<string, unknown>,
    ) => rawMutation(ref, { ...worker, ...args })) as typeof t.mutation,
  };
  return {
    t: wrapped,
    owner: t.withIdentity(identity),
    integrationId,
    collectorAccountId,
    leaseId,
    worker,
  };
}
it("reauthorizes key, collector and lease in each transaction and rebinds resumable scans", async () => {
  const { t, integrationId, collectorAccountId, leaseId } = await setup();
  const args = {
    integrationId,
    epochStartedAt: start,
    groupId: "grp_test",
    startAt: start,
    endAt: end,
  };
  const scanId = await t.mutation(begin, args);
  assert.equal(await t.mutation(begin, args), scanId);
  const page = {
    scanId,
    pageNumber: 0,
    events: [],
    exhausted: false,
    sourceCount: 100,
  };
  await t.mutation(ingest, page);
  const resumed = await t.mutation(resume, {});
  assert.equal(resumed.nextOffset, 100);
  assert.equal(resumed.nextPage, 1);
  await t.run((ctx) =>
    ctx.db.patch(collectorAccountId, { workerKeyHash: "rotated" }),
  );
  await assert.rejects(t.mutation(resume, {}), /Unauthorized/);
  await t.run((ctx) =>
    ctx.db.patch(collectorAccountId, { workerKeyHash: "key" }),
  );
  await t.run((ctx) => ctx.db.patch(leaseId, { expiresAt: Date.now() - 1 }));
  await assert.rejects(
    t.mutation(ingest, { ...page, pageNumber: 1 }),
    /Unauthorized/,
  );
  await t.run((ctx) =>
    ctx.db.patch(leaseId, {
      expiresAt: Date.now() + 60_000,
      workerId: "new-worker",
      fencingToken: 2,
    }),
  );
  await assert.rejects(
    t.mutation(ingest, { ...page, pageNumber: 1 }),
    /Unauthorized/,
  );
  await assert.rejects(
    t.mutation(ingest, {
      ...page,
      pageNumber: 1,
      workerId: "new-worker",
      fencingToken: 2,
    }),
    /stale/,
  );
  const rebound = await t.mutation(resume, {
    workerId: "new-worker",
    fencingToken: 2,
  });
  assert.equal(rebound.scanId, scanId);
  assert.equal(rebound.nextOffset, 100);
  await t.mutation(ingest, {
    ...page,
    pageNumber: 1,
    exhausted: true,
    sourceCount: 0,
    workerId: "new-worker",
    fencingToken: 2,
  });
  assert.equal(
    (await t.mutation(resume, { workerId: "new-worker", fencingToken: 2 }))
      .complete,
    true,
  );
});
it("rejects foreign scan IDs even with an otherwise valid collector lease", async () => {
  const { t, integrationId } = await setup();
  const scanId = await t.mutation(begin, { startAt: start, endAt: end });
  await t.run((ctx) => ctx.db.patch(scanId, { groupId: "grp_foreign" }));
  await assert.rejects(
    t.mutation(ingest, { scanId, pageNumber: 0, events: [], exhausted: true }),
    /Foreign/,
  );
  await t.run((ctx) =>
    ctx.db.patch(integrationId, { assignedCollectorAccountId: undefined }),
  );
  await assert.rejects(t.mutation(resume, {}), /Unauthorized/);
});
it("requires complete ordered scans, deduplicates immutable IDs and preserves unknown events", async () => {
  const { t, owner, integrationId } = await setup();
  const scanId = await t.mutation(begin, {
    integrationId,
    epochStartedAt: start,
    groupId: "grp_test",
    startAt: start,
    endAt: end,
  });
  const events = [
    "group.member.join",
    "group.member.leave",
    "group.member.remove",
    "group.user.ban",
    "group.instance.kick",
    "future.event",
  ].map((eventType, i) => ({
    auditId: `audit_${i}`,
    eventType,
    occurredAt: start + 100 + i,
    targetUserId: "usr_person",
  }));
  await assert.rejects(
    t.mutation(ingest, { scanId, pageNumber: 1, events: [], exhausted: true }),
    /sequence/,
  );
  await t.mutation(ingest, {
    scanId,
    pageNumber: 0,
    events: events.reverse(),
    exhausted: false,
  });
  assert.deepEqual(
    await t.query(bucket, {
      communitySlug: "club",
      startAt: start,
      endAt: end,
    }),
    { joins: null, departures: null, complete: false },
  );
  await t.mutation(ingest, { scanId, pageNumber: 1, events, exhausted: true });
  assert.deepEqual(
    await t.query(bucket, {
      communitySlug: "club",
      startAt: start,
      endAt: end,
    }),
    { joins: 1, departures: 2, complete: true },
  );
  const page = await owner.query(activity, {
    communitySlug: "club",
    startAt: start,
    endAt: end,
    paginationOpts: { numItems: 2, cursor: null },
  });
  assert.equal(page.page.length, 2);
  assert.equal(page.isDone, false);
  assert.equal(page.page[0].eventType, "future.event");
  await assert.rejects(
    t.query(activity, {
      communitySlug: "club",
      startAt: start,
      endAt: end,
      paginationOpts: { numItems: 2, cursor: null },
    }),
    /access/,
  );
  const rows = await t.run((ctx) =>
    ctx.db.query("communityMembershipEvents").take(100),
  );
  assert.equal(rows.length, 6);
});
it("rejects foreign scopes, stale epochs and conflicting provider IDs without deleting history", async () => {
  const { t, integrationId } = await setup();
  await assert.rejects(
    t.mutation(begin, {
      integrationId,
      epochStartedAt: start,
      groupId: "grp_other",
      startAt: start,
      endAt: end,
    }),
    /scope/,
  );
  const scanId = await t.mutation(begin, {
    integrationId,
    epochStartedAt: start,
    groupId: "grp_test",
    startAt: start,
    endAt: end,
  });
  const item = {
    auditId: "one",
    eventType: "group.member.join",
    occurredAt: start + 1,
  };
  await t.mutation(ingest, {
    scanId,
    pageNumber: 0,
    events: [item],
    exhausted: false,
  });
  await assert.rejects(
    t.mutation(ingest, {
      scanId,
      pageNumber: 1,
      events: [{ ...item, eventType: "group.member.leave" }],
      exhausted: true,
    }),
    /immutable/,
  );
  await t.run((ctx) =>
    ctx.db.patch(integrationId, { telemetryEpochStartedAt: end }),
  );
  await assert.rejects(
    t.mutation(ingest, { scanId, pageNumber: 1, events: [], exhausted: true }),
    /scope/,
  );
  assert.deepEqual(
    await t.query(bucket, {
      communitySlug: "club",
      startAt: start,
      endAt: end,
    }),
    { joins: null, departures: null, complete: false },
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.query("communityMembershipEvents").take(100)))
      .length,
    1,
  );
});
