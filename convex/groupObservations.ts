import { linkProfileToAsset, requireControlProof } from "./_externalControl";
import { activeBrowserSessionOrNull, requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { normalizeVrchatTargetId } from "./_vrchatIdentity";
import { enabledClubFeatures } from "./_clubConnection";
import { transitionCoverage } from "./_collectionCoverage";
import { seedImportAuthSubjectValidator } from "./_seedImportValidators";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canReadProfile } from "./_profilePermissions";
import { automaticAdmissionEnabled, primaryGroupSelection, readCollectionSubject, readPublicGroupId } from "./_groupObservationPolicy";
import { CURRENT_FRESHNESS_MS } from "./_communityTelemetry";
import { admissionMatches, statisticsAdmissionViewValidator, type StatisticsAdmissionView } from "./_groupAdmission";
import { syncDestinationQueue } from "./_profileLinkDestinationCache";
import { ADMISSION_MONITORING_FRESHNESS_MS, admissionDiagnosticsValidator, emptyAdmissionDiagnostics } from "./_groupObservationMonitoring";

const DAY = 86_400_000;

function accountHasAdmissionCapacity(account: Doc<"collectorAccounts">, now: number) {
  return account.state === "ready" && !account.killSwitchEnabled && (account.cooldownUntil ?? 0) <= now &&
    account.assignedGroupCount < account.capacity - account.reservedHeadroom;
}

async function statisticsAdmissionPreview(db: DatabaseReader, profileId: Id<"profiles">, now: number): Promise<StatisticsAdmissionView> {
  const profile = await db.get(profileId);
  const group = await readPublicGroupId(db, profileId);
  const selected = profile?.primaryGroupReference;
  const destination = selected ? await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", selected.key)).unique() : null;
  const metadata = destination?.groupMetadata;
  const observedAt = destination?.observedAt;
  const rows = group ? await db.query("communityVrchatIntegrations").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", group)).take(101) : [];
  const policy = group ? await db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", group)).unique() : null;
  const canonical = policy?.integrationId ? rows.find(row => row._id === policy.integrationId) : rows.length === 1 ? rows[0] : undefined;
  const fleet = await db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
  const accounts = await db.query("collectorAccounts").withIndex("by_state_assignedGroupCount", q => q.eq("state", "ready")).take(100);
  const assigned = canonical?.assignedCollectorAccountId ? await db.get(canonical.assignedCollectorAccountId) : null;
  const account = assigned ?? accounts.find(row => accountHasAdmissionCapacity(row, now));
  const live = canonical?.statisticsAdmission && admissionMatches(canonical, canonical.statisticsAdmission.authorizedAt, canonical.statisticsAdmission.collectorAccountId);
  const blockedBeforeMembership = canonical?.state === "blocked" && policy?.admissionRequired === true &&
    !canonical.assignedCollectorAccountId && !canonical.statisticsAdmission && !canonical.statisticsAdmissionInspection &&
    !canonical.automaticAdmissionAttempt && canonical.lastSuccessfulObservationAt === undefined;
  const limit = fleet?.automaticEnrollmentLimit;
  const reserved = await db.query("communityVrchatIntegrations").withIndex("by_collectionScope_kind_account", q => q.eq("collectionScope.kind", "automatic").gt("assignedCollectorAccountId", undefined)).take(50);
  const managedDue = await db.query("vrchatGroupObservationPolicies").withIndex("by_queue_priority_dueAt", q => q.eq("queuedAdmission.priority", "managed").lte("queuedAdmission.dueAt", now)).first();
  let blockReason: string | undefined;
  if (!group || !selected || profile?.profileType !== "community" || !canReadProfile("public", profile) || !await eligibleReference(db, group, profileId) || destination?.kind !== "vrchat_group" || destination.status !== "resolved" || destination.entityId !== group)
    blockReason = "public_primary_reference_required";
  else if (!metadata || metadata.visibility !== "public" || !["request", "invite"].includes(metadata.joinPolicy))
    blockReason = "public_request_or_invite_required";
  else if (observedAt === undefined || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > CURRENT_FRESHNESS_MS)
    blockReason = "metadata_refresh_required";
  else if (rows.length > 100 || policy?.integrationId && !canonical || rows.some(row => readCollectionSubject(row).kind !== "automatic" || row._id !== canonical?._id && row.state !== "disconnected"))
    blockReason = "conflicting_integration";
  else if (policy && policy.decision.kind !== "enabled" || canonical?.killSwitchEnabled)
    blockReason = "observation_stopped";
  else if (!live && canonical && !blockedBeforeMembership && (canonical.assignedCollectorAccountId || canonical.state !== "disconnected" || canonical.statisticsAdmission && (canonical.statisticsAdmission.phase !== "cancelled" || canonical.statisticsAdmission.operation?.outcome === "uncertain")))
    blockReason = "cleanup_required";
  else if (!fleet || fleet.killSwitchEnabled || !Number.isInteger(limit) || !limit || limit < 1 || limit > 50 || fleet.globalRequestsPerMinute <= 0)
    blockReason = "fleet_unavailable";
  else if (!live && reserved.length >= limit)
    blockReason = "automatic_limit";
  else if (!live && managedDue)
    blockReason = "managed_priority";
  else if (!account || !live && !accountHasAdmissionCapacity(account, now))
    blockReason = "account_capacity";
  return { eligible: blockReason === undefined, blockReason, vrchatGroupId: group ?? undefined, groupName: destination?.name, groupMetadata: metadata, metadataObservedAt: observedAt,
    bot: account ? { collectorAccountId: account._id, accountAlias: account.accountAlias, vrchatUserId: account.vrchatUserId, profileUrl: `https://vrchat.com/home/user/${account.vrchatUserId}` } : undefined,
    integrationId: canonical?._id, state: canonical?.state, statisticsAdmission: canonical?.statisticsAdmission, nextPollAt: canonical?.nextPollAt };
}

async function requireStatisticsAdmin(ctx: MutationCtx) {
  const session = await requireActiveBrowserSessionSubject(ctx);
  if (!(await getAccountFeatureAccess(ctx.db, session.userId)).superAdmin)
    throw new Error("Super-admin access is required.");
  return session;
}

