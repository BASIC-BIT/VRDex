import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";
import { decryptSecret } from "../../convex/_connectorCrypto";
import { candidateFromConnectorFields } from "../../convex/_eventCandidateApply";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { reportStaleWatches, watchChannelToken, type GoogleCalendarEvent, type GoogleEventBody, type OpsAlert } from "../../convex/_googleCalendar";
import { correctionFields } from "../../convex/eventCorrections";
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
    assert.deepEqual(calls.map((c) => c.method), ["GET", "PATCH", "POST"]);
    assert.equal(job.state, "done");
    assert.equal(link.externalId, "created-2");
  });

  it("recreates a linked copy the read-back cannot find", async () => {
    for (const status of [404, 410]) {
      const { link, calls } = await linkedExport({}, ({ method }) => method === "GET" ? new Response("", { status }) : Response.json(googleItem({ id: "created-2" })));
      assert.deepEqual(calls.map((c) => c.method), ["GET", "POST"]);
      assert.equal(link.externalId, "created-2");
    }
  });

  const patchOf = (calls: Array<{ method: string; body: unknown }>) => calls.find((c) => c.method === "PATCH")!.body as Record<string, unknown>;
  const rich = "x".repeat(500);

  it("keeps Google's longer description and location on a re-export of an unchanged event", async () => {
    const item = googleItem({ description: rich, location: "V".repeat(150) });
    const { link, calls } = await linkedExport({ summary: "x".repeat(240), venueLabel: "V".repeat(120) }, () => Response.json(item));
    const patch = patchOf(calls);
    assert.equal(patch.description, `${rich}\n\n${EVENT_URL}`);
    assert.equal("location" in patch, false);
    const echoed = fieldsFromGoogleEvent({ ...item, ...patch } as GoogleCalendarEvent, "America/New_York", SITE);
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("keeps Google's longer title until VRDex changes it", async () => {
    const item = googleItem({ summary: "T".repeat(150) });
    const unchanged = patchOf((await linkedExport({ title: "T".repeat(120) }, () => Response.json(item))).calls);
    assert.equal("summary" in unchanged, false);
    const renamed = patchOf((await linkedExport({ title: "A New Title" }, () => Response.json(item))).calls);
    assert.equal(renamed.summary, "A New Title");
  });

  it("adopting an existing item keeps Google's richer values too", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, { summary: "x".repeat(240), venueLabel: "V".repeat(120) });
    const item = googleItem({ id: "existing-1", description: rich, location: "V".repeat(150) });
    const fake = fakeFetch(({ method }) => method === "GET" ? Response.json({ items: [item], timeZone: "UTC" }) : Response.json(item));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET", "PATCH"]);
    const patch = patchOf(fake.calls);
    assert.equal(patch.description, `${rich}\n\n${EVENT_URL}`);
    assert.equal((patch.description as string).split(EVENT_URL).length, 2);
    assert.equal("location" in patch, false);
    assert.equal(fake.calls[0].url.searchParams.has("showDeleted"), false);
  });

  it("leaves a description that already ends with the event URL as it is", async () => {
    const description = `<p>${rich}</p><br><a href="${EVENT_URL}">${EVENT_URL}</a>`;
    const { calls } = await linkedExport({ summary: "x".repeat(240) }, () => Response.json(googleItem({ description })));
    assert.equal(patchOf(calls).description, description);
  });

  it("a VRDex summary edit overwrites the description, and a venue edit the location", async () => {
    const { calls } = await linkedExport({ summary: "A new summary.", venueLabel: "New Hall" }, () => Response.json(googleItem({ description: rich })));
    assert.equal(patchOf(calls).description, `A new summary.\n\n${EVENT_URL}`);
    assert.equal(patchOf(calls).location, "New Hall");
  });

  it("keeps a three-day all-day item's end, until VRDex moves the date", async () => {
    const days = googleItem({ start: { date: "2026-11-07" }, end: { date: "2026-11-10" } });
    const dateOnly = { scheduleKind: "date_only" as const, startAt: undefined, endAt: undefined };
    const unchanged = patchOf((await linkedExport(dateOnly, () => Response.json(days))).calls);
    assert.deepEqual(["start" in unchanged, "end" in unchanged], [false, false]);
    const moved = patchOf((await linkedExport({ ...dateOnly, eventDate: "2026-11-08" }, () => Response.json(days))).calls);
    assert.deepEqual(moved.end, { date: "2026-11-09", dateTime: null, timeZone: null });
  });

  it("round-trips an event in the fall-back hour", async () => {
    const { link, echoed } = await exportAndEcho({ eventDate: "2026-11-01", startAt: Date.parse("2026-11-01T06:30:00.000Z"), endAt: Date.parse("2026-11-01T09:00:00.000Z") });
    assert.deepEqual(echoed.start, { time: "01:30", occurrence: "later" });
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips an overnight event", async () => {
    const { link, echoed } = await exportAndEcho({ startAt: Date.parse("2026-11-08T03:00:00.000Z"), endAt: Date.parse("2026-11-08T06:00:00.000Z") });
    assert.deepEqual(echoed.end, { time: "01:00", dayOffset: 1 });
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  it("round-trips a plain-text summary with angle brackets and entities unchanged", async () => {
    const { link, echoed } = await exportAndEcho({ summary: "a < b > c &amp; d" });
    assert.equal(echoed.summary, "a < b > c &amp; d");
    assert.equal(carriedFieldsHash("google_calendar", echoed), link.lastExportedHash);
  });

  // Dedupe export: the calendar holds one candidate item; returns the methods called.
  async function dedupeExport(overrides: Partial<Doc<"events">>, item: GoogleCalendarEvent) {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    const fake = fakeFetch(({ method }) => method === "GET" ? Response.json({ items: [item], timeZone: "UTC" }) : Response.json(googleItem({ id: item.id })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    return fake.calls.map((c) => `${c.method} ${c.url.pathname.split("/").at(-1)}`);
  }

  it("matches an external item by its date in the event's timezone", async () => {
    const calls = await dedupeExport({}, googleItem({ id: "existing-1", start: { dateTime: "2026-11-08T01:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-11-08T04:00:00Z", timeZone: "UTC" } }));
    assert.deepEqual(calls, ["GET events", "PATCH existing-1"]);
  });

  it("matches an external item whose title runs past the cap", async () => {
    const calls = await dedupeExport({ title: "A".repeat(125) }, googleItem({ id: "existing-1", summary: "a".repeat(125) }));
    assert.deepEqual(calls, ["GET events", "PATCH existing-1"]);
  });

  it("does not adopt a private or confidential item of the same date and title", async () => {
    for (const visibility of ["private", "confidential"] as const) {
      assert.deepEqual(await dedupeExport({}, googleItem({ id: "existing-1", visibility })), ["GET events", "POST events"]);
    }
  });

  it("adopts an external item held only by an import draft", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    await t.run(async (ctx) => {
      const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: staffUserId, connectorId, version: 1, fields: { title: "Held" }, provenance: [], createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 86_400_000 });
      await ctx.db.insert("eventSyncLinks", { connectorId, draftId, externalId: "existing-1", state: "linked", createdAt: NOW, updatedAt: NOW });
    });
    const eventId = await seedEvent(t, communityProfileId);
    const fake = fakeFetch(({ method }) => method === "GET"
      ? Response.json({ items: [googleItem({ id: "existing-1" })], timeZone: "UTC" })
      : Response.json(googleItem({ id: "existing-1" })));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET", "PATCH"]);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", (q) => q.eq("connectorId", connectorId).eq("externalId", "existing-1")).collect());
    assert.deepEqual(links.map((link) => link.eventId), [eventId]);
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

  it("leaves no tag behind from nested markup", () => {
    const fields = fieldsFromGoogleEvent(googleItem({ description: "Doors<br><<b>script>alert(1)<</b>/script>" }), "UTC", SITE);
    assert.doesNotMatch(fields.summary!, /<[^>]*>/);
    assert.equal(fields.summary, "Doors\nscript>alert(1)/script>");
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

describe("google calendar import", () => {
  beforeEach(setupEnv);
  const importItem = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: GoogleCalendarEvent) =>
    runSyncJob(t, { connectorId, kind: "import_item", payload: { item, calendarTimeZone: "America/New_York" } });

  const applyImport = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: GoogleCalendarEvent) =>
    t.mutation(internal.googleCalendarConnector.applyImport, { connectorId, item, calendarTimeZone: "America/New_York" });

  it("ignores its own export coming back", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", lastExportedHash: carriedFieldsHash("google_calendar", fieldsFromGoogleEvent(googleItem(), "America/New_York", SITE)), createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ updated: "2026-11-02T11:59:59.000Z" })), "skipped_echo");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.updatedAt, event.updatedAt);
  });

  it("bidirectional: a newer external edit wins", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { updatedAt: NOW - 60_000 });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Late", updated: "2026-11-02T11:59:59.000Z" })), "updated");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, "Bass Temple Late");
  });

  it("bidirectional: a newer VRDex edit wins and the link records the external time", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { updatedAt: NOW });
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Late", updated: "2026-11-02T11:00:00.000Z" })), "skipped_stale");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, "Bass Temple");
    assert.equal((await t.run((ctx) => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.externalUpdatedAt, Date.parse("2026-11-02T11:00:00.000Z"));
  });

  it("flags, never cancels, on an inbound cancellation", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    await importItem(t, connectorId, googleItem({ status: "cancelled", updated: "2026-11-02T11:59:59.000Z" }));
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "external_deleted");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.eventStatus, "scheduled");
  });

  it("ignores the inbound echo of a VRDex cancellation", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal((await importItem(t, connectorId, googleItem({ status: "cancelled", updated: "2026-11-02T11:59:59.000Z" }))).state, "done");
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
  });

  it("skips past items and recurring instances beyond 60 days", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    const past = await importItem(t, connectorId, googleItem({ id: "past", start: { dateTime: "2026-10-30T20:00:00-04:00" }, end: { dateTime: "2026-10-30T23:00:00-04:00" } }));
    const far = await importItem(t, connectorId, googleItem({ id: "far", recurringEventId: "series-1", start: { dateTime: "2027-01-08T20:00:00-05:00" }, end: { dateTime: "2027-01-08T23:00:00-05:00" } }));
    assert.deepEqual([past.state, far.state], ["done", "done"]);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
  });

  it("reconcile links by date and title without creating", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const other = googleItem({ id: "g2", summary: "Other Night", start: { dateTime: "2026-11-08T20:00:00-05:00" }, end: { dateTime: "2026-11-08T23:00:00-05:00" } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [googleItem({ summary: "BASS TEMPLE" }), other], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId]), [["g1", eventId]]);
    assert.equal((await t.run((ctx) => ctx.db.query("events").collect())).length, 1);
    const jobs = await t.run((ctx) => ctx.db.query("eventSyncJobs").collect());
    assert.deepEqual(jobs.filter((j) => j.kind === "import_item").map((j) => (j.payload as { item: GoogleCalendarEvent }).item.id), ["g2"]);
    const target = (await t.run((ctx) => ctx.db.get(connectorId)))!.target;
    assert.deepEqual([target.watchResourceId, target.watchExpiresAt, target.watchRenewedAt], ["res-1", NOW + 604_800_000, NOW]);
    assert.ok(target.watchChannelId);
  });

  // Ruling C1: the runner's generic step queues both before the kind links `matched`.
  it("a rejected watch does not fail a reconcile whose imports committed", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? new Response("", { status: 500 })
      : Response.json({ items: [googleItem()], timeZone: "America/New_York" }));
    const job = await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    assert.equal(job.state, "done");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.target.watchChannelId, undefined);
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).some((j) => j.kind === "import_item"));
  });

  it("a bad item goes to its own job and the sync token still moves", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", syncToken: "tok-0" } });
    const eventId = await seedEvent(t, communityProfileId);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const zone = "Customized Time Zone";
    const badZone = googleItem({ id: "g-tz", start: { dateTime: "2026-11-09T20:00:00-05:00", timeZone: zone }, end: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone } });
    const badTitle = googleItem({ summary: "X", updated: "2026-11-02T11:59:59.000Z" });
    const good = googleItem({ id: "g2", summary: "Fresh Night", start: { dateTime: "2026-11-10T20:00:00-05:00" }, end: { dateTime: "2026-11-10T23:00:00-05:00" } });
    const fake = fakeFetch(() => Response.json({ items: [badZone, badTitle, good], nextSyncToken: "tok-1", timeZone: "America/New_York" }));
    const poll = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(poll.state, "done");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.target.syncToken, "tok-1");
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).some((link) => link.externalId === "g2"));
    const queued = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((job) => job.kind === "import_item");
    assert.deepEqual(queued.map((job) => [job.state, job.payload]), [["pending", { item: badZone, calendarTimeZone: "America/New_York" }], ["pending", { item: badTitle, calendarTimeZone: "America/New_York" }]]);
    await t.action(internal.eventSync.runJob, { jobId: queued[0]._id });
    const retried = (await t.run((ctx) => ctx.db.get(queued[0]._id)))!;
    assert.deepEqual([retried.state, retried.attempts], ["pending", 1]);
  });

  it("an item the mapper cannot read does not fail a reconcile, and gets no job", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const zone = "Customized Time Zone";
    const bad = googleItem({ id: "g-tz", start: { dateTime: "2026-11-09T20:00:00-05:00", timeZone: zone }, end: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone } });
    const good = googleItem({ id: "g2", summary: "Fresh Night", start: { dateTime: "2026-11-10T20:00:00-05:00" }, end: { dateTime: "2026-11-10T23:00:00-05:00" } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [bad, good], timeZone: "America/New_York" }));
    const job = await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    assert.equal(job.state, "done");
    const jobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_item");
    assert.deepEqual(jobs.map((j) => (j.payload as { item: GoogleCalendarEvent }).item.id), ["g2"]);
  });

  it("reconcile fails on a missing SITE_URL instead of reading it as an unreadable item", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    delete process.env.SITE_URL;
    const fake = fakeFetch(() => Response.json({ items: [googleItem()], timeZone: "America/New_York" }));
    const job = await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    assert.notEqual(job.state, "done");
    assert.match(job.lastError ?? "", /SITE_URL_MISSING/);
  });

  it("reconcile never links a private or confidential item to a public event", async () => {
    for (const visibility of ["private", "confidential"] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
      await seedEvent(t, communityProfileId);
      const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
        ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
        : Response.json({ items: [googleItem({ visibility })], timeZone: "America/New_York" }));
      await runSyncJob(t, { connectorId, kind: "reconcile" });
      fake.restore();
      assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
      assert.equal((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_item").length, 0);
    }
  });

  it("reconcile queues only what the import window allows", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const instance = (id: string, date: string) => googleItem({ id, summary: "Club Night", recurringEventId: "series-1", start: { dateTime: `${date}T20:00:00-05:00` }, end: { dateTime: `${date}T23:00:00-05:00` } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [instance("near", "2026-12-30"), instance("far", "2027-01-20")], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const jobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_item");
    assert.deepEqual(jobs.map((j) => (j.payload as { item: GoogleCalendarEvent }).item.id), ["near"]);
  });

  it("never imports private or confidential items, and still flags their cancellation", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import", mode: "hold", target: { calendarId: "cal-1", syncToken: "tok-0" } });
    const day = (date: string) => ({ start: { dateTime: `${date}T20:00:00-05:00` }, end: { dateTime: `${date}T23:00:00-05:00` } });
    const items = [
      googleItem({ id: "g-private", visibility: "private", summary: "Dentist", ...day("2026-11-09") }),
      googleItem({ id: "g-confidential", visibility: "confidential", summary: "Therapy", ...day("2026-11-10") }),
      googleItem({ id: "g-public", visibility: "public", summary: "Club Night", ...day("2026-11-11") }),
    ];
    const fake = fakeFetch(() => Response.json({ items, nextSyncToken: "tok-1", timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).map((link) => link.externalId), ["g-public"]);
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ status: "cancelled", visibility: "private", updated: "2026-11-02T11:59:59.000Z" })), "flagged");
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "external_deleted");
  });

  it("does not link a Google item to an event that is not public", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [googleItem()], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).some((j) => j.kind === "import_item"));
  });

  it("flags a cancelled held item, and a restored one goes back behind its draft", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const linkId = await t.run(async (ctx) => {
      const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: staffUserId, connectorId, version: 1, fields: { title: "Held" }, provenance: [], createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 86_400_000 });
      return await ctx.db.insert("eventSyncLinks", { connectorId, draftId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW });
    });
    assert.equal(await applyImport(t, connectorId, googleItem({ status: "cancelled" })), "flagged");
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "external_deleted");
    assert.equal(await applyImport(t, connectorId, googleItem({ updated: "2026-11-02T11:30:00.000Z" })), "skipped_pending_draft");
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
  });

  const staff = (t: TestConvex<typeof schema>) => t.withIdentity({ subject: "staff", issuer: "test", tokenIdentifier: "test|staff" });

  it("a dismissed item stays out until Google changes it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    assert.equal(await applyImport(t, connectorId, googleItem()), "draft");
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    await staff(t).mutation(api.eventIntakeHeld.dismiss, { draftId: link.draftId! });
    assert.equal(await applyImport(t, connectorId, googleItem()), "unchanged");
    assert.equal((await t.run((ctx) => ctx.db.get(link._id)))!.draftId, undefined);
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Late", updated: "2026-11-02T11:30:00.000Z" })), "draft");
    const refiled = (await t.run((ctx) => ctx.db.get(link._id)))!;
    assert.ok(refiled.draftId && refiled.draftId !== link.draftId);
    assert.equal((await staff(t).query(api.eventInventory.listHeldImports, {})).length, 1);
  });

  it("publishing a cancelled held item makes no second Google copy", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional", mode: "hold" });
    assert.equal(await applyImport(t, connectorId, googleItem()), "draft");
    assert.equal(await applyImport(t, connectorId, googleItem({ status: "cancelled", updated: "2026-11-02T11:30:00.000Z" })), "flagged");
    const [held] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    const { eventId } = await staff(t).mutation(api.eventIntakeHeld.publish, { draftId: held.draftId! });
    const job = await t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).find((row) => row.eventId === eventId && row.state === "pending")!);
    const fake = fakeFetch(() => new Response("", { status: 500 }));
    await t.action(internal.eventSync.runJob, { jobId: job._id });
    fake.restore();
    assert.deepEqual(fake.calls, []);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((link) => [link.externalId, link.state, link.eventId, link.draftId]), [["g1", "external_deleted", eventId, undefined]]);
    assert.deepEqual((await staff(t).query(api.eventInventory.listHeldImports, {})).map((row) => row.kind), ["flag"]);
  });

  it("a restored item relinks, and exports resume", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", {
      connectorId, eventId, externalId: "g1", state: "external_deleted", flagReviewedAt: NOW, externalUpdatedAt: Date.parse("2026-11-02T10:00:00.000Z"),
      lastExportedHash: carriedFieldsHash("google_calendar", fieldsFromGoogleEvent(googleItem(), "America/New_York", SITE)), createdAt: NOW, updatedAt: NOW,
    }));
    assert.equal(await applyImport(t, connectorId, googleItem({ updated: "2026-11-02T11:59:59.000Z" })), "skipped_echo");
    const restored = (await t.run((ctx) => ctx.db.get(linkId)))!;
    assert.deepEqual([restored.state, restored.flagReviewedAt], ["linked", undefined]);
    const fake = fakeFetch(() => Response.json(googleItem()));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    assert.ok(fake.calls.some((c) => c.method === "PATCH"));
  });

  it("a venue past the import cap still echoes", async () => {
    for (const mode of ["hold", "autopublish"] as const) {
      const t = convexTest({ schema, modules });
      // A space at the cap: the read-back trims it, so the hash must too.
      const venue = "V".repeat(119) + " " + "V".repeat(30);
      const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional", mode });
      const eventId = await seedEvent(t, communityProfileId, { venueLabel: venue });
      const lastExportedHash = await t.run(async (ctx) => carriedFieldsHash("google_calendar", await correctionFields(ctx.db, (await ctx.db.get(eventId))!)));
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", lastExportedHash, createdAt: NOW, updatedAt: NOW }));
      assert.equal(await applyImport(t, connectorId, googleItem({ location: venue, updated: "2026-11-02T11:59:59.000Z" })), "skipped_echo");
      assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.venueLabel, venue);
    }
  });

  it("reconcile queues exports for unlinked upcoming events", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    const matched = await seedEvent(t, communityProfileId);
    const fresh = await seedEvent(t, communityProfileId, { title: "Fresh Night", slug: "fresh-night", eventDate: "2026-11-09", startAt: Date.parse("2026-11-10T01:00:00.000Z"), endAt: undefined, sortAt: Date.parse("2026-11-10T01:00:00.000Z") });
    await seedEvent(t, communityProfileId, { title: "Old Night", slug: "old-night", eventDate: "2026-10-20", startAt: Date.parse("2026-10-21T00:00:00.000Z"), sortAt: Date.parse("2026-10-21T00:00:00.000Z") });
    await seedEvent(t, communityProfileId, { title: "Private Night", slug: "private-night", eventDate: "2026-11-10", publicationState: "draft_private", startAt: Date.parse("2026-11-11T01:00:00.000Z"), sortAt: Date.parse("2026-11-11T01:00:00.000Z") });
    await t.run((ctx) => ctx.db.patch(matched, { sortAt: Date.parse("2026-11-08T01:00:00.000Z") }));
    const fake = fakeFetch(() => Response.json({ items: [googleItem()], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const jobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.state === "pending").sort((a, b) => a.dueAt - b.dueAt);
    assert.deepEqual(jobs.map((j) => [j.kind, j.eventId]), [["export_upsert", matched], ["export_upsert", fresh]]);
  });

  it("full resync on 410 stores the fresh sync token and imports the items", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold", target: { calendarId: "cal-1", syncToken: "stale-token" } });
    const fresh = googleItem({ id: "g-new", summary: "Fresh Night", start: { dateTime: "2026-11-09T20:00:00-05:00" }, end: { dateTime: "2026-11-09T23:00:00-05:00" }, description: undefined });
    const fake = fakeFetch(({ url }) => url.searchParams.get("syncToken") === "stale-token"
      ? new Response("", { status: 410 })
      : Response.json({ items: [fresh], nextSyncToken: "fresh-token", timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls[1].url.searchParams.has("syncToken"), false);
    assert.equal(fake.calls[1].url.searchParams.has("timeMin"), false);
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.target.syncToken, "fresh-token");
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(link.externalId, "g-new");
    assert.ok(link.draftId);
  });

  it("a resync after a 410 still sees deletions, and only polls ask for them", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", syncToken: "stale-token" } });
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", externalUpdatedAt: Date.parse("2026-11-02T10:00:00.000Z"), createdAt: NOW, updatedAt: NOW }));
    const gone = { id: "g1", status: "cancelled", updated: "2026-11-02T11:59:59.000Z" };
    const fake = fakeFetch(({ url }) => {
      if (url.pathname.endsWith("/watch")) return Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) });
      if (url.searchParams.get("syncToken") === "stale-token") return new Response("", { status: 410 });
      // Google's default: a list with no sync token hides deleted items.
      return Response.json({ items: url.searchParams.get("showDeleted") === "true" ? [gone] : [], nextSyncToken: "fresh-token", timeZone: "America/New_York" });
    });
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    assert.deepEqual(fake.calls.map((c) => c.url.searchParams.get("showDeleted")), ["true", "true"]);
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "external_deleted");
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const reconcileList = fake.calls.find((c) => c.url.searchParams.has("timeMin"))!;
    assert.equal(reconcileList.url.searchParams.has("showDeleted"), false);
  });

  it("records an edit it put in the pending draft on the link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const { draftId, linkId } = await t.run(async (ctx) => {
      const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: staffUserId, connectorId, version: 1, fields: { title: "Held" }, provenance: [], createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 86_400_000 });
      return { draftId, linkId: await ctx.db.insert("eventSyncLinks", { connectorId, draftId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }) };
    });
    const item = googleItem({ recurringEventId: "series-1" });
    assert.equal(await applyImport(t, connectorId, item), "skipped_pending_draft");
    const link = (await t.run((ctx) => ctx.db.get(linkId)))!;
    assert.deepEqual([link.externalUpdatedAt, link.lastImportedAt, link.externalSeriesId, link.draftId], [Date.parse(item.updated), NOW, "series-1", draftId]);
    assert.equal((await t.run((ctx) => ctx.db.get(draftId)))!.fields.tentative?.title, "Bass Temple");
  });

  const moved = (updated: string) => googleItem({
    summary: "Bass Temple Late", start: { dateTime: "2026-11-07T21:00:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-07T23:30:00-05:00", timeZone: "America/New_York" }, updated,
  });
  const movedStart = Date.parse("2026-11-08T02:00:00.000Z");

  it("a new held item picks up a later Google edit, and Publish carries it under staff's saves", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional", mode: "hold" });
    assert.equal(await applyImport(t, connectorId, googleItem()), "draft");
    const [{ draftId }] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    await staff(t).mutation(api.eventIntake.saveEventIntakeDraft, { draftId: draftId!, expectedVersion: 1, patch: { venueLabel: "Staff Hall" } });
    const edit = moved("2026-11-02T11:30:00.000Z");
    assert.equal(await applyImport(t, connectorId, edit), "skipped_pending_draft");
    const [row] = await staff(t).query(api.eventInventory.listHeldImports, {});
    assert.equal(row.kind, "new");
    assert.deepEqual(row.kind === "new" && [row.title, row.schedule.kind === "timed" && row.schedule.startAt], ["Bass Temple Late", movedStart]);
    const { eventId } = await staff(t).mutation(api.eventIntakeHeld.publish, { draftId: draftId! });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    assert.deepEqual([event.title, event.startAt, event.venueLabel], ["Bass Temple Late", movedStart, "Staff Hall"]);
    assert.equal(await applyImport(t, connectorId, edit), "unchanged");
  });

  it("a proposed update picks up a later Google edit, so the queued export cannot undo it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional", mode: "hold" });
    const eventId = await seedEvent(t, communityProfileId);
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, googleItem({ summary: "Bass Temple Early", updated: "2026-11-02T11:59:30.000Z" })), "draft");
    const edit = moved("2026-11-02T11:59:40.000Z");
    assert.equal(await applyImport(t, connectorId, edit), "skipped_pending_draft");
    const [row] = await staff(t).query(api.eventInventory.listHeldImports, {});
    assert.deepEqual(row.kind === "update" && row.changes.filter(({ field }) => field === "title" || field === "start").map(({ field, after }) => [field, after]), [["title", "Bass Temple Late"], ["start", movedStart]]);
    const { draftId } = (await t.run((ctx) => ctx.db.get(linkId)))!;
    await staff(t).mutation(api.eventIntakeHeld.publish, { draftId: draftId! });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    assert.deepEqual([event.title, event.startAt], ["Bass Temple Late", movedStart]);
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).some((job) => job.kind === "export_upsert" && job.eventId === eventId && job.state === "pending"));
    assert.equal(await applyImport(t, connectorId, edit), "unchanged");
  });

  it("a dismissed draft that held the edit stays out", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    assert.equal(await applyImport(t, connectorId, googleItem()), "draft");
    const edit = moved("2026-11-02T11:30:00.000Z");
    assert.equal(await applyImport(t, connectorId, edit), "skipped_pending_draft");
    const [{ draftId }] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    await staff(t).mutation(api.eventIntakeHeld.dismiss, { draftId: draftId! });
    assert.equal(await applyImport(t, connectorId, edit), "unchanged");
  });

  it("skips an item longer than the intake's day range", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    assert.equal(await applyImport(t, connectorId, googleItem({ end: { dateTime: "2026-11-16T23:00:00-05:00" } })), "skipped");
  });

  it("treats the inbound deletion of a VRDex retraction as an echo", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g1", state: "vrdex_retracted", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await applyImport(t, connectorId, { id: "g1", status: "cancelled" } as GoogleCalendarEvent), "cancel_echo");
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "vrdex_retracted");
  });

  // ponytail ceiling (one local hour a year): the candidate cannot carry occurrence, so the echo files a held draft, never a loop.
  it("an echo of a fall-back-hour event writes nothing to the event and queues no export", async (context) => {
    context.mock.timers.setTime(Date.parse("2026-10-25T12:00:00.000Z"));
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { eventDate: "2026-11-01", startAt: Date.parse("2026-11-01T06:30:00.000Z"), endAt: Date.parse("2026-11-01T09:00:00.000Z"), updatedAt: Date.now() - 60_000 });
    const before = (await t.run((ctx) => ctx.db.get(eventId)))!;
    let sent: GoogleEventBody | undefined;
    const fake = fakeFetch(({ method, body }) => {
      if (method === "GET") return Response.json({ items: [], timeZone: "America/New_York" });
      sent = body as GoogleEventBody;
      return Response.json({ ...googleItem({ id: "created-1" }), ...sent });
    });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId });
    fake.restore();
    const echo = { ...googleItem({ id: "created-1" }), ...sent!, updated: new Date(Date.now() + 1_000).toISOString() };
    assert.equal(await applyImport(t, connectorId, echo), "draft");
    const after = (await t.run((ctx) => ctx.db.get(eventId)))!;
    assert.deepEqual([after.updatedAt, after.startAt], [before.updatedAt, before.startAt]);
    const pending = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.state === "pending");
    assert.equal(pending.length, 0);
  });
});

