import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  CURRENT_FRESHNESS_MS,
  DEFAULT_PUBLIC_TELEMETRY_SETTINGS,
  INSTANCE_CLOSE_MISSES,
  TELEMETRY_ROLLUP_VERSION,
  computePopulationMetrics,
  coverageStateValidator,
  eventInstanceAssociationStateValidator,
  redactProviderText,
  telemetryIntegrationStateValidator,
  telemetrySourceValidator,
  vrchatGroupJoinPolicyValidator,
  vrchatGroupVisibilityValidator,
} from "./_communityTelemetry";
import { subjectHasCommunityCapability, toAuthSubject } from "./_communityAuthority";
import { getPublicCommunityTelemetry } from "./_communityTelemetryPublic";

const publicMetricValidator = v.union(
  v.literal("currentPopulation"),
  v.literal("populationHistory"),
  v.literal("groupMemberCount"),
  v.literal("groupMemberGrowth"),
  v.literal("eventRecaps"),
);

const aggregateInstanceValidator = v.object({
  providerInstanceId: v.string(),
  providerLocation: v.string(),
  vrchatWorldId: v.string(),
  population: v.number(),
});

async function requireSubject(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null || typeof identity !== "object") {
    throw new Error("Community telemetry requires a signed-in user.");
  }
  return toAuthSubject(identity as { tokenIdentifier: string; issuer: string; subject: string; name?: string });
}

async function requireCommunityCapability(
  ctx: MutationCtx | QueryCtx,
  communityProfileId: Id<"profiles">,
) {
  const subject = await requireSubject(ctx);
  const allowed = await subjectHasCommunityCapability(
    ctx.db,
    communityProfileId,
    subject,
    "manage_integrations",
  );
  if (!allowed) {
    throw new Error("You do not have permission to manage this community integration.");
  }
  return subject;
}

function validateExternalId(value: string, prefix: "grp_" | "usr_", label: string) {
  const normalized = value.trim();
  if (!normalized.startsWith(prefix) || normalized.length > 80) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

async function integrationForCommunity(
  ctx: QueryCtx | MutationCtx,
  communityProfileId: Id<"profiles">,
) {
  return ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) => q.eq("communityProfileId", communityProfileId))
    .first();
}

async function chooseCollectorAccount(ctx: MutationCtx, excludedAccountId?: Id<"collectorAccounts">) {
  const now = Date.now();
  const accounts = await ctx.db
    .query("collectorAccounts")
    .withIndex("by_state_assignedGroupCount", (q) => q.eq("state", "ready"))
    .collect();
  return accounts
    .filter(
      (account) =>
        account._id !== excludedAccountId &&
        !account.killSwitchEnabled &&
        (account.cooldownUntil ?? 0) <= now &&
        account.assignedGroupCount < account.capacity - account.reservedHeadroom,
    )
    .sort(
      (left, right) =>
        left.assignedGroupCount - right.assignedGroupCount || left.accountAlias.localeCompare(right.accountAlias),
    )[0];
}

async function activeLeaseForIntegration(ctx: MutationCtx, integrationId: Id<"communityVrchatIntegrations">) {
  return ctx.db
    .query("collectorAccountLeases")
    .withIndex("by_integrationId_state", (q) => q.eq("integrationId", integrationId).eq("state", "active"))
    .first();
}

async function assertLease(
  ctx: MutationCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  workerId: string,
  fencingToken: number,
  now: number,
) {
  const lease = await activeLeaseForIntegration(ctx, integrationId);
  if (
    lease === null ||
    lease.workerId !== workerId ||
    lease.fencingToken !== fencingToken ||
    lease.expiresAt <= now
  ) {
    throw new Error("Collector lease is stale or unavailable.");
  }
  return lease;
}

async function transitionCoverage(
  ctx: MutationCtx,
  integrationId: Id<"communityVrchatIntegrations">,
  state: "observed" | "estimated" | "stale" | "unknown" | "degraded",
  at: number,
  source: "first_party" | "vrcpop" | "vrcx",
  collectorVersion: string,
  reason?: string,
  requestStatusClass?: string,
) {
  const latest = await ctx.db
    .query("collectionCoverageWindows")
    .withIndex("by_integrationId_startedAt", (q) => q.eq("integrationId", integrationId))
    .order("desc")
    .first();
  if (latest && latest.endedAt === undefined && latest.state === state && latest.reason === reason) {
    await ctx.db.patch(latest._id, { updatedAt: at, ...(requestStatusClass ? { requestStatusClass } : {}) });
    return latest._id;
  }
  if (latest && latest.endedAt === undefined) {
    await ctx.db.patch(latest._id, { endedAt: at, updatedAt: at });
  }
  return ctx.db.insert("collectionCoverageWindows", {
    integrationId,
    state,
    source,
    collectorVersion,
    startedAt: at,
    updatedAt: at,
    ...(reason ? { reason: reason.slice(0, 160) } : {}),
    ...(requestStatusClass ? { requestStatusClass } : {}),
  });
}

async function audit(
  ctx: MutationCtx,
  input: {
    communityProfileId?: Id<"profiles">;
    integrationId?: Id<"communityVrchatIntegrations">;
    collectorAccountId?: Id<"collectorAccounts">;
    actor?: ReturnType<typeof toAuthSubject>;
    workerId?: string;
    action: string;
    result: string;
    detail?: string;
    now: number;
  },
) {
  await ctx.db.insert("communityTelemetryAuditEvents", {
    action: input.action,
    result: input.result,
    createdAt: input.now,
    ...(input.communityProfileId ? { communityProfileId: input.communityProfileId } : {}),
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
    ...(input.collectorAccountId ? { collectorAccountId: input.collectorAccountId } : {}),
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.workerId ? { workerId: input.workerId.slice(0, 120) } : {}),
    ...(input.detail ? { detail: redactProviderText(input.detail) } : {}),
  });
}

async function applyCollectorAccountState(
  ctx: MutationCtx,
  account: Doc<"collectorAccounts">,
  state: Doc<"collectorAccounts">["state"],
  now: number,
  result?: string,
  cooldownUntil?: number,
) {
  await ctx.db.patch(account._id, {
    state,
    updatedAt: now,
    lastHealthAt: now,
    ...(state === "ready" ? { cooldownUntil: undefined } : cooldownUntil === undefined ? {} : { cooldownUntil }),
    ...(result === undefined ? {} : { lastHealthResult: redactProviderText(result) }),
  });
  const integrations = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_assignedCollectorAccountId_state", (query) => query.eq("assignedCollectorAccountId", account._id))
    .collect();
  for (const integration of integrations) {
    if (integration.state === "disconnected") continue;
    const integrationState = integration.state === "disconnecting"
      ? "disconnecting"
      : state === "ready" ? "connecting" : state === "auth_required" ? "auth_required" : "degraded";
    await ctx.db.patch(integration._id, {
      state: integrationState,
      nextPollAt: state === "ready" ? now : undefined,
      ...(state === "ready" ? { backoffUntil: undefined } : cooldownUntil === undefined ? {} : { backoffUntil: cooldownUntil }),
      updatedAt: now,
    });
    await transitionCoverage(
      ctx,
      integration._id,
      state === "ready" ? "unknown" : "degraded",
      now,
      "first_party",
      "account-state",
      state === "ready" ? "account_recovery_pending" : `account_${state}`,
    );
  }
  if (state !== "ready") {
    const leases = await ctx.db
      .query("collectorAccountLeases")
      .withIndex("by_collectorAccountId_state_expiresAt", (query) => query.eq("collectorAccountId", account._id).eq("state", "active"))
      .collect();
    for (const lease of leases) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
  }
}

