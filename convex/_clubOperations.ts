import { v, type Infer } from "convex/values";
import type { ClubOperation } from "./_clubOperationPolicy";
const target = { targetUserId: v.string() };
const post = {
  title: v.string(),
  text: v.string(),
  visibility: v.union(v.literal("public"), v.literal("group")),
  sendNotification: v.boolean(),
  imageId: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
};
const destination = { worldId: v.string(), instanceId: v.string() };
export const clubOperationPayload = v.union(
  v.object({
    kind: v.literal("invite_to_created_instance"),
    ...target,
    creationOperationId: v.id("clubOperations"),
    // Optional for stored legacy rows; new invitations must provide review evidence.
    creationRevision: v.optional(v.number()),
  }),
  v.object({ kind: v.literal("approve_request"), ...target }),
  v.object({ kind: v.literal("reject_request"), ...target }),
  v.object({ kind: v.literal("invite_member"), ...target }),
  v.object({ kind: v.literal("cancel_member_invite"), ...target }),
  v.object({ kind: v.literal("remove_member"), ...target }),
  v.object({ kind: v.literal("ban_member"), ...target }),
  v.object({ kind: v.literal("unban_member"), ...target }),
  v.object({ kind: v.literal("assign_role"), ...target, roleId: v.string() }),
  v.object({ kind: v.literal("remove_role"), ...target, roleId: v.string() }),
  v.object({ kind: v.literal("publish_post"), ...post }),
  v.object({ kind: v.literal("edit_post"), postId: v.string(), ...post }),
  v.object({ kind: v.literal("delete_post"), postId: v.string() }),
  v.object({
    kind: v.literal("create_instance"),
    worldId: v.string(),
    access: v.union(
      v.literal("members"),
      v.literal("plus"),
      v.literal("public"),
    ),
    region: v.union(
      v.literal("us"),
      v.literal("use"),
      v.literal("eu"),
      v.literal("jp"),
    ),
    ageGated: v.optional(v.boolean()),
    roleIds: v.optional(v.array(v.string())),
    calendarEntryId: v.optional(v.string()),
    queueEnabled: v.optional(v.boolean()),
  }),
  v.object({ kind: v.literal("close_instance"), ...destination }),
  v.object({
    kind: v.literal("invite_to_instance"),
    ...target,
    ...destination,
    messageSlot: v.optional(v.number()),
  }),
);
export type OperationPayload = Infer<typeof clubOperationPayload>;
export const operationSchedule = v.union(
  v.object({
    kind: v.literal("immediate"),
    eventId: v.optional(v.id("events")),
  }),
  v.object({
    kind: v.literal("fixed"),
    dueAt: v.number(),
    eventId: v.optional(v.id("events")),
  }),
  v.object({
    kind: v.literal("event_relative"),
    eventId: v.id("events"),
    offsetMs: v.number(),
  }),
);
export const operationState = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("submitted"),
  v.literal("succeeded"),
  v.literal("rejected"),
  v.literal("indeterminate"),
  v.literal("cancelled"),
  v.literal("missed"),
);
export const LATE_GRACE_MS = 15 * 60_000;
export const CLAIM_MS = 240_000;
export function policyOperation(
  op: OperationPayload,
  groupVisibility: "public" | "private" | "unknown",
  friendship: "friend" | "not_friend" | "unknown" = "unknown",
): ClubOperation {
  if (op.kind === "invite_to_created_instance")
    return {
      kind: "invite_to_instance",
      targetUserId: op.targetUserId,
      friendship,
    };
  if (op.kind === "create_instance")
    return {
      ...op,
      roleRestricted: !!op.roleIds?.length,
      calendarLinked: !!op.calendarEntryId,
      ...(groupVisibility !== "unknown" ? { groupVisibility } : {}),
    };
  if (op.kind === "invite_to_instance") return { ...op, friendship };
  return op;
}
export function validatePayload(op: OperationPayload, groupId: string) {
  const id = (value: string, prefix: string) => {
    if (
      !new RegExp(
        `^${prefix}_[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`,
      ).test(value)
    )
      throw new Error("Invalid provider ID.");
  };
  if ("targetUserId" in op) id(op.targetUserId, "usr");
  if ("roleId" in op) id(op.roleId, "grol");
  if ("worldId" in op) id(op.worldId, "wrld");
  if ("postId" in op) id(op.postId, "not");
  if ("calendarEntryId" in op && op.calendarEntryId)
    id(op.calendarEntryId, "cal");
  if ("imageId" in op && op.imageId) id(op.imageId, "file");
  if ("roleIds" in op && op.roleIds) {
    if (
      op.roleIds.length > 100 ||
      new Set(op.roleIds).size !== op.roleIds.length
    )
      throw new Error("Invalid role selection.");
    op.roleIds.forEach((x) => id(x, "grol"));
  }
  if (
    "title" in op &&
    (op.title.length < 1 ||
      op.title.length > 200 ||
      op.text.length < 1 ||
      op.text.length > 10000)
  )
    throw new Error("Invalid post content.");
  if ("visibility" in op && op.roleIds?.length && op.visibility !== "group")
    throw new Error("Role-restricted posts must use group visibility.");
  if (
    op.kind === "create_instance" &&
    op.roleIds?.length &&
    op.access !== "members"
  )
    throw new Error("Restricted instances require members access.");
  if ("instanceId" in op) {
    const groups = [...op.instanceId.matchAll(/~group\(([^)]+)\)/g)];
    if (
      op.instanceId.length > 500 ||
      /[\s:/?#\\%]/.test(op.instanceId) ||
      groups.length !== 1 ||
      groups[0][1] !== groupId
    )
      throw new Error("Instance does not belong to this group.");
  }
  if (
    op.kind === "invite_to_instance" &&
    op.messageSlot !== undefined &&
    (!Number.isInteger(op.messageSlot) ||
      op.messageSlot < 0 ||
      op.messageSlot > 11)
  )
    throw new Error("Invalid invitation message.");
}
