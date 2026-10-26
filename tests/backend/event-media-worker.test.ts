import { resolveSyntheticAllocation } from "../fixtures/event-capacity.mjs";
import { loadFixtureEvents } from "../fixtures/event-modules";
import { syntheticInputs } from '../../scripts/event-proof-fixtures.mjs';
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
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
  "../../convex/events.ts": loadFixtureEvents,
  "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
};
const bridgeToken = "worker-test-only-credential";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;

async function setupFixture() {
  const t = convexTest({ schema, modules });
  const subject = newClerkUserId();
  await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", { clerkUserId: subject, name: "Owner", email: "owner@example.test", emailVerificationTime: now });
    const profileId = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] } });
    bindVrcdnTestAccount(profileId, "event-media/vrcdn/main");
    await db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
  });
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const event = await owner.mutation(api.events.createCommunityEvent, { title: "Worker event", communitySlug: "club", startAt: Date.now() + 600_000, timezone: "UTC" });
  const output = await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true, playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }] });
  async function schedule() {
    const scheduled = await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug });
    // Make the scheduled start eligible without replacing Convex's clock.
    await t.run(async ctx => {
      await ctx.db.patch(scheduled.sessionId, { scheduledStartAt: Date.now() - 1000 });
      if (scheduled.startCommandId) await ctx.db.patch(scheduled.startCommandId, { availableAt: Date.now() - 1000 });
    });
    const args = { protocolVersion: 2, bridgeToken, eventId: event.eventId, sessionId: scheduled.sessionId, workerId: "worker-a", epoch: 0 };
    return { scheduled, args };
  }
  return {t, owner, event, output, schedule};
}
async function fixture() {
  const f=await setupFixture();
  return {...f,...await f.schedule()};
}
async function observationFixture() {
  const f = await setupFixture();
  // Already admitted session for observation tests; scheduling fixtures bind
  // explicit synthetic capacity separately from the production guard.
  const scheduled = await f.t.run(async ({ db }) => {
    const now = Date.now();
    const sessionId = await db.insert("eventMediaSessions", {
      programId: f.output.programId, eventId: f.event.eventId,
      outputId: f.output.outputId, controlProtocolVersion: 2,
      committedIntent: { kind: "automatic" }, intentSequence: 0,
      status: "scheduled", nextCommandSequence: 2,
      scheduledStartAt: now, readyDeadlineAt: now + 180_000,
      createdAt: now, updatedAt: now,
    });
    const startCommandId = await db.insert("eventMediaCommands", {
      programId: f.output.programId, eventId: f.event.eventId, sessionId,
      commandType: "start_program", sequence: 1, status: "queued",
      targetOutputId: f.output.outputId, publicFallbackLinks: [],
      actorSurface: "web", availableAt: now, createdAt: now, updatedAt: now,
    });
    await db.patch(f.output.programId, {
      activeSessionId: sessionId, currentOutputId: f.output.outputId,
      state: "ready", updatedAt: now,
    });
    return { sessionId, startCommandId };
  });
  const args = { protocolVersion: 2, bridgeToken, eventId: f.event.eventId,
    sessionId: scheduled.sessionId, workerId: "worker-a", epoch: 0 };
  return { ...f, scheduled, args };
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
  await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug: event.slug, type: "hold_current" });
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
 const {t,owner,event,output,args}=await fixture();
 const sourceId=await t.run(ctx=>ctx.db.insert("eventMediaSources",{programId:output.programId,eventId:event.eventId,key:"dj",position:0,type:"vrcdn_link",purpose:"program",state:"ready",label:"DJ",publicUrl:"vrcdn:source_a",revision:1,createdAt:Date.now(),updatedAt:Date.now()}));
 const lease=await t.mutation(worker("acquireSession"),args);const owned={...args,epoch:lease.epoch};
 const queued=await owner.mutation(api.events.queueEventMediaCommand,{currentSlug:event.slug,type:"switch_source",targetSourceKey:"dj",idempotencyKey:"take"});
 await assert.rejects(owner.mutation(api.events.queueEventMediaCommand,{currentSlug:event.slug,type:"hold_current",idempotencyKey:"hold"}),/pending/);
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentSourceId,undefined);
 const command=(await t.run(ctx=>ctx.db.get(queued.commandId)))!;
 const receipt={...owned,commandId:command._id,sequence:command.sequence};
 await t.mutation(worker("beginPreparation"),receipt);await t.mutation(worker("promoteOperation"),{...receipt,target:command.controlTarget});
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentSourceId,undefined);
 const ack={...receipt,outcome:"succeeded",intentSequence:command.sequence,outputMs:100,observedSourceId:sourceId,sourceRevision:1,slotKey:`manual-${sourceId}`,observedOutputId:output.outputId,observedState:"live"};
 assert.equal((await t.mutation(worker("acknowledgeCommand"),ack)).kind,"ok");assert.equal((await t.mutation(worker("acknowledgeCommand"),ack)).duplicate,true);
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentSourceId,sourceId);
});