export const registerCollectorAccount = internalMutation({
  args: {
    vrchatUserId: v.string(),
    accountAlias: v.string(),
    secretRef: v.string(),
    workerKeyHash: v.string(),
    capacity: v.optional(v.number()),
    reservedHeadroom: v.optional(v.number()),
    requestsPerMinute: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const vrchatUserId = validateExternalId(args.vrchatUserId, "usr_", "VRChat service account ID");
    const existing = await ctx.db
      .query("collectorAccounts")
      .withIndex("by_vrchatUserId", (q) => q.eq("vrchatUserId", vrchatUserId))
      .first();
    const capacity = Math.max(1, Math.floor(args.capacity ?? 100));
    const reservedHeadroom = Math.max(1, Math.floor(args.reservedHeadroom ?? 15));
    if (reservedHeadroom >= capacity) {
      throw new Error("Collector account headroom must be below capacity.");
    }
    if (!/^(arn:aws:secretsmanager:|secret:\/\/)[^\s]+$/i.test(args.secretRef.trim())) {
      throw new Error("Collector credentials must be stored behind an external secret reference.");
    }
    if (!/^[a-f0-9]{64}$/i.test(args.workerKeyHash.trim())) {
      throw new Error("Collector worker key hash must be a SHA-256 hex digest.");
    }
    if (existing && existing.assignedGroupCount > capacity - reservedHeadroom) {
      throw new Error("Collector capacity cannot be reduced below its current assignments and reserved headroom.");
    }
    const values = {
      vrchatUserId,
      accountAlias: args.accountAlias.trim().slice(0, 80),
      secretRef: args.secretRef.trim().slice(0, 500),
      workerKeyHash: args.workerKeyHash.trim().toLowerCase(),
      capacity,
      reservedHeadroom,
      requestsPerMinute: Math.max(1, Math.floor(args.requestsPerMinute ?? 30)),
      state: "ready" as const,
      killSwitchEnabled: false,
      updatedAt: now,
    };
    if (existing) {
      const credentialGeneration = existing.credentialGeneration + 1;
      const state = existing.state === "quarantined" || existing.state === "retiring" || existing.state === "retired"
        ? existing.state
        : "ready" as const;
      await ctx.db.patch(existing._id, {
        ...values,
        state,
        credentialGeneration,
      });
      await applyCollectorAccountState(ctx, { ...existing, ...values, state, credentialGeneration }, state, now, "credentials_registered");
      await audit(ctx, { collectorAccountId: existing._id, action: "account.rotate", result: "success", now });
      return existing._id;
    }
    const id = await ctx.db.insert("collectorAccounts", {
      ...values,
      assignedGroupCount: 0,
      credentialGeneration: 1,
      createdAt: now,
    });
    await audit(ctx, { collectorAccountId: id, action: "account.register", result: "success", now });
    return id;
  },
});

export const configureFleet = internalMutation({
  args: {
    killSwitchEnabled: v.boolean(),
    globalRequestsPerMinute: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const existing = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();
    const values = {
      killSwitchEnabled: args.killSwitchEnabled,
      globalRequestsPerMinute: Math.max(1, Math.floor(args.globalRequestsPerMinute)),
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("collectorFleetSettings", { key: "global", ...values });
  },
});

export const setCollectorAccountState = internalMutation({
  args: {
    collectorAccountId: v.id("collectorAccounts"),
    state: v.union(
      v.literal("provisioning"), v.literal("ready"), v.literal("degraded"), v.literal("cooldown"),
      v.literal("auth_required"), v.literal("quarantined"), v.literal("retiring"), v.literal("retired"),
    ),
    killSwitchEnabled: v.optional(v.boolean()),
    cooldownUntil: v.optional(v.number()),
    result: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const account = await ctx.db.get(args.collectorAccountId);
    if (!account) throw new Error("Collector account was not found.");
    await applyCollectorAccountState(ctx, account, args.state, now, args.result, args.cooldownUntil);
    if (args.killSwitchEnabled !== undefined) {
      await ctx.db.patch(account._id, { killSwitchEnabled: args.killSwitchEnabled, updatedAt: now });
    }
    await audit(ctx, {
      collectorAccountId: account._id,
      action: "account.state",
      result: args.state,
      detail: args.result,
      now,
    });
  },
});

export const setIntegrationKillSwitch = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration was not found.");
    if (args.enabled) {
      const lease = await activeLeaseForIntegration(ctx, integration._id);
      if (lease) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
      await transitionCoverage(ctx, integration._id, "unknown", now, "first_party", "kill-switch", args.reason ?? "integration_kill_switch");
    }
    await ctx.db.patch(integration._id, {
      killSwitchEnabled: args.enabled,
      ...(!args.enabled && integration.state !== "disconnected" ? { nextPollAt: now } : {}),
      updatedAt: now,
    });
    await audit(ctx, {
      communityProfileId: integration.communityProfileId,
      integrationId: integration._id,
      action: "integration.kill_switch",
      result: args.enabled ? "enabled" : "disabled",
      detail: args.reason,
      now,
    });
  },
});

