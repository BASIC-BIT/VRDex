import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { EventIntakePatch } from "../../packages/api-contracts/src/event-intake";
import { getConnectorDraftForManager, publishIntakeDraft } from "../../convex/_eventIntake";

process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
process.env.EVENT_DATE_ONLY_ENABLED = "true";
process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const DAY = 86_400_000;
const sha256 = "a".repeat(64);
const evidence = (fieldPath: string, assessment: "explicit" | "inferred" = "explicit") => ({ fieldPath, origin: "text" as const, excerpt: null, assessment });
const newDraft: EventIntakePatch = { communitySlug: "club", tentative: { communitySlug: "club", title: "Afterglow Social", eventDate: "2027-07-20", timeTba: true }, evidence: [evidence("event.title"), evidence("event.eventDate")] };
const publishable: EventIntakePatch = { communitySlug: "club", title: "Afterglow Social", eventDate: "2027-07-20", timeTba: true };

async function fixture() {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/eventInventory.ts": () => import("../../convex/eventInventory"),
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
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
  return { t, ids, as, draft, discordSource, poster, autopublished, upload, now };
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
