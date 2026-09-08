import type { ProfileLinkType } from "../../../../convex/_profileLinks";

const PROVIDERS: Array<[ProfileLinkType, string[]]> = [
  ["vrchat_profile", ["vrchat.com"]], ["vrcdn", ["vrcdn.live"]],
  ["discord", ["discord.com", "discord.gg", "discordapp.com"]],
  ["twitch", ["twitch.tv"]], ["youtube", ["youtube.com", "youtu.be"]],
  ["soundcloud", ["soundcloud.com"]], ["mixcloud", ["mixcloud.com"]],
  ["spotify", ["spotify.com", "spotify.link"]], ["bandcamp", ["bandcamp.com"]],
  ["instagram", ["instagram.com"]], ["linktree", ["linktr.ee", "linktree.com"]],
  ["gumroad", ["gumroad.com"]], ["jinxxy", ["jinxxy.com"]],
  ["payhip", ["payhip.com"]], ["kofi", ["ko-fi.com"]], ["patreon", ["patreon.com"]],
];

export function detectProfileLinkType(value: string): ProfileLinkType {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "website";
    return PROVIDERS.find(([, hosts]) => hosts.some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`)))?.[0] ?? "website";
  } catch {
    return "website";
  }
}