export const reassignIntegration = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    targetCollectorAccountId: v.optional(v.id("collectorAccounts")),
    reason: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const integration = await ctx.db.get(args.integrationId);
    if (!integration || integration.state === "disconnected" || integration.state === "disconnecting") {
      throw new Error("Only a connected telemetry integration can be reassigned.");
    }
    const currentAccount = integration.assignedCollectorAccountId
      ? await ctx.db.get(integration.assignedCollectorAccountId)
      : null;
    if (!currentAccount || !["quarantined", "retiring", "retired"].includes(currentAccount.state)) {
      throw new Error("Quarantine or retire the unavailable collector account before reassignment.");
    }
    const targetAccount = args.targetCollectorAccountId
      ? await ctx.db.get(args.targetCollectorAccountId)
      : await chooseCollectorAccount(ctx, currentAccount._id);
    if (
      !targetAccount ||
      targetAccount._id === currentAccount._id ||
      targetAccount.state !== "ready" ||
      targetAccount.killSwitchEnabled ||
      (targetAccount.cooldownUntil ?? 0) > now ||
      targetAccount.assignedGroupCount >= targetAccount.capacity - targetAccount.reservedHeadroom
    ) {
      throw new Error("No healthy target collector account has reserved capacity.");
    }
    const lease = await activeLeaseForIntegration(ctx, integration._id);
    if (lease) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
    await ctx.db.patch(currentAccount._id, {
      assignedGroupCount: Math.max(0, currentAccount.assignedGroupCount - 1),
      updatedAt: now,
    });
    await ctx.db.patch(targetAccount._id, {
      assignedGroupCount: targetAccount.assignedGroupCount + 1,
      updatedAt: now,
    });
    await ctx.db.patch(integration._id, {
      assignedCollectorAccountId: targetAccount._id,
      state: "connecting",
      backoffUntil: undefined,
      consecutiveFailures: 0,
      nextPollAt: now,
      updatedAt: now,
    });
    await transitionCoverage(
      ctx,
      integration._id,
      "unknown",
      now,
      "first_party",
      "account-reassignment",
      "collector_account_reassigned",
    );
    await audit(ctx, {
      communityProfileId: integration.communityProfileId,
      integrationId: integration._id,
      collectorAccountId: targetAccount._id,
      action: "assignment.reassign",
      result: "success",
      detail: args.reason,
      now,
    });
    return targetAccount._id;
  },
});

export const connectGroup = mutation({
  args: {
    communitySlug: v.string(),
    vrchatGroupId: v.string(),
    groupVisibility: vrchatGroupVisibilityValidator,
    joinPolicy: vrchatGroupJoinPolicyValidator,
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase()))
      .first();
    if (!profile || profile.profileType !== "community") throw new Error("Community profile was not found.");
    const actor = await requireCommunityCapability(ctx, profile._id);
    const now = Date.now();
    const vrchatGroupId = validateExternalId(args.vrchatGroupId, "grp_", "VRChat group ID");
    const duplicates = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_vrchatGroupId", (q) => q.eq("vrchatGroupId", vrchatGroupId))
      .collect();
    if (duplicates.some((duplicate) => duplicate.communityProfileId !== profile._id && duplicate.state !== "disconnected")) {
      throw new Error("That VRChat group is already connected to another community.");
    }
    const existing = await integrationForCommunity(ctx, profile._id);
    if (existing && existing.state !== "disconnected") return existing._id;
    const account = await chooseCollectorAccount(ctx);
    if (!account) throw new Error("No healthy collector account currently has reserved capacity.");
    const state = args.joinPolicy === "invite" ? "awaiting_invite" : "connecting";
    const values = {
      vrchatGroupId,
      groupVisibility: args.groupVisibility,
      joinPolicy: args.joinPolicy,
      state,
      assignedCollectorAccountId: account._id,
      killSwitchEnabled: false,
      requestsPerMinute: 4,
      leaseGeneration: existing?.leaseGeneration ?? 0,
      publicMetrics: { ...DEFAULT_PUBLIC_TELEMETRY_SETTINGS },
      consecutiveFailures: 0,
      nextPollAt: now,
      updatedAt: now,
    } as const;
    let integrationId: Id<"communityVrchatIntegrations">;
    if (existing) {
      await ctx.db.patch(existing._id, { ...values, disconnectedAt: undefined });
      integrationId = existing._id;
    } else {
      integrationId = await ctx.db.insert("communityVrchatIntegrations", {
        communityProfileId: profile._id,
        ...values,
        createdAt: now,
      });
    }
    await ctx.db.patch(account._id, { assignedGroupCount: account.assignedGroupCount + 1, updatedAt: now });
    await audit(ctx, {
      communityProfileId: profile._id,
      integrationId,
      collectorAccountId: account._id,
      actor,
      action: "integration.connect",
      result: state,
      now,
    });
    return integrationId;
  },
});

export const disconnectGroup = mutation({
  args: { communitySlug: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase()))
      .first();
    if (!profile || profile.profileType !== "community") throw new Error("Community profile was not found.");
    const actor = await requireCommunityCapability(ctx, profile._id);
    const integration = await integrationForCommunity(ctx, profile._id);
    if (!integration || integration.state === "disconnected") return;
    const now = Date.now();
    const lease = await activeLeaseForIntegration(ctx, integration._id);
    if (lease) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
    await ctx.db.patch(integration._id, {
      state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected",
      killSwitchEnabled: false,
      publicMetrics: { ...DEFAULT_PUBLIC_TELEMETRY_SETTINGS },
      ...(integration.assignedCollectorAccountId ? { disconnectedAt: undefined, nextPollAt: now } : { disconnectedAt: now, nextPollAt: undefined }),
      updatedAt: now,
    });
    await transitionCoverage(ctx, integration._id, "unknown", now, "first_party", "disconnect", "disconnected");
    await audit(ctx, {
      communityProfileId: profile._id,
      integrationId: integration._id,
      actor,
      action: "integration.disconnect.requested",
      result: integration.assignedCollectorAccountId ? "cleanup_pending" : "success",
      now,
    });
  },
});

export const setPublicMetric = mutation({
  args: { communitySlug: v.string(), metric: publicMetricValidator, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase()))
      .first();
    if (!profile || profile.profileType !== "community") throw new Error("Community profile was not found.");
    const actor = await requireCommunityCapability(ctx, profile._id);
    const integration = await integrationForCommunity(ctx, profile._id);
    if (!integration) throw new Error("Community telemetry is not connected.");
    const now = Date.now();
    await ctx.db.patch(integration._id, {
      publicMetrics: { ...integration.publicMetrics, [args.metric]: args.enabled },
      updatedAt: now,
    });
    await audit(ctx, {
      communityProfileId: profile._id,
      integrationId: integration._id,
      actor,
      action: "visibility.change",
      result: `${args.metric}:${args.enabled ? "public" : "private"}`,
      now,
    });
  },
});

