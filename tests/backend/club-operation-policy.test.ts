import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessClubOperation, type OperationAuthority } from "../../convex/_clubOperationPolicy";

const now = 1_000_000;
function authority(overrides: Partial<OperationAuthority> = {}): OperationAuthority {
  return {
    actorKind: "staff", permissions: ["manage_bans"], enabledFeatures: ["membership_management"],
    integrationActive: true, expectedGroupId: "grp_club", expectedBotUserId: "usr_bot",
    provider: { groupId: "grp_club", userId: "usr_bot", membershipStatus: "member", observedAt: now,
      permissions: ["group-bans-manage", "group-members-manage"], ownerUserId: "usr_owner" },
    permittedProviderRoleIds: [], now, ...overrides,
  };
}
describe("club provider operation authority", () => {
  it("requires human permission, enabled feature and current bot grants independently", () => {
    const action = { kind: "ban_member" as const, targetUserId: "usr_target" };
    assert.equal(assessClubOperation(authority(), action).allowed, true);
    assert.equal(assessClubOperation(authority({ permissions: [] }), action).reason, "staff_permission");
    assert.equal(assessClubOperation(authority({ enabledFeatures: [] }), action).reason, "feature_disabled");
    const base = authority();
    const decision = assessClubOperation(authority({ provider: { ...base.provider!, permissions: ["group-bans-manage"] } }), action);
    assert.equal(decision.reason, "provider_permissions");
    assert.deepEqual(decision.missingPermissions, ["group-members-manage"]);
  });
  it("does not let ownership bypass disabled features or provider access", () => {
    const action = { kind: "publish_post" as const };
    const owner = authority({ actorKind: "owner", permissions: [], enabledFeatures: ["posts"] });
    assert.equal(assessClubOperation(owner, action).reason, "provider_permissions");
    assert.equal(assessClubOperation({ ...owner, enabledFeatures: [] }, action).reason, "feature_disabled");
  });
  it("rejects stale, future, foreign and absent own-member observations", () => {
    const base = authority(); const action = { kind: "ban_member" as const, targetUserId: "usr_target" };
    for (const provider of [null, { ...base.provider!, observedAt: now - 60_001 },
      { ...base.provider!, observedAt: now + 1 }, { ...base.provider!, groupId: "grp_other" },
      { ...base.provider!, userId: "usr_other" }, { ...base.provider!, membershipStatus: "requested" }]) {
      assert.equal(assessClubOperation({ ...base, provider }, action).allowed, false);
    }
  });
  it("bounds provider role assignment separately from VRDex roles and protects the bot", () => {
    const base = authority({ permissions: ["assign_vrchat_roles"], permittedProviderRoleIds: ["grol_allowed"] });
    base.provider!.permissions = ["group-roles-assign", "group-members-manage"];
    assert.equal(assessClubOperation(base, { kind: "assign_role", targetUserId: "usr_target", roleId: "grol_allowed" }).allowed, true);
    assert.equal(assessClubOperation(base, { kind: "assign_role", targetUserId: "usr_target", roleId: "grol_other" }).reason, "role_not_assignable");
    assert.equal(assessClubOperation(base, { kind: "remove_role", targetUserId: "usr_bot", roleId: "grol_allowed" }).reason, "protected_target");
    assert.equal(assessClubOperation(base, { kind: "remove_role", targetUserId: "USR_BOT", roleId: "grol_allowed" }).reason, "protected_target");
    assert.equal(assessClubOperation({ ...base, actorKind: "owner" }, { kind: "assign_role", targetUserId: "usr_bot", roleId: "grol_allowed" }).reason, "protected_target");
    assert.equal(assessClubOperation({ ...base, actorKind: "owner" }, { kind: "assign_role", targetUserId: "USR_OWNER", roleId: "grol_allowed" }).reason, "protected_target");
  });
  it("checks creation options independently and disallows public instances for private groups", () => {
    const base = authority({ permissions: ["manage_instances"], enabledFeatures: ["instances"] });
    base.provider!.permissions = ["group-instance-plus-create"];
    assert.equal(assessClubOperation(base, { kind: "create_instance", access: "plus" }).allowed, true);
    assert.deepEqual(assessClubOperation(base, { kind: "create_instance", access: "plus", ageGated: true }).missingPermissions, ["group-instance-age-gated-create"]);
    assert.equal(assessClubOperation(base, { kind: "create_instance", access: "public", groupVisibility: "private" }).reason, "invalid_instance_options");
  });
  it("treats bot friendship as instance-invite eligibility, never as staff authority", () => {
    const base = authority({ permissions: ["manage_instances"], enabledFeatures: ["instances"] });
    base.provider!.permissions = [];
    assert.equal(assessClubOperation(base, { kind: "invite_to_instance", targetUserId: "usr_target", friendship: "unknown" }).reason, "recipient_eligibility");
    assert.equal(assessClubOperation({ ...base, actorKind: "none" }, { kind: "invite_to_instance", targetUserId: "usr_target", friendship: "friend" }).reason, "staff_permission");
    assert.equal(assessClubOperation(base, { kind: "invite_to_instance", targetUserId: "usr_owner", friendship: "friend" }).allowed, true);
  });
});
