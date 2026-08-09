import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { vrcdnLiveStateFromStatus, vrcdnStreamIds } from "../../apps/web/src/lib/vrcdn-live";

describe("VRCDN liveness", () => {
  it("reads the media server's answer, and refuses to guess at anything else", () => {
    assert.equal(vrcdnLiveStateFromStatus(200), "live");
    // Not `offline`. The stream is publishing or it is not; a CDN failure is
    // neither, and showing it as idle would be a claim we cannot support.
    assert.equal(vrcdnLiveStateFromStatus(500), "unavailable");
    assert.equal(vrcdnLiveStateFromStatus(404), "offline");
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