it("rejects unauthorized actors and cross-event session and command IDs", async () => {
  const { t, event, args, scheduled } = await fixture();
  await assert.rejects(t.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug: event.slug, type: "hold_current" }), /authenticat|signed-in/i);
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
  await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug: event.slug, type: "hold_current" });
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

it("protocol 2 does not attach unnumbered historical commands",async()=>{
 const {t,args,scheduled}=await fixture();
 await t.run(ctx=>ctx.db.patch(scheduled.startCommandId!,{sequence:undefined}));
 const lease=await t.mutation(worker("acquireSession"),args);const claim=await t.mutation(worker("claimCommands"),{...args,epoch:lease.epoch});
 assert.deepEqual(claim.commands,[]);assert.equal((await t.run(ctx=>ctx.db.get(scheduled.startCommandId!)))?.sequence,undefined);
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
  assert.equal((await t.mutation(worker("acknowledgeCommand"), { ...args, epoch: lease.epoch, commandId: other.commandId, sequence: 999, outcome: "succeeded" })).kind, "superseded");
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

it("successful source switches require coherent observed identity",async()=>{
 const {t,owner,event,args,output}=await fixture();
 const sourceId=await t.run(ctx=>ctx.db.insert("eventMediaSources",{programId:output.programId,eventId:event.eventId,key:"dj",position:0,type:"vrcdn_link",purpose:"program",state:"ready",label:"DJ",publicUrl:"vrcdn:source_a",createdAt:Date.now(),updatedAt:Date.now()}));
 const lease=await t.mutation(worker("acquireSession"),args);
 const queued=await owner.mutation(api.events.queueEventMediaCommand,{currentSlug:event.slug,type:"switch_source",targetSourceKey:"dj",idempotencyKey:"take"});
 const c=(await t.run(ctx=>ctx.db.get(queued.commandId)))!;const receipt={...args,epoch:lease.epoch,commandId:c._id,sequence:c.sequence};
 await t.mutation(worker("beginPreparation"),receipt);await t.mutation(worker("promoteOperation"),{...receipt,target:c.controlTarget});
 assert.equal((await t.mutation(worker("acknowledgeCommand"),{...receipt,outcome:"succeeded"})).kind,"superseded");
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentSourceId,undefined);
 assert.equal((await t.mutation(worker("acknowledgeCommand"),{...receipt,outcome:"succeeded",intentSequence:c.sequence,outputMs:100,observedSourceId:sourceId,sourceRevision:1,slotKey:`manual-${sourceId}`,observedOutputId:output.outputId,observedState:"live"})).kind,"ok");
});

it("Cut acknowledgement records slate and does not wait for Start acknowledgement",async()=>{
 const {t,owner,event,args,output}=await fixture();const lease=await t.mutation(worker("acquireSession"),args);
 const cut=await owner.mutation(api.events.queueEventMediaCommand,{currentSlug:event.slug,type:"switch_hold",idempotencyKey:"cut"});
 const c=(await t.run(ctx=>ctx.db.get(cut.commandId)))!;const receipt={...args,epoch:lease.epoch,commandId:c._id,sequence:c.sequence};
 await t.mutation(worker("beginPreparation"),receipt);
 assert.equal((await t.mutation(worker("acknowledgeCommand"),{...receipt,outcome:"succeeded",intentSequence:c.sequence,outputMs:100,observedState:"hold",observedSourceId:null,observedOutputId:output.outputId})).kind,"ok");
 const state=await t.run(async({db})=>({session:await db.get(args.sessionId),program:await db.get(output.programId)}));
 assert.equal(state.session?.status,"hold");assert.equal(state.session?.committedIntent?.kind,"slate");assert.equal(state.program?.currentSourceId,undefined);
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

it("older unbound source intent cannot enter a new protocol session",async()=>{
 const {t,owner,event,output,args}=await fixture();
 const old=await t.run(({db})=>db.insert("eventMediaCommands",{programId:output.programId,eventId:event.eventId,commandType:"switch_source",status:"queued",actorSurface:"web",publicFallbackLinks:[],createdAt:1,updatedAt:1}));
 const queued=await owner.mutation(api.events.queueEventMediaCommand,{currentSlug:event.slug,type:"switch_hold",idempotencyKey:"cut"});
 const lease=await t.mutation(worker("acquireSession"),args);const claim=await t.mutation(worker("claimCommands"),{...args,epoch:lease.epoch});
 assert.ok(claim.commands.some((c:{_id:string})=>c._id===queued.commandId));assert.ok(!claim.commands.some((c:{_id:string})=>c._id===old));
 assert.equal((await t.run(ctx=>ctx.db.get(old)))?.sessionId,undefined);
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
 const {t,owner,event,output,schedule}=await setupFixture();
 const communityId=(await t.run(({db})=>db.get(event.eventId)))?.communityProfileId;
 process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:communityId}]);
 const setup={currentSlug:event.slug,key:'twitch',label:'Twitch',channel:'example',credentialRef:'event-media/twitch/owned',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true};
 const ref=makeFunctionReference<'mutation'>('events:configureTwitchOutput');
 await assert.rejects(()=>t.mutation(ref,setup));
 const added=await owner.mutation(ref,setup);
 assert.equal((await t.run(ctx=>ctx.db.get(output.programId)))?.currentOutputId,output.outputId);
 assert.equal((await t.run(ctx=>ctx.db.get(added.outputId)))?.simulcastEnabled,false);
 await owner.mutation(ref,{...setup,simulcastEnabled:true});
 const {args}=await schedule();
 const lease=await t.mutation(worker('acquireSession'),args);
 const config=(await t.mutation(worker('refreshConfiguration'),{...args,epoch:lease.epoch})).configuration;
 assert.equal(config.outputs.find((o:any)=>o.id===added.outputId).simulcastEnabled,true);
 await assert.rejects(owner.mutation(ref,{...setup,simulcastEnabled:false}),/session/);
 const privateStatus=await owner.query(api.events.getEventMediaControlStatus,{currentSlug:event.slug});
 assert.equal(privateStatus.outputs.find((o:any)=>o.outputId===added.outputId)?.simulcastEnabled,true);
 assert.equal(privateStatus.outputs.find((o:any)=>o.outputId===added.outputId)?.twitchSetup?.channel,'example');
 assert.ok(!JSON.stringify(privateStatus).includes('event-media/twitch/owned'));
 assert.equal(config.outputs.find((o:any)=>o.id===added.outputId).twitchSetup.profile,'twitch-selected-video');
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
 const {t,owner,event,schedule}=await setupFixture();const ref=makeFunctionReference<'mutation'>('events:configureTwitchOutput');
 const communityId=(await t.run(({db})=>db.get(event.eventId)))?.communityProfileId;
 process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:communityId}]);
 const setup={currentSlug:event.slug,key:'twitch-main',label:'Twitch',channel:'example',credentialRef:'event-media/twitch/owned',simulcastEnabled:true,sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true};
 const added=await owner.mutation(ref,setup);const before=await t.run(ctx=>ctx.db.get(added.outputId));
 await assert.rejects(()=>owner.mutation(api.events.configureVrcdnOutput,{currentSlug:event.slug,key:setup.key,label:'VRCDN',credentialRef:'event-media/vrcdn/main',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true}),/another destination/);
 assert.deepEqual(await t.run(ctx=>ctx.db.get(added.outputId)),before);
 await owner.mutation(ref,{...setup,simulcastEnabled:false});await owner.mutation(ref,{...setup,key:'twitch-other'});
 await t.run(ctx=>ctx.db.patch(added.outputId,{type:'vrcdn',simulcastEnabled:true}));
 await assert.rejects(()=>owner.mutation(ref,{...setup,simulcastEnabled:false}),/another destination/);
 // A legacy malformed row cannot reserve optional Twitch capacity or enter bridge dispatch.
 const other=await owner.mutation(ref,{...setup,key:'twitch-other'});
 await schedule();
 const command=await t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:'bridge-fix1'});
 assert.ok(command); assert.deepEqual(command.optionalOutputs.map((o:any)=>o?.outputId),[other.outputId]);
 const {taskDefinitionFor}=await import('../../scripts/event-media-ecs-bridge.mjs');
 const arn='arn:aws:secretsmanager:us-east-1:123456789012:secret:optional-ABC123';
 const definition=taskDefinitionFor(command,{baseEnvironment:{},secretRefMap:{'event-media/vrcdn/main':'arn:main','event-media/twitch/owned':arn},outputSecretEnvName:'VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON',workerTokenSecretArn:'arn:token'}, resolveSyntheticAllocation);
 assert.ok(!definition.containerDefinitions[0].secrets.some((entry:any)=>entry.valueFrom===arn));
 const lease=await t.mutation(worker('acquireSession'),{protocolVersion:2,bridgeToken,eventId:event.eventId,sessionId:command.session.sessionId,workerId:'output-worker',epoch:0});
 const badHealth=await t.mutation(worker('observeOutputs'),{protocolVersion:2,bridgeToken,eventId:event.eventId,sessionId:command.session.sessionId,workerId:'output-worker',epoch:lease.epoch,destinations:[{outputId:added.outputId,destination:'twitch',status:'publishing',publishing:true,queueBytes:0,outputMs:1000,restarts:0}]});
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

