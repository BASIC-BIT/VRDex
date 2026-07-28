import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  PROFILE_ASSET_MAX_STORED_DIMENSION,
  validateAndPrepareProfileAsset,
  validateAndNormalizeProfileAsset,
} from "../../apps/web/src/lib/server/profile-asset-validation";

describe("profile asset content validation", () => {
  it("rejects content that does not match the declared MIME type", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#663399",
      },
    }).png().toBuffer();

    await assert.rejects(
      validateAndNormalizeProfileAsset(new Uint8Array(png), "image/jpeg"),
      /do not match/,
    );
  });

  it("preserves the private source, strips download metadata, and bounds the WebP display", async () => {
    const source = await sharp({
      create: {
        width: 5_000,
        height: 2_500,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .withMetadata({ exif: { IFD0: { Artist: "Private creator metadata" } } })
      .jpeg()
      .toBuffer();

    const prepared = await validateAndPrepareProfileAsset(new Uint8Array(source), "image/jpeg");
    const downloadMetadata = await sharp(prepared.download.body).metadata();
    const displayMetadata = await sharp(prepared.display.body).metadata();

    assert.deepEqual(prepared.source.body, new Uint8Array(source));
    assert.equal(prepared.source.mimeType, "image/jpeg");
    assert.match(prepared.source.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(prepared.download.mimeType, "image/jpeg");
    assert.equal(prepared.download.width, 5_000);
    assert.equal(prepared.download.height, 2_500);
    assert.equal(downloadMetadata.exif, undefined);
    assert.equal(downloadMetadata.orientation, undefined);
    assert.match(prepared.download.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(prepared.display.mimeType, "image/webp");
    assert.equal(prepared.display.width, PROFILE_ASSET_MAX_STORED_DIMENSION);
    assert.equal(prepared.display.height, 2_048);
    assert.equal(displayMetadata.format, "webp");
    assert.equal(displayMetadata.exif, undefined);
    assert.notEqual(prepared.display.contentSha256, prepared.download.contentSha256);
  });

  it("keeps sanitized downloads in the uploaded raster format", async () => {
    const inputs = [
      {
        mimeType: "image/png",
        body: await sharp({
          create: { width: 48, height: 32, channels: 4, background: "#663399" },
        }).withMetadata({ exif: { IFD0: { Artist: "Private PNG metadata" } } }).png().toBuffer(),
      },
      {
        mimeType: "image/webp",
        body: await sharp({
          create: { width: 48, height: 32, channels: 4, background: "#663399" },
        }).withMetadata({ exif: { IFD0: { Artist: "Private WebP metadata" } } }).webp().toBuffer(),
      },
    ] as const;

    for (const input of inputs) {
      const prepared = await validateAndPrepareProfileAsset(
        new Uint8Array(input.body),
        input.mimeType,
      );
      const metadata = await sharp(prepared.download.body).metadata();
      assert.equal(prepared.download.mimeType, input.mimeType);
      assert.equal(metadata.format, input.mimeType.replace("image/", ""));
      assert.equal(metadata.exif, undefined);
      assert.equal(prepared.display.mimeType, "image/webp");
    }
  });

  it("keeps sanitized WebP downloads within the upload limit", async () => {
    const pixels = Buffer.allocUnsafe(2_048 * 2_048 * 3);
    randomFillSync(pixels);
    const source = await sharp(pixels, {
      raw: { width: 2_048, height: 2_048, channels: 3 },
    }).webp({ quality: 70 }).toBuffer();
    const prepared = await validateAndPrepareProfileAsset(new Uint8Array(source), "image/webp");

    assert.ok(source.byteLength <= 12 * 1024 * 1024);
    assert.ok(prepared.download.body.byteLength <= 12 * 1024 * 1024);
    assert.equal((await sharp(prepared.download.body).metadata()).format, "webp");
  });

  it("accepts a simple bounded SVG and rejects active or external SVG content", async () => {
    const safe = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h10v10H0z"/></svg>',
    );
    const normalized = await validateAndNormalizeProfileAsset(safe, "image/svg+xml");

    assert.equal(normalized.width, 1_200);
    assert.equal(normalized.height, 675);

    const scripted = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
    );
    const external = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><use href="https://example.invalid/mark.svg#x"/></svg>',
    );
    const externalCss = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="url(https://example.invalid/pixel.svg)"/></svg>',
    );
    const animatedExternal = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><feImage id="target"/><set href="#target" attributeName="href" to="https://example.invalid/pixel"/></svg>',
    );
    const animatedColor = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path><animateColor attributeName="fill" from="red" to="blue"/></path></svg>',
    );
    await assert.rejects(validateAndNormalizeProfileAsset(scripted, "image/svg+xml"), /cannot contain/);
    await assert.rejects(validateAndNormalizeProfileAsset(external, "image/svg+xml"), /cannot contain/);
    await assert.rejects(validateAndNormalizeProfileAsset(externalCss, "image/svg+xml"), /cannot contain/);
    await assert.rejects(validateAndNormalizeProfileAsset(animatedExternal, "image/svg+xml"), /cannot contain/);
    await assert.rejects(validateAndNormalizeProfileAsset(animatedColor, "image/svg+xml"), /cannot contain/);
  });

  it("accepts safe SVG comments before the root element", async () => {
    const safe = new TextEncoder().encode(
      `<?xml version="1.0" encoding="UTF-8"?>
      <!-- ${"Generator metadata ".repeat(20)} -->
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="68"><path d="M0 0h10v10H0z"/></svg>`,
    );
    const normalized = await validateAndNormalizeProfileAsset(safe, "image/svg+xml");

    assert.equal(normalized.mimeType, "image/svg+xml");
    assert.equal(normalized.width, 120);
    assert.equal(normalized.height, 68);

    const commentedLookalike = new TextEncoder().encode(
      '<!-- <svg width="120" height="68"> --><svg xmlns="http://www.w3.org/2000/svg" width="99999" height="99999"><path d="M0 0h10v10H0z"/></svg>',
    );
    await assert.rejects(
      validateAndNormalizeProfileAsset(commentedLookalike, "image/svg+xml"),
      /8192 pixels/,
    );
  });

  it("rejects ambiguous SVG dimensions and escaped CSS references", async () => {
    const scientificDimensions = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1e9" height="1e9"><path d="M0 0h10v10H0z"/></svg>',
    );
    const escapedCssReference = new TextEncoder().encode(
      String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path style="fill:u\72l(https://tracker.example/p.svg#x)" d="M0 0h10v10H0z"/></svg>`,
    );
    const escapedPresentationReference = new TextEncoder().encode(
      String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="u\72l(https://tracker.example/p.svg#x)" d="M0 0h10v10H0z"/></svg>`,
    );
    const encodedPresentationReferences = ["u&#92;72l", "u&#x5c;72l"].map((escapedUrl) =>
      new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="${escapedUrl}(https://tracker.example/p.svg#x)" d="M0 0h10v10H0z"/></svg>`,
      ),
    );

    await assert.rejects(
      validateAndNormalizeProfileAsset(scientificDimensions, "image/svg+xml"),
      /positive width and height/,
    );
    await assert.rejects(
      validateAndNormalizeProfileAsset(escapedCssReference, "image/svg+xml"),
      /cannot contain/,
    );
    await assert.rejects(
      validateAndNormalizeProfileAsset(escapedPresentationReference, "image/svg+xml"),
      /cannot contain/,
    );
    for (const encodedReference of encodedPresentationReferences) {
      await assert.rejects(
        validateAndNormalizeProfileAsset(encodedReference, "image/svg+xml"),
        /cannot contain/,
      );
    }
  });

  it("requires exactly four complete viewBox coordinates", async () => {
    for (const viewBox of ["0,0,120,68", "0 0\n120 68"]) {
      const valid = new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path d="M0 0h10v10H0z"/></svg>`,
      );
      const normalized = await validateAndNormalizeProfileAsset(valid, "image/svg+xml");
      assert.equal(normalized.width, 120);
      assert.equal(normalized.height, 68);
    }

    for (const viewBox of ["0 0 100 100 garbage", "0 0 100 100 200"]) {
      const malformed = new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path d="M0 0h10v10H0z"/></svg>`,
      );
      await assert.rejects(
        validateAndNormalizeProfileAsset(malformed, "image/svg+xml"),
        /valid viewBox/,
      );
    }

    const prefixedOnly = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" data-width="120" data-height="68" data-viewBox="0 0 120 68"><path d="M0 0h10v10H0z"/></svg>',
    );
    const nestedLookalike = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" data-note=" viewBox='0 0 120 68'"><path d="M0 0h10v10H0z"/></svg>`,
    );
    for (const lookalike of [prefixedOnly, nestedLookalike]) {
      await assert.rejects(
        validateAndNormalizeProfileAsset(lookalike, "image/svg+xml"),
        /valid viewBox/,
      );
    }
  });

  it("rejects namespace-prefixed active SVG content", async () => {
    const namespacedScript = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" width="20" height="20"><s:script>alert(1)</s:script></svg>',
    );
    const unicodeNamespacedScript = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:é="http://www.w3.org/2000/svg" width="20" height="20"><é:script>alert(1)</é:script></svg>',
    );
    for (const activeSvg of [namespacedScript, unicodeNamespacedScript]) {
      await assert.rejects(
        validateAndNormalizeProfileAsset(activeSvg, "image/svg+xml"),
        /cannot contain scripts/,
      );
    }
  });

  it("rejects malformed SVG descendant markup", async () => {
    const malformed = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g></svg>',
    );
    await assert.rejects(
      validateAndNormalizeProfileAsset(malformed, "image/svg+xml"),
      /one valid, still image/,
    );
  });
});
