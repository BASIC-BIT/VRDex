import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest } from "convex-test";
import { decryptSecret } from "../../convex/_connectorCrypto";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import type { Doc } from "../../convex/_generated/dataModel";
import type { GoogleEventBody } from "../../convex/_googleCalendar";
import { fieldsFromGoogleEvent } from "../../convex/eventSyncKinds/googleCalendar";
import { EVENT_URL, fakeFetch, googleItem, modules, NOW, schema, seedEvent, seedGoogleConnector, runSyncJob, setupEnv, SITE } from "./_googleCalendarFixture";

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

describe("google calendar mapping and export", () => {
  beforeEach(setupEnv);

  // Export through the runner; the fake echoes the sent body the way Google returns it.
  async function exportAndEcho(overrides: Partial<Doc<"events">> = {}) {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    const fake = fakeFetch(({ method, body }) => method === "GET"
      ? Response.json({ items: [], timeZone: "America/New_York" })
      : Response.json({ ...googleItem({ id: "created-1" }), ...(body as object), updated: "2026-11-02T12:00:01.000Z" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    const body = fake.calls.find((c) => c.method === "POST")!.body as GoogleEventBody;
    const echoed = fieldsFromGoogleEvent({ ...googleItem({ id: "created-1" }), ...body }, "America/New_York", SITE);
    return { t, link, body, echoed };
  }

  // A linked export: the event already has a Google copy g1.
  async function linkedExport(overrides: Partial<Doc<"events">>, respond: Parameters<typeof fakeFetch>[0], linkState: Doc<"eventSyncLinks">["state"] = "linked") {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: linkState, createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(respond);
    const job = await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const link = (await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).unique()))!;
    return { job, link, calls: fake.calls };
  }

  it("round-trips a timed event to the runner's stored hash", async () => {
    const { link, echoed } = await exportAndEcho();
    assert.ok(link.lastExportedHash);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips an event with no end", async () => {
    const { link, body, echoed } = await exportAndEcho({ endAt: undefined });
    assert.deepEqual(body.end, body.start);
    assert.equal(echoed.end, null);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips a date-only event", async () => {
    const { link, body, echoed } = await exportAndEcho({ scheduleKind: "date_only", startAt: undefined, endAt: undefined });
    assert.deepEqual(body.start, { date: "2026-11-07" });
    assert.deepEqual(body.end, { date: "2026-11-08" });
    assert.equal(echoed.timeTba, true);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("exports only carried fields and ends the description with the event URL", async () => {
    const { link, body } = await exportAndEcho({ posterImageUrl: "/poster.png" });
    assert.deepEqual(Object.keys(body).sort(), ["description", "end", "location", "start", "status", "summary"]);
    assert.equal(body.summary, "Bass Temple");
    assert.equal(body.location, "The Temple");
    assert.equal(body.status, "confirmed");
    assert.deepEqual(body.start, { dateTime: "2026-11-08T01:00:00.000Z", timeZone: "America/New_York" });
    assert.equal(body.description.split("\n").at(-1), EVENT_URL);
    assert.equal(link.externalId, "created-1");
  });

  it("links a matching external item instead of creating a duplicate", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId);
    const fake = fakeFetch(({ method }) => method === "GET"
      ? Response.json({ items: [googleItem({ id: "existing-1", summary: "bass temple" })], timeZone: "UTC" })
      : Response.json(googleItem({ id: "existing-1" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0);
    assert.equal(fake.calls.find((c) => c.method === "PATCH")!.url.pathname, "/calendar/v3/calendars/cal-1/events/existing-1");
  });

  it("does not link a matching external item another link already holds", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const other = await seedEvent(t, communityProfileId, { title: "Other", slug: "other" });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: other, externalId: "existing-1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const eventId = await seedEvent(t, communityProfileId);
    const fake = fakeFetch(({ method }) => method === "GET"
      ? Response.json({ items: [googleItem({ id: "existing-1" })], timeZone: "UTC" })
      : Response.json(googleItem({ id: "created-1" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET", "POST"]);
  });

  it("exports a cancelled VRDex event as status cancelled", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(() => Response.json(googleItem({ status: "cancelled" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    assert.equal((patch.body as GoogleEventBody).status, "cancelled");
  });

  it("switches a timed export to date-only", async () => {
    const { calls } = await linkedExport({ scheduleKind: "date_only", startAt: undefined, endAt: undefined }, () => Response.json(googleItem()));
    const patch = calls.find((c) => c.method === "PATCH")!.body as { start: Record<string, unknown>; end: Record<string, unknown> };
    assert.deepEqual(patch.start, { date: "2026-11-07", dateTime: null, timeZone: null });
    assert.deepEqual(patch.end, { date: "2026-11-08", dateTime: null, timeZone: null });
  });

  it("never recreates a copy the organiser deleted in Google", async () => {
    const { job, link, calls } = await linkedExport({}, () => Response.json(googleItem()), "external_deleted");
    assert.equal(calls.length, 0);
    assert.equal(job.state, "done");
    assert.deepEqual([link.externalId, link.state], ["g1", "external_deleted"]);
  });

  it("recreates a linked copy Google no longer has", async () => {
    const { job, link, calls } = await linkedExport({}, ({ method }) => method === "PATCH" ? new Response("", { status: 404 }) : Response.json(googleItem({ id: "created-2" })));
    assert.deepEqual(calls.map((c) => c.method), ["PATCH", "POST"]);
    assert.equal(job.state, "done");
    assert.equal(link.externalId, "created-2");
  });

  it("deletes on export_delete and treats 410 as done", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(() => new Response("", { status: 410 }));
    const job = await runSyncJob(t, { connectorId, kind: "export_delete", eventId });
    fake.restore();
    assert.equal(fake.calls[0].method, "DELETE");
    assert.equal(job.state, "done");
  });

  it("reads descriptions edited in Google's UI as plain text, and tolerates an item with no times", () => {
    const url = SITE + "/basic-nights/events/bass-temple-nov-7";
    const fields = fieldsFromGoogleEvent(googleItem({
      summary: "T".repeat(130),
      description: `Line one<br>Line &amp; two</p><p><b>bold</b>&nbsp;x &lt;3<br><br><a href="${url}">${url}</a>`,
    }), "UTC", SITE);
    assert.equal(fields.summary, "Line one\nLine & two\nbold x <3");
    assert.equal(fields.title, "T".repeat(120));
    const bare = fieldsFromGoogleEvent({ id: "g1", status: "cancelled", updated: "2026-11-02T11:00:00.000Z" }, "UTC", SITE);
    assert.deepEqual(bare, { title: null, eventDate: null, timeTba: null, timezone: null, start: null, end: null, venueLabel: null, summary: null });
  });
});