describe("google calendar listing", () => {
  beforeEach(setupEnv);

  it("stores only the fields the mapper reads, so foreign keys cannot stall an import", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    const item = { ...googleItem(), attendees: [{ email: "guest@example.com" }], organizer: { email: "host@example.com" }, extendedProperties: { private: { $weird: "x" } } };
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/watch")
      ? Response.json({ resourceId: "res-1", expiration: String(NOW + 604_800_000) })
      : Response.json({ items: [item], timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    const job = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).find((j) => j.kind === "import_item")!;
    assert.deepEqual(Object.keys((job.payload as { item: object }).item).sort(), ["description", "end", "id", "location", "start", "status", "summary", "updated"]);
    await t.action(internal.eventSync.runJob, { jobId: job._id });
    assert.equal((await t.run((ctx) => ctx.db.get(job._id)))!.state, "done");
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 1);
  });

  it("asks Google for default events on every list, sync token or not", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", syncToken: "stale-token" } });
    const fake = fakeFetch(({ url }) => url.searchParams.has("syncToken")
      ? new Response("", { status: 410 })
      : Response.json({ items: [], nextSyncToken: "fresh-token", timeZone: "America/New_York" }));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => [c.url.searchParams.has("syncToken"), c.url.searchParams.get("eventTypes")]), [[true, "default"], [false, "default"]]);
  });

  it("gives up with a code on a list that never ends", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    let page = 0;
    const fake = fakeFetch(() => Response.json({ items: [], nextPageToken: `p${++page}`, timeZone: "America/New_York" }));
    const job = await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal(fake.calls.length, 200);
    assert.equal(job.lastError, "GOOGLE_PAGE_LIMIT");
  });
});

