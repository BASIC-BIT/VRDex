import { parseVrcdnStreamLinks } from "../../../../convex/_vrcdnLinks";

/**
 * VRCDN publishes no liveness API, so this is read off the HLS manifest.
 * `vrcdn.live` is a Blazor SPA that answers `200` with the app shell for
 * unknown paths, which makes both the page and `/api/live` useless as signals.
 *
 * `offline` is a real `404` from the media server, and it cannot separate "not
 * publishing" from "no such stream" -- which is why a stream id has to come
 * from an owner-confirmed link rather than from the probe. `unavailable` is
 * kept distinct from `offline` because a probe that could not finish is not
 * evidence that anyone stopped streaming.
 */
export type VrcdnLiveState = "live" | "offline" | "unavailable";

export type VrcdnLiveLink = {
  type: string;
  url: string;
};

export function vrcdnLiveStateFromStatus(status: number): VrcdnLiveState {
  if (status === 404) {
    return "offline";
  }

  return status >= 200 && status < 300 ? "live" : "unavailable";
}

/**
 * One id per stream, however it was spelled. A profile can carry the panel
 * preview, the playlist, and the Quest transport stream for the same broadcast,
 * and probing each spelling separately would ask VRCDN the same question three
 * times.
 */
export function vrcdnStreamIds(links: readonly VrcdnLiveLink[]): string[] {
  return [
    ...new Set(
      links.flatMap((link) =>
        link.type === "vrcdn" ? parseVrcdnStreamLinks(link.url)?.streamId ?? [] : [],
      ),
    ),
  ];
}
