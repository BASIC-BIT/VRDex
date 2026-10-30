import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { api } from "../../convex/_generated/api";
import { connectorFixture } from "./_eventConnectorFixture";

// Board rows are created below; create refuses the kind while its flag is off.
beforeEach(test => { test.mock.timers.enable({ apis: ["setTimeout"] }); process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED = "true"; });
afterEach(() => { delete process.env.VRDEX_CONNECTOR_DISCORD_BOARD_ENABLED; });
const google = { kind: "google_calendar" as const, direction: "bidirectional" as const, mode: "hold" as const, target: { calendarId: "club@example.com", calendarName: "Club nights" } };

it("create enqueues one reconcile job and lists the connector", async () => {
  const f = await connectorFixture();
  const connectorId = await f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google });
  const jobs = await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  assert.deepEqual(jobs.map(row => [row.connectorId, row.kind, row.state]), [[connectorId, "reconcile", "pending"]]);
  const listed = await f.as("integrator").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId });
  assert.equal(listed.enabled, true);
  assert.equal(listed.connectors[0].target.calendarName, "Club nights");
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.authorityUserId, f.users.integrator);
});

it("refuses a staffer without manage_integrations", async () => {
  const f = await connectorFixture();
  await assert.rejects(f.as("event-staff").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google }), /CONNECTOR_FORBIDDEN/);
  await assert.rejects(f.as("event-staff").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId }), /CONNECTOR_FORBIDDEN/);
});

it("validates kind, direction, Discord IDs, and uniqueness", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const create = (args: Record<string, unknown>) => as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, ...args } as never);
  await assert.rejects(create({ kind: "notion" }), /CONNECTOR_KIND_RESERVED/);
  const channel = { guildId: "123456789012345678", channelId: "223456789012345678" };
  await assert.rejects(create({ kind: "discord_board", direction: "import", target: channel }), /CONNECTOR_DIRECTION_INVALID/);
  await assert.rejects(create({ kind: "discord_announcements", direction: "export", target: channel }), /CONNECTOR_DIRECTION_INVALID/);
  await assert.rejects(create({ kind: "discord_board", direction: "export", target: { ...channel, guildId: "123" } }), /CONNECTOR_TARGET/);
  await create({});
  await assert.rejects(create({ target: { calendarId: "club@example.com", calendarName: "Renamed" } }), /CONNECTOR_EXISTS/);
});

it("each kind takes exactly its own target IDs", async () => {
  const f = await connectorFixture();
  const create = (kind: string, direction: string, target: Record<string, string>) =>
    f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind, direction, mode: "hold", target } as never);
  const guild = "123456789012345678";
  const channel = "223456789012345678";
  await assert.rejects(create("google_calendar", "export", {}), /CONNECTOR_TARGET/);
  await assert.rejects(create("google_calendar", "export", { calendarId: "club@example.com", guildId: guild }), /CONNECTOR_TARGET/);
  await assert.rejects(create("google_calendar", "export", { calendarId: "x".repeat(257) }), /CONNECTOR_TARGET/);
  await assert.rejects(create("discord_board", "export", { guildId: guild }), /CONNECTOR_TARGET/);
  await assert.rejects(create("discord_announcements", "import", { guildId: guild, channelId: channel, calendarId: "c" }), /CONNECTOR_TARGET/);
  await assert.rejects(create("discord_scheduled_events", "export", { guildId: guild, channelId: channel }), /CONNECTOR_TARGET/);
  await create("google_calendar", "export", { calendarId: "x".repeat(256) });
  await create("discord_scheduled_events", "export", { guildId: guild, guildName: "Club" });
});

it("refuses a profile that is not a community, even for a super admin", async () => {
  const f = await connectorFixture();
  const person = await f.t.run(ctx => ctx.db.insert("profiles", { slug: "someone", displayName: "Someone", sortName: "someone", profileType: "person", person: { roleTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() }));
  await assert.rejects(f.as("admin").mutation(api.eventConnectors.create, { communityProfileId: person, ...google }), /CONNECTOR_FORBIDDEN/);
  await f.as("admin").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google });
});

it("changing a live direction to another non-off direction reconciles", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const connectorId = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, direction: "import" });
  const reconciles = async () => (await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).filter(row => row.kind === "reconcile").length;
  assert.equal(await reconciles(), 1);
  await as.mutation(api.eventConnectors.update, { connectorId, direction: "bidirectional" });
  assert.equal(await reconciles(), 2);
  await as.mutation(api.eventConnectors.update, { connectorId, direction: "bidirectional", mode: "autopublish" });
  await as.mutation(api.eventConnectors.update, { connectorId, direction: "off" });
  assert.equal(await reconciles(), 2);
});

