import { VrchatProviderError } from "./vrchat-client.mjs";

// Source contract refreshed 2026-09-14: https://vrchat.community/reference/
// get-group, get-group-members, search-group-members, get-group-member,
// get-group-requests, get-group-invites, get-group-roles, get-group-bans,
// get-group-posts, get-group-audit-logs, respond-group-join-request,
// create-group-invite, delete-group-invite, add-group-member-role,
// remove-group-member-role, kick-group-member, ban-group-member,
// unban-group-member, add-group-post, update-group-post, delete-group-post,
// create-instance, close-instance, get-friend-status, invite-user,
// get-group-calendar-events, create-group-calendar-event,
// update-group-calendar-event, delete-group-calendar-event, upload-image.
// This is a provider transport boundary, NOT the human authorization boundary.
// Callers must claim an authorized operation before execute. Nothing here retries.
const MAX_BYTES = 2 * 1024 * 1024;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const enc = encodeURIComponent;
const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;
const CALENDAR_ITEMS = 200;
// Convex refuses a result over 500,000 JSON characters; escaping can inflate
// a 2000-character description, so count the serialized size too.
const CALENDAR_RESULT_CHARS = 490_000;
function fail(code = "invalid_input") { throw new VrchatProviderError(code, { category: code }); }
function matches(value, prefix) { return typeof value === "string" && new RegExp(`^${prefix}_${UUID}$`).test(value); }
function id(value, prefix) {
  if (!matches(value, prefix)) fail();
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
function providerInstant(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("schema_drift");
  return new Date(value).toISOString();
}
// The Convex payload rule: a non-empty window of at most 92 days.
function calendarWindow(value) {
  keys(value, ["kind", "from", "to"]);
  const from = instant(value.from), to = instant(value.to);
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0 || span > 92 * 86_400_000) fail();
  return { from, to };
}

