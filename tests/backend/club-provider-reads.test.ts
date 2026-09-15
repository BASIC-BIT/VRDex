import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { makeFunctionReference } from "convex/server";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubProviderReads.ts": () =>
    import("../../convex/clubProviderReads"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubProviderReads:${name}`);
it("eligibility is explicit single-recipient instance work and rejects foreign destinations", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const params = { kind: "invitation_eligibility", userId: "usr_11111111-1111-1111-1111-111111111111", n: 1, offset: 0 };
  await assert.rejects(s.owner.mutation(ref("request"), { communityProfileId: s.communityProfileId, params }), /disabled/);
  await s.t.run(ctx => ctx.db.patch(s.integrationId, { enabledFeatures: ["instances"] }));
  const requestId = await s.owner.mutation(ref("request"), { communityProfileId: s.communityProfileId, params });
  assert.ok(requestId);
  const { authority, ...worker } = s.snapshot;
  const job = await s.t.mutation(ref("claim"), worker);
  const completion = { ...worker, requestId, claimToken: job.claimToken, authority, result: { items: [{ id: params.userId, userId: params.userId, friendship: "friend", destinationState: "pending", invitationEligibility: "destination_pending" }], nextOffset: null, observedAt: Date.now() } };
  await assert.rejects(s.t.mutation(ref("complete"), { ...completion, result: { ...completion.result, items: [{ ...completion.result.items[0], userId: "someone-else" }] } }), /eligibility result/);
  assert.deepEqual(await s.t.mutation(ref("complete"), completion), { recorded: true });
  assert.equal((await s.owner.query(ref("get"), { requestId })).result.items[0].friendship, "friend");
  await s.t.run(ctx => ctx.db.patch(s.collectorAccountId, { credentialGeneration: 2 }));
  await assert.rejects(s.owner.query(ref("get"), { requestId }), /expired/);
  assert.notEqual(await s.owner.mutation(ref("request"), { communityProfileId: s.communityProfileId, params }), requestId);
  await assert.rejects(s.t.mutation(ref("request"), { communityProfileId: s.communityProfileId, params }), /access/);
  await assert.rejects(s.owner.mutation(ref("request"), { communityProfileId: s.communityProfileId, params: { ...params, n: 2 } }), /eligibility/);
  await assert.rejects(s.owner.mutation(ref("request"), { communityProfileId: s.communityProfileId, params: { ...params, worldId: "wrld_11111111-1111-1111-1111-111111111111", instanceId: "12~group(other)" } }), /another group/);
});
it("event picker paginates only the current club and instance roles need no membership feature", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  await s.t.run(async (ctx) => {
    const profile = await ctx.db.get(s.communityProfileId);
    const { _id, _creationTime, ...values } = profile!;
    const other = await ctx.db.insert("profiles", { ...values, slug: "other" });
    for (let i = 0; i < 3; i++)
      await ctx.db.insert("events", {
        slug: `event-${i}`,
        title: `Event ${i}`,
        sortTitle: `event ${i}`,
        startAt: Date.now() + i * 60000,
        communityProfileId: i === 2 ? other : s.communityProfileId,
        sourceType: "manual",
        sourceLabel: "test",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: Date.now(),
        updatedAt: Date.now(),
      });
    await ctx.db.patch(s.integrationId, { enabledFeatures: ["instances"] });
  });
  const first = await s.owner.query(ref("listEvents"), {
    communityProfileId: s.communityProfileId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  assert.equal(first.page[0].title, "Event 1");
  assert.equal(first.isDone, false);
  const second = await s.owner.query(ref("listEvents"), {
    communityProfileId: s.communityProfileId,
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  assert.equal(second.page[0].title, "Event 0");
  assert.equal(second.isDone, true);
  await assert.rejects(
    s.t.query(ref("listEvents"), {
      communityProfileId: s.communityProfileId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  );
  assert.ok(
    await s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params: { kind: "instance_roles", n: 100, offset: 0 },
    }),
  );
});
async function setup() {
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.accounts.dev";
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const identity = {
    subject: "owner",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|owner",
  };
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { clerkUserId: "owner" });
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
      enabledFeatures: ["membership_management", "posts"],
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
it("instance destination reads require instances feature without analytics or member access", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const subject = {subject: "instance-staff", issuer: "https://test.clerk.accounts.dev", tokenIdentifier: "https://test.clerk.accounts.dev|instance-staff"};
  await s.t.run(async ctx => {
    await ctx.db.insert("users", {clerkUserId: subject.subject});
    await ctx.db.patch(s.roleId, {permissions: ["manage_instances"]});
    await ctx.db.patch(s.integrationId, {enabledFeatures: ["instances"]});
    await ctx.db.insert("communityAuthorities", {communityProfileId:s.communityProfileId,subject,subjectTokenIdentifier:subject.tokenIdentifier,roleId:s.roleId,roleKey:"staff",roleLabel:"Staff",state:"active",grantedAt:Date.now(),updatedAt:Date.now()});
  });
  const staff = s.t.withIdentity(subject);
  const args = {communityProfileId:s.communityProfileId,params:{kind:"instances",n:10,offset:0}};
  assert.ok(await staff.mutation(ref("request"), args));
  await assert.rejects(staff.mutation(ref("request"), {...args,params:{...args.params,kind:"members"}}));
  await s.t.run(ctx => ctx.db.patch(s.integrationId,{enabledFeatures:[]}));
  await assert.rejects(staff.mutation(ref("request"), args), /disabled/);
});
it("serves projected pages only to requester, rechecks feature and worker credential generation", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const { authority, ...worker } = s.snapshot;
  const params = { kind: "members", n: 10, offset: 0 };
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params,
  });
  assert.equal(
    await s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params,
    }),
    requestId,
  );
  assert.equal(
    (await s.owner.query(ref("get"), { requestId })).state,
    "pending",
  );
  await assert.rejects(
    s.t.mutation(ref("claim"), { ...worker, fencingToken: 2 }),
    /lease/,
  );
  const job = await s.t.mutation(ref("claim"), worker);
  assert.equal(job.requestId, requestId);
  const complete = {
    claimToken: job.claimToken,
    ...worker,
    requestId,
    authority: {
      ...authority,
      permissions: ["group-members-manage", "group-members-viewall"],
    },
    result: {
      items: [
        { id: "usr_member", userId: "usr_member", displayName: "Member" },
      ],
      nextOffset: 1,
      observedAt: Date.now(),
    },
  };
  await assert.rejects(
    s.t.mutation(ref("complete"), { ...complete, authority }),
    /authority/,
  );
  assert.deepEqual(await s.t.mutation(ref("complete"), complete), {
    recorded: true,
  });
  const result = await s.owner.query(ref("get"), { requestId });
  assert.equal(result.result.nextOffset, 1);
  assert.equal(result.fresh, true);
  const secondId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params: { ...params, offset: 1 },
  });
  assert.equal((await s.t.mutation(ref("claim"), worker)).requestId, secondId);
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, { credentialGeneration: 2 }),
  );
  assert.deepEqual(
    await s.t.mutation(ref("complete"), { ...complete, requestId: secondId }),
    { recorded: false },
  );
  await assert.rejects(
    s.t
      .withIdentity({
        subject: "other",
        issuer: "https://test.clerk.accounts.dev",
      })
      .query(ref("get"), { requestId }),
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: ["analytics"] }),
  );
  await assert.rejects(s.owner.query(ref("get"), { requestId }), /expired/);
  await assert.rejects(
    s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params,
    }),
    /disabled/,
  );
});
it("recovers stale read claims and rejects the previous attempt token on the same lease", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const { authority, ...worker } = s.snapshot;
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params: { kind: "members", n: 10, offset: 0 },
  });
  const first = await s.t.mutation(ref("claim"), worker);
  assert.equal(await s.t.mutation(ref("claim"), worker), null);
  await s.t.run((ctx) =>
    ctx.db.patch(requestId, { claimedAt: Date.now() - 61_000 }),
  );
  const second = await s.t.mutation(ref("claim"), worker);
  assert.equal(second.requestId, requestId);
  assert.notEqual(second.claimToken, first.claimToken);
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...worker,
      requestId,
      claimToken: first.claimToken,
      errorCode: "provider_read_failed",
    }),
    { recorded: false },
  );
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...worker,
      requestId,
      claimToken: second.claimToken,
      errorCode: "provider_read_failed",
    }),
    { recorded: true },
  );
});
it("exposes only safe member context and responds immediately to role revocation", async () => {
  const s = await setup();
  const subject = {
    subject: "staff",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|staff",
  };
  await s.t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: subject.subject });
    await ctx.db.patch(s.roleId, {
      permissions: ["invite_group_members"],
      permittedProviderRoleIds: ["grol_allowed"],
    });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId: s.communityProfileId,
      subject,
      subjectTokenIdentifier: subject.tokenIdentifier,
      roleId: s.roleId,
      roleKey: "staff",
      roleLabel: "Staff",
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const staff = s.t.withIdentity(subject);
  const result = await staff.query(ref("context"), {
    communityProfileId: s.communityProfileId,
  });
  assert.deepEqual(result, {
    enabledFeatures: ["membership_management", "posts"],
    permittedProviderRoleIds: ["grol_allowed"],
    protectedUserIds: ["usr_bot"],
    assignedBot: {
      userId: "usr_bot",
      profileUrl: "https://vrchat.com/home/user/usr_bot",
    },
  });
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, {
      providerAuthority: {
        authority: { ...s.snapshot.authority, ownerUserId: "usr_group_owner" },
        collectorAccountId: s.collectorAccountId,
        credentialGeneration: 1,
        epochStartedAt: s.snapshot.epochStartedAt,
        receivedAt: Date.now(),
      },
    }),
  );
  assert.deepEqual(
    (
      await staff.query(ref("context"), {
        communityProfileId: s.communityProfileId,
      })
    ).protectedUserIds,
    ["usr_bot", "usr_group_owner"],
  );
  await s.t.run(async (ctx) => {
    const integration = await ctx.db.get(s.integrationId);
    await ctx.db.patch(s.integrationId, {
      providerAuthority: {
        ...integration!.providerAuthority!,
        authority: {
          ...integration!.providerAuthority!.authority,
          observedAt: Date.now() - 61_000,
        },
      },
    });
  });
  assert.deepEqual(
    (
      await staff.query(ref("context"), {
        communityProfileId: s.communityProfileId,
      })
    ).protectedUserIds,
    ["usr_bot"],
  );
  await assert.rejects(
    s.t.query(ref("context"), { communityProfileId: s.communityProfileId }),
  );
  await s.t.run((ctx) => ctx.db.patch(s.roleId, { state: "deleted" }));
  await assert.rejects(
    staff.query(ref("context"), { communityProfileId: s.communityProfileId }),
    /access/,
  );
});
it("revalidates pending requester authority and feature before the worker reads", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const { authority, ...worker } = s.snapshot;
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params: { kind: "members", n: 10, offset: 0 },
  });
  await s.t.run(async (ctx) => {
    const owner = await ctx.db
      .query("profileOwners")
      .withIndex("by_profileId_state", (q) =>
        q.eq("profileId", s.communityProfileId).eq("state", "active"),
      )
      .first();
    await ctx.db.patch(owner!._id, { state: "revoked" });
  });
  assert.equal(await s.t.mutation(ref("claim"), worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(requestId)))!.errorCode,
    "access_expired",
  );
});
it("rejects invalid paging and removes expired operational cache without touching telemetry", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  for (const params of [
    { kind: "search", n: 100, offset: 0, search: "ab" },
    { kind: "members", n: 101, offset: 0 },
    { kind: "member", n: 1, offset: 0, userId: "not-an-id" },
  ])
    await assert.rejects(
      s.owner.mutation(ref("request"), {
        communityProfileId: s.communityProfileId,
        params,
      }),
    );
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params: { kind: "members", n: 10, offset: 0 },
  });
  await s.t.run((ctx) =>
    ctx.db.patch(requestId, { expiresAt: Date.now() - 1 }),
  );
  await s.t.mutation(ref("expire"), { requestId });
  assert.equal(await s.t.run((ctx) => ctx.db.get(requestId)), null);
});
