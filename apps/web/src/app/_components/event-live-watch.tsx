"use client";


import { eventPlaybackRequest } from "@/lib/event-playback-request";
import type { PublicEvent } from "./event-public-page";
import { EventWatchSurface } from "./event-watch-surface";
import { EventLineupPlayer } from "./event-lineup-player";

export function EventWatchForEvent({ event }: { event: PublicEvent | null }) {
  if (!event || event.scheduleKind === "date_only" || event.startAt === undefined || event.status === "cancelled" || !event.watchSurfaceEnabled) return null;
  const playbackRequest = eventPlaybackRequest(event) ?? undefined;
  if (event.watchMode === "performer_sequence") return <EventLineupPlayer playbackRequest={playbackRequest} event={{
    title: event.title, startAt: event.startAt, doorsOpenAt: event.doorsOpenAt, endAt: event.endAt,
    slots: event.slots.map(slot => ({ key: slot.playbackKey ?? "", startAt: slot.startAt, endAt: slot.endAt,
      performerId: slot.performer?.slug, label: slot.displayLabel, stream: slot.stream })),
  }} />;
  return <EventWatchSurface playbackRequest={playbackRequest} doorsOpenAt={event.doorsOpenAt} endAt={event.endAt} enabled mediaLinks={event.mediaLinks} startAt={event.startAt} />;
}
