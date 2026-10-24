import { type LiveClaimLink } from "./live-claim-sources";

import { twitchLoginFromUrl } from "../../../../convex/_twitchLinks";
export { twitchLoginFromUrl } from "../../../../convex/_twitchLinks";

/** Select the first valid channel, regardless of link provenance. */
export function twitchLinkForLiveClaim<TLink extends LiveClaimLink>(links: readonly TLink[]): TLink | null {
  return links.find((link) => link.type === "twitch" && twitchLoginFromUrl(link.url) !== null) ?? null;
}

/** Probe the same channel that the profile renders. */
export function twitchLoginForLiveClaim(links: readonly LiveClaimLink[]): string | null {
  const link = twitchLinkForLiveClaim(links);

  return link === null ? null : twitchLoginFromUrl(link.url);
}
