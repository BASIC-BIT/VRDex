import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import sharp from "sharp";

import {
  generateProfileAssetAccessibilityDescription,
  normalizeGeneratedAccessibilityDescription,
  parseAccessibilityImageDataUrl,
  ProfileAssetAccessibilityProviderError,
} from "../../apps/web/src/lib/server/profile-asset-accessibility";

const originalEnvironment = {
  apiKey: process.env.OPENAI_API_KEY,
  enabled: process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED,
  model: process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL,
};

afterEach(() => {
  if (originalEnvironment.apiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalEnvironment.apiKey;
  if (originalEnvironment.enabled === undefined) {
    delete process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED;
  } else {
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED = originalEnvironment.enabled;
  }
  if (originalEnvironment.model === undefined) {
    delete process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL;
  } else {
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL = originalEnvironment.model;
  }
});

async function accessibilityImageDataUrl(
  format: "jpeg" | "png" | "webp" = "jpeg",
  width = 64,
  height = 48,
) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#663399",
    },
  });
  const body = await image[format]().toBuffer();
  return `data:image/${format};base64,${body.toString("base64")}`;
}

describe("profile asset accessibility generation", () => {
  it("accepts bounded raster previews and rejects MIME mismatches and oversized dimensions", async () => {
    const valid = await parseAccessibilityImageDataUrl(await accessibilityImageDataUrl("png"));
    assert.equal(valid.mimeType, "image/png");
    assert.ok(valid.byteSize > 0);

    const jpegBody = (await accessibilityImageDataUrl("jpeg")).split(",")[1]!;
    await assert.rejects(
      parseAccessibilityImageDataUrl(`data:image/png;base64,${jpegBody}`),
      (error: unknown) =>
        error instanceof ProfileAssetAccessibilityProviderError &&
        error.code === "invalid_image",
    );
    await assert.rejects(
      parseAccessibilityImageDataUrl(await accessibilityImageDataUrl("png", 1_025, 1)),
      /Image preview is invalid/,
    );
  });

  it("uses the gated low-detail provider boundary without persisting image content", async () => {
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED = "true";
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_MODEL = "synthetic-image-model";
    const image = await parseAccessibilityImageDataUrl(await accessibilityImageDataUrl());
    let providerRequest: Record<string, unknown> | undefined;

    const result = await generateProfileAssetAccessibilityDescription(image, {
      userId: "private-user-id",
      fetchImplementation: async (_input, init) => {
        providerRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          output: [{
            content: [{
              type: "output_text",
              text: "\"A performer stands in violet light. Extra sentence that must be removed.\"",
            }],
          }],
        });
      },
    });

    assert.equal(result.description, "A performer stands in violet light.");
    assert.equal(result.model, "synthetic-image-model");
    assert.equal(providerRequest?.model, "synthetic-image-model");
    assert.equal(providerRequest?.store, false);
    assert.deepEqual(providerRequest?.reasoning, { effort: "none" });
    assert.match(String(providerRequest?.safety_identifier), /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(providerRequest), /private-user-id/);
    const input = providerRequest?.input as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    assert.equal(input[0]?.content[1]?.detail, "low");
    assert.equal(input[0]?.content[1]?.image_url, image.dataUrl);
  });

  it("returns concise text and maps provider timeouts", async () => {
    assert.ok(normalizeGeneratedAccessibilityDescription("word ".repeat(80)).length <= 140);
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED = "true";
    const image = await parseAccessibilityImageDataUrl(await accessibilityImageDataUrl());

    await assert.rejects(
      generateProfileAssetAccessibilityDescription(image, {
        userId: "user",
        fetchImplementation: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      }),
      (error: unknown) =>
        error instanceof ProfileAssetAccessibilityProviderError &&
        error.code === "timeout",
    );
  });

  it("requires the server-side configuration gate", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED;
    const image = await parseAccessibilityImageDataUrl(await accessibilityImageDataUrl());

    await assert.rejects(
      generateProfileAssetAccessibilityDescription(image, { userId: "user" }),
      (error: unknown) =>
        error instanceof ProfileAssetAccessibilityProviderError &&
        error.code === "configuration",
    );
  });
});
