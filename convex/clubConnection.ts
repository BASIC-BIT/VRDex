import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  resolveClubActor,
  requireClubPermission,
  activeClubRoles,
} from "./_clubAccess";
import {
  FEATURES,
  FEATURE_BASELINE,
  integrationFeature,
  ownMemberAuthority,
  currentClubAuthority,
  enabledClubFeatures,
} from "./_clubConnection";
import { PROVIDER_AUTHORITY_MAX_AGE_MS } from "./_clubOperationPolicy";
async function access(ctx: QueryCtx | MutationCtx, id: Id<"profiles">) {
  const profile = await ctx.db.get(id);
  if (profile?.profileType !== "community") throw new Error("Club not found.");
  const actor = await resolveClubActor(ctx, id);
  requireClubPermission(actor, "manage_integrations");
  return actor;
}
export const get = query({
  args: { communityProfileId: v.id("profiles") },
  returns: v.union(
    v.null(),
    v.object({
      integrationId: v.id("communityVrchatIntegrations"),
      enabledFeatures: v.array(integrationFeature),
      authority: v.union(v.null(), ownMemberAuthority),
      features: v.array(
        v.object({
          feature: integrationFeature,
          enabled: v.boolean(),
          ready: v.boolean(),
          missingPermissions: v.array(v.string()),
        }),
      ),
      roles: v.array(
        v.object({
          roleId: v.id("communityRoles"),
          label: v.string(),
          providerRoleIds: v.array(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .unique();
    if (!integration) return null;
    const account = integration.assignedCollectorAccountId
      ? await ctx.db.get(integration.assignedCollectorAccountId)
      : null;
    const fleet = await ctx.db
      .query("collectorFleetSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    const authority = currentClubAuthority(integration, account, Date.now());
    const enabledFeatures = enabledClubFeatures(integration);
    const active =
      integration.state === "active" &&
      !integration.killSwitchEnabled &&
      !account?.killSwitchEnabled &&
      !fleet?.killSwitchEnabled &&
      (account?.state === "ready" || account?.state === "degraded");
    return {
      integrationId: integration._id,
      enabledFeatures,
      authority,
      features: FEATURES.map((feature) => {
        const missingPermissions = FEATURE_BASELINE[feature].filter(
          (p) =>
            !authority?.permissions.includes("*") &&
            !authority?.permissions.includes(p),
        );
        return {
          feature,
          enabled: enabledFeatures.includes(feature),
          ready:
            active &&
            enabledFeatures.includes(feature) &&
            authority?.membershipStatus === "member" &&
            missingPermissions.length === 0,
          missingPermissions,
        };
      }),
      roles: (await activeClubRoles(ctx.db, args.communityProfileId)).map(
        (r) => ({
          roleId: r._id,
          label: r.label,
          providerRoleIds: r.permittedProviderRoleIds ?? [],
        }),
      ),
    };
  },
});
export const setFeatures = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    enabledFeatures: v.array(integrationFeature),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    if (args.enabledFeatures.length > 4)
      throw new Error("Invalid feature selection.");
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .unique();
    if (!integration) throw new Error("Connect a group first.");
    await ctx.db.patch(integration._id, {
      enabledFeatures: FEATURES.filter((f) => args.enabledFeatures.includes(f)),
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const setProviderRoleAllowlist = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    roleId: v.id("communityRoles"),
    providerRoleIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await access(ctx, args.communityProfileId);
    if (actor.kind !== "owner")
      throw new Error("Only the owner can configure provider roles.");
    const role = await ctx.db.get(args.roleId);
    if (
      !role ||
      role.communityProfileId !== args.communityProfileId ||
      role.state !== "active"
    )
      throw new Error("Role not found.");
    if (
      args.providerRoleIds.length > 100 ||
      args.providerRoleIds.some((id) => !/^grol_[a-f0-9-]{36}$/i.test(id))
    )
      throw new Error("Invalid provider role IDs.");
    await ctx.db.patch(role._id, {
      permittedProviderRoleIds: [...new Set(args.providerRoleIds)],
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const recordAuthority = internalMutation({
  args: {
    collectorAccountId: v.id("collectorAccounts"),
    workerKeyHash: v.string(),
    workerId: v.string(),
    fencingToken: v.number(),
    integrationId: v.id("communityVrchatIntegrations"),
    epochStartedAt: v.number(),
    authority: ownMemberAuthority,
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const [account, integration, fleet] = await Promise.all([
      ctx.db.get(args.collectorAccountId),
      ctx.db.get(args.integrationId),
      ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
    ]);
    if (
      !account ||
      !integration ||
      account.workerKeyHash !== args.workerKeyHash ||
      account.killSwitchEnabled ||
      fleet?.killSwitchEnabled ||
      !["ready", "degraded"].includes(account.state) ||
      integration.killSwitchEnabled ||
      !["active", "degraded"].includes(integration.state) ||
      integration.assignedCollectorAccountId !== account._id ||
      args.epochStartedAt !==
        (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
      args.authority.groupId !== integration.vrchatGroupId ||
      args.authority.userId !== account.vrchatUserId ||
      !Number.isFinite(args.authority.observedAt) ||
      args.authority.observedAt > now ||
      now - args.authority.observedAt > PROVIDER_AUTHORITY_MAX_AGE_MS ||
      args.authority.permissions.length > 100 ||
      args.authority.permissions.some((p) => p.length > 100) ||
      args.authority.membershipStatus.length > 64
    )
      return { recorded: false };
    const lease = await ctx.db
      .query("collectorAccountLeases")
      .withIndex("by_integrationId_state", (q) =>
        q.eq("integrationId", integration._id).eq("state", "active"),
      )
      .unique();
    if (
      !lease ||
      lease.collectorAccountId !== account._id ||
      lease.workerId !== args.workerId ||
      lease.fencingToken !== args.fencingToken ||
      lease.expiresAt <= now
    )
      return { recorded: false };
    const previous = currentClubAuthority(integration, account, now);
    if (previous && previous.observedAt > args.authority.observedAt)
      return { recorded: false };
    await ctx.db.patch(integration._id, {
      providerAuthority: {
        authority: {
          ...args.authority,
          permissions: [...new Set(args.authority.permissions)],
        },
        collectorAccountId: account._id,
        credentialGeneration: account.credentialGeneration,
        epochStartedAt: args.epochStartedAt,
        receivedAt: now,
      },
    });
    return { recorded: true };
  },
});
