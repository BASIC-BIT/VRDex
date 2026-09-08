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
  assert.deepEqual(result, { status: "resolved", entityId: id, displayName: "Group name", artworkSourceUrl: artwork });
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

test("public person uses portrait override before avatar without leaking location", async () => {
  assert.deepEqual(await resolveProfileLinkDestination({ kind: "vrchat_user", locator: userId }, { requestVrchat: async () => ({ id: userId, displayName: "Person", profilePicOverrideThumbnail: portraitThumbnail, profilePicOverride: "https://api.vrchat.cloud/api/1/file/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4/1", currentAvatarImageUrl: artwork, location: "private" }) }), { status: "resolved", entityId: userId, displayName: "Person", artworkSourceUrl: portraitThumbnail });
});

test("portrait thumbnails accept only the observed provider image endpoint and bounded size", () => {
  for (const host of ["api.vrchat.cloud", "api.vrchat.com"]) {
    const source = portraitThumbnail.replace("api.vrchat.cloud", host);
    assert.equal(allowedDestinationArtworkUrl(source, "vrchat_user"), source);
  }
  for (const source of [
    portraitThumbnail.replace("/512", "/4096"),
    portraitThumbnail.replace("/512", "/0"),
    portraitThumbnail.replace("/512", "/0512"),
    portraitThumbnail.replace("/1/512", "/-1/512"),
    portraitThumbnail.replace("file_904c068b-dccb-40e3-a52b-ebe59c79e1f4", "file_------------------------------------"),
    portraitThumbnail.replace("api.vrchat.cloud", "api.vrchat.cloud.evil.example"),
    portraitThumbnail.replace("https://", "https://user:pass@"),
    portraitThumbnail + "?url=https://evil.example",
    portraitThumbnail + "/file",
    portraitThumbnail + "#fragment",
    "https://api.vrchat.cloud/api/1/file/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4/1",
  ]) assert.equal(allowedDestinationArtworkUrl(source, "vrchat_user"), undefined);
  assert.equal(allowedDestinationArtworkUrl(portraitThumbnail, "discord_guild"), undefined);
});

test("short group redirects resolve only exact canonical group targets without forwarding auth", async () => {
  const calls = [];
  const result = await resolveProfileLinkDestination({ kind: "vrchat_group", locator: "TEST.1234" }, {
    fetcher: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.cookie, undefined);
      return new Response(null, { status: 302, headers: { location: `https://vrchat.com/home/group/${id}` } });
    },
    requestVrchat: async path => { calls.push(path); return { id, name: "Short group", privacy: "default" }; },
  });
  assert.equal(result.entityId, id);
  assert.deepEqual(calls, ["https://api.vrchat.com/api/1/groups/redirect/TEST.1234", `/groups/${id}`]);
  for (const location of ["https://evil.example/group", "https://vrchat.com/home/user/" + userId, "https://vrchat.com/home/group/" + id + "?token=x"]) {
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
  assert.deepEqual(resolved, { status: "resolved", entityId: guild.id, displayName: guild.name, artworkSourceUrl: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` });
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

test("artwork permits only provider image paths, never arbitrary URLs or credentials", () => {
  assert.equal(allowedDestinationArtworkUrl(artwork, "vrchat_group"), artwork);
  for (const source of ["http://127.0.0.1/a.png", artwork.replace("api.vrchat.cloud", "api.vrchat.cloud.evil.example"), artwork.replace("https://", "https://user:pass@"), artwork + "?url=https://evil.example", "https://api.vrchat.cloud/api/1/users/" + userId, "https://cdn.discordapp.com/attachments/12345/12345/image.png"]) {
    assert.equal(allowedDestinationArtworkUrl(source, "vrchat_group"), undefined);
    assert.equal(allowedDestinationArtworkUrl(source, "discord_guild"), undefined);
  }
});

test("VRChat public file redirects allow only observed signed blob URL structure", () => {
  const source = "https://files.vrchat.cloud/file_210c7a41-cb14-4b83-bf63-e42f45194492_blob?Expires=1790208000&Key-Pair-Id=EXAMPLE&Signature=example_";
  assert.equal(allowedDestinationArtworkUrl(source, "vrchat_group"), source);
  assert.equal(allowedDestinationArtworkUrl(source + "&url=https://evil.example", "vrchat_group"), undefined);
  assert.equal(allowedDestinationArtworkUrl(source.replace("_blob", "/arbitrary"), "vrchat_group"), undefined);
});

test("portrait CDN redirects accept only versioned PNG thumbnails at the observed size", () => {
  const source = "https://files.vrchat.cloud/thumbnails/file_904c068b-dccb-40e3-a52b-ebe59c79e1f4.bc26edd42f6bbb785387d1d1ecb520f0e7fbc1670a411bcc76ab0c04736ff3a5.1.thumbnail-512.png";
  assert.equal(allowedDestinationArtworkUrl(source, "vrchat_user"), source);
  const signed = source + "?Expires=1790208000&Key-Pair-Id=EXAMPLE&Signature=example_";
  assert.equal(allowedDestinationArtworkUrl(signed, "vrchat_user"), signed);
  for (const rejected of [
    signed + "&url=https://evil.example",
    signed + "&Signature=duplicate",
    signed.replace("Expires=1790208000", "Expires=invalid"),
    signed.replace("Signature=example_", "Signature="),
    signed.replace("Key-Pair-Id=EXAMPLE&", ""),
    source.replace("/thumbnails/", "/arbitrary/"),
    source.replace("files.vrchat.cloud", "files.vrchat.cloud.evil.example"),
    source.replace("thumbnail-512", "thumbnail-4096"),
    source.replace(".png", ".svg"),
    source.replace(".1.thumbnail", ".0.thumbnail"),
    source.replace(".1.thumbnail", ".10000000000.thumbnail"),
    source.replace("bc26edd4", "invalid_"),
    source + "?url=https://evil.example",
    source + "#fragment",
  ]) assert.equal(allowedDestinationArtworkUrl(rejected, "vrchat_user"), undefined);
  assert.equal(allowedDestinationArtworkUrl(source, "discord_guild"), undefined);
});
