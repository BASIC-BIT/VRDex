"use client";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex-generated-api";
import { EventPlaybackOwner } from "@/lib/event-playback-owner";
import { createEventPlaybackAdapter } from "@/lib/event-playback-adapters";
import { eventPlaybackRequest } from "@/lib/event-playback-request";
import { retainPlaybackAuthorization } from "@/lib/event-playback-revalidation";
import { VrcdnPlayerControls } from "@/components/media/vrcdn-player-controls";

const Context = createContext<EventPlaybackOwner | null>(null);
export function useEventPlayback() { return useContext(Context); }
export function useEventPlaybackSnapshot(owner: EventPlaybackOwner) { return useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot); }

/** This mount never moves. Inline UI registers intent only; Task 9 may position this
 * fixed shell over an inline placeholder using CSS geometry, never portals/reparenting. */
export function EventPlaybackProvider({ children }: { children: ReactNode }) {
  const mount = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => new EventPlaybackOwner((request, notify) => {
    if (!mount.current) throw new Error("Playback mount unavailable");
    return createEventPlaybackAdapter(request, mount.current, notify);
  }));
  const state = useEventPlaybackSnapshot(owner);
  const [fullscreen, setFullscreen] = useState(false);
  const generation = owner.generation;
  useEffect(() => () => owner.close(), [owner]);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url || !state.request) return;
    const client = new ConvexHttpClient(url);
    return retainPlaybackAuthorization(owner, async slug => eventPlaybackRequest(await client.query(api.events.getPublicBySlug, { slug })));
    // Metadata refreshes must not restart the revalidation loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, generation]);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return <Context.Provider value={owner}>
    {children}
    <section ref={shell} aria-label="Event playback" hidden={!state.request} data-event-id={state.request?.eventId}
      className="fixed right-0 bottom-0 z-50 w-[min(100vw,480px)] border border-border bg-media text-white shadow-panel"
      style={state.request?.kind === "twitch" ? { minWidth: 400 } : undefined}>
      <div ref={mount} data-event-playback-mount />
      {state.request && <>
        <div className="relative h-14"><VrcdnPlayerControls label={state.request.title} connected={state.status === "playing"} paused={state.status !== "playing" && state.status !== "loading"} fullscreen={fullscreen} volume={state.volume} muted={state.muted} volumeSettable
          onTogglePlay={() => state.status === "playing" || state.status === "loading" ? owner.pause() : void owner.play(state.request!)}
          onToggleMute={() => owner.setMuted(!state.muted)} onVolumeChange={value => owner.setVolume(value)}
          onToggleFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void shell.current?.requestFullscreen?.().catch(() => {}); }} /></div>
        <div className="flex items-center justify-between gap-3 px-4 py-2"><Link href={state.request.href}>{state.request.title}</Link><button type="button" aria-label="Close event playback" onClick={() => owner.close()}>Close</button></div>
        {state.status === "unavailable" && <p role="status">Stream unavailable</p>}
        {state.status === "blocked" && <button type="button" onClick={() => void owner.play(state.request!)}>Enable playback</button>}
      </>}
    </section>
  </Context.Provider>;
}
