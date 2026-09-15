import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Deployment-owned URL, never a caller-supplied target. Production has no override.
function guard(secret: string) {
  const target = new URL(
    process.env.CONVEX_CLOUD_URL ?? "https://invalid.invalid",
  );
  if (
    !(
      target.origin === "https://scrupulous-corgi-247.convex.cloud" ||
      (target.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(target.hostname))
    ) ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true" ||
    !process.env.VRDEX_E2E_CONVEX_SECRET?.trim() ||
    secret !== process.env.VRDEX_E2E_CONVEX_SECRET.trim()
  )
    throw new Error("Club staff fixture is unavailable.");
}

function runSlug(runId: string) {
  if (!/^[a-z0-9-]{1,48}$/.test(runId))
    throw new Error("Invalid fixture run ID.");
  return `e2e-club-${runId}`;
}

async function fixture(
  ctx: MutationCtx,
  runId: string,
  profileId: Id<"profiles">,
) {
  const profile = await ctx.db.get(profileId);
  if (
    !profile ||
    profile.slug !== runSlug(runId) ||
    profile.profileType !== "community" ||
    profile.sourceAttribution?.submitter.tokenIdentifier !==
      `e2e-club:${runId}` ||
    profile.sourceAttribution.submitter.issuer !== "vrdex:e2e-club" ||
    profile.sourceAttribution.submitter.subject !== runId
  )
    throw new Error("Exact club fixture required.");
  return profile;
}

export const seed = internalMutation({
  args: { secret: v.string(), runId: v.string(), ownerClerkUserId: v.string() },
  handler: async (ctx, args) => {
    guard(args.secret);
    const slug = runSlug(args.runId);
    const owner = await ctx.db
      .query("users")
      .withIndex("clerkUserId", (q) =>
        q.eq("clerkUserId", args.ownerClerkUserId),
      )
      .unique();
    if (!owner?.email?.endsWith("+clerk_test@e2e.vrdex.net"))
      throw new Error("Disposable Clerk owner required.");
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) throw new Error("Fixture run already exists.");
    const now = Date.now();
    const profileId = await ctx.db.insert("profiles", {
      slug,
      displayName: `Club fixture ${args.runId}`,
      sortName: slug,
      aliases: [],
      tags: [],
      profileType: "community",
      community: { categoryTags: [] },
      claimState: "claimed_verified",
      publicationState: "draft_private",
      publicSurfacingState: "opted_out",
      creationSource: "community",
      updatedAt: now,
      sourceAttribution: {
        submittedAt: now,
        submitter: {
          tokenIdentifier: `e2e-club:${args.runId}`,
          issuer: "vrdex:e2e-club",
          subject: args.runId,
        },
      },
    });
    await ctx.db.insert("profileOwners", {
      profileId,
      userId: owner._id,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    return { profileId, slug };
  },
});

export const lookup = internalMutation({
  args: { secret: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    guard(args.secret);
    const row = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", runSlug(args.runId)))
      .unique();
    if (!row) return null;
    await fixture(ctx, args.runId, row._id);
    return { profileId: row._id, slug: row.slug! };
  },
});

function analyticsGuard(secret: string) {
  guard(secret);
  const target = new URL(process.env.CONVEX_CLOUD_URL!);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    process.env.VRDEX_ENABLE_E2E_ANALYTICS_HELPERS !== "true"
  )
    throw new Error("Local analytics fixture is unavailable.");
}

export const seedAnalytics = internalMutation({
  args: { secret: v.string(), runId: v.string(), profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    analyticsGuard(args.secret);
    await fixture(ctx, args.runId, args.profileId);
    if (
      await ctx.db
        .query("communityVrchatIntegrations")
        .withIndex("by_communityProfileId", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .first()
    )
      throw new Error("Fixture already has an integration.");
    const marker = `e2e-analytics:${args.runId}`;
    const startAt = Date.UTC(2026, 8, 8, 12);
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: args.profileId,
      vrchatGroupId: marker,
      groupVisibility: "public",
      joinPolicy: "free",
      state: "blocked",
      killSwitchEnabled: true,
      requestsPerMinute: 1,
      leaseGeneration: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      telemetryEpochStartedAt: startAt - 86400000,
      createdAt: startAt,
      updatedAt: startAt,
    });
    const sessionId = await ctx.db.insert("instanceSessions", {
      integrationId,
      communityProfileId: args.profileId,
      providerInstanceId: marker,
      providerLocation: marker,
      vrchatWorldId: marker,
      source: "first_party",
      state: "closed",
      openedAt: startAt,
      lastObservedAt: startAt + 300000,
      closedAt: startAt + 300000,
      consecutiveMisses: 0,
      updatedAt: startAt + 300000,
    });
    for (let i = 0; i < 6; i++) {
      const common = {
        integrationId,
        idempotencyKey: `${marker}:${i}`,
        observedAt: startAt + i * 60000,
        source: "first_party" as const,
        collectorVersion: marker,
        coverageState: "observed" as const,
        fencingToken: 0,
      };
      await ctx.db.insert("communityPopulationObservations", {
        ...common,
        totalPopulation: 10 + i * 3,
        activeInstanceCount: 1,
        worldDistribution: [],
      });
      await ctx.db.insert("instancePopulationObservations", {
        ...common,
        sessionId,
        providerInstanceId: marker,
        vrchatWorldId: marker,
        population: 10 + i * 3,
      });
      await ctx.db.insert("communityMemberCountObservations", {
        ...common,
        communityProfileId: args.profileId,
        vrchatGroupId: marker,
        memberCount: 1000 + i,
      });
    }
    return { integrationId, sessionId, startAt, endAt: startAt + 300000 };
  },
});

