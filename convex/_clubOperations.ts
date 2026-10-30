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
const staffOperationMembers = [
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
  v.object({ kind: v.literal("edit_post"), postId: v.string(), expectedUpdatedAt: v.optional(v.string()), postPageOffset: v.optional(v.number()), ...post }),
  v.object({ kind: v.literal("delete_post"), postId: v.string(), expectedUpdatedAt: v.optional(v.string()), postPageOffset: v.optional(v.number()) }),
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
] as const;
export const staffOperationPayload = v.union(...staffOperationMembers);
export type StaffOperationPayload = Infer<typeof staffOperationPayload>;

// VRChat group calendar operations: connector-owned, never staff-enqueued or listed.
export const CALENDAR_OPERATION_KINDS = ["create_calendar_event", "update_calendar_event", "delete_calendar_event", "list_calendar_events"] as const;
const calendarEvent = {
  title: v.string(),
  description: v.string(),
  startsAt: v.string(),
  endsAt: v.string(),
  imageUrl: v.optional(v.string()),
  accessType: v.literal("group"),
};
const calendarOperationMembers = [
  v.object({ kind: v.literal("create_calendar_event"), ...calendarEvent }),
  v.object({ kind: v.literal("update_calendar_event"), calendarEventId: v.string(), ...calendarEvent }),
  v.object({ kind: v.literal("delete_calendar_event"), calendarEventId: v.string() }),
  v.object({ kind: v.literal("list_calendar_events"), from: v.string(), to: v.string() }),
] as const;
export const calendarEventItem = v.object({ id: v.string(), title: v.string(), description: v.string(), startsAt: v.string(), endsAt: v.string(), updatedAt: v.string() });
export type VrchatCalendarItem = Infer<typeof calendarEventItem>;
export const operationResult = v.object({
  worldId: v.optional(v.string()),
  instanceId: v.optional(v.string()),
  postId: v.optional(v.string()),
  calendarEventId: v.optional(v.string()),
  calendarEvents: v.optional(v.array(calendarEventItem)),
  calendarEventsTruncated: v.optional(v.boolean()),
});
export const clubOperationPayload = v.union(...staffOperationMembers, ...calendarOperationMembers);
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
  if (op.kind === "edit_post" || op.kind === "delete_post") {
    if (!op.expectedUpdatedAt || op.expectedUpdatedAt.length > 100 || !Number.isFinite(Date.parse(op.expectedUpdatedAt)) ||
        !Number.isSafeInteger(op.postPageOffset) || op.postPageOffset! < 0 || op.postPageOffset! > 10_000_000)
      throw new Error("Refresh to continue.");
  }
  if ("calendarEntryId" in op && op.calendarEntryId)
    id(op.calendarEntryId, "cal");
  if ("calendarEventId" in op) id(op.calendarEventId, "cal");
  if ("imageId" in op && op.imageId) id(op.imageId, "file");
  if ("roleIds" in op && op.roleIds) {
    if (
      op.roleIds.length > 100 ||
      new Set(op.roleIds.map((roleId) => roleId.toLowerCase())).size !== op.roleIds.length
    )
      throw new Error("Invalid role selection.");
    op.roleIds.forEach((x) => id(x, "grol"));
  }
  if (
    (op.kind === "publish_post" || op.kind === "edit_post") &&
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
  validateCalendarPayload(op);
}
// VRChat group calendar payload rules.
function validateCalendarPayload(op: OperationPayload) {
  if (op.kind === "create_calendar_event" || op.kind === "update_calendar_event") {
    const startsAt = Date.parse(op.startsAt);
    const endsAt = Date.parse(op.endsAt);
    if (op.title.length < 1 || op.title.length > 64 || op.description.length < 1 || op.description.length > 2000 ||
        !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)
      throw new Error("Invalid calendar event.");
    if (op.imageUrl !== undefined && (op.imageUrl.length > 2048 || !isHttpsUrl(op.imageUrl)))
      throw new Error("Invalid calendar event.");
  }
  if (op.kind === "list_calendar_events") {
    const from = Date.parse(op.from);
    const to = Date.parse(op.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 92 * 86_400_000)
      throw new Error("Invalid calendar range.");
  }
}
function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
