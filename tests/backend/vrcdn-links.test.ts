import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseVrcdnStreamLinks } from "../../convex/_vrcdnLinks";

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
  });
});
