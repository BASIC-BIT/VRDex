import "server-only";

import { unstable_cache } from "next/cache";

import {
  type VrcdnLiveLink,
  type VrcdnLiveState,
  vrcdnLiveStateFromStatus,
  vrcdnStreamIds,
} from "@/lib/vrcdn-live";

import { createVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

const probeTimeoutMs = 4000;

const getCachedVrcdnLiveState = unstable_cache(
  async (streamId: string): Promise<VrcdnLiveState> => {
    const stream = createVrcdnStreamLinks(streamId);

    if (stream === null) {
      return "unavailable";
    }

    const response = await fetch(stream.hlsUrl, { signal: AbortSignal.timeout(probeTimeoutMs) });

    // The status carries the whole answer, so the body is dropped rather than
    // read. Nothing here pulls a media segment, which is the part that would
    // plausibly spend one of the operator's paid viewer slots.
    await response.body?.cancel();

    const state = vrcdnLiveStateFromStatus(response.status);

    // Thrown rather than returned so a transient CDN failure is not what the
    // next sixty seconds of viewers see. The caller degrades to `unavailable`
    // for this request only.
    if (state === "unavailable") {
      throw new Error(`VRCDN manifest request returned HTTP ${response.status}.`);
    }

    return state;
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
        return [streamId, await getCachedVrcdnLiveState(streamId)];
      } catch (error) {
        console.error(`VRCDN live-state lookup failed for ${streamId}:`, error);
        return [streamId, "unavailable"];
      }
    }),
  );

  return Object.fromEntries(states);
}
