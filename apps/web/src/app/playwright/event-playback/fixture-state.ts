import type { PublicEvent } from "@/app/_components/event-public-page";

/** Synthetic public projection shared by the UI fixture and its authorization response. */
export function playbackFixtureEvent(eventId: "a" | "b", twitch: boolean, startAt: number): PublicEvent {
  return {
    id: eventId, slug: eventId, title: `Event ${eventId}`, startAt,
    watchSurfaceEnabled: true,
    source: { sourceType: "manual", label: "Playback fixture" },
    authoredMediaLinks: [],
    mediaLinks: [{
      type: "watch", label: "Program", presentation: "open",
      url: twitch ? "https://www.twitch.tv/fixture" : `https://stream.vrcdn.live/live/playback-${eventId}.webm`,
    }],
    worlds: [], participants: [], slots: [], participantCount: 0, slotCount: 0,
  };
}