it("identical keyed request reuses one pending command and revocation denies commands", async () => {
  const { owner, event, t } = await fixture();
  const first = await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:"same", currentSlug: event.slug, type: "hold_current" });
  const second = await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:"same", currentSlug: event.slug, type: "hold_current" });
  assert.equal(first.commandId, second.commandId);
  await t.run(async ctx => { for (const row of await ctx.db.query("profileOwners").collect()) await ctx.db.delete(row._id); });
  await assert.rejects(owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:"same", currentSlug: event.slug, type: "switch_hold" }));
  await assert.rejects(t.mutation(api.events.queueEventMediaCommand, { idempotencyKey:"same", currentSlug: event.slug, type: "switch_hold" }));
});

for (const capability of ["view_event_operations", "manage_events"] as const) it(`read_only_${capability}_can_read_status_but_cannot_control`, async () => {
  const { t, event } = await fixture();
  const subject = newClerkUserId();
  await t.run(async ctx => {
    await ctx.db.insert("users", { clerkUserId: subject, name: "Host", email: "host@example.test", emailVerificationTime: Date.now() });
    const community = (await ctx.db.query("profiles").collect())[0];
    await ctx.db.insert("communityAuthorities", { communityProfileId: community._id, subjectTokenIdentifier: `test|${subject}`, subject: { subject, issuer: "test", tokenIdentifier: `test|${subject}` }, capabilities: [capability], state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const host = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const status = await host.query(api.events.getEventMediaControlStatus, { currentSlug: event.slug });
  assert.equal(status.canControl, false);
  await assert.rejects(host.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug: event.slug, type: "switch_hold" }));
  await assert.rejects(host.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug }));
  await assert.rejects(host.mutation(api.events.scheduleEventMediaWorker, { currentSlug: event.slug, startImmediately: true }));
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
  assert.deepEqual(after.sources, []);
  await assert.rejects(owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug: event.slug, type: "switch_source", targetSourceKey: before.sources[0].key }));
});

