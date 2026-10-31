import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { buildSourceText, pickPosterAttachments } from "../../convex/_discordIntake";
import { saveIntakeDraft } from "../../convex/_eventIntake";
import { dismissHeldDraft } from "../../convex/_eventIntakeHeld";
import { failureReason } from "../../convex/discordIntakeRun";
import { EVENT_POSTER_MAX_BYTES, resolveEventLocalTime } from "../../packages/api-contracts/src/event-intake";
import { newClerkUserId } from "./_clerkTestIdentity";
import { AUTHOR_B, CHANNEL, GUILD, M1, M2, message, record, revokeManageIntegrations, seedCommunity, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];

beforeEach(test => {
  test.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
});
const M3 = "300000000000000003";
const M4 = "300000000000000004";
const dateIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
// An event a week out, so it falls inside the agent's listing window.
const EVENT_DATE = dateIn(7);

/** A published community event created by a separate owner of the community, as plan 02's apply tests do. */
async function seedEvent(t: T, communityProfileId: Id<"profiles">, { slug, title = "Night at Ari", venueLabel, daysOut = 7, communitySlug = "night-club" }: { slug: string; title?: string; venueLabel?: string; daysOut?: number; communitySlug?: string }) {
  const subject = newClerkUserId();
  await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const [startAt] = resolveEventLocalTime(dateIn(daysOut), { time: "21:00" }, "Europe/London");
  const { eventId } = await t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true })
    .mutation(api.events.createCommunityEvent, { title, startAt, timezone: "Europe/London", communitySlug, published: true, venueLabel });
  await t.run(ctx => ctx.db.patch(eventId, { slug }));
  return eventId;
}

/** The rows an earlier finished run leaves behind for `messageId`. */
const linkEvent = (t: T, connectorId: Id<"eventConnectors">, eventId: Id<"events">, messageId: string) => t.run(async ctx => {
  const now = Date.now();
  const runId = await ctx.db.insert("discordIntakeRuns", { connectorId, authorId: "200000000000000001", triggerMessageIds: [messageId], state: "done", eventId, createdAt: now - 3_600_000 });
  await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: messageId, state: "linked", createdAt: now, updatedAt: now });
  await ctx.db.insert("discordIntakeSources", { connectorId, messageId, externalId: messageId, eventId, runId, createdAt: now });
  return runId;
});

const pendingRun = (t: T) => t.run(async ctx => (await ctx.db.query("discordIntakeRuns").collect()).find(run => run.state === "pending")!);
const getRun = (t: T, runId: Id<"discordIntakeRuns">) => t.run(async ctx => (await ctx.db.get(runId))!);
const candidate = (decision: unknown) => ({
  event: { title: "Night at Ari", communitySlug: "night-club", eventDate: EVENT_DATE, start: "22:00", end: null, startDate: null, endDate: null, timezone: "Europe/London", venueLabel: "Other Room", summary: null, sourceUrl: null },
  lineup: [], questions: [], decision,
  evidence: [
    { fieldPath: "event.start", origin: "text", excerpt: "now 22:00", assessment: "explicit" },
    { fieldPath: "event.venueLabel", origin: "text", excerpt: null, assessment: "inferred" },
  ],
});

it("labels new posts with their IDs apart from earlier context, and drops context first at the cap", () => {
  const rows = [
    { messageId: M2, authorDisplayName: "Ari", content: "flyer", createdAt: Date.UTC(2026, 10, 1, 20, 1) },
    { messageId: M1, authorDisplayName: "Ari", content: "Friday 9pm", createdAt: Date.UTC(2026, 10, 1, 20, 0) },
    { messageId: M3, authorDisplayName: "Ari", content: "oops", createdAt: 0, deletedAt: 1 },
  ] as Doc<"discordIntakeMessages">[];
  assert.equal(buildSourceText(rows, [M2, M3]), `New or changed posts:\n[message ${M2}] Ari (2026-11-01T20:01:00.000Z): flyer\n\nEarlier posts, for context only:\nAri (2026-11-01T20:00:00.000Z): Friday 9pm`);
  assert.equal(buildSourceText(rows, [M1, M2]), `New or changed posts:\n[message ${M1}] Ari (2026-11-01T20:00:00.000Z): Friday 9pm\n[message ${M2}] Ari (2026-11-01T20:01:00.000Z): flyer`);
  const longContext = buildSourceText([rows[0], { ...rows[1], content: "x".repeat(12_000) }], [M2]);
  assert.ok(longContext.includes("flyer") && !longContext.includes("xxx") && !longContext.includes("Earlier posts"));
  const longTrigger = buildSourceText([{ ...rows[0], content: "x".repeat(12_000) }, rows[1]], [M2]);
  assert.ok(longTrigger.length <= 12_000 && longTrigger.startsWith("New or changed posts:\n[message"));
});

it("picks at most three poster images, trigger posts first, each group largest first", () => {
  const image = (byteLength: number, contentType = "image/png") => ({ url: `https://cdn.discordapp.com/${byteLength}`, contentType, byteLength });
  const rows = [
    { attachments: [image(10), image(50, "image/gif"), image(EVENT_POSTER_MAX_BYTES + 1)] },
    { attachments: [image(30, "image/webp"), image(20, "image/jpeg"), image(40)] },
    { attachments: [image(99)], deletedAt: 1 },
  ] as Doc<"discordIntakeMessages">[];
  assert.deepEqual(pickPosterAttachments(rows).map(item => item.byteLength), [40, 30, 20]);
  assert.deepEqual(pickPosterAttachments(rows.slice(0, 1), rows.slice(1)).map(item => item.byteLength), [10, 40, 30]);
});

it("passes prior events from discordIntakeSources to the agent", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  const claim = await t.mutation(internal.discordIntake.claimRun, { runId });
  assert.equal(claim.kind, "run");
  if (claim.kind !== "run") return;
  assert.deepEqual(claim.context, { trigger: "discord", communitySlug: "night-club", connectorId, mode: "hold", priorEvents: [{ sourceMessageId: M1, eventSlug: "night-at-ari" }] });
  assert.equal(claim.sourceUrl, `https://discord.com/channels/${GUILD}/${CHANNEL}/${M1}`);
});

it("list_events puts this run's prior events first and drops unpublished and removed events", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  await seedEvent(t, communityProfileId, { slug: "soon-night", title: "Soon Night", daysOut: 2 });
  // Prior events are listed even outside the date window.
  const priorId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", daysOut: 120 });
  const hiddenId = await seedEvent(t, communityProfileId, { slug: "hidden-night", title: "Hidden Night", daysOut: 3 });
  const removedId = await seedEvent(t, communityProfileId, { slug: "removed-night", title: "Removed Night", daysOut: 4 });
  await t.run(async ctx => {
    await ctx.db.patch(hiddenId, { publicationState: "draft_private" });
    await ctx.db.patch(removedId, { moderationRemovedAt: Date.now() });
  });
  await linkEvent(t, connectorId, priorId, M1);
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  const rows = await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 100 });
  assert.deepEqual(rows.map(row => row.slug), ["night-at-ari", "soon-night"]);
  assert.deepEqual(rows[1], { slug: "soon-night", title: "Soon Night", eventDate: dateIn(2), start: "21:00", lineupSummary: "" });
  assert.deepEqual((await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 1 })).map(row => row.slug), ["night-at-ari"]);
});

