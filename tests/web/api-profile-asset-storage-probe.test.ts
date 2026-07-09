import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runProfileAssetStorageProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: "",
      AWS_REGION: "",
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      VRDEX_ASSET_BUCKET: "",
      VRDEX_PROFILE_ASSET_BUCKET: "",
      VRDEX_PROFILE_ASSET_REGION: "",
      VRDEX_RATE_LIMIT_STORE: "memory",
    },
  });
}

describe("profile asset storage probe", () => {
  it("rejects bearer tokens in query parameters before probing storage", () => {
    const output = runProfileAssetStorageProbe(`
      import { GET } from "./apps/web/src/app/api/v0/profile-assets/upload-intents/probe/route.ts";

      const response = await GET(new Request(
        "https://app.example.test/api/v0/profile-assets/upload-intents/probe?access_token=secret",
        {
          headers: {
            "x-forwarded-for": "198.51.100.91",
            "x-vercel-forwarded-for": "198.51.100.91",
          },
        },
      ));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^400/m);
    assert.match(output, /"title":"Bearer token query parameters are not allowed"/);
  });

  it("applies the standard anonymous public-read rate limit", () => {
    const output = runProfileAssetStorageProbe(`
      import { GET } from "./apps/web/src/app/api/v0/profile-assets/upload-intents/probe/route.ts";

      const statuses = [];
      for (let attempt = 1; attempt <= 121; attempt += 1) {
        const response = await GET(new Request(
          "https://app.example.test/api/v0/profile-assets/upload-intents/probe",
          {
            headers: {
              "x-forwarded-for": "198.51.100.92",
              "x-vercel-forwarded-for": "198.51.100.92",
            },
          },
        ));

        if (attempt === 1 || attempt === 120 || attempt === 121) {
          statuses.push(response.status);
        }
      }
      console.log(JSON.stringify(statuses));
    `);

    assert.match(output, /\[501,501,429\]/);
  });
});