it("pending_control_from_an_ended_session_does_not_block_a_new_session", async () => {
  const { t, owner, event, args } = await fixture();
  const old = await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug:event.slug, type:"hold_current" });
  await t.run(({db}) => db.patch(args.sessionId, { status:"ended" }));
  await owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug:event.slug });
  const current = await owner.mutation(api.events.queueEventMediaCommand, { idempotencyKey:crypto.randomUUID(), currentSlug:event.slug, type:"hold_current" });
  assert.notEqual(current.commandId, old.commandId);
});

it("operator_account_choices_never_expose_credential_references", async () => {
  const previous = process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON;
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key:"organizer", channel:"afterglow", credentialRef:"event-media/twitch/private" }]);
  try {
    const { t, owner, event } = await fixture();
    const communityId=(await t.run(({db})=>db.get(event.eventId)))?.communityProfileId;
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:"organizer",channel:"afterglow",credentialRef:"event-media/twitch/private",ownerCommunityProfileId:communityId}]);
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

const twitchConsent = { sourceConsentAccepted:true, destinationAuthorityAccepted:true, providerRulesAccepted:true, rightsClearedMediaAccepted:true };
async function twitchCommunity(f: Awaited<ReturnType<typeof setupFixture>>) {
  const record = await f.t.run(({db}) => db.get(f.event.eventId));
  assert.ok(record?.communityProfileId);
  return record.communityProfileId;
}
it("Twitch registry isolates two destination owners and rechecks explicit community grants", async () => {
  const f = await setupFixture();
  const ownerAId = await twitchCommunity(f);
  const subjectB = newClerkUserId();
  const ownerBId = await f.t.run(async ({db}) => {
    const now=Date.now();
    const userId=await db.insert("users",{clerkUserId:subjectB,name:"B",email:"b@example.test",emailVerificationTime:now});
    const profileId=await db.insert("profiles",{slug:"club-b",displayName:"B",sortName:"b",aliases:[],tags:[],claimState:"claimed_verified",publicationState:"published",publicSurfacingState:"public",creationSource:"self",updatedAt:now,profileType:"community",community:{categoryTags:[]}});
    await db.insert("profileOwners",{profileId,userId,roleKey:"owner",state:"active",grantedAt:now,updatedAt:now});
    return profileId;
  });
  const ownerB=f.t.withIdentity({subject:subjectB,emailVerified:true,issuer:"test",tokenIdentifier:`test|${subjectB}`});
  const eventB=await ownerB.mutation(api.events.createCommunityEvent,{title:"B event",communitySlug:"club-b",startAt:Date.now()+600000,timezone:"UTC"});
  const a={key:"a",channel:"channel_a",credentialRef:"event-media/twitch/a",ownerCommunityProfileId:ownerAId};
  const b={key:"b",channel:"channel_b",credentialRef:"event-media/twitch/b",ownerCommunityProfileId:ownerBId};
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([a,b]);
  assert.deepEqual((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).twitchAccounts,[{key:"a",channel:"channel_a"}]);
  assert.deepEqual((await ownerB.query(api.events.getEventMediaControlStatus,{currentSlug:eventB.slug})).twitchAccounts,[{key:"b",channel:"channel_b"}]);
  const setup={currentSlug:f.event.slug,key:"twitch",label:"Twitch",channel:b.channel,...twitchConsent};
  await assert.rejects(f.owner.mutation(api.events.configureTwitchOutput,{...setup,outputAccountKey:"b"}));
  await assert.rejects(f.owner.mutation(api.events.configureTwitchOutput,{...setup,credentialRef:b.credentialRef}));
  await assert.rejects(ownerB.mutation(api.events.configureTwitchOutput,{...setup,currentSlug:eventB.slug,outputAccountKey:"a"}));
  await assert.rejects(ownerB.mutation(api.events.configureTwitchOutput,{...setup,currentSlug:eventB.slug,channel:a.channel,credentialRef:a.credentialRef}));
  await assert.rejects(f.owner.mutation(api.events.configureTwitchOutput,{...setup,outputAccountKey:"a",credentialRef:b.credentialRef}));
  await ownerB.mutation(api.events.configureTwitchOutput,{...setup,currentSlug:eventB.slug,outputAccountKey:"b"});
  await f.owner.mutation(api.events.configureTwitchOutput,{...setup,channel:a.channel,outputAccountKey:"a"});
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([a,{...b,authorizedCommunityProfileIds:[ownerAId]}]);
  assert.equal((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).twitchAccounts.length,2);
  await f.owner.mutation(api.events.configureTwitchOutput,{...setup,outputAccountKey:"b"});
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([a,b]);
  await assert.rejects(f.owner.mutation(api.events.configureTwitchOutput,{...setup,outputAccountKey:"b"}));
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:a.key,channel:a.channel,credentialRef:a.credentialRef}]);
  assert.deepEqual((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).twitchAccounts,[]);
  await assert.rejects(f.owner.mutation(api.events.configureTwitchOutput,{...setup,channel:a.channel,credentialRef:a.credentialRef}));
});

