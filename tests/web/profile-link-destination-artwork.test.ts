import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

import { sanitizeProfileLinkDestinationArtwork } from "../../apps/web/src/lib/server/profile-link-destination-artwork";

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
