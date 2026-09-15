import { v } from "convex/values";
import { recordClubOperationFailure } from "./_clubNotifications";
import { syncClubEventOperationPage } from "./_clubOperationEvents";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  resolveClubActor,
  resolveClubSubject,
  requireClubPermission,
  activeClubRoles,
  type ClubActor,
} from "./_clubAccess";
import { clubSubject } from "./_clubModel";
import { ownMemberAuthority, enabledClubFeatures } from "./_clubConnection";
import {
  assessClubOperation,
  clubOperationRequirement,
} from "./_clubOperationPolicy";
import {
  clubOperationPayload,
  operationSchedule,
  operationState,
  policyOperation,
  validatePayload,
  LATE_GRACE_MS,
  CLAIM_MS,
  type OperationPayload,
} from "./_clubOperations";
async function patchOperation(
  ctx: MutationCtx,
  id: Id<"clubOperations">,
  patch: Partial<Doc<"clubOperations">>,
) {
  await ctx.db.patch(id, patch);
  await recordClubOperationFailure(ctx, id);
}
const worker = {
  epochStartedAt: v.number(),
  collectorAccountId: v.id("collectorAccounts"),
  workerKeyHash: v.string(),
  workerId: v.string(),
  fencingToken: v.number(),
  integrationId: v.id("communityVrchatIntegrations"),
};
type Worker = {
  epochStartedAt: number;
  collectorAccountId: Id<"collectorAccounts">;
  workerKeyHash: string;
  workerId: string;
  fencingToken: number;
  integrationId: Id<"communityVrchatIntegrations">;
};
async function binding(ctx: MutationCtx, args: Worker) {
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
    args.epochStartedAt !==
      (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
    account.workerKeyHash !== args.workerKeyHash ||
    account.killSwitchEnabled ||
    integration.killSwitchEnabled ||
    fleet?.killSwitchEnabled ||
    !["ready", "degraded"].includes(account.state) ||
    !["active", "degraded"].includes(integration.state) ||
    integration.assignedCollectorAccountId !== account._id
  )
    return null;
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
    return null;
  return { account, integration, lease };
}
function human(actor: ClubActor, payload: OperationPayload) {
  requireClubPermission(
    actor,
    clubOperationRequirement(policyOperation(payload, "unknown")).permission,
  );
  if (!actor.subject) throw new Error("Sign in required.");
  return actor.subject;
}
function editPermission(actor: ClubActor, job: Doc<"clubOperations">) {
  human(actor, job.payload);
  if (
    actor.kind !== "owner" &&
    actor.subject?.tokenIdentifier !== job.actor.tokenIdentifier
  )
    requireClubPermission(actor, "manage_scheduled_actions");
}
export function canManageClubOperation(
  actor: ClubActor,
  job: Doc<"clubOperations">,
) {
  try {
    editPermission(actor, job);
    return true;
  } catch {
    return false;
  }
}
async function effectiveDueAt(ctx: MutationCtx, job: Doc<"clubOperations">) {
  if (job.schedule.kind !== "event_relative") return job.dueAt;
  const event = await ctx.db.get(job.schedule.eventId);
  return event ? event.startAt + job.schedule.offsetMs : job.dueAt;
}
async function dependencyTimingChanged(
  ctx: MutationCtx,
  job: Doc<"clubOperations">,
) {
  if (job.payload.kind !== "invite_to_created_instance") return false;
  const dependency = await ctx.db.get(job.payload.creationOperationId);
  return (
    !!dependency &&
    (await effectiveDueAt(ctx, dependency)) > (await effectiveDueAt(ctx, job))
  );
}
async function scheduleTime(
  ctx: MutationCtx,
  communityProfileId: Id<"profiles">,
  schedule: Doc<"clubOperations">["schedule"],
) {
  const now = Date.now();
  let dueAt: number;
  if (
    schedule.kind === "event_relative" &&
    (!Number.isSafeInteger(schedule.offsetMs) ||
      Math.abs(schedule.offsetMs) > 365 * 86400_000)
  )
    throw new Error("Invalid event offset.");
  const event = schedule.eventId ? await ctx.db.get(schedule.eventId) : null;
  if (
    schedule.eventId &&
    (!event ||
      event.communityProfileId !== communityProfileId ||
      event.eventStatus === "cancelled")
  )
    throw new Error("Event unavailable for this club.");
  dueAt =
    schedule.kind === "fixed"
      ? schedule.dueAt
      : event!.startAt + schedule.offsetMs;
  if (
    !Number.isSafeInteger(dueAt) ||
    dueAt < now - LATE_GRACE_MS ||
    dueAt > now + 366 * 86400_000
  )
    throw new Error("Invalid execution time.");
  return dueAt;
}
export const enqueue = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    requestId: v.string(),
    payloads: v.array(clubOperationPayload),
    schedule: operationSchedule,
  },
  returns: v.array(v.id("clubOperations")),
  handler: enqueueClubOperations,
});
async function checkedDependency(
  ctx: MutationCtx,
  integration: Doc<"communityVrchatIntegrations">,
  payload: OperationPayload,
  eventId?: Id<"events">,
) {
  if (payload.kind !== "invite_to_created_instance") return null;
  const dependency = await ctx.db.get(payload.creationOperationId);
  if (
    !dependency ||
    dependency.integrationId !== integration._id ||
    dependency.epochStartedAt !==
      (integration.telemetryEpochStartedAt ?? integration.createdAt) ||
    dependency.payload.kind !== "create_instance" ||
    ["rejected", "indeterminate", "cancelled", "missed"].includes(
      dependency.state,
    )
  )
    throw new Error("Instance creation is unavailable.");
  if (eventId && dependency.eventId && eventId !== dependency.eventId)
    throw new Error("Instance creation belongs to another event.");
  return dependency;
}
async function resolvedOperation(
  ctx: MutationCtx,
  job: Doc<"clubOperations">,
  integration: Doc<"communityVrchatIntegrations">,
): Promise<
  | { status: "ready"; payload: OperationPayload }
  | { status: "pending" | "rejected"; code: string }