it("get_event returns public fields of the connector community's published events only", async () => {
  const { t, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  const hiddenId = await seedEvent(t, communityProfileId, { slug: "hidden-night", title: "Hidden Night", daysOut: 3 });
  await t.run(ctx => ctx.db.patch(hiddenId, { publicationState: "draft_private" }));
  const otherCommunityId = await seedCommunity(t, { slug: "other-club", displayName: "Other Club" });
  await seedEvent(t, otherCommunityId, { slug: "other-night", title: "Other Night", communitySlug: "other-club" });
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  const read = await t.query(internal.discordIntake.getEventForAgent, { runId, slug: "night-at-ari" });
  assert.equal(read!.updatedAt, (await t.run(ctx => ctx.db.get(eventId)))!.updatedAt);
  assert.equal(read!.fields.venueLabel, "Main Hall");
  for (const key of ["sourceText", "posterSourceId", "posterDeclaration", "tentative", "evidence", "questions"]) assert.ok(!(key in read!.fields), key);
  for (const slug of ["hidden-night", "other-night", "no-such-night"]) assert.equal(await t.query(internal.discordIntake.getEventForAgent, { runId, slug }), null, slug);
});

it("patches only explicit fields when an edited post updates the published event", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  const before = (await t.run(ctx => ctx.db.get(eventId)))!.startAt;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: now 22:00", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }) });
  assert.equal(result.outcome, "updated");
  const events = await t.run(ctx => ctx.db.query("events").collect());
  assert.equal(events.length, 1);
  assert.equal(events[0].venueLabel, "Main Hall");
  assert.equal(events[0].startAt, before! + 3_600_000);
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeSources").collect())).length, 1);
  assert.equal((await getRun(t, runId)).state, "done");
});

it("keeps one link and one event when later runs regroup the same posts", async () => {
  const { t } = await seedDiscordIntake({ mode: "autopublish" });
  const runThrough = async (decision: unknown) => {
    const runId = (await pendingRun(t))._id;
    await t.mutation(internal.discordIntake.claimRun, { runId });
    const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
    return (await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate(decision) })).outcome;
  };
  await record(t, "create", message(M1));
  assert.equal(await runThrough({ kind: "new" }), "published");
  const { slug } = (await t.run(ctx => ctx.db.query("events").first()))!;
  // Run B's first trigger is M2, so its own triggerMessageIds[0] is not the link's external ID.
  await record(t, "create", message(M2));
  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  assert.equal(await runThrough({ kind: "update", slug }), "updated");
  await record(t, "update", message(M2, { content: "flyer v2, now 22:00", editedAt: Date.now() }));
  assert.equal(await runThrough({ kind: "new" }), "updated");
  assert.equal((await t.run(ctx => ctx.db.query("events").collect())).length, 1);
  assert.deepEqual((await t.run(ctx => ctx.db.query("eventSyncLinks").collect())).map(link => link.externalId), [M1]);
  assert.ok((await t.run(ctx => ctx.db.query("discordIntakeSources").collect())).every(row => row.externalId === M1));
});

it("files a conflict as a hold draft when staff edit the event between get_event and apply", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const read = await t.query(internal.discordIntake.getEventForAgent, { runId, slug: "night-at-ari" });
  assert.equal(read!.fields.venueLabel, "Main Hall");
  const startBefore = (await t.run(ctx => ctx.db.get(eventId)))!.startAt;
  await t.run(ctx => ctx.db.patch(eventId, { venueLabel: "Staff Room", updatedAt: read!.updatedAt + 1 }));
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: now 22:00", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }), expectedUpdatedAt: read!.updatedAt });
  assert.equal(result.outcome, "conflict");
  assert.ok(result.draftId);
  const event = await t.run(ctx => ctx.db.get(eventId));
  assert.equal(event!.venueLabel, "Staff Room");
  assert.equal(event!.startAt, startBefore);
});

it("holds the run's own draft with its posters and records sources for every trigger message", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
  await t.run(ctx => ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: authorityUserId, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 86_400_000, uploadExpiresAt: Date.now() }));
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  assert.equal(result.outcome, "draft");
  const sources = await t.run(ctx => ctx.db.query("discordIntakeSources").collect());
  assert.deepEqual(sources.map(row => row.messageId).sort(), [M1, M2]);
  assert.ok(sources.every(row => row.draftId === result.draftId && row.runId === runId));
  assert.equal(result.draftId, draftId);
  assert.ok((await t.run(ctx => ctx.db.get(draftId)))!.expiresAt > Date.now());
});

it("files a fresh draft when a dismissed post is edited, after the sweep took the old one", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const run = async () => {
    const runId = (await pendingRun(t))._id;
    await t.mutation(internal.discordIntake.claimRun, { runId });
    const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
    return t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  };
  await record(t, "create", message(M1));
  const first = await run();
  await t.run(async ctx => {
    await dismissHeldDraft(ctx, (await ctx.db.get(first.draftId!))!, Date.now());
    await ctx.db.delete(first.draftId!);
  });
  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  const second = await run();
  assert.equal(second.outcome, "draft");
  assert.notEqual(second.draftId, first.draftId);
  await t.run(async ctx => {
    const link = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", M1)).unique();
    assert.equal(link?.draftId, second.draftId);
    assert.deepEqual((await ctx.db.query("discordIntakeSources").collect()).map(row => row.draftId), [second.draftId]);
  });
});

it("records source_deleted and flags the link when every source message is deleted", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "delete", { messageId: M1 });
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "source_deleted" });
  const run = await getRun(t, runId);
  assert.equal(run.reason, "source_deleted"); assert.equal(run.state, "done");
  const [link] = await t.run(ctx => ctx.db.query("eventSyncLinks").collect());
  assert.equal(link.state, "external_deleted");
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.publicationState, "published");
});

it("flags the link when one trigger is deleted and the run continues on the live one, then clears it once that post feeds the event", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "create", message(M2));
  await record(t, "delete", { messageId: M1 });
  const runId = (await pendingRun(t))._id;
  assert.equal((await t.mutation(internal.discordIntake.claimRun, { runId })).kind, "run");
  assert.equal((await t.run(ctx => ctx.db.query("eventSyncLinks").collect()))[0].state, "external_deleted");
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: flyer", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }) });
  assert.equal(result.eventId, eventId);
  assert.equal((await t.run(ctx => ctx.db.query("eventSyncLinks").collect()))[0].state, "linked");
});

it("keeps the flag when the live post of a mixed run is held as something other than the linked event", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "create", message(M2));
  await record(t, "delete", { messageId: M1 });
  const { runId, draftId } = await startRun(t);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  assert.equal(result.outcome, "draft");
  assert.equal((await t.run(ctx => ctx.db.query("eventSyncLinks").collect()))[0].state, "external_deleted");
});

const flagLink = (t: T, connectorId: Id<"eventConnectors">, messageId: string) => t.run(async ctx => {
  const link = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", messageId)).unique();
  await ctx.db.patch(link!._id, { state: "external_deleted", flagReviewedAt: Date.now() });
});

it("clears a reviewed flag when a later post feeds the same event, on every link of the connector", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await flagLink(t, connectorId, M1);
  await record(t, "create", message(M2, { content: "now 22:00" }));
  const { runId, draftId } = await startRun(t);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }) });
  assert.equal(result.outcome, "updated");
  const links = await t.run(ctx => ctx.db.query("eventSyncLinks").collect());
  assert.deepEqual(links.map(link => [link.externalId, link.state, link.flagReviewedAt]), [[M1, "linked", undefined], [M2, "linked", undefined]]);
});