it("revoked optional Twitch binding disappears from existing ready output dispatch and refresh", async () => {
  const f=await setupFixture(), communityId=await twitchCommunity(f);
  const destinationOwner=await f.t.run(async({db})=>{
    const profile=await db.get(communityId); assert.ok(profile);
    const {_id,_creationTime,...fields}=profile;
    return db.insert("profiles",{...fields,slug:"destination-owner",displayName:"Destination owner"});
  });
  const account={key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:destinationOwner};
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{...account,authorizedCommunityProfileIds:[communityId]}]);
  const added=await f.owner.mutation(api.events.configureTwitchOutput,{currentSlug:f.event.slug,key:"twitch",label:"Twitch",channel:"example",outputAccountKey:"owned",simulcastEnabled:true,...twitchConsent});
  const {args}=await f.schedule();
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([account]);
  const dispatch=await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:"binding-bridge"});
  assert.ok(dispatch);
  assert.deepEqual(dispatch.optionalOutputs,[]);
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{...account,authorizedCommunityProfileIds:[communityId]}]);
  const lease=await f.t.mutation(worker("acquireSession"),args);
  assert.ok(lease.configuration.outputs.some((o:{id:string})=>o.id===added.outputId));
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([account]);
  const fresh=await f.t.mutation(worker("refreshConfiguration"),{...args,epoch:lease.epoch});
  assert.equal(fresh.granted,true);
  assert.equal(fresh.configuration.outputs.some((o:{id:string})=>o.id===added.outputId),false);
  assert.equal((await f.t.run(({db})=>db.get(added.outputId)))?.state,"ready");

  assert.equal((await f.t.mutation(worker("observeOutputs"),{...args,epoch:lease.epoch,destinations:[{outputId:added.outputId,destination:"twitch",status:"publishing",publishing:true,queueBytes:0,outputMs:1000,restarts:0}]})).accepted,false);
});

