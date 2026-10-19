"use client";
import { useRef, useState } from "react";
import { useForegroundPlayback } from "@/lib/use-foreground-playback";
import { WatchPlayPoster } from "./vrcdn-stream-player";

/** Cross-origin embeds cannot report a reliable Play intent: acquire before exposing them. */
export function ForegroundWatchEmbed({ src, title }: { src: string; title: string }) {
  const [enabled, setEnabled] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const acquire = useForegroundPlayback(() => {
    // Synchronously discard the embedded browsing context before the successor plays.
    if (frame.current) frame.current.src = "about:blank";
    setEnabled(false);
  });
  if (!enabled) return <button type="button" aria-label={`Play ${title}`} className="block w-full" onClick={() => { acquire(); setEnabled(true); }}><WatchPlayPoster /></button>;
  return <iframe ref={frame} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen
    className="aspect-video w-full bg-media" referrerPolicy="strict-origin-when-cross-origin"
    sandbox="allow-same-origin allow-scripts allow-popups allow-presentation" src={src} title={title} />;
}

export function ForegroundWatchVideo({ src, title }: { src: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const acquire = useForegroundPlayback(() => video.current?.pause());
  return <video ref={video} className="aspect-video w-full bg-media" controls preload="metadata" src={src} title={title}
    onPlay={() => { if (!video.current?.muted) acquire(); }}
    onVolumeChange={() => { if (video.current && !video.current.muted && !video.current.paused) acquire(); }} />;
}
