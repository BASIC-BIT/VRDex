import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseVrcdnLiveStates,
  maxVrcdnObservationAgeMs,
  vrcdnLiveStateFromStatus,
  vrcdnReportedState,
  vrcdnStreamIds,
} from "../../apps/web/src/lib/vrcdn-live";

describe("VRCDN liveness", () => {
  it("accepts only the three states published by the profile endpoint", () => {
    assert.deepEqual(
      parseVrcdnLiveStates({ alpha: "live", beta: "offline", gamma: "unavailable" }),
      { alpha: "live", beta: "offline", gamma: "unavailable" },
    );
    assert.equal(parseVrcdnLiveStates({ alpha: "maybe" }), null);
    assert.equal(parseVrcdnLiveStates([]), null);
  });

  // Measured against a real stream on 2026-08-10, live and then idle:
  //   .live.ts   live -> 200   idle -> 404   unknown id -> 401
  it("reads the media server's answer, and refuses to guess at anything else", () => {
    assert.equal(vrcdnLiveStateFromStatus(200), "live");
    // Not `offline`. The stream is publishing or it is not; a CDN failure is
    // neither, and showing it as idle would be a claim we cannot support.
    assert.equal(vrcdnLiveStateFromStatus(500), "unavailable");
    assert.equal(vrcdnLiveStateFromStatus(404), "offline");
  });

  it("treats an id the media server does not know as nobody streaming", () => {
    // `401` is what a bogus stream id answers -- a typo in an owner's own link,
    // say. Distinct from the idle `404` at the endpoint, identical to the
    // reader: no badge either way.
    assert.equal(vrcdnLiveStateFromStatus(401), "offline");
  });

  it("does not read a bodyless success as a stream", () => {
    // A `204` carries no transport stream, so it is some intermediary answering
    // rather than VRCDN reporting that anyone is publishing.
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
        { source: "owner_authored", type: "vrcdn", url: "https://vrcdn.live/djaurora" },
        { source: "owner_authored", type: "vrcdn", url: "https://stream.vrcdn.live/live/djaurora.m3u8" },
        { source: "reviewed", type: "vrcdn", url: "https://panel.vrcdn.live/preview/djaurora" },
        { source: "partner_provided", type: "vrcdn", url: "rtspt://stream.vrcdn.live/live/nightshift" },
      ]),
      ["djaurora", "nightshift"],
    );
  });

  it("probes nothing for links that are not a VRCDN stream", () => {
    assert.deepEqual(
      vrcdnStreamIds([
        { source: "owner_authored", type: "twitch", url: "https://twitch.tv/djaurora" },
        // Typed `vrcdn` by a submitter, but VRCDN's own product page rather
        // than a stream. Probing it would ask about a stream id that is really
        // a route name.
        { source: "owner_authored", type: "vrcdn", url: "https://vrcdn.live/dashboard" },
        { source: "owner_authored", type: "vrcdn", url: "https://example.com/not-vrcdn" },
      ]),
      [],
    );
  });

  it("will not claim someone is live on a stranger's say-so", () => {
    // `submitCommunityProfile` publishes immediately, and a community
    // submission is one signed-in person adding somebody else's profile. A
    // stream id arriving that way could belong to anyone, and a `404` cannot
    // tell "not publishing" from "not their stream".
    assert.deepEqual(
      vrcdnStreamIds([
        { source: "community_submitted", type: "vrcdn", url: "https://vrcdn.live/someone-elses-stream" },
      ]),
      [],
    );
  });
});
