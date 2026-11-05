import type { PlaybackMode } from "@vrdex/media-relay";
import { createNativeHlsAdapter, type ReadyPlayback } from "./native-hls-adapter";
import type { AudioObservationSample } from "./event-audio-observation";

/** Decoded native progress is available; decoded audio amplitude is deliberately unavailable. */
export async function createNativeObservedSource({ grant, mode, isCurrent, mount, onNativePause, onNativePlay }: {
  grant: ReadyPlayback;
  mode: PlaybackMode;
  isCurrent: () => boolean;
  mount: HTMLElement;
  onNativePause?: () => void; onNativePlay?: () => void;
}) {
  if (!isCurrent()) throw Error("Obsolete source request");
  let volume = 1, muted = false;
  let currentGrant = grant;
  let selectedMode = mode;
  let failed = false, released = false, previousTime = 0, progressCount = 0;
  const make = () => createNativeHlsAdapter({ grant: currentGrant, mode: selectedMode, mount, onNativePause, onNativePlay, notify: patch => {
    if (patch.status === "unavailable") failed = true;
  } });
  let adapter = make();
  return {
    get media() { return adapter.media; },
    grantId: grant.grant.id,
    get metadata() { return currentGrant.metadata; },
    updateGrant(next: ReadyPlayback) { currentGrant = next; adapter.setMetadata(next.metadata); },
    async recoverMedia(next: ReadyPlayback) {
      if (released) return false;
      adapter.dispose(); currentGrant = next; failed = false; progressCount = 0; previousTime = 0;
      adapter = make(); adapter.setMuted(muted); adapter.setVolume(volume);
      return adapter.play();
    },
    async play() {
      if (released) return false;
      return adapter.play();
    },
    pause() { progressCount = 0; adapter.pause(); },
    release() { if (!released) { released = true; adapter.dispose(); } },
    setMuted(value: boolean) { muted = value; adapter.setMuted(value); },
    setVolume(value: number) { volume = value; adapter.setVolume(value); },
    async setMode(next: PlaybackMode) { selectedMode = next; previousTime = 0; progressCount = 0; return adapter.setMode(next); },
    ready() { return !released && progressCount >= 3 && !adapter.media.paused && adapter.media.readyState >= 2; },
    sample(observedAt: number, paused: boolean): AudioObservationSample & { audioLevel: { kind: "unavailable" } } {
      const media = adapter.media;
      const progressing = !released && !media.paused && media.readyState >= 2 && media.currentTime > previousTime;
      progressCount = progressing ? progressCount + 1 : 0;
      previousTime = media.currentTime;
      return { observedAt, progressing, audioLevel: { kind: "unavailable" },
        analysisActive: document.visibilityState === "visible", paused,
        disconnected: !progressing && (failed || !!media.error || media.ended) };
    },
  };
}
export type ObservedNativeSource = Awaited<ReturnType<typeof createNativeObservedSource>>;
