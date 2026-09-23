import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { resolveClubActor, requireClubPermission } from "./_clubAccess";
import { invitationDestination, normalizeRecipients } from "./_clubInvitations";
import {
  operationSchedule,
  operationState,
  type OperationPayload,
} from "./_clubOperations";
import {
  enqueueClubOperations,
  cancelClubOperation,
  canManageClubOperation,
} from "./clubOperations";
import { clubOperationRequirement } from "./_clubOperationPolicy";
import { policyOperation } from "./_clubOperations";

async function access(ctx: QueryCtx, communityProfileId: Id<"profiles">) {
  const actor = await resolveClubActor(ctx, communityProfileId);
  if (
    actor.kind !== "owner" &&
    !actor.permissions.includes("invite_group_members") &&
    !actor.permissions.includes("manage_instances")
  )
    throw new Error("Invitation permission required.");
  return actor;
}
export const saveList = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    listId: v.optional(v.id("clubRecipientLists")),
    name: v.string(),
    recipients: v.array(v.string()),
    expectedRevision: v.optional(v.number()),
  },
  returns: v.id("clubRecipientLists"),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    const name = args.name.trim();
    if (!name || name.length > 80)
      throw new Error("List name must contain 1 to 80 characters.");
    const recipients = normalizeRecipients(args.recipients);
    if (args.listId) {
      const prior = await ctx.db.get(args.listId);
      if (!prior || prior.communityProfileId !== args.communityProfileId)
        throw new Error("List unavailable.");
      if (prior.revision !== args.expectedRevision)
        throw new Error("List changed. Reload before saving.");
      await ctx.db.patch(prior._id, {
        name,
        recipients,
        revision: prior.revision + 1,
        updatedAt: Date.now(),
      });
      return prior._id;
    }
    return ctx.db.insert("clubRecipientLists", {
      communityProfileId: args.communityProfileId,
      name,
      recipients,
      revision: 1,
      updatedAt: Date.now(),
    });
  },
});
export const removeList = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    listId: v.id("clubRecipientLists"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    const list = await ctx.db.get(args.listId);
    if (list && list.communityProfileId !== args.communityProfileId)
      throw new Error("List unavailable.");
    if (list) await ctx.db.delete(list._id);
    return null;
  },
});
const listItem = v.object({
  _id: v.id("clubRecipientLists"),
  name: v.string(),
  recipients: v.array(v.string()),
  revision: v.number(),
});
export const lists = query({
  args: {
    communityProfileId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(listItem),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 50)
      throw new Error("Invalid page size.");
    const result = await ctx.db
      .query("clubRecipientLists")
      .withIndex("by_community", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(({ _id, name, recipients, revision }) => ({
        _id,
        name,
        recipients,
        revision,
      })),
    };
  },
});
export const preview = query({
  args: {
    communityProfileId: v.id("profiles"),
    recipients: v.array(v.string()),
  },
  returns: v.object({
    recipients: v.array(v.string()),
    removedDuplicates: v.number(),
  }),
  handler: async (ctx, args) => {
    await access(ctx, args.communityProfileId);
    const recipients = normalizeRecipients(args.recipients);
    return {
      recipients,
      removedDuplicates: args.recipients.length - recipients.length,
    };
  },
});
function payloads(
  destination: Infer<typeof invitationDestination>,
  recipients: string[],
): OperationPayload[] {
  return recipients.map((targetUserId) =>
    destination.kind === "group"
      ? { kind: "invite_member", targetUserId }
      : destination.kind === "instance"
        ? {
            kind: "invite_to_instance",
            targetUserId,
            worldId: destination.worldId,
            instanceId: destination.instanceId,
          }
        : {
            kind: "invite_to_created_instance",
            targetUserId,
            creationOperationId: destination.creationOperationId,
            creationRevision: destination.creationRevision,
          },
  );
}
export const enqueue = mutation({
  args: {
    communityProfileId: v.id("profiles"),
    requestId: v.string(),
    reviewedRecipients: v.array(v.string()),
    destination: invitationDestination,
    schedule: operationSchedule,
  },
  returns: v.id("clubInvitationBatches"),
  handler: async (ctx, args) => {
    const actor = await access(ctx, args.communityProfileId);
    requireClubPermission(
      actor,
      args.destination.kind === "group"
        ? "invite_group_members"
        : "manage_instances",
    );
    const recipients = normalizeRecipients(args.reviewedRecipients);
    const operationIds = await enqueueClubOperations(ctx, {
      communityProfileId: args.communityProfileId,
      requestId: args.requestId,
      payloads: payloads(args.destination, recipients),
      schedule: args.schedule,
    });
    const prior = await ctx.db
      .query("clubInvitationBatches")
      .withIndex("by_community_request", (q) =>
        q
          .eq("communityProfileId", args.communityProfileId)
          .eq("requestId", args.requestId),
      )
      .unique();
    if (prior) return prior._id;
    return ctx.db.insert("clubInvitationBatches", {
      communityProfileId: args.communityProfileId,
      requestId: args.requestId,
      recipients,
      operationIds,
      createdAt: Date.now(),
    });
  },
});
export const outcomes = query({
  args: { batchId: v.id("clubInvitationBatches") },
  returns: v.object({
    canCancel: v.boolean(),
    recipients: v.array(
      v.object({
        userId: v.string(),
        reviewedUserId: v.string(),
        operationId: v.id("clubOperations"),
        state: operationState,
        code: v.union(v.string(), v.null()),
        dueAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch unavailable.");
    const actor = await access(ctx, batch.communityProfileId);
    const jobs = await Promise.all(
      batch.operationIds.map((id) => ctx.db.get(id)),
    );
    const recipients = jobs.map((job, index) => {
      if (!job) throw new Error("Operation unavailable.");
      requireClubPermission(
        actor,
        clubOperationRequirement(policyOperation(job.payload, "unknown"))
          .permission,
      );
      return {
        userId:
          "targetUserId" in job.payload
            ? job.payload.targetUserId
            : batch.recipients[index],
        reviewedUserId: batch.recipients[index],
        operationId: job._id,
        state: job.state,
        code: job.code ?? null,
        dueAt: job.dueAt,
      };
    });
    const unsent = jobs.filter(
      (job) => job && ["pending", "claimed"].includes(job.state),
    );
    return {
      recipients,
      canCancel:
        unsent.length > 0 &&
        unsent.every(
          (job) => job !== null && canManageClubOperation(actor, job),
        ),
    };
  },
});
export const batches = query({
  args: {
    communityProfileId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("clubInvitationBatches"),
        createdAt: v.number(),
        recipientCount: v.number(),
        destinationKind: v.union(
          v.literal("group"),
          v.literal("instance"),
          v.literal("scheduled_instance"),
        ),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await access(ctx, args.communityProfileId);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 20
    )
      throw new Error("Invalid page size.");
    const result = await ctx.db
      .query("clubInvitationBatches")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const page = [];
    for (const batch of result.page) {
      // Recheck every current job. Revisions can change executable content.
      const jobs = await Promise.all(
        batch.operationIds.map((id) => ctx.db.get(id)),
      );
      if (
        !jobs.length ||
        jobs.some(
          (job) =>
            !job ||
            job.communityProfileId !== args.communityProfileId ||
            (actor.kind !== "owner" &&
              !actor.permissions.includes(
                clubOperationRequirement(
                  policyOperation(job.payload, "unknown"),
                ).permission,
              )),
        )
      )
        continue;
      const kind = jobs[0]!.payload.kind;
      const destinationKind =
        kind === "invite_member"
          ? ("group" as const)
          : kind === "invite_to_created_instance"
            ? ("scheduled_instance" as const)
            : ("instance" as const);
      page.push({
        id: batch._id,
        createdAt: batch.createdAt,
        recipientCount: batch.recipients.length,
        destinationKind,
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const cancel = mutation({
  args: { batchId: v.id("clubInvitationBatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Batch unavailable.");
    await access(ctx, batch.communityProfileId);
    for (const operationId of batch.operationIds) {
      const job = await ctx.db.get(operationId);
      if (job && ["pending", "claimed"].includes(job.state))
        await cancelClubOperation(ctx, { operationId });
    }
    return null;
  },
});
