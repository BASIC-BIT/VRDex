import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { enqueueConnectorOperation } from "../../convex/clubOperations";
import { validatePayload, policyOperation, type OperationPayload } from "../../convex/_clubOperations";
import { assessClubOperation, clubOperationRequirement } from "../../convex/_clubOperationPolicy";
import { CAL_1, EVENT_URL, NOW, asOwner, calId, modules, operations, seedVrchatConnector, setupEnv, vrchatItem, workerSettle } from "./_vrchatCalendarFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

const GROUP = "grp_11111111-1111-1111-1111-111111111111";
const CAL = "cal_33333333-3333-3333-3333-333333333333";
const base = { title: "Bass Temple", description: "Weekly bass night.", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" as const };

describe("calendar operation payloads", () => {
  it("accepts the four calendar kinds", () => {
    validatePayload({ kind: "create_calendar_event", ...base, imageUrl: "https://vrdex.test/poster.png" }, GROUP);
    validatePayload({ kind: "update_calendar_event", calendarEventId: CAL, ...base }, GROUP);
    validatePayload({ kind: "delete_calendar_event", calendarEventId: CAL }, GROUP);
    validatePayload({ kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" }, GROUP);
  });

  it("rejects malformed calendar payloads", () => {
    const bad: unknown[] = [
      { kind: "create_calendar_event", ...base, title: "x".repeat(65) },
      { kind: "create_calendar_event", ...base, title: "" },
      { kind: "create_calendar_event", ...base, description: "x".repeat(2001) },
      { kind: "create_calendar_event", ...base, endsAt: base.startsAt },
      { kind: "create_calendar_event", ...base, startsAt: "next friday" },
      { kind: "create_calendar_event", ...base, imageUrl: "http://vrdex.test/poster.png" },
      { kind: "delete_calendar_event", calendarEventId: "cal_1" },
      { kind: "list_calendar_events", from: "2027-01-31T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" },
      { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-02-03T00:00:00.000Z" },
    ];
    for (const payload of bad) assert.throws(() => validatePayload(payload as OperationPayload, GROUP), JSON.stringify(payload));
  });

  it("calendar kinds need the calendar feature and manage_events", () => {
    for (const kind of ["create_calendar_event", "update_calendar_event", "delete_calendar_event"] as const)
      assert.deepEqual(clubOperationRequirement({ kind }), { feature: "calendar", permission: "manage_events", providerPermissions: ["group-calendar-manage"] });
    assert.deepEqual(clubOperationRequirement({ kind: "list_calendar_events" }), { feature: "calendar", permission: "manage_events", providerPermissions: [] });
  });

  it("assessment denies a calendar write without the feature, the permission, or the grant", () => {
    const now = 1_000_000;
    const authority = {
      actorKind: "staff" as const, permissions: ["manage_events" as const], enabledFeatures: ["calendar" as const], integrationActive: true,
      expectedGroupId: GROUP, expectedBotUserId: "usr_22222222-2222-2222-2222-222222222222", permittedProviderRoleIds: [], now,
      provider: { groupId: GROUP, userId: "usr_22222222-2222-2222-2222-222222222222", membershipStatus: "member", permissions: ["group-calendar-manage"], observedAt: now },
    };
    const op = policyOperation({ kind: "create_calendar_event", ...base }, "public");
    assert.equal(assessClubOperation(authority, op).allowed, true);
    assert.equal(assessClubOperation({ ...authority, enabledFeatures: ["posts"] }, op).reason, "feature_disabled");
    assert.equal(assessClubOperation({ ...authority, permissions: ["manage_integrations"] }, op).reason, "staff_permission");
    assert.equal(assessClubOperation({ ...authority, provider: { ...authority.provider, permissions: [] } }, op).reason, "provider_permissions");
  });
});

it("staff mutations refuse calendar payloads and the calendar feature can be enabled", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const { communityProfileId, integrationId } = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { clerkUserId: "owner" });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "calendar-club", displayName: "Club", sortName: "club", aliases: [], tags: [],
      claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public",
      creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId: user, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_22222222-2222-2222-2222-222222222222", accountAlias: "bot", state: "ready", capacity: 10,
      reservedHeadroom: 0, assignedGroupCount: 1, requestsPerMinute: 30, secretRef: "secret", workerKeyHash: "hash",
      credentialGeneration: 1, killSwitchEnabled: false, createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId, vrchatGroupId: GROUP, groupVisibility: "public", joinPolicy: "free", state: "active",
      assignedCollectorAccountId: collectorAccountId, killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1,
      publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
      consecutiveFailures: 0, telemetryEpochStartedAt: now - 1000, createdAt: now - 1000, updatedAt: now,
      enabledFeatures: ["calendar"],
    });
    return { communityProfileId, integrationId };
  });
  const owner = t.withIdentity({ subject: "owner", issuer: "https://test.clerk.accounts.dev", tokenIdentifier: "https://test.clerk.accounts.dev|owner" });
  await assert.rejects(
    owner.mutation(makeFunctionReference<"mutation">("clubOperations:enqueue"), {
      communityProfileId, requestId: "calendar-request", payloads: [{ kind: "create_calendar_event", ...base }], schedule: { kind: "immediate" },
    }),
    /Validator error|ArgumentValidationError|does not match/i,
  );
  await owner.mutation(makeFunctionReference<"mutation">("clubConnection:setFeature"), { communityProfileId, feature: "calendar", enabled: true });
  const integration = await t.run((ctx) => ctx.db.get(integrationId));
  assert.ok(integration!.enabledFeatures!.includes("calendar"));
  const subject = { tokenIdentifier: "https://test.clerk.accounts.dev|owner", issuer: "https://test.clerk.accounts.dev", subject: "owner" };
  await t.run((ctx) => ctx.db.insert("clubOperations", {
    readyAt: now, communityProfileId, integrationId, epochStartedAt: now - 1000, requestId: "connector", batchId: "connector",
    payload: { kind: "delete_calendar_event", calendarEventId: CAL }, schedule: { kind: "immediate" }, dueAt: now,
    actor: subject, createdBy: subject, revision: 1, state: "pending", createdAt: now, updatedAt: now,
  }));
  const page = await owner.query(makeFunctionReference<"query">("clubOperations:list"), { communityProfileId, paginationOpts: { numItems: 10, cursor: null } });
  assert.deepEqual(page.page, []);
});

