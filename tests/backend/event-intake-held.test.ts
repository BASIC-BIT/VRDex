import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { EventIntakePatch } from "../../packages/api-contracts/src/event-intake";
import { normalizeIntakePublication } from "../../convex/_eventContributionPreflight";
import { EVENT_INTAKE_DRAFT_TTL_MS, getConnectorDraftForManager, publishIntakeDraft } from "../../convex/_eventIntake";
import { HELD_IMPORT_LIMIT, heldChanges, heldUpdatePatch, promoteHeldFields } from "../../convex/_eventIntakeHeld";

process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
process.env.EVENT_DATE_ONLY_ENABLED = "true";
process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const DAY = 86_400_000;
const sha256 = "a".repeat(64);
const evidence = (fieldPath: string, assessment: "explicit" | "inferred" = "explicit") => ({ fieldPath, origin: "text" as const, excerpt: null, assessment });
const newDraft: EventIntakePatch = { communitySlug: "club", tentative: { communitySlug: "club", title: "Afterglow Social", eventDate: "2027-07-20" }, evidence: [evidence("event.title"), evidence("event.eventDate")] };
const updateDraft: EventIntakePatch = { communitySlug: "club", tentative: { title: "Harbor Night", eventDate: "2027-07-15", timezone: "UTC", start: { time: "21:00", dayOffset: 0 }, venueLabel: "Club Room" }, evidence: [evidence("event.title"), evidence("event.start"), evidence("event.venueLabel", "inferred")] };
const publishable: EventIntakePatch = { communitySlug: "club", title: "Afterglow Social", eventDate: "2027-07-20", timeTba: true };

async function fixture() {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventInventory.ts": () => import("../../convex/eventInventory"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/eventIntakeHeld.ts": () => import("../../convex/eventIntakeHeld"),
    "../../convex/eventIntakeSources.ts": () => import("../../convex/eventIntakeSources"),
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = Date.now();
  const ids = await t.run(async ({ db }) => {
    const user = (clerkUserId: string) => db.insert("users", { clerkUserId, name: clerkUserId });
    const [owner, authority, staff, second, outsider] = [await user("owner"), await user("authority"), await user("staff"), await user("second"), await user("outsider")];
    const community = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
    await db.insert("profileOwners", { profileId: community, userId: owner, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    const grant = (name: string, capabilities: Doc<"communityAuthorities">["capabilities"]) => db.insert("communityAuthorities", { communityProfileId: community, subject: { subject: name, issuer: "test", tokenIdentifier: `test|${name}` }, subjectTokenIdentifier: `test|${name}`, roleLabel: "Staff", capabilities, state: "active", grantedAt: now, updatedAt: now });
    await grant("authority", ["manage_integrations"]); await grant("staff", ["manage_events"]); await grant("second", ["manage_events"]);
    const discord = await db.insert("eventConnectors", { communityProfileId: community, kind: "discord_announcements", direction: "import", mode: "hold", authorityUserId: authority, target: { guildId: "111111111111111111", channelId: "222222222222222222", channelName: "events" }, state: "active", createdAt: now, updatedAt: now });
    const google = await db.insert("eventConnectors", { communityProfileId: community, kind: "google_calendar", direction: "import", mode: "hold", authorityUserId: authority, target: { calendarId: "club@group.calendar.google.com" }, state: "active", createdAt: now, updatedAt: now });
    const event = await db.insert("events", { communityProfileId: community, communityName: "Club", title: "Harbor Night", sortTitle: "harbor night", slug: "harbor", scheduleKind: "timed", eventDate: "2027-07-15", startAt: Date.UTC(2027, 6, 15, 20), sortAt: Date.UTC(2027, 6, 15, 20), timezone: "UTC", venueLabel: "Hand-set hall", sourceType: "community", sourceLabel: "Club", eventStatus: "scheduled", publicationState: "published", createdAt: now, updatedAt: now });
    return { owner, authority, staff, second, outsider, community, discord, google, event };
  });
  const as = (name: string) => t.withIdentity({ subject: name, issuer: "test", tokenIdentifier: `test|${name}` });
  const draft = (fields: EventIntakePatch, extra: Record<string, unknown> = {}) => t.run(({ db }) => db.insert("eventIntakeDrafts", { actorUserId: ids.authority, connectorId: ids.discord, version: 1, fields, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 30 * DAY, ...extra }));
  const discordSource = (draftId: Id<"eventIntakeDrafts">, decision: Doc<"discordIntakeRuns">["decision"] = { kind: "new" }, messageId = "333333333333333333") => t.run(async ({ db }) => {
    const runId = await db.insert("discordIntakeRuns", { connectorId: ids.discord, authorId: "555555555555555555", triggerMessageIds: [messageId], state: "done", decision, draftId, createdAt: now });
    await db.insert("discordIntakeMessages", { connectorId: ids.discord, messageId, guildId: "111111111111111111", channelId: "222222222222222222", authorId: "555555555555555555", authorDisplayName: "Promoter", content: "Afterglow Social, July 20", attachments: [], createdAt: now, updatedAt: now });
    await db.insert("discordIntakeSources", { connectorId: ids.discord, messageId, externalId: messageId, draftId, runId, createdAt: now });
  });
  // `inFields: false` is the Discord shape: a selected artwork with no fields.posterSourceId.
  const poster = (draftId: Id<"eventIntakeDrafts">, { actorUserId = ids.authority, inFields = true } = {}) => t.run(async ({ db }) => {
    const sourceId = await db.insert("eventPosterSources", { purpose: "event_poster", actorUserId, draftId, contentType: "image/png", byteLength: 10, sha256, reservedBytes: 10, state: "ready", uploadedAt: now, expiresAt: now + DAY, uploadExpiresAt: now + DAY, lastActivityAt: now });
    const artworkId = await db.insert("eventPosterArtwork", { actorUserId, draftId, sourceId, state: "ready", createdAt: now, expiresAt: now + DAY });
    const row = (await db.get(draftId))!;
    await db.patch(draftId, { artworkAssetId: artworkId, ...(inFields ? { fields: { ...row.fields, posterSourceId: sourceId } } : {}) });
    return { sourceId, artworkId };
  });
  // What plan 02's autopublish leaves behind: a connector draft with a publication receipt.
  const autopublished = (fields: EventIntakePatch) => t.run(async ({ db }) => {
    const draftId = await db.insert("eventIntakeDrafts", { actorUserId: ids.authority, connectorId: ids.discord, version: 1, fields, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 30 * DAY });
    const receiptId = await db.insert("eventContributionReceipts", { actorUserId: ids.authority, draftId, draftVersion: 1, eventId: ids.event, eventPath: "/club/events/harbor", communityProfileId: ids.community, fingerprint: "autopublished", createdAt: now });
    await db.patch(draftId, { publishedReceiptId: receiptId });
    return draftId;
  });
  const upload = (actorUserId: Id<"users">, draftId: Id<"eventIntakeDrafts">, byteLength = 128) => t.mutation(internal.eventIntakeSources.beginPosterUpload, { actorUserId, draftId, contentType: "image/webp", byteLength, sha256 });
  const googleLink = (values: { draftId?: Id<"eventIntakeDrafts">; eventId?: Id<"events">; state?: "linked" | "external_deleted" }) => t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, externalId: "g-1", state: "linked", createdAt: now, updatedAt: now, ...values }));
  return { t, ids, as, draft, discordSource, poster, autopublished, upload, googleLink, now };
}

