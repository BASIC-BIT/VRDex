import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { resolveClubSubject } from "../../convex/_clubAccess";

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
describe("club staff and visibility", () => {
  it("lists only active canonical staff workspaces and excludes owned clubs", async () => {
    const { t, ownerClient, recipient, event, communityProfileId } =
      await setup();
    const client = t.withIdentity(recipient);
    assert.deepEqual(await t.query(api.clubStaff.listStaffWorkspaces, {}), {
      workspaces: [],
      hasMore: false,
    });
    assert.deepEqual(
      await client.query(api.clubStaff.listStaffWorkspaces, {}),
      { workspaces: [], hasMore: false },
    );
    const invite = await ownerClient.mutation(
      api.clubStaff.createStaffInvitation,
      { communitySlug: "test-club", roleIds: [event._id] },
    );
    await client.mutation(api.clubStaff.acceptStaffInvitation, {
      communitySlug: "test-club",
      token: invite.token,
    });
    assert.deepEqual(
      await client.query(api.clubStaff.listStaffWorkspaces, {}),
      {
        workspaces: [{ slug: "test-club", displayName: "Test club" }],
        hasMore: false,
      },
    );
    assert.deepEqual(
      await ownerClient.query(api.clubStaff.listStaffWorkspaces, {}),
      { workspaces: [], hasMore: false },
    );
    const assignment = await t.run((ctx) =>
      ctx.db
        .query("communityAuthorities")
        .withIndex("by_subjectTokenIdentifier_state_communityProfileId", (q) =>
          q
            .eq("subjectTokenIdentifier", recipient.tokenIdentifier)
            .eq("state", "active")
            .eq("communityProfileId", communityProfileId),
        )
        .unique(),
    );
    await t.run((ctx) =>
      ctx.db.patch(assignment!._id, {
        subject: { ...recipient, issuer: "https://foreign.example" },
      }),
    );
    assert.deepEqual(
      (await client.query(api.clubStaff.listStaffWorkspaces, {})).workspaces,
      [],
    );
    await t.run((ctx) =>
      ctx.db.patch(assignment!._id, { subject: recipient, state: "revoked" }),
    );
    assert.deepEqual(
      (await client.query(api.clubStaff.listStaffWorkspaces, {})).workspaces,
      [],
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(assignment!._id, { state: "active" });
      await ctx.db.patch(event._id, { state: "deleted" });
    });
    assert.deepEqual(
      (await client.query(api.clubStaff.listStaffWorkspaces, {})).workspaces,
      [],
    );
  });
  it("discovers distinct workspaces after 100 assignments in the first club", async () => {
    const { t, recipient, communityProfileId } = await setup();
    await t.run(async ctx => {
      const original = (await ctx.db.get(communityProfileId))!;
      const { _id, _creationTime, ...profile } = original;
      void _id; void _creationTime;
      const later = await ctx.db.insert("profiles", { ...profile, slug: "later-club", displayName: "Later club" });
      for (const [clubId, count] of [[communityProfileId, 100], [later, 20]] as const) {
        for (let index = 0; index < count; index++) {
          await ctx.db.insert("communityAuthorities", {
            communityProfileId: clubId, subjectTokenIdentifier: recipient.tokenIdentifier,
            subject: recipient, capabilities: ["manage_events"], roleKey: `legacy-${index}`,
            state: "active", grantedAt: Date.now(), updatedAt: Date.now(),
          });
        }
      }
    });
    const result = await t.withIdentity(recipient).query(api.clubStaff.listStaffWorkspaces, {});
    assert.deepEqual(result.workspaces.map(row => row.slug), ["later-club", "test-club"]);
    assert.equal(result.hasMore, false);
  });

  it("reports more only when the distinct community limit is exceeded", async () => {
    const { t, recipient, communityProfileId } = await setup();
    await t.run(async ctx => {
      const original = (await ctx.db.get(communityProfileId))!;
      const { _id, _creationTime, ...profile } = original;
      void _id; void _creationTime;
      for (let index = 0; index < 101; index++) {
        const id = await ctx.db.insert("profiles", { ...profile, slug: `club-${index}` });
        await ctx.db.insert("communityAuthorities", {
          communityProfileId: id, subjectTokenIdentifier: recipient.tokenIdentifier,
          subject: recipient, capabilities: ["manage_events"], state: "active",
          grantedAt: Date.now(), updatedAt: Date.now(),
        });
      }
    });
    const result = await t.withIdentity(recipient).query(api.clubStaff.listStaffWorkspaces, {});
    assert.equal(result.workspaces.length, 100);
    assert.equal(result.hasMore, true);
  });

  it("pages past 100 pending staff invitations so an older link can be revoked", async () => {
    const { t, ownerClient, owner, communityProfileId, event } = await setup();
    const ids = await t.run(async ctx => {
      const rows = [];
      for (let index = 0; index < 120; index++) {
        rows.push(await ctx.db.insert("communityStaffInvitations", {
          communityProfileId, tokenHash: `hash-${index}`, roleIds: [event._id],
          createdBySubject: owner, createdAt: Date.now(), expiresAt: Date.now() + 86400_000,
          state: "pending",
        }));
      }
      return rows;
    });
    const first = await ownerClient.query(api.clubStaff.listStaffInvitations, {
      communitySlug: "test-club", paginationOpts: { numItems: 50, cursor: null },
    });
    const second = await ownerClient.query(api.clubStaff.listStaffInvitations, {
      communitySlug: "test-club", paginationOpts: { numItems: 50, cursor: first.continueCursor },
    });
    const third = await ownerClient.query(api.clubStaff.listStaffInvitations, {
      communitySlug: "test-club", paginationOpts: { numItems: 50, cursor: second.continueCursor },
    });
    assert.equal(first.page.length, 50);
    assert.equal(second.page.length, 50);
    assert.equal(third.page.length, 20);
    assert.equal(third.isDone, true);
    assert.ok(third.page.some(row => row._id === ids[0]));
    await ownerClient.mutation(api.clubStaff.revokeStaffInvitation, {
      communitySlug: "test-club", invitationId: ids[0]!,
    });
    assert.equal((await t.run(ctx => ctx.db.get(ids[0]!)))?.state, "revoked");
  });

  it("does not offer profile editing in new staff roles", async () => {
    const { ownerClient, admin } = await setup();
    assert.equal(admin.permissions.includes("edit_community_profile"), false);
    await assert.rejects(ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", label: "Profile editor",
      permissions: ["edit_community_profile"], assignableRoleIds: [],
    }), /Invalid role details/);
  });

  it("keeps a legacy profile grant when an existing role is edited", async () => {
    const { t, ownerClient, admin } = await setup();
    await t.run(ctx => ctx.db.patch(admin._id, {
      permissions: [...admin.permissions, "edit_community_profile"],
    }));
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: admin._id, label: "Renamed admin",
      expectedUpdatedAt: admin.updatedAt,
      permissions: ["manage_staff"], assignableRoleIds: [],
    });
    const saved = await t.run(ctx => ctx.db.get(admin._id));
    assert.equal(saved?.label, "Renamed admin");
    assert.deepEqual(saved?.permissions, ["manage_staff", "edit_community_profile"]);
  });

  it("rejects a stale role tab before it restores permissions or delegation", async () => {
    const { t, ownerClient, admin, event } = await setup();
    await t.run(ctx => ctx.db.patch(admin._id, {
      assignableRoleIds: [event._id],
      updatedAt: Date.now() + 10_000,
    }));
    const firstTab = (await ownerClient.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    }))!.roles.find(role => role._id === admin._id)!;
    const secondTab = { ...firstTab };

    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: firstTab._id,
      expectedUpdatedAt: firstTab.updatedAt,
      label: firstTab.label,
      permissions: firstTab.permissions.filter(permission => permission !== "manage_staff"),
      assignableRoleIds: [],
    });
    const afterFirstSave = (await t.run(ctx => ctx.db.get(admin._id)))!;
    assert.ok(afterFirstSave.updatedAt > firstTab.updatedAt);
    assert.equal(afterFirstSave.permissions.includes("manage_staff"), false);
    assert.deepEqual(afterFirstSave.assignableRoleIds, []);

    await assert.rejects(ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: secondTab._id,
      expectedUpdatedAt: secondTab.updatedAt,
      label: "Renamed admin",
      permissions: secondTab.permissions,
      assignableRoleIds: secondTab.assignableRoleIds,
    }), /Refresh to continue/);
    await assert.rejects(ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: secondTab._id,
      label: "Renamed admin",
      permissions: secondTab.permissions,
      assignableRoleIds: secondTab.assignableRoleIds,
    }), /Refresh to continue/);
    assert.deepEqual((await t.run(ctx => ctx.db.get(admin._id)))!, afterFirstSave);

    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: admin._id,
      expectedUpdatedAt: afterFirstSave.updatedAt,
      label: "Renamed admin",
      permissions: afterFirstSave.permissions,
      assignableRoleIds: afterFirstSave.assignableRoleIds,
    });
    const refreshed = (await t.run(ctx => ctx.db.get(admin._id)))!;
    assert.equal(refreshed.label, "Renamed admin");
    assert.equal(refreshed.permissions.includes("manage_staff"), false);
    assert.deepEqual(refreshed.assignableRoleIds, []);
  });

  it("grants multiple roles atomically and consumes invitations once", async () => {
    const { t, ownerClient, recipient, admin, event } = await setup();
    const invite = await ownerClient.mutation(
      api.clubStaff.createStaffInvitation,
      { communitySlug: "test-club", roleIds: [admin._id, event._id] },
    );
    const stored = await t.run((ctx) => ctx.db.get(invite.invitationId));
    assert.notEqual(stored!.tokenHash, invite.token);
    const client = t.withIdentity(recipient);
    await client.mutation(api.clubStaff.acceptStaffInvitation, {
      communitySlug: "test-club",
      token: invite.token,
    });
    const workspace = await client.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    });
    assert.equal(workspace!.actor.kind, "staff");
    assert.equal(workspace!.actor.roleIds.length, 2);
    assert.ok(workspace!.actor.permissions.includes("manage_events"));
    await assert.rejects(
      client.mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: invite.token,
      }),
      /no longer valid/,
    );
    await assert.rejects(
      client.mutation(api.clubStaff.setCategoryVisibility, {
        communitySlug: "test-club",
        category: "group_size",
        audience: "public",
        staffRoleIds: null,
      }),
      /owner/,
    );
  });
  it("revalidates inviter delegation at acceptance and denies self-assignment", async () => {
    const { t, ownerClient, delegate, recipient, admin, event } = await setup();
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club",
      roleId: admin._id,
      expectedUpdatedAt: admin.updatedAt,
      label: "Admin",
      permissions: ["manage_staff"],
      assignableRoleIds: [event._id],
    });
    const bootstrap = await ownerClient.mutation(
      api.clubStaff.createStaffInvitation,
      { communitySlug: "test-club", roleIds: [admin._id] },
    );
    await t
      .withIdentity(delegate)
      .mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: bootstrap.token,
      });
    const invitation = await t
      .withIdentity(delegate)
      .mutation(api.clubStaff.createStaffInvitation, {
        communitySlug: "test-club",
        roleIds: [event._id],
      });
    await assert.rejects(
      t.withIdentity(delegate).mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: invitation.token,
      }),
      /no longer valid/,
    );
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club",
      roleId: admin._id,
      expectedUpdatedAt: (await t.run(ctx => ctx.db.get(admin._id)))!.updatedAt,
      label: "Admin",
      permissions: ["manage_staff"],
      assignableRoleIds: [],
    });
    await assert.rejects(
      t.withIdentity(recipient).mutation(api.clubStaff.acceptStaffInvitation, {
        communitySlug: "test-club",
        token: invitation.token,
      }),
      /no longer valid/,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(invitation.invitationId)))!.state,
      "pending",
    );
    assert.equal(
      await t
        .withIdentity(recipient)
        .query(api.clubStaff.getWorkspace, { communitySlug: "test-club" }),
      null,
    );
  });
  it("preserves legacy public fields on first edit and closes legacy mutation bypass", async () => {
    const { t, ownerClient, communityProfileId, recipient } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("communityVrchatIntegrations", {
        communityProfileId,
        vrchatGroupId: "grp_test",
        groupVisibility: "public",
        joinPolicy: "free",
        state: "active",
        killSwitchEnabled: false,
        requestsPerMinute: 30,
        leaseGeneration: 0,
        publicMetrics: {
          currentPopulation: true,
          populationHistory: false,
          groupMemberCount: true,
          groupMemberGrowth: false,
          eventRecaps: false,
        },
        consecutiveFailures: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("communityAuthorities", {
        communityProfileId,
        subjectTokenIdentifier: recipient.tokenIdentifier,
        subject: recipient,
        roleKey: "old",
        roleLabel: "Old role",
        capabilities: ["manage_integrations"],
        state: "active",
        grantedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "test-club",
      category: "event_recaps",
      audience: "public",
      staffRoleIds: null,
    });
    const workspace = await ownerClient.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    });
    assert.equal(workspace!.visibility!.current_population.audience, "public");
    assert.equal(workspace!.visibility!.group_size.audience, "public");
    await assert.rejects(
      t
        .withIdentity(recipient)
        .mutation(api.communityTelemetry.setPublicMetric, {
          communitySlug: "test-club",
          metric: "populationHistory",
          enabled: true,
        }),
      /owner/,
    );
    await assert.rejects(
      ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
        communitySlug: "test-club",
        category: "individual_membership_history",
        audience: "public",
        staffRoleIds: null,
      }),
      /cannot be public/,
    );
  });
  it("role deletion revokes grants and makes selected visibility owner-only", async () => {
    const { t, ownerClient, recipient, event } = await setup();
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
    await ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "test-club",
      category: "group_size",
      audience: "staff",
      staffRoleIds: [event._id],
    });
    assert.deepEqual(
      await ownerClient.mutation(api.clubStaff.deleteRole, {
        communitySlug: "test-club",
        roleId: event._id,
        expectedUpdatedAt: event.updatedAt,
      }),
      ["group_size"],
    );
    const workspace = await ownerClient.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    });
    assert.equal(workspace!.visibility!.group_size.audience, "owner");
    assert.equal(workspace!.assignments.length, 0);
    assert.equal(
      await t
        .withIdentity(recipient)
        .query(api.clubStaff.getWorkspace, { communitySlug: "test-club" }),
      null,
    );
  });
  it("rejects a stale deletion after another tab edits the role", async () => {
    const { t, ownerClient, recipient, event } = await setup();
    const original = (await ownerClient.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    }))!.roles.find(role => role._id === event._id)!;
    const invite = await ownerClient.mutation(api.clubStaff.createStaffInvitation, {
      communitySlug: "test-club", roleIds: [event._id],
    });
    await t.withIdentity(recipient).mutation(api.clubStaff.acceptStaffInvitation, {
      communitySlug: "test-club", token: invite.token,
    });
    await ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "test-club", category: "group_size",
      audience: "staff", staffRoleIds: [event._id],
    });
    await ownerClient.mutation(api.clubStaff.saveRole, {
      communitySlug: "test-club", roleId: event._id,
      expectedUpdatedAt: original.updatedAt,
      label: "Renamed event staff", permissions: original.permissions,
      assignableRoleIds: original.assignableRoleIds,
    });
    const edited = (await t.run(ctx => ctx.db.get(event._id)))!;
    assert.ok(edited.updatedAt > original.updatedAt);
    await assert.rejects(ownerClient.mutation(api.clubStaff.deleteRole, {
      communitySlug: "test-club", roleId: event._id,
      expectedUpdatedAt: original.updatedAt,
    }), /Refresh to continue/);
    const workspace = (await ownerClient.query(api.clubStaff.getWorkspace, {
      communitySlug: "test-club",
    }))!;
    assert.equal(workspace.roles.find(role => role._id === event._id)?.label, "Renamed event staff");
    assert.equal(workspace.assignments.length, 1);
    assert.equal(workspace.visibility?.group_size.audience, "staff");
  });
  it("denies a same-token staff identity with a different issuer", async () => {
    const { t, ownerClient, recipient, event, communityProfileId } =
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
    assert.equal(
      (
        await t.run((ctx) =>
          resolveClubSubject(ctx.db, communityProfileId, {
            ...recipient,
            issuer: "https://wrong.example",
          }),
        )
      ).kind,
      "none",
    );
  });
});
