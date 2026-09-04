"use client";

import { useEffect, useRef, useState } from "react";

import { VrcdnPlayerControls } from "@/components/media/vrcdn-player-controls";
import { cn } from "@/lib/cn";
import {
  VrcdnPlayerHealthMonitor,
  type VrcdnPlayerHealthSignal,
} from "@/lib/vrcdn-player-health";

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

/** iPhone Safari exposes only video fullscreen, never element fullscreen. */
type IosFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

/**
 * Whether script can move the media volume at all.
 *
 * Feature-tested rather than sniffed for iOS: the platform refuses the write
 * and leaves the property where it was, which is exactly what this asks. On
 * Safari for iPhone and iPad, volume is the hardware buttons' business alone,
 * so a slider there would drag and change nothing.
 */
function canSetMediaVolume(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  const probe = document.createElement("video");
  probe.volume = 0.5;

  return probe.volume === 0.5;
}

type MpegTsPlayer = {
  destroy: () => void;
  detachMediaElement: () => void;
  pause: () => void;
  play: () => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  unload: () => void;
};

type VrcdnStreamPlayerProps = {
  onHealthSignal?: (signal: VrcdnPlayerHealthSignal) => void;
  onPlaybackActiveChange?: (active: boolean) => void;
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
export function VrcdnStreamPlayer({
  onHealthSignal,
  onPlaybackActiveChange,
  src,
  title,
}: VrcdnStreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const healthMonitorRef = useRef<VrcdnPlayerHealthMonitor>(null);
  const onHealthSignalRef = useRef(onHealthSignal);
  const onPlaybackActiveChangeRef = useRef(onPlaybackActiveChange);
  onHealthSignalRef.current = onHealthSignal;
  onPlaybackActiveChangeRef.current = onPlaybackActiveChange;
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
  // Sticky from the first `playing` event. `started` is only the click, so it
  // cannot carry the `LIVE` marker; a later stall is transient and should not
  // retract a claim that was true.
  const [connected, setConnected] = useState(false);
  // Lazily, not in an effect: the controls only mount after a click, so this has
  // always run client-side by the time it is read, and there is no server pass
  // to disagree with.
  const [volumeSettable] = useState(canSetMediaVolume);
  // What unmute restores to. A slider dragged to zero mutes, and clearing
  // `muted` alone would leave the controls claiming sound over silence.
  const lastAudibleVolumeRef = useRef(1);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === wrapperRef.current);

    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const monitor = new VrcdnPlayerHealthMonitor({
      onSignal: (signal) => onHealthSignalRef.current?.(signal),
    });
    healthMonitorRef.current = monitor;

    return () => {
      monitor.stop();
      healthMonitorRef.current = null;
    };
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

    const markConnected = () => {
      healthMonitorRef.current?.recovered();
      setConnected(true);
      onPlaybackActiveChangeRef.current?.(true);
    };
    const markRecovered = () => healthMonitorRef.current?.recovered();
    const markStalled = () => healthMonitorRef.current?.beginStall();

    sync();
    video.addEventListener("playing", markConnected);
    video.addEventListener("canplay", markRecovered);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("stalled", markStalled);
    video.addEventListener("timeupdate", markRecovered);
    video.addEventListener("volumechange", sync);
    video.addEventListener("waiting", markStalled);

    return () => {
      video.removeEventListener("playing", markConnected);
      video.removeEventListener("canplay", markRecovered);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("stalled", markStalled);
      video.removeEventListener("timeupdate", markRecovered);
      video.removeEventListener("volumechange", sync);
      video.removeEventListener("waiting", markStalled);
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

    // Playback events accelerate the profile heartbeat but never decide
    // provider liveness. A clean EOF can also mean the CDN recycled the
    // connection, so this remains a local playback state with a retry.
    const handleEnded = () => {
      healthMonitorRef.current?.signal("ended");
      onPlaybackActiveChangeRef.current?.(false);
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
          healthMonitorRef.current?.signal("error");
          onPlaybackActiveChangeRef.current?.(false);
          setFailed(true);
          return;
        }

        const instance = mpegts.createPlayer({ isLive: true, type: "mpegts", url: src });

        instance.on(mpegts.Events.ERROR, () => {
          healthMonitorRef.current?.signal("error");
          onPlaybackActiveChangeRef.current?.(false);
          releasePlayer();
          setFailed(true);
        });
        instance.on(mpegts.Events.LOADING_COMPLETE, () => {
          healthMonitorRef.current?.signal("loading_complete");
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
          healthMonitorRef.current?.signal("error");
          onPlaybackActiveChangeRef.current?.(false);
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
      <div className="flex aspect-video min-h-64 flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,var(--media),var(--surface-raised))] p-5">
        {/*
          Announced, because this replaces a focused control. Without a live
          region a screen-reader user loses focus and is told nothing about why
          the player disappeared.
        */}
        {/*
          "Playback stopped", not "Stream ended". EOF says this connection
          finished, which also happens when the CDN recycles it mid-broadcast,
          so naming the broadcast would send people away from a set still
          running. It describes what is known and the retry covers the rest.
        */}
        <p className="text-sm font-medium text-white/80" role="status">
          {ended ? "Playback stopped" : "Stream unavailable"}
        </p>
        {/*
          `ended` is not authoritative. A clean EOF also arrives when the CDN
          closes or recycles the connection while the broadcaster is still
          going, so a terminal claim with no way back would strand a viewer on
          a stream that never stopped. Reconnecting returns to the poster, so
          the retry costs a viewer slot only when someone asks for it.
        */}
        <button
          className="rounded-control border border-white/30 bg-white/16 px-3 py-2 text-sm font-medium text-white"
          onClick={() => {
            setEnded(false);
            setFailed(false);
            setStarted(false);
            setConnected(false);
          }}
          type="button"
        >
          Try again
        </button>
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
        connected={connected}
        fullscreen={fullscreen}
        label={title}
        muted={muted}
        onToggleFullscreen={() => {
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
            return;
          }

          const wrapper = wrapperRef.current;

          // Feature-detected, not assumed. iPhone Safari has no element
          // fullscreen -- `requestFullscreen` is simply absent, so calling it
          // threw before any `.catch()` could see it -- and offers video
          // fullscreen instead. That path takes the video, not the wrapper, so
          // iOS gets its own native controls inside it, which is the right
          // trade against no fullscreen at all.
          if (wrapper?.requestFullscreen) {
            void wrapper.requestFullscreen().catch(() => {});
            return;
          }

          (videoRef.current as IosFullscreenVideo | null)?.webkitEnterFullscreen?.();
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

          if (!video.paused) {
            video.pause();
            return;
          }

          // Back to the live edge, not to where the pause happened. The element
          // holds its timestamp while paused, so resuming would play further
          // and further behind -- and with no seek bar there is nothing to drag
          // to catch up.
          const { buffered } = video;

          if (buffered.length > 0) {
            video.currentTime = buffered.end(buffered.length - 1);
          }

          void video.play().catch(() => {});
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
        volumeSettable={volumeSettable}
      />
    </div>
  );
}
