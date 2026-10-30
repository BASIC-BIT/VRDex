import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { reindexProfileSearchDocument } from "../../convex/_searchDocuments";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newClerkUserId } from "./_clerkTestIdentity";
import { connectorFixture } from "./_eventConnectorFixture";
import { AUTHOR_A, CHANNEL, GUILD, revokeManageIntegrations, seedCommunity, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];

const SITE = "https://vrdex.test";
const OTHER_CHANNEL = "100000000000000003";
const denied = { reply: "You need to manage integrations for that community." };

beforeEach(test => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.SITE_URL = SITE;
});

const body = (over: Record<string, unknown> = {}) => ({ command: "connect", guildId: GUILD, channelId: CHANNEL, invokerDiscordUserId: AUTHOR_A, invokerHasManageGuild: true, options: { community: "night-club", mode: "hold", channelName: "announcements", guildName: "Night Server" }, ...over });
const command = (t: T, over: Record<string, unknown> = {}) => t.action(internal.discordIntake.handleCommand, body(over) as never);
const linkDiscord = (t: T, userId: Id<"users">, discordUserId = AUTHOR_A) => t.run(ctx => ctx.db.insert("discordVerificationWatermarks", { userId, discordUserId, issuedGeneration: 1, appliedGeneration: 1, appliedAt: Date.now(), issuedAt: Date.now(), updatedAt: Date.now() }));
const connectors = (t: T) => t.run(ctx => ctx.db.query("eventConnectors").collect());
const guildLinks = (t: T) => t.run(ctx => ctx.db.query("profileExternalLinks").collect());
const clearConnectors = (t: T) => t.run(async ctx => { for (const row of await ctx.db.query("eventConnectors").collect()) await ctx.db.delete(row._id); });
const seedCommunityRow = (ctx: Parameters<Parameters<T["run"]>[0]>[0], slug: string) => ctx.db.insert("profiles", {
  slug, displayName: slug, sortName: slug, profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [],
  claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now(),
});
const person = { sortName: "person", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community" } as const;

it("refuses an invoker whose Discord ID two VRDex users verified", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  const other = await t.run(ctx => ctx.db.insert("users", { clerkUserId: newClerkUserId() }));
  await linkDiscord(t, authorityUserId); await linkDiscord(t, other);
  assert.deepEqual(await command(t), { reply: `Link your Discord account on VRDex first: ${SITE}/account/connections` });
  assert.deepEqual(await command(t, { command: "autocomplete", options: { query: "club" } }), { choices: [] });
});

it("refuses connect without Manage Server or without manage_integrations", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  assert.deepEqual(await command(t, { invokerHasManageGuild: false }), denied);
  await seedCommunity(t, { slug: "other-club", displayName: "Other Club" }); // no grant
  // A free channel, so only the missing grant can refuse this.
  assert.deepEqual(await command(t, { channelId: OTHER_CHANNEL, options: { community: "other-club", mode: "hold", channelName: "news", guildName: "Night Server" } }), denied);
  assert.deepEqual(await command(t, { channelId: OTHER_CHANNEL, options: { community: "no-such-club", mode: "hold", channelName: "news", guildName: "Night Server" } }), denied);
  assert.equal((await connectors(t)).length, 1);
  assert.equal((await guildLinks(t)).length, 0);
});

it("refuses a reconnect on the invoker's own community once the grant is revoked", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await revokeManageIntegrations(t, communityProfileId, authorityUserId);
  const before = await connectors(t);
  assert.deepEqual(await command(t, { options: { community: "night-club", mode: "autopublish", channelName: "renamed", guildName: "New Name" } }), denied);
  assert.deepEqual(await connectors(t), before);
  assert.equal((await guildLinks(t)).length, 0);
});

