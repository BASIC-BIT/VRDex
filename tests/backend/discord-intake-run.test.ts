import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { buildSourceText, pickPosterAttachments } from "../../convex/_discordIntake";
import { EVENT_POSTER_MAX_BYTES, resolveEventLocalTime } from "../../packages/api-contracts/src/event-intake";
import { newClerkUserId } from "./_clerkTestIdentity";
import { AUTHOR_B, CHANNEL, GUILD, M1, M2, message, record, revokeManageIntegrations, seedCommunity, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
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
  const runThrough = async () => {
    const runId = (await pendingRun(t))._id;
    await t.mutation(internal.discordIntake.claimRun, { runId });
    const draftId = await t.mutation(internal.discordIntake.saveRunDraft, { runId, sourceText: "Ari: Friday", sourceUrl: "https://discord.com/channels/x" });
    return (await t.mutation(internal.discordIntake.finishRun, { runId, draftId, candidate: candidate({ kind: "new" }) })).outcome;
  };
  await record(t, "create", message(M1));
  assert.equal(await runThrough(), "published");
  // Run B's first trigger is M2, so its own triggerMessageIds[0] is not the link's external ID.
  await record(t, "create", message(M2));
  await record(t, "update", message(M1, { content: "now 22:00", editedAt: Date.now() }));
  assert.equal(await runThrough(), "updated");
  await record(t, "update", message(M2, { content: "flyer v2", editedAt: Date.now() }));
  assert.equal(await runThrough(), "updated");
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
  assert.deepEqual(await t.mutation(internal.discordIntake.claimRun, { runId }), { kind: "skip", reason: "source_deleted" });
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