it("lets any manage_events staffer read a connector draft and nobody else", async () => {
  const { t, ids, as, draft, autopublished } = await fixture();
  const draftId = await draft(newDraft);
  const published = await autopublished(newDraft);
  assert.equal((await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId }))?.connectorId, ids.discord);
  assert.equal((await as("owner").query(api.eventIntake.getEventIntakeDraft, { draftId }))?._id, draftId);
  assert.equal(await as("outsider").query(api.eventIntake.getEventIntakeDraft, { draftId }), null);
  await t.run(async ({ db }) => {
    // The authority holds manage_integrations only: the held path is closed to them.
    await assert.rejects(getConnectorDraftForManager(db, ids.authority, draftId), /Draft not found/);
    assert.equal((await getConnectorDraftForManager(db, ids.staff, draftId)).connector._id, ids.discord);
    await assert.rejects(getConnectorDraftForManager(db, ids.staff, published), /Draft not found/);
    await assert.rejects(getConnectorDraftForManager(db, ids.staff, draftId, Date.now() + 31 * DAY), /Draft not found/);
    await db.patch(draftId, { resolvedAt: Date.now() });
    await assert.rejects(getConnectorDraftForManager(db, ids.staff, draftId), /Draft not found/);
  });
});

it("keeps connector drafts open to managers after the connector is removed", async () => {
  const { t, ids, draft } = await fixture();
  const draftId = await draft(newDraft);
  await t.run(async ({ db }) => {
    await db.patch(ids.discord, { state: "removed" });
    assert.equal((await getConnectorDraftForManager(db, ids.staff, draftId)).community._id, ids.community);
  });
});

it("keeps personal drafts owner-only", async () => {
  const { t, ids, as, upload } = await fixture();
  const personal = await t.run(({ db }) => db.insert("eventIntakeDrafts", { actorUserId: ids.owner, version: 1, fields: { title: "Mine" }, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + DAY }));
  assert.equal(await as("staff").query(api.eventIntake.getEventIntakeDraft, { draftId: personal }), null);
  await t.run(({ db }) => assert.rejects(getConnectorDraftForManager(db, ids.staff, personal), /Draft not found/));
  await assert.rejects(as("staff").mutation(api.eventIntake.saveEventIntakeDraft, { draftId: personal, expectedVersion: 1, patch: { title: "Taken" } }), /Draft not found/);
  await assert.rejects(upload(ids.staff, personal), /Draft not found/);
});

it("a second manager saves a connector draft that carries the authority's poster", async () => {
  const { as, draft, poster } = await fixture();
  const draftId = await draft(newDraft);
  const { sourceId } = await poster(draftId);
  const loaded = await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId });
  assert.equal(loaded?.artworkSourceId, sourceId);
  const saved = await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 1, patch: { ...loaded!.fields, title: "Edited" } });
  assert.equal(saved.version, 2);
});

it("a second manager replaces the poster with their own upload", async () => {
  const { t, ids, as, draft, poster, upload } = await fixture();
  const draftId = await draft(newDraft);
  await poster(draftId);
  const actorUserId = ids.second;
  const { posterAssetId } = await upload(actorUserId, draftId);
  await t.mutation(internal.eventIntakeSources.completePosterUpload, { actorUserId, posterAssetId, sha256 });
  const { version } = await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 1, patch: { posterSourceId: posterAssetId } });
  const selected = await t.mutation(internal.eventIntakeSources.selectPosterArtwork, { actorUserId, draftId, posterAssetId, expectedVersion: version });
  await t.mutation(internal.eventIntakeSources.completeArtwork, { actorUserId, artworkAssetId: selected.artworkAssetId!, expectedVersion: version, sha256: "b".repeat(64), byteLength: 100 });
  assert.equal((await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId }))?.artworkSourceId, posterAssetId);
  // Back on the draft owner, who holds no manage_events.
  assert.equal((await t.query(internal.eventIntakeSources.readActorSource, { actorUserId: ids.authority, posterAssetId })).draftId, draftId);
});

it("a second manager finishes the authority's artwork and recovers its failed write", async () => {
  const { t, ids, draft, poster } = await fixture();
  const draftId = await draft(newDraft);
  const { sourceId, artworkId } = await poster(draftId);
  const actorUserId = ids.second;
  const selected = await t.mutation(internal.eventIntakeSources.selectPosterArtwork, { actorUserId, draftId, posterAssetId: sourceId, expectedVersion: 1 });
  assert.equal(selected.artworkAssetId, artworkId);
  await t.mutation(internal.eventIntakeSources.completeArtwork, { actorUserId, artworkAssetId: artworkId, expectedVersion: 1, sha256: "b".repeat(64), byteLength: 100 });
  await t.run(({ db }) => db.patch(artworkId, { state: "expired" }));
  await t.mutation(internal.eventIntakeSources.recoverFailedArtworkWrite, { actorUserId, artworkAssetId: artworkId });
  assert.equal((await t.run(({ db }) => db.get(artworkId)))?.state, "deleting");
});

