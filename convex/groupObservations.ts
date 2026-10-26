import { linkProfileToAsset } from "./_externalControl";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "./_generated/server";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canReadProfile } from "./_profilePermissions";
import { readCollectionSubject, readPublicGroupId } from "./_groupObservationPolicy";

const DAY = 86_400_000;
const reconcileRef = makeFunctionReference<"mutation">("groupObservations:reconcileProfile");
export async function scheduleGroupReconciliation(ctx: MutationCtx, profileId: Id<"profiles">, affectedGroupIds: string[] = []) {
  const links = await ctx.db.query("profileExternalLinks").withIndex("by_profileId_assetType_state", q => q.eq("profileId", profileId).eq("assetType", "vrchat_group").eq("state", "active")).take(101);
  const groups = [...new Set([...affectedGroupIds, ...links.map(link => link.assetExternalId)])];
  const profile = await ctx.db.get(profileId);
  if (!groups.length && !profile?.primaryGroupReference) return;
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

async function candidateQuota(ctx: MutationCtx, contributorId: Id<"users"> | undefined, now: number) {
  const key = contributorId ? `user:${contributorId}` : "system_backfill";
  const row = await ctx.db.query("groupObservationCandidateLimits").withIndex("by_key", q => q.eq("key", key)).unique();
  const admittedAt = (row?.admittedAt ?? []).filter(at => at > now - DAY);
  const limit = contributorId ? 5 : 50;
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
    if (integration && readCollectionSubject(integration).kind === "automatic" && !["disconnected", "disconnecting"].includes(integration.state)) {
      await ctx.db.patch(integration._id, { state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected", nextPollAt: integration.assignedCollectorAccountId ? now : undefined, leaseGeneration: integration.leaseGeneration + 1, updatedAt: now });
    }
    return;
  }
  if (policy && policy.eligibleProfileId !== reference.profileId) await ctx.db.patch(policy._id, {eligibleProfileId: reference.profileId});
  if (policy && (policy.decision.kind !== "enabled" || policy.admissionRequired)) return;
  if (policy?.integrationId) {
    const integration = await ctx.db.get(policy.integrationId);
    if (!integration || integration.state !== "disconnected") return;
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
    const reference = profile?.primaryGroupReference;
    const destination = reference ? await ctx.db.query("profileLinkDestinations").withIndex("by_key", q => q.eq("key", reference.key)).unique() : null;
    const resolvedGroup = destination?.status === "resolved" && destination.kind === "vrchat_group" ? destination.entityId : undefined;
    for (const link of directoryLinks) {
      if (link.provenance === "directory_reference" && (!resolvedGroup || link.assetExternalId !== resolvedGroup)) {
        affected.push(link.assetExternalId);
        await ctx.db.patch(link._id, { state: "removed", removedAt: now, updatedAt: now });
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
        if (!fleet?.automaticEnrollmentEnabled || !fleet.automaticEnrollmentScope || !(fleet.automaticEnrollmentLimit! > 0) || (fleet.automaticEnrollmentScope.kind === "pilot" && fleet.automaticEnrollmentScope.vrchatGroupId !== policy.vrchatGroupId)) { await defer("admission_disabled"); continue; }
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
      const account = accounts.find(row => !row.killSwitchEnabled && (row.cooldownUntil ?? 0) <= now && row.assignedGroupCount < row.capacity - row.reservedHeadroom);
      if (!account) { await defer("capacity"); continue; }
      const integrationId = existing?._id ?? await ctx.db.insert("communityVrchatIntegrations", {
        collectionScope: { kind: "automatic" }, publicationPolicy: "automatic_aggregate", enabledFeatures: ["analytics"],
        vrchatGroupId: policy.vrchatGroupId, groupVisibility: "unknown", joinPolicy: "unknown", state: "connecting",
        killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 0, publicMetrics: { currentPopulation: true, populationHistory: true, groupMemberCount: true, groupMemberGrowth: true, eventRecaps: false },
        consecutiveFailures: 0, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(integrationId, { assignedCollectorAccountId: account._id, state: !automatic && existing?.joinPolicy === "invite" ? "awaiting_invite" : "connecting", nextPollAt: now, telemetryEpochStartedAt: now, disconnectedAt: undefined, updatedAt: now });
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
    if (!integration || readCollectionSubject(integration).kind !== "automatic" || integration.state !== "connecting" || integration.lastSuccessfulObservationAt !== undefined) return false;
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
    if (integration && readCollectionSubject(integration).kind === "automatic" && !["disconnecting", "disconnected"].includes(integration.state)) await ctx.db.patch(integration._id, {state: integration.assignedCollectorAccountId ? "disconnecting" : "disconnected", nextPollAt: integration.assignedCollectorAccountId ? now : undefined, leaseGeneration: integration.leaseGeneration + 1, updatedAt: now});
    return null;
  },
});
