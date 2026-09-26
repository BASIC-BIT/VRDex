export function clubNavigation(
  slug: string,
  owner: boolean,
  permissions: readonly string[],
  readableCategories: readonly string[] = [],
) {
  const root = `/account/communities/${encodeURIComponent(slug)}`;
  return [
    { label: "Home", href: root, visible: true },
    {
      label: "Analytics",
      href: `${root}/analytics`,
      visible:
        owner ||
        readableCategories.some((category) =>
          [
            "population_history",
            "group_size",
            "membership_movement",
            "individual_membership_history",
            "event_recaps",
          ].includes(category),
        ),
    },
    {
      label: "Instances",
      href: `${root}/instances`,
      visible:
        owner ||
        permissions.includes("manage_instances") ||
        readableCategories.includes("instance_history"),
    },
    {
      label: "Members",
      href: `${root}/members`,
      visible:
        owner ||
        [
          "view_members",
          "approve_join_requests",
          "invite_group_members",
          "assign_vrchat_roles",
          "remove_group_members",
          "manage_bans",
        ].some((permission) => permissions.includes(permission)),
    },
    {
      label: "Posts",
      href: `${root}/posts`,
      visible: owner || permissions.includes("publish_posts"),
    },
    {
      label: "Invitations",
      href: `${root}/invitations`,
      visible:
        owner ||
        permissions.includes("invite_group_members") ||
        permissions.includes("manage_instances"),
    },
    {
      label: "Scheduled actions",
      href: `${root}/scheduled`,
      visible:
        owner ||
        [
          "approve_join_requests",
          "invite_group_members",
          "assign_vrchat_roles",
          "remove_group_members",
          "manage_bans",
          "publish_posts",
          "manage_instances",
        ].some((permission) => permissions.includes(permission)),
    },
    {
      label: "Staff and roles",
      href: `${root}/staff`,
      visible: owner || permissions.includes("manage_staff"),
    },
    { label: "Data visibility", href: `${root}/visibility`, visible: owner },
    {
      label: "Group connection",
      href: `${root}/connection`,
      visible: owner || permissions.includes("manage_integrations"),
    },
  ].filter((item) => item.visible);
}

export function invitationSignInHref(slug: string, token: string) {
  return `/sign-in?returnTo=${encodeURIComponent(`/account/communities/${encodeURIComponent(slug)}/invite/${encodeURIComponent(token)}`)}`;
}

export const categoryLabels = {
  current_population: "Current population",
  population_history: "Population history",
  group_size: "Group size",
  instance_history: "Instance history",
  membership_movement: "Membership movement",
  individual_membership_history: "Individual membership history",
  event_recaps: "Event recaps",
} as const;

export const permissionLabels = {
  edit_community_profile: "Edit community profile",
  manage_events: "Manage events",
  manage_event_media: "Manage event media",
  view_event_operations: "View event operations",
  manage_staff: "Invite VRDex staff",
  manage_integrations: "Manage group connection",
  approve_join_requests: "Approve join requests",
  view_members: "View members",
  invite_group_members: "Invite group members",
  assign_vrchat_roles: "Assign permitted VRChat roles",
  remove_group_members: "Remove group members",
  manage_bans: "Ban and unban",
  publish_posts: "Publish posts",
  manage_instances: "Create and close instances",
  manage_scheduled_actions: "Manage scheduled actions",
  export_analytics: "Export analytics",
} as const;

export type ClubPermission = keyof typeof permissionLabels;
export const availablePermissions: readonly string[] = Object.keys(
  permissionLabels,
).filter((permission) => permission !== "export_analytics" && permission !== "edit_community_profile");
