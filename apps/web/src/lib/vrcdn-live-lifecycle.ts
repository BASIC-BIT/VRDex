import type { VrcdnLiveState, VrcdnLiveStates } from "./vrcdn-live";

export const vrcdnOfflineConfirmationDelayMs = 10_000;
export const maxVrcdnPresentationAgeMs = 5 * 60_000;

export type VrcdnLivePresentation = "live" | "offline" | "unknown";

export type VrcdnLiveLifecycle = {
  confirmedAt?: number;
  pendingOfflineAt?: number;
  presentation: VrcdnLivePresentation;
  status: VrcdnLivePresentation | "pending_offline";
};

export type VrcdnLiveLifecycles = Record<string, VrcdnLiveLifecycle>;

export function createVrcdnLiveLifecycle(
  state: VrcdnLiveState | undefined,
  observedAt: number,
): VrcdnLiveLifecycle {
  if (state === "live" || state === "offline") {
    return {
      confirmedAt: observedAt,
      presentation: state,
      status: state,
    };
  }

  return { presentation: "unknown", status: "unknown" };
}

export function createVrcdnLiveLifecycles(
  streamIds: readonly string[],
  states: VrcdnLiveStates,
  observedAt: number,
): VrcdnLiveLifecycles {
  return Object.fromEntries(
    streamIds.map((streamId) => [
      streamId,
      createVrcdnLiveLifecycle(states[streamId], observedAt),
    ]),
  );
}

export function applyVrcdnLiveProbe(
  current: VrcdnLiveLifecycle,
  state: VrcdnLiveState,
  observedAt: number,
): VrcdnLiveLifecycle {
  if (state === "live") {
    return {
      confirmedAt: observedAt,
      presentation: "live",
      status: "live",
    };
  }

  if (state === "offline" && current.presentation === "live") {
    if (
      current.status === "pending_offline" &&
      current.pendingOfflineAt !== undefined &&
      observedAt - current.pendingOfflineAt >= vrcdnOfflineConfirmationDelayMs
    ) {
      return {
        confirmedAt: observedAt,
        presentation: "offline",
        status: "offline",
      };
    }

    return {
      ...current,
      pendingOfflineAt: current.pendingOfflineAt ?? observedAt,
      status: "pending_offline",
    };
  }

  if (state === "offline") {
    return {
      confirmedAt: observedAt,
      presentation: "offline",
      status: "offline",
    };
  }

  if (
    current.confirmedAt !== undefined &&
    observedAt - current.confirmedAt > maxVrcdnPresentationAgeMs
  ) {
    return { presentation: "unknown", status: "unknown" };
  }

  return current;
}

export function applyVrcdnLiveStates(
  current: VrcdnLiveLifecycles,
  streamIds: readonly string[],
  states: VrcdnLiveStates,
  observedAt: number,
): {
  hasUnavailable: boolean;
  lifecycles: VrcdnLiveLifecycles;
  pendingOfflineDelayMs?: number;
} {
  let hasUnavailable = false;
  let pendingOfflineDelayMs: number | undefined;
  const lifecycles = Object.fromEntries(
    streamIds.map((streamId) => {
      const state = states[streamId] ?? "unavailable";
      hasUnavailable ||= state === "unavailable";
      const lifecycle = applyVrcdnLiveProbe(
        current[streamId] ?? createVrcdnLiveLifecycle(undefined, observedAt),
        state,
        observedAt,
      );

      if (lifecycle.status === "pending_offline" && lifecycle.pendingOfflineAt !== undefined) {
        const delay = Math.max(
          0,
          lifecycle.pendingOfflineAt + vrcdnOfflineConfirmationDelayMs - observedAt,
        );
        pendingOfflineDelayMs = pendingOfflineDelayMs === undefined
          ? delay
          : Math.min(pendingOfflineDelayMs, delay);
      }

      return [streamId, lifecycle];
    }),
  );

  return {
    hasUnavailable,
    lifecycles,
    ...(pendingOfflineDelayMs === undefined ? {} : { pendingOfflineDelayMs }),
  };
}
