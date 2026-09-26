import { v } from "convex/values";
export const postDraftContent = v.object({
  title: v.string(),
  text: v.string(),
  visibility: v.union(v.literal("public"), v.literal("group")),
  sendNotification: v.boolean(),
  imageId: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  providerPostId: v.optional(v.string()),
});
