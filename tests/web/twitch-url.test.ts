import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { twitchLoginFromUrl } from "../../apps/web/src/lib/twitch-url";

describe("Twitch channel URLs", () => {
  it("normalizes canonical channel URLs", () => {
    assert.equal(twitchLoginFromUrl("https://twitch.tv/Basic_Bit"), "basic_bit");
    assert.equal(twitchLoginFromUrl("https://www.twitch.tv/dj_aurora"), "dj_aurora");
  });

  it("rejects non-channel and credential-bearing URLs", () => {
    for (const value of [
      "http://twitch.tv/basic_bit",
      "https://twitch.tv/directory",
      "https://twitch.tv/videos/123",
      "https://user:secret@twitch.tv/basic_bit",
      "https://twitch.tv/basic_bit?token=secret",
      "https://twitch.tv/basic_bit#fragment",
      "https://example.com/basic_bit",
    ]) {
      assert.equal(twitchLoginFromUrl(value), null);
    }
  });
});
