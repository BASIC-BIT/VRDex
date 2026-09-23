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
  "../../convex/clubAnalytics.ts": () => import("../../convex/clubAnalytics"),
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
  it("projects published recaps separately from event management records", async () => {
    const { t, ownerClient, communityProfileId, recipient, event: role, admin } = await setup();
    const now = Date.now(), epoch = now - 60_000;
    const seeded = await t.run(async (ctx) => {
      const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
        communityProfileId, vrchatGroupId: "grp_test", groupVisibility: "public", joinPolicy: "free",
        state: "active", killSwitchEnabled: false, requestsPerMinute: 30, leaseGeneration: 0,
        publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
        consecutiveFailures: 0, createdAt: epoch, updatedAt: now,
      });
      const sessionId = await ctx.db.insert("instanceSessions", {
        communityProfileId, integrationId, providerInstanceId: "instance", providerLocation: "location",
        vrchatWorldId: "wrld_test", source: "first_party", state: "open", openedAt: epoch,
        lastObservedAt: now, consecutiveMisses: 0, updatedAt: now,
      });
      const events = [];
      for (const [index, label] of ["published", "draft", "suggested", "rejected", "old", "foreign", "deleted"].entries()) {
        const eventId = await ctx.db.insert("events", {
          slug: `boundary-${label}`, title: `Title ${label}`, sortTitle: label,
          startAt: epoch + index * 1000, endAt: now + index * 1000,
          communityProfileId, sourceType: "manual", sourceLabel: "test", eventStatus: "scheduled",
          publicationState: label === "draft" ? "draft_private" : "published", updatedAt: now,
        });
        events.push(eventId);
        const state = label === "suggested" ? "suggested" : label === "rejected" ? "rejected" : "confirmed";
        await ctx.db.insert("eventInstanceAssociations", {
          communityProfileId, eventId, sessionId, state, source: "manual", confidence: 0.75,
          actor: { subject: "secret-actor-subject", issuer: "secret-actor-issuer", tokenIdentifier: "secret-actor-token" },
          reviewedAt: now, createdAt: label === "old" ? epoch - 1000 : epoch, updatedAt: now,
        });
        if (state !== "confirmed") continue;
        await ctx.db.insert("communityTelemetryRollups", {
          communityProfileId, eventId, grain: "event", bucketStartAt: label === "old" ? epoch - 1000 : epoch + index * 1000,
          bucketEndAt: now + index * 1000, rollupVersion: "community-telemetry-v1", activeInstanceCount: 1,
          peakConcurrency: 20, playerMinutes: 120, coverageRatio: 1, groupMemberCount: 100,
          groupMemberGrowth: 5, worldDistribution: [], computedAt: now,
        });
      }
      const { _id, _creationTime, ...profile } = (await ctx.db.get(communityProfileId))!;
      const foreignCommunity = await ctx.db.insert("profiles", { ...profile, slug: "foreign-community" });
      await ctx.db.patch(events[5]!, { communityProfileId: foreignCommunity });
      await ctx.db.delete(events[6]!);
      const assignmentId = await ctx.db.insert("communityAuthorities", {
        communityProfileId, subjectTokenIdentifier: recipient.tokenIdentifier, subject: recipient,
        roleId: role._id, state: "active", grantedAt: now, updatedAt: now,
      });
      return { events, sessionId, assignmentId };
    });
    for (const category of CLUB_CATEGORIES) await ownerClient.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "test-club", category, audience: "staff",
      staffRoleIds: category === "event_recaps" ? [role._id] : [admin._id],
    });
    const client = t.withIdentity(recipient);
    const dashboard = () => client.query(api.communityTelemetry.getPrivateDashboard, { communitySlug: "test-club", now });
    for (const permissions of [[], ["manage_integrations"]] as const) {
      await t.run(ctx => ctx.db.patch(role._id, { permissions: [...permissions] }));
      const data = (await dashboard())!;
      assert.deepEqual(data.associations, []);
      assert.deepEqual(data.events.map(e => e._id), [seeded.events[0]]);
      assert.deepEqual(data.rollups.map(r => r.eventId), [seeded.events[0]]);
      assert.equal(data.events[0]!.title, "Title published");
      assert.equal(data.rollups[0]!.peakConcurrency, 20);
      assert.equal("groupMemberCount" in data.rollups[0]!, false);
      assert.equal("groupMemberGrowth" in data.rollups[0]!, false);
      for (const marker of ["secret-actor", ...seeded.events.slice(1)]) assert.equal(JSON.stringify(data).includes(marker), false, marker);
      await assert.rejects(client.query(api.clubAnalytics.listAssociationSuggestions, { communitySlug: "test-club", paginationOpts: { numItems: 10, cursor: null } }));
      const recaps = await client.query(api.clubAnalytics.listEventRecaps, { communitySlug: "test-club", startAt: epoch, endAt: now + 10_000, paginationOpts: { numItems: 10, cursor: null } });
      assert.deepEqual(recaps.page.map(r => r.eventId), [seeded.events[0]]);
    }
    await t.run(ctx => ctx.db.patch(role._id, { permissions: ["manage_events"] }));
    for (const manager of [client, ownerClient]) {
      const data = (await manager.query(api.communityTelemetry.getPrivateDashboard, { communitySlug: "test-club", now }))!;
      assert.deepEqual(new Set(data.associations.map(a => a.state)), new Set(["suggested", "confirmed", "rejected"]));
      assert.ok(data.events.some(e => e._id === seeded.events[1]));
      for (const row of data.associations) assert.deepEqual(Object.keys(row).sort(), ["_id", "confidence", "eventId", "sessionId", "state"]);
      assert.equal(JSON.stringify(data).includes("secret-actor"), false);
    }
    await client.query(api.clubAnalytics.listAssociationSuggestions, { communitySlug: "test-club", paginationOpts: { numItems: 10, cursor: null } });
    // Published recap lookup must not depend on the latest 100 events or 200 associations.
    await t.run(async ctx => {
      for (let i = 0; i < 101; i++) await ctx.db.insert("events", {
        slug: `unrelated-draft-${i}`, title: `Unrelated draft ${i}`, sortTitle: "unrelated", startAt: now + 100_000 + i,
        communityProfileId, sourceType: "manual", sourceLabel: "test", eventStatus: "scheduled", publicationState: "draft_private", updatedAt: now,
      });
      for (let i = 0; i < 201; i++) await ctx.db.insert("eventInstanceAssociations", {
        communityProfileId, eventId: seeded.events[2]!, sessionId: seeded.sessionId, state: "suggested", source: "time_world_overlap",
        confidence: 0.5, createdAt: now + i, updatedAt: now,
      });
      await ctx.db.patch(role._id, { permissions: [] });
    });
    assert.deepEqual((await dashboard())!.events.map(e => e._id), [seeded.events[0]]);
    assert.deepEqual((await dashboard())!.rollups.map(r => r.eventId), [seeded.events[0]]);
    await t.run(ctx => ctx.db.patch(role._id, { permissions: ["manage_events"] }));
    await ownerClient.mutation(api.clubStaff.setCategoryVisibility, { communitySlug: "test-club", category: "event_recaps", audience: "staff", staffRoleIds: [admin._id] });
    const denied = (await dashboard())!;
    assert.deepEqual(denied.associations, []);
    assert.deepEqual(denied.events, []);
    assert.deepEqual(denied.rollups, []);
    await assert.rejects(client.query(api.clubAnalytics.listAssociationSuggestions, { communitySlug: "test-club", paginationOpts: { numItems: 10, cursor: null } }));
    await assert.rejects(client.query(api.clubAnalytics.listEventRecaps, { communitySlug: "test-club", startAt: epoch, endAt: now, paginationOpts: { numItems: 10, cursor: null } }));
    assert.equal((await client.query(api.communityTelemetry.getInstanceEventAssociation, { communitySlug: "test-club", sessionId: seeded.sessionId }))!.eventId, seeded.events[0]);
    assert.ok((await ownerClient.query(api.communityTelemetry.getPrivateDashboard, { communitySlug: "test-club", now }))!.associations.length);
    await t.run(ctx => ctx.db.patch(seeded.assignmentId, { state: "revoked" }));
    await assert.rejects(dashboard());
  });
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
