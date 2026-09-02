import { type LiveClaimLink, carriesLiveClaim } from "./live-claim-sources";

import { parseVrcdnStreamLinks } from "../../../../convex/_vrcdnLinks";

/**
 * VRCDN publishes no liveness API, so this is read off the transport stream at
 * `stream.vrcdn.live/live/<id>.live.ts` -- the endpoint a Quest client pulls.
 *
 *     GET .live.ts   live -> 200 (video/mp2t)   idle -> 404   unknown id -> 401
 *     GET .m3u8      live -> 404                idle -> 404   unknown id -> 404
 *     HEAD .live.ts  live -> 200                idle -> 200   unknown id -> 200
 *
 * Measured against a real stream on 2026-08-10, live and then idle. The HLS
 * manifest was the original mechanism and is inert -- it answers `404` for a
 * stream that is actively publishing, so it could never report anyone live.
 * `HEAD` answers `200` for stream ids that do not exist, so it is not a signal
 * either. `vrcdn.live` itself is a Blazor SPA that answers `200` with the app
 * shell for unknown paths, which rules out the page and `/api/live` as well.
 *
 * `unavailable` is kept distinct from `offline` because a probe that could not
 * finish is not evidence that anyone stopped streaming.
 *
 * Note this endpoint serves media: it ignores `Range` and begins pushing MPEG-TS
 * as soon as it answers, so the probe drops the body immediately. Whether that
 * still spends one of the operator's viewer slots is not answerable from
 * outside their account. See `#217`.
 */
export type VrcdnLiveState = "live" | "offline" | "unavailable";

export type VrcdnLiveStates = Record<string, VrcdnLiveState>;

export function isVrcdnLiveState(value: unknown): value is VrcdnLiveState {
  return value === "live" || value === "offline" || value === "unavailable";
}

export function parseVrcdnLiveStates(value: unknown): VrcdnLiveStates | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (!entries.every(([, state]) => isVrcdnLiveState(state))) {
    return null;
  }

  return Object.fromEntries(entries);
}

export function shouldRetryVrcdnLiveStates(states: VrcdnLiveStates): boolean {
  return Object.values(states).some((state) => state === "unavailable");
}

/**
 * Apply only provider answers that say something authoritative about whether a
 * stream is publishing. `unavailable` means the probe failed, not that a live
 * stream stopped, so it must not clear a player while the bounded retry runs.
 */
export function mergeConfirmedVrcdnLiveStates(
  current: VrcdnLiveStates,
  incoming: VrcdnLiveStates,
): VrcdnLiveStates {
  const confirmed = Object.fromEntries(
    Object.entries(current).filter(([, state]) => state !== "unavailable"),
  );

  for (const [streamId, state] of Object.entries(incoming)) {
    if (state !== "unavailable") {
      confirmed[streamId] = state;
    }
  }

  return confirmed;
}

export const vrcdnLiveRetryDelayMs = 750;

export type VrcdnLiveLink = LiveClaimLink;

export function vrcdnLiveStateFromStatus(status: number): VrcdnLiveState {
  // `404` is a real stream that is not publishing. `401` is an id the media
  // server does not know, which the badge treats the same way -- nobody is
  // live either way. They are worth keeping apart in the probe because this
  // endpoint, unlike the manifest, actually does distinguish them: a typo in an
  // owner's own link reads `401` forever, where an idle stream reads `404`.
  if (status === 404 || status === 401) {
    return "offline";
  }

  // `200` exactly, not 2xx. A bodyless success from an intermediary -- a `204`,
  // a cache layer's `205` -- is that intermediary answering, not VRCDN handing
  // over a transport stream, and it should not light up `Live now`.
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
        link.type === "vrcdn" && carriesLiveClaim(link)
          ? parseVrcdnStreamLinks(link.url)?.streamId ?? []
          : [],
      ),
    ),
  ];
}
