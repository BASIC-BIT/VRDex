import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  analyticsContextFromAttempt,
  claimAnalyticsMethodForAttempt,
  enqueueAttemptResolution,
  enqueueClaimAnalyticsEvent,
  timeToFirstCheckBucket,
} from "./_claimAnalytics";
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
import {
  collectorRuntimeCapabilityValidator,
  recordProfileClaimLifecycleEvent,
  type CollectorRuntimeCapability,
  type ProofCheckOutcome,
} from "./_claimObservability";
import { subjectHasCommunityCapability, toAuthSubject } from "./_communityAuthority";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getPublicCommunityTelemetry } from "./_communityTelemetryPublic";
import { canReadProfile } from "./_profilePermissions";
import { userOwnsProfile } from "./_profileOwnership";

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

const WORKER_HEARTBEAT_FRESHNESS_MS = 2 * 60_000;
const PROOF_POLL_HEARTBEAT_WRITE_MS = 30_000;
const OPERATIONAL_HEALTH_ATTEMPT_LIMIT = 1_000;
const FIRST_CHECK_HEALTH_LOOKBACK_MS = 15 * 60_000;
const COLLECTOR_RELEASE_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function boundedWorkerId(value: string) {
  const workerId = value.trim();
  if (workerId.length === 0 || workerId.length > 120) {
    throw new Error("Collector worker id is invalid.");
  }
  return workerId;
}

function normalizedReleaseSha(value: string) {
  const releaseSha = value.trim().toLowerCase();
  if (!COLLECTOR_RELEASE_SHA_PATTERN.test(releaseSha)) {
    throw new Error("Collector release SHA is invalid.");
  }
  return releaseSha;
}

function normalizedOptionalReleaseSha(value: string | undefined) {
  return value === undefined ? undefined : normalizedReleaseSha(value);
}

function boundedWorkerVersion(value: string) {
  const version = value.trim();
  if (version.length === 0 || version.length > 80) {
    throw new Error("Collector version is invalid.");
  }
  return version;
}

async function recordProviderCheck(
  ctx: MutationCtx,
  input: {
    attempt: Doc<"profileVerificationAttempts">;
    accountId: Id<"collectorAccounts">;
    outcome: ProofCheckOutcome;
    now: number;
    workerReleaseSha?: string;
  },
) {
  if (input.attempt.lastCheckedByCollectorAccountId !== input.accountId) return false;

  await ctx.db.patch(input.attempt._id, {
    firstCheckAt: input.attempt.firstCheckAt ?? input.now,
    lastCheckAt: input.now,
    checkCount: (input.attempt.checkCount ?? 0) + 1,
    lastCheckOutcome: input.outcome,
    updatedAt: input.now,
  });
  await recordProfileClaimLifecycleEvent(ctx, {
    profileId: input.attempt.profileId,
    attemptId: input.attempt._id,
    method: input.attempt.method,
    targetType: input.attempt.targetType,
    event: "provider_checked",
    actorSurface: "collector",
    outcome: input.outcome,
    workerReleaseSha: input.workerReleaseSha,
    createdAt: input.now,
  });
  if (input.attempt.firstCheckAt === undefined) {
    const analytics = analyticsContextFromAttempt(input.attempt);
    const profile = await ctx.db.get(input.attempt.profileId);
    if (analytics !== null && profile !== null) {
      await enqueueClaimAnalyticsEvent(ctx, analytics, {
        event: "claim_verification_started",
        profileType: profile.profileType,
        method: claimAnalyticsMethodForAttempt(input.attempt),
        timeToFirstCheckBucket: timeToFirstCheckBucket(input.now - input.attempt.createdAt),
        occurredAt: input.now,
      });
    }
  }
  return true;
}

async function requireSubject(ctx: MutationCtx | QueryCtx) {
  return (await requireActiveBrowserSessionSubject(ctx)).subject;
}

async function requireCommunityCapability(
  ctx: MutationCtx | QueryCtx,
  communityProfileId: Id<"profiles">,
) {
  const subject = await requireSubject(ctx);
  const delegatedAllowed = await subjectHasCommunityCapability(
    ctx.db,
    communityProfileId,
    subject,
    "manage_integrations",
  );
  if (delegatedAllowed) return subject;
  const { userId } = await requireActiveBrowserSessionSubject(ctx);
  if (await userOwnsProfile(ctx.db, communityProfileId, userId)) return subject;
  throw new Error("You do not have permission to manage this community integration.");
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
  collectorAccountId: Id<"collectorAccounts">,
  workerId: string,
  fencingToken: number,
  now: number,
) {
  const lease = await activeLeaseForIntegration(ctx, integrationId);
  if (
    lease === null ||
    lease.collectorAccountId !== collectorAccountId ||
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
      lastSuccessfulObservationAt: undefined,
      lastAttemptAt: undefined,
      backoffUntil: undefined,
      nextPollAt: now,
      telemetryEpochStartedAt: now,
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
    if (integration.state === "disconnecting" || integration.state === "disconnected") {
      throw new Error("Community telemetry is disconnecting or disconnected.");
    }
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
    collectorAccountId: v.id("collectorAccounts"),
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
    await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
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
      ...(args.state === "connecting" || args.state === "awaiting_approval" || args.state === "awaiting_invite"
        ? { nextPollAt: Math.max(integration.nextPollAt ?? 0, now + 3 * 60_000) }
        : {}),
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
    collectorAccountId: v.id("collectorAccounts"),
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
    await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
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

/**
 * Mark a collector account as needing re-authentication after a proof read
 * returned an authenticated 401.
 *
 * The telemetry path routes 401s through `recordPollFailure`, which requires a
 * lease. Proof checks have none, so without this a worker that only had proof
 * work would exit silently and leave the account `ready` for every other
 * replica to rediscover the same dead session.
 */
/**
 * Publish an account-wide cooldown after a provider throttled a proof read.
 *
 * The worker's own backoff is process-local, and the supported two-task
 * configuration shares one collector account. Without this, the throttled task
 * slept while its sibling immediately reclaimed the released attempts and kept
 * sending requests straight through the provider's `Retry-After` window —
 * `claimPendingProofChecks` only honours the shared `cooldownUntil`, which
 * nothing on this path was setting.
 *
 * The account stays `ready`: this is throughput backoff, not a trust event, so
 * work should move to another account rather than the fleet losing this one.
 */
export const recordProofRateLimit = internalMutation({
  args: {
    collectorAccountId: v.string(),
    retryAfterMs: v.number(),
    // The digest this request authenticated with, as for the proof-result and
    // auth-failure paths: a request holding its body open across a rotation
    // must not put the recovered account into cooldown.
    workerKeyHash: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);

    if (!accountId) {
      return { recorded: false };
    }

    const account = await ctx.db.get(accountId);

    if (
      account === null ||
      account.state !== "ready" ||
      account.workerKeyHash !== args.workerKeyHash
    ) {
      return { recorded: false };
    }

    // Bounded the same way the worker bounds its own sleep, so a hostile or
    // mistaken `Retry-After` cannot park an account for an unbounded stretch.
    const cooldownUntil = now + Math.min(Math.max(args.retryAfterMs, 1_000), 5 * 60_000);

    await ctx.db.patch(account._id, {
      cooldownUntil: Math.max(cooldownUntil, account.cooldownUntil ?? 0),
      updatedAt: now,
    });

    return { recorded: true, cooldownUntil };
  },
});

export const recordProofAuthFailure = internalMutation({
  args: {
    collectorAccountId: v.string(),
    // The digest this request authenticated with, checked again here.
    workerKeyHash: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);

    if (!accountId) {
      return { recorded: false };
    }

    const account = await ctx.db.get(accountId);

    // Only a `ready` account moves to `auth_required`. An operator may have
    // quarantined or retired it between the request being authorized and this
    // mutation running, and a 401 report must not overwrite that decision.
    //
    // A rotated key is the same case: the 401 this reports was against the
    // superseded credential, so applying it would quarantine an account the
    // operator has just recovered and drop every integration assigned to it.
    if (
      account === null ||
      account.state !== "ready" ||
      account.workerKeyHash !== args.workerKeyHash
    ) {
      return { recorded: false };
    }

    await applyCollectorAccountState(ctx, account, "auth_required", now, "provider_401");

    return { recorded: true };
  },
});

