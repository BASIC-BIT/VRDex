"use client";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { foregroundPlayback } from "./foreground-playback";
/** Muted previews simply do not acquire until they become audible. */
export function useForegroundPlayback(stop: () => void) {
  const identity = useRef({});
  const latestStop = useRef(stop);
  useLayoutEffect(() => { latestStop.current = stop; }, [stop]);
  useEffect(() => { const key = identity.current; return () => foregroundPlayback.release(key); }, []);
  return useCallback(() => foregroundPlayback.acquire(identity.current, () => latestStop.current()), []);
}