it("state active resumes a paused connector under the caller and never clears needs_reauth", async () => {
  const f = await connectorFixture();
  const paused = await f.insertConnector({ state: "paused", lastError: "authority_lost", authorityUserId: f.users.owner });
  await assert.rejects(f.as("event-staff").mutation(api.eventConnectors.update, { connectorId: paused, state: "active" }), /CONNECTOR_FORBIDDEN/);
  await f.as("integrator").mutation(api.eventConnectors.update, { connectorId: paused, state: "active" });
  const resumed = (await f.t.run(ctx => ctx.db.get(paused)))!;
  assert.deepEqual([resumed.state, resumed.authorityUserId, resumed.lastError], ["active", f.users.integrator, undefined]);
  assert.deepEqual((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).map(row => [row.connectorId, row.kind]), [[paused, "reconcile"]]);
  const reauth = await f.insertConnector({ state: "needs_reauth", target: { calendarId: "other" } });
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.update, { connectorId: reauth, state: "active" }), /CONNECTOR_RESUME_INVALID/);
  assert.equal((await f.t.run(ctx => ctx.db.get(reauth)))!.state, "needs_reauth");
});

it("update enforces the kind's allowed directions", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  // A board needs the staffer's proof of its guild.
  await f.t.run(ctx => ctx.db.insert("externalControlProofs", { userId: f.users.integrator, assetType: "discord_guild", assetExternalId: "123456789012345678", controlLevel: "manager", state: "active", evidenceSource: "discord_oauth", verifiedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }));
  const board = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind: "discord_board", direction: "export", mode: "hold", target: { guildId: "123456789012345678", channelId: "223456789012345678" } });
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId: board, direction: "bidirectional" }), /CONNECTOR_DIRECTION_INVALID/);
  const intake = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", target: { guildId: "123456789012345678", channelId: "323456789012345678" } });
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId: intake, direction: "export" }), /CONNECTOR_DIRECTION_INVALID/);
  await as.mutation(api.eventConnectors.update, { connectorId: intake, direction: "off" });
});

it("create refuses a credential owned by someone else", async () => {
  const f = await connectorFixture();
  const credential = (ownerUserId: typeof f.users.owner) => f.t.run(ctx => ctx.db.insert("connectorCredentials", { provider: "google", ownerUserId, encryptedAccessToken: "v1:a:b:c", encryptedRefreshToken: "v1:a:b:c", accessTokenExpiresAt: Date.now() + 3_600_000, scopes: [], externalAccountId: "sub-1", state: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  const others = await credential(f.users.owner);
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, credentialId: others }), /CONNECTOR_CREDENTIAL/);
  const mine = await credential(f.users.integrator);
  await f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, credentialId: mine });
});

it("update re-enables with a reconcile and remove hides the connector", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  const connectorId = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, direction: "off" });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 0);
  await as.mutation(api.eventConnectors.update, { connectorId, direction: "export" });
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect())).length, 1);
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId, quietWindowSeconds: 10 }), /CONNECTOR_QUIET_WINDOW/);
  await as.mutation(api.eventConnectors.remove, { connectorId });
  assert.equal((await as.query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId })).connectors.length, 0);
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.state, "removed");
});

it("the flag hides the list and blocks creation", async () => {
  const f = await connectorFixture({ flag: false });
  assert.deepEqual(await f.as("integrator").query(api.eventConnectors.listForCommunity, { communityProfileId: f.communityProfileId }), { enabled: false, connectors: [] });
  await assert.rejects(f.as("integrator").mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google }), /CONNECTORS_DISABLED/);
});

it("caps display names and refuses changes to a removed connector", async () => {
  const f = await connectorFixture();
  const as = f.as("integrator");
  await assert.rejects(as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google, target: { calendarId: "long", calendarName: "x".repeat(101) } }), /CONNECTOR_TARGET/);
  const connectorId = await as.mutation(api.eventConnectors.create, { communityProfileId: f.communityProfileId, ...google });
  await assert.rejects(f.as("outsider").mutation(api.eventConnectors.remove, { connectorId }), /CONNECTOR_FORBIDDEN/);
  await as.mutation(api.eventConnectors.remove, { connectorId });
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId, mode: "autopublish" }), /CONNECTOR_REMOVED/);
  await assert.rejects(as.mutation(api.eventConnectors.update, { connectorId, state: "active" }), /CONNECTOR_RESUME_INVALID/);
});
