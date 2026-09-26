import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./_identity";
import { classifyEventIntakeForPublication, getActorIntakeDraft, publishIntakeDraft, replayIntakePublication, saveIntakeDraft, type PublishIntakeResult } from "./_eventIntake";

const saveArgs = { draftId: v.optional(v.id("eventIntakeDrafts")), expectedVersion: v.optional(v.number()), patch: v.any() };
const publishArgs = { draftId: v.id("eventIntakeDrafts"), expectedVersion: v.number(), idempotencyKey: v.string() };
const actorArg = { actorUserId: v.id("users") };
const saved = v.object({ draftId: v.id("eventIntakeDrafts"), version: v.number() });
const published = v.object({ eventId: v.id("events"), eventPath: v.string(), receiptId: v.id("eventContributionReceipts") });

export const saveEventIntakeDraft = mutation({ args: saveArgs, returns: saved, handler: async (ctx, args) => saveIntakeDraft(ctx.db, (await requireUser(ctx)).userId, args) });
export const getEventIntakeDraft = query({ args: { draftId: v.id("eventIntakeDrafts") }, returns: v.any(), handler: async (ctx, args) => getActorIntakeDraft(ctx.db, (await requireUser(ctx)).userId, args.draftId) });
export const currentIntakeActor = internalQuery({ args: {}, returns: v.id("users"), handler: async ctx => (await requireUser(ctx)).userId });
export const saveActorDraft = internalMutation({ args: { ...actorArg, ...saveArgs }, returns: saved, handler: (ctx, args) => saveIntakeDraft(ctx.db, args.actorUserId, args) });
export const getActorDraft = internalQuery({ args: { ...actorArg, draftId: v.id("eventIntakeDrafts") }, returns: v.any(), handler: (ctx, args) => getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId) });
export const commitPublishIntake = internalMutation({ args: { ...actorArg, ...publishArgs }, returns: published, handler: (ctx, { actorUserId, ...args }) => publishIntakeDraft(ctx.db, actorUserId, args) });
export const getPublishReplay = internalQuery({ args: { ...actorArg, ...publishArgs }, returns: v.union(v.null(), published), handler: (ctx, { actorUserId, ...args }) => replayIntakePublication(ctx.db, actorUserId, args) });
export const publishActorIntake = internalAction({
  args: { ...actorArg, ...publishArgs }, returns: published,
  handler: async (ctx, args): Promise<PublishIntakeResult> => {
    const replay = await ctx.runQuery(internal.eventIntake.getPublishReplay, args);
    if (replay) return replay;
    const draft = await ctx.runQuery(internal.eventIntake.getActorDraft, { actorUserId: args.actorUserId, draftId: args.draftId });
    if (!draft.publishedReceiptId) {
      const classification = await classifyEventIntakeForPublication(draft);
      if (classification.decision === "block") throw new Error("CONTENT_BLOCKED");
    }
    return ctx.runMutation(internal.eventIntake.commitPublishIntake, args);
  },
});
export const publishEventIntake = action({
  args: publishArgs, returns: published,
  handler: async (ctx, args): Promise<PublishIntakeResult> => {
    const actorUserId = await ctx.runQuery(internal.eventIntake.currentIntakeActor, {});
    return ctx.runAction(internal.eventIntake.publishActorIntake, { ...args, actorUserId });
  },
});
export const expireDrafts = internalMutation({ args: {}, returns: v.number(), handler: async ctx => {
  const expired = await ctx.db.query("eventIntakeDrafts").withIndex("by_expiresAt", q => q.lte("expiresAt", Date.now())).take(100);
  for (const draft of expired) await ctx.db.delete(draft._id);
  return expired.length;
} });
