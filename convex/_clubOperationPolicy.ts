import type { ClubPermission } from "./_clubModel";

export type ClubIntegrationFeature = "analytics" | "membership_management" | "posts" | "instances";
export type ClubOperation =
  | { kind: "approve_request" | "reject_request" | "invite_member" | "cancel_member_invite" | "remove_member" | "ban_member" | "unban_member"; targetUserId: string }
  | { kind: "assign_role" | "remove_role"; targetUserId: string; roleId: string }
  | { kind: "publish_post" | "edit_post" | "delete_post" }
  | { kind: "create_instance"; access: "members" | "plus" | "public"; ageGated?: boolean; roleRestricted?: boolean; calendarLinked?: boolean; groupVisibility?: "private" | "public" }
  | { kind: "close_instance" }
  | { kind: "invite_to_instance"; targetUserId: string; friendship: "friend" | "not_friend" | "unknown" };

/** Own-member evidence must come from the authenticated worker, never the caller or permission catalog. */
export type ProviderAuthority = {
  groupId: string;
  userId: string;
  ownerUserId?: string;
  membershipStatus: string;
  permissions: readonly string[];
  observedAt: number;
};
export type OperationAuthority = {
  actorKind: "owner" | "staff" | "none";
  permissions: readonly ClubPermission[];
  enabledFeatures: readonly ClubIntegrationFeature[];
  integrationActive: boolean;
  expectedGroupId: string;
  expectedBotUserId: string;
  provider: ProviderAuthority | null;
  permittedProviderRoleIds: readonly string[];
  now: number;
};
type OperationRequirement = { feature: ClubIntegrationFeature; permission: ClubPermission; providerPermissions: readonly string[] };

// Permission dependency evidence: docs/planning/club-management-provider-permissions-research-2026-09-09.md.
// The adapter still checks actual provider results; these requirements do not prove an operation works.
export function clubOperationRequirement(operation: ClubOperation): OperationRequirement {
  switch (operation.kind) {
    case "approve_request": case "reject_request":
      return { feature: "membership_management", permission: "approve_join_requests", providerPermissions: ["group-invites-manage"] };
    case "invite_member": case "cancel_member_invite":
      return { feature: "membership_management", permission: "invite_group_members", providerPermissions: ["group-invites-manage"] };
    case "assign_role": case "remove_role":
      return { feature: "membership_management", permission: "assign_vrchat_roles", providerPermissions: ["group-roles-assign", "group-members-manage"] };
    case "remove_member":
      return { feature: "membership_management", permission: "remove_group_members", providerPermissions: ["group-members-remove", "group-members-manage"] };
    case "ban_member": case "unban_member":
      return { feature: "membership_management", permission: "manage_bans", providerPermissions: ["group-bans-manage", "group-members-manage"] };
    case "publish_post": case "edit_post": case "delete_post":
      return { feature: "posts", permission: "publish_posts", providerPermissions: ["group-announcement-manage"] };
    case "close_instance":
      return { feature: "instances", permission: "manage_instances", providerPermissions: ["group-instance-manage"] };
    case "invite_to_instance":
      // No group-role exemption from friendship is established. The provider adapter must also
      // verify destination access; invitation acceptance is not permission to enter the instance.
      return { feature: "instances", permission: "manage_instances", providerPermissions: [] };
    case "create_instance": {
      const providerPermissions = [operation.access === "members" ? "group-instance-open-create" : operation.access === "plus" ? "group-instance-plus-create" : "group-instance-public-create"];
      if (operation.ageGated) providerPermissions.push("group-instance-age-gated-create");
      if (operation.roleRestricted) providerPermissions.push("group-instance-restricted-create");
      if (operation.calendarLinked) providerPermissions.push("group-instance-calendar-link");
      return { feature: "instances", permission: "manage_instances", providerPermissions };
    }
  }
}

export type OperationDenial = "staff_permission" | "feature_disabled" | "integration_inactive" | "provider_authority" | "provider_permissions" | "protected_target" | "role_not_assignable" | "invalid_instance_options" | "recipient_eligibility";
export type OperationAssessment = { allowed: boolean; reason: OperationDenial | null; missingPermissions: string[] };
export const PROVIDER_AUTHORITY_MAX_AGE_MS = 60_000;

/** Apply to each target at dispatch time, including resumed batches and edited scheduled jobs. */
export function assessClubOperation(authority: OperationAuthority, operation: ClubOperation): OperationAssessment {
  const deny = (reason: OperationDenial, missingPermissions: string[] = []): OperationAssessment => ({ allowed: false, reason, missingPermissions });
  const requirement = clubOperationRequirement(operation);
  if (authority.actorKind === "none" || (authority.actorKind !== "owner" && !authority.permissions.includes(requirement.permission))) return deny("staff_permission");
  if (!authority.enabledFeatures.includes(requirement.feature)) return deny("feature_disabled");
  if (!authority.integrationActive) return deny("integration_inactive");
  const provider = authority.provider;
  if (!provider || provider.groupId !== authority.expectedGroupId || provider.userId !== authority.expectedBotUserId ||
      provider.membershipStatus !== "member" || !Number.isFinite(authority.now) || !Number.isFinite(provider.observedAt) ||
      provider.observedAt > authority.now || authority.now - provider.observedAt > PROVIDER_AUTHORITY_MAX_AGE_MS) return deny("provider_authority");
  const changesProtectedMember = operation.kind === "assign_role" || operation.kind === "remove_role" || operation.kind === "remove_member" || operation.kind === "ban_member" || operation.kind === "unban_member";
  if (changesProtectedMember && "targetUserId" in operation && (operation.targetUserId === authority.expectedBotUserId || operation.targetUserId === provider.ownerUserId)) return deny("protected_target");
  if ((operation.kind === "assign_role" || operation.kind === "remove_role") && authority.actorKind !== "owner" && !authority.permittedProviderRoleIds.includes(operation.roleId)) return deny("role_not_assignable");
  if (operation.kind === "create_instance" && ((operation.access === "public" && operation.groupVisibility !== "public") || (operation.roleRestricted && operation.access !== "members"))) return deny("invalid_instance_options");
  if (operation.kind === "invite_to_instance" && operation.friendship !== "friend") return deny("recipient_eligibility");
  const missing = provider.permissions.includes("*") ? [] : requirement.providerPermissions.filter(permission => !provider.permissions.includes(permission));
  if (missing.length) return deny("provider_permissions", missing);
  return { allowed: true, reason: null, missingPermissions: [] };
}
