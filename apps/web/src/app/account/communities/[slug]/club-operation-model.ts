import type { FunctionArgs } from "convex/server";
import type { api } from "@convex-generated-api";
export type ClubOperationPayload = FunctionArgs<
  typeof api.clubOperations.enqueue
>["payloads"][number];
export const operationLabels: Record<ClubOperationPayload["kind"], string> = {
  approve_request: "Approve request",
  reject_request: "Reject request",
  invite_member: "Invite member",
  cancel_member_invite: "Cancel invitation",
  assign_role: "Assign role",
  remove_role: "Remove role",
  remove_member: "Remove member",
  ban_member: "Ban member",
  unban_member: "Unban member",
  publish_post: "Publish post",
  edit_post: "Edit post",
  delete_post: "Delete post",
  create_instance: "Create instance",
  close_instance: "Close instance",
  invite_to_instance: "Invite to instance",
  invite_to_created_instance: "Invite to scheduled instance",
};
export function operationPermission(payload: ClubOperationPayload) {
  switch (payload.kind) {
    case "approve_request":
    case "reject_request":
      return "approve_join_requests";
    case "invite_member":
    case "cancel_member_invite":
      return "invite_group_members";
    case "assign_role":
    case "remove_role":
      return "assign_vrchat_roles";
    case "remove_member":
      return "remove_group_members";
    case "ban_member":
    case "unban_member":
      return "manage_bans";
    case "publish_post":
    case "edit_post":
    case "delete_post":
      return "publish_posts";
    default:
      return "manage_instances";
  }
}
export function canEditOperation(
  actor: {
    kind: string;
    permissions: readonly string[];
    subject?: { tokenIdentifier: string };
  },
  payload: ClubOperationPayload,
  authorToken: string,
) {
  return (
    actor.kind === "owner" ||
    (actor.kind === "staff" &&
      actor.permissions.includes(operationPermission(payload)) &&
      (actor.subject?.tokenIdentifier === authorToken ||
        actor.permissions.includes("manage_scheduled_actions")))
  );
}
export function localDateTime(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function operationReason(code: string | null) {
  if (!code) return null;
  const labels: Record<string, string> = {
    staff_permission: "Staff permission changed",
    feature_disabled: "Feature disabled",
    integration_inactive: "Group connection unavailable",
    provider_authority: "Permission check unavailable",
    protected_target: "Protected member",
    role_not_assignable: "Role not permitted",
    invalid_instance_options: "Instance options unavailable",
    recipient_eligibility: "Recipient unavailable",
    provider_permissions: "VRChat permission required",
    connection_changed: "Group connection changed",
    event_cancelled: "Event cancelled",
    late_window_elapsed: "Scheduled time missed",
    submission_outcome_unknown: "Outcome unknown",
    operation_budget_too_low: "Request budget too low",
    submission_not_attempted: "Not sent",
    instance_creation_rescheduled: "Instance creation moved after this invitation",
    instance_creation_failed: "Instance creation failed",
  };
  return labels[code] ?? null;
}