it("closes poster files to anyone the draft is closed to", async () => {
  const { t, ids, draft, poster } = await fixture();
  const held = await draft(newDraft);
  const personal = await t.run(({ db }) => db.insert("eventIntakeDrafts", { actorUserId: ids.owner, version: 1, fields: { title: "Mine" }, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + DAY }));
  const heldFiles = await poster(held);
  const personalFiles = await poster(personal, { actorUserId: ids.owner });
  const refused = async (actorUserId: Id<"users">, files: typeof heldFiles) => {
    await assert.rejects(t.query(internal.eventIntakeSources.readActorSource, { actorUserId, posterAssetId: files.sourceId }), /POSTER_NOT_FOUND/);
    await assert.rejects(t.mutation(internal.eventIntakeSources.completeArtwork, { actorUserId, artworkAssetId: files.artworkId, expectedVersion: 1, sha256: "b".repeat(64), byteLength: 100 }), /ARTWORK_NOT_FOUND/);
    await assert.rejects(t.mutation(internal.eventIntakeSources.recoverFailedArtworkWrite, { actorUserId, artworkAssetId: files.artworkId }), /ARTWORK_NOT_FOUND/);
  };
  await refused(ids.outsider, heldFiles);
  await refused(ids.staff, personalFiles);
  await t.run(({ db }) => db.patch(held, { resolvedAt: Date.now() }));
  await refused(ids.staff, heldFiles);
});

it("counts a manager's uploads on a connector draft against their own poster quota", async () => {
  const { ids, draft, upload } = await fixture();
  const draftId = await draft(newDraft);
  const max = 12 * 1024 * 1024;
  for (let n = 0; n < 5; n++) await upload(ids.second, draftId, max);
  await assert.rejects(upload(ids.second, draftId, max), /POSTER_QUOTA/);
  // The connector's own posters stay outside the authority's quota.
  for (let n = 0; n < 6; n++) await upload(ids.authority, draftId, max);
});

it("publishes a connector draft whose artwork belongs to another actor and has no poster field", async () => {
  const { t, ids, as, draft, poster } = await fixture();
  const draftId = await draft(publishable);
  const { sourceId, artworkId } = await poster(draftId, { inFields: false });
  const loaded = await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId });
  assert.equal(loaded?.artworkSourceId, sourceId);
  const { version } = await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 1, patch: { ...loaded!.fields, title: "Edited" } });
  const { eventId } = await t.run(ctx => publishIntakeDraft(ctx, ids.second, { draftId, expectedVersion: version, idempotencyKey: "held" }, Date.now(), "browser", { connectorId: ids.discord }));
  assert.equal((await t.run(({ db }) => db.get(eventId)))?.posterImageUrl, `/api/v0/events/${eventId}/artwork/${artworkId}`);
  assert.ok((await t.run(({ db }) => db.get(draftId)))?.resolvedAt);
});

it("refuses connector drafts on the personal publish routes", async () => {
  const { t, ids, as, draft } = await fixture();
  const draftId = await draft(publishable);
  const args = { draftId, expectedVersion: 1, idempotencyKey: "personal" };
  await assert.rejects(as("second").action(api.eventIntake.publishEventIntake, args), /DRAFT_ACCESS/);
  await assert.rejects(t.action(internal.eventIntake.publishActorIntake, { ...args, actorUserId: ids.authority, actorSurface: "api" }), /DRAFT_ACCESS/);
  await assert.rejects(t.mutation(internal.eventIntake.commitPublishIntake, { ...args, actorUserId: ids.owner }), /DRAFT_ACCESS/);
  await assert.rejects(as("outsider").action(api.eventIntake.publishEventIntake, args), /Draft not found/);
  assert.equal((await t.run(({ db }) => db.query("events").collect())).length, 1);
});

it("connector drafts stay out of the owner's inventory and draft quota", async () => {
  const { ids, as, draft } = await fixture();
  for (let n = 0; n < 20; n++) await draft(newDraft, { actorUserId: ids.owner });
  const rows: { kind: string }[] = [];
  let cursor: string | null = null;
  for (let done = false; !done;) {
    const page: { page: { kind: string }[]; isDone: boolean; continueCursor: string } = await as("owner").query(api.eventInventory.listPage, { view: "drafts", query: "", timeZone: "UTC", asOf: Date.parse("2026-10-22T12:00:00Z"), paginationOpts: { cursor, numItems: 50 } });
    rows.push(...page.page); done = page.isDone; cursor = page.continueCursor;
  }
  assert.equal(rows.filter(row => row.kind === "intake_draft").length, 0);
  await as("owner").mutation(api.eventIntake.saveEventIntakeDraft, { patch: { title: "Personal" } });
});

it("a poster change keeps a connector draft's import", async () => {
  const { t, ids, as, draft, upload } = await fixture();
  const draftId = await draft(newDraft);
  const { posterAssetId } = await upload(ids.second, draftId);
  await t.mutation(internal.eventIntakeSources.completePosterUpload, { actorUserId: ids.second, posterAssetId, sha256 });
  await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 1, patch: { posterSourceId: posterAssetId, questions: ["event.start: missing"] } });
  await as("second").mutation(api.eventIntake.saveEventIntakeDraft, { draftId, expectedVersion: 2, patch: { sourceText: "Edited post" } });
  const fields = (await as("second").query(api.eventIntake.getEventIntakeDraft, { draftId }))?.fields;
  assert.deepEqual([fields?.tentative, fields?.evidence, fields?.questions], [newDraft.tentative, newDraft.evidence, ["event.start: missing"]]);
});

const A = { clientKey: "a", position: 0, performerLabel: "A" };
const B = { clientKey: "b", position: 1, performerLabel: "B" };
const nine = { time: "21:00", dayOffset: 0 };

