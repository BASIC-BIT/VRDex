import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { resolveClubActor, requireClubPermission } from "./_clubAccess";
import { enabledClubFeatures } from "./_clubConnection";
import { postDraftContent } from "./_clubPosts";
import { enqueueClubOperations } from "./clubOperations";
import { operationSchedule } from "./_clubOperations";
const scope = { communityProfileId: v.id("profiles") };
async function access(
  ctx: QueryCtx | MutationCtx,
  communityProfileId: Id<"profiles">,
) {
  const actor = await resolveClubActor(ctx, communityProfileId);
  requireClubPermission(actor, "publish_posts");
  if (!actor.subject) throw new Error("Sign in required.");
  const integration = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", communityProfileId),
    )
    .unique();
  if (!integration || !enabledClubFeatures(integration).includes("posts"))
    throw new Error("Posts are disabled.");
  return actor;
}
async function owned(
  ctx: MutationCtx,
  args: {
    communityProfileId: Id<"profiles">;
    draftId: Id<"clubPostDrafts">;
    expectedRevision: number;
  },
) {
  const actor = await access(ctx, args.communityProfileId),
    draft = await ctx.db.get(args.draftId);
  if (
    !draft ||
    draft.communityProfileId !== args.communityProfileId ||
    draft.creatorTokenIdentifier !== actor.subject!.tokenIdentifier
  )
    throw new Error("Draft not found.");
  if (draft.revision !== args.expectedRevision)
    throw new Error("This draft changed. Reload before saving.");
  return draft;
}
const draftView = v.object({
  id: v.id("clubPostDrafts"),
  content: postDraftContent,
  revision: v.number(),
  operationId: v.union(v.id("clubOperations"), v.null()),
  operationState: v.union(v.string(), v.null()),
  queuedRevision: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});
function view(d: Doc<"clubPostDrafts">, operationState: string | null = null) {
  return {
    id: d._id,
    content: {
      title: d.title,
      text: d.text,
      visibility: d.visibility,
      sendNotification: d.sendNotification,
      ...(d.imageId ? { imageId: d.imageId } : {}),
      ...(d.roleIds ? { roleIds: d.roleIds } : {}),
      ...(d.providerPostId ? { providerPostId: d.providerPostId } : {}),
    },
    revision: d.revision,
    operationId: d.operationId ?? null,
    operationState,
    queuedRevision: d.queuedRevision ?? null,
    updatedAt: d.updatedAt,
  };
}
export const list = query({
  args: { ...scope, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(draftView),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await access(ctx, args.communityProfileId);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50
    )
      throw new Error("Invalid draft page.");
    const result = await ctx.db
      .query("clubPostDrafts")
      .withIndex("by_creator", (q) =>
        q
          .eq("communityProfileId", args.communityProfileId)
          .eq("creatorTokenIdentifier", actor.subject!.tokenIdentifier),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: await Promise.all(
        result.page.map(async (d) =>
          view(
            d,
            d.operationId
              ? ((await ctx.db.get(d.operationId))?.state ?? null)
              : null,
          ),
        ),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const save = mutation({
  args: {
    ...scope,
    clientId: v.string(),
    draftId: v.optional(v.id("clubPostDrafts")),
    expectedRevision: v.optional(v.number()),
    content: postDraftContent,
  },
  returns: draftView,
  handler: async (ctx, args) => {
    const actor = await access(ctx, args.communityProfileId);
    const c = args.content;
    if (
      !/^[a-zA-Z0-9_-]{8,100}$/.test(args.clientId) ||
      c.title.length > 200 ||
      c.text.length > 10000 ||
      (c.imageId?.length ?? 0) > 100 ||
      (c.providerPostId?.length ?? 0) > 100 ||
      (c.roleIds?.length ?? 0) > 100 ||
      c.roleIds?.some((id) => id.length > 100)
    )
      throw new Error("Invalid draft content.");
    if (args.draftId) {
      const draft = await owned(ctx, {
        ...args,
        draftId: args.draftId,
        expectedRevision: args.expectedRevision ?? -1,
      });
      if (draft.operationId)
        throw new Error(
          "This draft has been queued. Manage its scheduled action instead.",
        );
      await ctx.db.patch(draft._id, {
        ...c,
        imageId: c.imageId,
        roleIds: c.roleIds,
        providerPostId: c.providerPostId,
        revision: draft.revision + 1,
        updatedAt: Date.now(),
      });
      return view((await ctx.db.get(draft._id))!);
    }
    const previous = await ctx.db
      .query("clubPostDrafts")
      .withIndex("by_client", (q) =>
        q
          .eq("communityProfileId", args.communityProfileId)
          .eq("creatorTokenIdentifier", actor.subject!.tokenIdentifier)
          .eq("clientId", args.clientId),
      )
      .unique();
    if (previous) {
      if (
        previous.title !== c.title ||
        previous.text !== c.text ||
        previous.visibility !== c.visibility ||
        previous.sendNotification !== c.sendNotification ||
        previous.imageId !== c.imageId ||
        previous.providerPostId !== c.providerPostId ||
        JSON.stringify(previous.roleIds ?? []) !==
          JSON.stringify(c.roleIds ?? [])
      )
        throw new Error("Draft request already used with different content.");
      return view(previous);
    }
    const id = await ctx.db.insert("clubPostDrafts", {
      ...c,
      communityProfileId: args.communityProfileId,
      creatorTokenIdentifier: actor.subject!.tokenIdentifier,
      clientId: args.clientId,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return view((await ctx.db.get(id))!);
  },
});
export const remove = mutation({
  args: {
    ...scope,
    draftId: v.id("clubPostDrafts"),
    expectedRevision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args);
    if (draft.operationId)
      throw new Error("Manage the queued action before removing this draft.");
    await ctx.db.delete(draft._id);
    return null;
  },
});
export const queue = mutation({
  args: {
    ...scope,
    draftId: v.id("clubPostDrafts"),
    expectedRevision: v.number(),
    schedule: operationSchedule,
  },
  returns: v.id("clubOperations"),
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args);
    const content = {
      title: draft.title,
      text: draft.text,
      visibility: draft.visibility,
      sendNotification: draft.sendNotification,
      ...(draft.imageId ? { imageId: draft.imageId } : {}),
      ...(draft.roleIds ? { roleIds: draft.roleIds } : {}),
    };
    const [operationId] = await enqueueClubOperations(ctx, {
      communityProfileId: args.communityProfileId,
      requestId: `post_${draft._id}_${draft.revision}`,
      payloads: [
        draft.providerPostId
          ? { kind: "edit_post", postId: draft.providerPostId, ...content }
          : { kind: "publish_post", ...content },
      ],
      schedule: args.schedule,
    });
    await ctx.db.patch(draft._id, {
      queuedRevision: draft.revision,
      operationId,
      updatedAt: Date.now(),
    });
    return operationId;
  },
});
