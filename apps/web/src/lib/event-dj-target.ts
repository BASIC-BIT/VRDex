import { parseVrcdnStreamLinks } from "../../../../convex/_vrcdnLinks";
export type DjTarget = { key: string; label: string; url: string; pcUrl?: string; questUrl?: string };

export function eventDjTarget(url: string): DjTarget | undefined {
  const stream = parseVrcdnStreamLinks(url);
  if (stream !== null) return stream.directVideoUrl
    ? { key: `vrcdn:${stream.directVideoUrl}`, label: "VRCDN", url: stream.directVideoUrl }
    : { key: `vrcdn:${stream.streamId}`, label: stream.streamId, url: stream.reference, pcUrl: stream.pcUrl, questUrl: stream.questUrl };
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.port) return;
    if (!["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(target.hostname)) return;
    const channel = target.pathname.match(/^\/([a-zA-Z0-9_]{1,25})\/?$/)?.[1]?.toLowerCase();
    if (!channel || ["directory", "downloads", "jobs", "p", "search", "settings", "subscriptions", "videos"].includes(channel)) return;
    return { key: `twitch:${channel}`, label: "Twitch", url: `https://www.twitch.tv/${channel}` };
  } catch { return; }
}

