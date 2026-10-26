import { loadFixtureEvents } from "../fixtures/event-modules";
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const worker = (name: string) => makeFunctionReference<"mutation">(`eventMediaWorker:${name}`);
const settingsMutation = makeFunctionReference<"mutation">("eventMediaSettings:configure");
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": loadFixtureEvents,
  "../../convex/eventMediaWorker.ts": () => import("../../convex/eventMediaWorker"),
  "../../convex/eventMediaSettings.ts": () => import("../../convex/eventMediaSettings"),
  "../../convex/eventMediaSources.ts": () => import("../../convex/eventMediaSources"),
};
const bridgeToken = "settings-test-credential";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;
async function setupFixture(eventsLoader = loadFixtureEvents) {
  const t = convexTest({ schema, modules: { ...modules, "../../convex/events.ts": eventsLoader } });
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

test("six video profiles and destination audio/GOP resolve from validated settings", async () => {
  const { VIDEO_PROFILES, parseMediaSettings, resolveDestinationProfile } = await import("../../workers/restream/broadcast-profiles.mjs");
  assert.equal(VIDEO_PROFILES["480p60"].height, 480);
  assert.equal(VIDEO_PROFILES["480p60"].frameRate, 60);
  assert.equal(VIDEO_PROFILES["480p60"].videoBitrateKbps, 1500);
  assert.equal(VIDEO_PROFILES["480p30"].videoBitrateKbps, 1000);
  for (const [id, width, height, fps] of [["480p30",854,480,30],["480p60",854,480,60],["720p30",1280,720,30],["720p60",1280,720,60],["1080p30",1920,1080,30],["1080p60",1920,1080,60]] as const) {
    assert.deepEqual([VIDEO_PROFILES[id].width, VIDEO_PROFILES[id].height, VIDEO_PROFILES[id].frameRate], [width,height,fps]);
  }
  assert.deepEqual(parseMediaSettings(undefined), {videoPreset:"720p30",audioBitrateKbps:160});
  for (const value of [{videoPreset:"bogus",audioBitrateKbps:160},{videoPreset:"720p30",audioBitrateKbps:192},null,{}]) assert.throws(() => parseMediaSettings(value));
  const settings = {videoPreset:"1080p60",audioBitrateKbps:320};
  for (const destination of ["vrcdn", "twitch"] as const) {
    const profile = resolveDestinationProfile({settings,destination});
    assert.deepEqual([profile.width,profile.height,profile.frameRate,profile.audioBitrateKbps,profile.keyframeIntervalSeconds], [1920,1080,60,destination==="vrcdn"?320:160,destination==="vrcdn"?1:2]);
    assert.equal(profile.audioChannels,2); assert.equal(profile.audioSampleRateHz,48000);
  }
});

test("settings require media authority, preserve active snapshots, and apply at the next start", async () => {
  const {t,owner,event,output,schedule} = await setupFixture();
  const initial = await t.run(ctx => ctx.db.get(output.programId));
  assert.deepEqual(initial!.mediaSettings,{videoPreset:"720p30",audioBitrateKbps:320});
  const args = {currentSlug:event.slug,videoPreset:"1080p60",audioBitrateKbps:320};
  await assert.rejects(t.mutation(settingsMutation,args), /authenticat|signed/i);
  await owner.mutation(settingsMutation,args);
  const {scheduled,args:workerArgs} = await schedule();
  const lease = await t.mutation(worker("acquireSession"),workerArgs);
  const original = await t.run(ctx => ctx.db.get(scheduled.sessionId));
  assert.equal(original!.controlProtocolVersion,2);
  assert.deepEqual(original!.allocation, {cpuUnits:4096,memoryMiB:8192,evidenceId:"unit-test-synthetic-capacity-v1"});
  assert.deepEqual(lease.configuration.allocation, original!.allocation);
  assert.deepEqual(original!.mediaSettings,{videoPreset:"1080p60",audioBitrateKbps:320});
  assert.equal(original!.destinationProfiles![0]!.profile.frameRate,60);
  await owner.mutation(settingsMutation,{...args,videoPreset:"480p30",audioBitrateKbps:160});
  assert.deepEqual((await t.run(ctx => ctx.db.get(scheduled.sessionId)))!.mediaSettings,original!.mediaSettings);
  const refreshed = await t.mutation(worker("refreshConfiguration"),{...workerArgs,epoch:lease.epoch});
  assert.deepEqual(refreshed.configuration.mediaSettings,original!.mediaSettings);
  assert.deepEqual(refreshed.configuration.allocation,original!.allocation);
  assert.deepEqual(refreshed.configuration.destinationProfiles,original!.destinationProfiles);
  assert.deepEqual(refreshed.configuration.outputs[0].profile,original!.destinationProfiles![0]!.profile);
  const status = await owner.query(api.events.getEventMediaControlStatus,{currentSlug:event.slug});
  assert.deepEqual(status!.program!.mediaSettings,{videoPreset:"480p30",audioBitrateKbps:160});
  await t.run(async ctx => {await ctx.db.patch(scheduled.sessionId,{status:"ended",workerTaskStatus:"stopped",dispatchStopConfirmedAt:Date.now()}); await ctx.db.patch(output.programId,{state:"ended",activeSessionId:undefined});});
  const next = await schedule();
  assert.deepEqual((await t.run(ctx => ctx.db.get(next.scheduled.sessionId)))!.mediaSettings,{videoPreset:"480p30",audioBitrateKbps:160});
});

test("missing stored legacy settings stay 160 and source-only program creation defaults to 320", async () => {
  const {t,owner,event,output,schedule} = await setupFixture();
  await t.run(ctx => ctx.db.patch(output.programId,{mediaSettings:undefined}));
  const {scheduled} = await schedule();
  assert.deepEqual((await t.run(ctx => ctx.db.get(scheduled.sessionId)))!.mediaSettings,{videoPreset:"720p30",audioBitrateKbps:160});
  const other = await owner.mutation(api.events.createCommunityEvent,{title:"Source only",communitySlug:"club",startAt:Date.now()+600000,timezone:"UTC"});
  await owner.mutation(makeFunctionReference<"mutation">("eventMediaSources:create"),{currentSlug:other.slug,label:"DJ",url:"vrcdn:alpha"});
  const program = await t.run(ctx => ctx.db.query("eventMediaPrograms").withIndex("by_eventId",q=>q.eq("eventId",other.eventId)).unique());
  assert.deepEqual(program!.mediaSettings,{videoPreset:"720p30",audioBitrateKbps:320});
});
test('destination snapshots keep simulcast membership and formats when next-start settings change', async () => {
  const {t,owner,event,output,schedule} = await setupFixture();
  await t.run(async ctx => {
    const program = (await ctx.db.get(output.programId))!;
    process.env.VRDEX_TWITCH_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{key:'twitch',channel:'example',credentialRef:'event-media/twitch/main',ownerCommunityProfileId:program.communityProfileId}]);
  });
  const twitch = await owner.mutation(api.events.configureTwitchOutput,{currentSlug:event.slug,key:'twitch',label:'Twitch',channel:'example',credentialRef:'event-media/twitch/main',simulcastEnabled:true,sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true});
  await owner.mutation(settingsMutation,{currentSlug:event.slug,videoPreset:'1080p60',audioBitrateKbps:320});
  const {scheduled,args} = await schedule();
  const lease = await t.mutation(worker('acquireSession'),args);
  const stored = (await t.run(ctx => ctx.db.get(scheduled.sessionId)))!;
  assert.deepEqual(stored.destinationProfiles!.map(d => [d.destination,d.profile.frameRate,d.profile.audioBitrateKbps,d.profile.keyframeIntervalSeconds]).sort(), [['twitch',60,160,2],['vrcdn',60,320,1]]);
  await t.run(ctx => ctx.db.patch(twitch.outputId,{simulcastEnabled:false}));
  const refreshed = await t.mutation(worker('refreshConfiguration'),{...args,epoch:lease.epoch});
  assert.equal(refreshed.configuration.outputs.find((o: {id:string})=>o.id===twitch.outputId).simulcastEnabled,true);
  assert.deepEqual(refreshed.configuration.allocation,stored.allocation);
  const health = await t.mutation(worker('observeOutputs'),{...args,epoch:lease.epoch,destinations:stored.destinationProfiles!.map(d=>({outputId:d.outputId,destination:d.destination,status:'publishing',publishing:true,queueBytes:0,outputMs:1000,restarts:0}))});
  assert.equal(health.accepted,true);
});
test('scheduled sessions retain settings and cannot be rebound to another destination', async () => {
  const {t,owner,event,output,schedule} = await setupFixture();
  await owner.mutation(api.events.configureVrcdnOutput,{currentSlug:event.slug,key:'other',label:'Other',credentialRef:'event-media/vrcdn/main',sourceConsentAccepted:true,destinationAuthorityAccepted:true,providerRulesAccepted:true,rightsClearedMediaAccepted:true});
  await t.run(ctx=>ctx.db.patch(output.programId,{currentOutputId:output.outputId}));
  const first = await schedule();
  await owner.mutation(settingsMutation,{currentSlug:event.slug,videoPreset:'480p60',audioBitrateKbps:160});
  const repeated = await schedule();
  assert.equal(repeated.scheduled.sessionId,first.scheduled.sessionId);
  assert.deepEqual((await t.run(ctx=>ctx.db.get(first.scheduled.sessionId)))!.mediaSettings,{videoPreset:'720p30',audioBitrateKbps:320});
  await assert.rejects(owner.mutation(api.events.scheduleEventMediaWorker,{currentSlug:event.slug,outputKey:'other'}),/session.*destination|destination.*session/i);
});

