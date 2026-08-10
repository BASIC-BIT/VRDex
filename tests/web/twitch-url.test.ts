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

  it("will not claim someone is live on a stranger's say-so", () => {
    // `submitCommunityProfile` publishes immediately, so anyone signed in can
    // attach a channel to somebody else's unclaimed profile. Helix would report
    // that channel live and hand over its title and viewer count with it.
    assert.equal(
      twitchLoginForLiveClaim([
        { source: "community_submitted", type: "twitch", url: "https://www.twitch.tv/someone_else" },
      ]),
      null,
    );
  });

  it("skips the unvetted link rather than the whole profile", () => {
    assert.equal(
      twitchLoginForLiveClaim([
        { source: "community_submitted", type: "twitch", url: "https://www.twitch.tv/someone_else" },
        { source: "reviewed", type: "twitch", url: "https://www.twitch.tv/dj_aurora" },
      ]),
      "dj_aurora",
    );
  });

  it("hands back the link it probed, so the page cannot display a different one", () => {
    // The profile page renders the link this returns. When the two were
    // separate passes, a profile with an unvetted link first showed the vetted
    // channel's live title and viewer count above a button pointing at the
    // unvetted one.
    const vetted = {
      source: "reviewed",
      type: "twitch",
      url: "https://www.twitch.tv/dj_aurora",
    } as const;

    assert.equal(
      twitchLinkForLiveClaim([
        { source: "community_submitted", type: "twitch", url: "https://www.twitch.tv/someone_else" },
        vetted,
      ]),
      vetted,
    );
    assert.equal(
      twitchLinkForLiveClaim([
        { source: "community_submitted", type: "twitch", url: "https://www.twitch.tv/someone_else" },
      ]),
      null,
    );
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
