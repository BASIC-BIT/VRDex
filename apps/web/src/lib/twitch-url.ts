import { type LiveClaimLink, carriesLiveClaim } from "./live-claim-sources";

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

/**
 * The channel a profile may be reported live on, or `null`.
 *
 * Provenance is applied here rather than at the fetch, so the rule that decides
 * whether a live claim is allowed sits next to the rule that decides what a
 * Twitch link is, and can be tested without the Twitch API.
 *
 * A `community_submitted` link is skipped: anyone signed in can publish a
 * profile for somebody else with an arbitrary channel attached, and Helix would
 * happily report that channel live -- along with its title and viewer count.
 */
export function twitchLoginForLiveClaim(links: readonly LiveClaimLink[]): string | null {
  return (
    links
      .filter((link) => link.type === "twitch" && carriesLiveClaim(link))
      .map((link) => twitchLoginFromUrl(link.url))
      .find((candidate): candidate is string => candidate !== null) ?? null
  );
}
