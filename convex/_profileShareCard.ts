import type { Doc } from "./_generated/dataModel";
import type { PublicProfileMediaKit } from "./_profileAssets";
import { visibleProfileField } from "./_profileFieldVisibility";
import { safeHttpsUrl } from "./_publicFields";

export type PublicProfileShareCard = {
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  summary?: string;
  avatarImageUrl?: string;
  avatarImageKind?: "profile" | "logo";
  bannerImageUrl?: string;
};

function visibleLegacyImage(
  profile: Doc<"profiles">,
  key: "avatarImageUrl" | "bannerImageUrl",
): string | undefined {
  return safeHttpsUrl(visibleProfileField(profile, key, profile[key], "discovery"));
}

/**
 * The intentionally small projection used outside the profile page itself.
 *
 * A Discord unfurl is a public card, not the direct profile page. `unlisted`
 * fields therefore stay out just as they do in search and discovery, while the
 * globally public identity fields remain available. Managed media placements
 * follow the same avatar/banner visibility controls as their legacy URL
 * counterparts.
 */
export function toPublicProfileShareCard(
  profile: Doc<"profiles">,
  mediaKit: PublicProfileMediaKit,
): PublicProfileShareCard {
  const headline = visibleProfileField(profile, "headline", profile.headline, "discovery");
  const bio = visibleProfileField(profile, "bio", profile.bio, "discovery");
  const profileImage = visibleProfileField(
    profile,
    "avatarImageUrl",
    mediaKit.profileImage?.imageUrl ?? visibleLegacyImage(profile, "avatarImageUrl"),
    "discovery",
  );
  const bannerImage = visibleProfileField(
    profile,
    "bannerImageUrl",
    mediaKit.banner?.imageUrl ?? visibleLegacyImage(profile, "bannerImageUrl"),
    "discovery",
  );
  const logoImage = mediaKit.primaryLogo?.imageUrl;
  const prefersLogo = mediaKit.compactDisplay === "logo";
  const avatarImageUrl = prefersLogo
    ? logoImage ?? profileImage
    : profileImage ?? logoImage;
  const avatarImageKind = avatarImageUrl === undefined
    ? undefined
    : avatarImageUrl === logoImage && logoImage !== profileImage
      ? "logo" as const
      : "profile" as const;

  return {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    ...((headline ?? bio) ? { summary: headline ?? bio } : {}),
    ...(avatarImageUrl ? { avatarImageUrl } : {}),
    ...(avatarImageKind ? { avatarImageKind } : {}),
    ...(bannerImage ? { bannerImageUrl: bannerImage } : {}),
  };
}
