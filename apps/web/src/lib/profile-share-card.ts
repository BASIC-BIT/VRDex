import type { Metadata } from "next";

import type { PublicProfileShareCard } from "../../../../convex/_profileShareCard";

export const DEFAULT_SHARE_DESCRIPTION = "A VRChat-first identity, profile, and events platform.";

function compactText(value: string | undefined, maximumLength: number): string | undefined {
  const compact = value?.trim().replace(/\s+/g, " ");

  if (!compact) {
    return undefined;
  }

  const characters = Array.from(compact);

  if (characters.length <= maximumLength) {
    return compact;
  }

  return `${characters.slice(0, maximumLength - 1).join("").trimEnd()}…`;
}

export function profileShareDescription(card: Pick<PublicProfileShareCard, "summary">): string {
  return compactText(card.summary, 200) ?? DEFAULT_SHARE_DESCRIPTION;
}

export function profileShareTrustNote(
  card: Pick<PublicProfileShareCard, "trustLabel">,
): string | undefined {
  if (card.trustLabel === "community_submitted") return "Community submitted";
  if (card.trustLabel === "unclaimed") return "Unclaimed";
  return undefined;
}

export function profileShareNameFontSize(displayName: string): number {
  const length = Array.from(displayName).length;
  if (length > 64) return 28;
  if (length > 48) return 36;
  if (length > 34) return 46;
  if (length > 22) return 66;
  return 76;
}

export function profileShareMetadata(card: PublicProfileShareCard): Metadata {
  const title = `${card.displayName} | VRDex`;
  const description = profileShareDescription(card);
  const path = `/${encodeURIComponent(card.slug)}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "VRDex",
      url: path,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export function profileInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase())
    .join("");

  return initials || "VR";
}