/**
 * Hand back proof attempts that were claimed but never read.
 *
 * `claimPendingProofChecks` stamps the whole batch up front. If the shared
 * budget denies the very first read, every remaining attempt would otherwise
 * sit in cooldown having been looked at by nobody.
 */
export const releaseProofChecks = internalMutation({
  args: {
    collectorAccountId: v.string(),
    attemptIds: v.array(v.id("profileVerificationAttempts")),
  },
  handler: async (ctx, args) => {
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);

    if (!accountId) {
      return { released: 0 };
    }

    const attempts = await Promise.all(args.attemptIds.map((id) => ctx.db.get(id)));
    const releasable = attempts.filter(
      (attempt) =>
        attempt !== null &&
        attempt.state === "pending" &&
        // Only unwind this collector's own claim.
        attempt.lastCheckedByCollectorAccountId === accountId,
    );

    await Promise.all(
      releasable.map((attempt) =>
        ctx.db.patch(attempt!._id, {
          lastCheckedAt: undefined,
          lastCheckedByCollectorAccountId: undefined,
        }),
      ),
    );

    return { released: releasable.length };
  },
});

/**
 * Reserve provider requests for a proof read against the shared budget.
 *
 * Proof checks are not lease-scoped, so `reserveRequestBudget` does not apply,
 * but a process-local counter is not a budget: two tasks on one service
 * account, or a task that restarts mid-window, each start from zero and can
 * collectively exceed the account's configured rate. This reserves centrally
 * against the same counters the telemetry path uses, and re-checks the stop
 * switches so a kill switch halts proof reads too.
 */
/**
 * How much of a per-minute window proof reads may take.
 *
 * Half, but never so much that a telemetry poll cannot fit: one poll reserves
 * two requests atomically, and proofs run first, so a share that left one
 * request behind spent it and deferred that poll every window. At the supported
 * 2-RPM minimum this is zero — a budget that small serves one workload, and the
 * one with leases and live integrations wins. Proofs resume as soon as the
 * account's limit is raised.
 */
export function proofShareOf(requestsPerMinute: number): number {
  return Math.max(0, Math.min(Math.floor(requestsPerMinute / 2), requestsPerMinute - 2));
}

export const reserveProofRequestBudget = internalMutation({
  args: {
    collectorAccountId: v.string(),
    requestCount: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const requestCount = Math.floor(args.requestCount);

    if (!Number.isFinite(args.requestCount) || requestCount < 1 || requestCount > 10) {
      throw new Error("Provider request reservation is malformed.");
    }

    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);

    if (!accountId) {
      return { granted: false, retryAt: now + 60_000, reason: "unavailable" as const };
    }

    const account = await ctx.db.get(accountId);
    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();

    if (
      !account || account.state !== "ready" || account.killSwitchEnabled ||
      fleet?.killSwitchEnabled || (account.cooldownUntil ?? 0) > now
    ) {
      return { granted: false, retryAt: now + 60_000, reason: "unavailable" as const };
    }

    const windowStartedAt = Math.floor(now / 60_000) * 60_000;
    const retryAt = windowStartedAt + 60_000;
    const scopes = [
      { scopeKey: "global", limit: fleet?.globalRequestsPerMinute ?? 30 },
      { scopeKey: `account:${account._id}`, limit: account.requestsPerMinute },
      // Proofs get half the account's window, and the ceiling lives here rather
      // than in the worker: a process-local counter bounds one replica, and the
      // supported two-task setup — or a rolling restart — has two of them, each
      // entitled to half and collectively taking all of it. This scope is
      // shared, so the share holds however many workers are running.
      //
      // The share exists because proof reads run before telemetry: a proof
      // expires in 24 hours and a deferred telemetry batch does not, but a
      // backlog larger than one window would otherwise defer every integration
      // indefinitely.
      {
        scopeKey: `proof:account:${account._id}`,
        limit: proofShareOf(account.requestsPerMinute),
      },
      // And the same share of the fleet-wide window. Per-account halves do not
      // add up to a fleet-wide half: two accounts each spending their allowed
      // half exhaust a global limit that is not twice an account's, and
      // telemetry — which reserves against `global` too — is deferred again.
      { scopeKey: "proof:global", limit: proofShareOf(fleet?.globalRequestsPerMinute ?? 30) },
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
    collectorAccountId: v.id("collectorAccounts"),
    workerId: v.string(),
    fencingToken: v.number(),
    nextPollAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
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
    collectorAccountId: v.id("collectorAccounts"),
    workerId: v.string(),
    fencingToken: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const lease = await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
    await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
  },
});

