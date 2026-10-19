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

it("cancellation during fenced startup delivers stop before task registration", async () => {
  const { t, owner, event, args } = await fixture();
  const acquired = await t.mutation(worker("acquireSession"), args);
  const owned = { ...args, epoch: acquired.epoch };
  await t.mutation(worker("claimCommands"), owned);
  assert.equal((await t.run(ctx => ctx.db.get(args.sessionId)))?.workerTaskId, undefined);
  await owner.mutation(api.events.setCommunityEventCancelled, { currentSlug: event.slug, cancelled: true, reason: "Host cancelled" });
  const renewed = await t.mutation(worker("renewSession"), owned);
  const claimed = await t.mutation(worker("claimCommands"), owned);
  assert.ok(!renewed.granted || claimed.commands.some((c: { commandType: string }) => c.commandType === "stop_program"));
  const stop = claimed.commands.find((c: { commandType: string }) => c.commandType === "stop_program");
  assert.ok(stop);
  const outcome = { ...owned, commandId: stop._id, sequence: stop.sequence, outcome: "succeeded", observedState: "ended", observedSourceId: null, observedOutputId: null };
  assert.equal((await t.mutation(worker("acknowledgeCommand"), outcome)).accepted, true);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), outcome)).duplicate, true);
  assert.equal((await t.mutation(worker("renewSession"), owned)).granted, false);
});

it("older unbound source intent precedes newer session-bound intent", async () => {
  const { t, owner, event, output, args } = await fixture();
  const [sourceA, sourceB] = await t.run(async ({ db }) => Promise.all(["source_a", "source_b"].map(key => db.insert("eventMediaSources", { programId: output.programId, eventId: event.eventId, key, position: 0, type: "vrcdn_link", purpose: "program", state: "ready", label: key, createdAt: Date.now(), updatedAt: Date.now() }))));
  const olderId = await t.run(({ db }) => db.insert("eventMediaCommands", { programId: output.programId, eventId: event.eventId, commandType: "switch_source", status: "queued", actorSurface: "web", targetSourceId: sourceA, targetSourceKey: "source_a", publicFallbackLinks: [], createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000 }));
  const newer = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_source", targetSourceKey: "source_b" });
  const acquired = await t.mutation(worker("acquireSession"), args);
  const owned = { ...args, epoch: acquired.epoch };
  const claimed = await t.mutation(worker("claimCommands"), owned);
  const older = claimed.commands.find((c: { _id: string }) => c._id === olderId);
  const latest = claimed.commands.find((c: { _id: string }) => c._id === newer.commandId);
  assert.ok(older.sequence < latest.sequence);
  for (const command of claimed.commands) {
    assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...owned, commandId: command._id, sequence: command.sequence, outcome: "succeeded", ...(command.targetSourceId === undefined ? {} : { observedSourceId: command.targetSourceId }) })).accepted, true);
  }
  assert.equal((await t.run(ctx => ctx.db.get(output.programId)))?.currentSourceId, sourceB);
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...owned, commandId: older._id, sequence: older.sequence, outcome: "succeeded", observedSourceId: sourceA })).duplicate, true);
  assert.equal((await t.run(ctx => ctx.db.get(output.programId)))?.currentSourceId, sourceB);
});

it("cancelled session renewal cannot extend publication past its stop grace period", async () => {
  const { t, owner, event, args } = await fixture();
  const acquired = await t.mutation(worker("acquireSession"), args);
  await t.mutation(worker("claimCommands"), { ...args, epoch: acquired.epoch });
  await owner.mutation(api.events.setCommunityEventCancelled, { currentSlug: event.slug, cancelled: true, reason: "Host cancelled" });
  const stopRequestedAt = Date.now() - 15_000;
  await t.run(ctx => ctx.db.patch(args.sessionId, { stopRequestedAt }));
  const renewed = await t.mutation(worker("renewSession"), { ...args, epoch: acquired.epoch });
  assert.equal(renewed.granted, true);
  assert.equal(renewed.expiresAt, stopRequestedAt + 30_000);
  await t.run(ctx => ctx.db.patch(args.sessionId, { stopRequestedAt: Date.now() - 30_001 }));
  assert.equal((await t.mutation(worker("renewSession"), { ...args, epoch: acquired.epoch })).granted, false);
});

