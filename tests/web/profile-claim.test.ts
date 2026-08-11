import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ownerProfileDestinationPath,
  parseClaimEntrySource,
  profileClaimPath,
  profileClaimSlugFromInput,
} from "../../apps/web/src/lib/profile-claim";
import { normalizeVrchatTargetId } from "../../convex/_vrchatIdentity";

describe("profile claim navigation", () => {
  it("builds a canonical encoded contextual route", () => {
    assert.equal(profileClaimPath("dj/basic", "search"), "/claim/dj%2Fbasic?source=search");
    assert.equal(profileClaimPath("afterglow", undefined), "/claim/afterglow");
  });

  it("keeps public profiles on public routes and private owners on an owner-aware destination", () => {
    assert.equal(
      ownerProfileDestinationPath({ hasPublicProfile: true, slug: "dj/basic" }, "/account"),
      "/dj%2Fbasic",
    );
    assert.equal(
      ownerProfileDestinationPath(
        { hasPublicProfile: false, slug: "private-club" },
        "/account/appearance",
      ),
      "/account/appearance",
    );
  });

  it("accepts only bounded entry sources", () => {
    assert.equal(parseClaimEntrySource("account"), "account");
    assert.equal(parseClaimEntrySource("search"), "search");
    assert.equal(parseClaimEntrySource("unknown"), "profile");
  });

  it("preserves legacy profile link parsing before redirecting", () => {
    assert.equal(profileClaimSlugFromInput("https://vrdex.net/p/dj-celine"), "dj-celine");
    assert.equal(profileClaimSlugFromInput("/afterglow-social?ref=account"), "afterglow-social");
    assert.equal(profileClaimSlugFromInput("dj-basic"), "dj-basic");
  });

  it("reads the slug out of a root profile link, with or without a scheme", () => {
    assert.equal(profileClaimSlugFromInput("https://vrdex.net/afterglow"), "afterglow");
    // Scheme-less is how a link usually arrives from an address bar. The host is
    // not a path segment, and the slug is the first one now, so skipping this
    // would claim the profile `vrdex.net`.
    assert.equal(profileClaimSlugFromInput("vrdex.net/afterglow"), "afterglow");
    assert.equal(profileClaimSlugFromInput("www.vrdex.net/dj-celine?ref=account"), "dj-celine");
    // A bare slug has no host to strip.
    assert.equal(profileClaimSlugFromInput("afterglow"), "afterglow");
  });

  it("strips a scheme-less host that new URL would mistake for a scheme", () => {
    // `new URL("localhost:3000/afterglow")` does not throw. It reads `localhost:`
    // as the scheme and returns the pathname `3000/afterglow`, so the catch-block
    // fallback never ran and the claim link pointed at the profile `3000`.
    assert.equal(profileClaimSlugFromInput("localhost:3000/afterglow"), "afterglow");
    assert.equal(profileClaimSlugFromInput("127.0.0.1:3210/dj-celine"), "dj-celine");
    assert.equal(profileClaimSlugFromInput("localhost:3000/p/dj-celine"), "dj-celine");
    // Still resolved when the scheme is a real one.
    assert.equal(profileClaimSlugFromInput("http://localhost:3000/afterglow"), "afterglow");
  });
});

describe("VRChat claim targets", () => {
  const userId = "usr_3f510886-35c4-4e2b-bdb0-2a43cc36023f";
  const groupId = "grp_3f510886-35c4-4e2b-bdb0-2a43cc36023f";

  it("normalizes canonical user and group URLs", () => {
    assert.equal(normalizeVrchatTargetId(`https://vrchat.com/home/user/${userId}`, "vrchat_user"), userId);
    assert.equal(normalizeVrchatTargetId(`https://vrchat.com/home/group/${groupId}`, "vrchat_group"), groupId);
  });

  it("rejects the wrong entity type and malformed ids", () => {
    assert.equal(normalizeVrchatTargetId(groupId, "vrchat_user"), null);
    assert.equal(normalizeVrchatTargetId("usr_not-a-uuid", "vrchat_user"), null);
  });
});
