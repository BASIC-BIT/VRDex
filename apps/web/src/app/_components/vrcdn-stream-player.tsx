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

type MpegTsPlayer = {
  destroy: () => void;
  detachMediaElement: () => void;
  pause: () => void;
  play: () => unknown;
  unload: () => void;
};

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!started) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    let cancelled = false;
    let player: MpegTsPlayer | null = null;

    // Torn down in full rather than dropped. An attached player holds an open
    // connection to the operator's stream, so anything that stops showing the
    // video has to release it too -- including the error path, which swaps in
    // the failure state while the component stays mounted and the effect
    // cleanup never runs.
    const releasePlayer = () => {
      if (!player) {
        return;
      }

      const instance = player;
      player = null;
      instance.pause();
      instance.unload();
      instance.detachMediaElement();
      instance.destroy();
    };

    void import("mpegts.js")
      .then(({ default: mpegts }) => {
        if (cancelled || !videoRef.current) {
          return;
        }

        if (!mpegts.isSupported()) {
          setFailed(true);
          return;
        }

        const instance = mpegts.createPlayer({ isLive: true, type: "mpegts", url: src });

        instance.on(mpegts.Events.ERROR, () => {
          releasePlayer();
          setFailed(true);
        });
        instance.attachMediaElement(videoRef.current);
        instance.load();
        player = instance;

        // The click that started this is already spent by the time the player
        // chunk resolves, so a browser that blocks audible autoplay can refuse.
        // The element keeps its native controls, so the viewer presses play
        // once more rather than being left with a dead frame; muting instead
        // would be worse, since the audio is the whole point of a DJ set.
        void Promise.resolve(instance.play()).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      releasePlayer();

      video.removeAttribute("src");
      video.load();
    };
  }, [src, started]);

  // Deliberately not the play poster. That is the same triangle the start
  // button wears, and reusing it here left the viewer clicking a control that
  // had no handler and no way back short of reloading.
  if (failed) {
    return (
      <div className="flex aspect-video min-h-64 items-center justify-center bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] p-5">
        <p className="text-sm font-medium text-white/80">Stream unavailable</p>
      </div>
    );
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