describe("google calendar watch channels", () => {
  beforeEach(setupEnv);
  const notify = async (t: TestConvex<typeof schema>, headers: Record<string, string>) =>
    t.fetch("/connectors/google/notify", { method: "POST", headers });
  const pendingPolls = (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).filter((j) => j.kind === "import_poll" && j.state === "pending").length);

  it("enqueues one poll for an authenticated notification and dedupes repeats", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-1", watchResourceId: "res-1", watchExpiresAt: NOW + 86_400_000 } });
    const headers = { "x-goog-channel-id": "chan-1", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-1"), "x-goog-resource-state": "exists" };
    assert.equal((await notify(t, headers)).status, 200);
    assert.equal((await notify(t, headers)).status, 200);
    assert.equal(await pendingPolls(t), 1);
  });

  it("delays a notification's poll so a burst of them shares it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    await t.mutation(internal.googleCalendarConnector.enqueuePoll, { connectorId });
    const [job] = await t.run((ctx) => ctx.db.query("eventSyncJobs").collect());
    assert.equal(job.dueAt, NOW + 30_000);
  });

  it("reconcile reopens an expired channel and leaves a live one", async () => {
    const t = convexTest({ schema, modules });
    const channel = { watchChannelId: "chan-1", watchResourceId: "res-1" };
    const dead = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", ...channel, watchExpiresAt: NOW - 1 } });
    const live = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-2", ...channel, watchExpiresAt: NOW + 86_400_000 } });
    const fake = fakeFetch(({ url }) => {
      if (url.pathname.endsWith("/stop")) return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/watch")) return Response.json({ resourceId: "res-2", expiration: String(NOW + 604_800_000) });
      return Response.json({ items: [], timeZone: "UTC" });
    });
    await runSyncJob(t, { connectorId: dead.connectorId, kind: "reconcile" });
    await runSyncJob(t, { connectorId: live.connectorId, kind: "reconcile" });
    fake.restore();
    assert.deepEqual(fake.calls.filter((c) => c.url.pathname.endsWith("/watch")).map((c) => c.url.pathname), ["/calendar/v3/calendars/cal-1/events/watch"]);
    assert.equal((await t.run((ctx) => ctx.db.get(dead.connectorId)))!.target.watchResourceId, "res-2");
  });

  it("rejects a bad token", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-1" } });
    const response = await notify(t, { "x-goog-channel-id": "chan-1", "x-goog-channel-token": connectorId + ".forged", "x-goog-resource-state": "exists" });
    assert.equal(response.status, 401);
    assert.equal(await pendingPolls(t), 0);
  });

  it("ignores a stale channel and the initial sync message", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchChannelId: "chan-2" } });
    const stale = { "x-goog-channel-id": "chan-1", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-1"), "x-goog-resource-state": "exists" };
    const sync = { "x-goog-channel-id": "chan-2", "x-goog-channel-token": await watchChannelToken(connectorId, "chan-2"), "x-goog-resource-state": "sync" };
    assert.equal((await notify(t, stale)).status, 200);
    assert.equal((await notify(t, sync)).status, 200);
    assert.equal(await pendingPolls(t), 0);
  });

  // Ruling C18.
  it("ignores an export-only connector, and everything while connectors are off", async () => {
    const t = convexTest({ schema, modules });
    const exporting = await seedGoogleConnector(t, { direction: "export", target: { calendarId: "cal-1", watchChannelId: "chan-1" } });
    const importing = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-2", watchChannelId: "chan-2" } });
    const headers = async (connectorId: string, channelId: string) => ({ "x-goog-channel-id": channelId, "x-goog-channel-token": await watchChannelToken(connectorId, channelId), "x-goog-resource-state": "exists" });
    assert.equal((await notify(t, await headers(exporting.connectorId, "chan-1"))).status, 200);
    process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "false";
    assert.equal((await notify(t, await headers(importing.connectorId, "chan-2"))).status, 200);
    assert.equal(await pendingPolls(t), 0);
  });

  it("ignores a valid token on the current channel of a removed or paused connector", async () => {
    const t = convexTest({ schema, modules });
    for (const [state, channelId] of [["removed", "chan-1"], ["paused", "chan-2"]] as const) {
      const { connectorId } = await seedGoogleConnector(t, { direction: "import", state, target: { calendarId: "cal-1", watchChannelId: channelId } });
      const response = await notify(t, { "x-goog-channel-id": channelId, "x-goog-channel-token": await watchChannelToken(connectorId, channelId), "x-goog-resource-state": "exists" });
      assert.equal(response.status, 200);
    }
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).length, 0);
  });

  it("rejects a token whose connector id is not one", async () => {
    const t = convexTest({ schema, modules });
    const response = await notify(t, { "x-goog-channel-id": "chan-1", "x-goog-channel-token": await watchChannelToken("not-an-id", "chan-1"), "x-goog-resource-state": "exists" });
    assert.equal(response.status, 401);
  });

  it("renews a watch with a day or less left and leaves fresher ones", async () => {
    const t = convexTest({ schema, modules });
    const due = await seedGoogleConnector(t, { direction: "bidirectional", target: { calendarId: "cal-1", watchChannelId: "old-chan", watchResourceId: "old-res", watchExpiresAt: NOW + 43_200_000 } });
    await seedGoogleConnector(t, { direction: "bidirectional", target: { calendarId: "cal-2", watchChannelId: "fresh-chan", watchResourceId: "fresh-res", watchExpiresAt: NOW + 3 * 86_400_000 } });
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/stop") ? new Response(null, { status: 204 }) : Response.json({ resourceId: "new-res", expiration: String(NOW + 604_800_000) }));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.url.pathname), ["/calendar/v3/channels/stop", "/calendar/v3/calendars/cal-1/events/watch"]);
    assert.deepEqual(fake.calls[0].body, { id: "old-chan", resourceId: "old-res" });
    const watch = fake.calls[1].body as { id: string; token: string; address: string; type: string };
    assert.equal(watch.address, "https://convex.test/connectors/google/notify");
    assert.equal(watch.type, "web_hook");
    assert.equal(watch.token, await watchChannelToken(due.connectorId, watch.id));
    const target = (await t.run((ctx) => ctx.db.get(due.connectorId)))!.target;
    assert.equal(target.watchChannelId, watch.id);
    assert.equal(target.watchResourceId, "new-res");
    assert.equal(target.watchExpiresAt, NOW + 604_800_000);
    assert.equal(target.watchRenewedAt, NOW);
  });

  it("renewal opens a missing watch with a week's ttl and skips connectors that do not import", async () => {
    const t = convexTest({ schema, modules });
    await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1" } });
    await seedGoogleConnector(t, { direction: "export", target: { calendarId: "cal-2" } });
    await seedGoogleConnector(t, { direction: "import", state: "paused", target: { calendarId: "cal-3" } });
    const fake = fakeFetch(() => Response.json({ resourceId: "new-res", expiration: String(NOW + 604_800_000) }));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.url.pathname), ["/calendar/v3/calendars/cal-1/events/watch"]);
    assert.deepEqual((fake.calls[0].body as { params: unknown }).params, { ttl: "604800" });
  });

  it("the poll cron covers only active import and bidirectional connectors", async () => {
    const t = convexTest({ schema, modules });
    await seedGoogleConnector(t, { direction: "import" });
    await seedGoogleConnector(t, { direction: "bidirectional" });
    await seedGoogleConnector(t, { direction: "export" });
    await seedGoogleConnector(t, { direction: "import", state: "needs_reauth" });
    await t.mutation(internal.googleCalendarConnector.enqueuePolls, {});
    assert.equal(await pendingPolls(t), 2);
  });
});

