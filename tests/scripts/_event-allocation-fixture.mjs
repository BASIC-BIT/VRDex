import { createCapacityResolver } from "../../workers/restream/broadcast-capacity.mjs";
import { VIDEO_PROFILES, resolveDestinationProfile } from "../../workers/restream/broadcast-profiles.mjs";

// Synthetic unit-test allocations, never measured production evidence.
const fixtureEntries = Object.fromEntries(
  Object.keys(VIDEO_PROFILES).flatMap(videoPreset =>
    [false, true].map(simulcastEnabled => [
      `${videoPreset}:${simulcastEnabled}`,
      { cpuUnits: 4096, memoryMiB: 8192, evidenceId: "fixture-capacity-v1" },
    ]),
  ),
);
/** @type {import("../../workers/restream/broadcast-capacity.mjs").CapacityResolver} */
export const fixtureCapacityResolver = createCapacityResolver(fixtureEntries);

/** @param {{sessionId?: string, primary?: string, optional?: string, videoPreset?: import("../../workers/restream/broadcast-profiles.mjs").VideoPreset, audioBitrateKbps?: 160|320}} [options] */
export function allocatedSession({
  sessionId = "session",
  primary = "primary",
  optional,
  videoPreset = "720p30",
  audioBitrateKbps = 320,
} = {}) {
  const mediaSettings = { videoPreset, audioBitrateKbps };
  return {
    sessionId,
    outputId: primary,
    mediaSettings,
    allocation: fixtureCapacityResolver({
      videoPreset,
      simulcastEnabled: optional !== undefined,
    }),
    destinationProfiles: [
      {
        outputId: primary,
        destination: "vrcdn",
        profile: resolveDestinationProfile({
          settings: mediaSettings,
          destination: "vrcdn",
        }),
      },
      ...(optional
        ? [
            {
              outputId: optional,
              destination: "twitch",
              profile: resolveDestinationProfile({
                settings: mediaSettings,
                destination: "twitch",
              }),
            },
          ]
        : []),
    ],
  };
}
