import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  twitchLinkForLiveClaim,
  twitchLoginForLiveClaim,
  twitchLoginFromUrl,
} from "../../apps/web/src/lib/twitch-url";

describe("Twitch live claims", () => {
  it("reports a channel the profile owner put there", () => {
    assert.equal(
      twitchLoginForLiveClaim([
        { source: "owner_authored", type: "twitch", url: "https://www.twitch.tv/dj_aurora" },
      ]),
      "dj_aurora",
    );
  });

  it("selects the first valid channel regardless of provenance", () => {
    const community = { source: "community_submitted", type: "twitch", url: "https://twitch.tv/dj_aurora" };
    const links = [community, { source: "reviewed", type: "twitch", url: "https://twitch.tv/another_dj" }];
    assert.equal(twitchLoginForLiveClaim(links), "dj_aurora");
    assert.equal(twitchLinkForLiveClaim(links), community);
  });
});

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
