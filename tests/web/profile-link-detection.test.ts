import assert from "node:assert/strict";
import { it } from "node:test";
import { detectProfileLinkType } from "../../apps/web/src/lib/profile-link-detection";

it("recognizes provider URLs without mistaking lookalike hosts for providers", () => {
  assert.equal(detectProfileLinkType("https://www.twitch.tv/basic_bit"), "twitch");
  assert.equal(detectProfileLinkType("https://artist.bandcamp.com/album/one"), "bandcamp");
  assert.equal(detectProfileLinkType("https://youtu.be/abc"), "youtube");
  assert.equal(detectProfileLinkType("https://twitch.tv.example.com/basic"), "website");
  assert.equal(detectProfileLinkType("https://twitch.tv@example.com/basic"), "website");
  assert.equal(detectProfileLinkType("https://example.com/?url=twitch.tv"), "website");
  assert.equal(detectProfileLinkType(""), "website");
  assert.equal(detectProfileLinkType("https://wiki.vrcdn.live/"), "website");
  assert.equal(detectProfileLinkType("https://panel.vrcdn.live/dashboard"), "website");
  assert.equal(detectProfileLinkType("https://panel.vrcdn.live/preview/example"), "vrcdn");
});
