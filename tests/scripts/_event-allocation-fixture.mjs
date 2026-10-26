import { resolveWorkerAllocation } from "../../workers/restream/broadcast-capacity.mjs";
import { resolveDestinationProfile } from "../../workers/restream/broadcast-profiles.mjs";
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
    allocation: resolveWorkerAllocation({
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