export const recordMembershipResult = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    state: telemetryIntegrationStateValidator,
    groupVisibility: vrchatGroupVisibilityValidator,
    joinPolicy: vrchatGroupJoinPolicyValidator,
    detail: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, now);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration was not found.");
    if (args.state === "disconnected") {
      if (integration.assignedCollectorAccountId) {
        const account = await ctx.db.get(integration.assignedCollectorAccountId);
        if (account) await ctx.db.patch(account._id, {
          assignedGroupCount: Math.max(0, account.assignedGroupCount - 1),
          updatedAt: now,
        });
      }
      const lease = await activeLeaseForIntegration(ctx, integration._id);
      if (lease) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
      await ctx.db.patch(integration._id, {
        state: "disconnected",
        assignedCollectorAccountId: undefined,
        killSwitchEnabled: true,
        publicMetrics: { ...DEFAULT_PUBLIC_TELEMETRY_SETTINGS },
        disconnectedAt: now,
        nextPollAt: undefined,
        updatedAt: now,
      });
      await audit(ctx, {
        communityProfileId: integration.communityProfileId,
        integrationId: integration._id,
        workerId: args.workerId,
        action: "integration.disconnect.completed",
        result: "success",
        detail: args.detail,
        now,
      });
      return;
    }
    await ctx.db.patch(integration._id, {
      state: args.state,
      groupVisibility: args.groupVisibility,
      joinPolicy: args.joinPolicy,
      updatedAt: now,
    });
    await audit(ctx, {
      communityProfileId: integration.communityProfileId,
      integrationId: integration._id,
      workerId: args.workerId,
      action: "membership.result",
      result: args.state,
      detail: args.detail,
      now,
    });
  },
});

export const claimDueAssignments = internalMutation({
  args: {
    collectorAccountId: v.id("collectorAccounts"),
    workerId: v.string(),
    limit: v.optional(v.number()),
    leaseMs: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const account = await ctx.db.get(args.collectorAccountId);
    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();
    if (!account || account.state !== "ready" || account.killSwitchEnabled || fleet?.killSwitchEnabled || (account.cooldownUntil ?? 0) > now) return [];
    const candidates = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_assignedCollectorAccountId_state", (q) =>
        q.eq("assignedCollectorAccountId", account._id).eq("state", "active"),
      )
      .collect();
    const transitional = (
      await Promise.all(
        (["connecting", "awaiting_approval", "awaiting_invite", "degraded", "disconnecting"] as const).map((state) =>
          ctx.db
            .query("communityVrchatIntegrations")
            .withIndex("by_assignedCollectorAccountId_state", (q) =>
              q.eq("assignedCollectorAccountId", account._id).eq("state", state),
            )
            .collect(),
        ),
      )
    ).flat();
    const due = [...candidates, ...transitional]
      .filter(
        (integration) =>
          !integration.killSwitchEnabled &&
          (integration.nextPollAt ?? 0) <= now &&
          (integration.backoffUntil ?? 0) <= now,
      )
      .sort((left, right) => (left.nextPollAt ?? 0) - (right.nextPollAt ?? 0))
      .slice(0, Math.max(1, Math.min(args.limit ?? 10, 50)));
    const claimed = [];
    for (const integration of due) {
      const existing = await activeLeaseForIntegration(ctx, integration._id);
      if (existing && existing.expiresAt > now && existing.workerId !== args.workerId) continue;
      const fencingToken = integration.leaseGeneration + 1;
      await ctx.db.patch(integration._id, { leaseGeneration: fencingToken, updatedAt: now });
      if (existing) {
        await ctx.db.patch(existing._id, {
          workerId: args.workerId,
          fencingToken,
          expiresAt: now + Math.max(30_000, args.leaseMs ?? 5 * 60_000),
          claimedAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("collectorAccountLeases", {
          integrationId: integration._id,
          collectorAccountId: account._id,
          workerId: args.workerId,
          fencingToken,
          state: "active",
          claimedAt: now,
          expiresAt: now + Math.max(30_000, args.leaseMs ?? 5 * 60_000),
          updatedAt: now,
        });
      }
      claimed.push({
        integrationId: integration._id,
        vrchatGroupId: integration.vrchatGroupId,
        joinPolicy: integration.joinPolicy,
        groupVisibility: integration.groupVisibility,
        state: integration.state,
        fencingToken,
        requestsPerMinute: Math.min(
          integration.requestsPerMinute,
          account.requestsPerMinute,
          fleet?.globalRequestsPerMinute ?? Number.POSITIVE_INFINITY,
        ),
      });
    }
    return claimed;
  },
});

export const reserveRequestBudget = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    requestCount: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const requestCount = Math.floor(args.requestCount);
    if (!Number.isFinite(args.requestCount) || requestCount < 1 || requestCount > 10) {
      throw new Error("Provider request reservation is malformed.");
    }
    await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, now);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration?.assignedCollectorAccountId) throw new Error("Telemetry integration is unavailable.");
    const account = await ctx.db.get(integration.assignedCollectorAccountId);
    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();
    if (
      !account || account.state !== "ready" || account.killSwitchEnabled || integration.killSwitchEnabled ||
      fleet?.killSwitchEnabled || (account.cooldownUntil ?? 0) > now
    ) {
      return { granted: false, retryAt: now + 60_000, reason: "unavailable" as const };
    }

    const windowStartedAt = Math.floor(now / 60_000) * 60_000;
    const retryAt = windowStartedAt + 60_000;
    const scopes = [
      { scopeKey: "global", limit: fleet?.globalRequestsPerMinute ?? 30 },
      { scopeKey: `account:${account._id}`, limit: account.requestsPerMinute },
      { scopeKey: `integration:${integration._id}`, limit: integration.requestsPerMinute },
    ];
    const counters = await Promise.all(scopes.map(async (scope) => ({
      ...scope,
      counter: await ctx.db
        .query("collectorRequestBudgetCounters")
        .withIndex("by_scopeKey", (q) => q.eq("scopeKey", scope.scopeKey))
        .first(),
    })));
    const exhausted = counters.find(({ counter, limit }) =>
      (counter?.windowStartedAt === windowStartedAt ? counter.requestCount : 0) + requestCount > limit,
    );
    if (exhausted) {
      await ctx.db.patch(integration._id, { nextPollAt: retryAt, updatedAt: now });
      return { granted: false, retryAt, reason: "budget_exhausted" as const };
    }
    for (const { scopeKey, counter } of counters) {
      const nextCount = (counter?.windowStartedAt === windowStartedAt ? counter.requestCount : 0) + requestCount;
      if (counter) await ctx.db.patch(counter._id, { windowStartedAt, requestCount: nextCount, updatedAt: now });
      else await ctx.db.insert("collectorRequestBudgetCounters", { scopeKey, windowStartedAt, requestCount: nextCount, updatedAt: now });
    }
    return { granted: true, retryAt: undefined, reason: undefined };
  },
});

export const deferAssignment = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    nextPollAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, now);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Telemetry integration is unavailable.");
    await ctx.db.patch(integration._id, {
      nextPollAt: Math.max(now + 1_000, Math.min(args.nextPollAt, now + 5 * 60_000)),
      updatedAt: now,
    });
  },
});

export const releaseLease = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const lease = await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, now);
    await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
  },
});

