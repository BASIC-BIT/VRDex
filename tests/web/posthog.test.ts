import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionReplayAllowedPathname,
  mirrorPrivateSeedLookupAccess,
  mirrorTemporalParsingAccess,
  sanitizeAnalyticsUrl,
  sanitizePostHogProperties,
} from "../../apps/web/src/lib/posthog";

describe("PostHog privacy", () => {
  it("removes queries and handoff tokens from captured URLs", () => {
    assert.equal(
      sanitizeAnalyticsUrl("https://vrdex.example/handoff/secret-token?step=review#fields"),
      "https://vrdex.example/handoff/redacted",
    );
    assert.equal(sanitizeAnalyticsUrl("/search?q=DJ%20Example"), "/search");
    assert.deepEqual(
      sanitizePostHogProperties({
        $current_url: "https://vrdex.example/handoff/secret-token",
        $pathname: "/handoff/secret-token",
        event_type: "pageview",
      }),
      {
        $current_url: "https://vrdex.example/handoff/redacted",
        $pathname: "/handoff/redacted",
        event_type: "pageview",
      },
    );
  });

  it("records only explicitly public, non-form routes", () => {
    assert.equal(isSessionReplayAllowedPathname("/"), true);
    assert.equal(isSessionReplayAllowedPathname("/p/dj-example"), true);
    assert.equal(isSessionReplayAllowedPathname("/handoff/secret-token"), false);
    assert.equal(isSessionReplayAllowedPathname("/lookup"), false);
    assert.equal(isSessionReplayAllowedPathname("/time"), false);
    assert.equal(isSessionReplayAllowedPathname("/account/privacy"), false);
    assert.equal(isSessionReplayAllowedPathname("/sign-in"), false);
  });

  it("mirrors lookup grants into persisted and immediate flag properties", () => {
    const calls: Array<{ method: string; properties: unknown; reload?: boolean }> = [];
    const posthog = {
      setPersonProperties(properties: unknown) {
        calls.push({ method: "person", properties });
      },
      setPersonPropertiesForFlags(properties: unknown, reload: boolean) {
        calls.push({ method: "flags", properties, reload });
      },
    };

    mirrorPrivateSeedLookupAccess(posthog as never, true);

    assert.deepEqual(calls, [
      { method: "person", properties: { seed_lookup_beta: "true" } },
      {
        method: "flags",
        properties: { seed_lookup_beta: "true" },
        reload: true,
      },
    ]);
  });

  it("mirrors temporal authorization without including user input", () => {
    const calls: Array<{ method: string; properties: unknown; reload?: boolean }> = [];
    const posthog = {
      setPersonProperties(properties: unknown) {
        calls.push({ method: "person", properties });
      },
      setPersonPropertiesForFlags(properties: unknown, reload: boolean) {
        calls.push({ method: "flags", properties, reload });
      },
    };

    mirrorTemporalParsingAccess(posthog as never, true);

    assert.deepEqual(calls, [
      { method: "person", properties: { temporal_parsing_beta: "true" } },
      {
        method: "flags",
        properties: { temporal_parsing_beta: "true" },
        reload: true,
      },
    ]);
  });
});