describe("google calendar watch staleness alert", () => {
  beforeEach(setupEnv);
  const DAY = 86_400_000;
  const connector = (id: string, fields: { direction?: string; state?: string; target?: Record<string, unknown>; createdAt?: number }) => ({
    _id: id, kind: "google_calendar", direction: fields.direction ?? "import", state: fields.state ?? "active",
    communityProfileId: "community-1", target: { calendarId: "cal-1", ...fields.target }, createdAt: fields.createdAt ?? NOW - 30 * DAY, updatedAt: NOW,
  }) as unknown as Doc<"eventConnectors">;
  const alertKey = (connectorId: string) => `google_watch_renewal_stale:${connectorId}`;
  const opsAlert = (t: TestConvex<typeof schema>, connectorId: string) =>
    t.run((ctx) => ctx.db.query("opsAlerts").withIndex("by_key", (q) => q.eq("key", alertKey(connectorId))).unique());
  const sends = (t: TestConvex<typeof schema>) => t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((fn) => fn.name.includes("opsAlertEmail")).map((fn) => (fn.args[0] as { subject: string; body: string })));

  it("alerts on an expired or unrenewed watch, resolves every other connector, and counts the alerts", async () => {
    const sent: OpsAlert[] = [];
    const resolved: string[] = [];
    const count = await reportStaleWatches([
      connector("expired", { target: { watchExpiresAt: NOW - 1, watchRenewedAt: NOW - DAY } }),
      connector("unrenewed", { direction: "bidirectional", target: { watchExpiresAt: NOW + DAY, watchRenewedAt: NOW - 7 * DAY } }),
      connector("never-watched", { target: {} }),
      connector("healthy", { target: { watchExpiresAt: NOW + 6 * DAY, watchRenewedAt: NOW - DAY } }),
      connector("export-only", { direction: "export", target: { watchExpiresAt: NOW - 1 } }),
      connector("needs-reauth", { state: "needs_reauth", target: { watchExpiresAt: NOW - 1 } }),
      connector("new-no-watch-yet", { target: {}, createdAt: NOW - DAY }),
    ], NOW, async (alert) => { sent.push(alert); }, async (key) => { resolved.push(key); });
    assert.equal(count, 3);
    assert.deepEqual(sent.map((alert) => alert.key), [
      "google_watch_renewal_stale:expired",
      "google_watch_renewal_stale:unrenewed",
      "google_watch_renewal_stale:never-watched",
    ]);
    assert.ok(sent.every((alert) => alert.subject === "Google Calendar watch renewal stale"));
    assert.match(sent[0].body, /expired/);
    assert.deepEqual(resolved, [
      "google_watch_renewal_stale:healthy",
      "google_watch_renewal_stale:export-only",
      "google_watch_renewal_stale:needs-reauth",
      "google_watch_renewal_stale:new-no-watch-yet",
    ]);
  });

  it("names the connector, community, watch times, and last error in the body", async () => {
    const sent: OpsAlert[] = [];
    await reportStaleWatches([{ ...connector("expired", { target: { watchExpiresAt: NOW - 1, watchRenewedAt: NOW - DAY } }), lastError: "GOOGLE_API_500" }], NOW, async (alert) => { sent.push(alert); }, async () => {});
    for (const part of ["expired", "community-1", new Date(NOW - 1).toISOString(), new Date(NOW - DAY).toISOString(), "GOOGLE_API_500"]) assert.ok(sent[0].body.includes(part), part);
  });

  it("one failed renewal is recorded and alerted, the others renew, and every other alert closes", async () => {
    const t = convexTest({ schema, modules });
    const expired = { watchChannelId: "old-chan", watchResourceId: "old-res", watchExpiresAt: NOW - 1, watchRenewedAt: NOW - 8 * DAY };
    const failing = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", ...expired } });
    const renewed = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-2", ...expired } });
    const removed = await seedGoogleConnector(t, { direction: "import", state: "removed", target: { calendarId: "cal-3", ...expired } });
    await t.run(async (ctx) => {
      for (const { connectorId } of [renewed, removed]) await ctx.db.insert("opsAlerts", { key: alertKey(connectorId), lastSentAt: NOW - DAY });
    });
    const fake = fakeFetch(({ url }) => {
      if (url.pathname.endsWith("/stop")) return new Response(null, { status: 204 });
      return url.pathname.includes("/cal-1/") ? new Response('{"error":"secret body"}', { status: 500 }) : Response.json({ resourceId: "new-res", expiration: String(NOW + 7 * DAY) });
    });
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.get(failing.connectorId)))!.lastError, "GOOGLE_API_500");
    assert.equal((await t.run((ctx) => ctx.db.get(renewed.connectorId)))!.target.watchRenewedAt, NOW);
    assert.equal((await t.run((ctx) => ctx.db.get(removed.connectorId)))!.target.watchRenewedAt, NOW - 8 * DAY);
    assert.equal((await opsAlert(t, failing.connectorId))?.resolvedAt, undefined);
    assert.equal((await opsAlert(t, renewed.connectorId))?.resolvedAt, NOW);
    assert.equal((await opsAlert(t, removed.connectorId))?.resolvedAt, NOW);
    const emails = await sends(t);
    assert.deepEqual(emails.map((email) => email.subject).sort(), [
      "[VRDex ops] Google Calendar watch renewal stale",
      `[VRDex ops] Resolved: ${alertKey(removed.connectorId)}`,
      `[VRDex ops] Resolved: ${alertKey(renewed.connectorId)}`,
    ].sort());
    const alert = emails.find((email) => email.subject.endsWith("stale"))!;
    assert.ok(alert.body.includes(failing.connectorId) && alert.body.includes("GOOGLE_API_500"));
    assert.ok(!alert.body.includes("secret body"));
  });

  it("keeps a rejected Google call to a code, with no URL or calendar ID in lastError or the alert", async () => {
    const t = convexTest({ schema, modules });
    const calendarId = "organiser@example.com";
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId, watchExpiresAt: NOW - 1 } });
    const fake = fakeFetch(({ url }) => { throw new TypeError(`fetch failed: ${url.href} ${calendarId}`); });
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    // A transport failure is not a 401: no refresh follows it.
    assert.deepEqual(fake.calls.map((c) => c.url.hostname + c.url.pathname), [`www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`]);
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.deepEqual([connector.state, connector.lastError], ["active", "GOOGLE_API_UNREACHABLE"]);
    const [alert] = await sends(t);
    assert.ok(alert.body.includes("GOOGLE_API_UNREACHABLE"));
    assert.ok(!alert.body.includes(calendarId));
  });

  it("keeps a fetch that throws synchronously to a code", async () => {
    const t = convexTest({ schema, modules });
    const calendarId = "organiser@example.com";
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId, watchExpiresAt: NOW - 1 } });
    const original = globalThis.fetch;
    globalThis.fetch = () => { throw new TypeError(`invalid ${calendarId}`); };
    try {
      await t.action(internal.googleCalendarConnector.renewWatches, {});
    } finally {
      globalThis.fetch = original;
    }
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.lastError, "GOOGLE_API_UNREACHABLE");
  });

  it("keeps a rejected token refresh to a code and leaves the connector active", async () => {
    const t = convexTest({ schema, modules });
    const calendarId = "organiser@example.com";
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId, watchExpiresAt: NOW - 1 } });
    await t.run((ctx) => ctx.db.patch(credentialId, { accessTokenExpiresAt: NOW - 1 }));
    const fake = fakeFetch(({ url }) => { throw new TypeError(`fetch failed: ${url.href} ${calendarId}`); });
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.url.pathname), ["/token"]);
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.deepEqual([connector.state, connector.lastError], ["active", "GOOGLE_API_UNREACHABLE"]);
    assert.equal((await t.run((ctx) => ctx.db.get(credentialId)))!.state, "active");
  });

  it("keeps a connection lost mid-body to a code", async () => {
    const t = convexTest({ schema, modules });
    const calendarId = "organiser@example.com";
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId, watchExpiresAt: NOW - 1 } });
    const fake = fakeFetch(() => new Response(new ReadableStream({ start: (stream) => stream.error(new Error(`terminated ${calendarId}`)) })));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.lastError, "GOOGLE_API_RESPONSE");
  });

  it("an unreadable refresh token keeps its own code", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchExpiresAt: NOW - 1 } });
    await t.run((ctx) => ctx.db.patch(credentialId, { accessTokenExpiresAt: NOW - 1, encryptedRefreshToken: "not-a-cipher" }));
    const fake = fakeFetch(() => Response.json({}));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.lastError, "CONNECTOR_CREDENTIAL_UNREADABLE");
  });

  it("does nothing while the kind flag is off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import", target: { calendarId: "cal-1", watchExpiresAt: NOW - 1 } });
    process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "false";
    const fake = fakeFetch(() => Response.json({ resourceId: "new-res", expiration: String(NOW + 7 * DAY) }));
    await t.action(internal.googleCalendarConnector.renewWatches, {});
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal(await opsAlert(t, connectorId), null);
    assert.equal((await sends(t)).length, 0);
  });
});

