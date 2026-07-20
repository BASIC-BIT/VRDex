import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { discordCopyValue } from "../../apps/web/src/lib/discord-link";

describe("Discord lookup links", () => {
  it("copies explicit handles and user-profile identifiers", () => {
    assert.equal(
      discordCopyValue({
        handle: "basic_bit",
        label: "Discord",
        url: "https://discord.com",
      }),
      "basic_bit",
    );
    assert.equal(
      discordCopyValue({
        label: "Discord: djaurora",
        url: "https://discord.com/users/100000000000000001",
      }),
      "djaurora",
    );
    assert.equal(
      discordCopyValue({
        label: "Discord",
        url: "https://discord.com/users/100000000000000002",
      }),
      "100000000000000002",
    );
  });

  it("leaves invites, server channels, and descriptive labels clickable", () => {
    for (const link of [
      {
        label: "Discord: VRDancing server",
        url: "https://discord.gg/vrdancing",
      },
      {
        label: "Discord: vrdancing",
        url: "https://discord.com/invite/vrdancing",
      },
      {
        handle: "vrdancing",
        label: "Discord server",
        url: "https://discord.com/channels/100/200",
      },
      {
        label: "Discord: VRDancing server",
        url: "https://discord.com",
      },
    ]) {
      assert.equal(discordCopyValue(link), null);
    }
  });
});
