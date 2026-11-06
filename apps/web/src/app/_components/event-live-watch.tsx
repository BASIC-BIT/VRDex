"use client";


import { eventPlaybackRequest } from "@/lib/event-playback-request";
import type { PublicEvent } from "./event-public-page";
import { EventWatchSurface } from "./event-watch-surface";
import { EventLineupPlayer } from "./event-lineup-player";

export function EventWatchForEvent({ event }: { event: PublicEvent | null }) {
  if (!event || event.scheduleKind === "date_only" || event.startAt === undefined || event.status === "cancelled") return null;
  const playbackRequest = eventPlaybackRequest(event) ?? undefined;
  if (playbackRequest?.kind === "performer_sequence") return <EventLineupPlayer playbackRequest={playbackRequest} event={playbackRequest.event} />;
  if (!event.watchSurfaceEnabled) return null;
  return <EventWatchSurface playbackRequest={playbackRequest} doorsOpenAt={event.doorsOpenAt} endAt={event.endAt} enabled mediaLinks={event.mediaLinks} startAt={event.startAt} />;
}
