import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ApiEventUpdateRequestSchema,
  ApiProfileAssetUploadIntentCreateRequestSchema,
  parseDeveloperCredentialListQueryParams,
} from "../src";

describe("API write and credential-list boundaries", () => {
  it("preserves event patch omission, explicit clears, and paired schedule replacement", () => {
    assert.deepEqual(ApiEventUpdateRequestSchema.parse({ summary: "Updated" }), {
      summary: "Updated",
    });
    assert.deepEqual(ApiEventUpdateRequestSchema.parse({
      summary: null,
      worldSlug: null,
      participantLinks: [],
      slotLinks: [],
    }), {
      summary: null,
      worldSlug: null,
      participantLinks: [],
      slotLinks: [],
    });

    // Reject either half: accepting slots alone could unintentionally detach
    // the participant roster while replacing a schedule.
    for (const patch of [{ participantLinks: [] }, { slotLinks: [] }]) {
      const result = ApiEventUpdateRequestSchema.safeParse(patch);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.deepEqual(result.error.issues.map((issue) => issue.path), [
          "participantLinks" in patch ? ["slotLinks"] : ["participantLinks"],
        ]);
      }
    }
  });

  it("keeps remote import size optional but enforces the direct-upload size boundary", () => {
    const remote = { sourceUrl: "https://example.test/image.png", mimeType: "image/png" };
    assert.deepEqual(ApiProfileAssetUploadIntentCreateRequestSchema.parse(remote), remote);
    const direct = { originalFileName: "image.png", mimeType: "image/png", byteSize: 12 * 1024 * 1024 };
    assert.deepEqual(ApiProfileAssetUploadIntentCreateRequestSchema.parse(direct), direct);

    for (const byteSize of [0, -1, 1.5, 12 * 1024 * 1024 + 1]) {
      const result = ApiProfileAssetUploadIntentCreateRequestSchema.safeParse({ ...direct, byteSize });
      assert.equal(result.success, false, `invalid direct-upload byteSize: ${byteSize}`);
      if (!result.success) {
        assert.ok(result.error.issues.some((issue) => issue.path[0] === "byteSize"));
      }
    }
    assert.equal(ApiProfileAssetUploadIntentCreateRequestSchema.safeParse({
      mimeType: "image/png", byteSize: 1024,
    }).success, false, "a size cannot substitute for an upload or import source");
  });

  it("does not include revoked credentials by default or from truthy-looking query values", () => {
    assert.deepEqual(parseDeveloperCredentialListQueryParams(new URLSearchParams()), {
      includeRevoked: false,
      limit: 50,
    });
    for (const value of ["1", "yes", "TRUE"]) {
      assert.equal(parseDeveloperCredentialListQueryParams(
        new URLSearchParams({ includeRevoked: value }),
      ).includeRevoked, false);
    }
  });
});
