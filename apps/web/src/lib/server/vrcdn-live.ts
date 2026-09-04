import "server-only";

import { unstable_cache } from "next/cache";

import {
  type VrcdnLiveLink,
  type VrcdnLiveStates,
  vrcdnStreamIds,
} from "@/lib/vrcdn-live";
import {
  collectVrcdnLiveStates,
  probeVrcdnLiveState,
  type VrcdnLiveProbeResult,
  type VrcdnProbeFreshnessMode,
  type VrcdnProbeLogEntry,
} from "@/lib/vrcdn-live-probe";

// Production observations showed the media server regularly taking about 3.8
// seconds to answer from Vercel, so the old 1.5 second budget converted valid
// answers into `unavailable` before they arrived. Five seconds keeps the
// server-rendered initial check bounded without preserving that race.
const probeTimeoutMs = 5000;

async function getFreshVrcdnLiveState(streamId: string): Promise<VrcdnLiveProbeResult> {
  return probeVrcdnLiveState(streamId, { signal: AbortSignal.timeout(probeTimeoutMs) });
}

const getCachedVrcdnLiveState = unstable_cache(
  async (streamId: string): Promise<VrcdnLiveProbeResult> => {
    const result = await getFreshVrcdnLiveState(streamId);

    // Thrown rather than cached so a transient provider or intermediary answer
    // does not become every viewer's answer for the next minute.
    if (result.state === "unavailable") {
      throw new Error("VRCDN transport request was unavailable.");
    }

    return result;
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
  context: { freshnessMode?: VrcdnProbeFreshnessMode } = {},
): Promise<VrcdnLiveStates | undefined> {
  const streamIds = vrcdnStreamIds(links);

  if (streamIds.length === 0) {
    return undefined;
  }

  const log = (entry: VrcdnProbeLogEntry) => {
    const serialized = JSON.stringify(entry);
    if (entry.level === "error") {
      console.error(serialized);
    } else {
      console.info(serialized);
    }
  };

  return collectVrcdnLiveStates(streamIds, {
    freshnessMode: context.freshnessMode ?? "cached",
    log,
    readCached: getCachedVrcdnLiveState,
    readFresh: getFreshVrcdnLiveState,
  });
}
