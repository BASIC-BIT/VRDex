import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reviewDecisionMessage, reviewPlacementImage } from "../../apps/web/src/app/account/media-review/media-review-view";

describe("media review view model", () => {
  it("shows a visible conflict for stale review receipts", () => {
    assert.deepEqual(reviewDecisionMessage({
      operationId: "op-1",
      operationState: "refused",
      resourceId: "submission-1",
      code: "review_changed",
    }), { message: "Review changed. Inspect the current images before deciding again.", conflict: true });
  });

  it("reports committed decisions without exposing private reasons", () => {
    assert.deepEqual(reviewDecisionMessage({
      operationId: "op-1",
      operationState: "committed",
      resourceId: "submission-1",
    }, "approve"), { message: "Approved.", conflict: false });
  });

  it("prefers the managed current placement and falls back to the legacy avatar", () => {
    assert.equal(reviewPlacementImage({
      profileId: "profile-1",
      profileSlug: "fixture profile",
      profileIsPublic: true,
      currentPlacement: { assetId: "asset-1" },
      currentAvatarImageUrl: "https://legacy.example/avatar.png",
      currentAutomaticImageUrl: "https://automatic.example/avatar.png",
    }), "/api/v0/profiles/fixture%20profile/assets/asset-1/file");
    assert.equal(reviewPlacementImage({
      profileId: "profile-1",
      profileSlug: "fixture",
      profileIsPublic: true,
      currentPlacement: null,
      currentAvatarImageUrl: "https://legacy.example/avatar.png",
      currentAutomaticImageUrl: "https://automatic.example/avatar.png",
    }), "https://legacy.example/avatar.png");
    assert.equal(reviewPlacementImage({
      profileId: "profile-1",
      profileSlug: "fixture",
      profileIsPublic: false,
      submissionId: "submission-1",
      reviewVersion: "revision-1",
      currentPlacement: { assetId: "asset-1" },
      currentAvatarImageUrl: null,
      currentAutomaticImageUrl: null,
    }), "/api/account/media-review/submissions/submission-1/file?image=current&assetId=asset-1&reviewVersion=revision-1");
    assert.equal(reviewPlacementImage({
      profileId: "profile-1",
      profileSlug: "fixture",
      profileIsPublic: true,
      currentPlacement: null,
      currentAvatarImageUrl: null,
      currentAutomaticImageUrl: "https://automatic.example/avatar.png",
    }), "https://automatic.example/avatar.png");
  });
});