export const getStatisticsAdmission = query({
  args: { profileId: v.id("profiles") }, returns: v.union(v.null(), statisticsAdmissionViewValidator),
  handler: async (ctx, args) => {
    const session = await activeBrowserSessionOrNull(ctx);
    if (!session || !(await getAccountFeatureAccess(ctx.db, session.userId)).superAdmin)
      return null;
    return statisticsAdmissionPreview(ctx.db, args.profileId, Date.now());
  },
});

export const refreshStatisticsMetadata = mutation({
  args: { profileId: v.id("profiles") }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireStatisticsAdmin(ctx);
    const profile = await ctx.db.get(args.profileId);
    const group = await readPublicGroupId(ctx.db, args.profileId);
    const key = profile?.primaryGroupReference?.key;
    if (!group || !key || !await eligibleReference(ctx.db, group, args.profileId))
      throw new Error("Public primary group required.");
    const destination = await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", key)).unique();
    if (!destination || destination.kind !== "vrchat_group" || destination.entityId !== group)
      throw new Error("Public primary group required.");
    const now = Date.now();
    if (destination.workDueAt !== undefined || (destination.leaseExpiresAt ?? 0) > now ||
      (destination.retryEligibleAt ?? 0) > now || (destination.observedAt !== undefined && now - destination.observedAt <= CURRENT_FRESHNESS_MS))
      return null;
    await ctx.db.patch(destination._id, { workDueAt: now });
    await syncDestinationQueue(ctx, "vrchat", now);
    return null;
  },
});

export const admitStatistics = mutation({
  args: { profileId: v.id("profiles"), expectedVrchatGroupId: v.string(), expectedCollectorAccountId: v.id("collectorAccounts"), expectedMetadataObservedAt: v.number(), reason: v.string() },
  returns: v.object({ integrationId: v.id("communityVrchatIntegrations"), admissionAt: v.number() }),
  handler: async (ctx, args) => {
    const { subject } = await requireStatisticsAdmin(ctx);
    const now = Date.now();
    const reason = args.reason.trim();
    if (!reason || reason.length > 500)
      throw new Error("Admission reason must contain 1 to 500 characters.");
    const view = await statisticsAdmissionPreview(ctx.db, args.profileId, now);
    if (!view.eligible || !view.bot || view.vrchatGroupId !== args.expectedVrchatGroupId || view.bot.collectorAccountId !== args.expectedCollectorAccountId || view.metadataObservedAt !== args.expectedMetadataObservedAt)
      throw new Error(`Refresh required: ${view.blockReason ?? "preview_changed"}.`);
    const existing = view.integrationId ? await ctx.db.get(view.integrationId) : null;
    if (existing?.statisticsAdmission && admissionMatches(existing, existing.statisticsAdmission.authorizedAt, args.expectedCollectorAccountId))
      return { integrationId: existing._id, admissionAt: existing.statisticsAdmission.authorizedAt };
    const account = await ctx.db.get(args.expectedCollectorAccountId);
    if (!account) throw new Error("Refresh required: account unavailable.");
    const admissionAt = Math.max(now, (existing?.statisticsAdmission?.authorizedAt ?? 0) + 1, (existing?.telemetryEpochStartedAt ?? 0) + 1);
    const joinPolicy = view.groupMetadata?.joinPolicy;
    if (joinPolicy !== "request" && joinPolicy !== "invite")
      throw new Error("Refresh required: join policy changed.");
    const integrationId = existing?._id ?? await ctx.db.insert("communityVrchatIntegrations", {
      collectionScope: { kind: "automatic" }, publicationPolicy: "automatic_aggregate", enabledFeatures: ["analytics"], namedMembershipCollectionEnabled: false,
      vrchatGroupId: args.expectedVrchatGroupId, groupVisibility: "public", joinPolicy, state: "connecting", killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 0,
      publicMetrics: { currentPopulation: true, populationHistory: true, groupMemberCount: true, groupMemberGrowth: true, eventRecaps: false }, consecutiveFailures: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(integrationId, { statisticsAdmission: { authorizedAt: admissionAt, actor: subject, reason, collectorAccountId: account._id, joinPolicy, epochStartedAt: admissionAt, phase: "pending", membershipOrigin: "unknown" },
      collectionScope: { kind: "automatic" }, publicationPolicy: "automatic_aggregate", enabledFeatures: ["analytics"], namedMembershipCollectionEnabled: false,
      assignedCollectorAccountId: account._id, groupVisibility: "public", joinPolicy, state: "connecting", telemetryEpochStartedAt: admissionAt, nextPollAt: now, disconnectedAt: undefined, backoffUntil: undefined, automaticAdmissionAttempt: undefined, updatedAt: now });
    await ctx.db.patch(account._id, { assignedGroupCount: account.assignedGroupCount + 1, updatedAt: now });
    const policy = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", args.expectedVrchatGroupId)).unique();
    if (policy)
      await ctx.db.patch(policy._id, { integrationId, eligibleProfileId: args.profileId, queuedAdmission: undefined, publicHistoryStartAt: admissionAt, updatedAt: now });
    else
      await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: args.expectedVrchatGroupId, integrationId, eligibleProfileId: args.profileId, decision: { kind: "enabled", at: now }, publicHistoryStartAt: admissionAt, createdAt: now, updatedAt: now });
    await ctx.db.insert("communityTelemetryAuditEvents", { integrationId, actor: subject, action: "statistics_admission.authorize", result: "pending", detail: reason, createdAt: now });
    return { integrationId, admissionAt };
  },
});

export const cancelStatisticsAdmission = mutation({
  args: { integrationId: v.id("communityVrchatIntegrations"), admissionAt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { subject } = await requireStatisticsAdmin(ctx);
    const now = Date.now();
    const row = await ctx.db.get(args.integrationId);
    const grant = row?.statisticsAdmission;
    if (!row || !grant || grant.authorizedAt !== args.admissionAt || grant.revokedAt !== undefined)
      return null;
    await revokeStatisticsAdmission(ctx, row, now);
    await ctx.db.insert("communityTelemetryAuditEvents", { integrationId: row._id, actor: subject, action: "statistics_admission.cancel", result: "revoked", createdAt: now });
    return null;
  },
});

