"use client";
import { useEffect } from "react";
import type { EventPlaybackOwner, PlaybackRequest } from "@/lib/event-playback-owner";
import { useEventPlaybackSnapshot } from "./event-playback-provider";
import { isInScheduledWatchWindow, useCurrentTimestamp } from "./event-watch-surface";
import { WatchPlayPoster } from "./vrcdn-stream-player";

/** Presentation-only. There is deliberately no video, iframe, or transport mount here. */
export function EventPlaybackInline({ owner, request }: { owner: EventPlaybackOwner; request: PlaybackRequest }) {
  const state = useEventPlaybackSnapshot(owner);
  const active = state.request?.eventId === request.eventId;
  const now = useCurrentTimestamp();
  useEffect(() => { owner.update(request); }, [owner, request]);
  if (!active && !isInScheduledWatchWindow({ ...request, now })) return null;
  return <div className="overflow-hidden rounded-card border border-border bg-media text-white" data-event-playback-inline={request.eventId}>
    <button type="button" aria-label={`Play ${request.title}`} className="block w-full" onClick={() => void owner.play(request)}><WatchPlayPoster /></button>
    {request.kind === "twitch" && request.sourceId.startsWith("https://") && <a className="block px-4 py-3" href={request.sourceId} target="_blank" rel="noreferrer">Open stream</a>}
    {active && <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <button type="button" onClick={() => state.status === "playing" || state.status === "loading" ? owner.pause() : void owner.play(request)}>{state.status === "playing" || state.status === "loading" ? "Pause" : "Play"}</button>
      {request.kind === "performer_sequence" && <>
        <select aria-label="Performer" className="min-w-0 flex-1 bg-media" value={state.lineup?.current ?? ""} onChange={event => owner.manual(event.target.value)}>
          <option value="">Select performer</option>
          {request.event.slots.map(slot => <option key={slot.key} value={slot.key}>{slot.label ?? slot.key}{slot.stream ? "" : " (Unavailable)"}</option>)}
        </select>
        {state.lineup?.nextPlaybackBlocked && <button type="button" aria-label="Enable next performer playback" onClick={() => owner.retryNextPlayback()}>Enable playback</button>}
        {state.lineup?.following ? <span>Following lineup</span> : <button type="button" onClick={() => owner.live()}>Return to live</button>}
      </>}
    </div>}
  </div>;
}
