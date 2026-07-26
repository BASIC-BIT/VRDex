import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runDiscordAdapterProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: "test-discord-adapter-token",
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_ENABLE_E2E_ADAPTER_HELPERS: "true",
      VRDEX_ENABLE_E2E_HELPERS: "true",
      VERCEL_ENV: "preview",
    },
  });
}

describe("Discord E2E adapter", () => {
  it("serves a complete Administrator fixture for the configured numeric guild id", () => {
    const output = runDiscordAdapterProbe(`
      import { GET } from "./apps/web/src/app/api/e2e/adapters/discord/[...path]/route.ts";
      import { E2E_DISCORD_GUILD_ID } from "./apps/web/src/lib/e2e-discord-fixture.ts";

      const request = new Request("https://app.example.test/api/e2e/adapters/discord", {
        headers: { authorization: "Bot test-discord-adapter-token" },
      });
      const paths = [
        ["guilds", E2E_DISCORD_GUILD_ID],
        ["guilds", E2E_DISCORD_GUILD_ID, "members", "discord-e2e-user"],
        ["guilds", E2E_DISCORD_GUILD_ID, "roles"],
      ];

      for (const path of paths) {
        const response = await GET(request, { params: Promise.resolve({ path }) });
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      }
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"id":"123456789012345678"/);
    assert.match(output, /"roles":\["admin-123456789012345678"\]/);
    assert.match(output, /"permissions":"8"/);
  });

  it("rejects other production-shaped guild ids outside the deterministic fixture", () => {
    const output = runDiscordAdapterProbe(`
      import { GET } from "./apps/web/src/app/api/e2e/adapters/discord/[...path]/route.ts";

      const response = await GET(
        new Request("https://app.example.test/api/e2e/adapters/discord", {
          headers: { authorization: "Bot test-discord-adapter-token" },
        }),
        { params: Promise.resolve({ path: ["guilds", "987654321098765432"] }) },
      );
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^404/m);
    assert.match(output, /"error":"Unknown E2E Discord adapter route\."/);
  });
});