export const cleanupAnalytics = internalMutation({
  args: { secret: v.string(), runId: v.string(), profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    analyticsGuard(args.secret);
    await fixture(ctx, args.runId, args.profileId);
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", args.profileId),
      )
      .unique();
    if (!integration) return null;
    const marker = `e2e-analytics:${args.runId}`;
    if (
      integration.vrchatGroupId !== marker ||
      integration.state !== "blocked" ||
      !integration.killSwitchEnabled ||
      integration.assignedCollectorAccountId ||
      integration.leaseGeneration !== 0
    )
      throw new Error("Exact inactive synthetic integration required.");
    const sessions = await ctx.db
      .query("instanceSessions")
      .withIndex("by_integrationId_state", (q) =>
        q.eq("integrationId", integration._id),
      )
      .take(2);
    if (
      sessions.length !== 1 ||
      sessions[0]!.providerLocation !== marker ||
      sessions[0]!.providerInstanceId !== marker ||
      sessions[0]!.state !== "closed"
    )
      throw new Error("Unexpected fixture sessions.");
    const rows = await Promise.all([
      ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q.eq("integrationId", integration._id),
        )
        .take(7),
      ctx.db
        .query("instancePopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q.eq("integrationId", integration._id),
        )
        .take(7),
      ctx.db
        .query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q.eq("integrationId", integration._id),
        )
        .take(7),
    ]);
    if (
      rows.some(
        (list) =>
          list.length !== 6 ||
          list.some(
            (row, i) =>
              row.idempotencyKey !== `${marker}:${i}` ||
              row.collectorVersion !== marker,
          ),
      )
    )
      throw new Error("Unexpected fixture observations.");
    if (
      await ctx.db
        .query("events")
        .withIndex("by_communityProfileId_startAt", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .first()
    )
      throw new Error("Unexpected fixture event.");
    const preferences = await ctx.db
      .query("communityDashboardPreferences")
      .withIndex("by_communityProfileId_scope_subject", (q) =>
        q.eq("communityProfileId", args.profileId),
      )
      .take(11);
    if (preferences.length > 10)
      throw new Error("Fixture preference bound exceeded.");
    for (const list of rows)
      for (const row of list) await ctx.db.delete(row._id);
    for (const row of preferences) await ctx.db.delete(row._id);
    await ctx.db.delete(sessions[0]!._id);
    await ctx.db.delete(integration._id);
    return null;
  },
});

export const expireInvitation = internalMutation({
  args: {
    secret: v.string(),
    runId: v.string(),
    profileId: v.id("profiles"),
    invitationId: v.id("communityStaffInvitations"),
  },
  handler: async (ctx, args) => {
    guard(args.secret);
    await fixture(ctx, args.runId, args.profileId);
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.communityProfileId !== args.profileId)
      throw new Error("Exact fixture invitation required.");
    await ctx.db.patch(invite._id, { expiresAt: Date.now() - 1 });
    return null;
  },
});

export const cleanup = internalMutation({
  args: { secret: v.string(), runId: v.string(), profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    guard(args.secret);
    if (!(await ctx.db.get(args.profileId))) return null;
    await fixture(ctx, args.runId, args.profileId);
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", args.profileId),
      )
      .first();
    const event = await ctx.db
      .query("events")
      .withIndex("by_communityProfileId_startAt", (q) =>
        q.eq("communityProfileId", args.profileId),
      )
      .first();
    if (integration || event)
      throw new Error(
        "Fixture has unrelated activity; preserve it for inspection.",
      );
    const lists = await Promise.all([
      ctx.db
        .query("communityRoles")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .take(101),
      ctx.db
        .query("communityAuthorities")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .take(101),
      ctx.db
        .query("communityStaffInvitations")
        .withIndex("by_communityProfileId_state", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .take(101),
      ctx.db
        .query("communityDataVisibility")
        .withIndex("by_communityProfileId", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .take(101),
      ctx.db
        .query("communityActionLog")
        .withIndex("by_communityProfileId_createdAt", (q) =>
          q.eq("communityProfileId", args.profileId),
        )
        .take(101),
      ctx.db
        .query("profileOwners")
        .withIndex("by_profileId_state", (q) =>
          q.eq("profileId", args.profileId),
        )
        .take(101),
    ]);
    if (lists.some((rows) => rows.length > 100))
      throw new Error("Fixture cleanup bound exceeded.");
    for (const rows of lists)
      for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(args.profileId);
    return null;
  },
});
