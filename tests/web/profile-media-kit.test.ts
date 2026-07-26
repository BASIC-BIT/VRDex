import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasRenderableProfileMediaKit } from "../../apps/web/src/lib/profile-media-kit";

describe("profile media-kit visibility", () => {
  it("does not render an empty section while the gallery feature is disabled", () => {
    assert.equal(hasRenderableProfileMediaKit({
      additionalLogoCount: 0,
      galleryAssetCount: 0,
      galleryEnabled: false,
      hasPrimaryLogo: false,
      logoCount: 0,
    }), false);
  });

  it("uses the content available to the enabled and disabled render branches", () => {
    assert.equal(hasRenderableProfileMediaKit({
      additionalLogoCount: 0,
      galleryAssetCount: 1,
      galleryEnabled: true,
      hasPrimaryLogo: false,
      logoCount: 0,
    }), true);
    assert.equal(hasRenderableProfileMediaKit({
      additionalLogoCount: 1,
      galleryAssetCount: 0,
      galleryEnabled: false,
      hasPrimaryLogo: false,
      logoCount: 1,
    }), true);
  });
});