it("revoked selected Twitch binding denies dispatch acquisition renewal and refresh", async () => {
  const f=await setupFixture(), communityId=await twitchCommunity(f);
  const registry=[{key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:communityId}];
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify(registry);
  const added=await f.owner.mutation(api.events.configureTwitchOutput,{currentSlug:f.event.slug,key:"twitch",label:"Twitch",channel:"example",credentialRef:registry[0].credentialRef,...twitchConsent});
  const {args}=await f.schedule();
  await f.t.run(async({db})=>{await db.patch(args.sessionId,{outputId:added.outputId});await db.patch(f.output.programId,{currentOutputId:added.outputId});});
  const lease=await f.t.mutation(worker("acquireSession"),args);
  assert.equal(lease.granted,true);
  const claimed=await f.t.mutation(worker("claimCommands"),{...args,epoch:lease.epoch});
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON="[]";
  const command=claimed.commands[0];
  assert.ok(command);
  assert.equal((await f.t.mutation(worker("acknowledgeCommand"),{...args,epoch:lease.epoch,commandId:command._id,sequence:command.sequence,outcome:"succeeded",observedState:"hold"})).accepted,false);
  assert.equal((await f.t.mutation(worker("admitDispatch"),{bridgeToken,eventId:f.event.eventId,sessionId:args.sessionId,dispatchId:"revoked-destination"})).granted,false);
  assert.equal((await f.t.mutation(worker("acquireSession"),{...args,epoch:lease.epoch})).granted,false);
  assert.equal((await f.t.mutation(worker("renewSession"),{...args,epoch:lease.epoch})).granted,false);
  assert.equal((await f.t.mutation(worker("refreshConfiguration"),{...args,epoch:lease.epoch})).granted,false);
  assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:"revoked-bridge"}),null);
});

it("revoked selected ready destination cannot enter the bridge before acquisition but Stop still works", async () => {
  const f=await setupFixture(), communityId=await twitchCommunity(f);
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:communityId}]);
  const added=await f.owner.mutation(api.events.configureTwitchOutput,{currentSlug:f.event.slug,key:"twitch",label:"Twitch",channel:"example",outputAccountKey:"owned",...twitchConsent});
  const {args}=await f.schedule();
  await f.t.run(async({db})=>{await db.patch(args.sessionId,{outputId:added.outputId});await db.patch(f.output.programId,{currentOutputId:added.outputId});});
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON="[]";
  assert.equal((await f.t.mutation(worker("admitDispatch"),{bridgeToken,eventId:f.event.eventId,sessionId:args.sessionId,dispatchId:"pre-acquire-revoked"})).granted,false);
  assert.equal(await f.t.mutation(api.events.claimEventMediaWorkerCommand,{bridgeToken,workerId:"pre-acquire-bridge"}),null);
  assert.equal((await f.t.mutation(worker("acquireSession"),args)).granted,false);
  assert.equal((await f.t.run(({db})=>db.get(args.sessionId)))?.status,"error");
  assert.equal((await f.t.run(({db})=>db.get(f.output.programId)))?.activeSessionId,undefined);
});

