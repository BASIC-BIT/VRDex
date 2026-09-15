import { v, type Infer } from "convex/values";
import type { ClubPermission } from "./_clubModel";
export const providerReadKind = v.union(
  v.literal("members"),
  v.literal("search"),
  v.literal("member"),
  v.literal("requests"),
  v.literal("invites"),
  v.literal("roles"),
  v.literal("instance_roles"),
  v.literal("instances"),
  v.literal("invitation_eligibility"),
  v.literal("bans"),
  v.literal("posts"),
);
export const providerReadParams = v.object({
  kind: providerReadKind,
  n: v.number(),
  offset: v.number(),
  search: v.optional(v.string()),
  userId: v.optional(v.string()),
  worldId: v.optional(v.string()),
  instanceId: v.optional(v.string()),
});
export type ProviderReadParams = Infer<typeof providerReadParams>;
export const providerReadItem = v.object({
  friendship: v.optional(v.union(v.literal("friend"), v.literal("not_friend"))),
  destinationState: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("pending"))),
  invitationEligibility: v.optional(v.union(v.literal("eligible"), v.literal("not_friend"), v.literal("destination_closed"), v.literal("destination_pending"))),
  id: v.string(),
  userId: v.optional(v.string()),
  displayName: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  joinedAt: v.optional(v.string()),
  membershipStatus: v.optional(v.string()),
  name: v.optional(v.string()),
  title: v.optional(v.string()),
  text: v.optional(v.string()),
  createdAt: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
  visibility: v.optional(v.string()),
  imageId: v.optional(v.string()),
  worldId: v.optional(v.string()),
  instanceId: v.optional(v.string()),
});
export const providerReadPage = v.object({
  items: v.array(providerReadItem),
  nextOffset: v.union(v.number(), v.null()),
  observedAt: v.number(),
});
export const READ_FRESH_MS = 60_000;
export const READ_RETENTION_MS = 15 * 60_000;
export function readRequirement(kind: ProviderReadParams["kind"]): {
  permission: ClubPermission;
  feature: "membership_management" | "posts" | "instances";
  grants: string[];
} {
  const feature = kind === "posts" ? "posts" : "membership_management";
  switch (kind) {
    case "invitation_eligibility":
    case "instances":
      return {
        permission: "manage_instances",
        feature: "instances",
        grants: [],
      };
    case "instance_roles":
      return {
        permission: "manage_instances",
        feature: "instances",
        grants: ["group-instance-restricted-create"],
      };
    case "posts":
      return {
        permission: "publish_posts",
        feature,
        grants: ["group-announcement-manage"],
      };
    case "requests":
      return {
        permission: "approve_join_requests",
        feature,
        grants: ["group-invites-manage"],
      };
    case "invites":
      return {
        permission: "invite_group_members",
        feature,
        grants: ["group-invites-manage"],
      };
    case "bans":
      return {
        permission: "manage_bans",
        feature,
        grants: ["group-bans-manage", "group-members-manage"],
      };
    case "roles":
      return {
        permission: "assign_vrchat_roles",
        feature,
        grants: ["group-roles-assign", "group-members-manage"],
      };
    default:
      return {
        permission: "view_members",
        feature,
        grants: ["group-members-viewall", "group-members-manage"],
      };
  }
}
export function checkedReadParams(
  input: ProviderReadParams,
): ProviderReadParams {
  if (
    !Number.isInteger(input.n) ||
    input.n < 1 ||
    input.n > 100 ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    input.offset > 10_000_000
  )
    throw new Error("Invalid member page.");
  if (input.kind === "search") {
    if (
      !input.search ||
      input.search.trim().length < 3 ||
      input.search.length > 100
    )
      throw new Error("Enter at least three characters.");
  } else if (input.search !== undefined) throw new Error("Unexpected search.");
  if (input.kind === "member" || input.kind === "invitation_eligibility") {
    if (
      !/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.userId ?? "",
      ) ||
      input.offset !== 0
    )
      throw new Error("Invalid member.");
  } else if (input.userId !== undefined) throw new Error("Unexpected member.");
  if (input.kind === "invitation_eligibility") {
    if (input.n !== 1 || (input.worldId === undefined) !== (input.instanceId === undefined)) throw new Error("Invalid eligibility check.");
    if (input.worldId !== undefined && (!/^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.worldId) || !input.instanceId || input.instanceId.length > 500)) throw new Error("Invalid invitation destination.");
  } else if (input.worldId !== undefined || input.instanceId !== undefined) throw new Error("Unexpected destination.");
  return {
    kind: input.kind,
    n: input.n,
    offset: input.offset,
    ...(input.search !== undefined ? { search: input.search.trim() } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.worldId !== undefined ? { worldId: input.worldId, instanceId: input.instanceId } : {}),
  };
}
