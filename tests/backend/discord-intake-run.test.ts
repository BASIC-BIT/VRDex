import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { buildSourceText, pickPosterAttachments } from "../../convex/_discordIntake";
import { EVENT_POSTER_MAX_BYTES, resolveEventLocalTime } from "../../packages/api-contracts/src/event-intake";
import { newClerkUserId } from "./_clerkTestIdentity";
import { AUTHOR_B, CHANNEL, GUILD, M1, M2, message, record, revokeManageIntegrations, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const M3 = "300000000000000003";
const M4 = "300000000000000004";
// An event a week out, so it falls inside the agent's listing window.
const EVENT_DATE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

/** A published community event created by a separate owner of the community, as plan 02's apply tests do. */
async function seedEvent(t: T, communityProfileId: Id<"profiles">, { slug, venueLabel }: { slug: string; venueLabel?: string }) {
  const subject = newClerkUserId();
  await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const [startAt] = resolveEventLocalTime(EVENT_DATE, { time: "21:00" }, "Europe/London");
  const { eventId } = await t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true })
    .mutation(api.events.createCommunityEvent, { title: "Night at Ari", startAt, timezone: "Europe/London", communitySlug: "night-club", published: true, venueLabel });
  await t.run(ctx => ctx.db.patch(eventId, { slug }));
  return eventId;
}

/** The rows an earlier finished run leaves behind for `messageId`. */
const linkEvent = (t: T, connectorId: Id<"eventConnectors">, eventId: Id<"events">, messageId: string) => t.run(async ctx => {
  const now = Date.now();
  const runId = await ctx.db.insert("discordIntakeRuns", { connectorId, authorId: "200000000000000001", triggerMessageIds: [messageId], state: "done", eventId, createdAt: now - 3_600_000 });
  await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: messageId, state: "linked", createdAt: now, updatedAt: now });
  await ctx.db.insert("discordIntakeSources", { connectorId, messageId, eventId, runId, createdAt: now });
});

const pendingRun = (t: T) => t.run(async ctx => (await ctx.db.query("discordIntakeRuns").collect()).find(run => run.state === "pending")!);
const candidate = (decision: unknown) => ({
  event: { title: "Night at Ari", communitySlug: "night-club", eventDate: EVENT_DATE, start: "22:00", end: null, startDate: null, endDate: null, timezone: "Europe/London", venueLabel: "Other Room", summary: null, sourceUrl: null },
  lineup: [], questions: [], decision,
  evidence: [
    { fieldPath: "event.start", origin: "text", excerpt: "now 22:00", assessment: "explicit" },
    { fieldPath: "event.venueLabel", origin: "text", excerpt: null, assessment: "inferred" },
  ],
});

it("builds source text in post order with author and time, without deleted messages", () => {
  const rows = [
    { messageId: M2, authorDisplayName: "Ari", content: "flyer", createdAt: Date.UTC(2026, 10, 1, 20, 1) },
    { messageId: M1, authorDisplayName: "Ari", content: "Friday 9pm", createdAt: Date.UTC(2026, 10, 1, 20, 0) },
    { messageId: M3, authorDisplayName: "Ari", content: "oops", createdAt: 0, deletedAt: 1 },
  ] as Doc<"discordIntakeMessages">[];
  assert.equal(buildSourceText(rows), "Ari (2026-11-01T20:00:00.000Z): Friday 9pm\n\nAri (2026-11-01T20:01:00.000Z): flyer");
  assert.ok(buildSourceText([{ ...rows[0], content: "x".repeat(12_000) }, rows[1]]).length <= 12_000);
});

