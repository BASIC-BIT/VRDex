import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VrcdnLiveHeartbeat,
  type VrcdnHeartbeatProbeResult,
} from "../../apps/web/src/lib/vrcdn-live-heartbeat";

class FakeTimers {
  now = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  readonly clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delayMs, callback });
    return id;
  };

  tick(delayMs: number) {
    const target = this.now + delayMs;

    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];

      if (!next) {
        break;
      }

      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
    }

    this.now = target;
  }
}

class FakeVisibility {
  visible = true;
  private listeners = new Set<() => void>();

  readonly isVisible = () => this.visible;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setVisible(visible: boolean) {
    this.visible = visible;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

const available: VrcdnHeartbeatProbeResult = { hasUnavailable: false };

describe("VRCDN live heartbeat", () => {
  it("checks immediately and then every 60 seconds while visible", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(59_999);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(1);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("keeps one per-tab jitter multiplier across heartbeat cycles", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return available;
      },
      random: () => 0,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    timers.tick(53_999);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(1);
    await flushPromises();
    assert.equal(calls, 2);
    timers.tick(54_000);
    await flushPromises();
    assert.equal(calls, 3);

    heartbeat.stop();
  });

  it("uses a 120-second cadence while playback is active", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.setPlaybackActive(true);
    heartbeat.start();
    await flushPromises();

    timers.tick(119_999);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(1);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("moves an existing heartbeat to the playback cadence when playback begins", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    timers.tick(10_000);
    heartbeat.setPlaybackActive(true);
    timers.tick(50_000);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(60_000);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("pauses while hidden and checks immediately when a visible page is stale", async () => {
    const timers = new FakeTimers();
    const visibility = new FakeVisibility();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: visibility.isVisible,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: visibility.subscribe,
    });

    heartbeat.start();
    await flushPromises();
    visibility.setVisible(false);
    timers.tick(61_000);
    await flushPromises();
    assert.equal(calls, 1);

    visibility.setVisible(true);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("resumes a paused pending-offline deadline when the page becomes visible", async () => {
    const timers = new FakeTimers();
    const visibility = new FakeVisibility();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: visibility.isVisible,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return calls === 1
          ? { hasUnavailable: false, pendingOfflineDelayMs: 10_000 }
          : available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: visibility.subscribe,
    });

    heartbeat.start();
    await flushPromises();
    timers.tick(2_000);
    visibility.setVisible(false);
    timers.tick(5_000);
    visibility.setVisible(true);
    timers.tick(2_999);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(1);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("backs unavailable probes off through 15, 30, and 60 seconds", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return { hasUnavailable: true };
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(15_000);
    await flushPromises();
    assert.equal(calls, 2);

    timers.tick(30_000);
    await flushPromises();
    assert.equal(calls, 3);

    timers.tick(60_000);
    await flushPromises();
    assert.equal(calls, 4);

    heartbeat.stop();
  });

  it("checks a pending-offline stream again after ten seconds", async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        return calls === 1
          ? { hasUnavailable: false, pendingOfflineDelayMs: 10_000 }
          : available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    timers.tick(9_999);
    await flushPromises();
    assert.equal(calls, 1);

    timers.tick(1);
    await flushPromises();
    assert.equal(calls, 2);

    heartbeat.stop();
  });

  it("coalesces sanity checks without running concurrent probes", async () => {
    const timers = new FakeTimers();
    const releases: Array<() => void> = [];
    let calls = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const heartbeat = new VrcdnLiveHeartbeat({
      clearTimeout: timers.clearTimeout,
      isVisible: () => true,
      now: () => timers.now,
      probe: async () => {
        calls += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((resolve) => releases.push(resolve));
        concurrent -= 1;
        return available;
      },
      random: () => 0.5,
      setTimeout: timers.setTimeout,
      subscribeToVisibility: () => () => {},
    });

    heartbeat.start();
    await flushPromises();
    heartbeat.requestSanityCheck();
    heartbeat.requestSanityCheck();
    assert.equal(calls, 1);

    releases.shift()?.();
    await flushPromises();
    assert.equal(calls, 2);
    assert.equal(maxConcurrent, 1);

    heartbeat.stop();
  });
});
