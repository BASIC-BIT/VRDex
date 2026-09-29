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
  display: ReturnType<typeof useClubDisplayAttempt>,
  serverNow: number | null | undefined,
  observedAt: number | undefined,
  ttl: number,
) {
  return useClubDisplayFreshnesses(
    display,
    serverNow,
    [{ observedAt, serverNow }],
    ttl,
  )[0]!;
}

// A paginated list shares one fixed calibration, including rows first returned
// by later pages or reactive updates. Only their observation deadlines differ.
export function useClubDisplayFreshnesses(
  { attempt, restart }: ReturnType<typeof useClubDisplayAttempt>,
  serverNow: number | null | undefined,
  observations: Array<{
    observedAt: number | undefined;
    serverNow: number | null | undefined;
  }>,
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
  const calibrated =
    sameAttempt &&
    !needsRestart &&
    calibration.serverNow !== undefined &&
    Number.isFinite(calibration.serverNow) &&
    serverNow != null &&
    Number.isFinite(serverNow);
  // Keep the signed offset: later observations can postdate the calibration.
  // A reactive query's newer `now` must not be added to total elapsed time.
  const deadlines = observations.map(({ observedAt, serverNow: observedServerNow }) =>
    calibrated &&
    observedAt !== undefined &&
    Number.isFinite(observedAt) &&
    observedServerNow != null &&
    Number.isFinite(observedServerNow) &&
    observedAt <= observedServerNow
      ? attempt.startedAt + (observedAt + ttl - calibration.serverNow!)
      : null,
  );
  // Recheck the external clock on every render, including suspended timers.
  // eslint-disable-next-line react-hooks/purity
  const current = performance.now();
  const fresh = deadlines.map((deadline) => deadline !== null && current <= deadline);
  const pending = deadlines.filter(
    (deadline): deadline is number => deadline !== null && deadline >= current,
  );
  const deadline = pending.length ? Math.min(...pending) : null;
  useEffect(() => {
    if (deadline === null) return;
    const remaining = deadline - performance.now();
    // The existing display windows include the exact TTL boundary. If expiry
    // passed since render, still repaint instead of leaving that commit fresh.
    const timer = setTimeout(tick, Math.max(0, Math.ceil(remaining) + 1));
    return () => clearTimeout(timer);
  }, [deadline]);
  return fresh;
}