describe("candidateFromConnectorFields", () => {
  it("builds a connector candidate whose dates round-trip through candidatePatch", () => {
    const candidate = candidateFromConnectorFields("google_calendar", {
      communitySlug: "basic-nights", title: "Bass Temple", eventDate: "2026-11-07", timeTba: false, timezone: "America/New_York",
      start: { time: "22:00" }, end: { time: "01:00", dayOffset: 1 }, venueLabel: null, summary: "Weekly bass night.",
    }, { kind: "new" });
    assert.deepEqual(candidate.event, {
      title: "Bass Temple", communitySlug: "basic-nights", eventDate: "2026-11-07", start: "22:00", end: "01:00", startDate: "2026-11-07", endDate: "2026-11-08",
      timezone: "America/New_York", venueLabel: null, summary: "Weekly bass night.", sourceUrl: null,
    });
    assert.deepEqual([candidate.lineup, candidate.questions, candidate.decision], [[], [], { kind: "new" }]);
    assert.deepEqual(candidate.evidence.map((row) => row.fieldPath).sort(), ["event.communitySlug", "event.end", "event.eventDate", "event.start", "event.summary", "event.timeTba", "event.timezone", "event.title", "event.venueLabel"]);
    assert.ok(candidate.evidence.every((row) => row.origin === "connector" && row.assessment === "explicit" && row.excerpt === null));
    assert.deepEqual(candidatePatch(candidate).tentative?.end, { time: "01:00", dayOffset: 1 });
  });
});

