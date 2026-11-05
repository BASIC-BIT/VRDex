import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createConnectorCache } from "./connectorCache";

describe("connector cache", () => {
  it("caches lookups for 60 seconds per channel", async () => {
    let now = 0, calls = 0;
    const cache = createConnectorCache({ now: () => now, fetchConnectors: async () => { calls += 1; return [{ connectorId: "c1", kind: "discord_announcements", direction: "import", mode: "hold", state: "active", guildId: "g", channelId: "c" }]; } });
    await cache.get({ guildId: "g", channelId: "c" }); now = 59_999; await cache.get({ guildId: "g", channelId: "c" }); assert.equal(calls, 1);
    now = 60_001; await cache.get({ guildId: "g", channelId: "c" }); assert.equal(calls, 2);
    await cache.get({ guildId: "g", channelId: "other" }); assert.equal(calls, 3);
    await cache.get({ guildId: "g" }); assert.equal(calls, 4);
  });

  it("does not cache a failed lookup", async () => {
    let calls = 0;
    const cache = createConnectorCache({ fetchConnectors: async () => { calls += 1; if (calls === 1) throw new Error("down"); return []; } });
    await assert.rejects(cache.get({ guildId: "g", channelId: "c" }));
    assert.deepEqual(await cache.get({ guildId: "g", channelId: "c" }), []);
    assert.equal(calls, 2);
  });
});
