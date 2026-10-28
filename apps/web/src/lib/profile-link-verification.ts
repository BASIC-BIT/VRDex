import type { z, PublicOutboundLinkSchema, PublicVerifiedConnection } from "@vrdex/api-contracts";

export type OutboundLink = z.infer<typeof PublicOutboundLinkSchema>;

export type ProfileConnectionVerification = {
  assetType: string;
  assetExternalId: string;
  verified: boolean;
};

function vrchatTarget(href: string) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== "vrchat.com" ||
      url.port || url.username || url.password || url.search || url.hash) return null;
    const match = /^\/home\/(user|group)\/((?:usr|grp)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
    if (!match) return null;
    const assetType = match[1].toLowerCase() === "user" ? "vrchat_user" : "vrchat_group";
    const id = match[2].toLowerCase();
    if (!id.startsWith(assetType === "vrchat_user" ? "usr_" : "grp_")) return null;
    return { assetType, id };
  } catch {
    return null;
  }
}

export function isVerifiedVrchatLink(href: string, connections: readonly ProfileConnectionVerification[]): boolean {
  const target = vrchatTarget(href);
  return target !== null && connections.some(connection => connection.verified &&
    connection.assetType === target.assetType && connection.assetExternalId.toLowerCase() === target.id);
}

export function mergeVerifiedVrchatLinks(
  outboundLinks: readonly OutboundLink[],
  verifiedConnections: readonly PublicVerifiedConnection[],
): Array<OutboundLink & { verifiedAt?: number }> {
  const remaining = new Map(verifiedConnections.map(connection => [
    `${connection.assetType}:${connection.assetExternalId.toLowerCase()}`, connection,
  ]));
  const links = outboundLinks.map(link => {
    const stored = { ...link };
    delete stored.verifiedAt;
    const target = link.type === "vrchat_profile" ? vrchatTarget(link.url) : null;
    const key = target && `${target.assetType}:${target.id}`;
    const connection = key ? remaining.get(key) : undefined;
    if (key) remaining.delete(key);
    return connection ? { ...stored, verifiedAt: connection.verifiedAt } : stored;
  });
  return [...links, ...Array.from(remaining.values(), connection => ({
    type: "vrchat_profile", url: connection.url,
    label: connection.displayName || connection.assetExternalId, labelMode: "custom" as const,
    verifiedAt: connection.verifiedAt,
  }))];
}

export function formatVerificationDate(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
