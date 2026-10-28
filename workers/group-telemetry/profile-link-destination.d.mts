import type { Infer } from "convex/values";
import type { destinationGroupMetadataValidator } from "../../convex/_profileLinkDestination";
type GroupMetadata = Infer<typeof destinationGroupMetadataValidator>;
export type DestinationKind = "vrchat_user" | "vrchat_group" | "discord_guild";
export type DestinationTarget = { kind: DestinationKind; locator: string };
export type DestinationResolution =
  | { status: "resolved"; entityId: string; displayName: string; groupMetadata?: GroupMetadata; artworkSourceUrl?: string; artworkType?: "user_icon" | "group_icon" | "server_icon" }
  | { status: "invalid" | "inaccessible" | "transient"; retryAfterMs?: number; groupMetadata?: GroupMetadata };
export function allowedDestinationArtworkUrl(value: unknown, kind: DestinationKind): string | undefined;
export function resolveProfileLinkDestination(target: DestinationTarget, dependencies?: {
  requestVrchat?: (path: string) => Promise<unknown>;
  fetcher?: typeof fetch;
}): Promise<DestinationResolution>;