export const ingestAggregatePoll = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    pollId: v.string(),
    observedAt: v.number(),
    collectorVersion: v.string(),
    source: telemetrySourceValidator,
    groupMemberCount: v.number(),
    instances: v.array(aggregateInstanceValidator),
    nextPollAt: v.number(),
  },
  handler: async (ctx, args) => {
    await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, args.observedAt);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration was not found.");
    if (!Number.isSafeInteger(args.groupMemberCount) || args.groupMemberCount < 0 || args.instances.length > 200) {
      throw new Error("Aggregate poll counts are malformed.");
    }
    const providerInstanceIds = new Set<string>();
    for (const item of args.instances) {
      if (
        !Number.isSafeInteger(item.population) || item.population < 0 ||
        item.providerInstanceId.length < 1 || item.providerInstanceId.length > 500 || /[\u0000-\u001f\u007f]/.test(item.providerInstanceId) ||
        item.providerLocation.length < 1 || item.providerLocation.length > 500 ||
        !item.vrchatWorldId.startsWith("wrld_") || item.vrchatWorldId.length > 100 ||
        item.providerLocation !== `${item.vrchatWorldId}:${item.providerInstanceId}` ||
        /usr_[A-Za-z0-9-]+/i.test(item.providerInstanceId) || /usr_[A-Za-z0-9-]+/i.test(item.providerLocation) ||
        [...item.providerLocation.matchAll(/group\((grp_[A-Za-z0-9-]+)\)/g)].some((match) => match[1] !== integration.vrchatGroupId) ||
        providerInstanceIds.has(item.providerInstanceId)
      ) throw new Error("Aggregate instance data is malformed.");
      providerInstanceIds.add(item.providerInstanceId);
    }
    const duplicatePoll = await ctx.db
      .query("communityPopulationObservations")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.pollId))
      .first();
    if (duplicatePoll) return { duplicate: true };
    const coverageWindowId = await transitionCoverage(
      ctx,
      integration._id,
      "observed",
      args.observedAt,
      args.source,
      args.collectorVersion,
    );
    const worlds = new Map<string, { population: number; instanceCount: number }>();
    for (const item of args.instances) {
      const current = worlds.get(item.vrchatWorldId) ?? { population: 0, instanceCount: 0 };
      current.population += Math.max(0, Math.floor(item.population));
      current.instanceCount += 1;
      worlds.set(item.vrchatWorldId, current);
    }
    await ctx.db.insert("communityPopulationObservations", {
      integrationId: integration._id,
      idempotencyKey: args.pollId,
      totalPopulation: args.instances.reduce((total, item) => total + Math.max(0, Math.floor(item.population)), 0),
      activeInstanceCount: args.instances.length,
      worldDistribution: [...worlds.entries()].map(([vrchatWorldId, value]) => ({ vrchatWorldId, ...value })),
      observedAt: args.observedAt,
      source: args.source,
      collectorVersion: args.collectorVersion,
      coverageState: "observed",
      coverageWindowId,
      fencingToken: args.fencingToken,
    });
    const memberPrevious = await ctx.db
      .query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id))
      .order("desc")
      .first();
    if (!memberPrevious || memberPrevious.memberCount !== args.groupMemberCount || args.observedAt - memberPrevious.observedAt >= 6 * 60 * 60_000) {
      await ctx.db.insert("communityMemberCountObservations", {
        integrationId: integration._id,
        communityProfileId: integration.communityProfileId,
        idempotencyKey: `${args.pollId}:members`,
        vrchatGroupId: integration.vrchatGroupId,
        memberCount: Math.max(0, Math.floor(args.groupMemberCount)),
        observedAt: args.observedAt,
        source: args.source,
        collectorVersion: args.collectorVersion,
        coverageState: "observed",
        coverageWindowId,
        fencingToken: args.fencingToken,
      });
    }
    const seen = new Set<string>();
    for (const item of args.instances) {
      seen.add(item.providerInstanceId);
      let session = await ctx.db
        .query("instanceSessions")
        .withIndex("by_integrationId_providerInstanceId_state", (q) =>
          q.eq("integrationId", integration._id).eq("providerInstanceId", item.providerInstanceId).eq("state", "open"),
        )
        .first();
      if (!session) {
        const world = await ctx.db
          .query("worlds")
          .withIndex("by_vrchatWorldId", (q) => q.eq("vrchatWorldId", item.vrchatWorldId))
          .first();
        const sessionId = await ctx.db.insert("instanceSessions", {
          integrationId: integration._id,
          communityProfileId: integration.communityProfileId,
          providerInstanceId: item.providerInstanceId,
          providerLocation: item.providerLocation.slice(0, 500),
          vrchatWorldId: item.vrchatWorldId.slice(0, 100),
          ...(world ? { worldId: world._id } : {}),
          source: args.source,
          state: "open",
          openedAt: args.observedAt,
          lastObservedAt: args.observedAt,
          consecutiveMisses: 0,
          updatedAt: args.observedAt,
        });
        session = await ctx.db.get(sessionId);
      } else {
        await ctx.db.patch(session._id, {
          providerLocation: item.providerLocation.slice(0, 500),
          lastObservedAt: args.observedAt,
          consecutiveMisses: 0,
          updatedAt: args.observedAt,
        });
      }
      if (!session) continue;
      await ctx.db.insert("instancePopulationObservations", {
        integrationId: integration._id,
        sessionId: session._id,
        idempotencyKey: `${args.pollId}:${item.providerInstanceId}`,
        providerInstanceId: item.providerInstanceId,
        vrchatWorldId: item.vrchatWorldId,
        population: item.population,
        observedAt: args.observedAt,
        source: args.source,
        collectorVersion: args.collectorVersion,
        coverageState: "observed",
        coverageWindowId,
        fencingToken: args.fencingToken,
      });
    }
    const openSessions = await ctx.db
      .query("instanceSessions")
      .withIndex("by_integrationId_state", (q) => q.eq("integrationId", integration._id).eq("state", "open"))
      .collect();
    for (const session of openSessions) {
      if (seen.has(session.providerInstanceId)) continue;
      const misses = session.consecutiveMisses + 1;
      await ctx.db.patch(session._id, {
        consecutiveMisses: misses,
        ...(misses >= INSTANCE_CLOSE_MISSES ? { state: "closed" as const, closedAt: args.observedAt } : {}),
        updatedAt: args.observedAt,
      });
    }
    await ctx.db.patch(integration._id, {
      state: "active",
      lastSuccessfulObservationAt: args.observedAt,
      lastAttemptAt: args.observedAt,
      nextPollAt: args.nextPollAt,
      consecutiveFailures: 0,
      backoffUntil: undefined,
      updatedAt: args.observedAt,
    });
    return { duplicate: false };
  },
});

