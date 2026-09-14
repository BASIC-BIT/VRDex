import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { CLUB_CATEGORIES } from "../../convex/_clubModel";

const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubStaff.ts": () => import("../../convex/clubStaff"),
  "../../convex/communityTelemetry.ts": () =>
    import("../../convex/communityTelemetry"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const identity = (name: string) => ({
  subject: `user_${name}`,
  issuer: "https://club-test.clerk.accounts.dev",
  tokenIdentifier: `https://club-test.clerk.accounts.dev|user_${name}`,
});
async function setup() {
  const t = convexTest({ schema, modules });
  const owner = identity("owner"),
    delegate = identity("delegate"),
    recipient = identity("recipient");
  const communityProfileId = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      clerkUserId: owner.subject,
    });
    for (const subject of [delegate, recipient])
      await ctx.db.insert("users", { clerkUserId: subject.subject });
    const id = await ctx.db.insert("profiles", {
      slug: "test-club",
      displayName: "Test club",
      sortName: "test club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: Date.now(),
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId: id,
      userId: ownerId,
      roleKey: "owner",
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  });
  const ownerClient = t.withIdentity(owner);
  await ownerClient.mutation(api.clubStaff.seedPresetRoles, {
    communitySlug: "test-club",
  });
  const workspace = await ownerClient.query(api.clubStaff.getWorkspace, {
    communitySlug: "test-club",
  });
  const admin = workspace!.roles.find((r) => r.presetKey === "admin")!,
    event = workspace!.roles.find((r) => r.presetKey === "event_staff")!;
  return {
    t,
    owner,
    delegate,
    recipient,
    ownerClient,
    communityProfileId,
    admin,
    event,
  };
}

