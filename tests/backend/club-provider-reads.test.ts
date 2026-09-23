import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { defaultClubVisibility } from "../../convex/_clubModel";
import { makeFunctionReference } from "convex/server";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubAnalytics.ts": () => import("../../convex/clubAnalytics"),
  "../../convex/clubProviderReads.ts": () =>
    import("../../convex/clubProviderReads"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubProviderReads:${name}`);
it("server freshness reports remaining observation lifetime for each evaluation", async (test) => {
  const now = 1_800_000_000_000;
  test.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  const s = await setup();
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params: { kind: "members", n: 10, offset: 0 },
  });
  const evaluate = (nonce: string) =>
    s.owner.query(ref("get"), { requestId, freshnessNonce: nonce });
  assert.equal((await evaluate("pending")).remainingFreshMs, 0);
  assert.equal((await evaluate("pending-again")).fresh, false);
  await s.t.run((ctx) =>
    ctx.db.patch(requestId, {
      state: "succeeded",
      collectorAccountId: s.collectorAccountId,
      credentialGeneration: 1,
      result: { items: [], nextOffset: null, observedAt: now - 45_000 },
    }),
  );
  const first = await evaluate("first");
  assert.equal(first.fresh, true);
  assert.equal(first.remainingFreshMs, 15_000);
  test.mock.timers.tick(10_000);
  const refreshed = await evaluate("refresh-same-request");
  assert.equal(refreshed.result.observedAt, first.result.observedAt);
  assert.equal(refreshed.remainingFreshMs, 5_000);
  test.mock.timers.tick(5_000);
  assert.equal((await evaluate("at-expiry")).fresh, false);
  assert.equal((await evaluate("at-expiry-duration")).remainingFreshMs, 0);
  for (const [state, observedAt] of [
    ["succeeded", Date.now() + 1],
    ["failed", Date.now()],
  ] as const) {
    await s.t.run((ctx) =>
      ctx.db.patch(requestId, {
        state,
        result: { items: [], nextOffset: null, observedAt },
      }),
    );
    const invalid = await evaluate(state);
    assert.equal(invalid.fresh, false);
    assert.equal(invalid.remainingFreshMs, 0);
  }
  await s.t.run((ctx) => ctx.db.patch(requestId, { expiresAt: Date.now() }));
  assert.equal(await evaluate("expired-row"), null);
});
it("queued reads wake idle integrations without clearing provider backoff", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  for (const hasBackoff of [false, true]) {
    const s = await setup();
    const now = Date.now();
    await s.t.run(async (ctx) => {
      const lease = await ctx.db
        .query("collectorAccountLeases")
        .withIndex("by_integrationId_state", (q) =>
          q.eq("integrationId", s.integrationId).eq("state", "active"),
        )
        .unique();
      if (lease) await ctx.db.patch(lease._id, { state: "released" });
      await ctx.db.patch(s.integrationId, {
        nextPollAt: now + 300_000,
        ...(hasBackoff
          ? { state: "degraded", backoffUntil: now + 60_000 }
          : {}),
      });
    });
    const params = {
      communityProfileId: s.communityProfileId,
      params: { kind: "members", n: 10, offset: 0 },
    };
    const requestedAt = Date.now();
    const requestId = await s.owner.mutation(ref("request"), params);
    const integration = await s.t.run((ctx) => ctx.db.get(s.integrationId));
    assert.ok(integration!.nextPollAt! >= requestedAt);
    assert.ok(integration!.nextPollAt! <= Date.now());
    assert.equal(
      integration!.backoffUntil,
      hasBackoff ? now + 60_000 : undefined,
    );
    // A repeated pending request also repairs a cadence hint overwritten by polling.
    await s.t.run((ctx) =>
      ctx.db.patch(s.integrationId, { nextPollAt: Date.now() + 300_000 }),
    );
    assert.equal(await s.owner.mutation(ref("request"), params), requestId);
    assert.ok(
      (await s.t.run((ctx) => ctx.db.get(s.integrationId)))!.nextPollAt! <=
        Date.now(),
    );
  }
});
it("all provider caches invalidate collector rotation, reassignment, kill switch and inactive state", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  for (const kind of ["members", "roles", "posts", "instances"] as const) {
    for (const change of [
      "rotate",
      "reassign",
      "kill",
      "inactive",
      "degraded",
    ] as const) {
      const s = await setup();
      await s.t.run((ctx) =>
        ctx.db.patch(s.integrationId, {
          enabledFeatures: ["membership_management", "posts", "instances"],
        }),
      );
      const args = {
        communityProfileId: s.communityProfileId,
        params: { kind, n: 10, offset: 0 },
      };
      const requestId = await s.owner.mutation(ref("request"), args);
      await s.t.run((ctx) =>
        ctx.db.patch(requestId, {
          state: "succeeded",
          collectorAccountId: s.collectorAccountId,
          credentialGeneration: 1,
          result: { items: [], nextOffset: null, observedAt: Date.now() },
        }),
      );
      assert.equal(
        (await s.owner.query(ref("get"), { requestId })).fresh,
        true,
      );
      await s.t.run(async (ctx) => {
        if (change === "rotate")
          await ctx.db.patch(s.collectorAccountId, { credentialGeneration: 2 });
        if (change === "kill")
          await ctx.db.patch(s.collectorAccountId, { killSwitchEnabled: true });
        if (change === "inactive")
          await ctx.db.patch(s.collectorAccountId, { state: "quarantined" });
        if (change === "degraded")
          await ctx.db.patch(s.collectorAccountId, { state: "degraded" });
        if (change === "reassign") {
          const { _id, _creationTime, ...account } = (await ctx.db.get(
            s.collectorAccountId,
          ))!;
          const replacement = await ctx.db.insert("collectorAccounts", {
            ...account,
            vrchatUserId: "usr_replacement",
          });
          await ctx.db.patch(s.integrationId, {
            assignedCollectorAccountId: replacement,
          });
        }
      });
      await assert.rejects(s.owner.query(ref("get"), { requestId }), /expired/);
      if (change === "rotate" || change === "reassign")
        assert.notEqual(
          await s.owner.mutation(ref("request"), args),
          requestId,
        );
      else
        await assert.rejects(s.owner.mutation(ref("request"), args), /expired/);
    }
  }
});
it("eligibility is explicit single-recipient instance work and rejects foreign destinations", async (test) => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  const params = {
    kind: "invitation_eligibility",
    userId: "usr_11111111-1111-1111-1111-111111111111",
    n: 1,
    offset: 0,
  };
  await assert.rejects(
    s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params,
    }),
    /disabled/,
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: ["instances"] }),
  );
  const requestId = await s.owner.mutation(ref("request"), {
    communityProfileId: s.communityProfileId,
    params,
  });
  assert.ok(requestId);
  const { authority, ...worker } = s.snapshot;
  const job = await s.t.mutation(ref("claim"), worker);
  const completion = {
    ...worker,
    requestId,
    claimToken: job.claimToken,
    authority,
    result: {
      items: [
        {
          id: params.userId,
          userId: params.userId,
          friendship: "friend",
          destinationState: "pending",
          invitationEligibility: "destination_pending",
        },
      ],
      nextOffset: null,
      observedAt: Date.now(),
    },
  };
  await assert.rejects(
    s.t.mutation(ref("complete"), {
      ...completion,
      result: {
        ...completion.result,
        items: [{ ...completion.result.items[0], userId: "someone-else" }],
      },
    }),
    /eligibility result/,
  );
  assert.deepEqual(await s.t.mutation(ref("complete"), completion), {
    recorded: true,
  });
  assert.equal(
    (await s.owner.query(ref("get"), { requestId })).result.items[0].friendship,
    "friend",
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, { credentialGeneration: 2 }),
  );
  await assert.rejects(s.owner.query(ref("get"), { requestId }), /expired/);
  assert.notEqual(
    await s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params,
    }),
    requestId,
  );
  await assert.rejects(
    s.t.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params,
    }),
    /access/,
  );
  await assert.rejects(
    s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params: { ...params, n: 2 },
    }),
    /eligibility/,
  );
  await assert.rejects(
    s.owner.mutation(ref("request"), {
      communityProfileId: s.communityProfileId,
      params: {
        ...params,
        worldId: "wrld_11111111-1111-1111-1111-111111111111",
        instanceId: "12~group(other)",
      },
    }),
    /another group/,
  );
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
  const subject = {
    subject: "instance-staff",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|instance-staff",
  };
  await s.t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: subject.subject });
    await ctx.db.patch(s.roleId, { permissions: ["manage_instances"] });
    await ctx.db.patch(s.integrationId, { enabledFeatures: ["instances"] });
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
  await s.t.run((ctx) =>
    ctx.db.insert("communityDataVisibility", {
      communityProfileId: s.communityProfileId,
      categories: {
        ...defaultClubVisibility(),
        instance_history: { audience: "owner", staffRoleIds: null },
      },
      updatedAt: Date.now(),
    }),
  );
  const staff = s.t.withIdentity(subject);
  const args = {
    communityProfileId: s.communityProfileId,
    params: { kind: "instances", n: 10, offset: 0 },
  };
  const item = {
    id: "live-instance",
    name: "Observatory",
    worldId: "wrld_11111111-1111-1111-1111-111111111111",
    instanceId: "123~group(grp_test)",
  };
  // Both management-only staff and an owner can read live destinations with analytics off.
  for (const actor of [staff, s.owner]) {
    const requestId = await actor.mutation(ref("request"), args);
    const { authority, ...worker } = s.snapshot;
    const job = await s.t.mutation(ref("claim"), worker);
    assert.equal(job.requestId, requestId);
    await s.t.mutation(ref("complete"), {
      ...worker,
      requestId,
      claimToken: job.claimToken,
      authority,
      result: { items: [item], nextOffset: null, observedAt: Date.now() },
    });
    assert.deepEqual(
      (await actor.query(ref("get"), { requestId })).result.items,
      [item],
    );
  }
  await assert.rejects(
    staff.query(makeFunctionReference<any>("clubAnalytics:listInstances"), {
      communitySlug: "connection-club",
      kind: "live",
      paginationOpts: { numItems: 10, cursor: null },
    }),
  );
  const staffRequestId = await staff.mutation(ref("request"), args);
  await s.t.run((ctx) => ctx.db.patch(s.roleId, { permissions: [] }));
  await assert.rejects(staff.mutation(ref("request"), args));
  await assert.rejects(staff.query(ref("get"), { requestId: staffRequestId }));
  await s.t.run((ctx) =>
    ctx.db.patch(s.roleId, { permissions: ["manage_instances"] }),
  );
  await assert.rejects(
    staff.mutation(ref("request"), {
      ...args,
      params: { ...args.params, kind: "members" },
    }),
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: [] }),
  );
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
