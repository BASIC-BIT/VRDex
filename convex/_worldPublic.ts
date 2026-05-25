import type { Doc } from "./_generated/dataModel";

function optionalField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function toPublicWorld(world: Doc<"worlds">) {
  const sourceUrl = safeHttpsUrl(world.sourceUrl);
  const heroImageUrl = safeHttpsUrl(world.heroImageUrl);
  const canonicalVrchatWorldUrl = safeHttpsUrl(world.canonicalVrchatWorldUrl);
  const sourceAttributionUrl = safeHttpsUrl(world.sourceAttribution?.url);

  return {
    slug: world.slug,
    displayName: world.displayName,
    tags: world.tags,
    visibilityStatus: world.visibilityStatus,
    platformCompatibility: world.platformCompatibility,
    media: world.media.flatMap((media) => {
      const mediaUrl = safeHttpsUrl(media.url);

      if (mediaUrl === undefined) {
        return [];
      }

      return [{ ...media, url: mediaUrl }];
    }),
    creatorAttributions: world.creatorAttributions.map((attribution) => ({
      role: attribution.role,
      displayName: attribution.displayName,
      ...optionalField("profileSlug", attribution.profileSlug),
      ...optionalField("profileType", attribution.profileType),
      ...optionalField("sourceLabel", attribution.sourceLabel),
    })),
    outboundLinks: world.outboundLinks.flatMap((link) => {
      const linkUrl = safeHttpsUrl(link.url);

      if (linkUrl === undefined) {
        return [];
      }

      return [{ ...link, url: linkUrl }];
    }),
    source: world.sourceAttribution
      ? {
          sourceType: world.sourceAttribution.sourceType,
          label: world.sourceAttribution.label,
          ...optionalField("url", sourceAttributionUrl),
          ...optionalField("confirmedAt", world.sourceAttribution.confirmedAt),
        }
      : undefined,
    ...optionalField("summary", world.summary),
    ...optionalField("description", world.description),
    ...optionalField("vrchatWorldId", world.vrchatWorldId),
    ...optionalField("canonicalVrchatWorldUrl", canonicalVrchatWorldUrl),
    ...optionalField("sourceUrl", sourceUrl),
    ...optionalField("heroImageUrl", heroImageUrl),
  };
}
