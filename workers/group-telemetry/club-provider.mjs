import { VrchatProviderError } from "./vrchat-client.mjs";

// Source contract refreshed 2026-09-14: https://vrchat.community/reference/
// get-group, get-group-members, search-group-members, get-group-member,
// get-group-requests, get-group-invites, get-group-roles, get-group-bans,
// get-group-posts, get-group-audit-logs, respond-group-join-request,
// create-group-invite, delete-group-invite, add-group-member-role,
// remove-group-member-role, kick-group-member, ban-group-member,
// unban-group-member, add-group-post, update-group-post, delete-group-post,
// create-instance, close-instance, get-friend-status, invite-user.
// This is a provider transport boundary, NOT the human authorization boundary.
// Callers must claim an authorized operation before execute. Nothing here retries.
const MAX_BYTES = 2 * 1024 * 1024;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const enc = encodeURIComponent;
function fail(code = "invalid_input") { throw new VrchatProviderError(code, { category: code }); }
function id(value, prefix) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_${UUID}$`).test(value)) fail();
  return value;
}
function object(value, code = "schema_drift") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}
function text(value, max, min = 1) {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail();
  return value;
}
function bool(value) { if (typeof value !== "boolean") fail(); return value; }
function choice(value, choices) { if (!choices.includes(value)) fail(); return value; }
function keys(value, allowed) {
  object(value, "invalid_input");
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
}
function ids(value, prefix) {
  if (!Array.isArray(value) || value.length > 100 || new Set(value).size !== value.length) fail();
  return value.map((item) => id(item, prefix));
}
function instant(value) { text(value, 40); if (!Number.isFinite(Date.parse(value))) fail(); return new Date(value).toISOString(); }
function pageOptions(options) {
  const n = options.n ?? 50, offset = options.offset ?? 0;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100 || !Number.isSafeInteger(offset) || offset < 0) fail();
  return { n, offset };
}
function location(groupId, worldId, instanceId) {
  id(worldId, "wrld"); text(instanceId, 500);
  if (/[\s:/?#\\%]/.test(instanceId)) fail();
  const groups = [...instanceId.matchAll(/~group\(([^)]+)\)/g)].map((match) => match[1]);
  if (groups.length !== 1 || groups[0] !== groupId) fail("destination_scope");
  return `${worldId}:${instanceId}`;
}
function outcome(error, submitted) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const definite = status >= 400 && status < 500 && status !== 408;
  return {
    status: submitted && !definite ? "indeterminate" : "rejected",
    code: error instanceof VrchatProviderError ? error.category : "provider_error",
    ...(status ? { httpStatus: status } : {}),
    ...(Number.isFinite(error?.retryAfterMs) ? { retryAfterMs: error.retryAfterMs } : {}),
  };
}

export class ClubProvider {
  constructor({ client, groupId, expectedUserId, clock = Date.now }) {
    if (!client || typeof client.request !== "function") fail();
    this.client = client;
    this.groupId = id(groupId, "grp");
    this.expectedUserId = id(expectedUserId, "usr");
    this.clock = clock;
    this.base = `/groups/${enc(this.groupId)}`;
  }

  request(path, options = {}) { return this.client.request(path, { ...options, maxResponseBytes: MAX_BYTES }); }

  scoped(record) {
    object(record);
    if (record.groupId !== undefined && record.groupId !== this.groupId) fail("provider_scope");
    return record;
  }

  async readAuthority() {
    const user = object(await this.request("/auth/user"));
    if (user.id !== this.expectedUserId) fail("authentication");
    const group = object(await this.request(`${this.base}?includeRoles=true`));
    if (group.id !== this.groupId) fail("provider_scope");
    const member = group.myMember;
    if (member != null) {
      this.scoped(member);
      if (member.userId !== user.id || !Array.isArray(member.permissions) || member.permissions.some((permission) => typeof permission !== "string" || permission.length > 100)) fail("schema_drift");
    }
    const roleIds = member?.roleIds ?? [];
    const roles = group.roles ?? [];
    if (!Array.isArray(roles) || roles.length > 100) fail("schema_drift");
    roles.forEach((role) => { this.scoped(role); id(role.id, "grol"); });
    return {
      groupId: this.groupId, userId: user.id, ownerUserId: id(group.ownerId, "usr"),
      membershipStatus: member?.membershipStatus ?? group.membershipStatus ?? "inactive",
      permissions: member ? [...new Set(member.permissions)] : [],
      observedAt: this.clock(), has2FA: member?.has2FA === true,
      roleIds: ids(roleIds, "grol"), roles,
      group: { name: group.name, privacy: group.privacy, joinState: group.joinState, memberCount: group.memberCount },
    };
  }

  async readPage(kind, options = {}) {
    keys(options, ["n", "offset", ...(kind === "search" ? ["search"] : []), ...(kind === "audit" ? ["startDate", "endDate"] : [])]);
    const { n, offset } = pageOptions(options);
    if (kind === "instances") {
      // This endpoint has no pagination. Bound the response and slice locally.
      const rows = await this.request(`${this.base}/instances`);
      if (!Array.isArray(rows) || rows.length > 1000) fail("schema_drift");
      rows.forEach((row) => {
        this.scoped(row);
        object(row.world);
        if (row.location !== location(this.groupId, row.world.id, row.instanceId)) fail("destination_scope");
      });
      return { items: rows.slice(offset, offset + n), nextOffset: offset + n < rows.length ? offset + n : null, observedAt: this.clock() };
    }
    const paths = { members: "members", search: "members/search", requests: "requests", invites: "invites", roles: "roles", bans: "bans", posts: "posts", audit: "auditLogs" };
    if (!Object.hasOwn(paths, kind)) fail();
    const params = new URLSearchParams({ n: String(n), offset: String(offset) });
    if (kind === "search") params.set("query", text(options.search?.trim(), 100, 3));
    if (kind === "audit") {
      for (const key of ["startDate", "endDate"]) if (options[key] !== undefined) params.set(key, instant(options[key]));
      if (options.startDate && options.endDate && Date.parse(options.startDate) > Date.parse(options.endDate)) fail();
    }
    // Roles has no provider pagination. Fetch once, bound, then slice locally.
    const raw = await this.request(`${this.base}/${paths[kind]}${kind === "roles" ? "" : `?${params}`}`);
    const rows = kind === "posts" ? object(raw).posts : kind === "audit" ? object(raw).results : raw;
    if (!Array.isArray(rows) || rows.length > (kind === "roles" ? 100 : n)) fail("schema_drift");
    rows.forEach((row) => this.scoped(row));
    const items = kind === "roles" ? rows.slice(offset, offset + n) : rows;
    const hasNext = kind === "roles" ? offset + n < rows.length : kind === "audit" ? raw.hasNext : kind === "posts" ? offset + items.length < raw.total : items.length === n;
    if (typeof hasNext !== "boolean" || (hasNext && items.length === 0)) fail("schema_drift");
    return { items, nextOffset: hasNext ? offset + items.length : null, observedAt: this.clock() };
  }

  async getMember(userId) {
    id(userId, "usr");
    const member = this.scoped(await this.request(`${this.base}/members/${enc(userId)}`));
    if (member.userId !== userId) fail("provider_scope");
    return member;
  }

  validateDestination(record, worldId, instanceId) {
    object(record);
    location(this.groupId, worldId, instanceId);
    if (record.worldId !== worldId || record.instanceId !== instanceId || record.ownerId !== this.groupId || record.type !== "group") fail("destination_scope");
    return record;
  }

  async readDestination({ worldId, instanceId }) {
    location(this.groupId, worldId, instanceId);
    return this.validateDestination(await this.request(`/instances/${enc(worldId)}:${enc(instanceId)}`), worldId, instanceId);
  }

  async getInstanceInviteEligibility({ targetUserId, worldId, instanceId }) {
    id(targetUserId, "usr");
    const destination = await this.readDestination({ worldId, instanceId });
    const status = object(await this.request(`/user/${enc(targetUserId)}/friendStatus`));
    if (typeof status.isFriend !== "boolean") fail("schema_drift");
    const open = destination.active === true && (destination.closedAt == null || (Number.isFinite(Date.parse(destination.closedAt)) && Date.parse(destination.closedAt) > this.clock()));
    // This checks an accessible, running group destination, not whether the recipient
    // can enter it. An invite cannot override age, membership, role or ban checks.
    return { friendship: status.isFriend ? "friend" : "not_friend", destinationOpen: open, eligible: status.isFriend && open, observedAt: this.clock() };
  }

  async getFriendship(targetUserId) {
    id(targetUserId, "usr");
    const status = object(await this.request(`/user/${enc(targetUserId)}/friendStatus`));
    if (typeof status.isFriend !== "boolean") fail("schema_drift");
    return status.isFriend ? "friend" : "not_friend";
  }

  async execute(operation, { onPreflight } = {}) {
    let submitted = false;
    try {
      const plan = this.plan(operation);
      const authority = await this.readAuthority();
      if (authority.membershipStatus !== "member") fail("membership");
      if (plan.permissions.some((permission) => !authority.permissions.includes("*") && !authority.permissions.includes(permission))) fail("provider_permissions");
      const changesProtectedMember = ["assign_role", "remove_role", "remove_member", "ban_member", "unban_member"].includes(operation.kind);
      if (changesProtectedMember && [this.expectedUserId, authority.ownerUserId].includes(operation.targetUserId)) fail("protected_target");
      if (plan.roleIds.some((roleId) => !authority.roles.some((role) => role.id === roleId))) fail("role_scope");
      if (operation.kind === "create_instance" && operation.access === "public" && authority.group.privacy !== "default") fail("group_visibility");
      if (operation.kind === "close_instance") await this.readDestination(operation);
      let friendship, eligibilityObservedAt;
      if (operation.kind === "invite_to_instance") {
        const eligibility = await this.getInstanceInviteEligibility(operation);
        friendship = eligibility.friendship;
        eligibilityObservedAt = eligibility.observedAt;
        if (!eligibility.eligible) fail(eligibility.friendship === "not_friend" ? "friendship" : "destination_closed");
      }
      if (onPreflight) await onPreflight({ authority, friendship, eligibilityObservedAt });
      submitted = true;
      const result = await this.request(plan.path, { method: plan.method, allowEmptyResponse: plan.allowEmptyResponse, ...(plan.body === undefined ? {} : { body: plan.body }) });
      plan.validate(result);
      return { status: "succeeded", result };
    } catch (error) { return outcome(error, submitted); }
  }

  plan(op) {
    object(op, "invalid_input");
    const targetKinds = ["approve_request", "reject_request", "invite_member", "cancel_member_invite", "remove_member", "ban_member", "unban_member", "assign_role", "remove_role"];
    let path, method, body, permissions = [], roleIds = [];
    const allowEmptyResponse = ["approve_request", "reject_request", "invite_member"].includes(op.kind);
    let validate = (result) => {
      if (result === null && allowEmptyResponse) return;
      object(result);
      if (result.error || !result.success || !Number.isInteger(result.success.status_code) || result.success.status_code < 200 || result.success.status_code >= 300) fail("schema_drift");
    };
    if (targetKinds.includes(op.kind)) {
      keys(op, ["kind", "targetUserId", ...(op.kind === "assign_role" || op.kind === "remove_role" ? ["roleId"] : [])]);
      id(op.targetUserId, "usr");
      const target = enc(op.targetUserId);
      if (["approve_request", "reject_request"].includes(op.kind)) { path = `${this.base}/requests/${target}`; method = "PUT"; body = { action: op.kind === "approve_request" ? "accept" : "reject" }; permissions = ["group-invites-manage"]; }
      if (op.kind === "invite_member") { path = `${this.base}/invites`; method = "POST"; body = { userId: op.targetUserId }; permissions = ["group-invites-manage"]; }
      if (op.kind === "cancel_member_invite") { path = `${this.base}/invites/${target}`; method = "DELETE"; permissions = ["group-invites-manage"]; }
      if (op.kind === "remove_member") { path = `${this.base}/members/${target}`; method = "DELETE"; permissions = ["group-members-manage", "group-members-remove"]; }
      if (op.kind === "ban_member" || op.kind === "unban_member") { path = `${this.base}/bans${op.kind === "unban_member" ? `/${target}` : ""}`; method = op.kind === "ban_member" ? "POST" : "DELETE"; body = op.kind === "ban_member" ? { userId: op.targetUserId } : undefined; permissions = ["group-members-manage", "group-bans-manage"]; }
      if (op.kind === "assign_role" || op.kind === "remove_role") { roleIds = [id(op.roleId, "grol")]; path = `${this.base}/members/${target}/roles/${enc(op.roleId)}`; method = op.kind === "assign_role" ? "PUT" : "DELETE"; permissions = ["group-members-manage", "group-roles-assign"]; }
      if (op.kind === "ban_member" || op.kind === "unban_member") validate = (result) => { this.scoped(result); if (result.groupId !== this.groupId || result.userId !== op.targetUserId) fail("schema_drift"); id(result.id, "gmem"); };
      if (op.kind === "assign_role" || op.kind === "remove_role") validate = (result) => { const granted = ids(result, "grol"); if (granted.includes(op.roleId) !== (op.kind === "assign_role")) fail("schema_drift"); };
    } else if (["publish_post", "edit_post", "delete_post"].includes(op.kind)) {
      keys(op, ["kind", ...(op.kind !== "publish_post" ? ["postId"] : []), ...(op.kind !== "delete_post" ? ["title", "text", "visibility", "sendNotification", "imageId", "roleIds"] : [])]);
      path = `${this.base}/posts${op.kind !== "publish_post" ? `/${enc(id(op.postId, "not"))}` : ""}`;
      method = op.kind === "publish_post" ? "POST" : op.kind === "edit_post" ? "PUT" : "DELETE";
      permissions = ["group-announcement-manage"];
      if (op.kind !== "delete_post") {
        // Local abuse bounds, not claims about undocumented provider limits.
        body = { title: text(op.title, 200), text: text(op.text, 10000), visibility: choice(op.visibility, ["public", "group"]), sendNotification: bool(op.sendNotification) };
        if (op.imageId !== undefined) body.imageId = id(op.imageId, "file");
        if (op.roleIds !== undefined) { roleIds = ids(op.roleIds, "grol"); body.roleIds = roleIds; if (roleIds.length && op.visibility !== "group") fail(); }
        validate = (result) => { this.scoped(result); id(result.id, "not"); if (result.groupId !== this.groupId || (op.postId && result.id !== op.postId) || typeof result.title !== "string" || typeof result.text !== "string") fail("schema_drift"); };
      }
    } else if (op.kind === "create_instance") {
      keys(op, ["kind", "worldId", "access", "region", "ageGated", "roleIds", "calendarEntryId", "queueEnabled"]);
      path = "/instances"; method = "POST";
      body = { worldId: id(op.worldId, "wrld"), type: "group", ownerId: this.groupId, groupAccessType: choice(op.access, ["members", "plus", "public"]), region: choice(op.region, ["us", "use", "eu", "jp"]) };
      permissions = [op.access === "members" ? "group-instance-open-create" : op.access === "plus" ? "group-instance-plus-create" : "group-instance-public-create"];
      if (op.ageGated !== undefined) { body.ageGate = bool(op.ageGated); if (op.ageGated) permissions.push("group-instance-age-gated-create"); }
      if (op.queueEnabled !== undefined) body.queueEnabled = bool(op.queueEnabled);
      if (op.roleIds !== undefined) { roleIds = ids(op.roleIds, "grol"); body.roleIds = roleIds; if (roleIds.length) { if (op.access !== "members") fail(); permissions.push("group-instance-restricted-create"); } }
      if (op.calendarEntryId !== undefined) { body.calendarEntryId = id(op.calendarEntryId, "cal"); permissions.push("group-instance-calendar-link"); }
      validate = (result) => this.validateDestination(result, op.worldId, result?.instanceId);
    } else if (op.kind === "close_instance" || op.kind === "invite_to_instance") {
      keys(op, ["kind", "worldId", "instanceId", ...(op.kind === "invite_to_instance" ? ["targetUserId", "messageSlot"] : [])]);
      const destination = location(this.groupId, op.worldId, op.instanceId);
      if (op.kind === "close_instance") {
        path = `/instances/${enc(op.worldId)}:${enc(op.instanceId)}?hardClose=false`; method = "DELETE"; permissions = ["group-instance-manage"];
        validate = (result) => this.validateDestination(result, op.worldId, op.instanceId);
      } else {
        path = `/invite/${enc(id(op.targetUserId, "usr"))}`; method = "POST"; body = { instanceId: destination };
        if (op.messageSlot !== undefined) { if (!Number.isInteger(op.messageSlot) || op.messageSlot < 0 || op.messageSlot > 11) fail(); body.messageSlot = op.messageSlot; }
        validate = (result) => { object(result); id(result.id, "not"); if (result.type !== "invite" || result.receiverUserId !== op.targetUserId || result.senderUserId !== this.expectedUserId) fail("schema_drift"); };
      }
    } else fail("unsupported_operation");
    return { path, method, body, permissions, roleIds, validate, allowEmptyResponse };
  }
}