it("leaves another event's flag alone when a later post feeds a different event, and another connector's link", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const flaggedId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  const otherId = await seedEvent(t, communityProfileId, { slug: "other-night", title: "Other Night", daysOut: 9 });
  await linkEvent(t, connectorId, flaggedId, M1);
  await flagLink(t, connectorId, M1);
  const foreign = await t.run(async ctx => {
    const google = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "google_calendar", direction: "import", mode: "hold", authorityUserId: (await ctx.db.get(connectorId))!.authorityUserId, target: { calendarId: "c" }, state: "active", createdAt: Date.now(), updatedAt: Date.now() });
    return ctx.db.insert("eventSyncLinks", { connectorId: google, eventId: otherId, externalId: "g-1", state: "external_deleted", createdAt: Date.now(), updatedAt: Date.now() });
  });
  await record(t, "create", message(M2, { content: "now 22:00" }));
  const { runId, draftId } = await startRun(t);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "other-night" }) });
  assert.equal(result.eventId, otherId);
  const [flagged] = await t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", flaggedId)).collect());
  assert.equal(flagged.state, "external_deleted");
  assert.ok(flagged.flagReviewedAt);
  assert.equal((await t.run(ctx => ctx.db.get(foreign)))!.state, "external_deleted");
});

it("keeps the link while another post that fed the event is still live", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  const earlierRunId = await linkEvent(t, connectorId, eventId, M1);
  await t.run(async ctx => {
    await ctx.db.insert("discordIntakeMessages", { connectorId, messageId: M2, guildId: GUILD, channelId: CHANNEL, authorId: AUTHOR_B, authorDisplayName: "Bo", content: "details", attachments: [], createdAt: Date.now() - 20_000, updatedAt: Date.now() });
    await ctx.db.insert("discordIntakeSources", { connectorId, messageId: M2, externalId: M1, eventId, runId: earlierRunId, createdAt: Date.now() });
  });
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "delete", { messageId: M1 });
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "trigger_deleted" });
  assert.equal((await getRun(t, runId)).reason, "trigger_deleted");
  const [link] = await t.run(ctx => ctx.db.query("eventSyncLinks").collect());
  assert.equal(link.state, "linked");
});

it("pauses the connector at 20 runs in a UTC day", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  await t.run(async ctx => { for (let i = 0; i < 20; i += 1) await ctx.db.insert("discordIntakeRuns", { connectorId, authorId: AUTHOR_B, triggerMessageIds: [], state: "done", startedAt: dayStart + i, createdAt: dayStart + i }); });
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "binding_cap" });
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector!.state, "paused"); assert.equal(connector!.lastError, "binding_cap");
  const resume = (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).find(job => job.name.includes("resumeConnector"))!;
  assert.equal(resume.scheduledTime, dayStart + 86_400_000);
});

it("alerts ops with IDs only when the daily cap pauses a connector, and resumeConnector resolves it", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  await t.run(async ctx => { for (let i = 0; i < 20; i += 1) await ctx.db.insert("discordIntakeRuns", { connectorId, authorId: AUTHOR_B, triggerMessageIds: [], state: "done", startedAt: dayStart + i, createdAt: dayStart + i }); });
  await record(t, "create", message(M1));
  await t.mutation(internal.discordIntake.claimRun, { runId: (await pendingRun(t))._id });
  assert.deepEqual(await opsSends(t), [{ to: "basic@basicbit.net", subject: "[VRDex ops] Discord intake daily cap reached", body: `Discord intake connector ${connectorId} (community ${communityProfileId}) reached its daily run cap.` }]);
  await t.mutation(internal.discordIntake.resumeConnector, { connectorId });
  assert.deepEqual((await opsSends(t)).map(send => send.subject), ["[VRDex ops] Discord intake daily cap reached", `[VRDex ops] Resolved: discord-intake-cap:${connectorId}`]);
});

it("resumeConnector reopens only a connector the daily cap paused", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const cases = [["paused", "binding_cap", "active"], ["paused", "authority_lost", "paused"], ["removed", "binding_cap", "removed"]] as const;
  for (const [state, lastError, expected] of cases) {
    await t.run(ctx => ctx.db.patch(connectorId, { state, lastError }));
    await t.mutation(internal.discordIntake.resumeConnector, { connectorId });
    assert.equal((await t.run(ctx => ctx.db.get(connectorId)))!.state, expected, `${state} ${lastError}`);
  }
});

it("pauses the connector when its authority lost manage_integrations", async () => {
  const { t, connectorId, communityProfileId, authorityUserId } = await seedDiscordIntake();
  await revokeManageIntegrations(t, communityProfileId, authorityUserId);
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "authority_lost" });
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector!.state, "paused"); assert.equal(connector!.lastError, "authority_lost");
});

it("skips runs while event connectors are disabled", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
  try {
    assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "connector_inactive" });
  } finally {
    process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  }
  const run = await getRun(t, runId);
  assert.equal(run.state, "done"); assert.equal(run.startedAt, undefined);
});

it("skips runs while Discord intake is disabled", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  delete process.env.VRDEX_DISCORD_INTAKE_ENABLED;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "connector_inactive" });
  assert.equal((await getRun(t, runId)).state, "done");
});

it("leaves a run that is no longer pending untouched", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const running = await getRun(t, runId);
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "connector_inactive" });
  assert.deepEqual(await getRun(t, runId), running);
});

it("defers an author's next run while their previous run is still running", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const first = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId: first });
  await record(t, "create", message(M2));
  const second = await pendingRun(t);
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId: second._id }), { kind: "skip", reason: "deferred" });
  const deferred = await getRun(t, second._id);
  assert.equal(deferred.state, "pending");
  assert.notEqual(deferred.scheduledFunctionId, second.scheduledFunctionId);
  assert.equal((await t.run(ctx => ctx.db.system.get(deferred.scheduledFunctionId!)))!.state.kind, "pending");
  await record(t, "create", message(M3));
  assert.deepEqual((await getRun(t, second._id)).triggerMessageIds, [M2, M3]);
  await t.mutation(internal.discordIntake.failRun, { runId: first, reason: "extraction_failed" });
  assert.equal((await t.mutation(internal.discordIntake.claimRun, { runId: second._id })).kind, "run");
});

it("closes a stalled running run and still defers behind a live one", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const stale = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId: stale });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId: stale, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
  // The stale row is the older one, so it is what an index scan for running rows meets first.
  const live = await t.run(async ctx => {
    await ctx.db.patch(stale, { startedAt: Date.now() - 20 * 60_000 });
    return ctx.db.insert("discordIntakeRuns", { connectorId, authorId: "200000000000000001", triggerMessageIds: [], state: "running", startedAt: Date.now(), createdAt: Date.now() });
  });
  await record(t, "create", message(M2));
  const next = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId: next }), { kind: "skip", reason: "deferred" });
  const closed = await getRun(t, stale);
  assert.equal(closed.state, "failed"); assert.equal(closed.reason, "stalled"); assert.ok(closed.finishedAt);
  assert.ok((await t.run(ctx => ctx.db.get(draftId)))!.expiresAt <= Date.now());
  assert.equal((await getRun(t, live)).state, "running");
  assert.equal((await getRun(t, next)).state, "pending");
});

it("alerts ops once after three failed runs, counting one that failed before its claim, and resolves on the next finished run", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  // An older finished run: the failure without a claim must still rank among the three most recent.
  await t.run(ctx => ctx.db.insert("discordIntakeRuns", { connectorId, authorId: AUTHOR_B, triggerMessageIds: [], state: "done", startedAt: Date.now() - 60_000, createdAt: Date.now() - 60_000 }));
  const sends = () => t.run(async ctx => (await ctx.db.system.query("_scheduled_functions").collect()).filter(job => job.name.includes("opsAlertEmail")).map(job => job.args[0] as { subject: string; body: string }));
  const nextRun = async (messageId: string, claim: boolean) => {
    await record(t, "create", message(messageId));
    const runId = (await pendingRun(t))._id;
    if (claim) await t.mutation(internal.discordIntake.claimRun, { runId });
    return runId;
  };
  for (const [index, messageId] of [M1, M2, M3].entries()) {
    const claimed = index < 2;
    const runId = await nextRun(messageId, claimed);
    if (claimed) await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
    await t.mutation(internal.discordIntake.failRun, { runId, reason: "extraction_failed" });
    assert.equal((await sends()).length, index === 2 ? 1 : 0);
    const run = await getRun(t, runId);
    assert.equal(run.state, "failed");
    if (claimed) assert.ok((await t.run(ctx => ctx.db.get(run.draftId!)))!.expiresAt <= Date.now());
  }
  const [alert] = await sends();
  assert.equal(alert.subject, "[VRDex ops] Discord intake runs failing");
  assert.ok(alert.body.includes(connectorId) && alert.body.includes("extraction_failed"));
  const runId = await nextRun(M4, true);
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: hello", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "not_event", reason: "" }) });
  assert.equal(result.outcome, "not_event");
  assert.equal((await getRun(t, runId)).reason, "not_event");
  assert.ok((await t.run(ctx => ctx.db.get(draftId)))!.expiresAt <= Date.now());
  assert.ok((await sends()).some(send => send.subject.startsWith("[VRDex ops] Resolved: discord-intake:")));
});

