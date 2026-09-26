import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { makeFunctionReference } from "convex/server";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubConnection.ts": () => import("../../convex/clubConnection"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubConnection:${name}`);
it("returns server timing for nonce-backed connection reads without renewing authority", async () => {
  const s = await setup();
  await s.t.mutation(ref("recordAuthority"), s.snapshot);
  const before = Date.now();
  const result = await s.owner.query(ref("get"), {
    communityProfileId: s.communityProfileId,
    freshnessNonce: "display-attempt",
  });
  assert.ok(result.now >= before && result.now <= Date.now());
  assert.equal(result.authority.observedAt, s.snapshot.authority.observedAt);
});
it("denies role configuration across clubs and expired worker leases", async () => {
  const s = await setup();
  const foreignRole = await s.t.run(async (ctx) => {
    const profile = await ctx.db.get(s.communityProfileId);
    const { _id, _creationTime, ...fields } = profile!;
    const other = await ctx.db.insert("profiles", {
      ...fields,
      slug: "other-club",
    });
    const role = await ctx.db.get(s.roleId);
    const { _id: roleId, _creationTime: created, ...roleFields } = role!;
    return await ctx.db.insert("communityRoles", {
      ...roleFields,
      communityProfileId: other,
    });
  });
  await assert.rejects(
    s.owner.mutation(ref("setProviderRoleAllowlist"), {
      communityProfileId: s.communityProfileId,
      roleId: foreignRole,
      providerRoleIds: [],
      expectedUpdatedAt: 0,
    }),
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.leaseId, { expiresAt: Date.now() - 1 }),
  );
  assert.deepEqual(await s.t.mutation(ref("recordAuthority"), s.snapshot), {
    recorded: false,
  });
});
async function setup() {
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
it("integration staff configure features but cannot expand provider role grants", async () => {
  const s = await setup();
  const subject = {
    subject: "staff",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|staff",
  };
  await s.t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: "staff" });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId: s.communityProfileId,
      subject,
      subjectTokenIdentifier: subject.tokenIdentifier,
      roleId: s.roleId,
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const staff = s.t.withIdentity(subject);
  await staff.mutation(ref("setFeatures"), {
    communityProfileId: s.communityProfileId,
    enabledFeatures: ["analytics", "posts"],
  });
  await assert.rejects(
    staff.mutation(ref("setProviderRoleAllowlist"), {
      communityProfileId: s.communityProfileId,
      roleId: s.roleId,
      providerRoleIds: [],
      expectedUpdatedAt: 0,
    }),
  );
  await s.t.run((ctx) => ctx.db.patch(s.roleId, { state: "deleted" }));
  await assert.rejects(
    staff.query(ref("get"), { communityProfileId: s.communityProfileId }),
  );
});
it("preserves analytics default, owner configures independent features and rejects anonymous access", async () => {
  const s = await setup();
  assert.deepEqual(
    (
      await s.owner.query(ref("get"), {
        communityProfileId: s.communityProfileId,
      })
    ).enabledFeatures,
    ["analytics"],
  );
  await assert.rejects(
    s.t.query(ref("get"), { communityProfileId: s.communityProfileId }),
  );
  await s.owner.mutation(ref("setFeatures"), {
    communityProfileId: s.communityProfileId,
    enabledFeatures: ["posts", "instances"],
  });
  assert.deepEqual(
    (
      await s.owner.query(ref("get"), {
        communityProfileId: s.communityProfileId,
      })
    ).enabledFeatures,
    ["posts", "instances"],
  );
});
it("records only bound fresh fenced own-member snapshots and invalidates credential rotation", async () => {
  const s = await setup();
  for (const patch of [
    { workerKeyHash: "wrong" },
    { fencingToken: 2 },
    { workerId: "old" },
    { epochStartedAt: 0 },
    { authority: { ...s.snapshot.authority, userId: "usr_other" } },
    { authority: { ...s.snapshot.authority, observedAt: Date.now() - 120000 } },
  ])
    assert.deepEqual(
      await s.t.mutation(ref("recordAuthority"), { ...s.snapshot, ...patch }),
      { recorded: false },
    );
  assert.deepEqual(await s.t.mutation(ref("recordAuthority"), s.snapshot), {
    recorded: true,
  });
  assert.ok(
    (
      await s.owner.query(ref("get"), {
        communityProfileId: s.communityProfileId,
      })
    ).authority,
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, { credentialGeneration: 2 }),
  );
  assert.equal(
    (
      await s.owner.query(ref("get"), {
        communityProfileId: s.communityProfileId,
      })
    ).authority,
    null,
  );
});
it("owner sets bounded provider role IDs on an existing local role", async () => {
  const s = await setup();
  const providerRoleIds = ["grol_11111111-1111-1111-1111-111111111111"];
  const original = (await s.t.run(ctx => ctx.db.get(s.roleId)))!;
  await s.owner.mutation(ref("setProviderRoleAllowlist"), {
    communityProfileId: s.communityProfileId,
    roleId: s.roleId,
    providerRoleIds,
    expectedUpdatedAt: original.updatedAt,
  });
  assert.deepEqual(
    (
      await s.owner.query(ref("get"), {
        communityProfileId: s.communityProfileId,
      })
    ).roles[0].providerRoleIds,
    providerRoleIds,
  );
  await assert.rejects(
    s.owner.mutation(ref("setProviderRoleAllowlist"), {
      communityProfileId: s.communityProfileId,
      roleId: s.roleId,
      providerRoleIds: ["arbitrary"],
      expectedUpdatedAt: (await s.t.run(ctx => ctx.db.get(s.roleId)))!.updatedAt,
    }),
  );
});
it("normalizes provider roles and rejects a stale allowlist from another tab", async () => {
  const s = await setup();
  const upper = "grol_AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  const lower = upper.toLowerCase();
  const original = (await s.owner.query(ref("get"), {
    communityProfileId: s.communityProfileId,
  })).roles[0];
  const firstUpdatedAt = await s.owner.mutation(ref("setProviderRoleAllowlist"), {
    communityProfileId: s.communityProfileId, roleId: s.roleId,
    expectedUpdatedAt: original.updatedAt, providerRoleIds: [upper, lower],
  });
  let stored = (await s.t.run(ctx => ctx.db.get(s.roleId)))!;
  assert.deepEqual(stored.permittedProviderRoleIds, [lower]);
  assert.equal(stored.updatedAt, firstUpdatedAt);
  assert.ok(stored.updatedAt > original.updatedAt);

  const firstTab = (await s.owner.query(ref("get"), {
    communityProfileId: s.communityProfileId,
  })).roles[0];
  const secondTab = { ...firstTab };
  await s.owner.mutation(ref("setProviderRoleAllowlist"), {
    communityProfileId: s.communityProfileId, roleId: s.roleId,
    expectedUpdatedAt: firstTab.updatedAt, providerRoleIds: [],
  });
  stored = (await s.t.run(ctx => ctx.db.get(s.roleId)))!;
  await assert.rejects(s.owner.mutation(ref("setProviderRoleAllowlist"), {
    communityProfileId: s.communityProfileId, roleId: s.roleId,
    expectedUpdatedAt: secondTab.updatedAt,
    providerRoleIds: secondTab.providerRoleIds,
  }), /Refresh to continue/);
  assert.deepEqual((await s.t.run(ctx => ctx.db.get(s.roleId)))!, stored);
  assert.deepEqual(stored.permittedProviderRoleIds, []);
});
