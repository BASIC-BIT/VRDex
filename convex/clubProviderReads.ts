import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import {
  resolveClubActor,
  resolveClubSubject,
  requireClubPermission,
  activeClubRoles,
} from "./_clubAccess";
import {
  enabledClubFeatures,
  ownMemberAuthority,
  currentClubAuthority,
} from "./_clubConnection";
import {
  providerReadParams,
  providerReadPage,
  checkedReadParams,
  readRequirement,
  READ_FRESH_MS,
  READ_RETENTION_MS,
} from "./_clubProviderReads";

/** Member workspace context without collector configuration or raw provider grants. */
export const context = query({
  args: { communityProfileId: v.id("profiles") },
  returns: v.object({
    enabledFeatures: v.array(v.string()),
    permittedProviderRoleIds: v.array(v.string()),
    protectedUserIds: v.array(v.string()),
    assignedBot: v.union(
      v.object({ userId: v.string(), profileUrl: v.string() }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const actor = await resolveClubActor(ctx, args.communityProfileId);
    if (
      actor.kind === "none" ||
      (actor.kind !== "owner" &&
        ![
          "view_members",
          "approve_join_requests",
          "invite_group_members",
          "assign_vrchat_roles",
          "remove_group_members",
          "manage_bans",
          "manage_instances",
          "publish_posts",
        ].some((p) => actor.permissions.some((held) => held === p)))
    )
      throw new Error("You do not have access to this page.");
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .unique();
    if (!integration)
      return {
        enabledFeatures: [],
        permittedProviderRoleIds: [],
        protectedUserIds: [],
        assignedBot: null,
      };
    const account = integration.assignedCollectorAccountId
      ? await ctx.db.get(integration.assignedCollectorAccountId)
      : null;
    const authority = currentClubAuthority(integration, account, Date.now());
    const roles = await activeClubRoles(ctx.db, args.communityProfileId);
    return {
      enabledFeatures: enabledClubFeatures(integration),
      assignedBot: account
        ? {
            userId: account.vrchatUserId,
            profileUrl: `https://vrchat.com/home/user/${encodeURIComponent(account.vrchatUserId)}`,
          }
        : null,
      permittedProviderRoleIds: [
        ...new Set(
          roles
            .filter((role) => actor.roleIds.includes(role._id))
            .flatMap((role) => role.permittedProviderRoleIds ?? []),
        ),
      ],
      protectedUserIds: [
        ...new Set(
          [account?.vrchatUserId, authority?.ownerUserId].filter(
            (id): id is string => !!id,
          ),
        ),
      ],
    };
  },
});

export const listEvents = query({
  args: {
    communityProfileId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("events"),
        title: v.string(),
        startAt: v.number(),
        status: v.string(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await resolveClubActor(ctx, args.communityProfileId);
    if (
      actor.kind !== "owner" &&
      ![
        "manage_events",
        "manage_instances",
        "publish_posts",
        "approve_join_requests",
        "invite_group_members",
        "assign_vrchat_roles",
        "remove_group_members",
        "manage_bans",
      ].some((p) => actor.permissions.some((held) => held === p))
    )
      throw new Error("You do not have access to this page.");
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid page size.");
    const result = await ctx.db
      .query("events")
      .withIndex("by_communityProfileId_startAt", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map((event) => ({
        id: event._id,
        title: event.title,
        startAt: event.startAt,
        status: event.eventStatus,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const worker = {
  collectorAccountId: v.id("collectorAccounts"),
  workerKeyHash: v.string(),
  workerId: v.string(),
  fencingToken: v.number(),
  integrationId: v.id("communityVrchatIntegrations"),
  epochStartedAt: v.number(),
};
type WorkerArgs = {
  collectorAccountId: Id<"collectorAccounts">;
  workerKeyHash: string;
  workerId: string;
  fencingToken: number;
  integrationId: Id<"communityVrchatIntegrations">;
  epochStartedAt: number;
};
async function integrationFor(ctx: QueryCtx | MutationCtx, id: Id<"profiles">) {
  const integration = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) => q.eq("communityProfileId", id))
    .unique();
  if (
    !integration ||
    !["active", "degraded"].includes(integration.state) ||
    integration.killSwitchEnabled
  )
    throw new Error("Group connection unavailable.");
  return integration;
}
async function currentReadAccount(
  ctx: QueryCtx | MutationCtx,
  integration: Doc<"communityVrchatIntegrations">,
) {
  const account = integration.assignedCollectorAccountId
    ? await ctx.db.get(integration.assignedCollectorAccountId)
    : null;
  const fleet = await ctx.db
    .query("collectorFleetSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  if (
    !account ||
    account.killSwitchEnabled ||
    fleet?.killSwitchEnabled ||
    account.state !== "ready"
  )
    throw new Error("Read access expired.");
  return account;
}
async function checkWorker(ctx: MutationCtx, args: WorkerArgs) {
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
    account.state !== "ready" ||
    integration.killSwitchEnabled ||
    !["active", "degraded"].includes(integration.state) ||
    integration.assignedCollectorAccountId !== account._id ||
    args.epochStartedAt !==
      (integration.telemetryEpochStartedAt ?? integration.createdAt)
  )
    throw new Error("Invalid worker lease.");
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
    lease.expiresAt <= Date.now()
  )
    throw new Error("Invalid worker lease.");
  return { account, integration };
}
async function checkRequestActor(
  ctx: MutationCtx,
  row: Doc<"clubProviderReadRequests">,
  integration: Doc<"communityVrchatIntegrations">,
) {
  const actor = await resolveClubSubject(
    ctx.db,
    row.communityProfileId,
    row.subject,
  );
  const requirement = readRequirement(row.params.kind);
  requireClubPermission(actor, requirement.permission);
  if (
    row.expiresAt <= Date.now() ||
    row.integrationId !== integration._id ||
    row.epochStartedAt !==
      (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
    !enabledClubFeatures(integration).includes(requirement.feature)
  )
    throw new Error("Read access expired.");
  return requirement;
}
export const request = mutation({
  args: { communityProfileId: v.id("profiles"), params: providerReadParams },
  returns: v.id("clubProviderReadRequests"),
  handler: async (ctx, args) => {
    const params = checkedReadParams(args.params);
    const actor = await resolveClubActor(ctx, args.communityProfileId);
    const requirement = readRequirement(params.kind);
    requireClubPermission(actor, requirement.permission);
    if (!actor.subject) throw new Error("Sign in required.");
    const integration = await integrationFor(ctx, args.communityProfileId);
    if (!enabledClubFeatures(integration).includes(requirement.feature))
      throw new Error("Feature is disabled.");
    if (
      params.kind === "invitation_eligibility" &&
      params.instanceId !== undefined
    ) {
      const groups = [...params.instanceId.matchAll(/~group\(([^)]+)\)/g)];
      if (
        /[\s:/?#\\%]/.test(params.instanceId) ||
        groups.length !== 1 ||
        groups[0][1] !== integration.vrchatGroupId
      )
        throw new Error("Invitation destination belongs to another group.");
    }
    const account = await currentReadAccount(ctx, integration);
    const now = Date.now(),
      epochStartedAt =
        integration.telemetryEpochStartedAt ?? integration.createdAt;
    const requestKey = JSON.stringify([
      integration._id,
      epochStartedAt,
      params,
      account._id,
      account.credentialGeneration,
    ]);
    const existing = await ctx.db
      .query("clubProviderReadRequests")
      .withIndex("by_subject_key_createdAt", (q) =>
        q
          .eq("subject.tokenIdentifier", actor.subject!.tokenIdentifier)
          .eq("requestKey", requestKey)
          .gte("createdAt", now - READ_FRESH_MS),
      )
      .order("desc")
      .first();
    if (existing && existing.state !== "failed") {
      if (existing.state === "pending")
        await ctx.db.patch(integration._id, {
          nextPollAt: Math.min(integration.nextPollAt ?? now, now),
        });
      return existing._id;
    }
    const recent = await ctx.db
      .query("clubProviderReadRequests")
      .withIndex("by_subject_createdAt", (q) =>
        q
          .eq("subject.tokenIdentifier", actor.subject!.tokenIdentifier)
          .gte("createdAt", now - 60_000),
      )
      .take(51);
    if (recent.length >= 50)
      throw new Error("Too many refresh requests. Try again shortly.");
    const id = await ctx.db.insert("clubProviderReadRequests", {
      communityProfileId: args.communityProfileId,
      integrationId: integration._id,
      subject: actor.subject,
      params,
      requestKey,
      epochStartedAt,
      state: "pending",
      createdAt: now,
      expiresAt: now + READ_RETENTION_MS,
    });
    await ctx.db.patch(integration._id, {
      nextPollAt: Math.min(integration.nextPollAt ?? now, now),
    });
    await ctx.scheduler.runAfter(
      READ_RETENTION_MS,
      internal.clubProviderReads.expire,
      { requestId: id },
    );
    return id;
  },
});
export const get = query({
  args: {
    requestId: v.id("clubProviderReadRequests"),
    // A new attempt must evaluate server time instead of reusing a cached query.
    freshnessNonce: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      state: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
      ),
      result: v.union(providerReadPage, v.null()),
      errorCode: v.union(v.string(), v.null()),
      fresh: v.boolean(),
      remainingFreshMs: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db.get(args.requestId);
    if (!row || row.expiresAt <= now) return null;
    const actor = await resolveClubActor(ctx, row.communityProfileId);
    requireClubPermission(actor, readRequirement(row.params.kind).permission);
    if (actor.subject?.tokenIdentifier !== row.subject.tokenIdentifier)
      throw new Error("Read request not found.");
    const integration = await integrationFor(ctx, row.communityProfileId);
    if (row.result) {
      const account = await currentReadAccount(ctx, integration);
      if (
        account._id !== row.collectorAccountId ||
        account.credentialGeneration !== row.credentialGeneration
      )
        throw new Error("Read access expired.");
    }
    if (
      row.integrationId !== integration._id ||
      row.epochStartedAt !==
        (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
      !enabledClubFeatures(integration).includes(
        readRequirement(row.params.kind).feature,
      )
    )
      throw new Error("Read access expired.");
    const remainingFreshMs =
      row.state === "succeeded" && row.result && row.result.observedAt <= now
        ? Math.max(0, row.result.observedAt + READ_FRESH_MS - now)
        : 0;
    return {
      state: row.state,
      result: row.result ?? null,
      errorCode: row.errorCode ?? null,
      fresh: remainingFreshMs > 0,
      remainingFreshMs,
    };
  },
});
export const claim = internalMutation({
  args: worker,
  returns: v.union(
    v.null(),
    v.object({
      requestId: v.id("clubProviderReadRequests"),
      claimToken: v.string(),
      params: providerReadParams,
      groupId: v.string(),
      expectedUserId: v.string(),
      enabledFeatures: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { account, integration } = await checkWorker(ctx, args);
    const running = await ctx.db
      .query("clubProviderReadRequests")
      .withIndex("by_integration_state_createdAt", (q) =>
        q.eq("integrationId", integration._id).eq("state", "running"),
      )
      .take(20);
    const stale = running.filter(
      (row) =>
        row.collectorAccountId !== account._id ||
        row.credentialGeneration !== account.credentialGeneration ||
        row.workerId !== args.workerId ||
        row.fencingToken !== args.fencingToken ||
        (row.claimedAt ?? 0) < Date.now() - READ_FRESH_MS,
    );
    const pending = await ctx.db
      .query("clubProviderReadRequests")
      .withIndex("by_integration_state_createdAt", (q) =>
        q.eq("integrationId", integration._id).eq("state", "pending"),
      )
      .take(20);
    const rows = [...stale, ...pending];
    for (const row of rows) {
      try {
        await checkRequestActor(ctx, row, integration);
      } catch {
        await ctx.db.patch(row._id, {
          state: "failed",
          errorCode: "access_expired",
        });
        continue;
      }
      const claimToken = crypto.randomUUID();
      await ctx.db.patch(row._id, {
        state: "running",
        collectorAccountId: account._id,
        credentialGeneration: account.credentialGeneration,
        workerId: args.workerId,
        fencingToken: args.fencingToken,
        claimToken,
        claimedAt: Date.now(),
      });
      return {
        requestId: row._id,
        claimToken,
        params: row.params,
        groupId: integration.vrchatGroupId,
        expectedUserId: account.vrchatUserId,
        enabledFeatures: enabledClubFeatures(integration),
      };
    }
    return null;
  },
});
export const complete = internalMutation({
  args: {
    ...worker,
    requestId: v.id("clubProviderReadRequests"),
    claimToken: v.string(),
    authority: v.optional(ownMemberAuthority),
    result: v.optional(providerReadPage),
    errorCode: v.optional(v.string()),
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const { account, integration } = await checkWorker(ctx, args);
    const row = await ctx.db.get(args.requestId);
    if (
      !row ||
      row.state !== "running" ||
      row.claimToken !== args.claimToken ||
      row.collectorAccountId !== account._id ||
      row.credentialGeneration !== account.credentialGeneration ||
      row.workerId !== args.workerId ||
      row.fencingToken !== args.fencingToken ||
      row.integrationId !== integration._id
    )
      return { recorded: false };
    let requirement;
    try {
      requirement = await checkRequestActor(ctx, row, integration);
    } catch {
      await ctx.db.patch(row._id, {
        state: "failed",
        errorCode: "access_expired",
      });
      return { recorded: false };
    }
    const now = Date.now(),
      authority = args.authority;
    if (args.result) {
      if (
        !authority ||
        authority.groupId !== integration.vrchatGroupId ||
        authority.userId !== account.vrchatUserId ||
        authority.membershipStatus !== "member" ||
        !Number.isFinite(authority.observedAt) ||
        authority.observedAt > now ||
        now - authority.observedAt > READ_FRESH_MS ||
        requirement.grants.some(
          (p) =>
            !authority.permissions.includes("*") &&
            !authority.permissions.includes(p),
        )
      )
        throw new Error("Provider read authority invalid.");
      const result = args.result;
      if (row.params.kind === "invitation_eligibility") {
        const item = result.items[0];
        if (
          result.items.length !== 1 ||
          result.nextOffset !== null ||
          item.id !== row.params.userId ||
          item.userId !== row.params.userId ||
          !item.friendship ||
          !item.destinationState ||
          (row.params.worldId === undefined) !==
            (item.destinationState === "pending") ||
          item.invitationEligibility !==
            (item.friendship === "not_friend"
              ? "not_friend"
              : item.destinationState === "pending"
                ? "destination_pending"
                : item.destinationState === "closed"
                  ? "destination_closed"
                  : "eligible")
        )
          throw new Error("Invalid eligibility result.");
      }
      if (
        result.items.length > row.params.n ||
        !Number.isFinite(result.observedAt) ||
        result.observedAt > now ||
        now - result.observedAt > READ_FRESH_MS ||
        JSON.stringify(result).length > 500_000 ||
        (result.nextOffset !== null &&
          (result.items.length === 0 ||
            result.nextOffset !== row.params.offset + result.items.length))
      )
        throw new Error("Invalid provider page.");
      await ctx.db.patch(row._id, { state: "succeeded", result });
    } else {
      const code =
        args.errorCode && /^[a-z_]{1,64}$/.test(args.errorCode)
          ? args.errorCode
          : "provider_read_failed";
      await ctx.db.patch(row._id, { state: "failed", errorCode: code });
    }
    return { recorded: true };
  },
});
export const expire = internalMutation({
  args: { requestId: v.id("clubProviderReadRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(row._id);
    return null;
  },
});
