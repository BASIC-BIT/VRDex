import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConvexError } from "convex/values";

import {
  PROFILE_LINK_MAX_COUNT,
  sanitizeProfileLinks,
  sanitizeProfileLinksLeniently,
} from "../../convex/_profileLinks";
import { sanitizeCommunitySubmissionProfileInput } from "../../convex/_profileSubmissions";

/**
 * Link failures are `ConvexError`s so the reason survives production redaction,
 * which means the readable text lives in `data.message`, not `error.message`.
 */
function assertLinkError(run: () => unknown, expected: RegExp) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ConvexError, "expected a ConvexError");

    const data = error.data as { code?: string; message?: string };

    assert.equal(data.code, "INVALID_PROFILE_LINK");
    assert.match(data.message ?? "", expected);

    return true;
  });
}

describe("profile link sanitization", () => {
  it("rejects links that are not HTTPS", () => {
    assertLinkError(
      () => sanitizeProfileLinks([{ type: "website", url: "http://example.com/dj" }], "owner_authored"),
      /Outbound link URL must be an HTTPS URL\./,
    );
  });

  it("rejects link types outside the schema union", () => {
    assertLinkError(
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
    assertLinkError(
      () => sanitizeProfileLinks([{ type: "vrcdn", url: "https://example.com/live/basicbit" }], "owner_authored"),
      /Outbound link URL must be a VRCDN stream URL\./,
    );
  });

  it("refuses URLs carrying embedded credentials", () => {
    assertLinkError(
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

  it("keeps a branded link type pointed at its own provider", () => {
    // The public profile renders the type as a branded action, and community
    // submission publishes immediately for a profile the submitter does not own.
    assertLinkError(
      () => sanitizeProfileLinks([{ type: "discord", url: "https://evil.example/invite" }], "community_submitted"),
      /A Discord link must point at discord\.com\./,
    );

    assert.doesNotThrow(() =>
      sanitizeProfileLinks([{ type: "discord", url: "https://discord.gg/abc123" }], "community_submitted"),
    );
  });

  it("leaves custom-domain commerce types unconstrained", () => {
    // Bandcamp and Gumroad stores routinely live on the seller's own domain.
    assert.doesNotThrow(() =>
      sanitizeProfileLinks([{ type: "bandcamp", url: "https://music.djceline.example/" }], "owner_authored"),
    );
  });

  it("rejects an overlength URL rather than silently truncating it", () => {
    assertLinkError(
      () =>
        sanitizeProfileLinks(
          [{ type: "website", url: `https://example.com/${"a".repeat(2_100)}` }],
          "owner_authored",
        ),
      /Outbound link URL must be 2048 characters or fewer\./,
    );
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

describe("lenient profile link sanitization", () => {
  it("collapses a stream link and its panel preview onto one public link", () => {
    // The exact pair the NWinn export carried for most DJs. Storing them as
    // given put VRCDN's operator console on public profiles, and keeping only
    // the parseable one would have dropped the DJs who had a preview and
    // nothing else.
    const result = sanitizeProfileLinksLeniently(
      [
        { type: "vrcdn", url: "https://stream.vrcdn.live/live/snekwtf.live.ts" },
        { type: "vrcdn", url: "https://panel.vrcdn.live/preview/snekwtf" },
      ],
      "reviewed",
    );

    assert.deepEqual(result.links, [
      {
        type: "vrcdn",
        label: "VRCDN",
        url: "https://vrcdn.live/snekwtf",
        handle: "snekwtf",
        source: "reviewed",
      },
    ]);
    assert.equal(result.deduplicatedCount, 1);
    assert.equal(result.droppedCount, 0);
  });

  it("keeps the good links when one entry is unusable", () => {
    // The whole reason this exists beside sanitizeProfileLinks: a publication
    // has no writer looking at a form, so one bad row must not fail the batch.
    const result = sanitizeProfileLinksLeniently(
      [
        { type: "twitch", url: "https://twitch.tv/snekwtf" },
        { type: "vrcdn", url: "https://example.invalid/not-a-stream" },
        { type: "website", url: "not a url at all" },
      ],
      "reviewed",
    );

    assert.deepEqual(
      result.links.map((link) => link.url),
      ["https://twitch.tv/snekwtf"],
    );
    assert.equal(result.droppedCount, 2);
  });

  it("counts the overflow past the link cap instead of truncating quietly", () => {
    const result = sanitizeProfileLinksLeniently(
      Array.from({ length: PROFILE_LINK_MAX_COUNT + 3 }, (_unused, index) => ({
        type: "website",
        url: `https://example.com/${index}`,
      })),
      "reviewed",
    );

    assert.equal(result.links.length, PROFILE_LINK_MAX_COUNT);
    assert.equal(result.droppedCount, 3);
  });

  it("still enforces the provider host rule", () => {
    // Leniency is about not failing a whole batch, not about relaxing what may
    // be stored: a "Twitch" button pointing elsewhere is the same lie here.
    const result = sanitizeProfileLinksLeniently(
      [{ type: "twitch", url: "https://example.com/djceline" }],
      "reviewed",
    );

    assert.deepEqual(result.links, []);
    assert.equal(result.droppedCount, 1);
  });
});
