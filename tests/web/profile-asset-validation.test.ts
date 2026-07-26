import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import {
  PROFILE_ASSET_MAX_STORED_DIMENSION,
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

  it("re-encodes raster uploads, strips metadata, and bounds stored dimensions", async () => {
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

    const normalized = await validateAndNormalizeProfileAsset(new Uint8Array(source), "image/jpeg");
    const metadata = await sharp(normalized.body).metadata();

    assert.equal(normalized.mimeType, "image/jpeg");
    assert.equal(normalized.width, PROFILE_ASSET_MAX_STORED_DIMENSION);
    assert.equal(normalized.height, 2_048);
    assert.equal(metadata.exif, undefined);
    assert.match(normalized.contentSha256, /^[a-f0-9]{64}$/);
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
    await assert.rejects(
      validateAndNormalizeProfileAsset(namespacedScript, "image/svg+xml"),
      /cannot contain scripts/,
    );
  });
});