describe("independent staff boundary checks", () => {
  it("rejects cross-community references", async () => {
    const { t, ownerClient, communityProfileId, recipient, admin } =
      await setup();
    const { role, assignment } = await t.run(async (ctx) => {
      const { _id, _creationTime, ...profile } =
        (await ctx.db.get(communityProfileId))!;
      const other = await ctx.db.insert("profiles", {
        ...profile,
        slug: "other",
      });
      const role = await ctx.db.insert("communityRoles", {
        communityProfileId: other,
        key: "foreign",
        label: "Foreign",
        permissions: [],
        assignableRoleIds: [],
        state: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const assignment = await ctx.db.insert("communityAuthorities", {
        communityProfileId: other,
        subjectTokenIdentifier: recipient.tokenIdentifier,
        subject: recipient,
        roleId: role,
        state: "active",
        grantedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { role, assignment };
    });
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.saveRole, {
        communitySlug: "test-club",
        roleId: role,
        label: "Hijack",
        permissions: [],
        assignableRoleIds: [],
      }),
    );
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.saveRole, {
        communitySlug: "test-club",
        roleId: admin._id,
        label: "Admin",
        permissions: [],
        assignableRoleIds: [role],
      }),
    );
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
        communitySlug: "test-club",
        category: "group_size",
        audience: "staff",
        staffRoleIds: [role],
      }),
    );
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.createStaffInvitation, {
        communitySlug: "test-club",
        roleIds: [role],
      }),
    );
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.revokeAssignment, {
        communitySlug: "test-club",
        assignmentId: assignment,
      }),
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(assignment)))!.state,
      "active",
    );
    assert.equal((await t.run((ctx) => ctx.db.get(role)))!.label, "Foreign");
  });
  for (const reason of ["expired", "deleted", "already-held"] as const)
    it(`rejects ${reason} invitations atomically`, async () => {
      const { t, ownerClient, recipient, admin, event } = await setup();
      const invite = await ownerClient.mutation(
        api.clubStaff.createStaffInvitation,
        { communitySlug: "test-club", roleIds: [admin._id, event._id] },
      );
      if (reason === "expired")
        await t.run((ctx) =>
          ctx.db.patch(invite.invitationId, { expiresAt: Date.now() - 1 }),
        );
      if (reason === "deleted")
        await ownerClient.mutation(api.clubStaff.deleteRole, {
          communitySlug: "test-club",
          roleId: event._id,
        });
      if (reason === "already-held") {
        const prior = await ownerClient.mutation(
          api.clubStaff.createStaffInvitation,
          { communitySlug: "test-club", roleIds: [event._id] },
        );
        await t
          .withIdentity(recipient)
          .mutation(api.clubStaff.acceptStaffInvitation, {
            communitySlug: "test-club",
            token: prior.token,
          });
      }
      await assert.rejects(
        t
          .withIdentity(recipient)
          .mutation(api.clubStaff.acceptStaffInvitation, {
            communitySlug: "test-club",
            token: invite.token,
          }),
      );
      const rows = await t.run((ctx) =>
        ctx.db.query("communityAuthorities").collect(),
      );
      assert.equal(
        rows.filter((r) => r.state === "active" && r.roleId === admin._id)
          .length,
        0,
      );
      assert.equal(
        rows.filter((r) => r.state === "active").length,
        reason === "already-held" ? 1 : 0,
      );
      assert.notEqual(
        (await t.run((ctx) => ctx.db.get(invite.invitationId)))!.state,
        "accepted",
      );
    });
  it("revalidates inviter permission removal while assignable roles remain", async () => {
    const { t, ownerClient, delegate, recipient, admin, event } = await setup();
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club",
      roleId: admin._id,
      label: "Admin",
      permissions: ["manage_staff"],
      assignableRoleIds: [event._id],
    });
    const first = await ownerClient.mutation(
      api.clubStaff.createStaffInvitation,
      { communitySlug: "test-club", roleIds: [admin._id] },
    );
    await t
      .withIdentity(delegate)
      .mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: first.token,
      });
    const invite = await t
      .withIdentity(delegate)
      .mutation(api.clubStaff.createStaffInvitation, {
        communitySlug: "test-club",
        roleIds: [event._id],
      });
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club",
      roleId: admin._id,
      label: "Admin",
      permissions: [],
      assignableRoleIds: [event._id],
    });
    await assert.rejects(
      t
        .withIdentity(recipient)
        .mutation(api.clubStaff.acceptStaffInvitation, {
          communitySlug: "test-club",
          token: invite.token,
        }),
    );
    assert.equal(
      await t
        .withIdentity(recipient)
        .query(api.clubStaff.getWorkspace, { communitySlug: "test-club" }),
      null,
    );
  });
  it("omits selected-role history and collector data for current-only staff", async () => {
    const { t, ownerClient, recipient, communityProfileId, admin, event } =
      await setup();
    const invite = await ownerClient.mutation(
      api.clubStaff.createStaffInvitation,
      { communitySlug: "test-club", roleIds: [event._id] },
    );
    await t
      .withIdentity(recipient)
      .mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: invite.token,
      });
    for (const category of CLUB_CATEGORIES)
      await ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
        communitySlug: "test-club",
        category,
        audience: "staff",
        staffRoleIds:
          category === "current_population" ? [event._id] : [admin._id],
      });
    const now = Date.now();
    await t.run(async (ctx) => {
      const collector = await ctx.db.insert("collectorAccounts", {
        vrchatUserId: "usr_secret",
        accountAlias: "secret-collector",
        state: "ready",
        capacity: 10,
        reservedHeadroom: 0,
        assignedGroupCount: 1,
        requestsPerMinute: 30,
        secretRef: "secret-ref",
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
        killSwitchEnabled: false,
        requestsPerMinute: 30,
        leaseGeneration: 0,
        publicMetrics: {
          currentPopulation: false,
          populationHistory: false,
          groupMemberCount: false,
          groupMemberGrowth: false,
          eventRecaps: false,
        },
        consecutiveFailures: 0,
        assignedCollectorAccountId: collector,
        lastSuccessfulObservationAt: now,
        createdAt: now - 1000,
        updatedAt: now,
      });
      await ctx.db.insert("instanceSessions", {
        communityProfileId,
        integrationId,
        providerInstanceId: "private-history-id",
        providerLocation: "private-location",
        vrchatWorldId: "wrld_test",
        source: "first_party",
        state: "open",
        openedAt: now - 500,
        lastObservedAt: now,
        consecutiveMisses: 0,
        updatedAt: now,
      });
      await ctx.db.insert("communityPopulationObservations", {
        integrationId,
        idempotencyKey: "point",
        totalPopulation: 42,
        activeInstanceCount: 1,
        worldDistribution: [],
        observedAt: now,
        source: "first_party",
        collectorVersion: "v1",
        coverageState: "observed",
        fencingToken: 1,
      });
    });
    const client = t.withIdentity(recipient);
    const data = await client.query(
      api.communityTelemetry.getPrivateDashboard,
      { communitySlug: "test-club", now },
    );
    assert.deepEqual(data!.readableCategories, ["current_population"]);
    assert.equal(data!.summary.currentPopulation, 42);
    assert.deepEqual(data!.sessions, []);
    assert.deepEqual(data!.population, []);
    assert.deepEqual(data!.instancePopulation, []);
    assert.deepEqual(data!.rollups, []);
    assert.equal("collector" in data!.integration, false);
    assert.equal(JSON.stringify(data).includes("private-history-id"), false);
    assert.equal(JSON.stringify(data).includes("secret-collector"), false);
    assert.equal(
      (await client.query(api.clubStaff.getWorkspace, {
        communitySlug: "test-club",
      }))!.integration,
      null,
    );
  });
});
