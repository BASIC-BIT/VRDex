import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasE2eSubmitBypass,
  isProtectedRoute,
  protectedRouteSignInPath,
} from "../../apps/web/src/lib/protected-route-redirect";

describe("protected route redirects", () => {
  it("guards account routes and the explicit authoring and developer routes", () => {
    for (const pathname of [
      "/account",
      "/account/privacy",
      "/account/privacy/details",
      "/claim/example-profile",
      "/submit",
      "/events/new",
      "/afterglow/events/create",
      "/afterglow/events/summer-social/edit",
      "/developers/tokens",
      "/developers/apps",
    ]) {
      assert.equal(isProtectedRoute(pathname), true, pathname);
    }
  });

  it("does not guard public routes or near-matches", () => {
    for (const pathname of [
      "/",
      "/accounting",
      "/claims/example-profile",
      "/events/summer-social",
      "/events/summer-social/edit",
      "/events/summer-social/edit/history",
      "/afterglow/events/summer-social",
      "/afterglow/events/summer-social/edit/history",
      "/developers/api",
      "/handoff/invite-token",
      "/submit/preview",
    ]) {
      assert.equal(isProtectedRoute(pathname), false, pathname);
    }
  });

  it("allows only the fixture account demos when requested", () => {
    assert.equal(isProtectedRoute("/account/appearance", { allowFixtureDemos: true }), false);
    assert.equal(isProtectedRoute("/account/privacy", { allowFixtureDemos: true }), false);
    assert.equal(isProtectedRoute("/account/media-kit", { allowFixtureDemos: true }), false);
    assert.equal(isProtectedRoute("/account", { allowFixtureDemos: true }), true);
    assert.equal(isProtectedRoute("/account/security", { allowFixtureDemos: true }), true);
  });

  it("preserves the requested pathname and search in the sign-in returnTo", () => {
    assert.equal(
      protectedRouteSignInPath("/account/privacy", "?profileId=profile-1&tab=links"),
      "/sign-in?returnTo=%2Faccount%2Fprivacy%3FprofileId%3Dprofile-1%26tab%3Dlinks",
    );
  });

  it("preserves a contextual claim source in the sign-in returnTo", () => {
    assert.equal(
      protectedRouteSignInPath("/claim/example-profile", "?source=search"),
      "/sign-in?returnTo=%2Fclaim%2Fexample-profile%3Fsource%3Dsearch",
    );
  });

  it("requires the exact submit helper flag and browser token match", () => {
    const valid = {
      pathname: "/submit",
      helpersEnabled: true,
      expectedToken: "playwright-token",
      requestToken: "playwright-token",
    };

    assert.equal(hasE2eSubmitBypass(valid), true);
    assert.equal(hasE2eSubmitBypass({ ...valid, pathname: "/account" }), false);
    assert.equal(hasE2eSubmitBypass({ ...valid, helpersEnabled: false }), false);
    assert.equal(hasE2eSubmitBypass({ ...valid, expectedToken: undefined }), false);
    assert.equal(hasE2eSubmitBypass({ ...valid, requestToken: undefined }), false);
    assert.equal(hasE2eSubmitBypass({ ...valid, requestToken: "wrong-token" }), false);
  });
});
