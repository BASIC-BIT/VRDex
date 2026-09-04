import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectVrcdnLiveStates,
  probeVrcdnLiveState,
  vrcdnProbeLog,
} from "../../apps/web/src/lib/vrcdn-live-probe";

describe("VRCDN live probe", () => {
  it("reads a fresh transport response and drops the media body", async () => {
    let requestedUrl = "";
    let bodyCancelled = false;
    const response = new Response(new ReadableStream({
      cancel() {
        bodyCancelled = true;
      },
    }), { status: 200 });
    const result = await probeVrcdnLiveState("basicbit", {
      fetchImplementation: async (input) => {
        requestedUrl = String(input);
        return response;
      },
      now: () => 1_000_000,
      signal: AbortSignal.abort(),
    });

    assert.equal(requestedUrl, "https://stream.vrcdn.live/live/basicbit.live.ts");
    assert.deepEqual(result, {
      durationMs: 0,
      observedAt: 1_000_000,
      state: "live",
      status: 200,
    });
    assert.equal(bodyCancelled, true);
  });

  it("keeps probe logs bounded and free of stream or profile identifiers", () => {
    assert.deepEqual(vrcdnProbeLog({
      durationMs: 3812,
      freshnessMode: "fresh",
      state: "offline",
      status: 404,
    }), {
      durationMs: 3812,
      freshnessMode: "fresh",
      level: "info",
      message: "VRCDN live-state lookup completed",
      provider: "vrcdn",
      state: "offline",
      status: 404,
    });
  });

  it("uses an uncached provider observation for a requested fresh check", async () => {
    let cachedCalls = 0;
    let freshCalls = 0;
    const states = await collectVrcdnLiveStates(["alpha"], {
      freshnessMode: "fresh",
      now: () => 1_000_000,
      readCached: async () => {
        cachedCalls += 1;
        return { durationMs: 2, observedAt: 999_000, state: "offline", status: 404 };
      },
      readFresh: async () => {
        freshCalls += 1;
        return { durationMs: 4, observedAt: 1_000_000, state: "live", status: 200 };
      },
    });

    assert.deepEqual(states, { alpha: "live" });
    assert.equal(cachedCalls, 0);
    assert.equal(freshCalls, 1);
  });

  it("logs only bounded metadata for each provider observation", async () => {
    const entries: unknown[] = [];
    await collectVrcdnLiveStates(["secret-stream-id"], {
      freshnessMode: "fresh",
      log: (entry) => entries.push(entry),
      now: () => 1_000_000,
      readCached: async () => {
        throw new Error("unused");
      },
      readFresh: async () => ({
        durationMs: 3812,
        observedAt: 1_000_000,
        state: "offline",
        status: 404,
      }),
    });

    assert.deepEqual(entries, [{
      durationMs: 3812,
      freshnessMode: "fresh",
      level: "info",
      message: "VRCDN live-state lookup completed",
      provider: "vrcdn",
      state: "offline",
      status: 404,
    }]);
    assert.equal(JSON.stringify(entries).includes("secret-stream-id"), false);
  });

  it("buckets probe failures without logging arbitrary error text", async () => {
    const entries: unknown[] = [];
    const states = await collectVrcdnLiveStates(["secret-stream-id"], {
      freshnessMode: "fresh",
      log: (entry) => entries.push(entry),
      now: () => 1_000_000,
      readCached: async () => {
        throw new Error("unused");
      },
      readFresh: async () => {
        throw new Error("credential-like arbitrary provider failure");
      },
    });

    assert.deepEqual(states, { "secret-stream-id": "unavailable" });
    assert.deepEqual(entries, [{
      durationMs: 0,
      errorKind: "unknown",
      freshnessMode: "fresh",
      level: "error",
      message: "VRCDN live-state lookup failed",
      provider: "vrcdn",
    }]);
    assert.equal(JSON.stringify(entries).includes("credential-like"), false);
    assert.equal(JSON.stringify(entries).includes("secret-stream-id"), false);
  });
});
