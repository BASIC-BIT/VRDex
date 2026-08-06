import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVrcdnStreamLinks, parseVrcdnStreamLinks } from "../../convex/_vrcdnLinks";

describe("VRCDN stream links", () => {
  it("derives canonical stream URLs from common VRCDN variants", () => {
    for (const input of [
      "https://vrcdn.live/basicbit",
      "https://stream.vrcdn.live/live/basicbit.live.ts",
      "rtspt://stream.vrcdn.live/live/basicbit",
      "https://stream.vrcdn.live/live/basicbit.m3u8",
      "https://stream.vrcdn.live/live/basicbit.mp4",
      // The URL VRCDN hands an operator looking for their own stream, so it is
      // what people paste and what the NWinn partner export carried. Read for
      // its id and rebuilt as the public page URL, never stored as-is.
      "https://panel.vrcdn.live/preview/basicbit",
    ]) {
      const links = parseVrcdnStreamLinks(input);

      assert.equal(links?.streamId, "basicbit");
      assert.equal(links?.pageUrl, "https://vrcdn.live/basicbit");
      assert.equal(links?.previewUrl, "https://panel.vrcdn.live/preview/basicbit");
      assert.equal(links?.hlsUrl, "https://stream.vrcdn.live/live/basicbit.m3u8");
      assert.equal(links?.questUrl, "https://stream.vrcdn.live/live/basicbit.live.ts");
      assert.equal(links?.pcUrl, "rtspt://stream.vrcdn.live/live/basicbit");
    }
  });

  it("preserves directly playable MP4 URLs for native video embedding", () => {
    assert.equal(
      parseVrcdnStreamLinks("https://stream.vrcdn.live/live/basicbit.mp4")?.directVideoUrl,
      "https://stream.vrcdn.live/live/basicbit.mp4",
    );
  });

  it("ignores VRCDN operational pages and unsupported hosts", () => {
    assert.equal(parseVrcdnStreamLinks("https://status.vrcdn.live/"), null);
    assert.equal(parseVrcdnStreamLinks("https://vrcdn.live/status"), null);
    assert.equal(parseVrcdnStreamLinks("https://stream.vrcdn.live/api/v1/basicbit"), null);
    assert.equal(parseVrcdnStreamLinks("https://example.invalid/live/basicbit.m3u8"), null);
  });

  it("reads only the preview path on the panel host", () => {
    // The panel is VRCDN's operator console. /preview/<id> names a stream; the
    // rest of it names pages that have nothing to do with one, and admitting the
    // whole host would make "VRCDN link" mean "anything on the dashboard".
    assert.equal(parseVrcdnStreamLinks("https://panel.vrcdn.live/dashboard"), null);
    assert.equal(parseVrcdnStreamLinks("https://panel.vrcdn.live/"), null);
    assert.equal(parseVrcdnStreamLinks("https://panel.vrcdn.live/preview/"), null);

    // The reserved names the root host rejects, reachable through the preview
    // path too: without the same check, /preview/dashboard canonicalizes to
    // vrcdn.live/dashboard and a product page ships as somebody's stream link.
    for (const reserved of ["dashboard", "login", "panel", "status", "wiki", "api"]) {
      assert.equal(
        parseVrcdnStreamLinks(`https://panel.vrcdn.live/preview/${reserved}`),
        null,
        reserved,
      );
    }
  });

  // Every route into a stream id now runs the reserved check, because every one
  // of them ends up building the same canonical vrcdn.live/<id> page link.
  // Guarding the paths where a reserved name looked likely left the stream
  // endpoints rebuilding VRCDN's own product pages as somebody's stream.
  it("refuses reserved names arriving as stream endpoints", () => {
    for (const reserved of ["dashboard", "login", "panel", "status", "wiki", "api"]) {
      for (const url of [
        `https://stream.vrcdn.live/live/${reserved}.m3u8`,
        `https://stream.vrcdn.live/live/${reserved}.live.ts`,
        `rtspt://stream.vrcdn.live/live/${reserved}`,
        `https://vrcdn.live/watch/${reserved}`,
        `https://vrcdn.live/embed/${reserved}`,
      ]) {
        assert.equal(parseVrcdnStreamLinks(url), null, url);
      }
    }

    // Still a stream when the name is not reserved, on the same paths.
    assert.equal(
      parseVrcdnStreamLinks("https://stream.vrcdn.live/live/snekwtf.m3u8")?.pageUrl,
      "https://vrcdn.live/snekwtf",
    );
  });

  it("refuses to build canonical links for a reserved id", () => {
    // createVrcdnStreamLinks is called with ids from outside the parser too, so
    // the shared normalizer is where this has to hold.
    assert.equal(createVrcdnStreamLinks("dashboard"), null);
    assert.equal(createVrcdnStreamLinks("snekwtf")?.pageUrl, "https://vrcdn.live/snekwtf");
  });
});