it("promotes extracted values under staff edits and pins the connector community", () => {
  assert.deepEqual(promoteHeldFields({ title: "Staff title", tentative: { title: "Extracted", communitySlug: "elsewhere", eventDate: "2027-07-20", timeTba: true }, evidence: [evidence("event.title")] }, "club"),
    { title: "Staff title", communitySlug: "club", eventDate: "2027-07-20", timeTba: true, tentative: null, evidence: null, questions: null });
  // A held tentative never carries timeTba: it follows from the promoted start.
  assert.equal(promoteHeldFields({ tentative: { eventDate: "2027-07-20" } }, "club").timeTba, true);
  assert.equal(promoteHeldFields({ tentative: { eventDate: "2027-07-20", start: nine } }, "club").timeTba, false);
  assert.equal(promoteHeldFields({ timeTba: false, tentative: { eventDate: "2027-07-20" } }, "club").timeTba, true);
  assert.equal(promoteHeldFields(publishable, "club").timeTba, true);
  assert.equal(promoteHeldFields({ title: "Saved", eventDate: "2027-07-20" }, "club").timeTba, true);
  // A staffer re-dated the draft: extracted clocks belong to the old date and are not promoted.
  const redated = promoteHeldFields({ eventDate: "2027-07-21", tentative: { eventDate: "2027-07-20", title: "Kept", start: nine, end: nine, doors: nine, timeTba: false, lineup: [A] } }, "club");
  assert.deepEqual(redated, { eventDate: "2027-07-21", title: "Kept", communitySlug: "club", timeTba: true, tentative: null, evidence: null, questions: null });
});

it("keeps a staffer's Time TBA over extracted clocks", () => {
  const promoted = promoteHeldFields({ timeTba: true, tentative: { title: "Afterglow Social", eventDate: "2027-07-20", timezone: "UTC", start: nine, end: { time: "23:00" }, doors: { time: "20:00" } } }, "club");
  assert.deepEqual([promoted.start, promoted.end, promoted.doors, promoted.timeTba], [undefined, undefined, undefined, true]);
  assert.equal(normalizeIntakePublication(promoted).schedule.scheduleKind, "date_only");
});

it("builds the update patch through rule 8's key selection", () => {
  const kind = "discord_announcements";
  assert.deepEqual(heldUpdatePatch({ tentative: { title: "T", start: nine, venueLabel: "V", communitySlug: "elsewhere", lineup: [A] },
    evidence: [evidence("event.title"), evidence("event.startDate"), evidence("event.venueLabel", "inferred"), evidence("event.communitySlug"), evidence("lineup.0.performerLabel")] }, kind),
    { title: "T", start: nine, timeTba: false, lineup: [A] });
  assert.deepEqual(heldUpdatePatch({ title: "Staff edit", tentative: { title: "T" }, evidence: [evidence("event.title")] }, kind), { title: "Staff edit" });
  assert.deepEqual(heldUpdatePatch({ tentative: { title: "T" }, evidence: [{ ...evidence("event.title"), assessment: "conflicting" }] }, kind), {});
  // Explicit evidence for a value now gone clears it, as an autopublish update does.
  assert.deepEqual(heldUpdatePatch({ tentative: { eventDate: "2027-07-15" }, evidence: [evidence("event.venueLabel"), evidence("event.start")] }, "google_calendar"), { start: null, timeTba: true, venueLabel: null });
});

it("counts what a staffer saved as update keys, and only that without evidence", () => {
  const saved = { title: "Edited", doors: nine, worldSlug: "harbor-world", summary: null };
  assert.deepEqual(heldUpdatePatch({ ...saved, tentative: { title: "T", start: nine }, evidence: [evidence("event.start")] }, "google_calendar"),
    { title: "Edited", doors: nine, worldSlug: "harbor-world", start: nine, timeTba: false });
  assert.deepEqual(heldUpdatePatch({ ...saved, tentative: null, evidence: null }, "google_calendar"), { title: "Edited", doors: nine, worldSlug: "harbor-world" });
});

it("never carries a Discord message URL onto the event", () => {
  const url = "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333";
  for (const fields of [{ sourceUrl: url }, { tentative: { sourceUrl: url }, evidence: [evidence("event.sourceUrl")] }]) {
    assert.deepEqual(heldUpdatePatch(fields, "discord_announcements"), {});
    assert.deepEqual(heldUpdatePatch(fields, "discord_board"), { sourceUrl: url });
  }
});

it("does not clear event clocks a re-dated draft declined to promote", () => {
  assert.deepEqual(heldUpdatePatch({ eventDate: "2027-07-21", tentative: { eventDate: "2027-07-20", start: nine, lineup: [A] }, evidence: [evidence("event.start"), evidence("event.eventDate"), evidence("lineup.0.performerLabel")] }, "discord_announcements"),
    { eventDate: "2027-07-21" });
});

it("reports only changed fields, with instants for clocks", () => {
  const current: EventIntakePatch = { title: "Harbor Night", eventDate: "2027-07-15", timezone: "UTC", start: { time: "20:00", dayOffset: 0 }, venueLabel: "Hand-set hall", lineup: [A] };
  assert.deepEqual(heldChanges(current, { title: "Harbor Night", start: nine, lineup: [A, B] }), [
    { field: "start", before: Date.UTC(2027, 6, 15, 20), after: Date.UTC(2027, 6, 15, 21) },
    { field: "lineup", before: "A", after: "A, B" },
  ]);
  assert.deepEqual(heldChanges(current, { lineup: [{ ...A, clientKey: "other" }] }), []);
  assert.deepEqual(heldChanges(current, { start: { time: "20:00" }, timeTba: null }), []);
  // A clock that cannot resolve shows no instant, and each side reads in its own date.
  assert.deepEqual(heldChanges(current, { eventDate: "2027-07-16", start: nine, timezone: "Not/AZone" }), [
    { field: "eventDate", before: "2027-07-15", after: "2027-07-16" },
    { field: "timezone", before: "UTC", after: "Not/AZone" },
    { field: "start", before: Date.UTC(2027, 6, 15, 20), after: null },
  ]);
  assert.deepEqual(heldChanges(current, { eventDate: "2027-07-16", start: nine }).at(-1), { field: "start", before: Date.UTC(2027, 6, 15, 20), after: Date.UTC(2027, 6, 16, 21) });
});

