import type { PlaybackMode } from "@vrdex/media-relay";
export type { PlaybackMode };
export type ModeStorage = Pick<Storage, "getItem" | "setItem">;
const key = "vrdex.playback-mode";
let failedWrite = false;
let memory: PlaybackMode = "video";
export function playbackModeStorage(): ModeStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
export function readPlaybackMode(
  storage: ModeStorage | undefined,
): PlaybackMode {
  if (failedWrite) return memory;
  try {
    const value = storage?.getItem(key);
    if (value === "audio" || value === "video") memory = value;
  } catch {
    /* Storage denial retains session preference. */
  }
  return memory;
}
export function writePlaybackMode(
  storage: ModeStorage | undefined,
  mode: PlaybackMode,
): void {
  memory = mode;
  try {
    storage?.setItem(key, mode);
    failedWrite = storage === undefined;
  } catch {
    failedWrite = true;
    /* Best effort across reloads. */
  }
}
