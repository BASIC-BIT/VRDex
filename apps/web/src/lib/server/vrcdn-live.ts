import "server-only";

import { unstable_cache } from "next/cache";

import {
  type VrcdnLiveLink,
  type VrcdnLiveObservation,
  type VrcdnLiveState,
  type VrcdnLiveStates,
  vrcdnLiveStateFromStatus,
  vrcdnReportedState,
  vrcdnStreamIds,
} from "@/lib/vrcdn-live";

import { createVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

// This no longer blocks the profile render. Production observations showed the
// media server regularly taking about 3.8 seconds to answer from Vercel, so the
// old 1.5 second budget converted valid answers into `unavailable` before they
// arrived. Five seconds keeps the request bounded without preserving that race.
const probeTimeoutMs = 5000;

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
      throw new Error(`VRCDN transport request returned HTTP ${response.status}.`);
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
  context: { attempt?: 1 | 2; profileSlug?: string } = {},
): Promise<VrcdnLiveStates | undefined> {
  const streamIds = vrcdnStreamIds(links);

  if (streamIds.length === 0) {
    return undefined;
  }

  const states = await Promise.all(
    streamIds.map(async (streamId): Promise<[string, VrcdnLiveState]> => {
      const startedAt = Date.now();

      try {
        return [streamId, vrcdnReportedState(await getCachedVrcdnLiveState(streamId), Date.now())];
      } catch (error) {
        console.error(JSON.stringify({
          attempt: context.attempt ?? 1,
          durationMs: Date.now() - startedAt,
          errorKind: error instanceof Error ? error.name : "UnknownError",
          level: "error",
          message: "VRCDN live-state lookup failed",
          ...(context.profileSlug ? { profileSlug: context.profileSlug } : {}),
          reason: error instanceof Error ? error.message.slice(0, 160) : "Unknown failure",
          streamId,
        }));
        return [streamId, "unavailable"];
      }
    }),
  );

  return Object.fromEntries(states);
}
