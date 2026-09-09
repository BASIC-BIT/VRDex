import assert from "node:assert/strict";
import { test } from "node:test";

import { allowedDestinationArtworkUrl, resolveProfileLinkDestination } from "./profile-link-destination.mjs";

const id = "grp_11111111-1111-4111-8111-111111111111";
const userId = id.replace("grp_", "usr_");
const artwork = "https://api.vrchat.cloud/api/1/file/file_22222222-2222-4222-8222-222222222222/1/file";
const portraitThumbnail = "https://api.vrchat.cloud/api/1/image/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4/1/512";
const group = { kind: "vrchat_group", locator: id };
const invite = { kind: "discord_guild", locator: "TestInvite" };
const guild = { id: "123456789012345678", name: "Server name", icon: "a_1234567890abcdef1234567890abcdef" };
const json = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("public group resolver fetches exactly one ID and projects no private account context", async () => {
  const paths = [];
  const result = await resolveProfileLinkDestination(group, { requestVrchat: async path => {
    paths.push(path);
    return { id, name: "Group name", privacy: "default", iconUrl: artwork, myMember: { roleIds: ["private"] } };
  } });
  assert.deepEqual(paths, [`/groups/${id}`]);
  assert.deepEqual(result, { status: "resolved", entityId: id, displayName: "Group name", artworkSourceUrl: artwork, artworkType: "group_icon" });
});

test("private or unknown-privacy groups cannot publish names or artwork", async () => {
  for (const privacy of ["private", "unknown", undefined]) {
    assert.deepEqual(await resolveProfileLinkDestination(group, { requestVrchat: async () => ({ id, name: "Private", privacy, iconUrl: artwork }) }), { status: "inaccessible" });
  }
});

test("mismatched identities never bind metadata to requested destinations", async () => {
  assert.deepEqual(await resolveProfileLinkDestination(group, { requestVrchat: async () => ({ id: userId, privacy: "default", name: "Wrong" }) }), { status: "transient" });
  assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => json({ type: 0, code: "Other", guild }) }), { status: "transient" });
});

test("public person uses the user icon, not the profile override or banner", async () => {
  assert.deepEqual(await resolveProfileLinkDestination({ kind: "vrchat_user", locator: userId }, { requestVrchat: async () => ({ id: userId, displayName: "Person", userIcon: portraitThumbnail, profilePicOverrideThumbnail: artwork, profilePicOverride: artwork, bannerUrl: artwork, currentAvatarImageUrl: artwork, location: "private" }) }), { status: "resolved", entityId: userId, displayName: "Person", artworkSourceUrl: portraitThumbnail, artworkType: "user_icon" });
});


test("short group redirects resolve only exact canonical group targets without forwarding auth", async () => {
  const calls = [];
  const result = await resolveProfileLinkDestination({ kind: "vrchat_group", locator: "TEST.1234" }, {
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.cookie, undefined);
      return new Response(null, { status: 302, headers: { location: `/home/group/${id}` } });
    },
    requestVrchat: async path => { calls.push(path); return { id, name: "Short group", privacy: "default" }; },
  });
  assert.equal(result.entityId, id);
  assert.deepEqual(calls, ["https://api.vrchat.cloud/api/1/groups/redirect/TEST.1234", `/groups/${id}`]);
  for (const location of [`https://vrchat.com/home/group/${id}`, `/home/group/${id}/`]) {
    const absolute = await resolveProfileLinkDestination({ kind: "vrchat_group", locator: "TEST.1234" }, {
      fetcher: async () => new Response(null, { status: 302, headers: { location } }),
      requestVrchat: async path => { assert.equal(path, `/groups/${id}`); return { id, name: "Short group", privacy: "default" }; },
    });
    assert.equal(absolute.entityId, id);
  }
  for (const location of [
    "https://evil.example/group", `https://vrchat.com/home/user/${userId}`,
    `https://vrchat.com/home/group/${id}?token=x`, `/home/group/${id}?token=x`,
    `/home/group/${id}#fragment`, `https://user:pass@vrchat.com/home/group/${id}`,
    `//evil.example/home/group/${id}`, `//vrchat.com/home/group/${id}`,
    `https://api.vrchat.cloud/home/group/${id}`, `http://vrchat.com/home/group/${id}`,
    `https://vrchat.com:8443/home/group/${id}`, `/home/user/../group/${id}`,
    `/home/group/${id}/extra`, `home/group/${id}`, "/home/group/not-a-group", "",
  ]) {
    assert.deepEqual(await resolveProfileLinkDestination({ kind: "vrchat_group", locator: "TEST.1234" }, { fetcher: async () => new Response(null, { status: 302, headers: { location } }), requestVrchat: async () => assert.fail("must not request rejected redirect") }), { status: "transient" });
  }
});