const AI_ENV = ["VRDEX_EVENT_INTAKE_AI_ENABLED", "OPENAI_API_KEY", "SITE_URL", "VRDEX_DISCORD_POSTER_TOKEN", "LANGFUSE_PUBLIC_KEY"] as const;
/** Turns the model on with a scripted fetch; restores fetch and env afterwards. */
async function withModel(fetchImplementation: typeof fetch, body: () => Promise<void>) {
  const saved = Object.fromEntries(AI_ENV.map(key => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  Object.assign(process.env, { VRDEX_EVENT_INTAKE_AI_ENABLED: "true", OPENAI_API_KEY: "sk-test", SITE_URL: "https://vrdex.test", VRDEX_DISCORD_POSTER_TOKEN: "p".repeat(40) });
  delete process.env.LANGFUSE_PUBLIC_KEY;
  globalThis.fetch = fetchImplementation;
  try { await body(); }
  finally {
    globalThis.fetch = realFetch;
    for (const key of AI_ENV) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}

it("closes the run even when extraction fails", async () => {
  const { t } = await seedDiscordIntake();
  await withModel(async () => { throw new Error("network down"); }, async () => {
    await record(t, "create", message(M1, { attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: 10 }] }));
    const runId = (await pendingRun(t))._id;
    await t.action(internal.discordIntakeRun.runPending, { runId });
    const run = await getRun(t, runId);
    assert.equal(run.state, "failed");
    assert.equal(run.reason, "invalid_response");
    assert.ok(run.finishedAt);
  });
});

it("stores only a code as a failure reason, never a message that carries a URL", () => {
  const signed = "https://cdn.discordapp.com/attachments/1/2/f.png?ex=1&hm=abc";
  assert.equal(failureReason(new Error(`request to ${signed} failed`)), "run_failed");
  assert.equal(failureReason(new Error(signed)), "run_failed");
  assert.equal(failureReason(new Error("POSTER_READ_FAILED")), "POSTER_READ_FAILED");
  assert.equal(failureReason(new ConvexError({ code: "DISCORD_INTAKE_RUN_NOT_RUNNING" })), "DISCORD_INTAKE_RUN_NOT_RUNNING");
  assert.equal(failureReason("not an error"), "run_failed");
});

it("runs the agent through list_events and get_event and applies with the updatedAt get_event saw", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  const call = (name: string, args: unknown) => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id: name });
  const answer = { ...candidate({ kind: "update", slug: "night-at-ari" }), event: { ...candidate({}).event, communitySlug: null } };
  const turns = [
    () => [call("list_events", { limit: 10 })],
    () => [call("get_event", { slug: "night-at-ari" })],
    async () => {
      // Staff edit the event after the agent read it.
      await t.run(ctx => ctx.db.patch(eventId, { venueLabel: "Staff Room", updatedAt: Date.now() + 1 }));
      return [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }];
    },
  ];
  await withModel(async url => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    return Response.json({ status: "completed", output: await turns.shift()!(), usage: { input_tokens: 1, output_tokens: 1 } });
  }, () => t.action(internal.discordIntakeRun.runPending, { runId }));
  const run = await getRun(t, runId);
  assert.equal(run.state, "done");
  assert.equal(run.reason, "conflict");
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.venueLabel, "Staff Room");
  const runEvents = (await t.run(ctx => ctx.db.query("productAnalyticsOutbox").collect())).filter(row => row.event === "event_intake_run");
  assert.deepEqual(runEvents.map(row => [row.properties.trigger, row.properties.reason]), [["discord", "success"]]);
});

it("keeps connector posters out of the authority's own poster quota", async () => {
  const { t, authorityUserId, connectorId } = await seedDiscordIntake();
  const draft = (extra: object) => t.run(ctx => ctx.db.insert("eventIntakeDrafts", { actorUserId: authorityUserId, version: 1, fields: {}, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000, ...extra }));
  const own = await draft({});
  const connectorDraft = await draft({ connectorId });
  const begin = (draftId: Id<"eventIntakeDrafts">) => t.mutation(internal.eventIntakeSources.beginPosterUpload, { actorUserId: authorityUserId, draftId, contentType: "image/png", byteLength: 128, sha256: "a".repeat(64) });
  for (let index = 0; index < 20; index++) await begin(connectorDraft);
  for (let index = 0; index < 20; index++) await begin(own);
  await assert.rejects(begin(own), /POSTER_QUOTA/);
  await begin(connectorDraft);
});

