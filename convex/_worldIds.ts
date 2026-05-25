export const VRCHAT_WORLD_ID_PATTERN =
  /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidVrchatWorldId(worldId: string): boolean {
  return VRCHAT_WORLD_ID_PATTERN.test(worldId.trim());
}

export function toCanonicalVrchatWorldUrl(worldId: string): string | null {
  const trimmed = worldId.trim();

  if (!isValidVrchatWorldId(trimmed)) {
    return null;
  }

  return `https://vrchat.com/home/world/${trimmed}`;
}

export function toVrchatWorldShortUrl(worldId: string): string | null {
  const trimmed = worldId.trim();

  if (!isValidVrchatWorldId(trimmed)) {
    return null;
  }

  return `https://vrch.at/${trimmed}`;
}