export const ingestAggregatePoll = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    collectorAccountId: v.id("collectorAccounts"),
    workerId: v.string(),
    fencingToken: v.number(),
    pollId: v.string(),
    observedAt: v.number(),
    collectorVersion: v.string(),
    source: telemetrySourceValidator,
    groupMemberCount: v.number(),
    instances: v.array(aggregateInstanceValidator),
    nextPollAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration was not found.");
    if (
      !Number.isSafeInteger(args.observedAt) ||
      args.observedAt < now - 15 * 60_000 ||
      args.observedAt > now + 5 * 60_000 ||
      !Number.isSafeInteger(args.groupMemberCount) ||
      args.groupMemberCount < 0 ||
      args.instances.length > 200
    ) {
      throw new Error("Aggregate poll counts are malformed.");
    }
    const providerLocations = new Set<string>();
    for (const item of args.instances) {
      if (
        !Number.isSafeInteger(item.population) || item.population < 0 ||
        item.providerInstanceId.length < 1 || item.providerInstanceId.length > 500 || /[\u0000-\u001f\u007f]/.test(item.providerInstanceId) ||
        item.providerLocation.length < 1 || item.providerLocation.length > 500 ||
        !item.vrchatWorldId.startsWith("wrld_") || item.vrchatWorldId.length > 100 || /[\u0000-\u001f\u007f]/.test(item.vrchatWorldId) ||
        item.providerLocation !== `${item.vrchatWorldId}:${item.providerInstanceId}` ||
        /usr_[A-Za-z0-9-]+/i.test(item.providerInstanceId) || /usr_[A-Za-z0-9-]+/i.test(item.providerLocation) ||
        /~(?:hidden|private)\((?!subject-redacted\))[^)]*\)/i.test(item.providerInstanceId) ||
        /~(?:hidden|private)\((?!subject-redacted\))[^)]*\)/i.test(item.providerLocation) ||
        [...item.providerLocation.matchAll(/group\((grp_[A-Za-z0-9-]+)\)/g)].some((match) => match[1] !== integration.vrchatGroupId) ||
        providerLocations.has(item.providerLocation)
      ) throw new Error("Aggregate instance data is malformed.");
      providerLocations.add(item.providerLocation);
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
    const epochStartedAt = integration.telemetryEpochStartedAt ?? integration.createdAt;
    for (const item of args.instances) {
      seen.add(item.providerLocation);
      let session = await ctx.db
        .query("instanceSessions")
        .withIndex("by_integrationId_providerLocation_state_openedAt", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("providerLocation", item.providerLocation)
            .eq("state", "open")
            .gte("openedAt", epochStartedAt),
        )
        .first();
      const world = await ctx.db
        .query("worlds")
        .withIndex("by_vrchatWorldId", (q) => q.eq("vrchatWorldId", item.vrchatWorldId))
        .first();
      if (!session) {
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
          ...(!session.worldId && world ? { worldId: world._id } : {}),
          lastObservedAt: args.observedAt,
          consecutiveMisses: 0,
          updatedAt: args.observedAt,
        });
      }
      if (!session) continue;
      await ctx.db.insert("instancePopulationObservations", {
        integrationId: integration._id,
        sessionId: session._id,
        idempotencyKey: `${args.pollId}:${item.providerLocation}`,
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
      if (seen.has(session.providerLocation)) continue;
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
    collectorAccountId: v.id("collectorAccounts"),
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
    await assertLease(ctx, args.integrationId, args.collectorAccountId, args.workerId, args.fencingToken, now);
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
  const epochStartedAt = integration.telemetryEpochStartedAt ?? integration.createdAt;
  const [
    account,
    sessions,
    population,
    instancePopulation,
    memberCounts,
    coverage,
    hourlyRollups,
    dailyRollups,
    eventRollups,
    associations,
    events,
  ] = await Promise.all([
    integration.assignedCollectorAccountId ? ctx.db.get(integration.assignedCollectorAccountId) : null,
    ctx.db.query("instanceSessions").withIndex("by_communityProfileId_openedAt", (q) => q.eq("communityProfileId", profile._id).gte("openedAt", epochStartedAt)).order("desc").take(100),
    ctx.db.query("communityPopulationObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id).gte("observedAt", epochStartedAt)).order("desc").take(2500),
    ctx.db.query("instancePopulationObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id).gte("observedAt", epochStartedAt)).order("desc").take(2500),
    ctx.db.query("communityMemberCountObservations").withIndex("by_integrationId_observedAt", (q) => q.eq("integrationId", integration._id).gte("observedAt", epochStartedAt)).order("desc").take(500),
    ctx.db.query("collectionCoverageWindows").withIndex("by_integrationId_startedAt", (q) => q.eq("integrationId", integration._id).gte("startedAt", epochStartedAt)).order("desc").take(200),
    ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", profile._id).eq("grain", "hour").gte("bucketStartAt", epochStartedAt)).order("desc").take(400),
    ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", profile._id).eq("grain", "day").gte("bucketStartAt", epochStartedAt)).order("desc").take(400),
    ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", profile._id).eq("grain", "event").gte("bucketStartAt", epochStartedAt)).order("desc").take(200),
    ctx.db.query("eventInstanceAssociations").withIndex("by_communityProfileId_createdAt", (q) => q.eq("communityProfileId", profile._id).gte("createdAt", epochStartedAt)).order("desc").take(200),
    ctx.db.query("events").withIndex("by_communityProfileId_startAt", (q) => q.eq("communityProfileId", profile._id)).order("desc").take(100),
  ]);
  const rollups = [...hourlyRollups, ...dailyRollups, ...eventRollups]
    .sort((left, right) => left.bucketStartAt - right.bucketStartAt);
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
    rollups,
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
    if (!profile || profile.profileType !== "community" || !canReadProfile("public", profile)) return null;
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
    const existing = args.eventId
      ? await ctx.db.query("communityTelemetryRollups").withIndex("by_eventId_rollupVersion", (q) => q.eq("eventId", args.eventId!).eq("rollupVersion", TELEMETRY_ROLLUP_VERSION)).first()
      : await ctx.db.query("communityTelemetryRollups").withIndex("by_communityProfileId_grain_bucketStartAt", (q) => q.eq("communityProfileId", args.communityProfileId).eq("grain", args.grain).eq("bucketStartAt", args.bucketStartAt)).first();
    let eventSessionIds: Set<string> | undefined;
    if (args.eventId) {
      const confirmed = await ctx.db
        .query("eventInstanceAssociations")
        .withIndex("by_eventId_state", (q) => q.eq("eventId", args.eventId!).eq("state", "confirmed"))
        .collect();
      if (confirmed.length === 0) {
        if (existing) await ctx.db.delete(existing._id);
        return null;
      }
      eventSessionIds = new Set(confirmed.map((association) => association.sessionId as string));
    }
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
    const requiresRollupRecompute = args.state === "confirmed" || association.state === "confirmed";
    await ctx.db.patch(association._id, { state: args.state, actor, reviewedAt: now, updatedAt: now });
    if (requiresRollupRecompute) {
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
  args: { now: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const hourEnd = Math.floor(now / (60 * 60_000)) * 60 * 60_000;
    const hourStart = hourEnd - 60 * 60_000;
    const dayEnd = Math.floor(now / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const dayStart = dayEnd - 24 * 60 * 60_000;
    const integrationsPage = await ctx.db.query("communityVrchatIntegrations").paginate({
      cursor: args.cursor ?? null,
      numItems: 200,
    });
    let scheduled = 0;
    for (const integration of integrationsPage.page) {
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
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.scheduleTelemetryEventWorkForCommunity, {
        communityProfileId: integration.communityProfileId,
        now,
      });
    }
    if (!integrationsPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.scheduleTelemetryRollups, {
        now,
        cursor: integrationsPage.continueCursor,
      });
    }
    return { integrations: integrationsPage.page.length, scheduled, isDone: integrationsPage.isDone };
  },
});

export const scheduleTelemetryEventWorkForCommunity = internalMutation({
  args: {
    communityProfileId: v.id("profiles"),
    now: v.number(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("events")
      .withIndex("by_communityProfileId_startAt", (query) =>
        query
          .eq("communityProfileId", args.communityProfileId)
          .gte("startAt", args.now - 14 * 24 * 60 * 60_000)
          .lte("startAt", args.now + 6 * 60 * 60_000),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.max(1, Math.min(Math.floor(args.limit ?? 100), 100)),
      });
    let rollupsScheduled = 0;
    for (const event of page.page) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.suggestEventAssociations, {
        eventId: event._id,
        now: args.now,
      });
      if (event.startAt > args.now) continue;
      const confirmed = await ctx.db
        .query("eventInstanceAssociations")
        .withIndex("by_eventId_state", (query) => query.eq("eventId", event._id).eq("state", "confirmed"))
        .first();
      if (!confirmed) continue;
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.recomputeRollup, {
        communityProfileId: args.communityProfileId,
        eventId: event._id,
        grain: "event",
        bucketStartAt: event.startAt,
        bucketEndAt: event.endAt ?? event.startAt + 6 * 60 * 60_000,
        now: args.now,
      });
      rollupsScheduled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.scheduleTelemetryEventWorkForCommunity, {
        communityProfileId: args.communityProfileId,
        now: args.now,
        cursor: page.continueCursor,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
    }
    return {
      events: page.page.length,
      rollupsScheduled,
      isDone: page.isDone,
    };
  },
});