export const recordPollFailure = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    workerId: v.string(),
    fencingToken: v.number(),
    statusClass: v.string(),
    coverageState: coverageStateValidator,
    nextPollAt: v.number(),
    backoffUntil: v.optional(v.number()),
    detail: v.optional(v.string()),
    collectorVersion: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await assertLease(ctx, args.integrationId, args.workerId, args.fencingToken, now);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration was not found.");
    const failures = integration.consecutiveFailures + 1;
    const state = integration.state === "disconnecting"
      ? "disconnecting"
      : args.statusClass === "401" ? "auth_required" : failures >= 3 ? "degraded" : integration.state;
    await ctx.db.patch(integration._id, {
      state,
      lastAttemptAt: now,
      nextPollAt: args.nextPollAt,
      consecutiveFailures: failures,
      ...(args.backoffUntil ? { backoffUntil: args.backoffUntil } : {}),
      updatedAt: now,
    });
    await transitionCoverage(
      ctx,
      integration._id,
      args.coverageState,
      now,
      "first_party",
      args.collectorVersion,
      args.detail ? redactProviderText(args.detail) : `provider_${args.statusClass}`,
      args.statusClass,
    );
    if (args.statusClass === "401" && integration.assignedCollectorAccountId) {
      const account = await ctx.db.get(integration.assignedCollectorAccountId);
      if (account) await applyCollectorAccountState(ctx, account, "auth_required", now, "provider_401");
    }
  },
});

async function telemetryDashboardData(ctx: QueryCtx, profile: Doc<"profiles">, now: number) {
  const integration = await integrationForCommunity(ctx, profile._id);
  if (!integration) return null;
  const [account, sessions, population, instancePopulation, memberCounts, coverage, rollups, associations, events] = await Promise.all([
    integration.assignedCollectorAccountId ? ctx.db.get(integration.assignedCollectorAccountId) : null,
    ctx.db.query("instanceSessions").withIndex("by_communityProfileId_openedAt", (q) => q.eq("communityProfileId", profile._id)).order("desc").take(100),
    ctx.db.query("communityPopulationObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id)).order("desc").take(2500),
    ctx.db.query("instancePopulationObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id)).order("desc").take(2500),
    ctx.db.query("communityMemberCountObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id)).order("desc").take(500),
    ctx.db.query("collectionCoverageWindows").withIndex("by_integrationId_startedAt", (q) => q.eq("integrationId", integration._id)).order("desc").take(200),
    ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", profile._id)).order("desc").take(400),
    ctx.db.query("eventInstanceAssociations").withIndex("by_communityProfileId_state", (q) => q.eq("communityProfileId", profile._id)).take(200),
    ctx.db.query("events").withIndex("by_communityProfileId_startAt", (q) => q.eq("communityProfileId", profile._id)).order("desc").take(100),
  ]);
  const points = population.map((point) => ({
    observedAt: point.observedAt,
    population: point.totalPopulation,
    coverageState: point.coverageState,
    instanceKey: "aggregate",
    worldId: "aggregate",
  }));
  const rangeStart = Math.min(...points.map((point) => point.observedAt), now);
  const metrics = computePopulationMetrics(points, rangeStart, now);
  const openSessions = sessions.filter((session) => session.state === "open");
  return {
    community: { slug: profile.slug, displayName: profile.displayName },
    integration: {
      state: integration.state,
      groupVisibility: integration.groupVisibility,
      joinPolicy: integration.joinPolicy,
      vrchatGroupId: integration.vrchatGroupId,
      lastSuccessfulObservationAt: integration.lastSuccessfulObservationAt,
      freshness: integration.lastSuccessfulObservationAt && now - integration.lastSuccessfulObservationAt <= CURRENT_FRESHNESS_MS ? "current" as const : "stale" as const,
      publicMetrics: integration.publicMetrics,
      collector: account ? { accountAlias: account.accountAlias, vrchatUserId: account.vrchatUserId, state: account.state } : null,
    },
    summary: {
      currentPopulation: integration.lastSuccessfulObservationAt && now - integration.lastSuccessfulObservationAt <= CURRENT_FRESHNESS_MS ? metrics.currentPopulation : undefined,
      activeInstanceCount: population[0]?.activeInstanceCount ?? openSessions.length,
      peakConcurrency: metrics.peakConcurrency,
      playerHours: metrics.playerHours,
      coverageRatio: metrics.coverageRatio,
      groupMemberCount: memberCounts[0]?.memberCount,
      groupMemberGrowth: memberCounts.length > 1 ? memberCounts[0]!.memberCount - memberCounts[memberCounts.length - 1]!.memberCount : 0,
      worlds: (population[0]?.worldDistribution ?? []).map((world) => ({
        worldId: world.vrchatWorldId,
        samples: world.instanceCount,
        population: world.population,
      })),
    },
    sessions,
    population: population.reverse(),
    instancePopulation: instancePopulation.reverse(),
    memberCounts: memberCounts.reverse(),
    coverage: coverage.reverse(),
    rollups: rollups.reverse(),
    associations,
    events: events.map((event) => ({
      _id: event._id,
      slug: event.slug,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
    })),
  };
}

export const getPrivateDashboard = query({
  args: { communitySlug: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase()))
      .first();
    if (!profile || profile.profileType !== "community") return null;
    await requireCommunityCapability(ctx, profile._id);
    return telemetryDashboardData(ctx, profile, args.now ?? Date.now());
  },
});

export const getPublicForCommunity = query({
  args: { communitySlug: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase()))
      .first();
    if (!profile || profile.profileType !== "community" || profile.publicationState !== "published") return null;
    return getPublicCommunityTelemetry(ctx.db, profile._id, args.now ?? Date.now());
  },
});