it("picks at most three poster images from live messages, largest first", () => {
  const image = (byteLength: number, contentType = "image/png") => ({ url: `https://cdn.discordapp.com/${byteLength}`, contentType, byteLength });
  const rows = [
    { attachments: [image(10), image(50, "image/gif"), image(EVENT_POSTER_MAX_BYTES + 1)] },
    { attachments: [image(30, "image/webp"), image(20, "image/jpeg"), image(40)] },
    { attachments: [image(99)], deletedAt: 1 },
  ] as Doc<"discordIntakeMessages">[];
  assert.deepEqual(pickPosterAttachments(rows).map(item => item.byteLength), [40, 30, 20]);
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
  const rows = await t.query(internal.discordIntake.listEventsForAgent, { runId, limit: 100 });
  assert.ok(rows.length <= 40 && rows.some(row => row.slug === "night-at-ari"));
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
  assert.equal((await t.run(ctx => ctx.db.get(runId)))!.state, "done");
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

it("records source_deleted and flags the link when every source message is deleted", async () => {
  const { t, connectorId, communityProfileId } = await seedDiscordIntake();
  const eventId = await seedEvent(t, communityProfileId, { slug: "night-at-ari" });
  await linkEvent(t, connectorId, eventId, M1);
  await record(t, "create", message(M1, { createdAt: Date.now() - 10_000 }));
  await record(t, "delete", { messageId: M1 });
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "source_deleted" });
  const run = await t.run(ctx => ctx.db.get(runId));
  assert.equal(run!.reason, "source_deleted"); assert.equal(run!.state, "done");
  const [link] = await t.run(ctx => ctx.db.query("eventSyncLinks").collect());
  assert.equal(link.state, "external_deleted");
  assert.equal((await t.run(ctx => ctx.db.get(eventId)))!.publicationState, "published");
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

it("pauses the connector when its authority lost manage_integrations", async () => {
  const { t, connectorId, communityProfileId, authorityUserId } = await seedDiscordIntake();
  await revokeManageIntegrations(t, communityProfileId, authorityUserId);
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "authority_lost" });
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  assert.equal(connector!.state, "paused"); assert.equal(connector!.lastError, "authority_lost");
});

it("leaves a run that is no longer pending untouched", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const runId = (await pendingRun(t))._id;
  await t.mutation(internal.discordIntake.claimRun, { runId });
  const running = await t.run(ctx => ctx.db.get(runId));
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "connector_inactive" });
  assert.deepEqual(await t.run(ctx => ctx.db.get(runId)), running);
});

it("alerts ops once after three failed runs and resolves on the next finished run", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const sends = () => t.run(async ctx => (await ctx.db.system.query("_scheduled_functions").collect()).filter(job => job.name.includes("opsAlertEmail")).map(job => job.args[0] as { subject: string; body: string }));
  const claimNext = async (messageId: string) => {
    await record(t, "create", message(messageId));
    const runId = (await pendingRun(t))._id;
    await t.mutation(internal.discordIntake.claimRun, { runId });
    return runId;
  };
  for (const [index, messageId] of [M1, M2, M3].entries()) {
    const runId = await claimNext(messageId);
    await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
    await t.mutation(internal.discordIntake.failRun, { runId, reason: "extraction_failed" });
    assert.equal((await sends()).length, index === 2 ? 1 : 0);
    const run = (await t.run(ctx => ctx.db.get(runId)))!;
    assert.equal(run.state, "failed");
    assert.ok((await t.run(ctx => ctx.db.get(run.draftId!)))!.expiresAt <= Date.now());
  }
  const [alert] = await sends();
  assert.equal(alert.subject, "[VRDex ops] Discord intake runs failing");
  assert.ok(alert.body.includes(connectorId) && alert.body.includes("extraction_failed"));
  const runId = await claimNext(M4);
  const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: hello", sourceUrl: "https://discord.com/channels/x" });
  const result = await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "not_event", reason: "" }) });
  assert.equal(result.outcome, "not_event");
  const run = (await t.run(ctx => ctx.db.get(runId)))!;
  assert.equal(run.reason, "not_event");
  assert.ok((await t.run(ctx => ctx.db.get(draftId)))!.expiresAt <= Date.now());
  assert.ok((await sends()).some(send => send.subject.startsWith("[VRDex ops] Resolved: discord-intake:")));
});
