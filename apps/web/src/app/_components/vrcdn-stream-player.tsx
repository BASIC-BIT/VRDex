"use client";

import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  // Mirrored from the element rather than driven from here, so the controls
  // still track state the element changes on its own -- a rejected autoplay
  // leaving it paused, or the platform muting it.
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const video = videoRef.current;

    if (!started || failed || !video) {
      return;
    }

    const sync = () => {
      setPaused(video.paused);
      setMuted(video.muted);
      setVolume(video.volume);
    };

    sync();
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("volumechange", sync);

    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("volumechange", sync);
    };
  }, [started, failed]);

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
    <div className="relative bg-media" ref={wrapperRef}>
      {/*
        No native `controls`, and no `title`. Native controls put a seek bar on
        a stream that has nothing to seek: the buffer of a live MPEG-TS feed
        grows and shifts under the element, so the scrubber jitters and drags
        against a timeline that does not mean anything. Hiding the timeline
        alone only works in Chromium and WebKit, so the whole strip is replaced
        with the controls a live stream can honour.

        `title` rendered as a hover tooltip on the video itself, which is noise;
        `aria-label` gives the element its accessible name without one.
      */}
      <video aria-label={title} autoPlay className="aspect-video w-full" playsInline ref={videoRef} />
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <button
          aria-label={paused ? "Play" : "Pause"}
          className="cursor-pointer text-white/90 hover:text-white"
          onClick={() => {
            const video = videoRef.current;

            if (!video) {
              return;
            }

            if (video.paused) {
              void video.play().catch(() => {});
            } else {
              video.pause();
            }
          }}
          type="button"
        >
          {paused ? <Play aria-hidden="true" className="size-5" /> : <Pause aria-hidden="true" className="size-5" />}
        </button>
        <button
          aria-label={muted ? "Unmute" : "Mute"}
          className="cursor-pointer text-white/90 hover:text-white"
          onClick={() => {
            const video = videoRef.current;

            if (video) {
              video.muted = !video.muted;
            }
          }}
          type="button"
        >
          {muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
        </button>
        <input
          aria-label="Volume"
          className="h-1 w-24 cursor-pointer accent-white"
          max={1}
          min={0}
          onChange={(event) => {
            const video = videoRef.current;

            if (video) {
              video.volume = Number(event.target.value);
              video.muted = Number(event.target.value) === 0;
            }
          }}
          step={0.01}
          type="range"
          value={muted ? 0 : volume}
        />
        <span className="ml-auto text-xs font-medium tracking-wide text-white/80">LIVE</span>
        <button
          aria-label="Full screen"
          className="cursor-pointer text-white/90 hover:text-white"
          onClick={() => {
            if (document.fullscreenElement) {
              void document.exitFullscreen().catch(() => {});
            } else {
              void wrapperRef.current?.requestFullscreen().catch(() => {});
            }
          }}
          type="button"
        >
          <Maximize aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}
