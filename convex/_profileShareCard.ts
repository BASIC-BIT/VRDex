import type { Doc } from "./_generated/dataModel";
import type { PublicProfileMediaKit } from "./_profileAssets";
import { visibleProfileField } from "./_profileFieldVisibility";
import { safeHttpsUrl } from "./_publicFields";
import { getProfileTrustLabel, type ProfileTrustLabel } from "./_profileStates";

export type PublicProfileShareCard = {
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  trustLabel: ProfileTrustLabel;
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

function rasterManagedImageUrl(
  asset: PublicProfileMediaKit["profileImage"],
): string | undefined {
  return asset?.mimeType === "image/png" ||
    asset?.mimeType === "image/jpeg" ||
    asset?.mimeType === "image/webp"
    ? asset.imageUrl
    : undefined;
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
  const managedProfileImage = visibleProfileField(
    profile,
    "avatarImageUrl",
    rasterManagedImageUrl(mediaKit.profileImage),
    "discovery",
  );
  const legacyProfileImage = visibleLegacyImage(profile, "avatarImageUrl");
  const bannerImage = visibleProfileField(
    profile,
    "bannerImageUrl",
    rasterManagedImageUrl(mediaKit.banner) ?? visibleLegacyImage(profile, "bannerImageUrl"),
    "discovery",
  );
  const logoImage = rasterManagedImageUrl(mediaKit.primaryLogo);
  const prefersLogo = mediaKit.compactDisplay === "logo";
  const avatarImage = prefersLogo
    ? logoImage
      ? { imageUrl: logoImage, kind: "logo" as const }
      : managedProfileImage
        ? { imageUrl: managedProfileImage, kind: "profile" as const }
        : legacyProfileImage
          ? { imageUrl: legacyProfileImage, kind: "profile" as const }
          : undefined
    : managedProfileImage
      ? { imageUrl: managedProfileImage, kind: "profile" as const }
      : logoImage
        ? { imageUrl: logoImage, kind: "logo" as const }
        : legacyProfileImage
          ? { imageUrl: legacyProfileImage, kind: "profile" as const }
          : undefined;

  return {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
    ...((headline ?? bio) ? { summary: headline ?? bio } : {}),
    ...(avatarImage ? { avatarImageUrl: avatarImage.imageUrl, avatarImageKind: avatarImage.kind } : {}),
    ...(bannerImage ? { bannerImageUrl: bannerImage } : {}),
  };
}