it('Twitch output setup is private, explicitly enabled, and preserves selected VRCDN', async()=>{
 const {t,owner,event,output,args}=await fixture();
 const setup={currentSlug:event.slug,key:'twitch',label:'Twitch',channel:'example',credentialRef:'event-media/twitch/owned',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true};
 const ref=makeFunctionReference<'mutation'>('events:configureTwitchOutput');
 await assert.rejects(()=>t.mutation(ref,setup));
 const added=await owner.mutation(ref,setup);
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentOutputId,output.outputId);
 const lease=await t.mutation(worker('acquireSession'),args);
 let config=(await t.mutation(worker('refreshConfiguration'),{...args,epoch:lease.epoch})).configuration;
 assert.equal(config.outputs.find((o:any)=>o.id===added.outputId).simulcastEnabled,false);
 await owner.mutation(ref,{...setup,simulcastEnabled:true});
 config=(await t.mutation(worker('refreshConfiguration'),{...args,epoch:lease.epoch})).configuration;
 assert.equal(config.outputs.find((o:any)=>o.id===added.outputId).simulcastEnabled,true);
 const privateStatus=await owner.query(api.events.getEventMediaControlStatus,{currentSlug:event.slug});
 assert.equal(privateStatus.outputs.find((o:any)=>o.outputId===added.outputId)?.simulcastEnabled,true);
 assert.equal(privateStatus.outputs.find((o:any)=>o.outputId===added.outputId)?.twitchSetup?.channel,'example');
 assert.ok(!JSON.stringify(privateStatus).includes('event-media/twitch/owned'));
 assert.equal(config.outputs.find((o:any)=>o.id===added.outputId).twitchSetup.profile,'twitch-conservative-720p30');
 await assert.rejects(()=>owner.mutation(ref,{...setup,channel:'https://evil.test/key'}));
});
it('destination health is fenced and rejects outputs belonging to another event',async()=>{
 const {t,args,output}=await fixture(); const lease=await t.mutation(worker('acquireSession'),args);
 const destinations=[{outputId:output.outputId,destination:'vrcdn',status:'publishing',publishing:true,queueBytes:0,outputMs:1000,restarts:0}];
 assert.equal((await t.mutation(worker('observeOutputs'),{...args,epoch:lease.epoch,destinations})).accepted,true);
 assert.equal((await t.run(ctx=>ctx.db.get(args.sessionId)))?.outputHealth?.[0].status,'publishing');
 assert.equal((await t.mutation(worker('observeOutputs'),{...args,epoch:0,destinations})).accepted,false);
 const other=await t.run(async ctx=> {const o=await ctx.db.get(output.outputId); return ctx.db.insert('eventMediaOutputs',{...Object.fromEntries(Object.entries(o!).filter(([k])=>!['_id','_creationTime'].includes(k))),programId:output.programId,eventId:await ctx.db.insert('events',Object.fromEntries(Object.entries((await ctx.db.get(args.eventId))!).filter(([k])=>!['_id','_creationTime'].includes(k))) as any)} as any);});
 assert.equal((await t.mutation(worker('observeOutputs'),{...args,epoch:lease.epoch,destinations:[{...destinations[0],outputId:other}]})).accepted,false);
});
it('destination keys cannot be converted by the legacy VRCDN writer or malformed Twitch discriminator',async()=>{
 const {t,owner,event}=await fixture();const ref=makeFunctionReference<'mutation'>('events:configureTwitchOutput');
 const setup={currentSlug:event.slug,key:'twitch-main',label:'Twitch',channel:'example',credentialRef:'event-media/twitch/owned',simulcastEnabled:true,sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true};
 const added=await owner.mutation(ref,setup);const before=await t.run(ctx=>ctx.db.get(added.outputId));
 await assert.rejects(()=>owner.mutation(api.events.configureVrcdnOutput,{currentSlug:event.slug,key:setup.key,label:'VRCDN',credentialRef:'event-media/vrcdn/main',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true}),/another destination/);
 assert.deepEqual(await t.run(ctx=>ctx.db.get(added.outputId)),before);
 await owner.mutation(ref,{...setup,simulcastEnabled:false});await owner.mutation(ref,{...setup,key:'twitch-other'});
 await t.run(ctx=>ctx.db.patch(added.outputId,{type:'vrcdn',simulcastEnabled:true}));
 await assert.rejects(()=>owner.mutation(ref,{...setup,simulcastEnabled:false}),/another destination/);
 // A legacy malformed row cannot reserve optional Twitch capacity or enter bridge dispatch.
 const other=await owner.mutation(ref,{...setup,key:'twitch-other'});
 const command=await t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge-fix1'});
 assert.ok(command); assert.deepEqual(command.optionalOutputs.map((o:any)=>o?.outputId),[other.outputId]);
 const {taskDefinitionFor}=await import('../../scripts/event-media-ecs-bridge.mjs');
 const arn='arn:aws:secretsmanager:us-east-1:123456789012:secret:optional-ABC123';
 const definition=taskDefinitionFor(command,{baseEnvironment:{},secretRefMap:{'event-media/vrcdn/main':'arn:main','event-media/twitch/owned':arn},outputSecretEnvName:'VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON',workerTokenSecretArn:'arn:token'});
 assert.ok(!definition.containerDefinitions[0].secrets.some((entry:any)=>entry.valueFrom===arn));
 const lease=await t.mutation(worker('acquireSession'),{bridgeToken,eventId:event.eventId,sessionId:command.session.sessionId,workerId:'output-worker',epoch:0});
 const badHealth=await t.mutation(worker('observeOutputs'),{bridgeToken,eventId:event.eventId,sessionId:command.session.sessionId,workerId:'output-worker',epoch:lease.epoch,destinations:[{outputId:added.outputId,destination:'twitch',status:'publishing',publishing:true,queueBytes:0,outputMs:1000,restarts:0}]});
 assert.equal(badHealth.accepted,false);
});