const POSTER = { url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: 10 };
const LINK = "https://bucket.example/profile-assets/quarantine/x?X-Amz-Signature=sig";
const DISPLAY = Buffer.from([1, 2, 3, 250, 251, 252, 7]);
type Requests = { bridge: Array<Record<string, unknown>>; model: Array<{ input: Array<{ content: Array<{ type: string; image_url?: string; detail?: string }> }> }> };
/** A run's fetches: the poster bridge, the signed link it returns, and a model that answers not_event. */
const routedFetch = (t: T, requests: Requests, routes: { store?: () => Response; read?: () => Response; link?: () => Response } = {}): typeof fetch => async (url, init) => {
  const href = String(url);
  if (href === LINK) {
    assert.equal(init?.redirect, "error");
    return routes.link?.() ?? new Response(DISPLAY);
  }
  if (href === "https://api.openai.com/v1/responses") {
    requests.model.push(JSON.parse(String(init?.body)));
    const text = JSON.stringify(candidate({ kind: "not_event", reason: "" }));
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  assert.equal(href, "https://vrdex.test/api/internal/discord-intake/poster");
  assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"p".repeat(40)}`);
  const body = JSON.parse(String(init?.body));
  requests.bridge.push(body);
  if (body.op === "read") return routes.read?.() ?? Response.json({ url: LINK, mimeType: "image/webp" });
  if (routes.store) return routes.store();
  const now = Date.now();
  // The ready source the web bridge leaves behind after its upload and freeze.
  const posterAssetId = await t.run(ctx => ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: body.actorUserId, draftId: body.draftId, contentType: body.contentType, byteLength: body.byteLength, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: now, lastActivityAt: now, expiresAt: now + 86_400_000, uploadExpiresAt: now }));
  return Response.json({ posterAssetId });
};
const opsSends = (t: T) => t.run(async ctx => (await ctx.db.system.query("_scheduled_functions").collect()).filter(job => job.name.includes("opsAlertEmail")).map(job => job.args[0] as { to: string; subject: string; body: string }));

it("stores the run's poster and gives the model the data URL rebuilt from the signed link", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  const requests: Requests = { bridge: [], model: [] };
  await record(t, "create", message(M1, { attachments: [POSTER] }));
  const runId = (await pendingRun(t))._id;
  await withModel(routedFetch(t, requests), () => t.action(internal.discordIntakeRun.runPending, { runId }));
  assert.equal(requests.bridge.length, 2);
  const [store, read] = requests.bridge;
  const run = await getRun(t, runId);
  assert.deepEqual(store, { op: "store", actorUserId: authorityUserId, draftId: run.draftId, ...POSTER });
  const posterAssetId = (await t.run(ctx => ctx.db.query("eventPosterSources").collect()))[0]._id;
  assert.deepEqual(read, { op: "read", actorUserId: authorityUserId, posterAssetId });
  const image = requests.model[0].input[0].content.find(part => part.type === "input_image");
  assert.equal(image?.image_url, `data:image/webp;base64,${DISPLAY.toString("base64")}`);
  assert.equal(run.state, "done");
  assert.equal(run.reason, "not_event");
});

for (const [name, routes, code] of [
  ["the bridge refuses the read", { read: () => new Response(null, { status: 503 }) }, "POSTER_BRIDGE_FAILED"],
  ["the signed link fails", { link: () => new Response(null, { status: 403 }) }, "POSTER_READ_FAILED"],
] as const) {
  it(`logs the real cause and closes the run when ${name}`, async test => {
    const warn = test.mock.method(console, "warn", () => {});
    const { t } = await seedDiscordIntake();
    await record(t, "create", message(M1, { attachments: [POSTER] }));
    const runId = (await pendingRun(t))._id;
    await withModel(routedFetch(t, { bridge: [], model: [] }, routes), () => t.action(internal.discordIntakeRun.runPending, { runId }));
    assert.deepEqual(warn.mock.calls.map(call => call.arguments), [["discord intake poster read failed", { runId, reason: code }]]);
    const run = await getRun(t, runId);
    assert.equal(run.state, "failed");
    assert.ok(run.finishedAt);
  });
}

const DISCORD_LINK = `https://discord.com/channels/${GUILD}/${CHANNEL}/${M1}`;
const startRun = async (t: T) => {
  const runId = (await pendingRun(t))._id;
  const claim = await t.mutation(internal.discordIntake.claimRun, { runId });
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: DISCORD_LINK });
  return { runId, claim, draftId };
};
const getDraft = (t: T, draftId: Id<"eventIntakeDrafts">) => t.run(async ctx => (await ctx.db.get(draftId))!);
/** The stored post an earlier run read, with no pending run of its own. */
const seedPost = (t: T, connectorId: Id<"eventConnectors">, messageId: string, content: string) => t.run(ctx => ctx.db.insert("discordIntakeMessages", {
  connectorId, messageId, guildId: GUILD, channelId: CHANNEL, authorId: "200000000000000001", authorDisplayName: "Ari", content, attachments: [], createdAt: Date.now() - 3_600_000, updatedAt: Date.now(),
}));

it("keeps the Discord link on the draft and off the published event, and keeps any other link", async () => {
  for (const [sourceUrl, published] of [[null, undefined], ["https://tickets.example/night", "https://tickets.example/night"]] as const) {
    const { t } = await seedDiscordIntake({ mode: "autopublish" });
    await record(t, "create", message(M1));
    const { runId, draftId } = await startRun(t);
    const base = candidate({ kind: "new" });
    const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, sourceUrl } } });
    assert.equal(result.outcome, "published");
    assert.equal((await t.run(ctx => ctx.db.get(result.eventId!)))!.sourceUrl, published);
    assert.equal((await getDraft(t, draftId)).fields.sourceUrl, sourceUrl ?? DISCORD_LINK);
  }
});

it("never patches a Discord link onto the event, even from explicit evidence", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: `now 22:00 ${DISCORD_LINK}`, editedAt: Date.now() }));
  const { runId, draftId } = await startRun(t);
  const base = candidate({ kind: "update", slug: "night-at-ari" });
  await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, sourceUrl: DISCORD_LINK }, evidence: [...base.evidence, { fieldPath: "event.sourceUrl", origin: "text", excerpt: DISCORD_LINK, assessment: "explicit" }] } });
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.sourceUrl, undefined);
});

it("takes explicit evidence only from new posts, so an older post cannot overwrite staff's venue", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await seedPost(t, connectorId, M1, "Night at Ari, venue Room A, 21:00");
  await record(t, "create", message(M2, { content: "Start   moved\nto 22:00" }));
  const { runId, draftId, claim } = await startRun(t);
  assert.equal(claim.kind === "run" && claim.modelText.startsWith(`New or changed posts:\n[message ${M2}]`), true);
  const startBefore = (await t.run(ctx => ctx.db.get(eventId)))!.startAt!;
  const base = candidate({ kind: "update", slug: "night-at-ari" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, title: "Renamed", venueLabel: "Room A" }, evidence: [
    { fieldPath: "event.start", origin: "text", excerpt: "start moved to 22:00", assessment: "explicit" },
    { fieldPath: "event.venueLabel", origin: "text", excerpt: "venue Room A", assessment: "explicit" },
    { fieldPath: "event.title", origin: "text", excerpt: null, assessment: "explicit" },
  ] } });
  assert.equal(result.outcome, "updated");
  const event = (await t.run(ctx => ctx.db.get(eventId)))!;
  assert.equal(event.venueLabel, "Main Hall");
  assert.equal(event.title, "Night at Ari");
  assert.equal(event.startAt, startBefore + 3_600_000);
});

it("gives a later flyer's run its own poster, then a context poster no run has used", async () => {
  const { t } = await seedDiscordIntake();
  const flyer = (name: string, byteLength: number) => ({ url: `https://cdn.discordapp.com/attachments/1/2/${name}.png`, contentType: "image/png", byteLength });
  await record(t, "create", message(M1, { attachments: [flyer("first", 900)] }));
  const first = await startRun(t);
  await t.mutation(internal.discordIntake.finishRun, { runId: first.runId, draftId: first.draftId, candidate: candidate({ kind: "new" }) });
  await record(t, "create", message(M2, { attachments: [flyer("second", 100)] }));
  const second = await startRun(t);
  assert.deepEqual(second.claim.kind === "run" && second.claim.posters, [flyer("second", 100)]);
  await t.mutation(internal.discordIntake.failRun, { runId: second.runId, reason: "extraction_failed" });
  await record(t, "create", message(M3));
  const third = await startRun(t);
  assert.deepEqual(third.claim.kind === "run" && third.claim.posters, [flyer("second", 100)]);
});

it("writes an edit of a held post into the pending draft, keeping staff's fields and moving new posters", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const first = await startRun(t);
  const held = await t.mutation(internal.discordIntake.finishRun, { runId: first.runId, draftId: first.draftId, candidate: candidate({ kind: "new" }) });
  assert.equal(held.draftId, first.draftId);
  await t.run(async ctx => saveIntakeDraft(ctx.db, authorityUserId, { draftId: first.draftId, expectedVersion: (await ctx.db.get(first.draftId))!.version, patch: { title: "Staff Title" } }));

  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  const second = await startRun(t);
  const now = Date.now();
  const { sourceId, artworkId } = await t.run(async ctx => {
    const sourceId = await ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: authorityUserId, draftId: second.draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: now, lastActivityAt: now, expiresAt: now + 86_400_000, uploadExpiresAt: now });
    const artworkId = await ctx.db.insert("eventPosterArtwork", { actorUserId: authorityUserId, draftId: second.draftId, sourceId, state: "ready", createdAt: now, expiresAt: now + 86_400_000 });
    await ctx.db.patch(second.draftId, { artworkAssetId: artworkId });
    return { sourceId, artworkId };
  });
  const base = candidate({ kind: "new" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId: second.runId, draftId: second.draftId, candidate: { ...base, event: { ...base.event, venueLabel: "Moved Room" } } });
  assert.deepEqual({ outcome: result.outcome, draftId: result.draftId }, { outcome: "draft", draftId: first.draftId });
  const pending = await getDraft(t, first.draftId);
  assert.equal(pending.fields.title, "Staff Title");
  assert.equal(pending.fields.tentative.venueLabel, "Moved Room");
  assert.equal(pending.fields.tentative.communitySlug, "night-club");
  assert.equal(pending.fields.sourceUrl, DISCORD_LINK);
  assert.equal(pending.artworkAssetId, artworkId);
  assert.equal((await t.run(ctx => ctx.db.get(sourceId)))!.draftId, first.draftId);
  assert.equal((await t.run(ctx => ctx.db.get(artworkId)))!.draftId, first.draftId);
  assert.ok((await getDraft(t, second.draftId)).expiresAt <= Date.now());
  const run = await getRun(t, second.runId);
  assert.deepEqual({ reason: run.reason, draftId: run.draftId }, { reason: "draft", draftId: first.draftId });
  assert.ok((await t.run(ctx => ctx.db.query("discordIntakeSources").collect())).every(row => row.draftId === first.draftId));
});

