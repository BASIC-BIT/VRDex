import assert from "node:assert/strict";
import { test } from "node:test";
import { isVerifiedVrchatLink } from "../../apps/web/src/lib/profile-link-verification";

const id = "usr_11111111-2222-3333-4444-555555555555";
const connections = [{ assetType: "vrchat_user", assetExternalId: id, verified: true }];

test("marks only the matching verified VRChat destination", () => {
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id}`, connections), true);
  assert.equal(isVerifiedVrchatLink(`https://www.vrchat.com/home/user/${id}`, connections), true);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id.toUpperCase()}/`, connections), true);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id.replace("11111111", "22222222")}`, connections), false);
});

test("does not trust a lookalike host, route, or unverified connection", () => {
  for (const url of [
    `https://example.com/home/user/${id}`,
    `https://vrchat.com.evil.test/home/user/${id}`,
    `http://vrchat.com/home/user/${id}`,
    `https://vrchat.com/home/group/${id}`,
    `https://vrchat.com/home/user/${id}?redirect=https://example.com`,
  ]) assert.equal(isVerifiedVrchatLink(url, connections), false);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id}`, [{ ...connections[0], verified: false }]), false);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id}`, []), false);
});

test("keeps group and user verification separate", () => {
  const groupId = id.replace("usr_", "grp_");
  const groups = [{ assetType: "vrchat_group", assetExternalId: groupId, verified: true }];
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/group/${groupId}`, groups), true);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${groupId}`, groups), false);
  assert.equal(isVerifiedVrchatLink(`https://vrchat.com/home/user/${id}`, groups), false);
});
