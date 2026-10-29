"use client";

import { mediaVolumeSettable, pictureInPictureState, togglePictureInPicture } from "@/lib/media-element-controls";
import { playbackArtwork } from "@/lib/playback-metadata";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, X, Music2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { VrcdnPlayerControls } from "@/components/media/vrcdn-player-controls";
import type { EventPlaybackOwner, PlaybackSnapshot } from "@/lib/event-playback-owner";

type Placement = { top: number; left: number; width: number };

/** One shell and media ancestry, positioned over the inline slot or above the page.
 * Geometry is presentation only: scroll, routes and auth never recreate a transport. */
export function EventCompactPlayer({ owner, state, mount }: { owner: EventPlaybackOwner; state: PlaybackSnapshot; mount: RefObject<HTMLDivElement | null> }) {
  const shell = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<Placement>();
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState({ supported: false, active: false });
  const [limited, setLimited] = useState(false);
  const [height, setHeight] = useState(0);
  const [viewport, setViewport] = useState<{ width: number; height: number; top: number; left: number }>();
  const [volumeSettable] = useState(() => {
    if (typeof document === "undefined") return true;
    return mediaVolumeSettable(document.createElement("video"));
  });
  const request = state.request;
  const twitch = request?.kind === "twitch";
  useLayoutEffect(() => {
    if (!request) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const visible = window.visualViewport;
      const bounds = { width: visible?.width ?? window.innerWidth, height: visible?.height ?? window.innerHeight, top: visible?.offsetTop ?? 0, left: visible?.offsetLeft ?? 0 };
      setViewport(previous => previous?.width === bounds.width && previous?.height === bounds.height && previous?.top === bounds.top && previous?.left === bounds.left ? previous : bounds);
      // Reserve the 300px embed, controls, retry/status row and safe spacing.
      const tooSmall = bounds.width < 400 || bounds.height < 472;
      setLimited(tooSmall);
      if (twitch && tooSmall && (mount.current?.childElementCount || owner.getSnapshot().status !== "paused")) owner.suspend();
      const slot = Array.from(document.querySelectorAll<HTMLElement>("[data-event-playback-inline]")).find(node => node.dataset.eventPlaybackInline === ("profileId" in request ? `profile:${request.profileId}:${request.sourceId}` : request.eventId));
      const box = slot?.getBoundingClientRect();
      const inline = box && box.top >= bounds.top && box.bottom <= bounds.top + bounds.height && box.left >= bounds.left && box.right <= bounds.left + bounds.width && box.width >= (twitch ? 400 : 280);
      const next = inline ? { top: box.top, left: box.left, width: box.width } : undefined;
      // Keep the last compact clearance even after returning inline. Removing it
      // near the document end clamps scroll and can oscillate between placements.
      if (!inline && shell.current?.dataset.presentation === "compact") setHeight(shell.current.offsetHeight);
      setPlacement(previous => previous?.top === next?.top && previous?.left === next?.left && previous?.width === next?.width ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    if (shell.current) resize.observe(shell.current);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule); };
  }, [twitch, mount, owner, request]);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    const resize = new ResizeObserver(() => { if (shell.current?.dataset.presentation === "compact") setHeight(shell.current.offsetHeight); });
    if (shell.current) resize.observe(shell.current);
    return () => { document.removeEventListener("fullscreenchange", sync); resize.disconnect(); };
  }, []);
  useEffect(() => {
    // Request clearing covers Close and revocation. Observed fullscreen changes
    // also cover an entry promise completing after the request was cleared.
    if (!request && document.fullscreenElement === shell.current) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [request, fullscreen]);
  useEffect(() => {
    const video = mount.current?.querySelector<HTMLVideoElement>("video");
    const sync = () => setPip(pictureInPictureState(video ?? null));
    sync();
    video?.addEventListener("enterpictureinpicture", sync); video?.addEventListener("leavepictureinpicture", sync); video?.addEventListener("webkitpresentationmodechanged", sync);
    return () => { video?.removeEventListener("enterpictureinpicture", sync); video?.removeEventListener("leavepictureinpicture", sync); video?.removeEventListener("webkitpresentationmodechanged", sync); };
  }, [mount, state.status, state.mode, state.lineup]);
  const compact = !placement;
  const fallback = twitch && limited;
  const visibleWidth = viewport ? `${viewport.width}px` : "100vw";
  const rightOffset = viewport ? `calc(100% - ${viewport.left + viewport.width}px)` : "0px";
  const bottomOffset = viewport ? `calc(100% - ${viewport.top + viewport.height}px)` : "0px";
  const style: CSSProperties = fullscreen ? { inset: 0, width: "100%", height: "100%" } : placement ? { ...placement, right: "auto", bottom: "auto" } : {
    width: twitch && !limited ? 400 : `min(360px, calc(${visibleWidth} - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right))))`,
    right: twitch && !limited ? `calc(${rightOffset} + max(0px, min(12px, calc((${visibleWidth} - 400px) / 2))))` : `calc(${rightOffset} + max(12px, env(safe-area-inset-right)))`,
    bottom: `calc(${bottomOffset} + max(12px, env(safe-area-inset-bottom)))`,
  };
  const source = request?.kind === "performer_sequence" ? request.event.slots.find(slot => slot.key === state.lineup?.current)?.label : request?.kind === "twitch" ? request.channel ?? request.video ?? request.collection : request?.kind === "vrcdn" ? request.sourceId : undefined;
  const artwork = playbackArtwork(state);
  return <>
    <div aria-hidden="true" style={{ height: request ? height + 24 : 0, paddingBottom: request ? "env(safe-area-inset-bottom)" : 0 }} />
    <section ref={shell} aria-label="Event playback" hidden={!request} data-event-id={request?.eventId} data-presentation={compact ? "compact" : "inline"}
      className={`event-retained-player fixed z-50 overflow-hidden rounded-card ${twitch ? "" : "border border-border"} bg-media text-white shadow-panel`} style={style}>
      <div ref={mount} hidden={state.mode === "audio" && !twitch} data-event-playback-mount className={fallback ? "" : "event-retained-media"} style={twitch && !fallback ? { minHeight: 300 } : undefined} />
      {request && state.mode === "audio" && request.kind !== "twitch" && <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-media p-4 text-center">
        {artwork ? <Image unoptimized width={96} height={96} src={artwork} alt="" className="size-24 rounded-control object-contain" /> : <span aria-hidden="true" className="flex size-24 items-center justify-center rounded-control bg-white/5 text-white/60"><Music2 className="size-8" /></span>}
        {state.metadata?.displayName && <span className="text-sm font-medium">{state.metadata.displayName}</span>}
      </div>}
      {request && <>
        {!fallback && <div className={`relative ${request.kind === "twitch" ? "h-[52px]" : "h-[100px]"} shrink-0`}><VrcdnPlayerControls mode={request.kind !== "twitch" ? state.mode : undefined} onModeChange={value => void owner.setMode(value)} pipSupported={pip.supported} pipActive={pip.active}
          onTogglePip={() => { const media = owner.media; if (media instanceof HTMLVideoElement && state.mode === "video") void togglePictureInPicture(media).catch(() => {}); }}
          label={request.title} connected={state.status === "playing" && (request.kind !== "performer_sequence" || Boolean(state.lineup?.connected))} paused={state.status !== "playing" && state.status !== "loading"} fullscreen={fullscreen} volume={state.volume} muted={state.muted} volumeSettable={volumeSettable}
          onTogglePlay={() => state.status === "playing" || state.status === "loading" ? owner.pause() : void owner.play(request)}
          onToggleMute={() => owner.setMuted(!state.muted)} onVolumeChange={value => owner.setVolume(value)}
          onToggleFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void shell.current?.requestFullscreen?.().catch(() => {}); }} /></div>}
        <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-t border-white/10 px-3">
          <Link aria-label={`Return to ${request.title}`} href={request.href} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-sm font-medium hover:underline"><span className="min-w-0 truncate">{request.title}{source && <span className="block truncate text-xs font-normal text-white/65">{source}</span>}</span><ArrowUpRight aria-hidden className="size-4 shrink-0" /></Link>
          <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-white/10" aria-label="Close event playback" onClick={() => owner.close()}><X aria-hidden className="size-5" /></button>
        </div>
        {request.kind === "performer_sequence" && <div className="flex min-h-14 shrink-0 items-center gap-2 border-t border-white/10 px-3 py-2 text-xs">
          <select aria-label="Performer" className="h-10 min-w-0 flex-1 rounded-control border border-white/20 bg-media px-2" value={state.lineup?.current ?? ""} onChange={event => owner.manual(event.target.value)}>
            <option value="">Select performer</option>
            {request.event.slots.map(slot => <option key={slot.key} value={slot.key}>{slot.label ?? slot.key}{slot.stream ? "" : " (Unavailable)"}</option>)}
          </select>
          {state.lineup?.following ? <span>Following lineup</span> : <button type="button" onClick={() => owner.live()}>Return to live</button>}
          {state.lineup?.nextPlaybackBlocked && <button type="button" aria-label="Enable next performer playback" onClick={() => owner.retryNextPlayback()}>Enable playback</button>}
        </div>}
        {(state.status === "unavailable" || fallback) && <div className="flex min-h-11 items-center justify-between gap-3 border-t border-white/10 px-3 text-sm"><span role="status">{fallback ? "External playback" : state.unavailableReason === "unsupported" ? "Unsupported" : "Stream unavailable"}</span>{request.kind === "twitch" && request.sourceId.startsWith("https://") && <a href={request.sourceId} target="_blank" rel="noreferrer" className="py-3 underline">Open stream</a>}</div>}
        {state.status === "blocked" && <button type="button" className="min-h-11 px-3 text-sm underline" onClick={() => void owner.play(request)}>Enable playback</button>}
      </>}
    </section>
  </>;
}
