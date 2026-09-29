"use client";


import type { PublicEvent } from "./event-public-page";
import { EventWatchSurface } from "./event-watch-surface";
import { EventLineupPlayer } from "./event-lineup-player";

export function EventWatchForEvent({ event }: { event: PublicEvent | null }) {
  if (!event || event.status === "cancelled" || !event.watchSurfaceEnabled) return null;
  if (event.watchMode === "performer_sequence") return <EventLineupPlayer event={{
    title: event.title, startAt: event.startAt, doorsOpenAt: event.doorsOpenAt, endAt: event.endAt,
    slots: event.slots.map(slot => ({ key: slot.playbackKey ?? "", startAt: slot.startAt, endAt: slot.endAt,
      performerId: slot.performer?.slug, label: slot.displayLabel, stream: slot.stream })),
  }} />;
  return <EventWatchSurface doorsOpenAt={event.doorsOpenAt} endAt={event.endAt} enabled mediaLinks={event.mediaLinks} startAt={event.startAt} />;
}
