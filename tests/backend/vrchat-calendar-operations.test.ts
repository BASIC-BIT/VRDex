import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { validatePayload, policyOperation, type OperationPayload } from "../../convex/_clubOperations";
import { assessClubOperation, clubOperationRequirement } from "../../convex/_clubOperationPolicy";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/clubConnection.ts": () => import("../../convex/clubConnection"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};

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