it("reports every change field in declared order", () => {
  const current: EventIntakePatch = { title: "T", eventDate: "2027-07-15", timeTba: true, timezone: "UTC", summary: "S", sourceUrl: "https://a.example", venueLabel: "V", worldSlug: "old", lineup: [A] };
  assert.deepEqual(heldChanges(current, { title: "U", eventDate: "2027-07-15", timeTba: false, timezone: "UTC", start: nine, end: { time: "23:00" }, doors: { time: "20:00" }, venueLabel: null, worldSlug: "new", summary: "R", sourceUrl: "https://b.example", lineup: [B] }), [
    { field: "title", before: "T", after: "U" },
    { field: "timeTba", before: "Time TBA", after: null },
    { field: "start", before: null, after: Date.UTC(2027, 6, 15, 21) },
    { field: "end", before: null, after: Date.UTC(2027, 6, 15, 23) },
    { field: "doors", before: null, after: Date.UTC(2027, 6, 15, 20) },
    { field: "venueLabel", before: "V", after: null },
    { field: "worldSlug", before: "old", after: "new" },
    { field: "summary", before: "S", after: "R" },
    { field: "sourceUrl", before: "https://a.example", after: "https://b.example" },
    { field: "lineup", before: "A", after: "B" },
  ]);
  assert.deepEqual(heldChanges({ ...current, timeTba: false }, { timeTba: true }), [{ field: "timeTba", before: null, after: "Time TBA" }]);
});

it("lists a held new draft with its Discord provenance and never an autopublished one", async () => {
  const { as, draft, discordSource, autopublished, now } = await fixture();
  const draftId = await draft(newDraft);
  await discordSource(draftId);
  await discordSource(await autopublished(newDraft), { kind: "new" }, "444444444444444444");
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), [{
    kind: "new", draftId, title: "Afterglow Social", schedule: { kind: "date_only", eventDate: "2027-07-20" },
    community: { slug: "club", displayName: "Club" }, connectorKind: "discord_announcements", targetName: "#events",
    author: "Promoter", sourceUrl: "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333",
    openHref: `/events/new?draft=${draftId}`, updatedAt: now,
  }]);
});

it("takes provenance from a draft's first post", async () => {
  const { t, ids, as, draft, discordSource } = await fixture();
  const draftId = await draft(newDraft);
  await discordSource(draftId);
  await discordSource(draftId, { kind: "new" }, "444444444444444444");
  await t.run(async ({ db }) => {
    const later = (await db.query("discordIntakeMessages").withIndex("by_connectorId_messageId", q => q.eq("connectorId", ids.discord).eq("messageId", "444444444444444444")).unique())!;
    await db.patch(later._id, { authorDisplayName: "Later" });
  });
  const [row] = await as("staff").query(api.eventInventory.listHeldImports, {});
  assert.ok(row?.kind === "new");
  assert.deepEqual([row.author, row.sourceUrl], ["Promoter", "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333"]);
});

it("leaves a run's in-flight working draft off the list", async () => {
  const { t, ids, as, draft } = await fixture();
  const working = await draft({ sourceText: "Afterglow Social", sourceUrl: "https://discord.com/channels/1/2/3" });
  await t.run(({ db }) => db.insert("discordIntakeRuns", { connectorId: ids.discord, authorId: "555555555555555555", triggerMessageIds: ["333333333333333333"], state: "running", draftId: working, createdAt: Date.now() }));
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), []);
});

it("lists drafts on a removed connector but not expired or resolved ones", async () => {
  const { t, ids, as, draft, now } = await fixture();
  const link = (draftId: Id<"eventIntakeDrafts">, externalId: string) => t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId, externalId, state: "linked", createdAt: now, updatedAt: now }));
  const kept = await draft(newDraft, { connectorId: ids.google });
  await link(kept, "g-1");
  await link(await draft(newDraft, { connectorId: ids.google, expiresAt: now - 1 }), "g-2");
  await link(await draft(newDraft, { connectorId: ids.google, resolvedAt: now }), "g-3");
  await t.run(({ db }) => db.patch(ids.google, { state: "removed" }));
  const rows = await as("staff").query(api.eventInventory.listHeldImports, {});
  assert.deepEqual(rows.map(row => row.kind === "new" && [row.draftId, row.targetName]), [[kept, "club@group.calendar.google.com"]]);
});

it("lists proposed updates from a linked draft and from a run decision with the explicit diff", async () => {
  const { t, ids, as, draft, discordSource } = await fixture();
  const linked = await draft(updateDraft, { connectorId: ids.google });
  await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId: linked, eventId: ids.event, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const decided = await draft(updateDraft);
  await discordSource(decided, { kind: "update", slug: "harbor" });
  const rows = await as("second").query(api.eventInventory.listHeldImports, { communityProfileId: ids.community });
  for (const draftId of [linked, decided]) {
    const row = rows.find(item => item.kind === "update" && item.draftId === draftId);
    assert.ok(row?.kind === "update");
    assert.deepEqual(row.target, { slug: "harbor", title: "Harbor Night", href: "/club/events/harbor/edit" });
    assert.deepEqual(row.changes, [{ field: "start", before: Date.UTC(2027, 6, 15, 20), after: Date.UTC(2027, 6, 15, 21) }]);
  }
  const googleRow = rows.find(item => item.kind === "update" && item.draftId === linked);
  assert.ok(googleRow?.kind === "update");
  assert.deepEqual([googleRow.author, googleRow.sourceUrl, googleRow.targetName], [null, null, "club@group.calendar.google.com"]);
});

it("reads the newest run's decision and shows a new row when the target is unusable", async () => {
  const { t, ids, as, draft, discordSource, now } = await fixture();
  const kind = async (draftId: Id<"eventIntakeDrafts">) => (await as("staff").query(api.eventInventory.listHeldImports, {})).find(row => row.kind !== "flag" && row.draftId === draftId)?.kind;
  const newest = await draft(updateDraft);
  await discordSource(newest, { kind: "new" });
  await discordSource(newest, { kind: "update", slug: "harbor" }, "444444444444444444");
  assert.equal(await kind(newest), "update");
  const elsewhere = await t.run(async ({ db }) => {
    const other = await db.insert("profiles", { slug: "other", displayName: "Other", sortName: "other", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
    return db.insert("events", { communityProfileId: other, communityName: "Other", title: "Other Night", sortTitle: "other night", slug: "other-night", scheduleKind: "date_only", eventDate: "2027-08-01", sortAt: Date.UTC(2027, 7, 1), sourceType: "community", sourceLabel: "Other", eventStatus: "scheduled", publicationState: "published", createdAt: now, updatedAt: now });
  });
  const foreign = await draft(updateDraft);
  await discordSource(foreign, { kind: "update", slug: "other-night" }, "555555555555555556");
  const linkedElsewhere = await draft(updateDraft, { connectorId: ids.google });
  await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.google, draftId: linkedElsewhere, eventId: elsewhere, externalId: "g-1", state: "linked", createdAt: now, updatedAt: now }));
  assert.deepEqual([await kind(foreign), await kind(linkedElsewhere)], ["new", "new"]);
  await t.run(({ db }) => db.patch(ids.event, { moderationRemovedAt: now }));
  assert.equal(await kind(newest), "new");
});