test('configure rejects unknown presets and unsupported audio without modifying settings', async () => {
  const {t,owner,event,output} = await setupFixture();
  for (const values of [{videoPreset:'bogus',audioBitrateKbps:160},{videoPreset:'720p30',audioBitrateKbps:192}]) await assert.rejects(owner.mutation(settingsMutation,{currentSlug:event.slug,...values}),/validator/i);
  assert.deepEqual((await t.run(ctx=>ctx.db.get(output.programId)))!.mediaSettings,{videoPreset:'720p30',audioBitrateKbps:320});
});


test("synthetic scheduling does not open the production capacity registry", async () => {
  const synthetic = await setupFixture();
  const { scheduled } = await synthetic.schedule();
  const stored = await synthetic.t.run(ctx => ctx.db.get(scheduled.sessionId));
  assert.deepEqual(stored!.allocation, {
    cpuUnits: 4096, memoryMiB: 8192, evidenceId: "unit-test-synthetic-capacity-v1",
  });
  const production = await setupFixture(() => import("../../convex/events"));
  const snapshot = () => production.t.run(async ({ db }) => ({
    sessions: await db.query("eventMediaSessions").collect(),
    commands: await db.query("eventMediaCommands").collect(),
    program: await db.get(production.output.programId),
  }));
  const before = await snapshot();
  await assert.rejects(production.schedule(), /Unproved broadcast configuration/);
  assert.deepEqual(await snapshot(), before);
  const { resolveWorkerAllocation } = await import("../../workers/restream/broadcast-capacity.mjs");
  assert.throws(() => resolveWorkerAllocation({ videoPreset: "720p30", simulcastEnabled: false }), /Unproved broadcast configuration/);
});

test("synthetic scheduling still rejects a forged frozen allocation", async () => {
  const { t, schedule } = await setupFixture();
  const { scheduled } = await schedule();
  await t.run(async ({ db }) => {
    const session = await db.get(scheduled.sessionId);
    assert.ok(session?.allocation);
    await db.patch(scheduled.sessionId, { allocation: { ...session.allocation, evidenceId: "forged-synthetic-capacity-v1" } });
  });
  await assert.rejects(schedule(), /Unproved allocation snapshot/);
});