it("actual program observations have a distinct timestamp that renewal cannot refresh or replacement inherit", async () => {
  const f=await observationFixture();
  const lease=await f.t.mutation(worker("acquireSession"),f.args), request={...f.args,epoch:lease.epoch};
  assert.equal((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).sessions[0].programObservedAt,undefined);
  const before=Date.now();
  await f.t.mutation(worker("observeProgram"),{...request,intentSequence:0,state:"hold",mode:"automatic",outputMs:500,publishing:true,outputId:f.output.outputId});
  const first=await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});
  assert.equal(first.sessions[0].broadcastMode,"automatic");
  const observedAt=first.sessions[0].programObservedAt;
  assert.ok(observedAt!==undefined && observedAt>=before && observedAt<=first.serverNow);
  await f.t.mutation(worker("renewSession"),request);
  await f.t.mutation(worker("observeOutputs"),{...request,destinations:[{outputId:f.output.outputId,destination:"vrcdn",status:"publishing",publishing:true,queueBytes:0,outputMs:1000,restarts:0}]});
  assert.equal((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).sessions[0].programObservedAt,observedAt);
  await f.t.run(({db})=>db.patch(f.args.sessionId,{leaseExpiresAt:Date.now()-1}));
  await f.t.mutation(worker("acquireSession"),{...f.args,workerId:"replacement",epoch:lease.epoch});
  const replaced=(await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).sessions[0];
  assert.equal(replaced.programObservedAt,undefined);
  assert.equal(replaced.outputHealthObservedAt,undefined);
});

it("actual optional grant revocation fences the controller before more program publication", async () => {
  const f=await setupFixture(), communityId=await twitchCommunity(f);
  process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON=JSON.stringify([{key:"owned",channel:"example",credentialRef:"event-media/twitch/owned",ownerCommunityProfileId:communityId}]);
  await f.owner.mutation(api.events.configureTwitchOutput,{currentSlug:f.event.slug,key:"twitch",label:"Twitch",channel:"example",outputAccountKey:"owned",simulcastEnabled:true,...twitchConsent});
  const {args}=await f.schedule();
  const {createEventWorker}=await import("../../workers/restream/event-worker.mjs");
  let fences=0;
  const controller=createEventWorker({identity:args,control:(method:string,request:Record<string,unknown>)=>f.t.mutation(worker(method),request),
    renderer:{start:async()=>{},stop:async()=>{},subscribe:()=>()=>{},reconcileSources:async()=>{},getInputs:()=>[],hold:()=>{},getState:()=>({running:true,outputMs:1000})},
    outputs:{start:async()=>{},stop:async()=>{},stopNow:()=>{fences++;},enqueue:()=>{},getState:()=>({publishing:true})},
    inputs: syntheticInputs(async()=>undefined), checkEnabled:async()=>true});
  try {
    await controller.start();
    assert.equal(fences,0);
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON="[]";
    await controller.tick();
    assert.equal(fences,1);
    assert.equal(controller.getState().stopped,true);
  } finally { await controller.stop(); }
});

it("only successful observed command acknowledgements stamp program media time", async () => {
  const f=await observationFixture();
  const lease=await f.t.mutation(worker("acquireSession"),f.args), request={...f.args,epoch:lease.epoch};
  const initial=await f.t.mutation(worker("claimCommands"),request);
  const first=initial.commands[0];
  await f.t.mutation(worker("acknowledgeCommand"),{...request,commandId:first._id,sequence:first.sequence,outcome:"failed"});
  assert.equal((await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug})).sessions[0].programObservedAt,undefined);
  await f.owner.mutation(api.events.queueEventMediaCommand,{ idempotencyKey:crypto.randomUUID(),currentSlug:f.event.slug,type:"hold_current"});
  const next=await f.t.mutation(worker("claimCommands"),request), command=next.commands[0], before=Date.now();
  const receipt={...request,commandId:command._id,sequence:command.sequence};
  await f.t.mutation(worker("beginPreparation"),receipt);await f.t.mutation(worker("promoteOperation"),{...receipt,target:command.controlTarget});
  assert.equal((await f.t.mutation(worker("acknowledgeCommand"),{...receipt,outcome:"succeeded",intentSequence:command.sequence,outputMs:100,observedOutputId:f.output.outputId,observedState:"hold"})).kind,"ok");
  const status=await f.owner.query(api.events.getEventMediaControlStatus,{currentSlug:f.event.slug});
  assert.ok(status.sessions[0].programObservedAt!==undefined && status.sessions[0].programObservedAt>=before && status.sessions[0].programObservedAt<=status.serverNow);
});

it("late terminal observation cannot clear a replacement session's active program", async () => {
  const f=await fixture();
  const lease=await f.t.mutation(worker("acquireSession"),f.args);
  await f.t.run(({db})=>db.patch(f.args.sessionId,{status:"ended"}));
  const replacement=await f.owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:f.event.slug});
  const late=await f.t.mutation(worker("observeProgram"),{...f.args,epoch:lease.epoch,state:"error",outputMs:0,publishing:false});
  assert.equal(late.accepted,false);
  assert.equal((await f.t.run(({db})=>db.get(f.output.programId)))?.activeSessionId,replacement.sessionId);
});

