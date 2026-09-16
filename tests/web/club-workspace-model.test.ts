import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clubNavigation,
  invitationSignInHref,
} from "../../apps/web/src/app/account/communities/[slug]/club-workspace-model";
import { isProtectedRoute } from "../../apps/web/src/lib/protected-route-redirect";

test("staff navigation never grants owner-only settings or unheld actions", () => {
  assert.deepEqual(
    clubNavigation("afterhours", false, []).map((item) => item.label),
    ["Home"],
  );
  assert.deepEqual(
    clubNavigation("afterhours", false, ["manage_staff"]).map(
      (item) => item.label,
    ),
    ["Home", "Staff and roles"],
  );
  const ownerLinks = clubNavigation("afterhours", true, []);
  assert.ok(ownerLinks.some((item) => item.label === "Data visibility"));
  assert.ok(ownerLinks.some((item) => item.label === "Invitations"));
  assert.deepEqual(
    clubNavigation("afterhours", false, ["invite_group_members"]).map((item) => item.label),
    ["Home", "Members", "Invitations", "Scheduled actions"],
  );
  assert.deepEqual(
    clubNavigation("afterhours", false, ["manage_instances"]).map((item) => item.label),
    ["Home", "Instances", "Invitations", "Scheduled actions"],
  );
  assert.deepEqual(
    clubNavigation("afterhours", false, ["view_members"]).map(
      (item) => item.label,
    ),
    ["Home", "Members"],
  );
  assert.deepEqual(
    clubNavigation("afterhours", false, ["publish_posts"]).map(
      (item) => item.label,
    ),
    ["Home", "Posts", "Scheduled actions"],
  );
});

test("individual membership history readers can reach analytics without other categories", () => {
  assert.deepEqual(
    clubNavigation("afterhours", false, [], ["individual_membership_history"])
      .map((item) => item.label),
    ["Home", "Analytics"],
  );
});

test("only the token invitation route bypasses the account middleware gate", () => {
  assert.equal(
    isProtectedRoute("/account/communities/afterhours/invite/abc"),
    false,
  );
  assert.equal(
    isProtectedRoute("/account/communities/afterhours/invite/abc/extra"),
    true,
  );
  assert.equal(
    isProtectedRoute("/account/communities/afterhours/invite"),
    true,
  );
  for (const route of ["", "/staff", "/visibility", "/connection"])
    assert.equal(
      isProtectedRoute(`/account/communities/afterhours${route}`),
      true,
    );
});

test("invitation sign-in preserves the exact local route without accepting an external redirect", () => {
  const href = invitationSignInHref("afterhours", "a/b?c#d");
  const url = new URL(href, "https://vrdex.test");
  assert.equal(url.pathname, "/sign-in");
  assert.equal(
    url.searchParams.get("returnTo"),
    "/account/communities/afterhours/invite/a%2Fb%3Fc%23d",
  );
});