> {
  if (job.payload.kind !== "invite_to_created_instance")
    return { status: "ready", payload: job.payload };
  const dependency = await ctx.db.get(job.payload.creationOperationId);
  if (
    !dependency ||
    dependency.integrationId !== job.integrationId ||
    dependency.epochStartedAt !== job.epochStartedAt ||
    dependency.payload.kind !== "create_instance"
  )
    return { status: "rejected", code: "dependency_unavailable" };
  if (["pending", "claimed", "submitted"].includes(dependency.state))
    return { status: "pending", code: "awaiting_instance_creation" };
  if (dependency.state !== "succeeded")
    return { status: "rejected", code: "instance_creation_failed" };
  const result = dependency.result;
  if (
    !result?.worldId ||
    !result.instanceId ||
    result.worldId !== dependency.payload.worldId
  )
    return { status: "rejected", code: "dependency_destination_unavailable" };
  const payload: OperationPayload = {
    kind: "invite_to_instance",
    targetUserId: job.payload.targetUserId,
    worldId: result.worldId,
    instanceId: result.instanceId,
  };
  try {
    validatePayload(payload, integration.vrchatGroupId);
  } catch {
    return { status: "rejected", code: "dependency_destination_unavailable" };
  }
  return { status: "ready", payload };
}
export async function enqueueClubOperations(
  ctx: MutationCtx,
  args: {
    communityProfileId: Id<"profiles">;
    requestId: string;
    payloads: OperationPayload[];
    schedule: Doc<"clubOperations">["schedule"];
  },
) {
  if (
    !/^[a-zA-Z0-9_-]{8,100}$/.test(args.requestId) ||
    args.payloads.length < 1 ||
    args.payloads.length > 100
  )
    throw new Error("Invalid operation batch.");
  const actor = await resolveClubActor(ctx, args.communityProfileId);
  for (const payload of args.payloads) human(actor, payload);
  const prior = await ctx.db
    .query("clubOperations")
    .withIndex("by_community_requestId", (q) =>
      q
        .eq("communityProfileId", args.communityProfileId)
        .eq("requestId", args.requestId),
    )
    .take(101);
  if (prior.length) {
    if (
      prior[0].createdBy.tokenIdentifier !== actor.subject!.tokenIdentifier ||
      JSON.stringify(prior.map((j) => j.payload)) !==
        JSON.stringify(args.payloads) ||
      JSON.stringify(prior[0].schedule) !== JSON.stringify(args.schedule)
    )
      throw new Error("Request ID already used.");
    return prior.map((j) => j._id);
  }
  const integration = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", args.communityProfileId),
    )
    .unique();
  if (!integration || !["active", "degraded"].includes(integration.state))
    throw new Error("Group connection unavailable.");
  const bulk = new Set([
    "invite_member",
    "invite_to_instance",
    "invite_to_created_instance",
    "approve_request",
    "reject_request",
    "assign_role",
    "remove_role",
  ]);
  if (
    args.payloads.length > 1 &&
    args.payloads.some(
      (p) => !bulk.has(p.kind) || p.kind !== args.payloads[0].kind,
    )
  )
    throw new Error("These actions require individual confirmation.");
  const unique = new Set<string>();
  const dependencies = new Map<Id<"clubOperations">, Doc<"clubOperations">>();
  for (const payload of args.payloads) {
    validatePayload(payload, integration.vrchatGroupId);
    const dependency = await checkedDependency(
      ctx,
      integration,
      payload,
      args.schedule.eventId,
    );
    if (dependency) dependencies.set(dependency._id, dependency);
    const key = JSON.stringify(payload);
    if (unique.has(key)) throw new Error("Duplicate recipient.");
    unique.add(key);
    if (
      !enabledClubFeatures(integration).includes(
        clubOperationRequirement(policyOperation(payload, "unknown")).feature,
      )
    )
      throw new Error("Feature disabled.");
  }
  const dueAt = await scheduleTime(ctx, args.communityProfileId, args.schedule);
  for (const dependency of dependencies.values())
    if (dueAt < (await effectiveDueAt(ctx, dependency)))
      throw new Error("Invitations cannot run before instance creation.");
  const now = Date.now();
  const ids: Id<"clubOperations">[] = [];
  for (const payload of args.payloads) {
    const eventId =
      args.schedule.eventId ??
      (payload.kind === "invite_to_created_instance"
        ? dependencies.get(payload.creationOperationId)?.eventId
        : undefined);
    ids.push(
      await ctx.db.insert("clubOperations", {
        communityProfileId: args.communityProfileId,
        integrationId: integration._id,
        epochStartedAt:
          integration.telemetryEpochStartedAt ?? integration.createdAt,
        requestId: args.requestId,
        batchId: args.requestId,
        payload,
        ...(payload.kind === "invite_to_created_instance"
          ? { dependencyId: payload.creationOperationId }
          : {}),
        schedule: args.schedule,
        ...(eventId ? { eventId } : {}),
        dueAt,
        readyAt: dueAt,
        actor: actor.subject!,
        createdBy: actor.subject!,
        revision: 1,
        state: "pending",
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  await ctx.db.patch(integration._id, {
    nextPollAt: Math.min(integration.nextPollAt ?? dueAt, dueAt),
  });
  return ids;
}
export const edit = mutation({
  args: {
    operationId: v.id("clubOperations"),
    payload: clubOperationPayload,
    schedule: operationSchedule,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.operationId);
    if (!job || job.state !== "pending")
      throw new Error("Action is no longer pending.");
    if (args.payload.kind !== job.payload.kind)
      throw new Error("Changing the action type requires a new action.");
    const actor = await resolveClubActor(ctx, job.communityProfileId);
    editPermission(actor, job);
    human(actor, args.payload);
    const integration = await ctx.db.get(job.integrationId);
    if (!integration) throw new Error("Connection unavailable.");
    validatePayload(args.payload, integration.vrchatGroupId);
    const dependency = await checkedDependency(
      ctx,
      integration,
      args.payload,
      args.schedule.eventId,
    );
    const dueAt = await scheduleTime(
      ctx,
      job.communityProfileId,
      args.schedule,
    );
    if (dependency && dueAt < (await effectiveDueAt(ctx, dependency)))
      throw new Error("Invitations cannot run before instance creation.");
    await ctx.db.insert("clubOperationRevisions", {
      operationId: job._id,
      revision: job.revision,
      actor: job.actor,
      payload: job.payload,
      schedule: job.schedule,
      dueAt: job.dueAt,
      createdAt: Date.now(),
    });
    await patchOperation(ctx, job._id, {
      payload: args.payload,
      schedule: args.schedule,
      eventId: args.schedule.eventId ?? dependency?.eventId,
      dependencyId: dependency?._id,
      dueAt,
      readyAt: dueAt,
      retryAt: undefined,
      preflightAttempts: undefined,
      actor: actor.subject!,
      revision: job.revision + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(integration._id, {
      nextPollAt: Math.min(integration.nextPollAt ?? dueAt, dueAt),
    });
    return null;
  },
});
export const cancel = mutation({
  args: { operationId: v.id("clubOperations") },
  returns: v.null(),
  handler: cancelClubOperation,
});
export async function cancelClubOperation(
  ctx: MutationCtx,
  args: { operationId: Id<"clubOperations"> },
) {
  const job = await ctx.db.get(args.operationId);
  if (!job) throw new Error("Action not found.");
  const actor = await resolveClubActor(ctx, job.communityProfileId);
  editPermission(actor, job);
  if (job.state === "cancelled") return null;
  if (job.state !== "pending" && job.state !== "claimed")
    throw new Error("Action has already been submitted.");
  await patchOperation(ctx, job._id, {
    state: "cancelled",
    code: "cancelled_by_staff",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return null;
}
export const list = query({
  args: {
    communityProfileId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("clubOperations"),
        payload: clubOperationPayload,
        schedule: operationSchedule,
        state: operationState,
        dueAt: v.number(),
        actor: clubSubject,
        batchId: v.string(),
        code: v.union(v.null(), v.string()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await resolveClubActor(ctx, args.communityProfileId);
    if (actor.kind === "none") throw new Error("Club access required.");
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw new Error("Invalid page size.");
    const page = await ctx.db
      .query("clubOperations")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page
        .filter(
          (j) =>
            actor.kind === "owner" ||
            actor.permissions.includes(
              clubOperationRequirement(policyOperation(j.payload, "unknown"))
                .permission,
            ),
        )
        .map((j) => ({
          id: j._id,
          payload: j.payload,
          schedule: j.schedule,
          state: j.state,
          dueAt: j.dueAt,
          actor: j.actor,
          batchId: j.batchId,
          code: j.code ?? null,
        })),
    };
  },
});
export const claim = internalMutation({
  args: worker,
  returns: v.union(
    v.null(),
    v.object({
      operationId: v.id("clubOperations"),
      nonce: v.string(),
      payload: clubOperationPayload,
      epochStartedAt: v.number(),
      executeBefore: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const bound = await binding(ctx, args);
    if (!bound) return null;
    const now = Date.now();
    // Expired submissions are deliberately never requeued. Their provider outcome is unknown.
    for (const state of ["claimed", "submitted"] as const) {
      const rows = await ctx.db
        .query("clubOperations")
        .withIndex("by_integration_state_dueAt", (q) =>
          q.eq("integrationId", args.integrationId).eq("state", state),
        )
        .take(100);
      for (const row of rows)
        if (row.claim && row.claim.expiresAt <= now)
          await patchOperation(ctx, row._id, {
            state: state === "submitted" ? "indeterminate" : "pending",
            ...(state === "submitted"
              ? { code: "submission_outcome_unknown", completedAt: now }
              : {}),
            claim: state === "submitted" ? row.claim : undefined,
            updatedAt: now,
          });
    }
    const jobs = await ctx.db
      .query("clubOperations")
      .withIndex("by_integration_state_readyAt", (q) =>
        q
          .eq("integrationId", args.integrationId)
          .eq("state", "pending")
          .lte("readyAt", now),
      )
      .take(100);
    for (const job of jobs) {
      if (
        job.epochStartedAt !==
        (bound.integration.telemetryEpochStartedAt ??
          bound.integration.createdAt)
      ) {
        await patchOperation(ctx, job._id, {
          state: "rejected",
          code: "connection_changed",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      const event = job.eventId ? await ctx.db.get(job.eventId) : null;
      if (
        job.eventId &&
        (!event ||
          event.communityProfileId !== job.communityProfileId ||
          event.eventStatus === "cancelled")
      ) {
        await patchOperation(ctx, job._id, {
          state: "cancelled",
          code: "event_cancelled",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      if (
        job.schedule.kind === "event_relative" &&
        event &&
        job.dueAt !== event.startAt + job.schedule.offsetMs
      ) {
        await patchOperation(ctx, job._id, {
          dueAt: event.startAt + job.schedule.offsetMs,
          readyAt: Math.max(
            event.startAt + job.schedule.offsetMs,
            job.retryAt ?? 0,
          ),
          updatedAt: now,
        });
        continue;
      }
      if (await dependencyTimingChanged(ctx, job)) {
        await patchOperation(ctx, job._id, {
          state: "rejected",
          code: "instance_creation_rescheduled",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      if (now - job.dueAt > LATE_GRACE_MS) {
        await patchOperation(ctx, job._id, {
          state: "missed",
          code: "late_window_elapsed",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
      const nonce = crypto.randomUUID();
      const resolved = await resolvedOperation(ctx, job, bound.integration);
      if (resolved.status !== "ready") {
        if (resolved.status === "pending")
          await patchOperation(ctx, job._id, {
            readyAt: Math.min(now + 5000, job.dueAt + LATE_GRACE_MS + 1),
            code: resolved.code,
            updatedAt: now,
          });
        else
          await patchOperation(ctx, job._id, {
            state: "rejected",
            code: resolved.code,
            completedAt: now,
            updatedAt: now,
          });
        continue;
      }
      await patchOperation(ctx, job._id, {
        state: "claimed",
        claim: {
          nonce,
          collectorAccountId: bound.account._id,
          credentialGeneration: bound.account.credentialGeneration,
          workerId: args.workerId,
          fencingToken: args.fencingToken,
          expiresAt: Math.min(now + CLAIM_MS, bound.lease.expiresAt),
        },
        updatedAt: now,
      });
      return {
        operationId: job._id,
        nonce,
        payload: resolved.payload,
        epochStartedAt: job.epochStartedAt,
        executeBefore: job.dueAt + LATE_GRACE_MS,
      };
    }
    return null;
  },
});
export const authorizeSubmission = internalMutation({
  args: {
    ...worker,
    operationId: v.id("clubOperations"),
    nonce: v.string(),
    authority: ownMemberAuthority,
    friendship: v.optional(
      v.union(
        v.literal("friend"),
        v.literal("not_friend"),
        v.literal("unknown"),
      ),
    ),
  },
  returns: v.object({
    authorized: v.boolean(),
    code: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, args) => {
    const bound = await binding(ctx, args);
    const job = await ctx.db.get(args.operationId);
    const now = Date.now();
    if (
      !bound ||
      !job ||
      job.integrationId !== args.integrationId ||
      job.state !== "claimed" ||
      job.claim?.nonce !== args.nonce ||
      job.claim.workerId !== args.workerId ||
      job.claim.fencingToken !== args.fencingToken ||
      job.claim.collectorAccountId !== bound.account._id ||
      job.claim.credentialGeneration !== bound.account.credentialGeneration ||
      job.claim.expiresAt <= now
    )
      return { authorized: false, code: "claim_unavailable" };
    const reject = async (code: string) => {
      await patchOperation(ctx, job._id, {
        state: "rejected",
        code,
        completedAt: now,
        updatedAt: now,
      });
      return { authorized: false, code };
    };
    if (
      job.epochStartedAt !==
      (bound.integration.telemetryEpochStartedAt ?? bound.integration.createdAt)
    )
      return reject("connection_changed");
    if (job.eventId) {
      const event = await ctx.db.get(job.eventId);
      if (
        !event ||
        event.communityProfileId !== job.communityProfileId ||
        event.eventStatus === "cancelled"
      )
        return reject("event_cancelled");
      if (
        job.schedule.kind === "event_relative" &&
        job.dueAt !== event.startAt + job.schedule.offsetMs
      ) {
        await patchOperation(ctx, job._id, {
          state: "pending",
          claim: undefined,
          dueAt: event.startAt + job.schedule.offsetMs,
          readyAt: Math.max(
            event.startAt + job.schedule.offsetMs,
            job.retryAt ?? 0,
          ),
          updatedAt: now,
        });
        return { authorized: false, code: "event_rescheduled" };
      }
    }
    if (await dependencyTimingChanged(ctx, job))
      return reject("instance_creation_rescheduled");
    if (now - job.dueAt > LATE_GRACE_MS) {
      await patchOperation(ctx, job._id, {
        state: "missed",
        code: "late_window_elapsed",
        completedAt: now,
        updatedAt: now,
      });
      return { authorized: false, code: "late_window_elapsed" };
    }
    if (
      args.authority.permissions.length > 100 ||
      args.authority.permissions.some((x) => x.length > 100) ||
      !args.authority.ownerUserId
    )
      return reject("provider_authority");
    const resolved = await resolvedOperation(ctx, job, bound.integration);
    if (resolved.status !== "ready") return reject(resolved.code);
    const actor = await resolveClubSubject(
      ctx.db,
      job.communityProfileId,
      job.actor,
    );
    const roles = await activeClubRoles(ctx.db, job.communityProfileId);
    const allowedRoles = roles
      .filter((r) => actor.roleIds.includes(r._id))
      .flatMap((r) => r.permittedProviderRoleIds ?? []);
    const decision = assessClubOperation(
      {
        actorKind: actor.kind,
        permissions: actor.permissions,
        enabledFeatures: enabledClubFeatures(bound.integration),
        integrationActive: true,
        expectedGroupId: bound.integration.vrchatGroupId,
        expectedBotUserId: bound.account.vrchatUserId,
        provider: args.authority,
        permittedProviderRoleIds: allowedRoles,
        now,
      },
      policyOperation(
        resolved.payload,
        bound.integration.groupVisibility,
        args.friendship,
      ),
    );
    if (!decision.allowed) return reject(decision.reason!);
    await patchOperation(ctx, job._id, {
      state: "submitted",
      submittedAt: now,
      claim: { ...job.claim, expiresAt: now + 120_000 },
      updatedAt: now,
    });
    return { authorized: true, code: null };
  },
});
export const deferClaim = internalMutation({
  args: {
    ...worker,
    operationId: v.id("clubOperations"),
    nonce: v.string(),
    code: v.union(
      v.literal("timeout"),
      v.literal("network"),
      v.literal("rate_limit"),
      v.literal("transient"),
      v.literal("provider_unavailable"),
    ),
    retryAfterMs: v.number(),
  },
  returns: v.object({
    recorded: v.boolean(),
    retryAt: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, args) => {
    const bound = await binding(ctx, args);
    const job = await ctx.db.get(args.operationId);
    const now = Date.now();
    if (
      !bound ||
      !job ||
      job.state !== "claimed" ||
      job.integrationId !== args.integrationId ||
      job.claim?.nonce !== args.nonce ||
      job.claim.workerId !== args.workerId ||
      job.claim.collectorAccountId !== args.collectorAccountId ||
      job.claim.fencingToken !== args.fencingToken ||
      job.claim.credentialGeneration !== bound.account.credentialGeneration ||
      job.claim.expiresAt <= now
    )
      return { recorded: false, retryAt: null };
    if (
      !Number.isFinite(args.retryAfterMs) ||
      args.retryAfterMs < 0 ||
      args.retryAfterMs > LATE_GRACE_MS
    )
      throw new Error("Invalid preflight retry delay.");
    const attempts = (job.preflightAttempts ?? 0) + 1;
    const retryAt = now + Math.max(1000, args.retryAfterMs);
    if (retryAt > job.dueAt + LATE_GRACE_MS || attempts >= 3) {
      await patchOperation(ctx, job._id, {
        state: retryAt > job.dueAt + LATE_GRACE_MS ? "missed" : "rejected",
        code:
          retryAt > job.dueAt + LATE_GRACE_MS
            ? "late_window_elapsed"
            : "preflight_retries_exhausted",
        preflightAttempts: attempts,
        claim: undefined,
        completedAt: now,
        updatedAt: now,
      });
      return { recorded: true, retryAt: null };
    }
    await patchOperation(ctx, job._id, {
      state: "pending",
      claim: undefined,
      preflightAttempts: attempts,
      retryAt,
      readyAt: Math.max(job.dueAt, retryAt),
      code: args.code,
      updatedAt: now,
    });
    await ctx.db.patch(bound.integration._id, {
      nextPollAt: Math.min(bound.integration.nextPollAt ?? retryAt, retryAt),
    });
    return { recorded: true, retryAt };
  },
});
export const rejectClaim = internalMutation({
  args: {
    ...worker,
    operationId: v.id("clubOperations"),
    nonce: v.string(),
    code: v.string(),
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const bound = await binding(ctx, args);
    const job = await ctx.db.get(args.operationId);
    if (
      !bound ||
      !job ||
      job.state !== "claimed" ||
      job.integrationId !== args.integrationId ||
      job.claim?.nonce !== args.nonce ||
      job.claim.workerId !== args.workerId ||
      job.claim.collectorAccountId !== args.collectorAccountId ||
      job.claim.fencingToken !== args.fencingToken ||
      job.claim.credentialGeneration !== bound.account.credentialGeneration ||
      job.claim.expiresAt <= Date.now()
    )
      return { recorded: false };
    if (!/^[a-z0-9_]{1,100}$/.test(args.code))
      throw new Error("Invalid outcome code.");
    await patchOperation(ctx, job._id, {
      state: "rejected",
      code: args.code,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});
export const syncEventSchedule = internalMutation({
  args: {
    eventId: v.id("events"),
    forceCancel: v.boolean(),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await syncClubEventOperationPage(ctx, args);
    return null;
  },
});
export const complete = internalMutation({
  args: {
    ...worker,
    operationId: v.id("clubOperations"),
    nonce: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("rejected"),
      v.literal("indeterminate"),
    ),
    code: v.optional(v.string()),
    result: v.optional(
      v.object({
        worldId: v.optional(v.string()),
        instanceId: v.optional(v.string()),
        postId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const bound = await binding(ctx, args);
    const job = await ctx.db.get(args.operationId);
    if (
      !bound ||
      !job ||
      job.integrationId !== args.integrationId ||
      job.state !== "submitted" ||
      job.claim?.nonce !== args.nonce ||
      job.claim.workerId !== args.workerId ||
      job.claim.fencingToken !== args.fencingToken ||
      job.claim.credentialGeneration !== bound.account.credentialGeneration
    )
      return { recorded: false };
    if (args.code && args.code.length > 100)
      throw new Error("Invalid outcome code.");
    if (
      args.result &&
      Object.values(args.result).some(
        (x) => typeof x === "string" && x.length > 600,
      )
    )
      throw new Error("Invalid operation result.");
    await patchOperation(ctx, job._id, {
      state: args.status,
      code: args.code,
      result: args.result,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});
