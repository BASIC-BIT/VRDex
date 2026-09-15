import assert from "node:assert/strict";
import { test } from "node:test";
import { collectMembershipPage } from "./membership-collection.mjs";
import { RequestBudget } from "./runtime.mjs";
const groupId = "grp_00000000-0000-0000-0000-000000000001";
const userId = "usr_00000000-0000-0000-0000-000000000001";
function fixture({ fail = false, granted = true } = {}) {
  const sends = [], reads = [];
  const args = {
    assignment: { integrationId: "integration", fencingToken: 7, epochStartedAt: 1000, vrchatGroupId: groupId, enabledFeatures: ["analytics"] },
    authority: { groupId, userId, membershipStatus: "member", observedAt: 100000, permissions: ["group-audit-view"] },
    expectedUserId: userId, clock: () => 100000,
    accountBudget: new RequestBudget(10), integrationBudget: new RequestBudget(10),
    control: { async send(op, body) {
      sends.push({ op, body });
      if (op === "membership_scan_resume") return { scanId: "scan", startAt: 1000, endAt: 3000, nextOffset: 100, nextPage: 1, complete: false };
      return { granted };
    } },
    provider: { async request(path) {
      reads.push(path);
      if (fail) throw new Error("transport failed");
      return { results: [{ id: "audit1", groupId, created_at: new Date(3000).toISOString(), eventType: "group.member.join" }], hasNext: false };
    } },
  };
  return { args, sends, reads };
}
test("resumes persisted offset and advances raw count even when upper-boundary event is excluded", async () => {
  const { args, sends, reads } = fixture();
  assert.equal((await collectMembershipPage(args)).collected, true);
  assert.match(reads[0], /offset=100/);
  const page = sends.find(value => value.op === "membership_scan_page").body;
  assert.deepEqual(page.events, []);
  assert.equal(page.sourceCount, 1);
  assert.equal(page.pageNumber, 1);
  assert.equal(page.exhausted, true);
});
test("provider failure never marks a page exhausted and budget denial never reads", async () => {
  const failed = fixture({ fail: true });
  await assert.rejects(collectMembershipPage(failed.args));
  assert.equal(failed.sends.some(value => value.op === "membership_scan_page"), false);
  const denied = fixture({ granted: false });
  assert.equal((await collectMembershipPage(denied.args)).collected, false);
  assert.equal(denied.reads.length, 0);
});
test("disabled analytics or stale grants do not touch audit collection", async () => {
  for (const stale of [true, false]) {
    const { args, sends } = fixture();
    if (stale) args.authority.observedAt = 1;
    else args.assignment.enabledFeatures = [];
    assert.equal((await collectMembershipPage(args)).collected, false);
    assert.equal(sends.length, 0);
  }
});
