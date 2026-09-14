export function clubNavigation(
  slug: string,
  owner: boolean,
  permissions: readonly string[],
) {
  const root = `/account/communities/${encodeURIComponent(slug)}`;
  return [
    { label: "Home", href: root, visible: true },
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
).slice(0, 6);
