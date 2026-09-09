import assert from "node:assert/strict";
import { it } from "node:test";
import { twitchLinkForLiveClaim } from "../../apps/web/src/lib/twitch-url";
import { vrcdnStreamIds } from "../../apps/web/src/lib/vrcdn-live";

it("checks community-submitted streams for both providers", () => {
  const twitch = { source: "community_submitted", type: "twitch", url: "https://twitch.tv/ivycatty" };
  assert.equal(twitchLinkForLiveClaim([twitch]), twitch);
  assert.deepEqual(vrcdnStreamIds([{ source: "community_submitted", type: "vrcdn", url: "https://stream.vrcdn.live/live/ivycatty.live.ts" }]), ["ivycatty"]);
});
