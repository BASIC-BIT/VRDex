export function hasRenderableProfileMediaKit({
  additionalLogoCount,
  galleryAssetCount,
  galleryEnabled,
  hasPrimaryLogo,
  logoCount,
}: {
  additionalLogoCount: number;
  galleryAssetCount: number;
  galleryEnabled: boolean;
  hasPrimaryLogo: boolean;
  logoCount: number;
}) {
  return galleryEnabled
    ? galleryAssetCount > 0 || logoCount > 0
    : hasPrimaryLogo || additionalLogoCount > 0;
}
