export type PublicSearchBackendFilters = {
  entityType?: "profile" | "world" | "event";
  profileType?: "person" | "community";
};

export function publicSearchBackendFilters(type: string): PublicSearchBackendFilters {
  if (type === "world" || type === "event") {
    return { entityType: type };
  }

  if (type === "person" || type === "community") {
    return {
      entityType: "profile",
      profileType: type,
    };
  }

  if (type === "profile") {
    return { entityType: "profile" };
  }

  return {};
}
