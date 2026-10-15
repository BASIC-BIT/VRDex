import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("public details REST handler rejects query tokens and unavailable assets and validates its output", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";

    import { GET } from "./apps/web/src/app/api/v0/profiles/[slug]/assets/[assetId]/route.ts";
    let calls = 0;
    const asset = { assetId: "asset", imageUrl: "https://example.test/image.png", downloadUrl: "https://example.test/image.png", mimeType: "image/png", byteSize: 1024 };
    let result = { profileSlug: "sample", asset, referenceUrl: null, credit: "Shared by Karly", uploadedBy: null, history: [{ kind: "uploaded", at: 1, actor: null }] };
    const validResult = result;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      calls++;
      assert.equal(body.path, "profileAssets:getPublicAssetDetails");
      assert.deepEqual(body.args[0], { slug: "sample", assetId: "asset" });
      return new Response(JSON.stringify({ status: "success", value: result }), { headers: { "content-type": "application/json" } });
    };
    const context = { params: Promise.resolve({ slug: "sample", assetId: "asset" }) };
    const url = "https://app.example.test/api/v0/profiles/sample/assets/asset";
    assert.equal((await GET(new Request(url + "?access_token=secret"), context)).status, 400);
    assert.equal(calls, 0);
    assert.equal((await GET(new Request(url, { headers: { authorization: "Bearer malformed" } }), context)).status, 401);
    assert.equal(calls, 0);
    const response = await GET(new Request(url), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
    assert.match(response.headers.get("cache-control"), /no-store/);
    result = null;
    const refused = await GET(new Request(url), context);
    assert.equal(refused.status, 404);
    assert.doesNotMatch(JSON.stringify(await refused.json()), /Karly|uploadedBy/);
    result = { ...validResult, privateNotes: "secret" };
    const invalid = await GET(new Request(url), context);
    assert.equal(invalid.status, 503);
    assert.doesNotMatch(JSON.stringify(await invalid.json()), /privateNotes|secret|Karly/);
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", CONVEX_URL: "http://127.0.0.1:3230", VRDEX_RATE_LIMIT_STORE: "memory" }, stdio: "pipe" });
});
