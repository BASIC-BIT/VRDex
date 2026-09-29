import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { preflightEventContribution } from "./_eventContributionPreflight";
import { requireUser } from "./_identity";
import { classifyEventIntakeForPublication, getActorIntakeDraft, publishIntakeDraft, replayIntakePublication, saveIntakeDraft, type PublishIntakeResult } from "./_eventIntake";

const saveArgs = { draftId: v.optional(v.id("eventIntakeDrafts")), expectedVersion: v.optional(v.number()), patch: v.any() };
const publishArgs = { draftId: v.id("eventIntakeDrafts"), expectedVersion: v.number(), idempotencyKey: v.string() };
const actorArg = { actorUserId: v.id("users") };
const actorSurfaceArg = { actorSurface: v.optional(v.union(v.literal("browser"), v.literal("api"), v.literal("mcp"))) };
const saved = v.object({ draftId: v.id("eventIntakeDrafts"), version: v.number() });
const published = v.object({ eventId: v.id("events"), eventPath: v.string(), receiptId: v.id("eventContributionReceipts") });

export const saveEventIntakeDraft = mutation({ args: saveArgs, returns: saved, handler: async (ctx, args) => saveIntakeDraft(ctx.db, (await requireUser(ctx)).userId, args) });
export const getEventIntakeDraft = query({ args: { draftId: v.id("eventIntakeDrafts") }, returns: v.any(), handler: async (ctx, args) => getActorIntakeDraft(ctx.db, (await requireUser(ctx)).userId, args.draftId) });
export const currentIntakeActor = internalQuery({ args: {}, returns: v.id("users"), handler: async ctx => (await requireUser(ctx)).userId });
export const saveActorDraft = internalMutation({ args: { ...actorArg, ...saveArgs }, returns: saved, handler: (ctx, args) => saveIntakeDraft(ctx.db, args.actorUserId, args) });
export const getActorDraft = internalQuery({ args: { ...actorArg, draftId: v.id("eventIntakeDrafts") }, returns: v.any(), handler: (ctx, args) => getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId) });
const classificationValidator = v.object({ draftId: v.string(), draftVersion: v.number(), decision: v.union(v.literal("disabled"), v.literal("allow"), v.literal("block")), reviewReason: v.optional(v.union(v.literal("classifier_outage"), v.literal("classifier_sample"))) });
export const commitPublishIntake = internalMutation({ args: { ...actorArg, ...actorSurfaceArg, ...publishArgs, classification: v.optional(classificationValidator) }, returns: published, handler: async (ctx, { actorUserId, actorSurface, classification, ...args }) => {
  if (classification && (classification.draftId !== args.draftId || classification.draftVersion !== args.expectedVersion)) throw new Error("CLASSIFICATION_VERSION_CONFLICT");
  const replay = await replayIntakePublication(ctx.db, actorUserId, args);
  if (replay) return replay;
  if (classification?.decision === "block") throw new Error("CONTENT_BLOCKED");
  const { createdEvent, ...result } = await publishIntakeDraft(ctx.db, actorUserId, args, Date.now(), actorSurface);
  if (classification?.reviewReason && createdEvent) {
    const event = await ctx.db.get(result.eventId);
    await ctx.db.insert("eventReports", { eventId: result.eventId, communityProfileId: event?.communityProfileId, actorUserId, reason: classification.reviewReason, kind: classification.reviewReason, createdAt: Date.now() });
  }
  return result;
} });
export const getPublishReplay = internalQuery({ args: { ...actorArg, ...publishArgs }, returns: v.union(v.null(), published), handler: (ctx, { actorUserId, ...args }) => replayIntakePublication(ctx.db, actorUserId, args) });
export const reserveClassification = internalMutation({ args: { ...actorArg, draftId: v.id("eventIntakeDrafts"), expectedVersion: v.number() }, returns: v.boolean(), handler: async (ctx, args) => {
  const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId);
  if (draft.version !== args.expectedVersion) throw new Error("VERSION_CONFLICT");
  await preflightEventContribution(ctx.db, args.actorUserId, draft.fields, Date.now());
  const recent = await ctx.db.query("eventIntakeModelAttempts").withIndex("by_actor_createdAt", q => q.eq("actorUserId", args.actorUserId).gte("createdAt", Date.now() - 86_400_000)).take(20);
  if (recent.length >= 20) return false;
  await ctx.db.insert("eventIntakeModelAttempts", { actorUserId: args.actorUserId, draftId: args.draftId, createdAt: Date.now() });
  return true;
} });
export const publishActorIntake = internalAction({
  args: { ...actorArg, ...actorSurfaceArg, ...publishArgs }, returns: published,
  handler: async (ctx, args): Promise<PublishIntakeResult> => {
    const { actorSurface, ...publishArgs } = args;
    const replay = await ctx.runQuery(internal.eventIntake.getPublishReplay, publishArgs);
    if (replay) return replay;
    const draft = await ctx.runQuery(internal.eventIntake.getActorDraft, { actorUserId: args.actorUserId, draftId: args.draftId });
    if (draft.version !== args.expectedVersion) throw new Error("VERSION_CONFLICT");
    const spends = !draft.publishedReceiptId && ["shadow", "block_high_confidence"].includes(process.env.VRDEX_EVENT_SPAM_MODE ?? "off") && Boolean(process.env.OPENAI_API_KEY);
    const permitted = !spends || await ctx.runMutation(internal.eventIntake.reserveClassification, { actorUserId: args.actorUserId, draftId: args.draftId, expectedVersion: args.expectedVersion });
    const classification = draft.publishedReceiptId ? undefined : await classifyEventIntakeForPublication(draft, permitted ? {} : { apiKey: "" });
    return ctx.runMutation(internal.eventIntake.commitPublishIntake, { ...publishArgs, actorSurface, ...(classification ? { classification } : {}) });
  },
});
export const publishEventIntake = action({
  args: publishArgs, returns: published,
  handler: async (ctx, args): Promise<PublishIntakeResult> => {
    const actorUserId = await ctx.runQuery(internal.eventIntake.currentIntakeActor, {});
    return ctx.runAction(internal.eventIntake.publishActorIntake, { ...args, actorUserId, actorSurface: "browser" });
  },
});
export const expireDrafts = internalMutation({ args: {}, returns: v.number(), handler: async ctx => {
  const expired = await ctx.db.query("eventIntakeDrafts").withIndex("by_expiresAt", q => q.lte("expiresAt", Date.now())).take(100);
  for (const draft of expired) await ctx.db.delete(draft._id);
  const attempts = await ctx.db.query("eventIntakeModelAttempts").withIndex("by_createdAt", q => q.lt("createdAt", Date.now() - 86_400_000)).take(100);
  for (const attempt of attempts) await ctx.db.delete(attempt._id);
  return expired.length;
} });
