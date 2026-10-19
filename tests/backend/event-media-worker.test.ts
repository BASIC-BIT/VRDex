import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const worker = (name: string) => makeFunctionReference<"mutation">(`eventMediaWorker:${name}`);
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
};
const bridgeToken = "worker-test-only-credential";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;

async function fixture() {
  const t = convexTest({ schema, modules });
  const subject = newClerkUserId();
  await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", { clerkUserId: subject, name: "Owner", email: "owner@example.test", emailVerificationTime: now });
    const profileId = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] } });
    await db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
  });
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const event = await owner.mutation(api.events.createCommunityEvent, { title: "Worker event", communitySlug: "club", startAt: Date.now() + 600_000, timezone: "UTC" });
  const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }] });
  const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
  // Make the scheduled start eligible without replacing Convex's clock.
  await t.run(async ctx => {
    await ctx.db.patch(scheduled.sessionId, { scheduledStartAt: Date.now() - 1000 });
    if (scheduled.startCommandId) await ctx.db.patch(scheduled.startCommandId, { availableAt: Date.now() - 1000 });
  });
  const args = { bridgeToken, eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "worker-a", epoch: 0 };
  return { t, owner, event, output, scheduled, args };
}

it("duplicate_start_is_idempotent", async () => {
  const { t, args } = await fixture();
  const first = await t.mutation(worker("acquireSession"), args);
  const retry = await t.mutation(worker("acquireSession"), args);
  assert.equal(first.granted, true);
  assert.equal(first.epoch, 1);
  assert.equal(retry.epoch, first.epoch);
  assert.equal(retry.expiresAt, first.expiresAt);
  assert.equal(first.renewAfterMs, 10_000);
  assert.equal(first.expiresAt - first.acquiredAt, 30_000);
  const competing = await t.mutation(worker("acquireSession"), { ...args, workerId: "worker-b", epoch: first.epoch });
  assert.equal(competing.granted, false);
  const sessions = await t.run(ctx => ctx.db.query("eventMediaSessions").collect());
  assert.equal(sessions.filter(s => s.workerId !== undefined && !["ended", "error"].includes(s.status)).length, 1);
});

it("expired_owner_cannot_ack", async () => {
  const { t, owner, event, args } = await fixture();
  const lease = await t.mutation(worker("acquireSession"), args);
  await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "hold_current" });
  const claim = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  const command = claim.commands[0];
  assert.ok(command);
  await t.run(ctx => ctx.db.patch(args.sessionId, { leaseExpiresAt: Date.now() - 1 }));
  const result = await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded" });
  assert.equal(result.accepted, false);
  assert.equal((await t.run(ctx => ctx.db.get(command._id)))?.status, "claimed");
  assert.equal((await t.mutation(worker("renewSession"), { ...args, epoch: lease.epoch })).granted, false);
  assert.ok((await t.run(ctx => ctx.db.query("eventMediaAuditEvents").collect())).some(a => a.action === "worker_request_rejected"));
});

it("replacement_increments_epoch", async () => {
  const { t, args } = await fixture();
  const lease = await t.mutation(worker("acquireSession"), args);
  await t.run(ctx => ctx.db.patch(args.sessionId, { leaseExpiresAt: Date.now() - 1 }));
  const replacement = await t.mutation(worker("acquireSession"), { ...args, workerId: "worker-b", epoch: lease.epoch });
  assert.equal(replacement.granted, true);
  assert.equal(replacement.epoch, lease.epoch + 1);
  assert.equal((await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch })).granted, false);
  assert.equal((await t.mutation(worker("renewSession"), { ...args, epoch: lease.epoch })).granted, false);
  assert.equal((await t.mutation(worker("renewSession"), { ...args, workerId: "worker-b", epoch: replacement.epoch })).granted, true);
});