async function rolledHoursForObservations(
  ctx: MutationCtx,
  communityProfileId: Id<"profiles">,
  observedAts: number[],
) {
  const hours = new Set(
    observedAts.map((observedAt) => Math.floor(observedAt / (60 * 60_000)) * 60 * 60_000),
  );
  const results = await Promise.all([...hours].map(async (hour) => ({
    hour,
    rollup: await ctx.db
      .query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) =>
        query
          .eq("communityProfileId", communityProfileId)
          .eq("grain", "hour")
          .eq("bucketStartAt", hour),
      )
      .first(),
  })));
  return new Set(results.filter((result) => result.rollup).map((result) => result.hour));
}

export const compactRawTelemetry = internalMutation({
  args: {
    integrationId: v.id("communityVrchatIntegrations"),
    rawBeforeAt: v.number(),
    limit: v.optional(v.number()),
    phase: v.optional(v.union(v.literal("aggregate"), v.literal("instance"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) return { aggregateDeleted: 0, instanceDeleted: 0, isDone: true };
    const limit = Math.max(1, Math.min(args.limit ?? 500, 1000));
    const phase = args.phase ?? "aggregate";

    if (phase === "aggregate") {
      const page = await ctx.db.query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id).lt("observedAt", args.rawBeforeAt))
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      const rolledHours = await rolledHoursForObservations(
        ctx,
        integration.communityProfileId,
        page.page.map((point) => point.observedAt),
      );
      let aggregateDeleted = 0;
      for (const point of page.page) {
        const hour = Math.floor(point.observedAt / (60 * 60_000)) * 60 * 60_000;
        if (!rolledHours.has(hour)) continue;
        await ctx.db.delete(point._id);
        aggregateDeleted += 1;
      }
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.compactRawTelemetry, {
        integrationId: integration._id,
        rawBeforeAt: args.rawBeforeAt,
        limit,
        phase: page.isDone ? "instance" : "aggregate",
        cursor: page.isDone ? undefined : page.continueCursor,
      });
      return { aggregateDeleted, instanceDeleted: 0, isDone: false };
    }

    const page = await ctx.db.query("instancePopulationObservations")
      .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integration._id).lt("observedAt", args.rawBeforeAt))
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const rolledHours = await rolledHoursForObservations(
      ctx,
      integration.communityProfileId,
      page.page.map((point) => point.observedAt),
    );
    const protectedSessionResults = await Promise.all(
      [...new Set(page.page.map((point) => point.sessionId))].map(async (sessionId) => {
        const confirmed = await ctx.db.query("eventInstanceAssociations")
          .withIndex("by_sessionId_state", (query) =>
            query.eq("sessionId", sessionId).eq("state", "confirmed"),
          )
          .first();
        if (!confirmed) return undefined;
        const eventRollup = await ctx.db.query("communityTelemetryRollups")
          .withIndex("by_eventId_rollupVersion", (query) =>
            query.eq("eventId", confirmed.eventId).eq("rollupVersion", TELEMETRY_ROLLUP_VERSION),
          )
          .first();
        return eventRollup ? undefined : sessionId;
      }),
    );
    const protectedSessions = new Set(
      protectedSessionResults.filter((sessionId): sessionId is Id<"instanceSessions"> => Boolean(sessionId)),
    );
    let instanceDeleted = 0;
    for (const point of page.page) {
      const hour = Math.floor(point.observedAt / (60 * 60_000)) * 60 * 60_000;
      if (!rolledHours.has(hour) || protectedSessions.has(point.sessionId)) continue;
      await ctx.db.delete(point._id);
      instanceDeleted += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.compactRawTelemetry, {
        integrationId: integration._id,
        rawBeforeAt: args.rawBeforeAt,
        limit,
        phase: "instance",
        cursor: page.continueCursor,
      });
    }
    return { aggregateDeleted: 0, instanceDeleted, isDone: page.isDone };
  },
});