it("lists staff-attention rows from deleted links, one per event and reason", async () => {
  const { t, ids, as, draft, now } = await fixture();
  const { pier, gone } = await t.run(async ({ db }) => {
    const event = (slug: string, title: string, extra: { moderationRemovedAt?: number } = {}) => db.insert("events", { communityProfileId: ids.community, communityName: "Club", title, sortTitle: title.toLowerCase(), slug, scheduleKind: "date_only", eventDate: "2027-08-01", sortAt: Date.UTC(2027, 7, 1), sourceType: "community", sourceLabel: "Club", eventStatus: "scheduled", publicationState: "published", createdAt: now, updatedAt: now, ...extra });
    const [pier, removed, gone] = [await event("pier", "Pier Night"), await event("removed", "Removed", { moderationRemovedAt: now }), await event("gone", "Gone")];
    const link = (connectorId: Id<"eventConnectors">, externalId: string, values: { eventId?: Id<"events">; flagReviewedAt?: number }) => db.insert("eventSyncLinks", { connectorId, externalId, state: "external_deleted", createdAt: now, updatedAt: now, ...values });
    await link(ids.google, "g-1", { eventId: ids.event });
    await link(ids.discord, "333333333333333333", { eventId: pier });
    await link(ids.discord, "444444444444444444", { eventId: pier });
    await link(ids.google, "g-2", { eventId: pier, flagReviewedAt: now });
    await link(ids.google, "g-3", { eventId: removed });
    await link(ids.google, "g-4", { eventId: gone });
    await link(ids.google, "g-5", {});
    return { pier, gone };
  });
  await t.run(({ db }) => db.delete(gone));
  await draft(newDraft);
  const flags = (await as("staff").query(api.eventInventory.listHeldImports, {})).filter(row => row.kind === "flag");
  assert.deepEqual(flags.map(row => row.kind === "flag" && [row.eventId, row.reason, row.title, row.href, row.connectorKind, row.updatedAt]).sort(), [
    [ids.event, "external_deleted", "Harbor Night", "/club/events/harbor/edit", "google_calendar", now],
    [pier, "source_deleted", "Pier Night", "/club/events/pier/edit", "discord_announcements", now],
  ].sort());
});

it("sorts newest first and caps the list", async () => {
  const { t, ids, as, draft, now } = await fixture();
  for (let n = 0; n <= HELD_IMPORT_LIMIT; n++) {
    const connectorId = n % 2 ? ids.discord : ids.google;
    const draftId = await draft(newDraft, { connectorId, updatedAt: now + n });
    await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId, draftId, externalId: `e-${n}`, state: "linked", createdAt: now, updatedAt: now }));
  }
  const rows = await as("staff").query(api.eventInventory.listHeldImports, {});
  assert.equal(rows.length, HELD_IMPORT_LIMIT);
  assert.deepEqual([rows[0]?.updatedAt, rows.at(-1)?.updatedAt], [now + HELD_IMPORT_LIMIT, now + 1]);
});

it("shows nothing to staff without manage_events", async () => {
  const { t, ids, as, draft } = await fixture();
  const draftId = await draft(newDraft);
  await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.discord, draftId, externalId: "m-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  assert.equal((await as("owner").query(api.eventInventory.listHeldImports, {})).length, 1);
  for (const name of ["authority", "outsider"]) {
    assert.deepEqual(await as(name).query(api.eventInventory.listHeldImports, {}), []);
    await assert.rejects(as(name).query(api.eventInventory.listHeldImports, { communityProfileId: ids.community }), /access/);
  }
});

const discordMessageUrl = "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333";
const exportJobs = (t: Awaited<ReturnType<typeof fixture>>["t"], eventId: Id<"events">) => t.run(async ({ db }) => (await db.query("eventSyncJobs").collect()).filter(job => job.eventId === eventId && job.state === "pending").map(job => job.kind));

it("a second manager publishes a held draft as the community and is the receipt actor", async () => {
  const { t, ids, as, draft, discordSource, poster } = await fixture();
  const draftId = await draft({ ...newDraft, tentative: { ...newDraft.tentative, communitySlug: "elsewhere" } });
  await discordSource(draftId);
  await discordSource(draftId, { kind: "new" }, "444444444444444444");
  const { artworkId } = await poster(draftId);
  await assert.rejects(as("authority").mutation(api.eventIntakeHeld.publish, { draftId }), /Draft not found/);
  const result = await as("second").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.equal(result.outcome, "published");
  await t.run(async ({ db }) => {
    const event = (await db.get(result.eventId))!;
    assert.deepEqual([event.communityProfileId, event.title, event.eventDate, event.scheduleKind], [ids.community, "Afterglow Social", "2027-07-20", "date_only"]);
    assert.equal(event.sourceType, "community");
    assert.equal(event.posterImageUrl, `/api/v0/events/${result.eventId}/artwork/${artworkId}`);
    assert.equal(result.eventPath, `/club/events/${event.slug}`);
    const receipt = await db.query("eventContributionReceipts").withIndex("by_eventId", q => q.eq("eventId", result.eventId)).unique();
    assert.equal(receipt?.actorUserId, ids.second);
    assert.ok((await db.get(draftId))?.resolvedAt);
    const sources = await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draftId)).collect();
    assert.deepEqual(sources.map(source => source.eventId), [result.eventId, result.eventId]);
  });
  await assert.rejects(as("staff").mutation(api.eventIntakeHeld.publish, { draftId }), /Draft not found/);
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), []);
  assert.equal((await t.run(({ db }) => db.query("events").collect())).length, 2);
});

it("publishes a poster-only Discord draft through the row", async () => {
  const { t, as, draft, discordSource, poster } = await fixture();
  const draftId = await draft(newDraft);
  await discordSource(draftId);
  const { artworkId } = await poster(draftId, { inFields: false });
  const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.equal((await t.run(({ db }) => db.get(eventId)))?.posterImageUrl, `/api/v0/events/${eventId}/artwork/${artworkId}`);
});

