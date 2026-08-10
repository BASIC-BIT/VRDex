"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The play-triangle poster, shared by the VRCDN player and by the watch
 * surface's fallback for providers that could not be embedded. One definition
 * so the two states cannot drift apart visually.
 */
export function WatchPlayPoster() {
  return (
    <div className="flex aspect-video min-h-64 items-center justify-center bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] p-5 text-white">
      <div className="flex size-16 items-center justify-center rounded-control border border-white/30 bg-white/16 shadow-panel">
        <span
          aria-hidden="true"
          className="ml-1 h-0 w-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-white"
        />
      </div>
    </div>
  );
}

type VrcdnStreamPlayerProps = {
  /** The `.live.ts` transport stream. VRCDN serves no HLS. */
  src: string;
  title: string;
};

/**
 * VRCDN playback, over the MPEG-TS transport stream.
 *
 * `mpegts.js` rather than `hls.js` because VRCDN publishes no HLS: the manifest
 * answers `404` for a stream that is actively publishing. This is the same
 * library and the same endpoint VRCDN's own preview page uses.
 *
 * Nothing connects until the viewer presses play. That is the whole point of
 * the poster state: VRCDN plans are viewer-capped, commonly at 100 while a
 * VRChat instance holds 80-100, so a player that dialled in on page load would
 * spend a slot on every passer-by -- and most heavily while an event is on,
 * which is exactly when the operator needs those slots for people actually in
 * the world.
 */
export function VrcdnStreamPlayer({ src, title }: VrcdnStreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (!started) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    let cancelled = false;
    let player: {
      destroy: () => void;
      detachMediaElement: () => void;
      pause: () => void;
      unload: () => void;
    } | null = null;

    void import("mpegts.js")
      .then(({ default: mpegts }) => {
        if (cancelled || !videoRef.current) {
          return;
        }

        if (!mpegts.isSupported()) {
          setUnsupported(true);
          return;
        }

        const instance = mpegts.createPlayer({ isLive: true, type: "mpegts", url: src });

        instance.on(mpegts.Events.ERROR, () => {
          setUnsupported(true);
        });
        instance.attachMediaElement(videoRef.current);
        instance.load();
        void instance.play();
        player = instance;
      })
      .catch(() => {
        if (!cancelled) {
          setUnsupported(true);
        }
      });

    return () => {
      cancelled = true;

      // Torn down in full rather than dropped. This holds an open connection to
      // the operator's stream, so leaving it attached would keep spending the
      // viewer slot after the element is gone.
      if (player) {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      }

      video.removeAttribute("src");
      video.load();
    };
  }, [src, started]);

  if (unsupported) {
    return <WatchPlayPoster />;
  }

  if (!started) {
    return (
      <button
        aria-label={`Play ${title}`}
        className="block w-full cursor-pointer"
        onClick={() => setStarted(true)}
        type="button"
      >
        <WatchPlayPoster />
      </button>
    );
  }

  return (
    <video
      autoPlay
      className="aspect-video w-full bg-media"
      controls
      playsInline
      ref={videoRef}
      title={title}
    />
  );
}
