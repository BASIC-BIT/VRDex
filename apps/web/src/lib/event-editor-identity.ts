import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type EventSearchResult = FunctionReturnType<
  typeof api.search.searchUniversal
>[number];
export type EventPersonResult = FunctionReturnType<
  typeof api.profiles.lookupPeople
>[number];
export type EventIdentityOption = {
  kind: "person" | "community" | "world";
  slug: string;
  title: string;
  href: string;
  imageUrl?: string;
  imageKind: "profile" | "logo";
  appearance?: EventPersonResult["avatarAppearance"];
  context?: string;
  trustLabel?: EventPersonResult["trustLabel"];
};

export function personIdentityOption(
  person: EventPersonResult,
): EventIdentityOption {
  return {
    kind: "person",
    slug: person.slug,
    title: person.displayName,
    href: person.profilePath,
    imageUrl: person.avatarImageUrl,
    imageKind: person.avatarImageKind ?? "profile",
    appearance: person.avatarAppearance,
    trustLabel: person.trustLabel,
    context:
      [...new Set([...person.roleTags, ...person.tags])]
        .slice(0, 3)
        .join(" / ") || undefined,
  };
}

export function searchIdentityOption(
  result: EventSearchResult,
): EventIdentityOption | null {
  if (
    result.entityType === "profile" &&
    result.profileType === "person" &&
    result.person
  ) {
    return personIdentityOption(result.person);
  }
  if (
    result.entityType !== "world" &&
    !(result.entityType === "profile" && result.profileType === "community")
  )
    return null;
  return {
    kind: result.entityType === "world" ? "world" : "community",
    slug: result.slug,
    title: result.title,
    href: result.routePath,
    imageUrl: result.imageUrl,
    imageKind:
      result.logoImageUrl !== undefined &&
      result.imageUrl === result.logoImageUrl &&
      result.logoImageUrl !== result.profileImageUrl
        ? "logo"
        : "profile",
    appearance: result.avatarAppearance,
    context: result.subtitle,
    trustLabel: result.trustLabel,
  };
}
