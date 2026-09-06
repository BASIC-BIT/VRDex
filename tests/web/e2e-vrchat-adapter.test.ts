import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("the VRChat fixture accepts both formats without retaining the proof in evidence", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    import { POST } from "./apps/web/src/app/api/e2e/adapters/vrchat-proof/route.ts";
    const results = [];
    for (const proofCode of ["VRDEX19825", "VRDEX-AB12CD34EF56", "VRDEX198250", "VRDEX-"]) {
      const response = await POST(new Request("https://example.test/api/e2e/adapters/vrchat-proof", {
        method: "POST", headers: { authorization: "Bearer fixture-token" },
        body: JSON.stringify({ targetType: "vrchat_user", targetExternalId: "usr_e2e-fixture", proofCode }),
      }));
      const body = await response.json();
      results.push({ verified: body.verified, containsCode: body.evidenceSummary.includes(proofCode) });
    }
    console.log(JSON.stringify(results));
  `], {
    encoding: "utf8",
    env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", VERCEL_ENV: "preview",
      VRDEX_ENABLE_E2E_HELPERS: "true", VRDEX_ENABLE_E2E_ADAPTER_HELPERS: "true",
      VRCHAT_PROOF_ADAPTER_BEARER_TOKEN: "fixture-token" },
  });
  assert.deepEqual(JSON.parse(output), [
    { verified: true, containsCode: false }, { verified: true, containsCode: false },
    { verified: false, containsCode: false }, { verified: false, containsCode: false },
  ]);
});