export const scheduleTelemetryCompaction = internalMutation({
  args: { now: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const integrationsPage = await ctx.db.query("communityVrchatIntegrations").paginate({
      cursor: args.cursor ?? null,
      numItems: 200,
    });
    for (const integration of integrationsPage.page) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.compactRawTelemetry, {
        integrationId: integration._id,
        rawBeforeAt: now - 90 * 24 * 60 * 60_000,
        limit: 500,
      });
    }
    if (!integrationsPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.scheduleTelemetryCompaction, {
        now,
        cursor: integrationsPage.continueCursor,
      });
    }
    return { scheduled: integrationsPage.page.length, isDone: integrationsPage.isDone };
  },
});

export const suggestEventAssociations = internalMutation({
  args: {
    eventId: v.id("events"),
    now: v.optional(v.number()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event?.communityProfileId) return [];
    const eventWorlds = await ctx.db.query("eventWorlds").withIndex("by_eventId", (q) => q.eq("eventId", event._id)).collect();
    const worldIds = new Set(eventWorlds.filter((link) => link.confirmationState === "confirmed").map((link) => link.worldId as string));
    const now = args.now ?? Date.now();
    const eventEndAt = event.endAt ?? event.startAt + 6 * 60 * 60_000;
    const sessionsPage = await ctx.db.query("instanceSessions")
      .withIndex("by_communityProfileId_openedAt", (q) =>
        q.eq("communityProfileId", event.communityProfileId!)
          .gte("openedAt", event.startAt - 6 * 60 * 60_000)
          .lte("openedAt", eventEndAt),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.max(1, Math.min(Math.floor(args.limit ?? 100), 100)),
      });
    const created: Id<"eventInstanceAssociations">[] = [];
    for (const session of sessionsPage.page) {
      const timeOverlap = session.openedAt <= eventEndAt && (session.closedAt ?? now) >= event.startAt;
      const worldMatch = session.worldId ? worldIds.has(session.worldId as string) : false;
      if (!timeOverlap || !worldMatch) continue;
      const [existingSuggestion, confirmed, rejected] = await Promise.all([
        ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "suggested")).first(),
        ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "confirmed")).first(),
        ctx.db.query("eventInstanceAssociations").withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "rejected")).collect(),
      ]);
      if (existingSuggestion || confirmed || rejected.some((association) => association.eventId === event._id)) continue;
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
    if (!sessionsPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.communityTelemetry.suggestEventAssociations, {
        eventId: event._id,
        now,
        cursor: sessionsPage.continueCursor,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
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

/**
 * Record process liveness and immutable release metadata without weakening the
 * proof-path readiness signal. `lastProofPollAt` is stamped separately, only
 * after a worker reaches every fleet/account proof gate.
 */
export const recordCollectorHeartbeat = internalMutation({
  args: {
    collectorAccountId: v.string(),
    workerId: v.string(),
    releaseSha: v.string(),
    collectorVersion: v.string(),
    capabilities: v.array(collectorRuntimeCapabilityValidator),
    consecutiveControlFailures: v.number(),
    workerKeyHash: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);
    if (!accountId) return { recorded: false };
    const account = await ctx.db.get(accountId);
    if (!account || account.workerKeyHash !== args.workerKeyHash) {
      return { recorded: false };
    }

    const capabilities = [...new Set(args.capabilities)] as CollectorRuntimeCapability[];
    const failures = Math.floor(args.consecutiveControlFailures);
    if (!Number.isFinite(args.consecutiveControlFailures) || failures < 0 || failures > 1000) {
      throw new Error("Collector failure count is invalid.");
    }

    await ctx.db.patch(accountId, {
      lastWorkerHeartbeatAt: now,
      lastWorkerId: boundedWorkerId(args.workerId),
      lastWorkerReleaseSha: normalizedReleaseSha(args.releaseSha),
      lastWorkerVersion: boundedWorkerVersion(args.collectorVersion),
      lastWorkerCapabilities: capabilities,
      consecutiveControlFailures: failures,
      updatedAt: now,
    });
    return { recorded: true };
  },
});

/** Backward-compatible proof availability used by the claimant action. */
export const collectorProofAvailable = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();
    if (fleet?.killSwitchEnabled) return false;
    if (proofShareOf(fleet?.globalRequestsPerMinute ?? 30) < 1) return false;

    const accounts = await ctx.db
      .query("collectorAccounts")
      .withIndex("by_state_assignedGroupCount", (q) => q.eq("state", "ready"))
      .collect();
    return accounts.some(
      (account) =>
        !account.killSwitchEnabled &&
        proofShareOf(account.requestsPerMinute) > 0 &&
        (account.cooldownUntil ?? 0) <= args.now &&
        (account.lastProofPollAt ?? 0) >= args.now - WORKER_HEARTBEAT_FRESHNESS_MS,
    );
  },
});

/**
 * Stable, identifier-free post-deploy gate consumed by the release workflow.
 */
export const collectorDeploymentReadiness = internalQuery({
  args: {
    expectedReleaseSha: v.string(),
    requiredCapabilities: v.array(collectorRuntimeCapabilityValidator),
    maxHeartbeatAgeMs: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const expectedReleaseSha = normalizedReleaseSha(args.expectedReleaseSha);
    const maxHeartbeatAgeMs = Math.floor(args.maxHeartbeatAgeMs);
    if (!Number.isFinite(args.maxHeartbeatAgeMs) || maxHeartbeatAgeMs < 1_000 || maxHeartbeatAgeMs > 60 * 60_000) {
      throw new Error("Collector heartbeat age is invalid.");
    }
    const requiredCapabilities = [...new Set(args.requiredCapabilities)];
    const [fleet, accounts] = await Promise.all([
      ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .first(),
      ctx.db.query("collectorAccounts").collect(),
    ]);
    const eligible = accounts.filter(
      (account) =>
        account.state === "ready" &&
        !account.killSwitchEnabled,
    );
    const fresh = eligible.filter(
      (account) =>
        (account.lastWorkerHeartbeatAt ?? 0) >= args.now - maxHeartbeatAgeMs,
    );
    const matching = fresh.filter(
      (account) =>
        account.lastWorkerReleaseSha === expectedReleaseSha &&
        requiredCapabilities.every((capability) =>
          account.lastWorkerCapabilities?.includes(capability),
        ),
    );
    const issues: string[] = [];
    if (fleet?.killSwitchEnabled) issues.push("fleet_kill_switch_enabled");
    if (eligible.length === 0) issues.push("no_eligible_collectors");
    if (fresh.length === 0) issues.push("no_fresh_heartbeats");
    if (fresh.length > 0 && matching.length === 0) issues.push("release_or_capability_mismatch");

    return {
      healthy: !fleet?.killSwitchEnabled && matching.length > 0,
      issues,
      freshCollectorCount: fresh.length,
      matchingReleaseCount: matching.length,
      authRequiredCount: accounts.filter((account) => account.state === "auth_required").length,
    };
  },
});