async function revokeStatisticsAdmission(ctx: MutationCtx, row: Doc<"communityVrchatIntegrations">, now: number) {
  const grant = row.statisticsAdmission;
  if (!grant || grant.revokedAt !== undefined) return;
  const leases = await ctx.db.query("collectorAccountLeases")
    .withIndex("by_integrationId_state", q => q.eq("integrationId", row._id).eq("state", "active")).take(101);
  if (leases.length > 100) throw new Error("Integration leases require reconciliation.");
  for (const lease of leases) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
  await ctx.db.patch(row._id, {
    statisticsAdmission: { ...grant, revokedAt: now, phase: row.assignedCollectorAccountId ? "cleanup_pending" : "cancelled" },
    // A later verified managed publication choice may supersede cancellation.
    publicationPolicy: "automatic_aggregate",
    leaseGeneration: row.leaseGeneration + 1,
    state: readCollectionSubject(row).kind === "managed" ? row.state : row.assignedCollectorAccountId ? "disconnecting" : "disconnected",
    nextPollAt: row.assignedCollectorAccountId ? now : undefined, updatedAt: now,
  });
}

export const checkStatisticsAdmission = mutation({
  args: { integrationId: v.id("communityVrchatIntegrations"), admissionAt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireStatisticsAdmin(ctx);
    const row = await ctx.db.get(args.integrationId);
    const grant = row?.statisticsAdmission;
    if (!row || !grant || grant.authorizedAt !== args.admissionAt || grant.phase === "cancelled" || !row.assignedCollectorAccountId)
      return null;
    const account = await ctx.db.get(row.assignedCollectorAccountId);
    const now = Date.now();
    await ctx.db.patch(row._id, { nextPollAt: Math.max(now, row.backoffUntil ?? 0, account?.cooldownUntil ?? 0, (row.lastClaimedAt ?? 0) + 60000, (row.lastAttemptAt ?? 0) + 60000), updatedAt: now });
    return null;
  },
});

function groupId(value: string) {
  const id = normalizeVrchatTargetId(value, "vrchat_group");
  if (!id) throw new Error("VRChat group ID is invalid.");
  return id;
}

export async function reconcileStoppedIntegration(ctx: MutationCtx, integration: Doc<"communityVrchatIntegrations">, now: number) {
  const policy = await ctx.db.query("vrchatGroupObservationPolicies")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", integration.vrchatGroupId)).unique();
  if (policy?.decision.kind !== "stopped") return;
  if (integration.statisticsAdmission && readCollectionSubject(integration).kind === "automatic") {
    await revokeStatisticsAdmission(ctx, integration, now);
    return;
  }
  if (["disconnected", "disconnecting"].includes(integration.state)) return;
  if (readCollectionSubject(integration).kind === "managed" && enabledClubFeatures(integration).some(feature => feature !== "analytics")) return;
  await ctx.db.patch(integration._id, {
    state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected",
    nextPollAt: integration.assignedCollectorAccountId ? now : undefined,
    disconnectedAt: integration.assignedCollectorAccountId ? undefined : now,
    leaseGeneration: integration.leaseGeneration + 1, updatedAt: now,
  });
}

async function changeObservationDecision(ctx: MutationCtx, input: {
  vrchatGroupId: string; decision: "stop" | "resume"; republishRetainedHistory?: boolean;
  actor: "verified_operator" | "moderation"; subject: Doc<"communityTelemetryAuditEvents">["actor"]; reason: string;
}) {
  const now = Date.now();
  const registry = await ctx.db.query("vrchatGroupObservationPolicies")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", input.vrchatGroupId)).unique();
  const rows = await ctx.db.query("communityVrchatIntegrations")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", input.vrchatGroupId)).take(101);
  if (rows.length > 100) throw new Error("Group connections require reconciliation.");
  const canonical = registry?.integrationId ? rows.find(row => row._id === registry.integrationId) : rows.length === 1 ? rows[0] : undefined;
  if (input.decision === "resume" && (rows.length && !canonical || rows.some(row => row._id !== canonical?._id && row.state !== "disconnected")))
    throw new Error("Group connections require reconciliation.");
  if (input.decision === "resume" && registry?.decision.kind === "enabled") return null;
  const decision = input.decision === "stop"
    ? { kind: "stopped" as const, actor: input.actor, reason: input.reason, at: now }
    : canonical && readCollectionSubject(canonical).kind === "managed" && !enabledClubFeatures(canonical).includes("analytics")
      ? { kind: "admission_blocked" as const, reason: "analytics_disabled" as const, actor: input.actor, at: now }
      : { kind: "enabled" as const, at: now };
  const values = { decision, queuedAdmission: undefined, updatedAt: now,
    ...(input.decision === "resume" ? { publicHistoryStartAt: input.republishRetainedHistory === true ? 0 : now } : {}) };
  const policyId = registry?._id ?? await ctx.db.insert("vrchatGroupObservationPolicies", {
    vrchatGroupId: input.vrchatGroupId, integrationId: canonical?._id, ...values, createdAt: now,
  });
  if (registry) await ctx.db.patch(registry._id, values);
  // Invalidate the shared group lease, including a standalone request racing stop then resume.
  const metadata = await ctx.db.query("vrchatGroupMemberMetadata")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", input.vrchatGroupId)).unique();
  if (metadata) await ctx.db.patch(metadata._id, { claimToken: undefined, claimExpiresAt: undefined });
  for (const integration of rows) {
    const lease = await ctx.db.query("collectorAccountLeases")
      .withIndex("by_integrationId_state", q => q.eq("integrationId", integration._id).eq("state", "active")).first();
    if (lease) await ctx.db.patch(lease._id, { state: "released", releasedAt: now, updatedAt: now });
    await ctx.db.patch(integration._id, { leaseGeneration: integration.leaseGeneration + 1, updatedAt: now });
    if (input.decision === "stop") {
      await reconcileStoppedIntegration(ctx, { ...integration, leaseGeneration: integration.leaseGeneration + 1 }, now);
      await transitionCoverage(ctx, integration._id, "unknown", now, "first_party", "observation-decision", "observation_stopped");
    } else if (integration._id === canonical?._id) {
      if (integration.statisticsAdmission && readCollectionSubject(integration).kind === "automatic") continue;
      const scope = readCollectionSubject(integration);
      if (["disconnected", "disconnecting"].includes(integration.state)) {
        await ctx.db.patch(integration._id, { state: integration.assignedCollectorAccountId ? "degraded" : "disconnected", disconnectedAt: undefined, nextPollAt: now });
        if (!integration.assignedCollectorAccountId && decision.kind === "enabled") await ctx.db.patch(policyId, {
          queuedAdmission: { priority: scope.kind, queuedAt: now, dueAt: now },
        });
      }
    }
  }
  await ctx.db.insert("communityTelemetryAuditEvents", {
    integrationId: canonical?._id, actor: input.subject, action: `group_observation.${input.decision}`,
    result: input.actor, detail: `${input.vrchatGroupId}:${input.reason}:${input.republishRetainedHistory === true ? "republish_retained" : "new_history"}`, createdAt: now,
  });
  return null;
}