describe("connector operations", () => {
  beforeEach(setupEnv);
  const create = { kind: "create_calendar_event" as const, title: "Bass Temple", description: EVENT_URL, startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" as const };
  const job = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">) =>
    t.run((ctx) => ctx.db.insert("eventSyncJobs", { connectorId, kind: "export_upsert", payload: {}, dueAt: NOW, attempts: 0, state: "running", leaseExpiresAt: NOW + 1_800_000, createdAt: NOW, updatedAt: NOW }));

  it("enqueues an immediate operation as the connector authority with no event", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    const [op] = await operations(t);
    assert.deepEqual(out, { operationId: op._id });
    assert.equal(op.actor.tokenIdentifier, "https://test.clerk.accounts.dev|owner");
    assert.deepEqual(op.schedule, { kind: "immediate" });
    assert.equal(op.eventId, undefined);
    assert.deepEqual(op.connectorSync, { connectorId, jobId });
    assert.equal(op.state, "pending");
    assert.equal(op.dueAt, NOW);
  });

  it("refuses without the feature, without manage_events, or without a collector", async () => {
    for (const [options, refused] of [
      [{ features: ["posts"] }, "feature_disabled"],
      [{ authority: "integrations_only" as const }, "staff_permission"],
      [{ assigned: false }, "integration_unavailable"],
    ] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId } = await seedVrchatConnector(t, options);
      const jobId = await job(t, connectorId!);
      const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
      assert.deepEqual(out, { refused });
      assert.equal((await operations(t)).length, 0);
    }
  });

  it("a terminal connector operation resumes its job, files no notice, and stays out of the staff list", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    await t.run((ctx) => ctx.db.patch(jobId, { payload: { operationId: (out as { operationId: Id<"clubOperations"> }).operationId, step: "write" } }));
    const listed = await asOwner(t).query(api.clubOperations.list, { communityProfileId, paginationOpts: { numItems: 10, cursor: null } });
    assert.equal(listed.page.length, 0);
    await workerSettle(t, { status: "rejected", code: "provider_permissions" });
    assert.ok((await t.run((ctx) => ctx.db.get(jobId)))!.leaseExpiresAt! <= NOW);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    assert.deepEqual(scheduled.filter((f) => f.name === "eventSync:runJob").map((f) => (f.args[0] as { jobId: string }).jobId), [jobId]);
    assert.deepEqual(await t.run((ctx) => ctx.db.query("clubOperationNotifications").collect()), []);
  });

  it("refuses when the community's group is no longer the connector's", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, integrationId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    await t.run((ctx) => ctx.db.patch(integrationId, { vrchatGroupId: "grp_99999999-9999-9999-9999-999999999999" }));
    const out = await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    assert.deepEqual(out, { refused: "integration_unavailable" });
    assert.equal((await operations(t)).length, 0);
  });

  const listed = { kind: "list_calendar_events" as const, from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" };
  it("measures a list result in bytes", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: listed, syncJobId: jobId }));
    // About 400,000 characters, but 1.2 MB of UTF-8.
    const items = Array.from({ length: 200 }, (_, n) => vrchatItem({ id: calId(n + 1), description: "語".repeat(2000) }));
    await assert.rejects(workerSettle(t, { status: "succeeded", result: { calendarEvents: items } }), /Invalid operation result/);
  });

  it("refuses a listed entry whose ID is not a calendar ID", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: listed, syncJobId: jobId }));
    await assert.rejects(workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem({ id: "cal_nope" })] } }), /Invalid operation result/);
  });

  it("complete stores calendar results and refuses oversized lists", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t);
    const jobId = await job(t, connectorId!);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: create, syncJobId: jobId }));
    assert.equal((await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } })).result?.calendarEventId, CAL_1);
    await t.run(async (ctx) => enqueueConnectorOperation(ctx, { connector: (await ctx.db.get(connectorId!))!, payload: { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" }, syncJobId: jobId }));
    const items = Array.from({ length: 201 }, (_, n) => vrchatItem({ id: calId(n + 1) }));
    await assert.rejects(workerSettle(t, { status: "succeeded", result: { calendarEvents: items } }), /Invalid operation result/);
  });
});
