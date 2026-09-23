"use client";

import { useCallback, useEffect, useReducer, useState } from "react";

type Attempt = { scope: string | null; nonce: string; startedAt: number };
function newAttempt(scope: Attempt["scope"]): Attempt {
  return { scope, nonce: crypto.randomUUID(), startedAt: performance.now() };
}

// Called by the query owner, before subscribing. Different arguments prevent
// Convex's cached result from becoming a new server-clock calibration.
export function useClubDisplayAttempt(scope: Attempt["scope"]) {
  const [attempt, setAttempt] = useState(() => newAttempt(scope));
  if (attempt.scope !== scope) setAttempt(newAttempt(scope));
  const restart = useCallback(() => setAttempt(newAttempt(scope)), [scope]);
  return { attempt, restart };
}

export function useClubDisplayFreshness(
  { attempt, restart }: ReturnType<typeof useClubDisplayAttempt>,
  serverNow: number | null | undefined,
  observedAt: number | undefined,
  ttl: number,
) {
  const [calibration, setCalibration] = useState<{
    nonce: string;
    serverNow?: number;
    initiallyNull: boolean;
  } | null>(null);
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const sameAttempt = calibration?.nonce === attempt.nonce;
  const needsRestart =
    sameAttempt && calibration.initiallyNull && serverNow != null;
  if (!sameAttempt && serverNow !== undefined) {
    setCalibration({
      nonce: attempt.nonce,
      serverNow: serverNow ?? undefined,
      initiallyNull: serverNow === null,
    });
  }
  useEffect(() => {
    // No clock was available in the initial null result. Start one new timed
    // query when an integration appears instead of charging the entire wait.
    if (needsRestart) restart();
  }, [needsRestart, restart]);
  const eligible =
    sameAttempt &&
    !needsRestart &&
    calibration.serverNow !== undefined &&
    Number.isFinite(calibration.serverNow) &&
    serverNow != null &&
    Number.isFinite(serverNow) &&
    observedAt !== undefined &&
    Number.isFinite(observedAt) &&
    observedAt <= serverNow;
  // Keep the signed offset: later observations can postdate the calibration.
  // A reactive query's newer `now` must not be added to total elapsed time.
  const deadline = eligible
    ? attempt.startedAt + (observedAt + ttl - calibration.serverNow!)
    : null;
  useEffect(() => {
    if (deadline === null) return;
    const remaining = deadline - performance.now();
    // The existing display windows include the exact TTL boundary. If expiry
    // passed since render, still repaint instead of leaving that commit fresh.
    const timer = setTimeout(tick, Math.max(0, Math.ceil(remaining) + 1));
    return () => clearTimeout(timer);
  }, [deadline]);
  // Recheck the external clock on every render, including before a suspended
  // expiry timer has had a chance to run. Never expose stale positive state.
  // eslint-disable-next-line react-hooks/purity
  return deadline !== null && performance.now() <= deadline;
}