export const setObservationDecision = mutation({
  args: { vrchatGroupId: v.string(), decision: v.union(v.literal("stop"), v.literal("resume")), republishRetainedHistory: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, subject } = await requireActiveBrowserSessionSubject(ctx);
    const vrchatGroupId = groupId(args.vrchatGroupId);
    if (args.decision === "stop" && args.republishRetainedHistory !== undefined) throw new Error("Retained history is only available when resuming.");
    const moderation = (await getAccountFeatureAccess(ctx.db, userId)).superAdmin;
    if (!moderation) await requireControlProof(ctx.db, userId, "vrchat_group", vrchatGroupId, "manager");
    return changeObservationDecision(ctx, { ...args, vrchatGroupId, actor: moderation ? "moderation" : "verified_operator", subject, reason: moderation ? "moderation" : "operator_request" });
  },
});

export const pauseObservation = internalMutation({
  args: { vrchatGroupId: v.string(), reason: v.string(), actor: seedImportAuthSubjectValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason || reason.length > 500) throw new Error("A bounded moderation reason is required.");
    return changeObservationDecision(ctx, { vrchatGroupId: groupId(args.vrchatGroupId), decision: "stop", actor: "moderation", subject: args.actor, reason });
  },
});

export const getObservationDecision = query({
  args: { vrchatGroupId: v.string() },
  returns: v.object({ stopped: v.boolean(), canManage: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    const vrchatGroupId = groupId(args.vrchatGroupId);
    let canManage = (await getAccountFeatureAccess(ctx.db, userId)).superAdmin;
    if (!canManage) {
      try { await requireControlProof(ctx.db, userId, "vrchat_group", vrchatGroupId, "manager"); canManage = true; }
      catch { /* The mutation repeats the exact proof check before changing policy. */ }
    }
    const registry = await ctx.db.query("vrchatGroupObservationPolicies")
      .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", vrchatGroupId)).unique();
    return { stopped: registry?.decision.kind === "stopped", canManage };
  },
});
const reconcileRef = makeFunctionReference<"mutation">("groupObservations:reconcileProfile");
export async function scheduleGroupReconciliation(ctx: MutationCtx, profileId: Id<"profiles">, affectedGroupIds: string[] = []) {
  const links = await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", profileId).eq("assetType", "vrchat_group").eq("state", "active")).take(101);
  const groups = [...new Set([...affectedGroupIds, ...links.map(link => link.assetExternalId)])];
  const profile = await ctx.db.get(profileId);
  if (!groups.length && (!profile || !primaryGroupSelection(profile))) return;
  for (const group of groups) {
    const policy = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", group)).unique();
    if (policy) await ctx.db.patch(policy._id, { referenceRevision: (policy.referenceRevision ?? 0) + 1 });
  }
  await ctx.scheduler.runAfter(0, reconcileRef, { profileId, affectedGroupIds: groups });
}

async function eligibleReference(db: DatabaseReader, group: string, profileId: Id<"profiles"> | undefined) {
  const profile = profileId ? await db.get(profileId) : null;
  if (profile?.profileType !== "community" || !canReadProfile("public", profile) || await readPublicGroupId(db, profile._id) !== group) return null;
  const link = await db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", profile._id).eq("assetType", "vrchat_group").eq("state", "active")).filter(q => q.eq(q.field("linkRole"), "primary")).first();
  if (!link) return null;
  const selected = profile.primaryGroupReference;
  const destination = selected ? await db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", selected.key)).unique() : null;
  const contributorId = selected && destination?.status === "resolved" && destination.entityId === group
    ? selected.contributorUserId : link.provenance ? link.linkedByUserId : undefined;
  return {kind: "eligible", contributorId, profileId: profile._id} as const;
}

export async function statisticsAdmissionDiagnostics(db: DatabaseReader, now: number) {
  const rows = await db.query("communityVrchatIntegrations").withIndex("by_collectionScope_kind_account", q => q.eq("collectionScope.kind", "automatic").gt("assignedCollectorAccountId", undefined)).take(51);
  if (rows.length > 50) {
    const fleet = await db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (freshMonitoring(fleet, now)) return fleet!.admissionMonitoring!.diagnostics;
    return { ...emptyAdmissionDiagnostics(), monitoringIncomplete: true };
  }
  return diagnosticsForRows(db, rows, now);
}

function freshMonitoring(fleet: Doc<"collectorFleetSettings"> | null, now: number) {
  const snapshot = fleet?.admissionMonitoring;
  return !!snapshot && snapshot.configUpdatedAt === fleet?.updatedAt && snapshot.observedAt <= now &&
    now - snapshot.observedAt <= ADMISSION_MONITORING_FRESHNESS_MS;
}

async function diagnosticsForRows(db: DatabaseReader, rows: Doc<"communityVrchatIntegrations">[], now: number) {
  const result = emptyAdmissionDiagnostics();
  for (const row of rows) {
    const grant = row.statisticsAdmission;
    if (!grant) continue;
    result[grant.phase]++;
    const account = row.assignedCollectorAccountId ? await db.get(row.assignedCollectorAccountId) : null;
    const inspectedAt = grant.lastCheckedAt;
    const age = Math.max(0, now - (inspectedAt ?? grant.authorizedAt));
    const externalWait = grant.phase === "pending" && inspectedAt !== undefined && age <= CURRENT_FRESHNESS_MS && row.consecutiveFailures === 0 &&
      (grant.joinPolicy === "invite" || grant.operation?.kind === "request" ||
        row.statisticsAdmissionInspection?.admissionAt === grant.authorizedAt &&
        row.statisticsAdmissionInspection.membership === "requested" &&
        now - row.statisticsAdmissionInspection.observedAt <= CURRENT_FRESHNESS_MS);
    if (externalWait) { result.externalWaiting++; continue; }
    if (grant.phase === "cancelled" || grant.phase === "ended" || grant.phase === "paused") continue;
    const dueAt = Math.max(row.nextPollAt ?? 0, row.backoffUntil ?? 0, account?.cooldownUntil ?? 0);
    const processingAge = Math.max(0, now - (grant.phase === "cleanup_pending" ? grant.revokedAt : grant.phase === "active" ? row.lastSuccessfulObservationAt ?? grant.authorizedAt : grant.authorizedAt));
    if (row.consecutiveFailures >= 3 || processingAge >= 15 * 60_000 && (grant.phase === "cleanup_pending" || dueAt <= now)) {
      result.processingBacklog++;
      result.oldestProcessingAgeMs = Math.max(result.oldestProcessingAgeMs, processingAge);
    }
  }
  return result;
}

export async function hasAutomaticEnrollmentBacklog(db: DatabaseReader, now: number) {
  const fleet = await db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
  const scope = fleet?.automaticEnrollmentScope;
  if (!fleet || !scope || !automaticAdmissionEnabled(fleet, scope.kind === "pilot" ? scope.vrchatGroupId : "")) return false;
  const limit = fleet.automaticEnrollmentLimit ?? 0;
  const active = await db.query("communityVrchatIntegrations").withIndex("by_collectionScope_kind_account", q => q.eq("collectionScope.kind", "automatic").gt("assignedCollectorAccountId", undefined)).take(limit);
  if (active.length >= limit) return false;
  const candidates = scope.kind === "pilot"
    ? [await db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", scope.vrchatGroupId)).unique()]
    : await db.query("vrchatGroupObservationPolicies").withIndex("by_queue_priority_dueAt", q => q.eq("queuedAdmission.priority", "automatic")).take(51);
  if (candidates.length > 50)
    return freshMonitoring(fleet, now) ? fleet.admissionMonitoring!.automaticBacklog : true;
  return candidatesHaveBacklog(db, candidates, now);
}

async function candidatesHaveBacklog(db: DatabaseReader, candidates: (Doc<"vrchatGroupObservationPolicies"> | null)[], now: number) {
  for (const policy of candidates) {
    const queue = policy?.queuedAdmission;
    if (!policy || !queue || queue.priority !== "automatic" || policy.decision.kind !== "enabled" || policy.admissionRequired ||
      queue.queuedAt > now - 15 * 60_000 || queue.reason === "managed_policy") continue;
    if (policy.candidateCountedAt === undefined) {
      const quota = await readCandidateQuota(db, policy.candidateContributorId, now);
      if (quota.admittedAt.length >= quota.limit) continue;
      const admissions = quota.row?.admittedAt ?? [];
      const lastBindingAdmissionAt = admissions[admissions.length - quota.limit];
      if (lastBindingAdmissionAt !== undefined && lastBindingAdmissionAt + DAY > now - 15 * 60_000) continue;
    }
    if (await eligibleReference(db, policy.vrchatGroupId, policy.eligibleProfileId)) return true;
  }
  return false;
}

/** One pagination query per transaction; stale summaries never report healthy. */
export const refreshAdmissionMonitoring = internalMutation({
  args: {
    scan: v.optional(v.object({
      startedAt: v.number(), configUpdatedAt: v.number(), phase: v.union(v.literal("queue"), v.literal("integrations")),
      cursor: v.union(v.string(), v.null()), automaticBacklog: v.boolean(), diagnostics: admissionDiagnosticsValidator,
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fleet = await ctx.db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (!fleet) return null;
    const now = Date.now();
    const scan = args.scan ?? { startedAt: now, configUpdatedAt: fleet.updatedAt, phase: "queue" as const,
      cursor: null, automaticBacklog: false, diagnostics: emptyAdmissionDiagnostics() };
    if (args.scan && (fleet.admissionMonitoringStartedAt !== scan.startedAt || fleet.updatedAt !== scan.configUpdatedAt)) return null;
    if (!args.scan) {
      if (fleet.admissionMonitoringStartedAt !== undefined &&
        fleet.admissionMonitoringStartedAt > (fleet.admissionMonitoring?.observedAt ?? 0) &&
        now - fleet.admissionMonitoringStartedAt < ADMISSION_MONITORING_FRESHNESS_MS) return null;
      await ctx.db.patch(fleet._id, { admissionMonitoringStartedAt: scan.startedAt });
    }
    const continueScan = (next: typeof scan) => ctx.scheduler.runAfter(0,
      makeFunctionReference<"mutation">("groupObservations:refreshAdmissionMonitoring"), { scan: next });
    if (scan.phase === "queue") {
      const page = await ctx.db.query("vrchatGroupObservationPolicies")
        .withIndex("by_queue_priority_dueAt", q => q.eq("queuedAdmission.priority", "automatic"))
        .paginate({ cursor: scan.cursor, numItems: 50 });
      const scope = fleet.automaticEnrollmentScope;
      const inScope = scope?.kind === "pilot" ? page.page.filter(row => row.vrchatGroupId === scope.vrchatGroupId) : page.page;
      const automaticBacklog = scan.automaticBacklog || await candidatesHaveBacklog(ctx.db, inScope, scan.startedAt);
      await continueScan({ ...scan, automaticBacklog, phase: page.isDone ? "integrations" : "queue", cursor: page.isDone ? null : page.continueCursor });
      return null;
    }
    const page = await ctx.db.query("communityVrchatIntegrations")
      .withIndex("by_collectionScope_kind_account", q => q.eq("collectionScope.kind", "automatic").gt("assignedCollectorAccountId", undefined))
      .paginate({ cursor: scan.cursor, numItems: 50 });
    const partial = await diagnosticsForRows(ctx.db, page.page, scan.startedAt);
    const diagnostics = { ...scan.diagnostics };
    for (const key of Object.keys(diagnostics) as (keyof typeof diagnostics)[])
      diagnostics[key] = key === "oldestProcessingAgeMs" ? Math.max(diagnostics[key], partial[key]) : diagnostics[key] + partial[key];
    if (!page.isDone) {
      await continueScan({ ...scan, diagnostics, cursor: page.continueCursor });
    } else {
      await ctx.db.patch(fleet._id, { admissionMonitoring: { observedAt: scan.startedAt,
        configUpdatedAt: scan.configUpdatedAt, automaticBacklog: scan.automaticBacklog, diagnostics } });
    }
    return null;
  },
});

// A full page cannot establish absence; continue in a separate bounded mutation.
async function references(db: DatabaseReader, group: string, hint?: Id<"profiles">) {
  const eligible = await eligibleReference(db, group, hint);
  if (eligible) return eligible;
  const page = await db.query("profileExternalLinks").withIndex("by_assetType_assetExternalId_state", q => q.eq("assetType", "vrchat_group").eq("assetExternalId", group).eq("state", "active")).take(50);
  for (const link of page) {
    if (link.linkRole !== "primary") continue;
    const reference = await eligibleReference(db, group, link.profileId);
    if (reference) return reference;
  }
  if (page.length < 50) return {kind: "none"} as const;
  const last = page[page.length - 1]!;
  return {kind: "unknown", after: {at: last._creationTime, id: last._id}} as const;
}

async function readCandidateQuota(db: DatabaseReader, contributorId: Id<"users"> | undefined, now: number) {
  const key = contributorId ? `user:${contributorId}` : "system_backfill";
  const row = await db.query("groupObservationCandidateLimits").withIndex("by_key", q => q.eq("key", key)).unique();
  const admittedAt = (row?.admittedAt ?? []).filter(at => at > now - DAY);
  const limit = contributorId ? 5 : 50;
  return { key, row, admittedAt, limit };
}

async function candidateQuota(ctx: MutationCtx, contributorId: Id<"users"> | undefined, now: number) {
  const { key, row, admittedAt, limit } = await readCandidateQuota(ctx.db, contributorId, now);
  if (admittedAt.length >= limit) return { allowed: false, dueAt: admittedAt[0]! + DAY };
  admittedAt.push(now);
  if (row) await ctx.db.patch(row._id, { admittedAt });
  else await ctx.db.insert("groupObservationCandidateLimits", { key, admittedAt });
  return { allowed: true, dueAt: now };
}

async function reconcileGroup(ctx: MutationCtx, group: string, now: number, hint?: Id<"profiles">) {
  const policy = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", group)).unique();
  const assignments = await ctx.db.query("communityVrchatIntegrations").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", group)).take(101);
  if (assignments.length > 100) return;
  const managed = assignments.filter(row => readCollectionSubject(row).kind === "managed");
  if (managed.length) return; // Existing managed decisions remain authoritative, including disconnected history.
  const reference = await references(ctx.db, group, hint ?? policy?.eligibleProfileId);
  if (reference.kind === "unknown") {
    await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:scanReferences"), { policyId: policy?._id, vrchatGroupId: group, after: reference.after, revision: policy?.referenceRevision ?? 0 });
    return;
  }
  if (reference.kind === "none") {
    if (policy?.queuedAdmission) await ctx.db.patch(policy._id, { queuedAdmission: undefined, updatedAt: now });
    const integration = policy?.integrationId ? await ctx.db.get(policy.integrationId) : null;
    if (integration?.statisticsAdmission && readCollectionSubject(integration).kind === "automatic") {
      await revokeStatisticsAdmission(ctx, integration, now);
    } else if (integration && readCollectionSubject(integration).kind === "automatic" && !["disconnected", "disconnecting"].includes(integration.state)) {
      await ctx.db.patch(integration._id, { state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected", nextPollAt: integration.assignedCollectorAccountId ? now : undefined, leaseGeneration: integration.leaseGeneration + 1, updatedAt: now });
    }
    return;
  }
  if (policy && policy.eligibleProfileId !== reference.profileId) await ctx.db.patch(policy._id, {eligibleProfileId: reference.profileId});
  if (policy && (policy.decision.kind !== "enabled" || policy.admissionRequired)) return;
  if (policy?.integrationId) {
    const integration = await ctx.db.get(policy.integrationId);
    if (!integration || integration.statisticsAdmission || integration.state !== "disconnected") return;
  }
  if (!policy) {
    const actor = reference.contributorId;
    const quota = await candidateQuota(ctx, actor, now);
    await ctx.db.insert("vrchatGroupObservationPolicies", {
      vrchatGroupId: group, decision: { kind: "enabled", at: now }, candidateContributorId: actor, eligibleProfileId: reference.profileId,
      candidateCountedAt: quota.allowed ? now : undefined,
      queuedAdmission: { priority: "automatic", queuedAt: now, dueAt: quota.dueAt, reason: quota.allowed ? undefined : "contributor_limit" },
      createdAt: now, updatedAt: now,
    });

  } else if (!policy.queuedAdmission) {
    await ctx.db.patch(policy._id, { eligibleProfileId: reference.profileId, queuedAdmission: { priority: "automatic", queuedAt: now, dueAt: now }, updatedAt: now });
  }
}

export const reconcileProfile = internalMutation({
  returns: v.null(),
  args: { profileId: v.id("profiles"), affectedGroupIds: v.array(v.string()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const profile = await ctx.db.get(args.profileId);
    const affected = [...args.affectedGroupIds];
    const directoryLinks = await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", args.profileId).eq("assetType", "vrchat_group").eq("state", "active")).take(101);
    const controlPrimary = directoryLinks.some(link => link.linkRole === "primary" && link.provenance !== "directory_reference");
    const removedPrimary = profile && (!profile.primaryGroupReference || profile.primaryGroupReference.inferred)
      ? await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", args.profileId).eq("assetType", "vrchat_group").eq("state", "removed"))
        .filter(q => q.and(q.eq(q.field("linkRole"), "primary"), q.neq(q.field("removedByReconciliation"), true))).first() : null;
    const reference = profile && !controlPrimary && !removedPrimary ? primaryGroupSelection(profile) : undefined;
    if (profile?.primaryGroupReference?.inferred && profile.primaryGroupReference.contributorUserId !== undefined &&
      profile.inferredGroupContributorUserId !== profile.primaryGroupReference.contributorUserId)
      await ctx.db.patch(profile._id, { inferredGroupContributorUserId: profile.primaryGroupReference.contributorUserId });
    if (profile && (profile.primaryGroupReference?.inferred || reference?.inferred)) {
      if (JSON.stringify(profile.primaryGroupReference) !== JSON.stringify(reference))
        await ctx.db.patch(profile._id, { primaryGroupReference: reference });
    }
    const destination = reference ? await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", reference.key)).unique() : null;
    const resolvedGroup = destination?.status === "resolved" && destination.kind === "vrchat_group" ? destination.entityId : undefined;
    for (const link of directoryLinks) {
      if (link.provenance === "directory_reference" && (!resolvedGroup || link.assetExternalId !== resolvedGroup)) {
        affected.push(link.assetExternalId);
        await ctx.db.patch(link._id, { state: "removed", removedByReconciliation: true, removedAt: now, updatedAt: now });
      }
    }
    if (profile?.profileType === "community" && reference && resolvedGroup && !directoryLinks.some(link => link.assetExternalId === resolvedGroup && link.linkRole === "primary")) {
      await linkProfileToAsset(ctx, { profileId: profile._id, assetType: "vrchat_group", assetExternalId: resolvedGroup, linkRole: "primary", linkedByUserId: reference.contributorUserId, provenance: "directory_reference", now });
    }
    const links = await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", args.profileId).eq("assetType", "vrchat_group").eq("state", "active")).take(101);
    for (const group of new Set([...affected, ...links.map(link => link.assetExternalId)])) {
      await reconcileGroup(ctx, group, now, profile?._id);
    }
    return null;
  },
});

export const admitQueued = internalMutation({
  returns: v.object({admitted: v.number(), deferred: v.number(), admissionRequired: v.number()}),
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = { admitted: 0, deferred: 0, admissionRequired: 0 };
    const fleet = await ctx.db.query("collectorFleetSettings").withIndex("by_key", q => q.eq("key", "global")).unique();
    const queued = [];
    for (const priority of ["managed", "automatic"] as const) {
      const rows = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_queue_priority_dueAt", q => q.eq("queuedAdmission.priority", priority).lte("queuedAdmission.dueAt", now)).take(50 - queued.length);
      queued.push(...rows);
      if (queued.length === 50) break;
    }
    for (const policy of queued) {
      const defer = async (reason: string, dueAt = now + 60_000) => {
        result.deferred++;
        await ctx.db.patch(policy._id, { queuedAdmission: { ...policy.queuedAdmission!, dueAt, reason }, updatedAt: now });
      };
      if (policy.decision.kind !== "enabled" || policy.admissionRequired) {
        await ctx.db.patch(policy._id, { queuedAdmission: undefined });
        if (policy.admissionRequired) result.admissionRequired++;
        continue;
      }
      const automatic = policy.queuedAdmission!.priority === "automatic";
      const existing = policy.integrationId ? await ctx.db.get(policy.integrationId) : null;
      if (automatic && existing?.statisticsAdmission) {
        await ctx.db.patch(policy._id, { queuedAdmission: undefined, updatedAt: now });
        continue;
      }
      if (existing?.killSwitchEnabled) { await defer("integration_stopped"); continue; }
      if (existing?.assignedCollectorAccountId || existing && !["disconnected", "connecting", "awaiting_invite", "awaiting_approval"].includes(existing.state)) {
        await ctx.db.patch(policy._id, { queuedAdmission: undefined }); continue;
      }
      if (automatic) {
        if (!await eligibleReference(ctx.db, policy.vrchatGroupId, policy.eligibleProfileId)) {
          await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:reconcileRegisteredGroup"), {vrchatGroupId: policy.vrchatGroupId});
          await defer("references_pending"); continue;
        }
        const managed = await ctx.db.query("communityVrchatIntegrations").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", policy.vrchatGroupId)).take(101);
        if (managed.length > 100 || managed.some(row => readCollectionSubject(row).kind === "managed")) { await defer("managed_policy"); continue; }
        if (!fleet || !automaticAdmissionEnabled(fleet, policy.vrchatGroupId)) { await defer("admission_disabled"); continue; }
        const active = await ctx.db.query("communityVrchatIntegrations").withIndex("by_collectionScope_kind_account", q => q.eq("collectionScope.kind", "automatic").gt("assignedCollectorAccountId", undefined)).take(fleet.automaticEnrollmentLimit!);
        if (active.length >= fleet.automaticEnrollmentLimit!) { await defer("automatic_limit"); continue; }
        if (policy.candidateCountedAt === undefined) {
          const quota = await candidateQuota(ctx, policy.candidateContributorId, now);
          if (!quota.allowed) { await defer("contributor_limit", quota.dueAt); continue; }
          await ctx.db.patch(policy._id, { candidateCountedAt: now });
        }
      } else if (!existing || readCollectionSubject(existing).kind !== "managed") { await defer("managed_assignment_missing"); continue; }
      if (fleet?.killSwitchEnabled) { await defer("fleet_stopped"); continue; }
      const accounts = await ctx.db.query("collectorAccounts").withIndex("by_state_assignedGroupCount", q => q.eq("state", "ready")).take(100);
      const account = accounts.find(row => accountHasAdmissionCapacity(row, now));
      if (!account) { await defer("capacity"); continue; }
      const integrationId = existing?._id ?? await ctx.db.insert("communityVrchatIntegrations", {
        collectionScope: { kind: "automatic" }, publicationPolicy: "automatic_aggregate", enabledFeatures: ["analytics"], namedMembershipCollectionEnabled: false,
        vrchatGroupId: policy.vrchatGroupId, groupVisibility: "unknown", joinPolicy: "unknown", state: "connecting",
        killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 0, publicMetrics: { currentPopulation: true, populationHistory: true, groupMemberCount: true, groupMemberGrowth: true, eventRecaps: false },
        consecutiveFailures: 0, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(integrationId, { assignedCollectorAccountId: account._id, state: !automatic && existing?.joinPolicy === "invite" ? "awaiting_invite" : "connecting", nextPollAt: now, telemetryEpochStartedAt: existing?.telemetryEpochStartedAt ?? existing?.createdAt ?? now, disconnectedAt: undefined, updatedAt: now });
      await ctx.db.patch(account._id, { assignedGroupCount: account.assignedGroupCount + 1, updatedAt: now });
      await ctx.db.patch(policy._id, { integrationId, queuedAdmission: undefined, updatedAt: now });
      result.admitted++;
    }
    return result;
  },
});

export const reconcilePage = internalMutation({
  returns: v.null(),
  args: { cursor: v.optional(v.union(v.null(), v.string())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("profiles").paginate({ cursor: args.cursor ?? null, numItems: 50 });
    for (const profile of page.page) if (profile.profileType === "community") await scheduleGroupReconciliation(ctx, profile._id);
    if (!page.isDone) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:reconcilePage"), { cursor: page.continueCursor });
    return null;
  },
});

export const reconcileDestination = internalMutation({
  returns: v.null(),
  args: { key: v.string(), cursor: v.optional(v.union(v.null(), v.string())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("profileLinkDestinationReferences").withIndex("by_key_profile", q => q.eq("key", args.key)).paginate({ cursor: args.cursor ?? null, numItems: 50 });
    for (const reference of page.page) await scheduleGroupReconciliation(ctx, reference.profileId);
    if (!page.isDone) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:reconcileDestination"), { key: args.key, cursor: page.continueCursor });
    return null;
  },
});

/** Called only for a provider-confirmed ineligible target before any join. */
export const recordAdmissionRequired = internalMutation({
  returns: v.boolean(),
  args: { integrationId: v.id("communityVrchatIntegrations"), reason: v.union(v.literal("request"), v.literal("invite"), v.literal("private"), v.literal("invalid")), now: v.optional(v.number()) },
  handler: applyAdmissionRequired,
});

export async function applyAdmissionRequired(ctx: MutationCtx, args: {
  integrationId: Id<"communityVrchatIntegrations">;
  reason: "request" | "invite" | "private" | "invalid";
  now?: number;
}) {
    const now = args.now ?? Date.now();
    const integration = await ctx.db.get(args.integrationId);
    if (!integration || readCollectionSubject(integration).kind !== "automatic" || integration.state !== "connecting" || integration.lastSuccessfulObservationAt !== undefined || integration.automaticAdmissionAttempt) return false;
    const policy = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", integration.vrchatGroupId)).unique();
    if (policy?.integrationId !== integration._id) return false;
    const account = integration.assignedCollectorAccountId ? await ctx.db.get(integration.assignedCollectorAccountId) : null;
    if (account) await ctx.db.patch(account._id, {assignedGroupCount: Math.max(0, account.assignedGroupCount - 1), updatedAt: now});
    await ctx.db.patch(integration._id, {state: "blocked", assignedCollectorAccountId: undefined, nextPollAt: undefined, leaseGeneration: integration.leaseGeneration + 1, updatedAt: now});
    await ctx.db.patch(policy._id, {admissionRequired: true, queuedAdmission: undefined, updatedAt: now});
    await ctx.db.insert("communityTelemetryAuditEvents", {integrationId: integration._id, action: "automatic_admission.required", result: args.reason, createdAt: now});
    return true;
}

/** Internal operations access is required; override only this already-attributed candidate. */
export const overrideCandidateLimit = internalMutation({
  returns: v.boolean(),
  args: { vrchatGroupId: v.string(), reason: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!args.reason.trim() || args.reason.length > 200) throw new Error("An audit reason is required.");
    const now = args.now ?? Date.now();
    const policy = await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", args.vrchatGroupId)).unique();
    if (!policy?.queuedAdmission || policy.queuedAdmission.reason !== "contributor_limit" || policy.decision.kind !== "enabled") return false;
    await ctx.db.patch(policy._id, {candidateCountedAt: now, queuedAdmission: {...policy.queuedAdmission, dueAt: now, reason: undefined}, updatedAt: now});
    await ctx.db.insert("communityTelemetryAuditEvents", { action: "automatic_admission.quota_override", result: "overridden", detail: `${args.vrchatGroupId}: ${args.reason.trim()}`, createdAt: now });
    return true;
  },
});

export const reconcileRegistryPage = internalMutation({
  returns: v.null(),
  args: { cursor: v.optional(v.union(v.null(), v.string())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("vrchatGroupObservationPolicies").paginate({cursor: args.cursor ?? null, numItems: 50});
    for (const policy of page.page) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:reconcileRegisteredGroup"), {vrchatGroupId: policy.vrchatGroupId});
    if (!page.isDone) await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:reconcileRegistryPage"), {cursor: page.continueCursor});
    return null;
  },
});
export const reconcileRegisteredGroup = internalMutation({
  returns: v.null(),
  args: { vrchatGroupId: v.string() },
  handler: async (ctx, args) => { await reconcileGroup(ctx, args.vrchatGroupId, Date.now()); return null; },
});
export const scanReferences = internalMutation({
  returns: v.null(),
  args: {policyId: v.optional(v.id("vrchatGroupObservationPolicies")), vrchatGroupId: v.string(), revision: v.number(), after: v.object({at: v.number(), id: v.id("profileExternalLinks")})},
  handler: async (ctx, args) => {
    const policy = args.policyId ? await ctx.db.get(args.policyId) : await ctx.db.query("vrchatGroupObservationPolicies").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", args.vrchatGroupId)).unique();
    if (args.policyId && (!policy || (policy.referenceRevision ?? 0) !== args.revision)) return null;
    if (!args.policyId && policy) return null;
    const boundary = args.after;
    const rows = await ctx.db.query("profileExternalLinks").withIndex("by_assetType_assetExternalId_state", q => q.eq("assetType", "vrchat_group").eq("assetExternalId", args.vrchatGroupId).eq("state", "active").gte("_creationTime", boundary.at))
      .filter(q => q.or(q.gt(q.field("_creationTime"), boundary.at), q.and(q.eq(q.field("_creationTime"), boundary.at), q.gt(q.field("_id"), boundary.id)))).take(50);
    for (const link of rows) {
      const profile = link.linkRole === "primary" ? await ctx.db.get(link.profileId) : null;
      if (profile?.profileType === "community" && canReadProfile("public", profile) && await readPublicGroupId(ctx.db, profile._id) === args.vrchatGroupId) {
        if (policy) await ctx.db.patch(policy._id, {eligibleProfileId: profile._id});
        await reconcileGroup(ctx, args.vrchatGroupId, Date.now(), profile._id);
        return null;
      }
    }
    if (rows.length === 50) {
      const last = rows[rows.length - 1]!;
      await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("groupObservations:scanReferences"), {...args, after: {at: last._creationTime, id: last._id}});
      return null;
    }
    if (!policy) return null;
    const managed = await ctx.db.query("communityVrchatIntegrations").withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", args.vrchatGroupId)).take(101);
    if (managed.length > 100 || managed.some(row => readCollectionSubject(row).kind === "managed")) return null;
    const now = Date.now();
    await ctx.db.patch(policy._id, {queuedAdmission: undefined, eligibleProfileId: undefined, updatedAt: now});
    const integration = policy.integrationId ? await ctx.db.get(policy.integrationId) : null;
    if (integration?.statisticsAdmission && readCollectionSubject(integration).kind === "automatic") {
      await revokeStatisticsAdmission(ctx, integration, now);
    } else if (integration && readCollectionSubject(integration).kind === "automatic" && !["disconnecting", "disconnected"].includes(integration.state)) await ctx.db.patch(integration._id, {state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected", nextPollAt: integration.assignedCollectorAccountId ? now : undefined, leaseGeneration: integration.leaseGeneration + 1, updatedAt: now});
    return null;
  },
});
