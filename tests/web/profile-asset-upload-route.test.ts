import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { profileAssetMimeTypeForFile } from "../../apps/web/src/lib/server/profile-asset-validation";

describe("profile asset upload route MIME fallback", () => {
  it("infers every supported file type when multipart MIME is empty", () => {
    assert.equal(profileAssetMimeTypeForFile("", "image.png"), "image/png");
    assert.equal(profileAssetMimeTypeForFile("", "image.jpg"), "image/jpeg");
    assert.equal(profileAssetMimeTypeForFile("", "image.webp"), "image/webp");
    assert.equal(profileAssetMimeTypeForFile("", "image.svg"), "image/svg+xml");
  });

  it("preserves declared MIME and generic fallback behavior", () => {
    assert.equal(profileAssetMimeTypeForFile("image/webp", "image.png"), "image/webp");
    assert.equal(
      profileAssetMimeTypeForFile("application/octet-stream", "image.svg"),
      "image/svg+xml",
    );
  });
});
