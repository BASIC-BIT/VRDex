"use client";

import { useEffect, useRef, useState } from "react";

import { VrcdnPlayerControls } from "@/components/media/vrcdn-player-controls";
import { cn } from "@/lib/cn";

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
  const [ended, setEnded] = useState(false);
  // Mirrored from the element rather than driven from here, so the controls
  // still track state the element changes on its own -- a rejected autoplay
  // leaving it paused, or the platform muting it.
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  // What unmute restores to. A slider dragged to zero mutes, and clearing
  // `muted` alone would leave the controls claiming sound over silence.
  const lastAudibleVolumeRef = useRef(1);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === wrapperRef.current);

    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    if (!started || failed || ended || !video) {
      return;
    }

    const sync = () => {
      setPaused(video.paused);
      setMuted(video.muted);
      setVolume(video.volume);

      if (video.volume > 0) {
        lastAudibleVolumeRef.current = video.volume;
      }
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
  }, [started, failed, ended]);

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

    // A set that finished is not a player that broke, and saying so needs no
    // heartbeat: the connection is already open, and when VRCDN stops sending,
    // `mpegts.js` ends the media source and the element fires `ended`. Polling
    // liveness from the page instead would mean re-opening `.live.ts` -- the
    // media endpoint -- on a timer, per open tab, which is the recurring-probe
    // pattern `#217` deferred, at worse odds than the sweep it deferred.
    //
    // `ended` only, never a fatal error. An error after a while of playing is
    // as likely a network blip, and telling a viewer the set is over while it
    // is still running sends them away from a stream that is still there.
    const handleEnded = () => {
      releasePlayer();
      setEnded(true);
    };

    video.addEventListener("ended", handleEnded);

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
        // The control bar mirrors the element, so a refusal surfaces as its
        // play button and the viewer presses once more rather than being left
        // with a dead frame; muting to satisfy the policy instead would be
        // worse, since the audio is the whole point of a DJ set.
        void Promise.resolve(instance.play()).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      video.removeEventListener("ended", handleEnded);
      releasePlayer();

      video.removeAttribute("src");
      video.load();
    };
  }, [src, started]);

  // Deliberately not the play poster. That is the same triangle the start
  // button wears, and reusing it here left the viewer clicking a control that
  // had no handler and no way back short of reloading.
  if (failed || ended) {
    return (
      <div className="flex aspect-video min-h-64 items-center justify-center bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] p-5">
        <p className="text-sm font-medium text-white/80">{ended ? "Stream ended" : "Stream unavailable"}</p>
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
    <div
      // Fullscreen hands the wrapper the whole viewport, which is rarely 16:9.
      // Left at `aspect-video` the video became a strip at the top of a portrait
      // phone with the controls stranded at the bottom, and overflowed the
      // height on very wide displays. Filling and letterboxing is what the
      // native controls did for free.
      className={cn("relative bg-media", fullscreen && "flex h-full w-full items-center justify-center")}
      ref={wrapperRef}
    >
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
      <video
        aria-label={title}
        autoPlay
        className={cn("w-full", fullscreen ? "h-full max-h-full object-contain" : "aspect-video")}
        playsInline
        ref={videoRef}
      />
      <VrcdnPlayerControls
        fullscreen={fullscreen}
        muted={muted}
        onToggleFullscreen={() => {
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          } else {
            void wrapperRef.current?.requestFullscreen().catch(() => {});
          }
        }}
        onToggleMute={() => {
          const video = videoRef.current;

          if (!video) {
            return;
          }

          // Unmuting a slider dragged to zero has to give the volume back, or
          // the icon and label flip to "unmuted" over silence and the only way
          // out is to find the slider again.
          if (video.muted && video.volume === 0) {
            video.volume = lastAudibleVolumeRef.current;
          }

          video.muted = !video.muted;
        }}
        onTogglePlay={() => {
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
        onVolumeChange={(next) => {
          const video = videoRef.current;

          if (!video) {
            return;
          }

          video.volume = next;
          video.muted = next === 0;
        }}
        paused={paused}
        volume={volume}
      />
    </div>
  );
}