/** Aggregate-only proof backlog and fleet health for operator diagnostics. */
export const claimVerificationOperationalHealth = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const [fleet, accounts, userAttempts, groupAttempts, recentProviderChecks] = await Promise.all([
      ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .first(),
      ctx.db.query("collectorAccounts").collect(),
      ctx.db
        .query("profileVerificationAttempts")
        .withIndex("by_state_targetType_createdAt", (q) =>
          q.eq("state", "pending").eq("targetType", "vrchat_user"),
        )
        .take(OPERATIONAL_HEALTH_ATTEMPT_LIMIT + 1),
      ctx.db
        .query("profileVerificationAttempts")
        .withIndex("by_state_targetType_createdAt", (q) =>
          q.eq("state", "pending").eq("targetType", "vrchat_group"),
        )
        .take(OPERATIONAL_HEALTH_ATTEMPT_LIMIT + 1),
      ctx.db
        .query("profileClaimLifecycleEvents")
        .withIndex("by_event_createdAt", (q) =>
          q
            .eq("event", "provider_checked")
            .gte("createdAt", args.now - FIRST_CHECK_HEALTH_LOOKBACK_MS),
        )
        .order("desc")
        .take(OPERATIONAL_HEALTH_ATTEMPT_LIMIT + 1),
    ]);
    const userScanLimitReached = userAttempts.length > OPERATIONAL_HEALTH_ATTEMPT_LIMIT;
    const groupScanLimitReached = groupAttempts.length > OPERATIONAL_HEALTH_ATTEMPT_LIMIT;
    const providerCheckScanLimitReached =
      recentProviderChecks.length > OPERATIONAL_HEALTH_ATTEMPT_LIMIT;
    const pending = [
      ...userAttempts.slice(0, OPERATIONAL_HEALTH_ATTEMPT_LIMIT),
      ...groupAttempts.slice(0, OPERATIONAL_HEALTH_ATTEMPT_LIMIT),
    ].filter(
      (attempt) => attempt.expiresAt > args.now,
    );
    const unchecked = pending.filter((attempt) => attempt.firstCheckAt === undefined);
    const fleetProofPathEnabled =
      !fleet?.killSwitchEnabled &&
      proofShareOf(fleet?.globalRequestsPerMinute ?? 30) > 0;
    const freshCollectors = accounts.filter(
      (account) =>
        fleetProofPathEnabled &&
        account.state === "ready" &&
        !account.killSwitchEnabled &&
        proofShareOf(account.requestsPerMinute) > 0 &&
        (account.cooldownUntil ?? 0) <= args.now &&
        (account.lastProofPollAt ?? 0) >= args.now - WORKER_HEARTBEAT_FRESHNESS_MS,
    );
    const releaseCounts = new Map<string, number>();
    for (const account of freshCollectors) {
      const key = account.lastWorkerReleaseSha ?? "unknown";
      releaseCounts.set(key, (releaseCounts.get(key) ?? 0) + 1);
    }
    const recentCheckedAttemptIds = [
      ...new Set(
        recentProviderChecks
          .slice(0, OPERATIONAL_HEALTH_ATTEMPT_LIMIT)
          .map((event) => event.attemptId),
      ),
    ];
    const recentCheckedAttempts = await Promise.all(
      recentCheckedAttemptIds.map((attemptId) => ctx.db.get(attemptId)),
    );
    const recentFirstCheckLatencies = recentCheckedAttempts.flatMap((attempt) =>
      attempt?.firstCheckAt === undefined
        ? []
        : [Math.max(0, attempt.firstCheckAt - attempt.createdAt)],
    );
    return {
      fleetKillSwitchEnabled: fleet?.killSwitchEnabled ?? false,
      pendingEligibleAttemptCount: pending.length,
      scanLimitReached:
        userScanLimitReached || groupScanLimitReached || providerCheckScanLimitReached,
      uncheckedAttemptCount: unchecked.length,
      oldestUncheckedAgeMs:
        unchecked.length === 0
          ? null
          : Math.max(0, args.now - Math.min(...unchecked.map((attempt) => attempt.createdAt))),
      freshCollectorCount: freshCollectors.length,
      authRequiredCount: accounts.filter((account) => account.state === "auth_required").length,
      maxRecentFirstCheckLatencyMs:
        recentFirstCheckLatencies.length === 0
          ? null
          : Math.max(...recentFirstCheckLatencies),
      maxConsecutiveControlFailures: freshCollectors.reduce(
        (maximum, account) => Math.max(maximum, account.consecutiveControlFailures ?? 0),
        0,
      ),
      releases: [...releaseCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([releaseSha, collectorCount]) => ({ releaseSha, collectorCount })),
    };
  },
});

export const collectorWorkerAuthorization = internalQuery({
  args: { collectorAccountId: v.string() },
  handler: async (ctx, args) => {
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);
    if (!accountId) return null;
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    return {
      workerKeyHash: account.workerKeyHash,
      // Not a secret — it is the account this collector is registered as, and
      // the worker compares it against the identity recorded in its own secret.
      // Without that comparison, pairing one collector id with another
      // account's secret ARN starts a task that reads as A while every result
      // is filed under B.
      vrchatUserId: account.vrchatUserId,
      enabled: account.state === "ready" && !account.killSwitchEnabled,
    };
  },
});

const PROOF_CHECK_COOLDOWN_MS = 5 * 60_000;
const PROOF_CHECK_SCAN_LIMIT = 100;

/**
 * Hand the collector a batch of pending VRChat proof attempts to look for.
 *
 * Ordered by `lastCheckedAt` ascending so untouched attempts go first and the
 * rest rotate, and stamped on claim so a batch is not immediately re-served.
 * Only the target id and proof code leave the control plane.
 */