it("queued_switch_does_not_change_observed_source", async () => {
  const { t, owner, event, output, args } = await fixture();
  const sourceId = await t.run(ctx => ctx.db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, key: "dj", position: 0, type: "vrcdn_link", purpose: "program", state: "ready", label: "DJ", publicUrl: "https://stream.vrcdn.live/live/dj.live.ts", createdAt: Date.now(), updatedAt: Date.now() }));
  const lease = await t.mutation(worker("acquireSession"), args);
  const queued = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_source", targetSourceKey: "dj" });
  await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "hold_current" });
  assert.equal((await t.run(ctx => ctx.db.get(output.programId)))?.currentSourceId, undefined);
  const claimed = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  assert.equal(claimed.granted, true);
  const commands = claimed.commands;
  assert.ok(commands.length >= 2);
  assert.ok(commands.every((c: { sequence: number }, i: number) => i === 0 || c.sequence > commands[i - 1].sequence));
  const switched = commands.find((c: { _id: string }) => c._id === queued.commandId);
  assert.ok(switched);
  // Acknowledgements advance in sequence; the scheduled lifecycle start may precede the switch.
  for (const command of commands.filter((c: { sequence: number }) => c.sequence <= switched.sequence)) {
    const result = await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded", ...(command._id === queued.commandId ? { observedSourceId: sourceId } : {}) });
    assert.equal(result.accepted, true);
  }
  assert.equal((await t.run(ctx => ctx.db.get(output.programId)))?.currentSourceId, sourceId);
  const retry = await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: switched._id, sequence: switched.sequence, outcome: "succeeded", observedSourceId: sourceId });
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, true);
});

it("rejects unauthorized actors and cross-event session and command IDs", async () => {
  const { t, event, args, scheduled } = await fixture();
  await assert.rejects(t.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "hold_current" }), /authenticat|signed-in/i);
  await assert.rejects(t.mutation(worker("acquireSession"), { ...args, bridgeToken: "incorrect" }), /token.*invalid/i);
  const otherEventId = await t.run(async ({ db }) => {
    const { _id, _creationTime, ...record } = (await db.get(event.eventId))!;
    return db.insert("events", { ...record, slug: "other-event" });
  });
  assert.equal((await t.mutation(worker("acquireSession"), { ...args, eventId: otherEventId })).granted, false);
  const lease = await t.mutation(worker("acquireSession"), args);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: scheduled.startCommandId, sequence: 999, outcome: "succeeded" })).accepted, false);
});

it("replacement reclaims pending commands and rejects old epoch acknowledgements", async () => {
  const { t, owner, event, args } = await fixture();
  const first = await t.mutation(worker("acquireSession"), args);
  await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "hold_current" });
  const initial = await t.mutation(worker("claimCommands"), { ...args, epoch: first.epoch });
  await t.run(ctx => ctx.db.patch(args.sessionId, { leaseExpiresAt: Date.now() - 1 }));
  const nextArgs = { ...args, workerId: "worker-b", epoch: first.epoch };
  const next = await t.mutation(worker("acquireSession"), nextArgs);
  const reclaimed = await t.mutation(worker("claimCommands"), { ...nextArgs, epoch: next.epoch });
  assert.deepEqual(reclaimed.commands.map((c: { sequence: number }) => c.sequence), initial.commands.map((c: { sequence: number }) => c.sequence));
  const command = initial.commands[0];
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: first.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded" })).accepted, false);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...nextArgs, epoch: next.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded" })).accepted, true);
});

it("legacy commands are sequenced and claims and acknowledgements stay ordered", async () => {
  const { t, owner, event, args, scheduled } = await fixture();
  await t.run(async ({ db }) => {
    await db.patch(args.sessionId, { nextCommandSequence: undefined });
    await db.patch(scheduled.startCommandId!, { sequence: undefined });
  });
  const queued = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "hold_current" });
  const lease = await t.mutation(worker("acquireSession"), args);
  const claimed = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  assert.deepEqual(claimed.commands.map((c: { sequence: number }) => c.sequence), [1, 2]);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: queued.commandId, sequence: 2, outcome: "succeeded" })).accepted, false);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: scheduled.startCommandId, sequence: 1, outcome: "failed" })).accepted, true);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: queued.commandId, sequence: 2, outcome: "succeeded" })).accepted, true);
});

