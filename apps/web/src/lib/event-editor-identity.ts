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

export type EventPerformerValue =
  | { kind: "manual"; label: string }
  | { kind: "linked"; personSlug: string; billing: { kind: "default" } | { kind: "override"; label: string } };

export function savedEventPerformer({ label, personSlug, profileName }: { label: string; personSlug?: string | null; profileName?: string }): EventPerformerValue {
  if (!personSlug) return { kind: "manual", label };
  return { kind: "linked", personSlug, billing: profileName !== undefined && (!label || label === profileName) ? { kind: "default" } : { kind: "override", label } };
}

export function selectEventPerformer({ current, person }: { current: EventPerformerValue; person: EventIdentityOption }): EventPerformerValue {
  if (person.kind !== "person") throw new Error("Performer selection requires a person.");
  return { kind: "linked", personSlug: person.slug, billing: current.kind === "linked" ? current.billing : current.label.trim() ? { kind: "override", label: current.label } : { kind: "default" } };
}

export function eventPerformerLabel({ value, profileName }: { value: EventPerformerValue; profileName?: string }): string {
  return value.kind === "manual" ? value.label : value.billing.kind === "override" ? value.billing.label : profileName ?? "";
}
