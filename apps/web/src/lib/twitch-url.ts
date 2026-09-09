import { type LiveClaimLink } from "./live-claim-sources";

const reservedTwitchPaths = new Set([
  "directory",
  "downloads",
  "jobs",
  "p",
  "settings",
  "subscriptions",
  "turbo",
  "videos",
]);

export function twitchLoginFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const [login, extra] = url.pathname.split("/").filter(Boolean);

    if (
      url.protocol !== "https:" ||
      hostname !== "twitch.tv" ||
      Boolean(url.username || url.password || url.search || url.hash) ||
      !login ||
      extra ||
      reservedTwitchPaths.has(login.toLowerCase()) ||
      !/^[a-zA-Z0-9_]{3,25}$/.test(login)
    ) {
      return null;
    }

    return login.toLowerCase();
  } catch {
    return null;
  }
}

/** Select the first valid channel, regardless of link provenance. */
export function twitchLinkForLiveClaim<TLink extends LiveClaimLink>(links: readonly TLink[]): TLink | null {
  return links.find((link) => link.type === "twitch" && twitchLoginFromUrl(link.url) !== null) ?? null;
}

/** Probe the same channel that the profile renders. */
export function twitchLoginForLiveClaim(links: readonly LiveClaimLink[]): string | null {
  const link = twitchLinkForLiveClaim(links);

  return link === null ? null : twitchLoginFromUrl(link.url);
}