export const claimPendingProofChecks = internalMutation({
  args: {
    collectorAccountId: v.string(),
    workerId: v.string(),
    releaseSha: v.optional(v.string()),
    limit: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);
    if (!accountId) return { attempts: [] };
    const account = await ctx.db.get(accountId);
    // `cooldownUntil` too, matching `reserveRequestBudget` and
    // `reserveProofRequestBudget`. Provider backoff leaves `state: "ready"`, so
    // checking state alone kept serving proof work to an account that is
    // supposed to be standing down — and stamped those attempts into their own
    // cooldown on the way.
    if (
      !account ||
      account.state !== "ready" ||
      account.killSwitchEnabled ||
      (account.cooldownUntil ?? 0) > args.now
    ) {
      return { attempts: [] };
    }

    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .first();
    if (fleet?.killSwitchEnabled) return { attempts: [] };

    // This is the backward-compatible proof-path heartbeat. It is stamped only
    // after every account and fleet gate passes, even when the queue is empty.
    // A generic process heartbeat cannot prove that an obsolete release
    // reached this protocol.
    if ((account.lastProofPollAt ?? 0) <= args.now - PROOF_POLL_HEARTBEAT_WRITE_MS) {
      await ctx.db.patch(accountId, { lastProofPollAt: args.now, updatedAt: args.now });
    }

    const limit = Math.max(1, Math.min(args.limit ?? 5, 25));
    const workerId = boundedWorkerId(args.workerId);
    const workerReleaseSha = normalizedOptionalReleaseSha(
      args.releaseSha ?? account.lastWorkerReleaseSha,
    );
    // Select collector-eligible target types through the index. Scanning all
    // pending attempts and filtering afterwards let vrclinking rows, which are
    // never stamped, hold the head of the window permanently and starve the
    // queue once enough of them existed.
    const scanned = await Promise.all(
      (["vrchat_user", "vrchat_group"] as const).map((targetType) =>
        ctx.db
          .query("profileVerificationAttempts")
          .withIndex("by_state_targetType_lastCheckedAt", (q) =>
            q.eq("state", "pending").eq("targetType", targetType),
          )
          .take(PROOF_CHECK_SCAN_LIMIT),
      ),
    );
    // Expired rows sit in this index until the hourly sweeper clears them, and
    // never-checked ones sort to the head, so a backlog of them could fill the
    // scan window and starve live attempts. Settle the ones this scan trips
    // over so they leave the pending index immediately rather than accumulating.
    const scannedFlat = scanned.flat();
    await Promise.all(
      scannedFlat
        .filter((attempt) => attempt.expiresAt <= args.now)
        .map(async (attempt) => {
          await ctx.db.patch(attempt._id, {
            state: "expired",
            resolvedAt: args.now,
            resolutionReason: "expired",
            updatedAt: args.now,
          });
          await recordProfileClaimLifecycleEvent(ctx, {
            profileId: attempt.profileId,
            attemptId: attempt._id,
            method: attempt.method,
            targetType: attempt.targetType,
            event: "attempt_resolved",
            actorSurface: "collector",
            outcome: "expired",
            createdAt: args.now,
          });
          const profile = await ctx.db.get(attempt.profileId);
          if (profile !== null) {
            await enqueueAttemptResolution(
              ctx,
              attempt,
              profile.profileType,
              "expired",
              args.now,
            );
          }
        }),
    );

    const due = scannedFlat
      .filter(
        (attempt) =>
          attempt.expiresAt > args.now &&
          (attempt.lastCheckedAt === undefined ||
            attempt.lastCheckedAt <= args.now - PROOF_CHECK_COOLDOWN_MS),
      )
      // Creation order breaks the tie, and has to. Never-checked rows all carry
      // the same `?? 0`, and `scannedFlat` holds every `vrchat_user` row before
      // every `vrchat_group` one; a stable sort over equal keys therefore
      // handed each batch nothing but user proofs, and under sustained
      // user-proof traffic group proofs could sit unpolled until they expired.
      .sort(
        (left, right) =>
          (left.lastCheckedAt ?? 0) - (right.lastCheckedAt ?? 0) ||
          left._creationTime - right._creationTime,
      )
      .slice(0, limit);

    await Promise.all(
      due.map(async (attempt) => {
        await ctx.db.patch(attempt._id, {
          lastCheckedAt: args.now,
          lastCheckedByCollectorAccountId: accountId,
          firstDispatchedAt: attempt.firstDispatchedAt ?? args.now,
          lastDispatchedAt: args.now,
          dispatchCount: (attempt.dispatchCount ?? 0) + 1,
          lastDispatchedByWorkerId: workerId,
          updatedAt: args.now,
        });
        await recordProfileClaimLifecycleEvent(ctx, {
          profileId: attempt.profileId,
          attemptId: attempt._id,
          method: attempt.method,
          targetType: attempt.targetType,
          event: "proof_dispatched",
          actorSurface: "collector",
          workerReleaseSha,
          createdAt: args.now,
        });
      }),
    );

    return {
      attempts: due.map((attempt) => ({
        attemptId: attempt._id,
        targetType: attempt.targetType,
        targetExternalId: attempt.targetExternalId,
        proofCode: attempt.proofCode,
      })),
    };
  },
});

/**
 * Record a collector proof check. A negative result is not a failure: the owner
 * may simply not have posted the code yet, so the attempt stays pending until
 * it expires.
 */
