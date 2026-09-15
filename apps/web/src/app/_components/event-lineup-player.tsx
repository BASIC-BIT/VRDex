"use client";
import { useEffect, useRef, useState } from "react";
import { VrcdnPlayerControls } from "@/components/media/vrcdn-player-controls";
import { EventLineupSession, type LineupEvent, type LineupSnapshot } from "@/lib/event-lineup-runtime";
import { isInScheduledWatchWindow, useCurrentTimestamp } from "./event-watch-surface";
import { WatchPlayPoster } from "./vrcdn-stream-player";

export function EventLineupPlayer({ event }: { event: LineupEvent }) {
  const mount = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const session = useRef<EventLineupSession>(null);
  const [state, setState] = useState<LineupSnapshot>({ started: false, following: true, paused: true, muted: false, volume: 1, connected: false, unavailable: false });
  const [fullscreen, setFullscreen] = useState(false);
  const now = useCurrentTimestamp();
  const visible = state.started || isInScheduledWatchWindow({ ...event, now });
  useEffect(() => {
    if (!mount.current) return;
    const instance = new EventLineupSession(event, mount.current, setState);
    session.current = instance;
    return () => { instance.dispose(); session.current = null; };
    // Opening the watch window mounts the first session. Started sessions stay
    // visible after the end. Projection changes reconcile below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => { session.current?.update(event); }, [event]);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === wrapper.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (!visible) return null;
  return <div className="overflow-hidden rounded-card border border-border bg-media text-white" data-following={state.following} data-current={state.current ?? ""} ref={wrapper}>
    <div className={fullscreen ? "relative h-[calc(100%-4rem)] min-h-48" : "relative"}>
    {!state.started && <button type="button" aria-label={`Play ${event.title}`} className="block w-full" onClick={() => void session.current?.play()}><WatchPlayPoster /></button>}
    <div ref={mount} className={fullscreen ? "flex h-full items-center justify-center [&_video]:max-h-full" : state.started ? "min-h-48" : ""} />
    {state.started && <>
      {state.unavailable && <p role="status" className="absolute inset-x-4 top-4 text-sm">Stream unavailable</p>}
      <VrcdnPlayerControls label={event.title} connected={state.connected} fullscreen={fullscreen} paused={state.paused} muted={state.muted} volume={state.volume} volumeSettable
        onTogglePlay={() => state.paused ? void session.current?.play() : session.current?.pause()}
        onToggleMute={() => session.current?.mute()} onVolumeChange={value => session.current?.volume(value)}
        onToggleFullscreen={() => {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          else if (wrapper.current?.requestFullscreen) void wrapper.current.requestFullscreen().catch(() => {});
          else (mount.current?.querySelector("video:not([hidden])") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
        }} />
    </>}
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-white/20 px-4 py-3">
      <select aria-label="Performer" className="min-w-0 flex-1 rounded-control border border-white/30 bg-media px-3 py-2 text-sm" value={state.current ?? ""} onChange={event => session.current?.manual(event.target.value)}>
        <option value="">Select performer</option>
        {event.slots.map(slot => <option key={slot.key} value={slot.key}>{slot.label ?? slot.key}{slot.stream ? "" : " (Unavailable)"}</option>)}
      </select>
      {state.following ? <span className="text-sm">Following lineup</span> : <button type="button" className="rounded-control border border-white/30 px-3 py-2 text-sm" onClick={() => session.current?.live()}>Return to live</button>}
    </div>
  </div>;
}