it("applies only explicit fields of a proposed update and relinks", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const draftId = await draft(updateDraft, { connectorId: ids.google });
  const linkId = await googleLink({ draftId, eventId: ids.event });
  const result = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.deepEqual(result, { outcome: "updated", eventId: ids.event, eventPath: "/club/events/harbor" });
  await t.run(async ({ db }) => {
    const event = (await db.get(ids.event))!;
    assert.equal(event.startAt, Date.UTC(2027, 6, 15, 21));
    assert.equal(event.venueLabel, "Hand-set hall");
    const link = (await db.get(linkId))!;
    assert.deepEqual([link.eventId, link.draftId], [ids.event, undefined]);
    assert.ok((await db.get(draftId))?.resolvedAt);
    const audit = await db.query("eventAuditEvents").withIndex("by_eventId_createdAt", q => q.eq("eventId", ids.event)).order("desc").first();
    assert.equal(audit?.actorUserId, ids.staff);
  });
});

it("publishing a run-decided update links the event on every source", async () => {
  const { t, ids, as, draft, discordSource } = await fixture();
  const draftId = await draft(updateDraft);
  await discordSource(draftId, { kind: "update", slug: "harbor" });
  await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.discord, draftId, externalId: "333333333333333333", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  await t.run(async ({ db }) => {
    assert.equal((await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", ids.event)).unique())?.externalId, "333333333333333333");
    assert.equal((await db.query("discordIntakeSources").withIndex("by_draftId", q => q.eq("draftId", draftId)).unique())?.eventId, ids.event);
  });
});

it("a held update that changes nothing still releases the skipped export", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  await t.run(({ db }) => db.patch(ids.google, { direction: "bidirectional" }));
  const unchanged = { ...updateDraft, tentative: { ...updateDraft.tentative, start: { time: "20:00", dayOffset: 0 } } };
  const draftId = await draft(unchanged, { connectorId: ids.google });
  await googleLink({ draftId, eventId: ids.event });
  const updatedAt = (await t.run(({ db }) => db.get(ids.event)))!.updatedAt;
  await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.equal((await t.run(({ db }) => db.get(ids.event)))!.updatedAt, updatedAt);
  assert.deepEqual(await exportJobs(t, ids.event), ["export_upsert"]);
});

it("keeps drafts on a paused or removed connector publishable", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const [fresh, update] = [await draft(newDraft), await draft(updateDraft, { connectorId: ids.google })];
  await googleLink({ draftId: update, eventId: ids.event });
  await t.run(async ({ db }) => { await db.patch(ids.discord, { state: "paused" }); await db.patch(ids.google, { state: "removed" }); });
  assert.equal((await as("staff").mutation(api.eventIntakeHeld.publish, { draftId: fresh })).outcome, "published");
  assert.equal((await as("staff").mutation(api.eventIntakeHeld.publish, { draftId: update })).outcome, "updated");
});

it("rolls everything back when publication refuses the draft", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const draftId = await draft({ tentative: { eventDate: "2027-07-20" } }, { connectorId: ids.google });
  const linkId = await googleLink({ draftId });
  await assert.rejects(as("staff").mutation(api.eventIntakeHeld.publish, { draftId }), /title/);
  await t.run(async ({ db }) => {
    const row = (await db.get(draftId))!;
    assert.deepEqual([row.version, row.resolvedAt, row.fields.tentative?.eventDate], [1, undefined, "2027-07-20"]);
    assert.equal((await db.get(linkId))?.draftId, draftId);
  });
});

it("editor publish takes only what the staffer saved", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const fresh = await draft({ communitySlug: "elsewhere", title: "Reviewed", eventDate: "2027-07-20", timeTba: true, tentative: { title: "Extracted", summary: "Never accepted" }, evidence: [evidence("event.summary")] });
  const update = await draft({ summary: "Saved", tentative: { start: nine, timezone: "UTC", eventDate: "2027-07-15" }, evidence: [evidence("event.start")] }, { connectorId: ids.google });
  await googleLink({ draftId: update, eventId: ids.event });
  await assert.rejects(as("staff").mutation(api.eventIntakeHeld.publish, { draftId: fresh, expectedVersion: 2 }), /VERSION_CONFLICT/);
  const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId: fresh, expectedVersion: 1 });
  await as("staff").mutation(api.eventIntakeHeld.publish, { draftId: update, expectedVersion: 1 });
  await t.run(async ({ db }) => {
    const event = (await db.get(eventId))!;
    assert.deepEqual([event.title, event.summary, event.communityProfileId], ["Reviewed", undefined, ids.community]);
    const patched = (await db.get(ids.event))!;
    assert.deepEqual([patched.summary, patched.startAt], ["Saved", Date.UTC(2027, 6, 15, 20)]);
  });
});

for (const [name, expectedVersion, saved] of [["editor", 1, {}], ["row", undefined, {}], ["row, leftover false", undefined, { timeTba: false }]] as const) it(`a saved draft with no start keeps the event's clock (${name})`, async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const draftId = await draft({ ...saved, title: "Reviewed", eventDate: "2027-07-15", tentative: { title: "Extracted" }, evidence: [evidence("event.title")] }, { connectorId: ids.google });
  await googleLink({ draftId, eventId: ids.event });
  await as("staff").mutation(api.eventIntakeHeld.publish, { draftId, expectedVersion });
  const event = (await t.run(({ db }) => db.get(ids.event)))!;
  assert.deepEqual([event.title, event.scheduleKind, event.startAt], ["Reviewed", "timed", Date.UTC(2027, 6, 15, 20)]);
});

for (const [name, saved] of [
  ["accepted date", { communitySlug: "club", title: "Held", eventDate: "2027-07-20", tentative: { communitySlug: "club" } }],
  ["re-dated", { title: "Held", eventDate: "2027-07-20", tentative: { eventDate: "2027-07-13", timezone: "UTC", start: nine } }],
  ["no import", { title: "Held", eventDate: "2027-07-20" }],
  ["cleared start", { title: "Held", eventDate: "2027-07-20", timeTba: false }],
] as const) it(`row Publish after an editor save goes date-only (${name})`, async () => {
  const { t, as, draft } = await fixture();
  const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId: await draft(saved) });
  const event = (await t.run(({ db }) => db.get(eventId)))!;
  assert.deepEqual([event.scheduleKind, event.eventDate, event.startAt], ["date_only", "2027-07-20", undefined]);
});

