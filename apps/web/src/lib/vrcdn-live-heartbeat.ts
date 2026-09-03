export const vrcdnVisibleHeartbeatMs = 60_000;
export const vrcdnPlaybackHeartbeatMs = 120_000;
export const vrcdnUnavailableBackoffMs = [15_000, 30_000, 60_000] as const;

export type VrcdnHeartbeatProbeResult = {
  hasUnavailable: boolean;
  pendingOfflineDelayMs?: number;
};

type VrcdnLiveHeartbeatOptions = {
  clearTimeout?: (timer: number) => void;
  isVisible?: () => boolean;
  now?: () => number;
  probe: (signal: AbortSignal) => Promise<VrcdnHeartbeatProbeResult>;
  random?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  subscribeToVisibility?: (listener: () => void) => () => void;
};

export class VrcdnLiveHeartbeat {
  private readonly clearTimer: (timer: number) => void;
  private readonly isVisible: () => boolean;
  private readonly now: () => number;
  private readonly probe: (signal: AbortSignal) => Promise<VrcdnHeartbeatProbeResult>;
  private readonly setTimer: (callback: () => void, delayMs: number) => number;
  private readonly subscribeToVisibility: (listener: () => void) => () => void;
  private readonly jitterMultiplier: number;
  private activePlayback = false;
  private controller?: AbortController;
  private inFlight = false;
  private lastProbeAt?: number;
  private queuedImmediate = false;
  private started = false;
  private scheduledAt?: number;
  private scheduledKind?: "heartbeat" | "priority";
  private timer?: number;
  private unavailableCount = 0;
  private unsubscribeVisibility?: () => void;

  constructor(options: VrcdnLiveHeartbeatOptions) {
    this.clearTimer = options.clearTimeout ?? ((timer) => window.clearTimeout(timer));
    this.isVisible = options.isVisible ?? (() => document.visibilityState === "visible");
    this.now = options.now ?? Date.now;
    this.probe = options.probe;
    this.setTimer = options.setTimeout ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.subscribeToVisibility = options.subscribeToVisibility ?? ((listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    });
    const random = options.random ?? Math.random;
    this.jitterMultiplier = 0.9 + random() * 0.2;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.unsubscribeVisibility = this.subscribeToVisibility(() => {
      if (!this.isVisible()) {
        this.clearScheduledTimer(false);
        return;
      }

      if (
        this.lastProbeAt === undefined ||
        this.now() - this.lastProbeAt >= vrcdnVisibleHeartbeatMs
      ) {
        this.clearScheduledTimer();
        void this.runProbe();
        return;
      }

      if (this.scheduledAt !== undefined && this.scheduledKind !== undefined) {
        this.schedule(
          Math.max(0, this.scheduledAt - this.now()),
          this.scheduledKind,
        );
        return;
      }

      const interval = this.activePlayback
        ? vrcdnPlaybackHeartbeatMs
        : vrcdnVisibleHeartbeatMs;
      this.schedule(
        Math.max(0, interval * this.jitterMultiplier - (this.now() - this.lastProbeAt)),
        "heartbeat",
      );
    });
    void this.runProbe();
  }

  setPlaybackActive(active: boolean) {
    if (this.activePlayback === active) {
      return;
    }

    this.activePlayback = active;

    if (
      this.started &&
      this.isVisible() &&
      !this.inFlight &&
      this.scheduledKind === "heartbeat" &&
      this.lastProbeAt !== undefined
    ) {
      const interval = active ? vrcdnPlaybackHeartbeatMs : vrcdnVisibleHeartbeatMs;
      this.schedule(
        Math.max(0, interval * this.jitterMultiplier - (this.now() - this.lastProbeAt)),
        "heartbeat",
      );
    }
  }

  requestSanityCheck() {
    if (!this.started || !this.isVisible()) {
      return;
    }

    this.clearScheduledTimer();

    if (this.inFlight) {
      this.queuedImmediate = true;
      return;
    }

    void this.runProbe();
  }

  stop() {
    this.started = false;
    this.controller?.abort();
    this.controller = undefined;
    this.inFlight = false;
    this.queuedImmediate = false;
    this.clearScheduledTimer();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = undefined;
  }

  private clearScheduledTimer(clearPlan = true) {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }

    if (clearPlan) {
      this.scheduledAt = undefined;
      this.scheduledKind = undefined;
    }
  }

  private schedule(delayMs: number, kind: "heartbeat" | "priority") {
    this.clearScheduledTimer();

    if (!this.started) {
      return;
    }

    const roundedDelay = Math.round(delayMs);
    this.scheduledAt = this.now() + roundedDelay;
    this.scheduledKind = kind;

    if (!this.isVisible()) {
      return;
    }

    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.scheduledAt = undefined;
      this.scheduledKind = undefined;
      void this.runProbe();
    }, roundedDelay);
  }

  private async runProbe() {
    if (!this.started || this.inFlight || !this.isVisible()) {
      return;
    }

    this.inFlight = true;
    this.lastProbeAt = this.now();
    this.controller = new AbortController();

    try {
      const result = await this.probe(this.controller.signal);

      if (this.started) {
        if (result.pendingOfflineDelayMs !== undefined) {
          this.unavailableCount = result.hasUnavailable ? this.unavailableCount + 1 : 0;
          this.schedule(result.pendingOfflineDelayMs, "priority");
          return;
        }

        if (result.hasUnavailable) {
          const backoff = vrcdnUnavailableBackoffMs[
            Math.min(this.unavailableCount, vrcdnUnavailableBackoffMs.length - 1)
          ];
          this.unavailableCount += 1;
          this.schedule(backoff * this.jitterMultiplier, "priority");
          return;
        }

        this.unavailableCount = 0;
        const interval = this.activePlayback
          ? vrcdnPlaybackHeartbeatMs
          : vrcdnVisibleHeartbeatMs;
        this.schedule(interval * this.jitterMultiplier, "heartbeat");
      }
    } finally {
      this.inFlight = false;
      this.controller = undefined;

      if (this.started && this.queuedImmediate && this.isVisible()) {
        this.queuedImmediate = false;
        this.clearScheduledTimer();
        void this.runProbe();
      }
    }
  }
}
