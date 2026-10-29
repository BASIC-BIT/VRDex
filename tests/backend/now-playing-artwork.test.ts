import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";

test("authorized immutable derivative uses original bytes without changing them and rechecks privacy before cache", async () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import sharp from "sharp";
  import { writeFile } from "node:fs/promises";
  import { createNowPlayingArtworkService, NOW_PLAYING_BRAND_VERSION } from "./apps/web/src/lib/server/now-playing-artwork.ts";
  const original = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#546478" } }).png().toBuffer();
  const before = Buffer.from(original);
  let allowed = true, revision = "1", reads = 0;
  const service = createNowPlayingArtworkService({ authorize: async () => allowed ? { revision, storageKey: "approved", mimeType: "image/png", byteSize: original.length } : null, read: async () => { reads++; return { body: original }; } });
  const input = { profileId: "dj", assetId: "asset", revision: "1", brandVersion: NOW_PLAYING_BRAND_VERSION };
  const first = await service.get(input);
  assert.ok(first); assert.deepEqual(original, before);
  assert.equal((await sharp(first.body).metadata()).width, 512);
  assert.notDeepEqual(first.body, original);
  await writeFile(".superpowers/sdd/mobile-vrcdn-playback/task-10-evidence/artwork.png", first.body);
  assert.deepEqual(await service.get(input), first); assert.equal(reads, 1);
  allowed = false; assert.equal(await service.get(input), null);
  allowed = true; revision = "2"; assert.equal(await service.get(input), null);
  assert.equal(await service.get({ ...input, assetId: "https://evil.test/image" }), null);
  assert.equal(await service.get({ ...input, revision: "2", brandVersion: "unknown" }), null);
  `], { cwd: process.cwd(), stdio: "pipe" });
});

test("bounded artwork renderer rejects unsupported and oversized inputs before decoding", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import sharp from "sharp";
    import { createNowPlayingArtworkService, NOW_PLAYING_BRAND_VERSION } from "./apps/web/src/lib/server/now-playing-artwork.ts";
    const input = { profileId: "dj", assetId: "asset", revision: "1", brandVersion: NOW_PLAYING_BRAND_VERSION };
    let reads = 0;
    for (const asset of [{revision:"1",storageKey:"key",mimeType:"image/svg+xml",byteSize:12}, {revision:"1",storageKey:"key",mimeType:"image/png",byteSize:13*1024*1024}]) {
      const service = createNowPlayingArtworkService({authorize:async()=>asset,read:async()=>{reads++; throw Error("must not read");}});
      assert.equal(await service.get(input),null);
    }
    assert.equal(reads,0);
    const oversizedPixels = await sharp({create:{width:4097,height:4097,channels:3,background:"red"}}).png().toBuffer();
    const service = createNowPlayingArtworkService({authorize:async()=>({revision:"1",storageKey:"key",mimeType:"image/png",byteSize:oversizedPixels.length}),read:async()=>({body:oversizedPixels})});
    assert.equal(await service.get(input),null);
  `], { cwd: process.cwd(), stdio: "pipe" });
});

test("actual public artwork GET permits anonymous cold fetch and denies cached hidden, unselected and stale revisions", () => {
  execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/now-playing-artwork-route.mjs"], { cwd: process.cwd(), stdio: "pipe" });
});
