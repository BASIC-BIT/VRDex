import test from "node:test";
import assert from "node:assert/strict";
import { ClubProvider } from "./club-provider.mjs";
import { VrchatClient, VrchatProviderError } from "./vrchat-client.mjs";

const uid = (n) => `usr_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const groupId = "grp_00000000-0000-0000-0000-000000000001";
const otherGroup = "grp_00000000-0000-0000-0000-000000000002";
const roleId = "grol_00000000-0000-0000-0000-000000000001";
const worldId = "wrld_00000000-0000-0000-0000-000000000001";
const postId = "not_00000000-0000-0000-0000-000000000001";
const instanceId = `123~group(${groupId})~groupAccessType(members)~region(us)`;
const success = { success: { status_code: 200, message: "okay" } };
const member = { id: "gmem_00000000-0000-0000-0000-000000000001", groupId, userId: uid(3) };
const destination = { worldId, instanceId, ownerId: groupId, type: "group", active: true, closedAt: null };
test("friendship check reads one explicit user and validates boolean evidence", async () => {
  const { adapter, calls } = fixture({ handler: async () => ({ isFriend: false, incomingRequest: true }) });
  assert.equal(await adapter.getFriendship(uid(3)), "not_friend");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/user/${uid(3)}/friendStatus`);
  const bad = fixture({ handler: async () => ({ isFriend: "true" }) });
  await assert.rejects(bad.adapter.getFriendship(uid(3)), /schema_drift/);
});
test("instance destination pages use unpaginated endpoint and reject foreign locations", async () => {
  const row = {world:{id:worldId,name:"World"},instanceId,location:`${worldId}:${instanceId}`};
  const {adapter,calls} = fixture({response:[row,row]});
  assert.equal((await adapter.readPage("instances", {n:1,offset:0})).nextOffset,1);
  assert.equal((await adapter.readPage("instances", {n:1,offset:1})).nextOffset,null);
  assert.equal(calls[0].path, `/groups/${groupId}/instances`);
  const bad = fixture({response:[{...row,instanceId:instanceId.replace(groupId,otherGroup)}]});
  await assert.rejects(bad.adapter.readPage("instances"), /destination_scope/);
});
function fixture({ permissions = ["*"], roles = [{ id: roleId, groupId }], response = success, handler, group = {} } = {}) {
  const calls = [];
  const client = { async request(path, options) {
    calls.push({ path, ...options });
    if (handler) { const response = await handler(path, options); if (response !== undefined) return response; }
    if (path === "/auth/user") return { id: uid(1) };
    if (path.includes("includeRoles")) return { id: groupId, ownerId: uid(2), privacy: "default", roles, myMember: { groupId, userId: uid(1), membershipStatus: "member", permissions, roleIds: [], has2FA: true }, ...group };
    if (path.endsWith("/friendStatus")) return { isFriend: true };
    if (path.startsWith("/instances/") && !options.method) return destination;
    return response;
  } };
  return { adapter: new ClubProvider({ client, groupId, expectedUserId: uid(1), clock: () => 1000 }), calls };
}
test("authority uses own-member grants, validates identity and never treats roles/catalog as grants", async () => {
  const { adapter, calls } = fixture({ permissions: [], roles: [{ id: roleId, groupId, permissions: ["*"] }] });
  const authority = await adapter.readAuthority();
  assert.deepEqual(authority.permissions, []);
  assert.equal(authority.has2FA, true);
  assert.equal(authority.ownerUserId, uid(2));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.maxResponseBytes === 2097152));
  const wrong = fixture({ group: { myMember: { groupId, userId: uid(3), permissions: [] } } });
  await assert.rejects(wrong.adapter.readAuthority(), /schema_drift/);
});
test("page bounds and three-character search reject before transport; unknown routes cannot forward", async () => {
  const { adapter, calls } = fixture({ response: [] });
  for (const options of [{ n: 101 }, { offset: -1 }, { n: 1.5 }, { path: "/auth/user" }]) await assert.rejects(adapter.readPage("members", options));
  await assert.rejects(adapter.readPage("search", { search: "ab" }));
  await assert.rejects(adapter.readPage("../../users", {}));
  assert.equal(calls.length, 0);
  await adapter.readPage("search", { search: "a & b", n: 100, offset: 100 });
  assert.match(calls[0].path, /members\/search\?n=100&offset=100&query=a\+%26\+b$/);
});
test("normalizes posts/audit pagination and rejects cross-group responses", async () => {
  const posts = fixture({ response: { posts: [{ id: postId, groupId }], total: 2 } });
  assert.equal((await posts.adapter.readPage("posts", { n: 1 })).nextOffset, 1);
  const audit = fixture({ response: { results: [{ id: "event-1", groupId, eventType: "unknown" }], hasNext: false } });
  assert.equal((await audit.adapter.readPage("audit")).items[0].eventType, "unknown");
  const wrong = fixture({ response: [{ groupId: otherGroup }] });
  await assert.rejects(wrong.adapter.readPage("members"), /provider_scope/);
  await assert.rejects(fixture({ response: { ...member, userId: uid(4) } }).adapter.getMember(uid(3)), /provider_scope/);
});
test("member operations select only documented endpoints and response shapes", async () => {
  const cases = [
    [{ kind: "approve_request", targetUserId: uid(3) }, "PUT", `/requests/${uid(3)}`, { action: "accept" }, null],
    [{ kind: "reject_request", targetUserId: uid(3) }, "PUT", `/requests/${uid(3)}`, { action: "reject" }, null],
    [{ kind: "invite_member", targetUserId: uid(3) }, "POST", "/invites", { userId: uid(3) }, null],
    [{ kind: "cancel_member_invite", targetUserId: uid(3) }, "DELETE", `/invites/${uid(3)}`, undefined, success],
    [{ kind: "remove_member", targetUserId: uid(3) }, "DELETE", `/members/${uid(3)}`, undefined, success],
    [{ kind: "ban_member", targetUserId: uid(3) }, "POST", "/bans", { userId: uid(3) }, member],
    [{ kind: "unban_member", targetUserId: uid(3) }, "DELETE", `/bans/${uid(3)}`, undefined, member],
    [{ kind: "assign_role", targetUserId: uid(3), roleId }, "PUT", `/members/${uid(3)}/roles/${roleId}`, undefined, [roleId]],
    [{ kind: "remove_role", targetUserId: uid(3), roleId }, "DELETE", `/members/${uid(3)}/roles/${roleId}`, undefined, []],
  ];
  for (const [operation, method, suffix, body, response] of cases) {
    const { adapter, calls } = fixture({ response });
    assert.equal((await adapter.execute(operation)).status, "succeeded", operation.kind);
    assert.equal(calls.at(-1).path, `/groups/${groupId}${suffix}`);
    assert.equal(calls.at(-1).method, method);
    assert.deepEqual(calls.at(-1).body, body);
    assert.equal(calls.filter((call) => call.method).length, 1);
  }
});
test("post create/edit use modern posts and explicit notification choice; delete preserves target", async () => {
  for (const kind of ["publish_post", "edit_post", "delete_post"]) {
    const operation = { kind, ...(kind !== "publish_post" ? { postId } : {}), ...(kind !== "delete_post" ? { title: "Tonight", text: "Doors open", visibility: "group", sendNotification: false, roleIds: [roleId] } : {}) };
    const { adapter, calls } = fixture({ response: kind === "delete_post" ? success : { id: postId, groupId, title: "Tonight", text: "Doors open" } });
    assert.equal((await adapter.execute(operation)).status, "succeeded");
    assert.match(calls.at(-1).path, /\/posts/);
    if (kind !== "delete_post") assert.equal(calls.at(-1).body.sendNotification, false);
  }
});
test("instance creation enforces group scope and option dependencies; normal close never hard-closes", async () => {
  const { adapter, calls } = fixture({ response: destination });
  assert.equal((await adapter.execute({ kind: "create_instance", worldId, access: "members", region: "eu", roleIds: [roleId], ageGated: true })).status, "succeeded");
  assert.deepEqual(calls.at(-1).body, { worldId, type: "group", ownerId: groupId, groupAccessType: "members", region: "eu", roleIds: [roleId], ageGate: true });
  assert.equal((await adapter.execute({ kind: "close_instance", worldId, instanceId })).status, "succeeded");
  assert.match(calls.at(-1).path, /hardClose=false$/);
  const invalid = fixture();
  for (const operation of [
    { kind: "create_instance", worldId, access: "public", region: "us", roleIds: [roleId] },
    { kind: "close_instance", worldId, instanceId: instanceId.replace(groupId, otherGroup) },
    { kind: "close_instance", worldId, instanceId, hardClose: true },
  ]) assert.equal((await invalid.adapter.execute(operation)).status, "rejected");
  assert.equal(invalid.calls.length, 0);
});
test("fresh permission loss, protected targets and foreign roles prevent writes", async () => {
  for (const setup of [{ permissions: [] }, { roles: [] }]) {
    const { adapter, calls } = fixture(setup);
    assert.equal((await adapter.execute({ kind: "assign_role", targetUserId: uid(3), roleId })).status, "rejected");
    assert.equal(calls.filter((call) => call.method).length, 0);
  }
  for (const targetUserId of [uid(1), uid(2)]) {
    const { adapter, calls } = fixture();
    assert.equal((await adapter.execute({ kind: "ban_member", targetUserId })).code, "protected_target");
    assert.equal(calls.filter((call) => call.method).length, 0);
  }
});
test("instance invites check friendship and live destination, validate sent notification identity", async () => {
  const operation = { kind: "invite_to_instance", targetUserId: uid(3), worldId, instanceId, messageSlot: 0 };
  const { adapter, calls } = fixture({ response: { id: postId, type: "invite", receiverUserId: uid(3), senderUserId: uid(1) } });
  assert.equal((await adapter.execute(operation)).status, "succeeded");
  assert.deepEqual(calls.at(-1).body, { instanceId: `${worldId}:${instanceId}`, messageSlot: 0 });
  for (const handler of [
    (path) => path.endsWith("friendStatus") ? { isFriend: false } : undefined,
    (path) => path.startsWith("/instances/") ? { ...destination, active: false } : undefined,
    (path) => path.startsWith("/instances/") ? { ...destination, ownerId: otherGroup } : undefined,
  ]) {
    const blocked = fixture({ handler });
    assert.equal((await blocked.adapter.execute(operation)).status, "rejected");
    assert.equal(blocked.calls.filter((call) => call.method).length, 0);
  }
});

