import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshClubAuthority } from "./club-authority.mjs";
import { RequestBudget } from "./runtime.mjs";

const groupId = "grp_00000000-0000-0000-0000-000000000001";
const userId = "usr_00000000-0000-0000-0000-000000000001";
function setup(granted = true) {
  const sends = [], reads = [];
  const args = {
    assignment: { state: "active", integrationId: "integration", epochStartedAt: 100, fencingToken: 7, vrchatGroupId: groupId },
    expectedUserId: userId, clock: () => 1000,
    accountBudget: new RequestBudget(10), integrationBudget: new RequestBudget(10),
    control: { async send(operation, body) { sends.push({ operation, body }); return operation === "club_authority" ? { recorded: true } : { granted }; } },
    provider: { async request(path) {
      reads.push(path);
      return path === "/auth/user" ? { id: userId } : {
        id: groupId, ownerId: userId, name: "Private club name", roles: [],
        myMember: { groupId, userId, permissions: ["group-audit-view"], membershipStatus: "member", roleIds: [] },
      };
    } },
  };
  return { args, sends, reads };
}
test("authority refresh reserves requests and transmits only scoped permission evidence", async () => {
  const { args, sends, reads } = setup();
  assert.equal((await refreshClubAuthority(args)).refreshed, true);
  assert.equal(reads.length, 2);
  assert.equal(args.accountBudget.remaining(1000), 8);
  assert.equal(sends[0].operation, "budget");
  assert.equal(sends[1].operation, "club_authority");
  assert.equal(sends[1].body.fencingToken, 7);
  assert.equal(sends[1].body.epochStartedAt, 100);
  assert.deepEqual(sends[1].body.authority, { groupId, userId, ownerUserId: userId, membershipStatus: "member", permissions: ["group-audit-view"], observedAt: 1000 });
});
test("denied shared or local budgets and inactive assignments perform no provider request", async () => {
  for (const mode of ["shared", "local", "inactive"]) {
    const { args, reads, sends } = setup(mode !== "shared");
    if (mode === "local") args.accountBudget.tryConsume(10, 1000);
    if (mode === "inactive") args.assignment.state = "disconnecting";
    assert.deepEqual(await refreshClubAuthority(args), { refreshed: false });
    assert.equal(reads.length, 0);
    assert.equal(sends.some(item => item.operation === "club_authority"), false);
  }
});

test("rejected snapshot recording cannot be reported as refreshed authority", async () => {
  const { args } = setup();
  args.control.send = async operation => operation === "budget" ? { granted: true } : { recorded: false };
  assert.deepEqual(await refreshClubAuthority(args), { refreshed: false });
});
