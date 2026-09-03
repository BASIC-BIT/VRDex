export const vrcdnStallSanityDelayMs = 4_000;

export type VrcdnPlayerHealthSignal =
  | "ended"
  | "error"
  | "loading_complete"
  | "stalled";

type VrcdnPlayerHealthMonitorOptions = {
  clearTimeout?: (timer: number) => void;
  onSignal: (signal: VrcdnPlayerHealthSignal) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
};

export class VrcdnPlayerHealthMonitor {
  private readonly clearTimer: (timer: number) => void;
  private readonly onSignal: (signal: VrcdnPlayerHealthSignal) => void;
  private readonly setTimer: (callback: () => void, delayMs: number) => number;
  private stallActive = false;
  private stallTimer?: number;

  constructor(options: VrcdnPlayerHealthMonitorOptions) {
    this.clearTimer = options.clearTimeout ?? ((timer) => window.clearTimeout(timer));
    this.onSignal = options.onSignal;
    this.setTimer = options.setTimeout ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  }

  beginStall() {
    if (this.stallActive) {
      return;
    }

    this.stallActive = true;
    this.stallTimer = this.setTimer(() => {
      this.stallTimer = undefined;
      this.onSignal("stalled");
    }, vrcdnStallSanityDelayMs);
  }

  recovered() {
    this.stallActive = false;

    if (this.stallTimer !== undefined) {
      this.clearTimer(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  signal(signal: Exclude<VrcdnPlayerHealthSignal, "stalled">) {
    this.recovered();
    this.onSignal(signal);
  }

  stop() {
    this.recovered();
  }
}