/** Fetch poster artwork for upload. Throws on anything but a bounded https PNG. */
export async function fetchArtwork(url, { fetcher = fetch, timeoutMs = 15_000, maxBytes = ARTWORK_MAX_BYTES } = {}) {
  if (new URL(url).protocol !== "https:") fail("artwork");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { redirect: "follow", signal: controller.signal });
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const reader = response.body?.getReader();
    try {
      // Redirects are followed, so check where the bytes finally came from.
      if (!response.ok || !reader || new URL(response.url || url).protocol !== "https:" || contentType !== "image/png" || Number(response.headers.get("content-length")) > maxBytes) fail("artwork");
      const chunks = [];
      let length = 0;
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        length += chunk.value.length;
        if (length > maxBytes) fail("artwork");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { bytes, contentType };
    } finally { await reader?.cancel().catch(() => {}); }
  } finally { clearTimeout(timer); }
}
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
  constructor({ client, groupId, expectedUserId, clock = Date.now, fetchImage = fetchArtwork }) {
    if (!client || typeof client.request !== "function") fail();
    this.client = client;
    this.groupId = id(groupId, "grp");
    this.expectedUserId = id(expectedUserId, "usr");
    this.clock = clock;
    this.fetchImage = fetchImage;
    this.base = `/groups/${enc(this.groupId)}`;
    this.calendarBase = `/calendar/${enc(this.groupId)}`;
  }

  // ponytail: PNG only, no conversion in a dependency-free worker; add a PNG rendition route on the web app if posters are mostly JPEG or WebP
  async artwork(url) {
    try {
      if (new URL(url).protocol !== "https:") return undefined;
      const { bytes, contentType } = await this.fetchImage(url);
      return contentType === "image/png" && bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= ARTWORK_MAX_BYTES ? bytes : undefined;
    } catch { return undefined; }
  }

  calendarItem(row) {
    object(row);
    if (row.ownerId !== undefined && row.ownerId !== this.groupId) fail("provider_scope");
    if (row.deletedAt != null) return null;
    const description = row.description ?? "";
    if (!matches(row.id, "cal") || typeof row.title !== "string" || typeof description !== "string") fail("schema_drift");
    const startsAt = providerInstant(row.startsAt);
    const updatedAt = [row.updatedAt, row.createdAt].find((value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
    return { id: row.id, title: row.title, description: description.slice(0, 2000), startsAt, endsAt: providerInstant(row.endsAt), updatedAt: updatedAt ? providerInstant(updatedAt) : startsAt };
  }

  /** Group calendar items starting in [from, to), read month by month. */
  async listCalendar(window) {
    const { from, to } = calendarWindow(window);
    const start = Date.parse(from), end = Date.parse(to);
    const found = new Map();
    let size = 0;
    const first = new Date(start);
    for (let month = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1); month < end; month = Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 1)) {
      for (let offset = 0, hasNext = true; hasNext;) {
        const params = new URLSearchParams({ date: new Date(month).toISOString(), n: "100", offset: String(offset) });
        const raw = await this.request(`${this.calendarBase}?${params}`);
        const rows = Array.isArray(raw) ? raw : object(raw).results;
        if (!Array.isArray(rows) || rows.length > 100) fail("schema_drift");
        hasNext = Array.isArray(raw) ? rows.length === 100 : raw.hasNext;
        if (typeof hasNext !== "boolean" || (hasNext && rows.length === 0)) fail("schema_drift");
        for (const row of rows) {
          const item = this.calendarItem(row);
          if (!item || found.has(item.id) || Date.parse(item.startsAt) < start || Date.parse(item.startsAt) >= end) continue;
          size += JSON.stringify(item).length + 1;
          if (found.size === CALENDAR_ITEMS || size > CALENDAR_RESULT_CHARS) return { calendarEvents: [...found.values()], calendarEventsTruncated: true };
          found.set(item.id, item);
        }
        offset += rows.length;
      }
    }
    return { calendarEvents: [...found.values()], calendarEventsTruncated: false };
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
      let plan = this.plan(operation);
      // Before the authority read, so a slow image host cannot age its evidence.
      const artwork = plan.imageUrl === undefined ? undefined : await this.artwork(plan.imageUrl);
      const authority = await this.readAuthority();
      if (authority.membershipStatus !== "member") fail("membership");
      if (plan.permissions.some((permission) => !authority.permissions.includes("*") && !authority.permissions.includes(permission))) fail("provider_permissions");
      const changesProtectedMember = ["assign_role", "remove_role", "remove_member", "ban_member", "unban_member"].includes(operation.kind);
      if (changesProtectedMember && [this.expectedUserId, authority.ownerUserId].includes(operation.targetUserId)) fail("protected_target");
      const currentRoleIds = plan.roleIds.map((roleId) => {
        const role = authority.roles.find((candidate) => candidate.id.toLowerCase() === roleId.toLowerCase());
        if (!role) fail("role_scope");
        return role.id;
      });
      if (currentRoleIds.some((id, index) => id !== plan.roleIds[index])) {
        if (operation.kind === "assign_role" || operation.kind === "remove_role")
          plan = this.plan({ ...operation, roleId: currentRoleIds[0] });
        else
          plan = this.plan({ ...operation, roleIds: currentRoleIds });
      }
      if (operation.kind === "create_instance" && operation.access === "public" && authority.group.privacy !== "default") fail("group_visibility");
      if (operation.kind === "close_instance") await this.readDestination(operation);
      if (operation.kind === "edit_post" || operation.kind === "delete_post") {
        const page = await this.readPage("posts", { n: 20, offset: operation.postPageOffset });
        const post = page.items.find((item) => item.id === operation.postId);
        if (!post || post.updatedAt !== operation.expectedUpdatedAt) fail("post_changed");
      }
      let friendship, eligibilityObservedAt;
      if (operation.kind === "invite_to_instance") {
        const eligibility = await this.getInstanceInviteEligibility(operation);
        friendship = eligibility.friendship;
        eligibilityObservedAt = eligibility.observedAt;
        if (!eligibility.eligible) fail(eligibility.friendship === "not_friend" ? "friendship" : "destination_closed");
      }
      if (onPreflight) await onPreflight({ authority, friendship, eligibilityObservedAt });
      // A read has no side effect, so its failures stay definite.
      if (operation.kind === "list_calendar_events") return { status: "succeeded", result: await this.listCalendar(operation) };
      if (artwork) {
        const form = new FormData();
        form.set("file", new Blob([artwork], { type: "image/png" }), "artwork.png");
        form.set("tag", "gallery");
        try {
          plan.body.imageId = id(object(await this.request("/file/image", { method: "POST", form })).id, "file");
        } catch (error) {
          // A refused or malformed upload drops the artwork, not the event.
          // Authorization, budget and transport failures still stop the write.
          if (!(error instanceof VrchatProviderError) || !["provider_error", "schema_drift", "invalid_input"].includes(error.category)) throw error;
        }
      }
      submitted = true;
      const result = await this.request(plan.path, { method: plan.method, allowEmptyResponse: plan.allowEmptyResponse, ...(plan.body === undefined ? {} : { body: plan.body }) });
      plan.validate(result);
      return { status: "succeeded", result };
    } catch (error) { return outcome(error, submitted); }
  }

  plan(op) {
    object(op, "invalid_input");
    const targetKinds = ["approve_request", "reject_request", "invite_member", "cancel_member_invite", "remove_member", "ban_member", "unban_member", "assign_role", "remove_role"];
    let path, method, body, imageUrl, permissions = [], roleIds = [];
    const allowEmptyResponse = ["approve_request", "reject_request", "invite_member", "delete_calendar_event"].includes(op.kind);
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
      if (op.kind === "assign_role" || op.kind === "remove_role") validate = (result) => { const granted = ids(result, "grol"); if (granted.some((roleId) => roleId.toLowerCase() === op.roleId.toLowerCase()) !== (op.kind === "assign_role")) fail("schema_drift"); };
    } else if (["publish_post", "edit_post", "delete_post"].includes(op.kind)) {
      keys(op, ["kind", ...(op.kind !== "publish_post" ? ["postId", "expectedUpdatedAt", "postPageOffset"] : []), ...(op.kind !== "delete_post" ? ["title", "text", "visibility", "sendNotification", "imageId", "roleIds"] : [])]);
      if (op.kind !== "publish_post" && (typeof op.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(op.expectedUpdatedAt)) || !Number.isSafeInteger(op.postPageOffset) || op.postPageOffset < 0 || op.postPageOffset > 10_000_000)) fail("invalid_input");
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
        validate = (result) => { object(result); id(result.id, "not"); if (result.type !== "invite" || typeof result.receiverUserId !== "string" || result.receiverUserId.toLowerCase() !== op.targetUserId.toLowerCase() || typeof result.senderUserId !== "string" || result.senderUserId.toLowerCase() !== this.expectedUserId.toLowerCase()) fail("schema_drift"); };
      }
    } else if (op.kind === "create_calendar_event" || op.kind === "update_calendar_event") {
      const update = op.kind === "update_calendar_event";
      keys(op, ["kind", ...(update ? ["calendarEventId"] : []), "title", "description", "startsAt", "endsAt", "imageUrl", "accessType"]);
      path = update ? `${this.calendarBase}/${enc(id(op.calendarEventId, "cal"))}/event` : `${this.calendarBase}/event`;
      method = update ? "PUT" : "POST";
      // No member notification from any calendar write.
      body = { title: text(op.title, 64), description: text(op.description, 2000), startsAt: instant(op.startsAt), endsAt: instant(op.endsAt), accessType: choice(op.accessType, ["group"]), category: "other", sendCreationNotification: false };
      if (Date.parse(body.endsAt) <= Date.parse(body.startsAt)) fail();
      if (op.imageUrl !== undefined) imageUrl = text(op.imageUrl, 2048);
      permissions = ["group-calendar-manage"];
      validate = (result) => { object(result); if (!matches(result.id, "cal") || (update && result.id.toLowerCase() !== op.calendarEventId.toLowerCase()) || (result.ownerId !== undefined && result.ownerId !== this.groupId)) fail("schema_drift"); };
    } else if (op.kind === "delete_calendar_event") {
      keys(op, ["kind", "calendarEventId"]);
      path = `${this.calendarBase}/${enc(id(op.calendarEventId, "cal"))}`; method = "DELETE";
      permissions = ["group-calendar-manage"];
      validate = (result) => { if (result !== null) object(result); };
    } else if (op.kind === "list_calendar_events") {
      calendarWindow(op);
    } else fail("unsupported_operation");
    return { path, method, body, imageUrl, permissions, roleIds, validate, allowEmptyResponse };
  }
}
