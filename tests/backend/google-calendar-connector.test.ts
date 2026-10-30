import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest } from "convex-test";
import { decryptSecret } from "../../convex/_connectorCrypto";
import { fakeFetch, modules, NOW, schema, seedGoogleConnector, runSyncJob, setupEnv } from "./_googleCalendarFixture";

describe("staging import removal", () => {
  it("drops the callerless calendar staging tables", () => {
    for (const table of ["eventImportBatches", "eventImportCandidates", "eventImportCandidateFields"]) {
      assert.equal(table in schema.tables, false, table);
    }
  });
});

describe("withGoogleToken", () => {
  beforeEach(setupEnv);
  const page = () => Response.json({ items: [], nextSyncToken: "sync-1", timeZone: "America/New_York" });

  it("refreshes once on 401, stores the new token, and retries", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url, authorization }) => {
      if (url.href === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "new-access", expires_in: 1800 });
      return authorization === "Bearer old-access" ? new Response("", { status: 401 }) : page();
    });
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.authorization ?? c.url.pathname), ["Bearer old-access", "/token", "Bearer new-access"]);
    const credential = await t.run((ctx) => ctx.db.get(credentialId));
    assert.equal(await decryptSecret(credential!.encryptedAccessToken), "new-access");
    assert.equal(credential!.accessTokenExpiresAt, NOW + 1_800_000);
  });

  it("refresh refused sets needs_reauth and does not retry again", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token"
      ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : new Response("", { status: 401 }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.url.pathname === "/token").length, 1);
    assert.equal(fake.calls.length, 2);
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.equal(connector.state, "needs_reauth");
    assert.equal(connector.lastError, "GOOGLE_REAUTH_REQUIRED");
  });

  it("a second 401 after a successful refresh fails the job without another refresh", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token"
      ? Response.json({ access_token: "new-access", expires_in: 3600 })
      : new Response("", { status: 401 }));
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 3);
    assert.notEqual(job.state, "done");
    assert.equal(job.lastError, "GOOGLE_API_401");
  });

  it("transient refresh failure keeps the connector active", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? new Response("", { status: 503 }) : new Response("", { status: 401 }));
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.authorization ?? c.url.pathname), ["Bearer old-access", "/token"]);
    assert.equal(job.lastError, "GOOGLE_TOKEN_503");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.state, "active");
  });

  it("a refused client is an operator fault: the connector stays active", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? Response.json({ error: "invalid_client" }, { status: 401 }) : new Response("", { status: 401 }));
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(job.lastError, "GOOGLE_TOKEN_401");
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.deepEqual([connector.state, connector.lastError], ["active", undefined]);
  });

  it("a revoked credential parks the connector without calling Google", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    await t.run((ctx) => ctx.db.patch(credentialId, { state: "revoked" }));
    const fake = fakeFetch(() => page());
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal(job.lastError, "GOOGLE_REAUTH_REQUIRED");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.state, "needs_reauth");
  });

  it("refreshes before the call when the stored token has expired", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    await t.run((ctx) => ctx.db.patch(credentialId, { accessTokenExpiresAt: NOW - 1 }));
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? Response.json({ access_token: "new-access", expires_in: 3600 }) : page());
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.authorization ?? c.url.pathname), ["/token", "Bearer new-access"]);
  });

  it("does nothing when the kind flag is off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "false";
    const fake = fakeFetch(() => page());
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.notEqual(job.state, "done");
    assert.equal(job.lastError, "CONNECTOR_KIND_DISABLED");
  });

  it("an unreadable stored token fails with a code and leaves the connector alone", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    process.env.VRDEX_CONNECTOR_TOKEN_KEY = "B".repeat(43) + "=";
    const fake = fakeFetch(() => page());
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal(job.lastError, "CONNECTOR_CREDENTIAL_UNREADABLE");
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.deepEqual([connector.state, connector.lastError], ["active", undefined]);
  });

  it("marks every live connector on the refused credential, and only those", async () => {
    const t = convexTest({ schema, modules });
    const first = await seedGoogleConnector(t, { direction: "import" });
    const other = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-2" } });
    const sibling = await t.run((ctx) => ctx.db.insert("eventConnectors", {
      communityProfileId: first.communityProfileId, kind: "google_calendar", direction: "export", mode: "hold", authorityUserId: first.staffUserId,
      credentialId: first.credentialId, target: { calendarId: "cal-3" }, state: "active", createdAt: NOW, updatedAt: NOW,
    }));
    const fake = fakeFetch(({ url }) => url.pathname === "/token" ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("", { status: 401 }));
    await runSyncJob(t, { connectorId: first.connectorId, kind: "import_poll" });
    fake.restore();
    const states = await t.run(async (ctx) => Promise.all([first.connectorId, sibling, other.connectorId].map(async (id) => (await ctx.db.get(id))!.state)));
    assert.deepEqual(states, ["needs_reauth", "needs_reauth", "active"]);
  });
});
