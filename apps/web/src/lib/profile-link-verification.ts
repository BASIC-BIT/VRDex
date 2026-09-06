export type ProfileConnectionVerification = {
  assetType: string;
  assetExternalId: string;
  verified: boolean;
};

export function isVerifiedVrchatLink(
  href: string,
  connections: readonly ProfileConnectionVerification[],
): boolean {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "vrchat.com" ||
      url.port || url.username || url.password || url.search || url.hash) return false;
    const match = /^\/home\/(user|group)\/((?:usr|grp)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
    if (!match) return false;
    const assetType = match[1].toLowerCase() === "user" ? "vrchat_user" : "vrchat_group";
    const id = match[2].toLowerCase();
    if (!id.startsWith(assetType === "vrchat_user" ? "usr_" : "grp_")) return false;
    return connections.some((connection) => connection.verified &&
      connection.assetType === assetType && connection.assetExternalId.toLowerCase() === id);
  } catch {
    return false;
  }
}
