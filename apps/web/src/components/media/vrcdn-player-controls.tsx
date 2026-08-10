"use client";

import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";

export type VrcdnPlayerControlsProps = {
  fullscreen: boolean;
  /**
   * Which stream these controls drive. A profile can carry more than one live
   * VRCDN link and renders a player for each, so without this every strip
   * offers an identical `Play` and `Mute` and nothing says which stream is
   * about to change.
   */
  label: string;
  /**
   * Whether playback has actually begun. `LIVE` is a claim, and `started` only
   * records the click -- the event surface can offer a player for a stream that
   * is not publishing, so the marker would sit over a dead connection until
   * `mpegts.js` got round to erroring.
   */
  connected: boolean;
  muted: boolean;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onVolumeChange: (volume: number) => void;
  paused: boolean;
  volume: number;
  /**
   * Whether the platform lets script set `HTMLMediaElement.volume`. iOS Safari
   * does not -- it is read-only there, and only the hardware buttons move it --
   * so the slider is withheld rather than shown sliding and changing nothing.
   * Muting still works, so that button stays.
   */
  volumeSettable: boolean;
};

const controlButton =
  "flex size-11 cursor-pointer items-center justify-center rounded-control text-white/90 hover:text-white";

/**
 * The control strip for a live stream: no timeline, because there is nothing to
 * seek. Presentational on purpose -- it holds no player state, which is what
 * lets it be rendered in Storybook, where a real VRCDN connection is neither
 * available nor wanted.
 *
 * Hit areas are `size-11` (44px) rather than the icon's own 20px. These replace
 * the browser's touch-optimised native controls, so the touch target has to be
 * rebuilt along with the look; the icons stay visually small inside it.
 */
export function VrcdnPlayerControls({
  connected,
  fullscreen,
  label,
  muted,
  onToggleFullscreen,
  onToggleMute,
  onTogglePlay,
  onVolumeChange,
  paused,
  volume,
  volumeSettable,
}: VrcdnPlayerControlsProps) {
  return (
    <div
      aria-label={`${label} controls`}
      className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1"
      role="group"
    >
      <button aria-label={paused ? "Play" : "Pause"} className={controlButton} onClick={onTogglePlay} type="button">
        {paused ? <Play aria-hidden="true" className="size-5" /> : <Pause aria-hidden="true" className="size-5" />}
      </button>
      <button aria-label={muted ? "Unmute" : "Mute"} className={controlButton} onClick={onToggleMute} type="button">
        {muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
      </button>
      {volumeSettable ? (
        <input
          aria-label="Volume"
          className="h-11 w-24 cursor-pointer accent-white"
          max={1}
          min={0}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          step={0.01}
          type="range"
          value={muted ? 0 : volume}
        />
      ) : null}
      {connected ? (
        <span className="ml-auto pr-1 text-xs font-medium tracking-wide text-white/80">LIVE</span>
      ) : (
        <span className="ml-auto" />
      )}
      <button
        // Announces what pressing it will do, not what the button is. While the
        // wrapper is fullscreen this exits, and saying `Full screen` there gave
        // keyboard and screen-reader users the wrong action with no toggle state.
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        className={controlButton}
        onClick={onToggleFullscreen}
        type="button"
      >
        {fullscreen ? (
          <Minimize aria-hidden="true" className="size-5" />
        ) : (
          <Maximize aria-hidden="true" className="size-5" />
        )}
      </button>
    </div>
  );
}
