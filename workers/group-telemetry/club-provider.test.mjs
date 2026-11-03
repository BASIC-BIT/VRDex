import test from "node:test";
import assert from "node:assert/strict";
import { ClubProvider, fetchArtwork } from "./club-provider.mjs";
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
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
test("friendship check reads one explicit user and validates boolean evidence", async () => {
  const { adapter, calls } = fixture({ handler: async () => ({ isFriend: false, incomingRequest: true }) });
  assert.equal(await adapter.getFriendship(uid(3)), "not_friend");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/user/${uid(3)}/friendStatus`);
  const bad = fixture({ handler: async () => ({ isFriend: "true" }) });
  await assert.rejects(bad.adapter.getFriendship(uid(3)), /schema_drift/);
});
test("instance destination pages use unpaginated endpoint and reject foreign locations", async () => {
  const row = {...destination,world:{id:worldId,name:"World"},instanceId,location:`${worldId}:${instanceId}`};
  const {adapter,calls} = fixture({response:{fetchedAt:new Date(900).toISOString(),instances:[row,row]}});
  assert.equal((await adapter.readPage("instances", {n:1,offset:0})).nextOffset,1);
  assert.equal((await adapter.readPage("instances", {n:1,offset:1})).nextOffset,null);
  assert.equal(calls[0].path, `/users/${uid(1)}/instances/groups/${groupId}`);
  const bad = fixture({response:{fetchedAt:new Date(900).toISOString(),instances:[{...row,instanceId:instanceId.replace(groupId,otherGroup)}]}});
  await assert.rejects(bad.adapter.readPage("instances"), /destination_scope/);
});
test("live management excludes closed instances and preserves provider freshness", async () => {
  const row = {...destination,world:{id:worldId,name:"World"},location:`${worldId}:${instanceId}`};
  const {adapter} = fixture({response:{fetchedAt:new Date(900).toISOString(),instances:[row,{...row,closedAt:new Date(800).toISOString()},{...row,active:false}]}});
  const page = await adapter.readPage("instances");
  assert.equal(page.items.length,1);
  assert.equal(page.observedAt,900);
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
test("mixed-case role UUIDs use the current provider ID for assign and remove", async () => {
  const providerRoleId = "grol_AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  const savedRoleId = providerRoleId.toLowerCase();
  for (const kind of ["assign_role", "remove_role"]) {
    const { adapter, calls } = fixture({
      roles: [{ id: providerRoleId, groupId }],
      response: kind === "assign_role" ? [savedRoleId] : [],
    });
    const result = await adapter.execute({ kind, targetUserId: uid(3), roleId: savedRoleId });
    assert.equal(result.status, "succeeded", kind);
    assert.equal(calls.at(-1).path, `/groups/${groupId}/members/${uid(3)}/roles/${providerRoleId}`);
    assert.equal(calls.filter(call => call.method).length, 1);
  }
  const invalid = fixture({ roles: [{ id: providerRoleId, groupId }] });
  assert.equal((await invalid.adapter.execute({ kind: "assign_role", targetUserId: uid(3), roleId: providerRoleId.replace("grol_", "GROL_") })).status, "rejected");
  assert.equal(invalid.calls.filter(call => call.method).length, 0);
});
test("post create/edit use modern posts and explicit notification choice; delete preserves target", async () => {
  for (const kind of ["publish_post", "edit_post", "delete_post"]) {
    const operation = { kind, ...(kind !== "publish_post" ? { postId, expectedUpdatedAt: "2026-01-01T00:00:00Z", postPageOffset: 20 } : {}), ...(kind !== "delete_post" ? { title: "Tonight", text: "Doors open", visibility: "group", sendNotification: false, roleIds: [roleId] } : {}) };
    const { adapter, calls } = fixture({ handler: (path, options) => path.includes("/posts?") ? { posts: [{ id: postId, groupId, updatedAt: operation.expectedUpdatedAt }], total: 21 } : options?.method ? kind === "delete_post" ? success : { id: postId, groupId, title: "Tonight", text: "Doors open" } : undefined });
    assert.equal((await adapter.execute(operation)).status, "succeeded");
    assert.match(calls.at(-1).path, /\/posts/);
    if (kind !== "publish_post") assert.match(calls.at(-2).path, /\/posts\?n=20&offset=20$/);
    if (kind !== "delete_post") assert.equal(calls.at(-1).body.sendNotification, false);
  }
});
test("post changes, missing versions and shifted pages prevent edits and deletion", async () => {
  for (const kind of ["edit_post", "delete_post"]) {
    const operation = { kind, postId, expectedUpdatedAt: "2026-01-01T00:00:00Z", postPageOffset: 20, ...(kind === "edit_post" ? { title: "Tonight", text: "Doors open", visibility: "group", sendNotification: false } : {}) };
    for (const posts of [[{ id: postId, groupId, updatedAt: "2026-01-02T00:00:00Z" }], []]) {
      const { adapter, calls } = fixture({ handler: (path) => path.includes("/posts?") ? { posts, total: posts.length } : undefined });
      assert.deepEqual(await adapter.execute(operation), { status: "rejected", code: "post_changed" });
      assert.equal(calls.some((call) => call.method), false);
    }
    const legacy = fixture();
    assert.equal((await legacy.adapter.execute({ ...operation, expectedUpdatedAt: undefined })).status, "rejected");
    assert.equal(legacy.calls.length, 0);
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

test("instance invite confirmation accepts provider IDs with different UUID casing", async () => {
  const { adapter } = fixture({ response: { id: postId, type: "invite", receiverUserId: uid(3), senderUserId: uid(1) } });
  assert.equal((await adapter.execute({ kind: "invite_to_instance", targetUserId: uid(3).toUpperCase().replace("USR_", "usr_"), worldId, instanceId })).status, "succeeded");
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

const cal = "cal_00000000-0000-0000-0000-000000000001";
const fileId = "file_00000000-0000-0000-0000-000000000001";
const event = { title: "Bass Temple", description: "Weekly bass night.", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", accessType: "group" };
test("create posts a group-only event with no creation notification and uploads PNG artwork first", async () => {
  const fetched = [];
  const { adapter, calls } = fixture({ handler: async (path) => path === "/file/image" ? { id: fileId } : path.startsWith("/calendar/") ? { id: cal, ownerId: groupId } : undefined });
  adapter.fetchImage = async (url) => { fetched.push(url); return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }; };
  const out = await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.png" });
  assert.equal(out.status, "succeeded");
  assert.equal(out.artworkUploaded, true);
  assert.deepEqual(fetched, ["https://vrdex.test/poster.png"]);
  const writes = calls.filter((c) => c.method && c.method !== "GET");
  assert.deepEqual(writes.map((c) => [c.method, c.path]), [["POST", "/file/image"], ["POST", `/calendar/${groupId}/event`]]);
  assert.equal(writes[0].form.get("tag"), "gallery");
  assert.equal(writes[0].form.get("file").type, "image/png");
  assert.deepEqual(writes[1].body, { ...event, category: "other", sendCreationNotification: false, imageId: fileId });
});
test("non-PNG artwork is skipped, not fatal", async () => {
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { id: cal } : undefined });
  adapter.fetchImage = async () => ({ bytes: new Uint8Array([255, 216]), contentType: "image/jpeg" });
  assert.equal((await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.jpg" })).status, "succeeded");
  assert.equal(calls.some((c) => c.path === "/file/image"), false);
  assert.equal("imageId" in calls.at(-1).body, false);
});
test("update and delete address the calendar event; long titles are refused", async () => {
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { id: cal } : undefined });
  await adapter.execute({ kind: "update_calendar_event", calendarEventId: cal, ...event });
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path, calls.at(-1).body.sendCreationNotification], ["PUT", `/calendar/${groupId}/${cal}/event`, false]);
  await adapter.execute({ kind: "delete_calendar_event", calendarEventId: cal });
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path], ["DELETE", `/calendar/${groupId}/${cal}`]);
  assert.equal((await adapter.execute({ kind: "create_calendar_event", ...event, title: "x".repeat(65) })).code, "invalid_input");
});
test("list pages each month in the window, keeps in-window items, and reports truncation", async () => {
  const item = (n, startsAt) => ({ id: `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, ownerId: groupId, title: `Night ${n}`, description: "", startsAt, endsAt: startsAt, createdAt: "2026-10-01T00:00:00.000Z" });
  const { adapter, calls } = fixture({ handler: async (path) => {
    if (!path.startsWith("/calendar/")) return undefined;
    const date = new URL(path, "https://x").searchParams.get("date");
    return { results: date.startsWith("2026-11") ? [item(1, "2026-11-01T12:00:00.000Z"), item(2, "2026-11-08T01:00:00.000Z")] : [], hasNext: false };
  } });
  const out = await adapter.execute({ kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" });
  assert.deepEqual(calls.filter((c) => c.path.startsWith("/calendar/")).map((c) => new URL(c.path, "https://x").searchParams.get("date")),
    ["2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  assert.deepEqual(out.result, { calendarEvents: [{ id: item(2).id, title: "Night 2", description: "", startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T01:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }], calendarEventsTruncated: false });
});
test("list follows hasNext, drops deleted items, slices descriptions, refuses foreign owners, and truncates at 200", async () => {
  const item = (n) => ({ id: `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, title: "T", description: "d".repeat(2500), startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T02:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" });
  const pages = (path) => {
    const offset = Number(new URL(path, "https://x").searchParams.get("offset"));
    return { results: Array.from({ length: 100 }, (_, i) => ({ ...item(offset + i + 1), ...(offset + i === 0 ? { deletedAt: "2026-10-03T00:00:00.000Z" } : {}) })), hasNext: true };
  };
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? pages(path) : undefined });
  const out = await adapter.listCalendar({ from: "2026-11-02T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" });
  assert.equal(out.calendarEvents.length, 200);
  assert.equal(out.calendarEventsTruncated, true);
  assert.equal(out.calendarEvents[0].id, item(2).id);
  assert.equal(out.calendarEvents[0].description.length, 2000);
  assert.deepEqual(calls.map((c) => new URL(c.path, "https://x").searchParams.get("offset")), ["0", "100", "200"]);
  const foreign = fixture({ handler: async () => ({ results: [{ ...item(1), ownerId: otherGroup }], hasNext: false }) });
  await assert.rejects(foreign.adapter.listCalendar({ from: "2026-11-02T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" }), { category: "provider_scope" });
});
test("list stops by UTF-8 bytes, not characters", async () => {
  const item = (n) => ({ id: `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, title: "T", description: "語".repeat(2000), startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T02:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" });
  const { adapter } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { results: Array.from({ length: 100 }, (_, i) => item(i + 1)), hasNext: false } : undefined });
  const out = await adapter.listCalendar({ from: "2026-11-02T00:00:00.000Z", to: "2026-11-30T00:00:00.000Z" });
  assert.equal(out.calendarEventsTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 500_000);
});
test("artwork fetch keeps only bounded https PNG responses", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const respond = (url, body = png, type = "image/png") => async () => Object.defineProperty(new Response(body, { headers: { "content-type": type } }), "url", { value: url });
  const lookup = publicLookup;
  const seen = [];
  assert.deepEqual(await fetchArtwork("https://vrdex.test/a.png", { lookup, fetcher: async (url, options) => { seen.push(options.redirect); return respond(url)(); } }), { bytes: png, contentType: "image/png" });
  assert.deepEqual(seen, ["error"]);
  await assert.rejects(fetchArtwork("http://vrdex.test/a.png", { lookup, fetcher: respond("http://vrdex.test/a.png") }));
  await assert.rejects(fetchArtwork("https://vrdex.test/a.png", { lookup, fetcher: respond("https://vrdex.test/a.png", png, "image/jpeg") }));
  await assert.rejects(fetchArtwork("https://vrdex.test/a.png", { lookup, fetcher: respond("https://vrdex.test/a.png", new Uint8Array(5)), maxBytes: 4 }));
});
test("artwork fetch refuses any host that reaches a non-public address, before any request", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const fetched = [];
  const fetcher = async (url) => { fetched.push(url); return new Response(png, { headers: { "content-type": "image/png" } }); };
  // Each listed range, by an address inside it.
  const blocked = ["0.1.2.3", "10.0.0.5", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.254", "192.168.1.1", "198.18.0.1", "198.19.255.254", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254"];
  for (const address of blocked) {
    await assert.rejects(fetchArtwork("https://poster.vrdex.test/a.png", { fetcher, lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }] }), { category: "artwork" }, address);
  }
  // A public record beside a private one is still refused.
  await assert.rejects(fetchArtwork("https://poster.vrdex.test/a.png", { fetcher, lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }] }), { category: "artwork" });
  // A literal IP is checked as written, whatever a resolver would say; URL normalises the numeric spellings.
  for (const url of ["https://127.0.0.1/a.png", "https://169.254.169.254/latest/meta-data", "https://[::1]/a.png", "https://[::ffff:127.0.0.1]/a.png", "https://[::ffff:a9fe:a9fe]/a.png", "https://2130706433/a.png", "https://0x7f.1/a.png"]) {
    await assert.rejects(fetchArtwork(url, { fetcher, lookup: publicLookup }), { category: "artwork" }, url);
  }
  // No answer is not a public answer.
  await assert.rejects(fetchArtwork("https://poster.vrdex.test/a.png", { fetcher, lookup: async () => [] }), { category: "artwork" });
  await assert.rejects(fetchArtwork("https://poster.vrdex.test/a.png", { fetcher, lookup: async () => { throw new Error("ENOTFOUND"); } }), /ENOTFOUND/);
  assert.deepEqual(fetched, []);
});
test("artwork fetch lets public addresses through, including the neighbours of the blocked ranges", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const fetcher = async () => new Response(png, { headers: { "content-type": "image/png" } });
  for (const address of ["93.184.216.34", "1.0.0.1", "9.255.255.255", "11.0.0.1", "100.63.255.255", "100.128.0.1", "126.255.255.255", "128.0.0.1", "169.253.0.1", "172.15.255.255", "172.32.0.1", "192.167.0.1", "192.169.0.1", "198.17.255.255", "198.20.0.1", "223.255.255.255", "2606:4700:4700::1111", "fbff::1", "fec0::1"]) {
    const seen = [];
    const out = await fetchArtwork("https://poster.vrdex.test/a.png", { fetcher, lookup: async (host, options) => { seen.push([host, options]); return [{ address, family: address.includes(":") ? 6 : 4 }]; } });
    assert.deepEqual(out, { bytes: png, contentType: "image/png" }, address);
    assert.deepEqual(seen, [["poster.vrdex.test", { all: true }]]);
  }
});
test("a poster on a private address is a soft drop: the event still writes, without the image", async () => {
  const { adapter, calls } = fixture({ handler: async (path) => path.startsWith("/calendar/") ? { id: cal, ownerId: groupId } : undefined });
  adapter.fetchImage = (url) => fetchArtwork(url, { lookup: async () => [{ address: "169.254.169.254", family: 4 }], fetcher: async () => assert.fail("must not fetch") });
  const out = await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://poster.vrdex.test/a.png" });
  assert.equal(out.status, "succeeded");
  assert.equal(out.artworkUploaded, undefined);
  assert.deepEqual(calls.filter((c) => c.method && c.method !== "GET").map((c) => c.path), [`/calendar/${groupId}/event`]);
});
test("a redirected artwork URL is a soft drop", async () => {
  const { adapter } = fixture({ handler: async () => undefined });
  adapter.fetchImage = (url) => fetchArtwork(url, { lookup: publicLookup, fetcher: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(await adapter.artwork("https://vrdex.test/a.png"), undefined);
});
test("a refused, denied or malformed artwork upload rejects the operation without the event write", async () => {
  const refuse = (category) => async () => { throw new VrchatProviderError("x", { status: 403, category }); };
  for (const [upload, code] of [[refuse("provider_error"), "provider_error"], [refuse("operation_denied"), "operation_denied"], [async () => ({}), "schema_drift"], [async () => ({ id: "file_nope" }), "schema_drift"]]) {
    const { adapter, calls } = fixture({ handler: async (path) => path === "/file/image" ? upload() : path.startsWith("/calendar/") ? { id: cal } : undefined });
    adapter.fetchImage = async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" });
    const out = await adapter.execute({ kind: "create_calendar_event", ...event, imageUrl: "https://vrdex.test/poster.png" });
    assert.equal(out.status, "rejected");
    assert.equal(out.code, code);
    assert.deepEqual(calls.filter((c) => c.method).map((c) => c.path), ["/file/image"]);
  }
});