export const recomputeRollup = internalMutation({
  args: {
    communityProfileId: v.id("profiles"),
    eventId: v.optional(v.id("events")),
    grain: v.union(v.literal("hour"), v.literal("day"), v.literal("event")),
    bucketStartAt: v.number(),
    bucketEndAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.bucketEndAt <= args.bucketStartAt) throw new Error("Rollup window is invalid.");
    const integration = await integrationForCommunity(ctx, args.communityProfileId);
    if (!integration) throw new Error("Community telemetry is not connected.");
    const population = await ctx.db
      .query("communityPopulationObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q.eq("integrationId", integration._id).gte("observedAt", args.bucketStartAt).lt("observedAt", args.bucketEndAt),
      )
      .collect();
    const memberCounts = await ctx.db
      .query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q.eq("integrationId", integration._id).gte("observedAt", args.bucketStartAt).lt("observedAt", args.bucketEndAt),
      )
      .collect();
    let eventSessionIds: Set<string> | undefined;
    if (args.eventId) {
      const confirmed = await ctx.db
        .query("eventInstanceAssociations")
        .withIndex("by_eventId_state", (q) => q.eq("eventId", args.eventId!).eq("state", "confirmed"))
        .collect();
      eventSessionIds = new Set(confirmed.map((association) => association.sessionId as string));
    }
    const sessionPopulation = args.eventId
      ? await ctx.db.query("instancePopulationObservations").withIndex("by_integrationId_observedAt", (q) =>
          q.eq("integrationId", integration._id).gte("observedAt", args.bucketStartAt).lt("observedAt", args.bucketEndAt),
        ).collect()
      : [];
    const scopedPopulation = eventSessionIds
      ? sessionPopulation.filter((point) => eventSessionIds!.has(point.sessionId as string)).map((point) => ({
          observedAt: point.observedAt,
          totalPopulation: point.population,
          coverageState: point.coverageState,
          worldDistribution: [{ vrchatWorldId: point.vrchatWorldId, population: point.population, instanceCount: 1 }],
        }))
      : population;
    const points = scopedPopulation.map((point) => ({
      observedAt: point.observedAt,
      population: point.totalPopulation,
      coverageState: point.coverageState,
      instanceKey: "aggregate",
      worldId: "aggregate",
    }));
    const metrics = computePopulationMetrics(points, args.bucketStartAt, args.bucketEndAt);
    const worldDistribution = new Map<string, number>();
    for (const point of scopedPopulation) {
      for (const world of point.worldDistribution) {
        worldDistribution.set(world.vrchatWorldId, (worldDistribution.get(world.vrchatWorldId) ?? 0) + world.instanceCount);
      }
    }
    const activeInstanceCount = eventSessionIds
      ? Math.max(0, ...[...sessionPopulation
        .filter((point) => eventSessionIds!.has(point.sessionId as string))
        .reduce<Map<number, Set<string>>>((byTime, point) => {
          const sessionsAtTime = byTime.get(point.observedAt) ?? new Set<string>();
          sessionsAtTime.add(point.sessionId as string);
          byTime.set(point.observedAt, sessionsAtTime);
          return byTime;
        }, new Map())
        .values()]
        .map((sessionsAtTime) => sessionsAtTime.size))
      : Math.max(0, ...population.map((point) => point.activeInstanceCount));
    const sortedMembers = memberCounts.sort((left, right) => left.observedAt - right.observedAt);
    const values = {
      communityProfileId: args.communityProfileId,
      ...(args.eventId ? { eventId: args.eventId } : {}),
      grain: args.grain,
      bucketStartAt: args.bucketStartAt,
      bucketEndAt: args.bucketEndAt,
      rollupVersion: TELEMETRY_ROLLUP_VERSION,
      ...(metrics.currentPopulation === undefined ? {} : { currentPopulation: metrics.currentPopulation }),
      activeInstanceCount,
      peakConcurrency: metrics.peakConcurrency,
      playerMinutes: metrics.playerMinutes,
      coverageRatio: metrics.coverageRatio,
      ...(sortedMembers.length > 0 ? { groupMemberCount: sortedMembers[sortedMembers.length - 1]!.memberCount } : {}),
      ...(sortedMembers.length > 1 ? { groupMemberGrowth: sortedMembers[sortedMembers.length - 1]!.memberCount - sortedMembers[0]!.memberCount } : {}),
      worldDistribution: [...worldDistribution.entries()]
        .map(([vrchatWorldId, samples]) => ({ vrchatWorldId, samples }))
        .sort((left, right) => right.samples - left.samples || left.vrchatWorldId.localeCompare(right.vrchatWorldId)),
      computedAt: args.now ?? Date.now(),
    };
    const existing = args.eventId
      ? await ctx.db.query("communityTelemetryRollups").withIndex("by_eventId_rollupVersion", (q) => q.eq("eventId", args.eventId!).eq("rollupVersion", TELEMETRY_ROLLUP_VERSION)).first()
      : await ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", args.communityProfileId).eq("grain", args.grain).eq("bucketStartAt", args.bucketStartAt)).first();
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return ctx.db.insert("communityTelemetryRollups", values);
  },
});

export const associateEventInstance = mutation({
  args: {
    communitySlug: v.string(),
    eventId: v.id("events"),
    sessionId: v.id("instanceSessions"),
  },
  handler: async (ctx, args) => {
    const [profile, event, session] = await Promise.all([
      ctx.db.query("profiles").withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase())).first(),
      ctx.db.get(args.eventId),
      ctx.db.get(args.sessionId),
    ]);
    if (!profile || profile.profileType !== "community" || !event || !session) throw new Error("Event or instance was not found.");
    if (event.communityProfileId !== profile._id || session.communityProfileId !== profile._id) throw new Error("Event and instance must belong to this community.");
    const actor = await requireCommunityCapability(ctx, profile._id);
    const now = Date.now();
    const existing = await ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "confirmed")).first();
    if (existing && existing.eventId !== event._id) throw new Error("Instance is already confirmed for another event.");
    if (existing) return existing._id;
    const associationId = await ctx.db.insert("eventInstanceAssociations", {
      eventId: event._id,
      sessionId: session._id,
      communityProfileId: profile._id,
      source: "manual",
      confidence: 1,
      state: "confirmed",
      actor,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
      communityProfileId: profile._id,
      eventId: event._id,
      grain: "event",
      bucketStartAt: event.startAt,
      bucketEndAt: event.endAt ?? event.startAt + 6 * 60 * 60_000,
      now,
    });
    return associationId;
  },
});

export const reviewAssociationSuggestion = mutation({
  args: {
    communitySlug: v.string(),
    associationId: v.id("eventInstanceAssociations"),
    state: eventInstanceAssociationStateValidator,
  },
  handler: async (ctx, args) => {
    if (args.state === "suggested") throw new Error("A review must confirm or reject the suggestion.");
    const profile = await ctx.db.query("profiles").withIndex("by_slug", (q) => q.eq("slug", args.communitySlug.trim().toLowerCase())).first();
    const association = await ctx.db.get(args.associationId);
    if (!profile || profile.profileType !== "community" || !association || association.communityProfileId !== profile._id) throw new Error("Association was not found.");
    const actor = await requireCommunityCapability(ctx, profile._id);
    const now = Date.now();
    if (args.state === "confirmed") {
      const existing = await ctx.db.query("eventInstanceAssociations")
        .withIndex("by_sessionId_state", (query) => query.eq("sessionId", association.sessionId).eq("state", "confirmed"))
        .first();
      if (existing && existing.eventId !== association.eventId) throw new Error("Instance is already confirmed for another event.");
    }
    await ctx.db.patch(association._id, { state: args.state, actor, reviewedAt: now, updatedAt: now });
    if (args.state === "confirmed") {
      const event = await ctx.db.get(association.eventId);
      if (event) await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
        communityProfileId: profile._id,
        eventId: event._id,
        grain: "event",
        bucketStartAt: event.startAt,
        bucketEndAt: event.endAt ?? event.startAt + 6 * 60 * 60_000,
        now,
      });
    }
  },
});