it("editor publish reads a new item's missing Time TBA from its saved start", async () => {
  const { t, as, draft } = await fixture();
  const dated = await draft({ title: "Dated", eventDate: "2027-07-20" });
  const timed = await draft({ title: "Timed", eventDate: "2027-07-21", timezone: "UTC", start: nine });
  const schedule = async (draftId: Id<"eventIntakeDrafts">) => {
    const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId, expectedVersion: 1 });
    return (await t.run(({ db }) => db.get(eventId)))?.scheduleKind;
  };
  assert.deepEqual([await schedule(dated), await schedule(timed)], ["date_only", "timed"]);
});

it("a saved Time TBA clears the event's clock on a proposed update", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  const draftId = await draft({ ...updateDraft, timeTba: true }, { connectorId: ids.google });
  await googleLink({ draftId, eventId: ids.event });
  await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  const event = (await t.run(({ db }) => db.get(ids.event)))!;
  assert.deepEqual([event.scheduleKind, event.startAt, event.eventDate], ["date_only", undefined, "2027-07-15"]);
});

it("publishes an extracted link over the Discord post's own URL", async () => {
  const { t, as, draft } = await fixture();
  assert.equal(promoteHeldFields({ sourceUrl: "https://example.com/saved", tentative: { sourceUrl: "https://example.com/extracted" } }, "club").sourceUrl, "https://example.com/saved");
  assert.equal(promoteHeldFields({ sourceUrl: discordMessageUrl }, "club").sourceUrl, discordMessageUrl);
  const draftId = await draft({ ...newDraft, sourceUrl: discordMessageUrl, tentative: { ...newDraft.tentative, sourceUrl: "https://example.com/extracted" } });
  const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  assert.equal((await t.run(({ db }) => db.get(eventId)))?.sourceUrl, "https://example.com/extracted");
});

it("a candidate with an end and no start publishes date-only", async () => {
  const { t, as, draft } = await fixture();
  const draftId = await draft({ ...newDraft, tentative: { ...newDraft.tentative, timezone: "UTC", end: { time: "23:00" }, doors: { time: "20:00" } } });
  const { eventId } = await as("staff").mutation(api.eventIntakeHeld.publish, { draftId });
  const event = (await t.run(({ db }) => db.get(eventId)))!;
  assert.deepEqual([event.scheduleKind, event.endAt], ["date_only", undefined]);
  // A false left behind with no start is still date-only, so the extracted end goes too.
  const cleared = promoteHeldFields({ timeTba: false, tentative: { end: { time: "23:00" } } }, "club");
  assert.deepEqual([cleared.end, cleared.timeTba], [undefined, true]);
});

it("a proposed update keeps an extracted end for the event's own start", () => {
  const end = { time: "23:00", dayOffset: 0 };
  assert.deepEqual(heldUpdatePatch({ tentative: { end }, evidence: [evidence("event.end")] }, "google_calendar"), { end });
  assert.deepEqual(heldUpdatePatch({ timeTba: true, tentative: { end }, evidence: [evidence("event.end")] }, "google_calendar"), { end: null, timeTba: true });
  assert.deepEqual(heldUpdatePatch({ tentative: { end }, evidence: [evidence("event.end"), evidence("event.start")] }, "google_calendar"), { start: null, end: null, timeTba: true });
});

it("dismiss hides a held draft, frees its link, and keeps the row for thirty days", async () => {
  const { t, ids, as, draft, googleLink } = await fixture();
  await t.run(({ db }) => db.patch(ids.google, { direction: "bidirectional" }));
  const draftId = await draft(updateDraft, { connectorId: ids.google });
  const linkId = await googleLink({ draftId, eventId: ids.event });
  await assert.rejects(as("outsider").mutation(api.eventIntakeHeld.dismiss, { draftId }), /Draft not found/);
  assert.equal(await as("staff").mutation(api.eventIntakeHeld.dismiss, { draftId }), null);
  assert.deepEqual(await as("staff").query(api.eventInventory.listHeldImports, {}), []);
  await assert.rejects(as("staff").mutation(api.eventIntakeHeld.dismiss, { draftId }), /Draft not found/);
  assert.deepEqual(await exportJobs(t, ids.event), ["export_upsert"]);
  await t.run(async ({ db }) => {
    const row = (await db.get(draftId))!;
    assert.ok(row.dismissedAt);
    assert.equal(row.resolvedAt, row.dismissedAt);
    assert.equal(row.expiresAt, row.dismissedAt! + EVENT_INTAKE_DRAFT_TTL_MS);
    const link = (await db.get(linkId))!;
    assert.deepEqual([link.draftId, link.eventId, link.updatedAt], [undefined, ids.event, row.dismissedAt]);
    await db.patch(draftId, { expiresAt: Date.now() - 1 });
  });
  await t.mutation(internal.eventIntake.expireDrafts, {});
  assert.equal(await t.run(({ db }) => db.get(draftId)), null);
});

it("Keep clears the deletion flag for that event without touching the link's state", async () => {
  const { t, ids, as, googleLink } = await fixture();
  const google = await googleLink({ eventId: ids.event, state: "external_deleted" });
  const discord = await t.run(({ db }) => db.insert("eventSyncLinks", { connectorId: ids.discord, eventId: ids.event, externalId: "333333333333333333", state: "external_deleted", createdAt: Date.now(), updatedAt: Date.now() }));
  await assert.rejects(as("outsider").mutation(api.eventIntakeHeld.dismissFlag, { eventId: ids.event }), /access/);
  assert.equal((await as("staff").query(api.eventInventory.listHeldImports, {})).filter(row => row.kind === "flag").length, 2);
  assert.equal(await as("staff").mutation(api.eventIntakeHeld.dismissFlag, { eventId: ids.event }), null);
  assert.deepEqual((await as("staff").query(api.eventInventory.listHeldImports, {})).filter(row => row.kind === "flag"), []);
  await t.run(async ({ db }) => {
    for (const id of [google, discord]) {
      const link = (await db.get(id))!;
      assert.deepEqual([link.state, Boolean(link.flagReviewedAt)], ["external_deleted", true]);
    }
  });
});
