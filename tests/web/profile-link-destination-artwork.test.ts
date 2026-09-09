import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import sharp from "sharp";

import { sanitizeProfileLinkDestinationArtwork } from "../../apps/web/src/lib/server/profile-link-destination-artwork";
import { fetchProfileAssetSourceUrl } from "../../apps/web/src/lib/server/profile-asset-source-import";
import { allowedDestinationArtworkUrl } from "../../workers/group-telemetry/profile-link-destination.mjs";

test("observed portrait redirect passes the source policy and sanitizes to a static thumbnail", async () => {
  const source = "https://api.vrchat.cloud/api/1/image/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4/1/512";
  const target = "https://files.vrchat.cloud/thumbnails/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4.bc26edd42f6bbb785387d1d1ecb520f0e7fbc1670a411bcc76ab0c04736ff3a5.1.thumbnail-512.png?Expires=1790208000&Key-Pair-Id=EXAMPLE&Signature=example_";
  const body = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#123456" } }).png().toBuffer();
  const checked: string[] = [];
  const imported = await fetchProfileAssetSourceUrl(source, {
    assertSourceUrl(url) {
      assert.equal(allowedDestinationArtworkUrl(url.href, "vrchat_user"), url.href);
      checked.push(url.href);
    },
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    requestPinnedSource: async (url) => {
      const redirect = url.href === source;
      const response = Readable.from(redirect ? [] : [body]) as IncomingMessage;
      response.statusCode = redirect ? 302 : 200;
      response.headers = redirect ? { location: target } : { "content-type": "image/png" };
      return response;
    },
  });
  assert.deepEqual(checked, [source, target]);
  const metadata = await sharp(await sanitizeProfileLinkDestinationArtwork(imported.body, imported.mimeType)).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
});

test("destination artwork becomes a small static raster without source metadata", async () => {
  const source = await sharp({ create: { width: 640, height: 320, channels: 4, background: "#123456" } })
    .withMetadata({ exif: { IFD0: { Artist: "Provider metadata" } } }).png().toBuffer();
  const result = await sanitizeProfileLinkDestinationArtwork(source, "image/png");
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.pages ?? 1, 1);
  assert.ok(result.byteLength < 128 * 1024);
});

test("destination artwork rejects oversized decode and source byte budgets", async () => {
  const image = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(sanitizeProfileLinkDestinationArtwork(image, "image/png"), /pixel limit/i);
  await assert.rejects(sanitizeProfileLinkDestinationArtwork(new Uint8Array(12 * 1024 * 1024 + 1), "image/png"), /too large/);
});

test("destination artwork rejects active SVG, malformed content and unsupported encoding", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script></svg>');
  await assert.rejects(sanitizeProfileLinkDestinationArtwork(svg, "image/svg+xml"), /raster/);
  await assert.rejects(sanitizeProfileLinkDestinationArtwork(svg, "image/png"), /encoding/);
  await assert.rejects(sanitizeProfileLinkDestinationArtwork(Buffer.from("not image data"), "image/png"));
});

test("destination artwork blocks untrusted redirects and private provider DNS before fetching", async () => {
  const source = "https://api.vrchat.cloud/new-portrait?size=256";
  for (const target of ["https://evil.example/image.png", "https://files.vrchat.cloud/image?signature=new-format"]) {
    const requested: string[] = [];
    await assert.rejects(fetchProfileAssetSourceUrl(source, {
      assertSourceUrl(url) {
        if (!allowedDestinationArtworkUrl(url.href, "vrchat_user")) throw new Error("Untrusted artwork host");
      },
      resolveHostname: async hostname => [{ address: hostname === "files.vrchat.cloud" ? "127.0.0.1" : "93.184.216.34" }],
      requestPinnedSource: async url => {
        requested.push(url.href);
        const response = Readable.from([]) as IncomingMessage;
        response.statusCode = 302;
        response.headers = { location: target };
        return response;
      },
    }));
    assert.deepEqual(requested, [source]);
  }
});

test("profile portrait derivative retains 512px detail and strips provider metadata", async () => {
  const source = await sharp({ create: { width: 1024, height: 768, channels: 3, background: "#123456" } }).withMetadata().png().toBuffer();
  const result = await sanitizeProfileLinkDestinationArtwork(source, "image/png", 512);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.format, "webp");
});