it("expires the working draft an update never used and keeps it on the run", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const { runId, draftId } = await startRun(t);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "update", slug: "night-at-ari" }) });
  assert.equal(result.outcome, "updated");
  assert.ok((await getDraft(t, draftId)).expiresAt <= Date.now());
  assert.equal((await getRun(t, runId)).draftId, draftId);
});

it("keeps the run's own draft on it when a replayed publish answers with another draft", async () => {
  const { t, authorityUserId } = await seedDiscordIntake({ mode: "autopublish" });
  await record(t, "create", message(M1));
  const { runId, draftId } = await startRun(t);
  await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  const retry = await t.run(async ctx => {
    for (const link of await ctx.db.query("eventSyncLinks").collect()) await ctx.db.delete(link._id);
    await ctx.db.patch(runId, { state: "running" });
    return ctx.db.insert("eventIntakeDrafts", { actorUserId: authorityUserId, version: 1, fields: {}, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
  });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId: retry, candidate: candidate({ kind: "new" }) });
  assert.deepEqual({ outcome: result.outcome, draftId: result.draftId }, { outcome: "published", draftId });
  assert.equal((await getRun(t, runId)).draftId, retry);
  assert.ok((await getDraft(t, retry)).expiresAt <= Date.now());
});

it("leaves a field alone when explicit evidence names a null value, except time TBA", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "venue gone, time TBA", editedAt: Date.now() }));
  const { runId, draftId } = await startRun(t);
  const base = candidate({ kind: "update", slug: "night-at-ari" });
  await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, start: null, venueLabel: null }, evidence: [
    { fieldPath: "event.venueLabel", origin: "text", excerpt: "venue gone", assessment: "explicit" },
    { fieldPath: "event.timeTba", origin: "text", excerpt: "time TBA", assessment: "explicit" },
  ] } });
  const event = (await t.run(ctx => ctx.db.get(eventId)))!;
  assert.equal(event.venueLabel, "Main Hall");
  assert.equal(event.scheduleKind, "date_only");
});

for (const [name, event, evidence, dateMoves] of [
  ["a date with no start", { start: null, startDate: dateIn(8), eventDate: dateIn(8) }, [
    { fieldPath: "event.eventDate", origin: "text", excerpt: "moved to saturday", assessment: "explicit" },
    { fieldPath: "event.startDate", origin: "text", excerpt: "moved to saturday", assessment: "explicit" },
  ], true],
  ["a start the candidate drops", { start: "9pm", startDate: null, timezone: null }, [
    { fieldPath: "event.start", origin: "text", excerpt: "moved to saturday", assessment: "explicit" },
  ], false],
] as const) {
  it(`keeps the event timed when explicit evidence names ${name}`, async () => {
    const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
    const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
    await linkEvent(t, connectorId, eventId, M1);
    await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "moved to saturday", editedAt: Date.now() }));
    const { runId, draftId } = await startRun(t);
    const before = (await t.run(ctx => ctx.db.get(eventId)))!;
    const base = candidate({ kind: "update", slug: "night-at-ari" });
    const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, ...event }, evidence } });
    assert.equal(result.outcome, "updated");
    const after = (await t.run(ctx => ctx.db.get(eventId)))!;
    assert.equal(after.scheduleKind, "timed");
    assert.equal(after.startAt, dateMoves ? before.startAt! + 86_400_000 : before.startAt);
  });
}

it("keeps the lineup out of an update that never read the event", async () => {
  const lineupAfter = async (decision: (slug: string) => unknown, expectedUpdatedAt: boolean) => {
    const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
    const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
    await linkEvent(t, connectorId, eventId, M1);
    await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "DJ Bo replaces DJ Cy", editedAt: Date.now() }));
    const { runId, draftId } = await startRun(t);
    const base = candidate(decision("night-at-ari"));
    await t.mutation(internal.discordIntake.finishRun, { runId, draftId, ...(expectedUpdatedAt ? { expectedUpdatedAt: (await t.run(ctx => ctx.db.get(eventId)))!.updatedAt } : {}), candidate: {
      ...base, lineup: [{ performerLabel: "DJ Bo", personSlug: null, roleLabel: null, start: null, end: null, startDate: null, endDate: null }],
      evidence: [{ fieldPath: "lineup.0.performerLabel", origin: "text", excerpt: "DJ Bo", assessment: "explicit" }],
    } });
    return (await t.query(internal.discordIntake.getEventForAgent, { runId, slug: "night-at-ari" }))!.fields.lineup ?? [];
  };
  assert.deepEqual(await lineupAfter(slug => ({ kind: "update", slug }), false), []);
  assert.deepEqual(await lineupAfter(() => ({ kind: "new" }), false), []);
  assert.equal((await lineupAfter(slug => ({ kind: "update", slug }), true)).length, 1);
});

it("holds a mixed run that answers new instead of patching the linked event", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  await record(t, "create", message(M2, { content: "second night, now 22:00" }));
  const { runId, draftId } = await startRun(t);
  const startBefore = (await t.run(ctx => ctx.db.get(eventId)))!.startAt;
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) });
  assert.deepEqual({ outcome: result.outcome, draftId: result.draftId, eventId: result.eventId }, { outcome: "draft", draftId, eventId });
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.startAt, startBefore);
  assert.equal((await t.run(ctx => ctx.db.query("events").collect())).length, 1);
});

it("holds a candidate whose update slug did not resolve", async () => {
  const { t } = await seedDiscordIntake({ mode: "autopublish" });
  await record(t, "create", message(M1));
  const { runId, draftId } = await startRun(t);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...candidate({ kind: "new" }), questions: [{ fieldPath: "decision.slug", reason: "unresolved_event", alternatives: ["night-at-ari"] }] } });
  assert.deepEqual({ outcome: result.outcome, draftId: result.draftId }, { outcome: "draft", draftId });
  assert.equal((await t.run(ctx => ctx.db.query("events").collect())).length, 0);
});

it("labels posts for the model only and saves plain chronological text on the draft", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  await seedPost(t, connectorId, M1, "Friday 9pm");
  await record(t, "create", message(M2, { content: "flyer" }));
  const requests: Requests = { bridge: [], model: [] };
  const runId = (await pendingRun(t))._id;
  await withModel(routedFetch(t, requests), () => t.action(internal.discordIntakeRun.runPending, { runId }));
  const sent = requests.model[0].input[0].content.find(part => part.type === "input_text") as { text: string };
  assert.ok(sent.text.startsWith(`New or changed posts:\n[message ${M2}]`) && sent.text.includes("Earlier posts, for context only:"));
  const { fields } = await getDraft(t, (await getRun(t, runId)).draftId!);
  assert.match(fields.sourceText, /^Ari \([^)]+\): Friday 9pm\n\nAri \([^)]+\): flyer$/);
});

