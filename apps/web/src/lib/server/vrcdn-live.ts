import "server-only";

import { unstable_cache } from "next/cache";

import {
  type VrcdnLiveLink,
  type VrcdnLiveObservation,
  type VrcdnLiveState,
  vrcdnLiveStateFromStatus,
  vrcdnReportedState,
  vrcdnStreamIds,
} from "@/lib/vrcdn-live";

import { createVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

// A probe measured at ~190ms. The Twitch lookup's four seconds buys a token
// exchange and an API call; this is one status code, and the budget is the
// profile page's, since nothing renders until the probe settles.
const probeTimeoutMs = 1500;

const getCachedVrcdnLiveState = unstable_cache(
  async (streamId: string): Promise<VrcdnLiveObservation> => {
    const stream = createVrcdnStreamLinks(streamId);

    if (stream === null) {
      return { observedAt: Date.now(), state: "unavailable" };
    }

    // The transport stream, not the HLS manifest. The manifest answers `404`
    // for a stream that is actively publishing, so probing it could never
    // report anyone live.
    const response = await fetch(stream.questUrl, { signal: AbortSignal.timeout(probeTimeoutMs) });

    // Dropped before a frame is read. This endpoint serves media and ignores
    // `Range`, so it starts pushing MPEG-TS the moment it answers; cancelling
    // here is what keeps the probe to a connection rather than a download.
    // Whether VRCDN counts that against the operator's viewer cap cannot be
    // determined from outside their account.
    await response.body?.cancel();

    const state = vrcdnLiveStateFromStatus(response.status);

    // Thrown rather than returned so a transient CDN failure is not what the
    // next sixty seconds of viewers see. The caller degrades to `unavailable`
    // for this request only.
    if (state === "unavailable") {
      throw new Error(`VRCDN manifest request returned HTTP ${response.status}.`);
    }

    return { observedAt: Date.now(), state };
  },
  ["vrcdn-live-state"],
  { revalidate: 60 },
);

/**
 * Liveness for every VRCDN stream on a profile, keyed by stream id.
 *
 * Probed when the profile is viewed rather than on a schedule, which is what
 * keeps this off the open question in #217: whether a manifest request counts
 * against the operator's viewer cap. A sweep would ask that question of every
 * stream every cycle whether or not anyone was looking.
 *
 * `undefined` when the profile has no VRCDN link, so callers can leave the
 * field off entirely instead of publishing an empty map.
 */
export async function getVrcdnLiveStates(
  links: readonly VrcdnLiveLink[],
): Promise<Record<string, VrcdnLiveState> | undefined> {
  const streamIds = vrcdnStreamIds(links);

  if (streamIds.length === 0) {
    return undefined;
  }

  const states = await Promise.all(
    streamIds.map(async (streamId): Promise<[string, VrcdnLiveState]> => {
      try {
        return [streamId, vrcdnReportedState(await getCachedVrcdnLiveState(streamId), Date.now())];
      } catch (error) {
        console.error(`VRCDN live-state lookup failed for ${streamId}:`, error);
        return [streamId, "unavailable"];
      }
    }),
  );

  return Object.fromEntries(states);
}
