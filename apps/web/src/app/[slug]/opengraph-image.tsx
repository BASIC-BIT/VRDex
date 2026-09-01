import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import sharp from "sharp";

import { validateSlugFormat } from "../../../../../convex/_globalSlugs";
import type { PublicProfileShareCard } from "../../../../../convex/_profileShareCard";
import { EntityShareCardImage, entityShareImageSize } from "../_components/entity-share-card-image";
import { fetchPublicProfileShareCardBySlug } from "@/convex/server";
import { PROFILE_ASSET_MAX_STORED_BYTES } from "@/lib/profile-asset-limits";
import {
  inlineableProfileShareAssetUrl,
  isInlineableProfileShareAssetContentType,
} from "@/lib/profile-share-media";
import { publicSiteUrl } from "@/lib/public-site-url";

export const alt = "VRDex public page";
export const size = entityShareImageSize;
export const contentType = "image/png";
export const runtime = "nodejs";

type EntityShareImageProps = {
  params: Promise<{ slug: string }>;
};

type InlineImageBounds = {
  height: number;
  width: number;
};

async function inlineManagedImage(
  imageUrl: string | undefined,
  bounds: InlineImageBounds,
): Promise<string | undefined> {
  if (!imageUrl) return undefined;

  const absoluteUrl = inlineableProfileShareAssetUrl(imageUrl, publicSiteUrl());
  if (!absoluteUrl) return undefined;

  try {
    const response = await fetch(absoluteUrl, {
      cache: absoluteUrl.pathname.startsWith("/api/e2e/fixture-assets/") ? "no-store" : "force-cache",
      redirect: "error",
    });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (!response.ok || !contentType || !isInlineableProfileShareAssetContentType(contentType)) {
      return undefined;
    }

    let body: Uint8Array<ArrayBufferLike> = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > PROFILE_ASSET_MAX_STORED_BYTES) return undefined;

    let inlineContentType = contentType;
    if (contentType === "image/webp") {
      body = await sharp(body)
        .resize({
          fit: "inside",
          height: bounds.height,
          width: bounds.width,
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      inlineContentType = "image/png";
      if (body.byteLength > PROFILE_ASSET_MAX_STORED_BYTES) return undefined;
    }

    return `data:${inlineContentType};base64,${Buffer.from(body).toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function withInlineManagedImages(
  profile: PublicProfileShareCard | null,
): Promise<PublicProfileShareCard | null> {
  if (!profile) return null;

  const [avatarImageUrl, bannerImageUrl] = await Promise.all([
    inlineManagedImage(profile.avatarImageUrl, { height: 184, width: 184 }),
    inlineManagedImage(profile.bannerImageUrl, entityShareImageSize),
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

  if (result.kind === "live" && result.entityType === null) {
    notFound();
  }

  const profile = await withInlineManagedImages(result.kind === "live" ? result.profile : null);

  return new ImageResponse(<EntityShareCardImage profile={profile} />, size);
}