it("refuses to connect a person profile the invoker owns", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await clearConnectors(t);
  await t.run(async ctx => {
    const now = Date.now();
    const profileId = await ctx.db.insert("profiles", { ...person, slug: "me", displayName: "Me", updatedAt: now });
    await ctx.db.insert("profileOwners", { profileId, userId: authorityUserId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
  });
  assert.deepEqual(await command(t, { options: { community: "me", mode: "hold", channelName: "announcements", guildName: "Night Server" } }), denied);
  assert.equal((await connectors(t)).length, 0);
});

it("connects with the spec reply and creates one guild link", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await clearConnectors(t);
  await linkDiscord(t, authorityUserId);
  assert.deepEqual(await command(t), { reply: "Connected #announcements to Night Club. Hold for review." });
  assert.deepEqual(await command(t, { channelId: OTHER_CHANNEL, options: { community: "night-club", mode: "autopublish", channelName: "news", guildName: "Night Server" } }), { reply: "Connected #news to Night Club. Publish automatically." });
  const rows = await connectors(t);
  assert.equal(rows.length, 2);
  const { communityProfileId: community, kind, direction, mode, authorityUserId: authority, target, state } = rows[0];
  assert.deepEqual({ community, kind, direction, mode, authority, target, state }, { community: communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", authority: authorityUserId, target: { guildId: GUILD, guildName: "Night Server", channelId: CHANNEL, channelName: "announcements" }, state: "active" });
  const links = await t.run(ctx => ctx.db.query("profileExternalLinks").collect());
  assert.equal(links.length, 1);
  assert.equal(links[0].assetType, "discord_guild"); assert.equal(links[0].assetExternalId, GUILD);
  // linkProfileToAsset promotes a community's only guild link to primary.
  assert.equal(links[0].linkRole, "primary"); assert.equal(links[0].linkedByUserId, authorityUserId);
  assert.equal(links[0].verifiedByProofId, undefined);
});

it("adds a second guild as a secondary link beside the primary", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await clearConnectors(t);
  await linkDiscord(t, authorityUserId);
  const primary = "100000000000000009";
  await t.run(ctx => ctx.db.insert("profileExternalLinks", { provenance: "control_association", profileId: communityProfileId, assetType: "discord_guild", assetExternalId: primary, linkRole: "primary", state: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  await command(t);
  const links = await t.run(ctx => ctx.db.query("profileExternalLinks").collect());
  assert.deepEqual(Object.fromEntries(links.map(link => [link.assetExternalId, link.linkRole])), { [primary]: "primary", [GUILD]: "secondary" });
});

it("refuses a channel another community holds and leaves it alone", async () => {
  const { t, authorityUserId, communityProfileId, connectorId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const otherId = await seedCommunity(t, { slug: "other-club", displayName: "Other Club" });
  await t.run(ctx => ctx.db.insert("profileOwners", { profileId: otherId, userId: authorityUserId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() }));
  assert.deepEqual(await command(t, { options: { community: "other-club", mode: "autopublish", channelName: "announcements", guildName: "Night Server" } }), denied);
  assert.equal((await connectors(t)).length, 1);
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector?.communityProfileId, communityProfileId);
  assert.equal(connector?.mode, "hold");
});

it("reconnecting updates the channel's connector in place, takes authority, and lifts a pause", async () => {
  const { t, authorityUserId, connectorId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const previous = await t.run(ctx => ctx.db.insert("users", { clerkUserId: newClerkUserId() }));
  await t.run(ctx => ctx.db.patch(connectorId, { state: "paused", lastError: "authority_lost", direction: "off", authorityUserId: previous, quietWindowSeconds: 90 }));
  assert.deepEqual(await command(t, { options: { community: "night-club", mode: "autopublish", channelName: "renamed", guildName: "New Name" } }), { reply: "Connected #renamed to Night Club. Publish automatically." });
  const rows = await connectors(t);
  assert.equal(rows.length, 1);
  const { mode, state, direction, lastError, target, authorityUserId: authority, quietWindowSeconds } = rows[0];
  assert.deepEqual({ mode, state, direction, lastError, target, authority, quietWindowSeconds }, {
    mode: "autopublish", state: "active", direction: "import", lastError: undefined, authority: authorityUserId, quietWindowSeconds: 90,
    target: { guildId: GUILD, guildName: "New Name", channelId: CHANNEL, channelName: "renamed" },
  });
});

it("clamps the quiet_window option to 30..600 seconds", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const quiet = async (value: number) => {
    await command(t, { options: { community: "night-club", mode: "hold", channelName: "announcements", guildName: "Night Server", quiet_window: value } });
    return (await connectors(t))[0].quietWindowSeconds;
  };
  assert.equal(await quiet(5), 30);
  assert.equal(await quiet(9999), 600);
  assert.equal(await quiet(90), 90);
});

it("will not connect while the connectors flag is off", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await clearConnectors(t);
  await linkDiscord(t, authorityUserId);
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "false";
  await assert.rejects(command(t), /CONNECTORS_DISABLED/);
  assert.equal((await connectors(t)).length, 0);
});

it("disconnects and reports status with the spec replies", async () => {
  const { t, authorityUserId, connectorId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const options = { channelName: "announcements" };
  assert.deepEqual(await command(t, { command: "status", options }), { reply: "Connected #announcements to Night Club. Hold for review." });
  await t.run(ctx => ctx.db.patch(connectorId, { state: "paused" }));
  assert.deepEqual(await command(t, { command: "status", options }), { reply: "Connected #announcements to Night Club. Hold for review. Paused." });
  assert.deepEqual(await command(t, { command: "disconnect", options }), { reply: "Disconnected #announcements." });
  assert.equal((await connectors(t))[0].state, "removed");
  assert.deepEqual(await command(t, { command: "status", options }), { reply: "Not connected." });
  assert.deepEqual(await command(t, { command: "disconnect", options }), { reply: "Not connected." });
});

it("status ignores a connector in another guild", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  assert.deepEqual(await command(t, { command: "status", guildId: "100000000000000009", options: { channelName: "announcements" } }), { reply: "Not connected." });
});

it("refuses status and disconnect without Manage Server, and disconnect without community authority", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  const options = { channelName: "announcements" };
  assert.deepEqual(await command(t, { command: "status", options, invokerHasManageGuild: false }), denied);
  assert.deepEqual(await command(t, { command: "disconnect", options, invokerHasManageGuild: false }), denied);
  await revokeManageIntegrations(t, communityProfileId, authorityUserId);
  assert.deepEqual(await command(t, { command: "disconnect", options }), denied);
  assert.equal((await connectors(t))[0].state, "active");
});

it("resolves both of the connector's failure alerts on disconnect", async () => {
  const { t, authorityUserId, connectorId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await t.run(async ctx => { for (const key of [`discord-intake:${connectorId}`, `connector-failures:${connectorId}`]) await ctx.db.insert("opsAlerts", { key, lastSentAt: 1 }); });
  await command(t, { command: "disconnect", options: { channelName: "announcements" } });
  assert.ok((await t.run(ctx => ctx.db.query("opsAlerts").collect())).every(row => row.resolvedAt));
});

it("autocompletes only communities the invoker may manage", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await seedCommunity(t, { slug: "other-club", displayName: "Other Club" }); // no grant
  assert.deepEqual(await command(t, { command: "autocomplete", options: { query: "club" } }), { choices: [{ name: "Night Club", value: "night-club" }] });
  assert.deepEqual(await command(t, { command: "autocomplete", options: { query: "NIGHT" } }), { choices: [{ name: "Night Club", value: "night-club" }] });
  assert.deepEqual(await command(t, { command: "autocomplete", options: { query: "nope" } }), { choices: [] });
});

it("autocompletes owned communities, skips owned people, and caps at 25", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await t.run(async ctx => {
    const now = Date.now();
    const own = (profileId: Id<"profiles">) => ctx.db.insert("profileOwners", { profileId, userId: authorityUserId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    for (let index = 0; index < 30; index++) await own(await seedCommunityRow(ctx, `owned-${index}`));
    await own(await ctx.db.insert("profiles", { ...person, slug: "owned-person", displayName: "Owned Person", updatedAt: now }));
  });
  const { choices } = await command(t, { command: "autocomplete", options: { query: "owned" } }) as { choices: Array<{ value: string }> };
  assert.equal(choices.length, 25);
  assert.ok(!choices.some(choice => choice.value === "owned-person"));
});

it("autocompletes a super admin through public search with names cut to 100 characters", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await linkDiscord(t, authorityUserId);
  await t.run(ctx => ctx.db.insert("accountFeatureGrants", { userId: authorityUserId, feature: "super_admin", state: "active", grantedBy: { tokenIdentifier: "test|root", issuer: "test", subject: "root" }, grantedAt: Date.now(), updatedAt: Date.now() }));
  const longName = "Other Club ".repeat(12).trim();
  const otherId = await seedCommunity(t, { slug: "other-club", displayName: longName });
  await t.run(async ctx => reindexProfileSearchDocument(ctx.db, (await ctx.db.get(otherId))!, Date.now()));
  assert.deepEqual(await command(t, { command: "autocomplete", options: { query: "other" } }), { choices: [{ name: longName.slice(0, 100), value: "other-club" }] });
});

it("only the command or the site flow creates a discord_announcements connector", async () => {
  const f = await connectorFixture();
  const target = { guildId: GUILD, channelId: CHANNEL };
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", target }), /CONNECTOR_KIND_RESERVED/);
});
