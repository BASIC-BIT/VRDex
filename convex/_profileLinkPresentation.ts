import { parseProfileLinkDestination } from "./_profileLinkDestination";

export type ProfileLinkDestinationMetadata = {
  targetKey: string;
  kind: "vrchat_user" | "vrchat_group" | "discord_guild";
  entityId?: string;
  name?: string;
  artworkUrl?: string;
  status: "pending" | "resolved" | "unavailable" | "invalid";
  observedAt?: number;
};

type PresentableLink = {
  type: string;
  url: string;
  label?: string;
  labelMode?: "automatic" | "custom";
  destination?: ProfileLinkDestinationMetadata;
};

const PLATFORMS = { vrchat_user: "VRChat", vrchat_group: "VRChat group", discord_guild: "Discord server" };

/** Conservative legacy classification, shared by migration and every display surface. */
export function profileLinkHasCustomLabel(link: PresentableLink): boolean {
  if (link.labelMode) return link.labelMode === "custom";
  const label = link.label?.trim();
  if (!label) return false;
  const target = parseProfileLinkDestination(link);
  if (!target) return true;
  const generic = target.kind === "discord_guild" ? ["Discord"] : ["VRChat", "VRChat group"];
  return !generic.includes(label);
}

export function profileLinkPresentation(link: PresentableLink) {
  const target = parseProfileLinkDestination(link);
  if (!target) return { label: link.label ?? link.type };
  const metadata = link.destination?.targetKey === target.key && link.destination.kind === target.kind
    ? link.destination : undefined;
  const usable = metadata?.status !== "invalid" ? metadata : undefined;
  const platform = PLATFORMS[target.kind];
  const identifier = target.locator.replace(/^(usr_|grp_)/, "");
  const shortIdentifier = identifier.length > 12 ? `${identifier.slice(0, 4)}…${identifier.slice(-4)}` : identifier;
  return {
    label: profileLinkHasCustomLabel(link) && link.label?.trim()
      ? link.label.trim() : usable?.name || `${platform} ${shortIdentifier}`,
    platform,
    kind: target.kind,
    artworkUrl: usable?.artworkUrl,
  };
}