it("alarms when no poster stores, continues text-only, and resolves when one stores again", async test => {
  test.mock.method(console, "warn", () => {});
  const { t } = await seedDiscordIntake();
  const requests: Requests = { bridge: [], model: [] };
  await record(t, "create", message(M1, { attachments: [POSTER] }));
  const failed = (await pendingRun(t))._id;
  await withModel(routedFetch(t, requests, { store: () => new Response(null, { status: 503 }) }), () => t.action(internal.discordIntakeRun.runPending, { runId: failed }));
  assert.deepEqual(await opsSends(t), [{ to: "basic@basicbit.net", subject: "[VRDex ops] Discord intake posters failing", body: "Poster storage failed: POSTER_BRIDGE_FAILED." }]);
  assert.equal((await getRun(t, failed)).state, "done");
  assert.equal(requests.model.length, 1);
  assert.equal(requests.model[0].input[0].content.some(part => part.type === "input_image"), false);

  await record(t, "create", message(M2, { attachments: [POSTER] }));
  const stored = (await pendingRun(t))._id;
  await withModel(routedFetch(t, requests), () => t.action(internal.discordIntakeRun.runPending, { runId: stored }));
  assert.deepEqual((await opsSends(t)).map(send => send.subject), ["[VRDex ops] Discord intake posters failing", "[VRDex ops] Resolved: discord-intake-posters"]);
});

it("neither alarms nor resolves on a run with no posters", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  await t.run(ctx => ctx.db.insert("opsAlerts", { key: "discord-intake-posters", lastSentAt: Date.now() }));
  await withModel(routedFetch(t, { bridge: [], model: [] }), () => t.action(internal.discordIntakeRun.runPending, { runId }));
  assert.deepEqual(await opsSends(t), []);
  assert.equal((await t.run(ctx => ctx.db.query("opsAlerts").collect()))[0].resolvedAt, undefined);
});

/** A community owner's view of the held imports section. */
const heldRows = async (t: T, communityProfileId: Id<"profiles">) => {
  const subject = newClerkUserId();
  await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  return t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true }).query(api.eventInventory.listHeldImports, { communityProfileId });
};
const finish = async (t: T, decision: unknown, overrides: Record<string, unknown> = {}) => {
  const { runId, draftId } = await startRun(t);
  const base = candidate(decision);
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, ...overrides } } });
  return { ...result, runId, workingDraftId: draftId };
};

it("dismisses a held draft when its post is edited into chatter, and a later edit refiles", async () => {
  const { t, communityProfileId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const held = await finish(t, { kind: "new" });
  await record(t, "update", message(M1, { content: "never mind", editedAt: Date.now() }));
  const chatter = await finish(t, { kind: "not_event", reason: "" });
  assert.equal(chatter.outcome, "not_event");
  const draft = await getDraft(t, held.draftId!);
  assert.ok(draft.dismissedAt && draft.resolvedAt);
  assert.ok(draft.expiresAt > Date.now());
  assert.ok((await getDraft(t, chatter.workingDraftId)).expiresAt <= Date.now());
  assert.equal((await t.run(ctx => ctx.db.query("eventSyncLinks").collect()))[0].draftId, undefined);
  assert.deepEqual(await heldRows(t, communityProfileId), []);
  await record(t, "update", message(M1, { content: "back on", editedAt: Date.now() }));
  const refiled = await finish(t, { kind: "new" });
  assert.equal(refiled.outcome, "draft");
  assert.notEqual(refiled.draftId, held.draftId);
  assert.deepEqual((await heldRows(t, communityProfileId)).map(row => row.kind === "new" && row.draftId), [refiled.draftId]);
});

it("dismisses an autopublish connector's held draft too, and never a published one", async () => {
  const { t } = await seedDiscordIntake({ mode: "autopublish" });
  await record(t, "create", message(M1));
  const held = await finish(t, { kind: "new" }, { title: null });
  assert.equal(held.outcome, "draft");
  await record(t, "update", message(M1, { content: "never mind", editedAt: Date.now() }));
  await finish(t, { kind: "not_event", reason: "" });
  assert.ok((await getDraft(t, held.draftId!)).dismissedAt);

  await record(t, "create", message(M2));
  const published = await finish(t, { kind: "new" });
  assert.equal(published.outcome, "published");
  await record(t, "update", message(M2, { content: "never mind", editedAt: Date.now() }));
  await finish(t, { kind: "not_event", reason: "" });
  assert.equal((await getDraft(t, published.draftId!)).dismissedAt, undefined);
  assert.equal((await t.run(ctx => ctx.db.get(published.eventId!)))!.publicationState, "published");
});

it("refreshes an autopublish failure in full when its post is edited", async () => {
  const { t, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  await record(t, "create", message(M1));
  delete process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    const held = await finish(t, { kind: "new" }, { start: null, timezone: null, communitySlug: "other-club" });
    assert.equal(held.outcome, "draft");
    const { fields } = await getDraft(t, held.draftId!);
    assert.equal(fields.title, undefined);
    assert.equal(fields.communitySlug, undefined);
    assert.equal(fields.timeTba, undefined);
    assert.equal(fields.sourceText, "Ari: Friday");
    assert.equal(fields.tentative?.title, "Night at Ari");
    assert.equal(fields.tentative?.communitySlug, "night-club");
    await record(t, "update", message(M1, { content: "renamed", editedAt: Date.now() }));
    const edited = await finish(t, { kind: "new" }, { title: "Renamed Night", venueLabel: "Attic", start: null, timezone: null });
    assert.equal(edited.outcome, "draft");
    assert.equal(edited.draftId, held.draftId);
    const [row] = await heldRows(t, communityProfileId);
    assert.equal(row.kind, "new");
    assert.equal(row.kind === "new" && row.title, "Renamed Night");
  } finally {
    process.env.EVENT_DATE_ONLY_ENABLED = "true";
  }
});

/** A second connector on the community with one held draft of its own. */
const foreignDraft = (t: T, connectorId: Id<"eventConnectors">, communityProfileId: Id<"profiles">) => t.run(async ctx => {
  const now = Date.now();
  const { authorityUserId } = (await ctx.db.get(connectorId))!;
  const other = await ctx.db.insert("eventConnectors", { communityProfileId, kind: "discord_announcements", direction: "import", mode: "hold", authorityUserId, target: { guildId: GUILD, channelId: "100000000000000009", channelName: "other" }, state: "active", createdAt: now, updatedAt: now });
  const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: authorityUserId, connectorId: other, version: 1, fields: { tentative: { title: "Elsewhere" } }, provenance: [], createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 });
  await ctx.db.insert("eventSyncLinks", { connectorId: other, draftId, externalId: "300000000000000099", state: "linked", createdAt: now, updatedAt: now });
  return draftId;
});

it("list_events appends this connector's pending held drafts, never a working or foreign one", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  await seedEvent(t, communityProfileId, { slug: "night-at-ari", daysOut: 2 });
  await foreignDraft(t, connectorId, communityProfileId);
  await record(t, "create", message(M1));
  const first = await finish(t, { kind: "new" }, { start: "22:00" });
  await record(t, "create", message(M2));
  const untitled = await finish(t, { kind: "new" }, { title: null, eventDate: null, start: null, timezone: null });
  await record(t, "create", message(M3));
  const dismissed = await finish(t, { kind: "new" });
  await t.run(async ctx => dismissHeldDraft(ctx, (await ctx.db.get(dismissed.draftId!))!, Date.now()));
  await record(t, "create", message(M4));
  const { runId } = await startRun(t);
  const rows = await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 40 });
  assert.deepEqual(rows.slice(1), [
    { slug: `draft:${untitled.draftId}`, title: "", eventDate: null, start: null, lineupSummary: "" },
    { slug: `draft:${first.draftId}`, title: "Night at Ari", eventDate: EVENT_DATE, start: "22:00", lineupSummary: "" },
  ]);
  assert.equal(rows[0].slug, "night-at-ari");
  // A busy calendar gives way, so a late flyer can still find its draft.
  assert.deepEqual((await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 2 })).map(row => row.slug), [`draft:${untitled.draftId}`, `draft:${first.draftId}`]);
});

