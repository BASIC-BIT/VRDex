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
    ]) {
      const links = parseVrcdnStreamLinks(input);

      assert.equal(links?.streamId, "basicbit");
      assert.equal(links?.pageUrl, "https://vrcdn.live/basicbit");
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
});