describe("google calendar connect", () => {
  beforeEach(setupEnv);
  const grant = { accessToken: "a", refreshToken: "rt", expiresAt: NOW + 3_600_000, scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"], externalAccountId: "google-sub-2" };

  it("stores an encrypted credential for an authorised staffer", async () => {
    const t = convexTest({ schema, modules });
    const { staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const { credentialId } = await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", ...grant });
    const credential = (await t.run((ctx) => ctx.db.get(credentialId)))!;
    assert.notEqual(credential.encryptedRefreshToken, "rt");
    assert.equal(await decryptSecret(credential.encryptedRefreshToken), "rt");
    assert.equal(credential.ownerUserId, staffUserId);
  });

  it("refuses a user without manage_integrations", async () => {
    const t = convexTest({ schema, modules });
    const { outsiderUserId } = await seedGoogleConnector(t, { direction: "import" });
    await assert.rejects(t.query(internal.googleCalendarConnector.authorizeConnect, { actorUserId: outsiderUserId, communitySlug: "basic-nights" }), /CONNECTOR_FORBIDDEN/);
  });

  it("refuses while the kind flag is off", async () => {
    const t = convexTest({ schema, modules });
    const { staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "false";
    await assert.rejects(t.query(internal.googleCalendarConnector.authorizeConnect, { actorUserId: staffUserId, communitySlug: "basic-nights" }), /CONNECTOR_KIND_DISABLED/);
  });

  it("reconnect swaps the credential, reactivates, and enqueues reconcile", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId: old } = await seedGoogleConnector(t, {
      direction: "import", state: "needs_reauth", target: { calendarId: "cal-1", calendarName: "Events", syncToken: "sync-1", watchChannelId: "ch-1", watchResourceId: "res-1", watchExpiresAt: NOW + 1000, watchRenewedAt: NOW - 1000 },
    });
    // A second staffer reconnects; the runner checks the authority's role, so it moves to them.
    const otherStaff = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkUserId: "staff-2" });
      const role = (await ctx.db.query("communityRoles").collect())[0];
      await ctx.db.insert("communityAuthorities", { communityProfileId: role.communityProfileId, subjectTokenIdentifier: "test|staff-2", subject: { tokenIdentifier: "test|staff-2", issuer: "test", subject: "staff-2" }, roleId: role._id, state: "active", grantedAt: NOW, updatedAt: NOW });
      await ctx.db.patch(connectorId, { lastError: "GOOGLE_REAUTH_REQUIRED" });
      return userId;
    });
    const { credentialId } = await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: otherStaff, communitySlug: "basic-nights", connectorId, ...grant });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.notEqual(credentialId, old);
    assert.equal(connector.credentialId, credentialId);
    assert.equal(connector.state, "active");
    assert.equal(connector.authorityUserId, otherStaff);
    assert.equal(connector.lastError, undefined);
    // A different Google account: the old sync token is not valid for it.
    assert.deepEqual(connector.target, { calendarId: "cal-1", calendarName: "Events" });
    assert.equal((await t.run((ctx) => ctx.db.get(old)))!.state, "revoked");
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).some((j) => j.kind === "reconcile" && j.state === "pending"));
  });

  it("reconnect keeps a credential another live connector still uses, and the same account keeps its sync token", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, staffUserId, credentialId: old } = await seedGoogleConnector(t, { direction: "import", state: "needs_reauth", target: { calendarId: "cal-1", syncToken: "sync-1" } });
    // The other connector sits in a second community the same staffer runs.
    const otherCommunity = await t.run((ctx) => ctx.db.insert("profiles", { slug: "other-nights", displayName: "Other Nights", sortName: "other nights", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: NOW }));
    await t.run((ctx) => ctx.db.insert("eventConnectors", {
      communityProfileId: otherCommunity, kind: "google_calendar", direction: "export", mode: "autopublish", authorityUserId: staffUserId,
      credentialId: old, target: { calendarId: "cal-2" }, state: "needs_reauth", createdAt: NOW, updatedAt: NOW,
    }));
    await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", connectorId, ...grant, externalAccountId: "google-sub-1" });
    assert.equal((await t.run((ctx) => ctx.db.get(old)))!.state, "active");
    assert.deepEqual((await t.run((ctx) => ctx.db.get(connectorId)))!.target, { calendarId: "cal-1", syncToken: "sync-1" });
  });

  it("reconnect refuses a removed connector", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, staffUserId, credentialId: old } = await seedGoogleConnector(t, { direction: "import", state: "removed" });
    await assert.rejects(t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", connectorId, ...grant }), /CONNECTOR_NOT_FOUND/);
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId)))!.credentialId, old);
    assert.equal((await t.run((ctx) => ctx.db.query("connectorCredentials").collect())).length, 1);
  });

  it("lists calendars only for the credential's owner", async () => {
    const t = convexTest({ schema, modules });
    const { credentialId } = await seedGoogleConnector(t, { direction: "import" });
    const as = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
    const fake = fakeFetch(() => Response.json({ items: [{ id: "cal-1", summary: "Events", primary: true, accessRole: "owner" }] }));
    await assert.rejects(as("outsider").action(api.googleCalendarConnector.listCalendars, { credentialId }), /CONNECTOR_FORBIDDEN/);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(await as("staff").action(api.googleCalendarConnector.listCalendars, { credentialId }), [{ id: "cal-1", summary: "Events", primary: true }]);
    fake.restore();
    assert.equal(await t.query(api.googleCalendarConnector.enabled, {}), true);
  });
});