it("list_events leaves out the run's own draft and keeps its prior events when the limit is tight", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const priorId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, priorId, M1);
  await record(t, "create", message(M2));
  const held = await finish(t, { kind: "new" });
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  assert.deepEqual((await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 1 })).map(row => row.slug), ["night-at-ari"]);
  await t.run(ctx => ctx.db.patch(runId, { draftId: held.draftId }));
  assert.deepEqual((await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 40 })).map(row => row.slug), ["night-at-ari"]);
});

it("get_event reads a held draft of this connector as it would publish, without the post's own URL", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const { draftId } = await finish(t, { kind: "new" }, { start: "22:00" });
  await t.run(async ctx => {
    const draft = (await ctx.db.get(draftId!))!;
    await ctx.db.patch(draftId!, { fields: { ...draft.fields, title: "Staff Title" } });
  });
  const foreign = await foreignDraft(t, connectorId, communityProfileId);
  await record(t, "create", message(M2));
  const { runId } = await startRun(t);
  const read = await t.query(internal.discordIntake.getEventForAgent, { runId, slug: `draft:${draftId}` });
  assert.equal(read!.updatedAt, (await getDraft(t, draftId!)).updatedAt);
  assert.deepEqual(read!.fields, { communitySlug: "night-club", title: "Staff Title", eventDate: EVENT_DATE, timeTba: false, timezone: "Europe/London", start: { time: "22:00" }, venueLabel: "Other Room" });
  for (const slug of [`draft:${foreign}`, "draft:nonsense", "draft:"]) assert.equal(await t.query(internal.discordIntake.getEventForAgent, { runId, slug }), null, slug);
  await t.run(async ctx => dismissHeldDraft(ctx, (await ctx.db.get(draftId!))!, Date.now()));
  assert.equal(await t.query(internal.discordIntake.getEventForAgent, { runId, slug: `draft:${draftId}` }), null);
});

it("a late flyer that names a held draft refreshes it and files no second one", async () => {
  const { t, authorityUserId, communityProfileId } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const first = await finish(t, { kind: "new" });
  await record(t, "create", message(M2, { content: "flyer" }));
  const { runId, draftId } = await startRun(t);
  const posterId = await t.run(ctx => ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: authorityUserId, draftId, contentType: "image/png", byteLength: 10, sha256: "a".repeat(64), reservedBytes: 20, state: "ready", uploadedAt: Date.now(), lastActivityAt: Date.now(), expiresAt: Date.now() + 86_400_000, uploadExpiresAt: Date.now() }));
  const base = candidate({ kind: "update", slug: `draft:${first.draftId}` });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: { ...base, event: { ...base.event, venueLabel: "Flyer Room" } } });
  assert.equal(result.outcome, "draft");
  assert.equal(result.draftId, first.draftId);
  assert.equal((await getDraft(t, first.draftId!)).fields.tentative?.venueLabel, "Flyer Room");
  assert.ok((await getDraft(t, draftId)).expiresAt <= Date.now());
  await t.run(async ctx => {
    assert.equal((await ctx.db.get(posterId))!.draftId, first.draftId);
    assert.deepEqual((await ctx.db.query("eventSyncLinks").collect()).map(link => [link.externalId, link.draftId]), [[M1, first.draftId]]);
    assert.deepEqual((await ctx.db.query("discordIntakeSources").collect()).map(row => [row.messageId, row.externalId, row.draftId]), [[M1, M1, first.draftId], [M2, M1, first.draftId]]);
  });
  const run = await getRun(t, runId);
  assert.deepEqual(run.decision, { kind: "new" });
  assert.equal(run.draftId, first.draftId);
  assert.deepEqual((await heldRows(t, communityProfileId)).map(row => row.kind), ["new"]);
  // The flyer's own edit now reaches the same draft through its source row.
  await record(t, "update", message(M2, { content: "flyer v2", editedAt: Date.now() }));
  const edited = await finish(t, { kind: "new" });
  assert.equal(edited.outcome, "draft");
  assert.equal(edited.draftId, first.draftId);
});

it("merges a flyer into a proposed update without touching the event, and clears that event's flag", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  await seedPost(t, connectorId, M1, "Night at Ari");
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const proposed = await finish(t, { kind: "update", slug: "night-at-ari" });
  await flagLink(t, connectorId, M1);
  const before = await t.run(ctx => ctx.db.get(eventId));
  await record(t, "create", message(M2, { content: "flyer" }));
  const result = await finish(t, { kind: "update", slug: `draft:${proposed.draftId}` });
  assert.equal(result.outcome, "draft");
  assert.equal(result.eventId, eventId);
  assert.deepEqual(await t.run(ctx => ctx.db.get(eventId)), before);
  assert.deepEqual((await t.run(ctx => ctx.db.query("eventSyncLinks").collect())).map(link => [link.state, link.draftId]), [["linked", proposed.draftId]]);
});

it("ignores a draft slug from another connector and files the post on its own", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const foreign = await foreignDraft(t, connectorId, communityProfileId);
  await record(t, "create", message(M1));
  const result = await finish(t, { kind: "update", slug: `draft:${foreign}` });
  assert.equal(result.outcome, "draft");
  assert.notEqual(result.draftId, foreign);
  assert.equal((await getDraft(t, foreign)).fields.tentative?.title, "Elsewhere");
  assert.deepEqual((await getRun(t, result.runId)).decision, { kind: "new" });
});

it("falls through as new when the named draft is gone, and holds rather than publishes", async () => {
  const { t } = await seedDiscordIntake({ mode: "autopublish" });
  await record(t, "create", message(M1));
  const first = await finish(t, { kind: "new" }, { title: null });
  await t.run(async ctx => {
    await dismissHeldDraft(ctx, (await ctx.db.get(first.draftId!))!, Date.now());
    await ctx.db.delete(first.draftId!);
  });
  await record(t, "create", message(M2));
  const result = await finish(t, { kind: "update", slug: `draft:${first.draftId}` });
  assert.equal(result.outcome, "draft");
  assert.notEqual(result.draftId, first.draftId);
  assert.equal((await t.run(ctx => ctx.db.query("events").collect())).length, 0);
  assert.deepEqual((await getRun(t, result.runId)).decision, { kind: "new" });
  assert.ok((await t.run(ctx => ctx.db.query("discordIntakeSources").collect())).some(row => row.messageId === M2 && row.externalId === M2));
});

it("never patches the linked event from a draft slug whose draft expired", async () => {
  const { t, authorityUserId, connectorId, communityProfileId } = await seedDiscordIntake({ mode: "autopublish" });
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari", venueLabel: "Main Hall" });
  await linkEvent(t, connectorId, eventId, M1);
  const expired = await t.run(async ctx => {
    const now = Date.now();
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: authorityUserId, connectorId, version: 1, fields: {}, provenance: [], createdAt: now, updatedAt: now, expiresAt: now - 1 });
    const link = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", M1)).unique();
    await ctx.db.patch(link!._id, { draftId });
    return draftId;
  });
  await seedPost(t, connectorId, M1, "Night at Ari");
  await record(t, "update", message(M1, { createdAt: Date.now() - 10_000, content: "now 22:00", editedAt: Date.now() }));
  const before = await t.run(ctx => ctx.db.get(eventId));
  const result = await finish(t, { kind: "update", slug: `draft:${expired}` });
  assert.equal(result.outcome, "draft");
  assert.deepEqual(await t.run(ctx => ctx.db.get(eventId)), before);
});
