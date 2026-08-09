import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maxVrcdnObservationAgeMs,
  vrcdnLiveStateFromStatus,
  vrcdnReportedState,
  vrcdnStreamIds,
} from "../../apps/web/src/lib/vrcdn-live";

describe("VRCDN liveness", () => {
  it("reads the media server's answer, and refuses to guess at anything else", () => {
    assert.equal(vrcdnLiveStateFromStatus(200), "live");
    // Not `offline`. The stream is publishing or it is not; a CDN failure is
    // neither, and showing it as idle would be a claim we cannot support.
    assert.equal(vrcdnLiveStateFromStatus(500), "unavailable");
    assert.equal(vrcdnLiveStateFromStatus(404), "offline");
  });

  it("does not read a bodyless success as a stream", () => {
    // A `204` carries no manifest, so it is some intermediary answering rather
    // than VRCDN reporting that anyone is publishing.
    assert.equal(vrcdnLiveStateFromStatus(204), "unavailable");
  });

  it("stops reporting an observation it can no longer refresh", () => {
    const observedAt = 1_000_000;

    assert.equal(vrcdnReportedState({ observedAt, state: "live" }, observedAt + 30_000), "live");
    // The cache would keep serving this entry while every refresh throws. Past
    // the ceiling it stops being evidence that anyone is still streaming.
    assert.equal(
      vrcdnReportedState({ observedAt, state: "live" }, observedAt + maxVrcdnObservationAgeMs + 1),
      "unavailable",
    );
  });

  it("asks once per stream, however the profile spelled it", () => {
    assert.deepEqual(
      vrcdnStreamIds([
        { type: "vrcdn", url: "https://vrcdn.live/djaurora" },
        { type: "vrcdn", url: "https://stream.vrcdn.live/live/djaurora.m3u8" },
        { type: "vrcdn", url: "https://panel.vrcdn.live/preview/djaurora" },
        { type: "vrcdn", url: "rtspt://stream.vrcdn.live/live/nightshift" },
      ]),
      ["djaurora", "nightshift"],
    );
  });

  it("probes nothing for links that are not a VRCDN stream", () => {
    assert.deepEqual(
      vrcdnStreamIds([
        { type: "twitch", url: "https://twitch.tv/djaurora" },
        // Typed `vrcdn` by a submitter, but VRCDN's own product page rather
        // than a stream. Probing it would ask about a stream id that is really
        // a route name.
        { type: "vrcdn", url: "https://vrcdn.live/dashboard" },
        { type: "vrcdn", url: "https://example.com/not-vrcdn" },
      ]),
      [],
    );
  });
});