it("operator_status_projects_observed_execution_and_capability", async () => {
  const { owner, event, t, args } = await fixture();
  await t.run(ctx => ctx.db.patch(args.sessionId, { lastAcknowledgedSequence: 7, broadcastMode: "hold" }));
  const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(status.canControl, true);
  assert.equal(status.sessions[0].lastAcknowledgedSequence, 7);
  assert.ok(status.serverNow > 0);
  await assert.rejects(t.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug }));
});

it("double_next_keeps_one_pending_command_and_revocation_denies_commands", async () => {
  const { owner, event, t } = await fixture();
  const first = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_next" });
  const second = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_next" });
  assert.equal(first.commandId, second.commandId);
  await t.run(async ctx => { for (const row of await ctx.db.query("profileOwners").collect()) await ctx.db.delete(row._id); });
  await assert.rejects(owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_hold" }));
  await assert.rejects(t.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_hold" }));
});

it("read_only_host_can_read_status_but_cannot_control", async () => {
  const { t, event } = await fixture();
  const subject = newClerkUserId();
  await t.run(async ctx => {
    await ctx.db.insert("users", { clerkUserId: subject, name: "Host", email: "host@example.test", emailVerificationTime: Date.now() });
    const community = (await ctx.db.query("profiles").collect())[0];
    await ctx.db.insert("communityAuthorities", { communityProfileId: community._id, subjectTokenIdentifier: `test|${subject}`, subject: { subject, issuer: "test", tokenIdentifier: `test|${subject}` }, capabilities: ["view_event_operations"], state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const host = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const status = await host.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(status.canControl, false);
  await assert.rejects(host.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_hold" }));
  await assert.rejects(host.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug }));
});

it("operator_stops_offering_revoked_profile_source_before_worker_refresh", async () => {
  const { t, owner, event, args } = await fixture();
  const person = await t.run(async ({db}) => {
    const id = await db.insert("profiles", { slug: "operator-dj", displayName: "DJ", sortName: "dj", aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now(), profileType: "person", person: { roleTags: [] }, outboundLinks: [{ type: "other", label: "Stream", source: "owner_authored", url: "vrcdn:alpha" }] });
    await db.insert("eventSlots", { eventId: event.eventId, position: 0, startAt: Date.now(), personProfileId: id, selectedStreamId: "alpha", displayLabel: "DJ", roleLabel: "DJ", sourceType: "manual", sourceLabel: "Owner", confidence: 1, reviewState: "confirmed", updatedAt: Date.now() });
    return id;
  });
  await t.mutation(worker("acquireSession"), args);
  const before = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(before.sources[0].hasPublicUrl, true);
  await t.run(({db}) => db.patch(person, { outboundLinks: [] }));
  const after = await owner.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(after.sources[0].hasPublicUrl, false);
  await assert.rejects(owner.mutation(api.events.queueEventMediaCommand, { currentSlug: event.slug, type: "switch_source", targetSourceKey: after.sources[0].key }));
});

it("pending_next_from_an_ended_session_does_not_block_a_new_session", async () => {
  const { t, owner, event, args } = await fixture();
  const old = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug:event.slug, type:"switch_next" });
  await t.run(({db}) => db.patch(args.sessionId, { status:"ended" }));
  await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug:event.slug });
  const current = await owner.mutation(api.events.queueEventMediaCommand, { currentSlug:event.slug, type:"switch_next" });
  assert.notEqual(current.commandId, old.commandId);
});

it("operator_account_choices_never_expose_credential_references", async () => {
  const previous = process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON;
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key:"organizer", channel:"afterglow", credentialRef:"event-media/twitch/private" }]);
  try {
    const { owner, event } = await fixture();
    const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug:event.slug });
    assert.deepEqual(status.twitchAccounts, [{ key:"organizer", channel:"afterglow" }]);
    assert.equal(JSON.stringify(status).includes("event-media/twitch/private"), false);
  } finally {
    if (previous === undefined) delete process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON;
    else process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = previous;
  }
});

it("invalid_optional_account_registry_does_not_hide_worker_controls", async () => {
  const previous = process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON;
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = "invalid-json";
  try {
    const { owner, event } = await fixture();
    const status = await owner.query(api.events.getEventMediaControlStatus, { currentSlug:event.slug });
    assert.equal(status.canControl, true);
    assert.deepEqual(status.twitchAccounts, []);
    assert.equal(status.outputs[0].label, "Main");
  } finally {
    if (previous === undefined) delete process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON;
    else process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = previous;
  }
});
