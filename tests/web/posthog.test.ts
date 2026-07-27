import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SESSION_REPLAY_MASKED_SELECTOR,
  mirrorPrivateSeedLookupAccess,
  mirrorTemporalParsingAccess,
  sanitizeAnalyticsUrl,
  sanitizePostHogEvent,
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

  // A replay recording carries its own copy of the page URL, in the rrweb meta
  // record inside `$snapshot_data`. Blocking the DOM does not touch it, and
  // posthog-js skips `sanitize_properties` entirely for `$snapshot` events —
  // which is why redaction has to run from `before_send` and has to walk the
  // snapshot payload. Without this a handoff token survives in the recording.
  it("redacts the URL a replay recording carries with it", () => {
    const event = sanitizePostHogEvent({
      properties: {
        $snapshot_data: [
          { type: 4, data: { href: "https://vrdex.example/handoff/secret-token", width: 1280 } },
          { type: 2, data: { node: { tagName: "div" } } },
        ],
      },
    });
    const meta = (event!.properties!.$snapshot_data as { data: { href?: string } }[])[0];

    assert.equal(meta!.data.href, "https://vrdex.example/handoff/redacted");
  });

  // Only the meta record's own href. The DOM snapshot is full of hrefs that are
  // not page URLs, and the page-URL sanitizer drops query and fragment — which
  // would rewrite a query-keyed stylesheet into one the player cannot fetch.
  it("leaves hrefs inside the DOM snapshot alone", () => {
    const stylesheet = "https://fonts.example/css2?family=Inter&display=swap";
    const event = sanitizePostHogEvent({
      properties: {
        $snapshot_data: [
          {
            type: 2,
            data: {
              node: {
                tagName: "link",
                attributes: { href: stylesheet },
                childNodes: [{ tagName: "use", attributes: { href: "#icon" } }],
              },
            },
          },
        ],
      },
    });
    const snapshot = (
      event!.properties!.$snapshot_data as {
        data: { node: { attributes: { href: string }; childNodes: { attributes: { href: string } }[] } };
      }[]
    )[0]!;

    assert.equal(snapshot.data.node.attributes.href, stylesheet);
    assert.equal(snapshot.data.node.childNodes[0]!.attributes.href, "#icon");
  });

  // `save_campaign_params` stores the first page a person ever landed on as a
  // `$set_once` person property. For a recipient who arrives via their handoff
  // link, that is the live token, kept forever.
  it("redacts the initial landing URL recorded as a person property", () => {
    const event = sanitizePostHogEvent({
      properties: {},
      $set_once: {
        $initial_current_url: "https://vrdex.example/handoff/secret-token",
        $initial_referrer: "https://vrdex.example/claim/private-profile",
      },
    });

    assert.deepEqual(event!.$set_once, {
      $initial_current_url: "https://vrdex.example/handoff/redacted",
      $initial_referrer: "https://vrdex.example/claim/redacted",
    });
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
