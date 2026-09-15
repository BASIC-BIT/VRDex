import { v, type Infer } from "convex/values";

export const clubPermission = v.union(
  v.literal("edit_community_profile"),
  v.literal("manage_events"),
  v.literal("manage_event_media"),
  v.literal("view_event_operations"),
  v.literal("manage_staff"),
  v.literal("manage_integrations"),
  v.literal("view_members"),
  v.literal("approve_join_requests"),
  v.literal("invite_group_members"),
  v.literal("assign_vrchat_roles"),
  v.literal("remove_group_members"),
  v.literal("manage_bans"),
  v.literal("publish_posts"),
  v.literal("manage_instances"),
  v.literal("manage_scheduled_actions"),
  v.literal("export_analytics"),
);
export type ClubPermission = Infer<typeof clubPermission>;
export const CLUB_PERMISSIONS: ClubPermission[] = [
  "edit_community_profile",
  "manage_events",
  "manage_event_media",
  "view_event_operations",
  "manage_staff",
  "manage_integrations",
  "view_members",
  "approve_join_requests",
  "invite_group_members",
  "assign_vrchat_roles",
  "remove_group_members",
  "manage_bans",
  "publish_posts",
  "manage_instances",
  "manage_scheduled_actions",
  "export_analytics",
];
export const clubCategory = v.union(
  v.literal("current_population"),
  v.literal("population_history"),
  v.literal("group_size"),
  v.literal("instance_history"),
  v.literal("membership_movement"),
  v.literal("individual_membership_history"),
  v.literal("event_recaps"),
);
export type ClubCategory = Infer<typeof clubCategory>;
export const CLUB_CATEGORIES: ClubCategory[] = [
  "current_population",
  "population_history",
  "group_size",
  "instance_history",
  "membership_movement",
  "individual_membership_history",
  "event_recaps",
];
export const clubAudience = v.union(
  v.literal("public"),
  v.literal("staff"),
  v.literal("owner"),
);
export const categoryVisibility = v.object({
  audience: clubAudience,
  staffRoleIds: v.union(v.null(), v.array(v.id("communityRoles"))),
});
export const clubVisibility = v.object({
  current_population: categoryVisibility,
  population_history: categoryVisibility,
  group_size: categoryVisibility,
  instance_history: categoryVisibility,
  membership_movement: categoryVisibility,
  individual_membership_history: categoryVisibility,
  event_recaps: categoryVisibility,
});
export type ClubVisibility = Infer<typeof clubVisibility>;
export const clubSubject = v.object({
  tokenIdentifier: v.string(),
  issuer: v.string(),
  subject: v.string(),
  displayName: v.optional(v.string()),
});
export function defaultClubVisibility(): ClubVisibility {
  return Object.fromEntries(
    CLUB_CATEGORIES.map((key) => [
      key,
      {
        audience: key === "individual_membership_history" ? "owner" : "staff",
        staffRoleIds: null,
      },
    ]),
  ) as ClubVisibility;
}
export const LEGACY_CATEGORY_MAP = {
  currentPopulation: "current_population",
  populationHistory: "population_history",
  groupMemberCount: "group_size",
  groupMemberGrowth: "membership_movement",
  eventRecaps: "event_recaps",
} as const;
