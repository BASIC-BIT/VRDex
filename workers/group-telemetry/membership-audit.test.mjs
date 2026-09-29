import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMembershipAuditPage } from "./membership-audit.mjs";
const target = "usr_00000000-0000-0000-0000-000000000001";
const scope = { groupId: "grp_club", startAt: 1000, endAt: 3000 };
const row = { id: "audit1", groupId: scope.groupId, created_at: new Date(2000).toISOString(), eventType: "group.member.remove", actorDisplayName: "Moderator", targetId: target, data: { private: "discard" } };
test("normalization preserves immutable type/target without attributing moderator name to member", () => {
  assert.deepEqual(normalizeMembershipAuditPage([row], scope), [{ auditId: "audit1", eventType: "group.member.remove", occurredAt: 2000, targetUserId: target }]);
  assert.equal(normalizeMembershipAuditPage([{ ...row, eventType: "future.event", targetId: "grol_role" }], scope)[0].eventType, "future.event");
});
test("half-open source windows filter boundary rows and reject malformed or foreign pages", () => {
  assert.deepEqual(normalizeMembershipAuditPage([{ ...row, created_at: new Date(3000).toISOString() }], scope), []);
  for (const changed of [{ groupId: "grp_other" }, { created_at: "invalid" }, { id: "" }])
    assert.throws(() => normalizeMembershipAuditPage([{ ...row, ...changed }], scope), { category: "schema_drift" });
  assert.throws(() => normalizeMembershipAuditPage(Array(101).fill(row), scope), { category: "schema_drift" });
});
