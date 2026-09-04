import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VrcdnPlayerHealthMonitor,
} from "../../apps/web/src/lib/vrcdn-player-health";

describe("VRCDN player health", () => {
  it("requests one sanity check only after a wait or stall lasts four seconds", () => {
    const timers = new Map<number, { callback: () => void; dueAt: number }>();
    let nextTimer = 1;
    let now = 0;
    const signals: string[] = [];
    const monitor = new VrcdnPlayerHealthMonitor({
      clearTimeout: (timer) => timers.delete(timer),
      onSignal: (signal) => signals.push(signal),
      setTimeout: (callback, delayMs) => {
        const timer = nextTimer++;
        timers.set(timer, { callback, dueAt: now + delayMs });
        return timer;
      },
    });

    monitor.beginStall();
    monitor.beginStall();
    assert.deepEqual(signals, []);
    assert.equal(timers.size, 1);

    now = 3_999;
    for (const [id, timer] of timers) {
      if (timer.dueAt <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
    assert.deepEqual(signals, []);

    now = 4_000;
    for (const [id, timer] of timers) {
      if (timer.dueAt <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
    assert.deepEqual(signals, ["stalled"]);

    monitor.beginStall();
    assert.equal(timers.size, 0);

    monitor.recovered();
    monitor.beginStall();
    assert.equal(timers.size, 1);
    monitor.recovered();
    assert.equal(timers.size, 0);
    assert.deepEqual(signals, ["stalled"]);
  });

  it("forwards terminal player signals without declaring a provider state", () => {
    const signals: string[] = [];
    const monitor = new VrcdnPlayerHealthMonitor({
      onSignal: (signal) => signals.push(signal),
    });

    monitor.signal("ended");
    monitor.signal("loading_complete");
    monitor.signal("error");

    assert.deepEqual(signals, ["ended", "loading_complete", "error"]);
  });
});
