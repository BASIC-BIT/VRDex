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