it("cross-event commands and observed sources cannot be acknowledged", async () => {
  const { t, args, event, output } = await fixture();
  const lease = await t.mutation(worker("acquireSession"), args);
  const other = await t.run(async ({ db }) => {
    const { _id, _creationTime, ...record } = (await db.get(event.eventId))!;
    const eventId = await db.insert("events", { ...record, slug: "other-event" });
    const sourceId = await db.insert("eventMediaSources", { programId: output.programId, eventId, key: "other", position: 0, type: "vrcdn_link", purpose: "program", state: "ready", label: "Other", createdAt: Date.now(), updatedAt: Date.now() });
    const commandId = await db.insert("eventMediaCommands", { eventId, programId: output.programId, sessionId: args.sessionId, sequence: 999, commandType: "hold_current", status: "claimed", actorSurface: "worker", publicFallbackLinks: [], claimedEpoch: lease.epoch, claimedByWorkerId: args.workerId, createdAt: Date.now(), updatedAt: Date.now() });
    const { _id: outputRecordId, _creationTime: outputCreatedAt, ...outputRecord } = (await db.get(output.outputId))!;
    const outputId = await db.insert("eventMediaOutputs", { ...outputRecord, eventId });
    return { sourceId, commandId, outputId };
  });
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: other.commandId, sequence: 999, outcome: "succeeded" })).accepted, false);
  const claimed = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  const command = claimed.commands[0];
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded", observedSourceId: other.sourceId })).accepted, false);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded", observedOutputId: other.outputId })).accepted, false);
});

it("legacy bridge status cannot overwrite fenced ownership", async () => {
  const { t, args } = await fixture();
  const lease = await t.mutation(worker("acquireSession"), args);
  await assert.rejects(t.mutation(api.events.recordEventMediaWorkerBridgeTaskStatus, { bridgeToken, workerId: "old-bridge", sessionId: args.sessionId, status: "live" }), /Fenced/);
  const session = await t.run(ctx => ctx.db.get(args.sessionId));
  assert.equal(session?.workerId, args.workerId);
  assert.equal(session?.epoch, lease.epoch);
});

it("successful source switches require actual observed source and never infer it from intent", async () => {
  const { t, owner, event, args, output } = await fixture();
  const sourceId = await t.run(ctx => ctx.db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, key: "dj", position: 0, type: "vrcdn_link", purpose: "program", state: "ready", label: "DJ", createdAt: Date.now(), updatedAt: Date.now() }));
  const lease = await t.mutation(worker("acquireSession"), args);
  const queued = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_source", targetSourceKey: "dj" });
  const claim = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  const first = claim.commands[0];
  await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: first._id, sequence: first.sequence, outcome: "succeeded" });
  const command = claim.commands.find((c: { _id: string }) => c._id === queued.commandId);
  const result = await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded" });
  assert.equal(result.accepted, false);
  assert.equal((await t.run(ctx => ctx.db.get(output.programId)))?.currentSourceId, undefined);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded", observedSourceId: sourceId })).accepted, true);
});

it("acknowledgement records observed hold state and explicitly clears the old source", async () => {
  const { t, owner, event, args, output } = await fixture();
  const lease = await t.mutation(worker("acquireSession"), args);
  await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_hold" });
  const claimed = await t.mutation(worker("claimCommands"), { ...args, epoch: lease.epoch });
  for (const command of claimed.commands) {
    assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: command._id, sequence: command.sequence, outcome: "succeeded", observedState: "hold", observedSourceId: null })).accepted, true);
  }
  const state = await t.run(async ({ db }) => ({ session: await db.get(args.sessionId), program: await db.get(output.programId) }));
  assert.equal(state.session?.status, "hold");
  assert.equal(state.program?.state, "hold");
  assert.equal(state.program?.currentSourceId, undefined);
});
