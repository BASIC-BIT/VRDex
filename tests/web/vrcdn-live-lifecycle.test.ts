import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyVrcdnLiveStates,
  applyVrcdnLiveProbe,
  createVrcdnLiveLifecycle,
  createVrcdnLiveLifecycles,
  maxVrcdnPresentationAgeMs,
} from "../../apps/web/src/lib/vrcdn-live-lifecycle";

describe("VRCDN live lifecycle", () => {
  it("requires a second fresh offline observation after a confirmed live stream", () => {
    const liveAt = 1_000_000;
    const initial = createVrcdnLiveLifecycle("live", liveAt);
    const pending = applyVrcdnLiveProbe(initial, "offline", liveAt + 60_000);

    assert.equal(pending.presentation, "live");
    assert.equal(pending.status, "pending_offline");

    const offline = applyVrcdnLiveProbe(pending, "offline", liveAt + 70_000);

    assert.equal(offline.presentation, "offline");
    assert.equal(offline.status, "offline");
  });

  it("lets one fresh live observation promote an offline stream", () => {
    const offline = createVrcdnLiveLifecycle("offline", 1_000_000);
    const live = applyVrcdnLiveProbe(offline, "live", 1_060_000);

    assert.equal(live.presentation, "live");
    assert.equal(live.status, "live");
  });

  it("cancels a pending-offline transition when the stream answers live", () => {
    const live = createVrcdnLiveLifecycle("live", 1_000_000);
    const pending = applyVrcdnLiveProbe(live, "offline", 1_060_000);
    const recovered = applyVrcdnLiveProbe(pending, "live", 1_065_000);

    assert.equal(recovered.presentation, "live");
    assert.equal(recovered.status, "live");
    assert.equal(recovered.pendingOfflineAt, undefined);
  });

  it("does not count two offline observations less than ten seconds apart", () => {
    const live = createVrcdnLiveLifecycle("live", 1_000_000);
    const pending = applyVrcdnLiveProbe(live, "offline", 1_060_000);
    const earlySecond = applyVrcdnLiveProbe(pending, "offline", 1_069_999);

    assert.equal(earlySecond.presentation, "live");
    assert.equal(earlySecond.status, "pending_offline");
  });

  it("stops presenting a confirmed state after five minutes of unavailable probes", () => {
    const liveAt = 1_000_000;
    const initial = createVrcdnLiveLifecycle("live", liveAt);

    assert.equal(
      applyVrcdnLiveProbe(initial, "unavailable", liveAt + maxVrcdnPresentationAgeMs).presentation,
      "live",
    );
    assert.equal(
      applyVrcdnLiveProbe(initial, "unavailable", liveAt + maxVrcdnPresentationAgeMs + 1)
        .presentation,
      "unknown",
    );
  });

  it("updates every stream and treats a missing result as unavailable", () => {
    const observedAt = 1_000_000;
    const initial = createVrcdnLiveLifecycles(
      ["alpha", "beta"],
      { alpha: "live", beta: "offline" },
      observedAt,
    );
    const first = applyVrcdnLiveStates(
      initial,
      ["alpha", "beta"],
      { alpha: "offline" },
      observedAt + 60_000,
    );

    assert.equal(first.lifecycles.alpha.status, "pending_offline");
    assert.equal(first.lifecycles.beta.presentation, "offline");
    assert.equal(first.hasUnavailable, true);
    assert.equal(first.pendingOfflineDelayMs, 10_000);

    const second = applyVrcdnLiveStates(
      first.lifecycles,
      ["alpha", "beta"],
      { alpha: "offline", beta: "live" },
      observedAt + 70_000,
    );

    assert.equal(second.lifecycles.alpha.presentation, "offline");
    assert.equal(second.lifecycles.beta.presentation, "live");
    assert.equal(second.hasUnavailable, false);
    assert.equal(second.pendingOfflineDelayMs, undefined);
  });
});
