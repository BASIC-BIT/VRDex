import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { validateSlugFormat } from "../../../../../convex/_globalSlugs";
import type { PublicProfileShareCard } from "../../../../../convex/_profileShareCard";
import { EntityShareCardImage, entityShareImageSize } from "../_components/entity-share-card-image";
import { fetchPublicProfileShareCardBySlug } from "@/convex/server";
import { PROFILE_ASSET_MAX_STORED_BYTES } from "@/lib/profile-asset-limits";
import { inlineableProfileShareAssetUrl } from "@/lib/profile-share-media";
import { publicSiteUrl } from "@/lib/public-site-url";

export const alt = "VRDex profile";
export const size = entityShareImageSize;
export const contentType = "image/png";

type EntityShareImageProps = {
  params: Promise<{ slug: string }>;
};

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/svg+xml", "image/webp"]);

async function inlineManagedImage(imageUrl: string | undefined): Promise<string | undefined> {
  if (!imageUrl) return undefined;

  const absoluteUrl = inlineableProfileShareAssetUrl(imageUrl, publicSiteUrl());
  if (!absoluteUrl) return undefined;

  try {
    const response = await fetch(absoluteUrl, { cache: "force-cache", redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (!response.ok || !contentType || !supportedImageTypes.has(contentType)) return undefined;

    const body = await response.arrayBuffer();
    if (body.byteLength > PROFILE_ASSET_MAX_STORED_BYTES) return undefined;

    return `data:${contentType};base64,${Buffer.from(body).toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function withInlineManagedImages(
  profile: PublicProfileShareCard | null,
): Promise<PublicProfileShareCard | null> {
  if (!profile) return null;

  const [avatarImageUrl, bannerImageUrl] = await Promise.all([
    inlineManagedImage(profile.avatarImageUrl),
    inlineManagedImage(profile.bannerImageUrl),
  ]);

  return {
    ...profile,
    avatarImageUrl,
    bannerImageUrl,
  };
}

export default async function EntityShareImage({ params }: EntityShareImageProps) {
  const { slug } = await params;

  if (!validateSlugFormat(slug).ok) {
    notFound();
  }

  const result = await fetchPublicProfileShareCardBySlug(slug);
  const profile = await withInlineManagedImages(result.kind === "live" ? result.profile : null);

  return new ImageResponse(<EntityShareCardImage profile={profile} />, size);
}
