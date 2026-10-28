import assert from "node:assert/strict";
import { test } from "node:test";
import { isVerifiedVrchatLink, mergeVerifiedVrchatLinks, formatVerificationDate } from "../../apps/web/src/lib/profile-link-verification";

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

const dated = {
  assetType: "vrchat_user", assetExternalId: id,
  url: `https://vrchat.com/home/user/${id}`, displayName: "Example DJ",
  verifiedAt: Date.UTC(2026, 9, 25), linkRole: "primary",
} as const;

test("a missing outbound row still yields one dated verified identity", () => {
  assert.deepEqual(mergeVerifiedVrchatLinks([], [dated, dated]), [{
    type: "vrchat_profile", url: dated.url, label: "Example DJ", labelMode: "custom",
    verifiedAt: dated.verifiedAt,
  }]);
  const group = { ...dated, assetType: "vrchat_group", assetExternalId: id.replace("usr_", "grp_"),
    url: `https://vrchat.com/home/group/${id.replace("usr_", "grp_")}`, displayName: undefined } as const;
  assert.deepEqual(mergeVerifiedVrchatLinks([], [group, dated]).map(link => link.label), [group.assetExternalId, "Example DJ"]);
  assert.deepEqual(mergeVerifiedVrchatLinks([], []), []);
});

test("custom labels and ordering survive an exact identity match", () => {
  const links = [
    { type: "website", url: "https://example.com", label: "Website" },
    { type: "vrchat_profile", url: `https://www.vrchat.com/home/user/${id.toUpperCase()}/`, label: "My account", labelMode: "custom" as const },
  ];
  assert.deepEqual(mergeVerifiedVrchatLinks(links, [dated]), [links[0], { ...links[1], verifiedAt: dated.verifiedAt }]);
  assert.deepEqual(mergeVerifiedVrchatLinks(links, []), links);
  assert.deepEqual(mergeVerifiedVrchatLinks(links.map(link => ({ ...link, verifiedAt: 1 })), []), links);
});

test("only exact typed destinations receive a dated mark", () => {
  for (const url of [
    `https://vrchat.com.evil.test/home/user/${id}`, `http://vrchat.com/home/user/${id}`,
    `https://vrchat.com/home/group/${id}`, `https://vrchat.com/home/user/${id}?q=1`,
    `https://vrchat.com/home/user/${id}#bio`, `https://vrchat.com/user/${id}`,
  ]) {
    assert.equal(mergeVerifiedVrchatLinks([{ type: "vrchat_profile", url, label: "Other" }], [dated])[0].verifiedAt, undefined);
  }
  assert.equal(mergeVerifiedVrchatLinks([{ type: "website", url: dated.url, label: "Website" }], [dated])[0].verifiedAt, undefined);
});

test("verification dates use UTC on either side of midnight", () => {
  assert.equal(formatVerificationDate(Date.parse("2026-10-25T23:59:59Z")), "25 Oct 2026");
  assert.equal(formatVerificationDate(Date.parse("2026-10-26T00:00:00Z")), "26 Oct 2026");
});
