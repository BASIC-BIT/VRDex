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

const supportedProfileMediaMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

const profileMediaMimeTypeByExtension: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function profileMediaMimeType(fileType: string, fileName: string): string | null {
  const normalizedType = fileType.trim().toLowerCase();
  if (supportedProfileMediaMimeTypes.has(normalizedType)) return normalizedType;
  if (normalizedType && normalizedType !== "application/octet-stream") return null;

  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension ? profileMediaMimeTypeByExtension[extension] ?? null : null;
}