describe("google calendar credential lifecycle", () => {
  beforeEach(setupEnv);
  const DAY = 86_400_000;
  const reauthKey = (credentialId: string) => `google_reauth:${credentialId}`;
  const reauthAlert = (t: TestConvex<typeof schema>, credentialId: string) =>
    t.run((ctx) => ctx.db.query("opsAlerts").withIndex("by_key", (q) => q.eq("key", reauthKey(credentialId))).unique());
  const as = (t: TestConvex<typeof schema>, subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const grant = { accessToken: "a", refreshToken: "rt", expiresAt: NOW + 3_600_000, scopes: [], externalAccountId: "organiser@example.com" };
  const refused = () => fakeFetch(({ url }) => url.pathname === "/token" ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("", { status: 401 }));
  const sibling = (t: TestConvex<typeof schema>, first: Awaited<ReturnType<typeof seedGoogleConnector>>, state: Doc<"eventConnectors">["state"]) => t.run((ctx) => ctx.db.insert("eventConnectors", {
    communityProfileId: first.communityProfileId, kind: "google_calendar", direction: "export", mode: "hold", authorityUserId: first.staffUserId,
    credentialId: first.credentialId, target: { calendarId: "cal-2" }, state, createdAt: NOW, updatedAt: NOW,
  }));

  it("Disconnect revokes a credential nothing else uses", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    await as(t, "staff").mutation(api.eventConnectors.remove, { connectorId });
    assert.equal((await t.run((ctx) => ctx.db.get(credentialId)))!.state, "revoked");
  });

  it("Disconnect keeps a shared credential until its last connector goes", async () => {
    const t = convexTest({ schema, modules });
    const first = await seedGoogleConnector(t, { direction: "import" });
    const other = await sibling(t, first, "active");
    await as(t, "staff").mutation(api.eventConnectors.remove, { connectorId: first.connectorId });
    assert.equal((await t.run((ctx) => ctx.db.get(first.credentialId)))!.state, "active");
    await as(t, "staff").mutation(api.eventConnectors.remove, { connectorId: other });
    assert.equal((await t.run((ctx) => ctx.db.get(first.credentialId)))!.state, "revoked");
  });

  it("a refused grant emails ops with IDs only, and reconnecting closes the alert", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId, credentialId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = refused();
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    assert.equal((await reauthAlert(t, credentialId))?.resolvedAt, undefined);
    assert.ok(await reauthAlert(t, credentialId));
    const emails = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((fn) => fn.name.includes("opsAlertEmail")).map((fn) => fn.args[0] as { subject: string; body: string }));
    assert.deepEqual(emails.map((email) => email.subject), ["[VRDex ops] Google Calendar connector needs reconnecting"]);
    assert.ok(emails[0].body.includes(connectorId) && emails[0].body.includes(communityProfileId));
    assert.ok(!emails[0].body.includes("cal-1") && !emails[0].body.includes("GOOGLE"));
    await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: staffUserId, communitySlug: "basic-nights", connectorId, ...grant });
    assert.equal((await reauthAlert(t, credentialId))?.resolvedAt, NOW);
  });

  it("a refused grant no connector is using sends no alert", async () => {
    const t = convexTest({ schema, modules });
    const { credentialId } = await seedGoogleConnector(t, { direction: "import", state: "removed" });
    await t.mutation(internal.googleCalendarConnector.markNeedsReauth, { credentialId, error: "GOOGLE_REAUTH_REQUIRED" });
    assert.equal(await reauthAlert(t, credentialId), null);
  });

  it("the reauth alert stays open while another connector on the credential is still parked", async () => {
    const t = convexTest({ schema, modules });
    const first = await seedGoogleConnector(t, { direction: "import" });
    await sibling(t, first, "active");
    const fake = refused();
    await runSyncJob(t, { connectorId: first.connectorId, kind: "import_poll" });
    fake.restore();
    await t.action(internal.googleCalendarConnector.storeCredential, { actorUserId: first.staffUserId, communitySlug: "basic-nights", connectorId: first.connectorId, ...grant });
    const alert = await reauthAlert(t, first.credentialId);
    assert.ok(alert);
    assert.equal(alert.resolvedAt, undefined);
    assert.equal((await t.run((ctx) => ctx.db.get(first.credentialId)))!.state, "active");
  });

  it("removing the last connector closes the reauth alert with the revoke", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, credentialId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = refused();
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    await as(t, "staff").mutation(api.eventConnectors.remove, { connectorId });
    assert.equal((await reauthAlert(t, credentialId))?.resolvedAt, NOW);
  });

  const pendingReconciles = (t: TestConvex<typeof schema>) =>
    t.run(async (ctx) => (await ctx.db.query("eventSyncJobs").collect()).filter((j) => j.kind === "reconcile" && j.state === "pending").length);

  it("the daily sweep queues one reconcile per importing connector", async () => {
    const t = convexTest({ schema, modules });
    await seedGoogleConnector(t, { direction: "import" });
    await seedGoogleConnector(t, { direction: "bidirectional" });
    await seedGoogleConnector(t, { direction: "export" });
    await seedGoogleConnector(t, { direction: "import", state: "paused" });
    await t.mutation(internal.googleCalendarConnector.dailySweep, {});
    await t.mutation(internal.googleCalendarConnector.dailySweep, {});
    assert.equal(await pendingReconciles(t), 2);
  });

  it("the daily sweep does nothing with either flag off", async () => {
    for (const flag of ["VRDEX_EVENT_CONNECTORS_ENABLED", "VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED"]) {
      process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
      process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED = "true";
      const t = convexTest({ schema, modules });
      const { credentialId } = await seedGoogleConnector(t, { direction: "import", state: "removed" });
      await seedGoogleConnector(t, { direction: "import" });
      await t.run((ctx) => ctx.db.patch(credentialId, { createdAt: NOW - 2 * DAY }));
      process.env[flag] = "false";
      await t.mutation(internal.googleCalendarConnector.dailySweep, {});
      assert.equal(await pendingReconciles(t), 0);
      assert.equal((await t.run((ctx) => ctx.db.get(credentialId)))!.state, "active");
    }
  });

  it("the daily sweep retires only a day-old Google credential no live connector uses", async () => {
    const t = convexTest({ schema, modules });
    const live = await seedGoogleConnector(t, { direction: "import" });
    const removed = await seedGoogleConnector(t, { direction: "import", state: "removed" });
    const ids = await t.run(async (ctx) => {
      const { _id, _creationTime, ...row } = (await ctx.db.get(live.credentialId))!;
      await ctx.db.patch(live.credentialId, { createdAt: NOW - 2 * DAY });
      await ctx.db.patch(removed.credentialId, { createdAt: NOW - 2 * DAY });
      return {
        abandoned: await ctx.db.insert("connectorCredentials", { ...row, createdAt: NOW - 2 * DAY }),
        recent: await ctx.db.insert("connectorCredentials", { ...row, createdAt: NOW - DAY + 1 }),
        notion: await ctx.db.insert("connectorCredentials", { ...row, provider: "notion", createdAt: NOW - 2 * DAY }),
      };
    });
    await t.mutation(internal.googleCalendarConnector.dailySweep, {});
    const states = await t.run(async (ctx) => Promise.all([live.credentialId, removed.credentialId, ids.abandoned, ids.recent, ids.notion].map(async (id) => (await ctx.db.get(id))!.state)));
    assert.deepEqual(states, ["active", "revoked", "revoked", "active", "active"]);
  });
});