for (const evidence of ["coherent", "omitted", "failed"] as const)
  it(`ordinary Start ${evidence} evidence establishes only validated observed mode`, async () => {
    const f = await observationFixture();
    const lease = await f.t.mutation(worker("acquireSession"), f.args);
    const request = { ...f.args, epoch: lease.epoch };
    const claim = await f.t.mutation(worker("claimCommands"), request);
    const command = claim.commands[0];
    assert.equal(command.commandType, "start_program");
    assert.equal((await f.t.run(({db}) => db.get(f.args.sessionId)))?.broadcastMode, undefined);
    const ack = {
      ...request, commandId: command._id, sequence: command.sequence,
      outcome: evidence === "failed" ? "failed" : "succeeded",
      ...(evidence === "omitted" ? {} : {
        intentSequence: 0, outputMs: 100, observedState: "hold",
        observedOutputId: f.output.outputId,
      }),
    };
    assert.equal((await f.t.mutation(worker("acknowledgeCommand"), ack)).accepted, true);
    const after = await f.t.run(({db}) => db.get(f.args.sessionId));
    assert.equal(after?.broadcastMode, evidence === "coherent" ? "automatic" : undefined);
    if (evidence === "coherent") {
      assert.equal(after?.observedOutputMs, 100);
      await f.t.mutation(worker("observeProgram"), {
        ...request, intentSequence: 0, outputMs: 200, state: "fallback",
        publishing: true, outputId: f.output.outputId,
      });
      const newer = await f.t.run(({db}) => db.get(f.args.sessionId));
      assert.equal((await f.t.mutation(worker("acknowledgeCommand"), ack)).duplicate, true);
      assert.deepEqual(await f.t.run(({db}) => db.get(f.args.sessionId)), newer);
    } else {
      assert.equal(after?.programObservedAt, undefined);
    }
  });

it("ordinary Start cannot turn pending Cut intent into observed mode", async () => {
  const f = await observationFixture();
  const lease = await f.t.mutation(worker("acquireSession"), f.args);
  const request = { ...f.args, epoch: lease.epoch };
  const claim = await f.t.mutation(worker("claimCommands"), request);
  const start = claim.commands[0];
  await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug, type: "switch_hold", idempotencyKey: "cut",
  });
  const before = await f.t.run(({db}) => db.get(f.args.sessionId));
  assert.deepEqual(await f.t.mutation(worker("acknowledgeCommand"), {
    ...request, commandId: start._id, sequence: start.sequence, outcome: "succeeded",
    intentSequence: before?.intentSequence, outputMs: 100,
    observedState: "hold", observedOutputId: f.output.outputId,
  }), { kind: "superseded" });
  assert.deepEqual(await f.t.run(({db}) => db.get(f.args.sessionId)), before);
});

it("legacy observations retain supplied mode without protocol 2 intent", async () => {
  const f = await observationFixture();
  await f.t.run(({ db }) => db.patch(f.args.sessionId, {
    controlProtocolVersion: undefined, committedIntent: undefined, intentSequence: undefined,
  }));
  const lease = await f.t.mutation(worker("acquireSession"), f.args);
  assert.equal((await f.t.mutation(worker("observeProgram"), {
    ...f.args, epoch: lease.epoch, state: "hold", mode: "hold", outputMs: 100,
    publishing: true, outputId: f.output.outputId,
  })).accepted, true);
  assert.equal((await f.t.run(({db}) => db.get(f.args.sessionId)))?.broadcastMode, "hold");
});

it("terminal protocol 2 observation preserves the last observed policy mode", async () => {
  const f = await observationFixture();
  const lease = await f.t.mutation(worker("acquireSession"), f.args);
  const request = { ...f.args, epoch: lease.epoch, outputId: f.output.outputId };
  await f.t.mutation(worker("observeProgram"), {
    ...request, intentSequence: 0, state: "hold", outputMs: 100, publishing: true,
  });
  assert.equal((await f.t.mutation(worker("observeProgram"), {
    ...request, state: "ended", outputMs: 100, publishing: false,
  })).accepted, true);
  const ended = await f.t.run(({db}) => db.get(f.args.sessionId));
  assert.equal(ended?.status, "ended");
  assert.equal(ended?.broadcastMode, "automatic");
});
