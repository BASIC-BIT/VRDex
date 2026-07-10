import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionReplayAllowedPathname,
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
    assert.equal(isSessionReplayAllowedPathname("/account/privacy"), false);
    assert.equal(isSessionReplayAllowedPathname("/sign-in"), false);
  });
});