test("provider outages preserve the transient distinction, confirmed missing/forbidden do not", async () => {
  for (const [status, expected] of [[404, "invalid"], [410, "invalid"], [403, "inaccessible"], [503, "transient"]]) {
    assert.equal((await resolveProfileLinkDestination(group, { requestVrchat: async () => { throw Object.assign(new Error("failed"), { status }); } })).status, expected);
  }
  for (const category of ["authentication", "rate_limit", "metadata_budget", "control_plane"]) {
    const error = Object.assign(new Error("account/control state"), { category });
    await assert.rejects(resolveProfileLinkDestination(group, { requestVrchat: async () => { throw error; } }), value => value === error);
  }
  await assert.rejects(resolveProfileLinkDestination({ kind: "vrchat_group", locator: "TEST.1234" }, { fetcher: async () => new Response(null, { status: 429, headers: { "retry-after": "120" } }), requestVrchat: async () => assert.fail() }), error => error.category === "rate_limit" && error.retryAfterMs === 120000);
});

test("Discord guild invite emits static icon, while friend or DM invite emits no guild data", async () => {
  const resolved = await resolveProfileLinkDestination(invite, { fetcher: async (url, options) => {
    assert.equal(url, "https://discord.com/api/v10/invites/TestInvite");
    assert.equal(options.headers.authorization, undefined);
    return json({ type: 0, code: invite.locator, guild });
  } });
  assert.deepEqual(resolved, { status: "resolved", entityId: guild.id, displayName: guild.name, artworkSourceUrl: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`, artworkType: "server_icon" });
  for (const type of [1, 2]) assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => json({ type, code: invite.locator, guild }) }), { status: "inaccessible" });
});

test("Discord rejects numeric IDs and confirmed expired invites", async () => {
  assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => json({ type: 0, code: invite.locator, guild: { ...guild, id: 123456 } }) }), { status: "transient" });
  assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => json({ type: 0, code: invite.locator, guild, expires_at: "2000-01-01T00:00:00Z" }) }), { status: "invalid" });
});

test("Discord rate limits propagate retry delay and oversized responses stop streaming", async () => {
  assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => new Response(null, { status: 429, headers: { "retry-after": "321" } }) }), { status: "transient", retryAfterMs: 321000 });
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(300 * 1024)); }, cancel() { cancelled = true; } });
  assert.deepEqual(await resolveProfileLinkDestination(invite, { fetcher: async () => new Response(body) }), { status: "transient" });
  assert.equal(cancelled, true);
});

test("provider artwork accepts changing paths, sizes and signed query formats", () => {
  for (const source of [
    portraitThumbnail,
    portraitThumbnail.replace("/512", "/256"),
    "https://files.vrchat.cloud/new-layout/portrait.webp?signature=v2&expiry=tomorrow",
    "https://api.vrchat.com/api/1/image/new-format?size=1024",
  ]) assert.equal(allowedDestinationArtworkUrl(source, "vrchat_user"), source);
  const discord = "https://cdn.discordapp.com/new-layout/icon.webp?size=256&version=2";
  assert.equal(allowedDestinationArtworkUrl(discord, "discord_guild"), discord);
  assert.equal(allowedDestinationArtworkUrl(discord, "vrchat_group"), undefined);
  assert.equal(allowedDestinationArtworkUrl(portraitThumbnail, "discord_guild"), undefined);
});

test("artwork requires exact provider hosts and safe HTTPS URLs", () => {
  for (const source of [
    "http://127.0.0.1/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png",
    "https://169.254.169.254/latest/meta-data", "file:///etc/passwd",
    "https://api.vrchat.cloud.evil.example/image", "https://evil.example/",
    "https://subdomain.files.vrchat.cloud/image", "https://cdn.discordapp.com.evil.example/image",
    "https://user:pass@files.vrchat.cloud/image", "https://files.vrchat.cloud:8443/image",
    "https://files.vrchat.cloud/image#fragment", "not a url",
  ]) for (const kind of ["vrchat_user", "vrchat_group", "discord_guild"]) {
    assert.equal(allowedDestinationArtworkUrl(source, kind), undefined);
  }
  assert.equal(allowedDestinationArtworkUrl(artwork, "unknown"), undefined);
});

test("Discord servers without icons resolve names without manufacturing artwork", async () => {
  for (const icon of [null, undefined, "", "   ", 123, {}]) {
    const result = await resolveProfileLinkDestination(invite, { fetcher: async () => json({ type: 0, code: invite.locator, guild: { ...guild, icon } }) });
    assert.deepEqual(result, { status: "resolved", entityId: guild.id, displayName: guild.name });
  }
});

test("override, banner and avatar artwork are never used when the user icon is absent or unsafe", async () => {
  for (const custom of [undefined, "", "https://evil.example/image.png"]) {
    const result = await resolveProfileLinkDestination({ kind: "vrchat_user", locator: userId }, {
      requestVrchat: async () => ({ id: userId, displayName: "Person", userIcon: custom, profilePicOverride: artwork, profilePicOverrideThumbnail: portraitThumbnail, bannerUrl: artwork, currentAvatarImageUrl: artwork, currentAvatarThumbnailImageUrl: portraitThumbnail }),
    });
    assert.deepEqual(result, { status: "resolved", entityId: userId, displayName: "Person" });
  }
});

test("user icon remains eligible without a profile override", async () => {
  const result = await resolveProfileLinkDestination({ kind: "vrchat_user", locator: userId }, {
    requestVrchat: async () => ({ id: userId, displayName: "Person", userIcon: portraitThumbnail }),
  });
  assert.equal(result.artworkSourceUrl, portraitThumbnail);
  assert.equal(result.artworkType, "user_icon");
});