export const scheduleTelemetryRollups = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const hourEnd = Math.floor(now / (60 * 60_000)) * 60 * 60_000;
    const hourStart = hourEnd - 60 * 60_000;
    const dayEnd = Math.floor(now / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const dayStart = dayEnd - 24 * 60 * 60_000;
    const integrations = await ctx.db.query("communityVrchatIntegrations").take(200);
    let scheduled = 0;
    for (const integration of integrations) {
      if (integration.state === "disconnected") continue;
      for (const window of [
        { grain: "hour" as const, bucketStartAt: hourStart, bucketEndAt: hourEnd },
        { grain: "day" as const, bucketStartAt: dayStart, bucketEndAt: dayEnd },
      ]) {
        await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
          communityProfileId: integration.communityProfileId,
          ...window,
          now,
        });
        scheduled += 1;
      }
      const confirmed = await ctx.db.query("eventInstanceAssociations")
        .withIndex("by_communityProfileId_state", (query) => query.eq("communityProfileId", integration.communityProfileId).eq("state", "confirmed"))
        .take(200);
      for (const eventId of new Set(confirmed.map((association) => association.eventId))) {
        const event = await ctx.db.get(eventId);
        if (!event || event.startAt > now || event.startAt < now - 14 * 24 * 60 * 60_000) continue;
        await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
          communityProfileId: integration.communityProfileId,
          eventId: event._id,
          grain: "event",
          bucketStartAt: event.startAt,
          bucketEndAt: event.endAt ?? event.startAt + 6 * 60 * 60_000,
          now,
        });
        scheduled += 1;
      }
    }
    return { integrations: integrations.length, scheduled };
  },
});

export const compactRawTelemetry = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    rawBeforeAt: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) return { aggregateDeleted: 0, instanceDeleted: 0 };
    const limit = Math.max(1, Math.min(args.limit ?? 500, 1000));
    const hourlyRollups = await ctx.db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query.eq("communityProfileId", integration.communityProfileId).eq("grain", "hour").lt("bucketStartAt", args.rawBeforeAt),
      )
      .collect();
    const rolledHours = new Set(hourlyRollups.map((rollup) => rollup.bucketStartAt));
    const aggregate = await ctx.db.query("communityPopulationObservations")
      .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id).lt("observedAt", args.rawBeforeAt))
      .take(limit);
    let aggregateDeleted = 0;
    for (const point of aggregate) {
      const hour = Math.floor(point.observedAt / (60 * 60_000)) * 60 * 60_000;
      if (!rolledHours.has(hour)) continue;
      await ctx.db.delete(point._id);
      aggregateDeleted += 1;
    }
    const confirmed = await ctx.db.query("eventInstanceAssociations")
      .withIndex("by_communityProfileId_state", (query) => query.eq("communityProfileId", integration.communityProfileId).eq("state", "confirmed"))
      .collect();
    const eventRollups = await ctx.db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) => query.eq("communityProfileId", integration.communityProfileId).eq("grain", "event"))
      .collect();
    const rolledEvents = new Set(eventRollups.flatMap((rollup) => rollup.eventId ? [rollup.eventId as string] : []));
    const protectedSessions = new Set(confirmed.filter((association) => !rolledEvents.has(association.eventId as string)).map((association) => association.sessionId as string));
    const instancePoints = await ctx.db.query("instancePopulationObservations")
      .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id).lt("observedAt", args.rawBeforeAt))
      .take(limit);
    let instanceDeleted = 0;
    for (const point of instancePoints) {
      const hour = Math.floor(point.observedAt / (60 * 60_000)) * 60 * 60_000;
      if (!rolledHours.has(hour) || protectedSessions.has(point.sessionId as string)) continue;
      await ctx.db.delete(point._id);
      instanceDeleted += 1;
    }
    return { aggregateDeleted, instanceDeleted };
  },
});

export const scheduleTelemetryCompaction = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const integrations = await ctx.db.query("communityVrchatIntegrations").take(200);
    for (const integration of integrations) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.compactRawTelemetry, {
        integrationId: integration._id,
        rawBeforeAt: now - 90 * 24 * 60 * 60_000,
        limit: 500,
      });
    }
    return { scheduled: integrations.length };
  },
});

export const suggestEventAssociations = internalMutation({
  args: { eventId: v.id("events"), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event?.communityProfileId) return [];
    const eventWorlds = await ctx.db.query("eventWorlds").withIndex("by_eventId", (q) => q.eq("eventId", event._id)).collect();
    const worldIds = new Set(eventWorlds.filter((link) => link.confirmationState === "confirmed").map((link) => link.worldId as string));
    const sessions = await ctx.db.query("instanceSessions").withIndex("by_communityProfileId_openedAt", (q) => q.eq("communityProfileId", event.communityProfileId!)).collect();
    const now = args.now ?? Date.now();
    const created: Id<"eventInstanceAssociations">[] = [];
    for (const session of sessions) {
      const timeOverlap = session.openedAt <= (event.endAt ?? event.startAt + 6 * 60 * 60_000) && (session.closedAt ?? now) >= event.startAt;
      const worldMatch = session.worldId ? worldIds.has(session.worldId as string) : false;
      if (!timeOverlap || !worldMatch) continue;
      const [existingSuggestion, confirmed] = await Promise.all([
        ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "suggested")).first(),
        ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "confirmed")).first(),
      ]);
      if (existingSuggestion || confirmed) continue;
      created.push(await ctx.db.insert("eventInstanceAssociations", {
        eventId: event._id,
        sessionId: session._id,
        communityProfileId: event.communityProfileId,
        source: "time_world_overlap",
        confidence: 0.75,
        state: "suggested",
        createdAt: now,
        updatedAt: now,
      }));
    }
    return created;
  },
});

export const fleetHealth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [settings, accounts, integrations, leases] = await Promise.all([
      ctx.db.query("collectorFleetSettings").collect(),
      ctx.db.query("collectorAccounts").collect(),
      ctx.db.query("communityVrchatIntegrations").collect(),
      ctx.db.query("collectorAccountLeases").collect(),
    ]);
    return {
      settings,
      accounts: accounts.map(({ secretRef: _secretRef, workerKeyHash: _workerKeyHash, ...account }) => account),
      integrationCounts: integrations.reduce<Record<string, number>>((counts, integration) => {
        counts[integration.state] = (counts[integration.state] ?? 0) + 1;
        return counts;
      }, {}),
      activeLeaseCount: leases.filter((lease) => lease.state === "active").length,
    };
  },
});

export const collectorWorkerAuthorization = internalQuery({
  args: { collectorAccountId: v.id("collectorAccounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.collectorAccountId);
    if (!account) return null;
    return {
      workerKeyHash: account.workerKeyHash,
      enabled: account.state === "ready" && !account.killSwitchEnabled,
    };
  },
});
