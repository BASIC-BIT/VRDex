import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { syncClubEventOperations } from "../../convex/_clubOperationEvents";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) => makeFunctionReference<any>(`events:${name}`);
async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const identity = {
    subject: "owner",
    emailVerified: true,
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|owner",
  };
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", {
      clerkUserId: "owner",
      emailVerificationTime: now,
    });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "connection-club",
      displayName: "Club",
      sortName: "club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId: communityProfileId,
      userId: user,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_bot",
      accountAlias: "bot",
      state: "ready",
      capacity: 10,
      reservedHeadroom: 0,
      assignedGroupCount: 1,
      requestsPerMinute: 30,
      secretRef: "secret",
      workerKeyHash: "hash",
      credentialGeneration: 1,
      killSwitchEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId,
      vrchatGroupId: "grp_test",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      assignedCollectorAccountId: collectorAccountId,
      killSwitchEnabled: false,
      requestsPerMinute: 10,
      leaseGeneration: 1,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      telemetryEpochStartedAt: now - 1000,
      createdAt: now - 1000,
      updatedAt: now,
    });
    const leaseId = await ctx.db.insert("collectorAccountLeases", {
      integrationId,
      collectorAccountId,
      workerId: "worker",
      fencingToken: 1,
      state: "active",
      claimedAt: now,
      expiresAt: now + 60000,
      updatedAt: now,
    });
    const roleId = await ctx.db.insert("communityRoles", {
      communityProfileId,
      key: "staff",
      label: "Staff",
      permissions: ["manage_integrations"],
      assignableRoleIds: [],
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    return {
      communityProfileId,
      collectorAccountId,
      integrationId,
      leaseId,
      roleId,
    };
  });
  return {
    t,
    owner: t.withIdentity(identity),
    ...ids,
    snapshot: {
      collectorAccountId: ids.collectorAccountId,
      integrationId: ids.integrationId,
      workerKeyHash: "hash",
      workerId: "worker",
      fencingToken: 1,
      epochStartedAt: now - 1000,
      authority: {
        groupId: "grp_test",
        userId: "usr_bot",
        membershipStatus: "member",
        permissions: ["group-members-manage"],
        observedAt: now,
      },
    },
  };
}
async function jobs(count = 205) {
  const s = await setup();
  const startAt = Date.now() + 3600000;
  const created = await s.owner.mutation(ref("createCommunityEvent"), {
    title: "Scheduled event",
    communitySlug: "connection-club",
    startAt,
  });
  await s.t.run(async (ctx) => {
    for (let i = 0; i < count; i++)
      await ctx.db.insert("clubOperations", {
        communityProfileId: s.communityProfileId,
        integrationId: s.integrationId,
        epochStartedAt: 0,
        requestId: "jobs_" + i,
        batchId: "batch",
        payload: {
          kind: "publish_post",
          title: "Post",
          text: "Body",
          visibility: "group",
          sendNotification: false,
        },
        schedule: {
          kind: "event_relative",
          eventId: created.eventId,
          offsetMs: -60000,
        },
        eventId: created.eventId,
        dueAt: startAt - 60000,
        readyAt: startAt - 60000,
        actor: {
          subject: "owner",
          issuer: "https://test.clerk.accounts.dev",
          tokenIdentifier: "https://test.clerk.accounts.dev|owner",
        },
        createdBy: {
          subject: "owner",
          issuer: "https://test.clerk.accounts.dev",
          tokenIdentifier: "https://test.clerk.accounts.dev|owner",
        },
        revision: 1,
        state: i === 0 ? "claimed" : i === 1 ? "submitted" : "pending",
        ...(i < 2
          ? {
              claim: {
                nonce: "original",
                collectorAccountId: s.collectorAccountId,
                credentialGeneration: 1,
                workerId: "worker",
                fencingToken: 1,
                expiresAt: Date.now() + 60000,
              },
            }
          : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
  });
  return { ...s, ...created, startAt };
}
async function drain(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.finishAllScheduledFunctions(() => {});
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    assert.equal(
      scheduled.some((row) => row.state.kind === "failed"),
      false,
    );
    if (
      !scheduled.some(
        (row) =>
          row.state.kind === "pending" || row.state.kind === "inProgress",
      )
    )
      return;
  }
  assert.fail("Scheduled event fanout did not finish.");
}
it("browser event changes rebase more than100 jobs and invalidate claimed nonces", async () => {
  const s = await jobs();
  const nextStart = Date.now() + 120000;
  await s.owner.mutation(ref("updateCommunityEvent"), {
    currentSlug: s.slug,
    title: "Scheduled event",
    communitySlug: "connection-club",
    startAt: nextStart,
  });
  await drain(s.t);
  const rows = await s.t.run((ctx) =>
    ctx.db
      .query("clubOperations")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", s.communityProfileId),
      )
      .take(300),
  );
  assert.equal(rows.length, 205);
  for (const row of rows) {
    if (row.state === "submitted") {
      assert.equal(row.dueAt, s.startAt - 60000);
      continue;
    }
    assert.equal(row.state, "pending");
    assert.equal(row.dueAt, nextStart - 60000);
    assert.equal(row.claim, undefined);
    assert.equal(row.actor.subject, "owner");
  }
  assert.ok(
    (await s.t.run((ctx) => ctx.db.get(s.integrationId)))!.nextPollAt! <=
      nextStart - 60000,
  );
});
it("API event writes share rebasing and cancellation leaves submitted artifacts untouched", async () => {
  const s = await jobs();
  const userId = await s.t.run(
    async (ctx) =>
      (await ctx.db
        .query("users")
        .withIndex("clerkUserId", (q) => q.eq("clerkUserId", "owner"))
        .unique())!._id,
  );
  const nextStart = Date.now() + 180000;
  await s.t.mutation(ref("updateCommunityEventForApiOwner"), {
    actorKind: "personal_api_token",
    ownerUserId: userId,
    currentSlug: s.slug,
    startAt: nextStart,
  });
  await drain(s.t);
  await s.owner.mutation(ref("setCommunityEventCancelled"), {
    currentSlug: s.slug,
    cancelled: true,
    reason: "Fixture cancellation",
  });
  await drain(s.t);
  const rows = await s.t.run((ctx) =>
    ctx.db
      .query("clubOperations")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", s.communityProfileId),
      )
      .take(300),
  );
  assert.equal(rows.filter((r) => r.state === "cancelled").length, 204);
  assert.equal(rows.filter((r) => r.state === "submitted").length, 1);
});
it("a deleted event cancels remaining work through the same hook", async () => {
  const s = await jobs(3);
  await s.t.run(async (ctx) => {
    await ctx.db.delete(s.eventId);
    await syncClubEventOperations(ctx, s.eventId);
  });
  const rows = await s.t.run((ctx) =>
    ctx.db
      .query("clubOperations")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", s.communityProfileId),
      )
      .take(10),
  );
  assert.equal(rows.filter((r) => r.code === "event_deleted").length, 2);
  assert.equal(rows.filter((r) => r.state === "submitted").length, 1);
});
