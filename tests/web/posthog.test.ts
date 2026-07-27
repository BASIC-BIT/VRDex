import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SESSION_REPLAY_MASKED_SELECTOR,
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
    assert.equal(
      sanitizeAnalyticsUrl("https://vrdex.example/claim/private-profile?source=search"),
      "https://vrdex.example/claim/redacted",
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

  // Replay now runs on every route, so URL redaction is the protection that
  // stops sensitive path segments reaching PostHog on the routes that used to
  // be excluded outright.
  it("redacts sensitive path segments on formerly excluded routes", () => {
    assert.equal(sanitizeAnalyticsUrl("/handoff/secret-token"), "/handoff/redacted");
    assert.equal(sanitizeAnalyticsUrl("/claim/private-profile"), "/claim/redacted");
    assert.equal(sanitizeAnalyticsUrl("/account/privacy?tab=exports"), "/account/privacy");
    assert.equal(sanitizeAnalyticsUrl("/sign-in?returnTo=%2Fclaim%2Fsecret"), "/sign-in");
  });

  it("keeps the replay masking selector aligned with the blocked claim region", () => {
    assert.equal(SESSION_REPLAY_MASKED_SELECTOR, "[data-ph-no-capture]");
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