test("group ownership does not prevent receiving an eligible instance invitation", async () => {
  const { adapter } = fixture({ response: { id: postId, type: "invite", receiverUserId: uid(2), senderUserId: uid(1) } });
  assert.equal((await adapter.execute({ kind: "invite_to_instance", targetUserId: uid(2), worldId, instanceId, messageSlot: 0 })).status, "succeeded");
});

test("inconsistent pagination cannot return a nonadvancing continuation", async () => {
  await assert.rejects(fixture({ response: { results: [], hasNext: true } }).adapter.readPage("audit"), { category: "schema_drift" });
  await assert.rejects(fixture({ response: { posts: [], total: 10 } }).adapter.readPage("posts"), { category: "schema_drift" });
});
test("write uncertainty never retries; definite rejection differs from preflight failure", async () => {
  for (const [error, status] of [
    [new VrchatProviderError("secret", { category: "network" }), "indeterminate"],
    [new VrchatProviderError("secret", { category: "timeout" }), "indeterminate"],
    [new VrchatProviderError("secret", { category: "transient", status: 503 }), "indeterminate"],
    [new VrchatProviderError("secret", { category: "rate_limit", status: 429, retryAfterMs: 2000 }), "rejected"],
    [new VrchatProviderError("secret", { status: 403 }), "rejected"],
  ]) {
    const { adapter, calls } = fixture({ handler: (_path, options) => { if (options.method) throw error; } });
    const result = await adapter.execute({ kind: "remove_member", targetUserId: uid(3) });
    assert.equal(result.status, status);
    assert.equal(calls.filter((call) => call.method).length, 1);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
  const malformed = fixture({ response: {} });
  assert.equal((await malformed.adapter.execute({ kind: "remove_member", targetUserId: uid(3) })).status, "indeterminate");
  const preflight = fixture({ handler: () => { throw new VrchatProviderError("timeout", { category: "timeout" }); } });
  assert.equal((await preflight.adapter.execute({ kind: "remove_member", targetUserId: uid(3) })).status, "rejected");
});
test("real client fake transport bounds body and refuses redirects", async () => {
  let options;
  const client = new VrchatClient({ authCookie: "fake-cookie-only", userAgent: "vrdex-test/1", fetcher: async (_url, input) => { options = input; return new Response('"' + "x".repeat(2097152) + '"'); } });
  const adapter = new ClubProvider({ client, groupId, expectedUserId: uid(1) });
  await assert.rejects(adapter.readAuthority(), /malformed JSON/);
  assert.equal(options.redirect, "error");
});
