import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  profileAssetUploadChecksum,
  shouldCleanupFailedProfileAssetUpload,
  storedProfileAssetMatchesUpload,
} from "../../apps/web/src/lib/server/profile-asset-storage";

describe("profile asset storage", () => {
  it("matches idempotent uploads by byte size, content type, and checksum", () => {
    const body = new TextEncoder().encode("image bytes");
    const checksum = profileAssetUploadChecksum(body);
    const object = {
      ContentLength: body.byteLength,
      ContentType: "image/png",
      Metadata: { "vrdex-sha256": checksum },
    };

    assert.match(checksum, /^[0-9a-f]{64}$/);
    assert.equal(storedProfileAssetMatchesUpload(object, { body, contentType: "image/png" }), true);
    assert.equal(
      storedProfileAssetMatchesUpload(
        { ...object, ContentLength: body.byteLength + 1 },
        { body, contentType: "image/png" },
      ),
      false,
    );
    assert.equal(
      storedProfileAssetMatchesUpload(
        { ...object, ContentType: "image/jpeg" },
        { body, contentType: "image/png" },
      ),
      false,
    );
    assert.equal(
      storedProfileAssetMatchesUpload(
        { ...object, Metadata: { "vrdex-sha256": "0".repeat(64) } },
        { body, contentType: "image/png" },
      ),
      false,
    );
  });

  it("cleans only a definitively pending intent owned by the processing token", () => {
    assert.equal(shouldCleanupFailedProfileAssetUpload({ state: "pending" }), true);
    assert.equal(shouldCleanupFailedProfileAssetUpload({ state: "consumed" }), false);
    assert.equal(shouldCleanupFailedProfileAssetUpload({ state: "uploaded" }), false);
    assert.equal(shouldCleanupFailedProfileAssetUpload({ state: "expired" }), false);
    assert.equal(shouldCleanupFailedProfileAssetUpload(null), false);
  });
});
