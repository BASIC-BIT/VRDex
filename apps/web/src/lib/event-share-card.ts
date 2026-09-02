import { createHash } from "node:crypto";
import type { Metadata } from "next";

import type { PublicEventShareCard } from "../../../../convex/_eventShareCard";
import { DEFAULT_SHARE_DESCRIPTION } from "./profile-share-card";
import { publicEventPath } from "./event-path";

export const eventShareImageSize = { width: 1200, height: 630 } as const;

function compactText(value: string | undefined, maximumLength: number): string | undefined {
  const compact = value?.trim().replace(/\s+/g, " ");
  if (!compact) return undefined;

  const characters = Array.from(compact);
  if (characters.length <= maximumLength) return compact;
  return `${characters.slice(0, maximumLength - 1).join("").trimEnd()}…`;
}

export function eventShareDescription(
  card: Pick<PublicEventShareCard, "summary">,
): string {
  return compactText(card.summary, 200) ?? DEFAULT_SHARE_DESCRIPTION;
}

export function eventShareTitleFontSize(title: string): number {
  const length = Array.from(title).length;
  if (length > 80) return 38;
  if (length > 58) return 46;
  if (length > 38) return 56;
  return 68;
}

export function eventShareRevision(card: PublicEventShareCard): string {
  return createHash("sha256")
    .update(JSON.stringify(card))
    .digest("hex")
    .slice(0, 16);
}

export function eventShareMetadata(card: PublicEventShareCard): Metadata {
  const title = `${card.title} | VRDex`;
  const description = eventShareDescription(card);
  const path = publicEventPath(card)!;
  const imagePath = `${path}/opengraph-image?revision=${eventShareRevision(card)}`;
  const image = {
    alt: `${card.title} event preview`,
    height: eventShareImageSize.height,
    type: "image/png",
    url: imagePath,
    width: eventShareImageSize.width,
  };

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
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
