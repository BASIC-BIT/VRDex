import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeProfileLinks } from "../../convex/_profileLinks";
import { sanitizeCommunitySubmissionProfileInput } from "../../convex/_profileSubmissions";

describe("profile link sanitization", () => {
  it("rejects links that are not HTTPS", () => {
    assert.throws(
      () => sanitizeProfileLinks([{ type: "website", url: "http://example.com/dj" }], "owner_authored"),
      /Outbound link URL must be an HTTPS URL\./,
    );
  });

  it("rejects link types outside the schema union", () => {
    assert.throws(
      () => sanitizeProfileLinks([{ type: "myspace", url: "https://example.com/dj" }], "owner_authored"),
      /Unsupported outbound link type "myspace"\./,
    );
  });

  it("normalizes a pasted VRCDN stream URL to its canonical page and stream id", () => {
    // The URL VRCDN hands out for PC playback: not HTTPS, and not a web page.
    const [link] = sanitizeProfileLinks(
      [{ type: "vrcdn", url: "rtspt://stream.vrcdn.live/live/basicbit" }],
      "owner_authored",
    );

    assert.equal(link?.type, "vrcdn");
    assert.equal(link?.url, "https://vrcdn.live/basicbit");
    assert.equal(link?.handle, "basicbit");
    assert.equal(link?.label, "VRCDN");
    assert.equal(link?.source, "owner_authored");
  });

  it("rejects a vrcdn link that is not a VRCDN stream", () => {
    assert.throws(
      () => sanitizeProfileLinks([{ type: "vrcdn", url: "https://example.com/live/basicbit" }], "owner_authored"),
      /Outbound link URL must be a VRCDN stream URL\./,
    );
  });

  it("refuses URLs carrying embedded credentials", () => {
    assert.throws(
      () => sanitizeProfileLinks([{ type: "website", url: "https://user:pass@example.com/dj" }], "owner_authored"),
      /Outbound links must not contain embedded credentials\./,
    );
  });

  it("stamps the caller's provenance rather than assuming ownership", () => {
    const [link] = sanitizeProfileLinks(
      [{ type: "soundcloud", url: "https://soundcloud.com/dj" }],
      "community_submitted",
    );

    assert.equal(link?.source, "community_submitted");
    assert.equal(link?.label, "SoundCloud");
  });

  it("carries submitted links through the shared submission sanitizer", () => {
    const input = sanitizeCommunitySubmissionProfileInput(
      {
        profileType: "person",
        displayName: "DJ Celine",
        outboundLinks: [{ type: "twitch", url: "https://twitch.tv/djceline" }],
      },
      { linkSource: "community_submitted" },
    );

    assert.deepEqual(input.outboundLinks, [
      {
        type: "twitch",
        label: "Twitch",
        url: "https://twitch.tv/djceline",
        source: "community_submitted",
      },
    ]);
  });
});