export const recordProofCheckResult = internalMutation({
  args: {
    collectorAccountId: v.string(),
    attemptId: v.id("profileVerificationAttempts"),
    found: v.boolean(),
    releaseSha: v.optional(v.string()),
    // The key digest this request authenticated with. `http.ts` checks it
    // before reading the body, so a caller holding the body open across a key
    // rotation could still land a verdict on a credential that no longer
    // exists. Re-checked at the point the verdict actually grants ownership.
    workerKeyHash: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);
    if (!accountId) return { state: "unauthorized" as const };

    const attempt = await ctx.db.get(args.attemptId);
    if (attempt === null || attempt.state !== "pending") {
      return { state: "not_pending" as const };
    }

    // A verdict is only accepted from the collector this attempt was served to.
    // Without this, any authorized worker key could assert `found` for any
    // pending attempt and mint ownership without reading VRChat.
    //
    // What this does not do — and cannot: a single compromised worker key can
    // still call `claimProofBatch` to have an attempt served to itself and then
    // report `found` on it. The fleet is a trusted oracle by construction; the
    // control plane has no independent view of VRChat to check a verdict
    // against, so no check inside this mutation can make one credential's word
    // less than its word. The bounds that do exist are elsewhere:
    //
    //   - It cannot invent attempts. Only a signed-in account can start one,
    //     for a profile it is claiming, so a leaked key can forge the *reading*
    //     of a proof, never the claimant.
    //   - It cannot reach `claimed_verified`. That needs the target already
    //     linked to the profile by somebody other than the claimant
    //     (`assetBacksThisProfile` in `recordVrchatProofVerification`), which
    //     no worker key can produce.
    //   - Operators can revoke it: per-account and fleet kill switches are
    //     re-read below, account state is checked, and the key is stored only
    //     as a digest so rotation is a single re-registration.
    //
    // Closing the residual gap means multi-party attestation — a verdict from a
    // collector account other than the one served — which doubles provider load
    // for every proof. That is a product decision, not a fix to make here.
    if (attempt.lastCheckedByCollectorAccountId !== accountId) {
      return { state: "unauthorized" as const };
    }

    // Re-check the stop switches here rather than trusting the batch that was
    // issued earlier. A kill switch flipped mid-flight must prevent new
    // verified ownership, otherwise the emergency stop only stops reads while
    // in-flight verdicts keep granting.
    const [fleet, account] = await Promise.all([
      ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .first(),
      ctx.db.get(accountId),
    ]);

    // `state` too, not just the kill switches: authorization and this mutation
    // are separate transactions, so a concurrent 401 report or an operator
    // moving the account to quarantined/retiring lands in that window and must
    // not still grant verified ownership.
    //
    // Deliberately not `cooldownUntil`, which the claim path does check. That
    // is provider backoff — a throughput signal, not a trust one. This verdict
    // was obtained from a read that was authorized when it happened, so
    // discarding it would throw away real work and send the attempt back to
    // pending for no safety gain.
    if (
      fleet?.killSwitchEnabled ||
      account === null ||
      account.killSwitchEnabled ||
      account.state !== "ready" ||
      // Rotation supersedes anything in flight. `http.ts` authenticated this
      // request before reading its body, so a caller holding that body open
      // across a re-registration could otherwise land a verdict — and grant
      // ownership — on a key an operator had already replaced.
      account.workerKeyHash !== args.workerKeyHash
    ) {
      return { state: "unauthorized" as const };
    }
    const workerReleaseSha = normalizedOptionalReleaseSha(
      args.releaseSha ?? account.lastWorkerReleaseSha,
    );

    await recordProviderCheck(ctx, {
      attempt,
      accountId,
      outcome: args.found ? "found" : "not_found",
      now: args.now,
      workerReleaseSha,
    });

    if (attempt.expiresAt <= args.now) {
      await ctx.db.patch(attempt._id, {
        state: "expired",
        resolvedAt: args.now,
        resolutionReason: "expired",
        updatedAt: args.now,
      });
      await recordProfileClaimLifecycleEvent(ctx, {
        profileId: attempt.profileId,
        attemptId: attempt._id,
        method: attempt.method,
        targetType: attempt.targetType,
        event: "attempt_resolved",
        actorSurface: "collector",
        outcome: "expired",
        workerReleaseSha,
        createdAt: args.now,
      });
      const profile = await ctx.db.get(attempt.profileId);
      if (profile !== null) {
        await enqueueAttemptResolution(
          ctx,
          attempt,
          profile.profileType,
          "expired",
          args.now,
        );
      }
      return { state: "expired" as const };
    }

    if (!args.found) {
      return { state: "pending" as const };
    }

    // Annotated rather than inferred: this mutation and `profileClaims` refer to
    // each other through the generated `internal` handle, and letting the
    // compiler chase that makes both `any`.
    let outcome: { claimState: string } | { state: string; reason?: string };

    try {
      outcome = (await ctx.runMutation(internal.profileClaims.recordVrchatProofVerification, {
        attemptId: attempt._id,
        evidenceSource: "vrchat_api",
        evidenceSummary: "Proof code was found on the VRChat target by the collector.",
        actorSurface: "collector",
      })) as { claimState: string } | { state: string; reason?: string };
    } catch (error) {
      // Only an ownership conflict is terminal. Another claimant won between
      // this attempt being issued and its code being found, and retrying cannot
      // change that, so settle it. Anything else — a transient failure while
      // writing ownership, audit, link, or search rows — must propagate, or a
      // valid proof would be marked failed for a condition that will clear.
      const code =
        error instanceof ConvexError && typeof error.data === "object" && error.data !== null
          ? (error.data as { code?: unknown }).code
          : undefined;

      if (code !== "PROFILE_ALREADY_OWNED") {
        throw error;
      }

      await ctx.db.patch(attempt._id, {
        state: "failed",
        resolvedAt: args.now,
        resolutionReason: "already_owned",
        evidenceSource: "vrchat_api",
        evidenceSummary: "This profile was claimed by someone else before the proof was found.",
        updatedAt: args.now,
      });
      await recordProfileClaimLifecycleEvent(ctx, {
        profileId: attempt.profileId,
        attemptId: attempt._id,
        method: attempt.method,
        targetType: attempt.targetType,
        event: "attempt_resolved",
        actorSurface: "collector",
        outcome: "already_owned",
        workerReleaseSha,
        createdAt: args.now,
      });

      const profile = await ctx.db.get(attempt.profileId);
      if (profile !== null) {
        await enqueueAttemptResolution(
          ctx,
          attempt,
          profile.profileType,
          "conflict",
          args.now,
        );
      }

      return { state: "already_owned" as const };
    }

    // The races the verifier *settles* rather than throws — another claimant
    // winning, or the listing ceasing to be claimable while the proof was in
    // flight — never reach the catch above, so reporting `verified` regardless
    // told the collector a claim had been granted while the attempt row read
    // `failed`. Settling rather than throwing is deliberate there: a throw would
    // have the collector retry an attempt that can never succeed. Reading the
    // result is what makes that choice safe.
    if (!("claimState" in outcome)) {
      return {
        state:
          outcome.reason === "already_owned" ? ("already_owned" as const) : ("not_granted" as const),
      };
    }

    return { state: "verified" as const };
  },
});

/**
 * Record a provider request that returned no proof verdict. These outcomes are
 * operational only and never settle an attempt or grant ownership.
 */
export const recordProofCheckOutcome = internalMutation({
  args: {
    collectorAccountId: v.string(),
    attemptId: v.id("profileVerificationAttempts"),
    outcome: v.union(
      v.literal("rate_limited"),
      v.literal("auth_required"),
      v.literal("provider_unavailable"),
      v.literal("control_plane_error"),
    ),
    workerKeyHash: v.string(),
    releaseSha: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const accountId = ctx.db.normalizeId("collectorAccounts", args.collectorAccountId);
    if (!accountId) return { recorded: false };
    const [account, attempt] = await Promise.all([
      ctx.db.get(accountId),
      ctx.db.get(args.attemptId),
    ]);
    if (
      !account ||
      account.workerKeyHash !== args.workerKeyHash ||
      !attempt ||
      attempt.state !== "pending"
    ) {
      return { recorded: false };
    }
    const workerReleaseSha = normalizedOptionalReleaseSha(
      args.releaseSha ?? account.lastWorkerReleaseSha,
    );
    return {
      recorded: await recordProviderCheck(ctx, {
        attempt,
        accountId,
        outcome: args.outcome,
        now: args.now,
        workerReleaseSha,
      }),
    };
  },
});
