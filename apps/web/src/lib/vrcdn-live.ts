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
  source: string;
  type: string;
  url: string;
};

/**
 * Link provenance a liveness claim may rest on.
 *
 * `community_submitted` is deliberately absent. `submitCommunityProfile`
 * publishes immediately, and a community submission is one signed-in person
 * adding somebody else's profile -- so a stranger could attach a stream id they
 * do not own and make an unclaimed profile announce that person is live. A
 * `404` cannot tell "not publishing" from "not their stream", so the probe
 * cannot catch this; only provenance can.
 *
 * The link still renders. It is the claim about who is streaming that needs a
 * vetted source.
 */
const liveClaimLinkSources = new Set(["owner_authored", "partner_provided", "reviewed"]);

export function vrcdnLiveStateFromStatus(status: number): VrcdnLiveState {
  if (status === 404) {
    return "offline";
  }

  // `200` exactly, not 2xx. The verified contract is a manifest served behind a
  // `200`; a bodyless success from an intermediary -- a `204`, a cache layer's
  // `205` -- is that intermediary answering, not VRCDN saying someone is
  // publishing, and it should not light up `Live now`.
  return status === 200 ? "live" : "unavailable";
}

/**
 * How old an observation may be before it stops being reported.
 *
 * The sixty-second cache window does not bound this on its own.
 * `unstable_cache` serves the stale entry while it refreshes, and a refresh
 * that throws leaves the previous answer in place -- so a stream that was live
 * when VRCDN started failing would keep claiming `Live now` for as long as the
 * failure lasted. Sixty seconds is when the answer is refreshed; this is when
 * it stops counting as an answer.
 */
export const maxVrcdnObservationAgeMs = 5 * 60_000;

export type VrcdnLiveObservation = {
  observedAt: number;
  state: VrcdnLiveState;
};

export function vrcdnReportedState(observation: VrcdnLiveObservation, now: number): VrcdnLiveState {
  return now - observation.observedAt <= maxVrcdnObservationAgeMs ? observation.state : "unavailable";
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
        link.type === "vrcdn" && liveClaimLinkSources.has(link.source)
          ? parseVrcdnStreamLinks(link.url)?.streamId ?? []
          : [],
      ),
    ),
  ];
}
