import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, internalMutation } from "./_generated/server";
import { resolveClubActor } from "./_clubAccess";
import { createNotificationRecipientCache, notificationRecipient } from "./_clubNotifications";

export const list = query({
  args: {
    communityProfileId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("clubOperationNotifications"),
        operationId: v.id("clubOperations"),
        kind: v.string(),
        outcome: v.string(),
        createdAt: v.number(),
        read: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await resolveClubActor(ctx, args.communityProfileId);
    if (!actor.subject || actor.kind === "none")
      return { page: [], isDone: true, continueCursor: "" };
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Invalid page size.");
    const rows = await ctx.db
      .query("clubOperationNotifications")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityProfileId", args.communityProfileId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const result = [];
    const recipientFor = createNotificationRecipientCache(ctx.db);
    for (const row of rows.page) {
      const job = await ctx.db.get(row.operationId);
      if (!job || job.revision !== row.revision || job.state !== row.outcome)
        continue;
      const recipient = await recipientFor(job);
      if (recipient?.tokenIdentifier !== actor.subject.tokenIdentifier)
        continue;
      result.push({
        id: row._id,
        operationId: job._id,
        kind: job.payload.kind,
        outcome: row.outcome,
        createdAt: row.createdAt,
        read: row.readBy.includes(actor.subject.tokenIdentifier),
      });
    }
    return {
      page: result,
      isDone: rows.isDone,
      continueCursor: rows.continueCursor,
    };
  },
});
export const markRead = mutation({
  args: { notificationId: v.id("clubOperationNotifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) return null;
    const actor = await resolveClubActor(ctx, row.communityProfileId);
    const job = await ctx.db.get(row.operationId);
    if (
      !actor.subject ||
      !job ||
      job.revision !== row.revision ||
      job.state !== row.outcome
    )
      return null;
    const recipient = await notificationRecipient(ctx.db, job);
    if (recipient?.tokenIdentifier !== actor.subject.tokenIdentifier)
      return null;
    const readBy = [...new Set([...row.readBy, actor.subject.tokenIdentifier])];
    if (readBy.length !== row.readBy.length)
      await ctx.db.patch(row._id, { readBy });
    return null;
  },
});
// Claim before sending. An uncertain SES response is never automatically retried.
export const claimEmail = internalMutation({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("clubOperationNotifications"),
      email: v.string(),
      communitySlug: v.string(),
    }),
  ),
  handler: async (ctx) => {
    // A process can die after SES accepted the message but before finishEmail.
    // Mark old claims uncertain without ever making them sendable again.
    const abandoned = await ctx.db
      .query("clubOperationNotifications")
      .withIndex("by_emailState", (q) =>
        q.eq("emailState", "submitted").lte("emailNextAttemptAt", Date.now()),
      )
      .take(20);
    for (const row of abandoned)
      await ctx.db.patch(row._id, { emailState: "indeterminate" });
    const rows = await ctx.db
      .query("clubOperationNotifications")
      .withIndex("by_emailState", (q) =>
        q.eq("emailState", "pending").lte("emailNextAttemptAt", Date.now()),
      )
      .take(100);
    const recipientFor = createNotificationRecipientCache(ctx.db);
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        emailNextAttemptAt: Date.now() + 3_600_000,
      });
      const job = await ctx.db.get(row.operationId);
      if (!job || job.revision !== row.revision || job.state !== row.outcome)
        continue;
      const recipient = await recipientFor(job);
      if (!recipient) continue;
      const previous = await ctx.db
        .query("clubOperationNotifications")
        .withIndex("by_batch_recipient", (q) =>
          q
            .eq("communityProfileId", row.communityProfileId)
            .eq("batchId", row.batchId)
            .eq("revision", row.revision)
            .eq("outcome", row.outcome)
            .eq("emailRecipient", recipient.tokenIdentifier),
        )
        .first();
      if (previous) {
        await ctx.db.patch(row._id, { emailState: "suppressed" });
        continue;
      }
      const community = await ctx.db.get(row.communityProfileId);
      if (!community) continue;
      const user = await ctx.db
        .query("users")
        .withIndex("clerkUserId", (q) => q.eq("clerkUserId", recipient.subject))
        .unique();
      if (!user?.email || !user.emailVerificationTime) continue;
      await ctx.db.patch(row._id, {
        emailState: "submitted",
        emailRecipient: recipient.tokenIdentifier,
      });
      return { id: row._id, email: user.email, communitySlug: community.slug };
    }
    return null;
  },
});
export const finishEmail = internalMutation({
  args: { id: v.id("clubOperationNotifications"), sent: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row?.emailState === "submitted")
      await ctx.db.patch(row._id, {
        emailState: args.sent ? "sent" : "indeterminate",
      });
    return null;
  },
});
