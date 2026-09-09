export type DestinationKind = "vrchat_user" | "vrchat_group" | "discord_guild";
export type DestinationTarget = { kind: DestinationKind; locator: string };
export type DestinationResolution =
  | { status: "resolved"; entityId: string; displayName: string; artworkSourceUrl?: string; artworkType?: "profile_picture" | "group_icon" | "server_icon" }
  | { status: "invalid" | "inaccessible" | "transient"; retryAfterMs?: number };
export function allowedDestinationArtworkUrl(value: unknown, kind: DestinationKind): string | undefined;
export function resolveProfileLinkDestination(target: DestinationTarget, dependencies?: {
  requestVrchat?: (path: string) => Promise<unknown>;
  fetcher?: typeof fetch;
}): Promise<DestinationResolution>;
