import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import type { Doc } from "../../convex/_generated/dataModel";
const schema = (schemaModule as unknown as {default?: typeof schemaModule}).default ?? schemaModule;
const modules = { "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"), "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"), "../../convex/groupObservations.ts": () => import("../../convex/groupObservations"), "../../convex/groupMemberSnapshots.ts": () => import("../../convex/groupMemberSnapshots") };
async function fixture() {
 const t = convexTest({schema, modules});
 const row = await t.run(async ctx => {
  const accountId = await ctx.db.insert("collectorAccounts", {vrchatUserId:"usr_test",accountAlias:"test",state:"ready",capacity:100,reservedHeadroom:10,assignedGroupCount:0,requestsPerMinute:10,secretRef:"test",workerKeyHash:"test",credentialGeneration:1,killSwitchEnabled:false,createdAt:1,updatedAt:1});
  const id = await ctx.db.insert("communityVrchatIntegrations", {collectionScope:{kind:"automatic"},vrchatGroupId:"grp_test",groupVisibility:"public",joinPolicy:"request",state:"connecting",assignedCollectorAccountId:accountId,killSwitchEnabled:false,requestsPerMinute:4,leaseGeneration:1,publicMetrics:{currentPopulation:true,populationHistory:false,groupMemberCount:true,groupMemberGrowth:false,eventRecaps:false},namedMembershipCollectionEnabled:false,publicationPolicy:"automatic_aggregate",enabledFeatures:["analytics"],telemetryEpochStartedAt:100,consecutiveFailures:0,createdAt:1,updatedAt:1});
  return (await ctx.db.get(id))!;
 });
 return {t,row};
}
it("legacy integrations do not acquire explicit authority", async () => {
 assert.ok("statisticsAdmission" in schema.tables.communityVrchatIntegrations.validator.fields);
 const {row} = await fixture();
 assert.equal(row.statisticsAdmission, undefined);
 const {admissionMatches} = await import("../../convex/_groupAdmission");
 assert.equal(admissionMatches(row, 200, row.assignedCollectorAccountId!), false);
});

const GROUP = "grp_00000000-0000-4000-8000-000000000005";
const command = (name: string) => makeFunctionReference<"mutation">(`groupObservations:${name}`);
const preview = makeFunctionReference<"query">("groupObservations:getStatisticsAdmission");
it("super-admin refresh queues stale admission metadata without bypassing retries or leases", async () => {
  const h = await adminFixture();
  const refresh = command("refreshStatisticsMetadata");
  await assert.rejects(h.t.mutation(refresh, { profileId: h.profileId }));
  for (const guard of ["fresh", "retry", "lease", "queued", "stale"] as const) {
    await h.t.run(ctx => ctx.db.patch(h.destinationId, {
      observedAt: guard === "fresh" ? h.now : h.now - 360_001,
      retryEligibleAt: guard === "retry" ? h.now + 60_000 : undefined,
      leaseExpiresAt: guard === "lease" ? h.now + 60_000 : undefined,
      workDueAt: guard === "queued" ? h.now + 60_000 : undefined,
    }));
    const before = await h.t.run(ctx => ctx.db.get(h.destinationId));
    await h.admin.mutation(refresh, { profileId: h.profileId });
    const after = await h.t.run(ctx => ctx.db.get(h.destinationId));
    if (guard === "stale") assert.ok(after?.workDueAt !== undefined && after.workDueAt <= Date.now());
    else assert.deepEqual(after, before);
  }
  await h.t.run(ctx => ctx.db.patch(h.profileId, { publicSurfacingState: "suppressed" }));
  await assert.rejects(h.admin.mutation(refresh, { profileId: h.profileId }));
});

for (const unsafe of [undefined, "attempt", "observation", "grant"] as const) {
  it(`admission reuses only safely blocked automatic candidates (${unsafe ?? "safe"})`, async () => {
    const h = await adminFixture();
    const integrationId = await h.t.run(async ctx => {
      const { _id, _creationTime, ...fields } = (await fixture()).row;
      const id = await ctx.db.insert("communityVrchatIntegrations", { ...fields, vrchatGroupId: GROUP, assignedCollectorAccountId: h.accountId });
      await ctx.db.patch(h.accountId, { assignedGroupCount: 1 });
      await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: GROUP, integrationId: id, eligibleProfileId: h.profileId, decision: { kind: "enabled", at: h.now }, createdAt: h.now, updatedAt: h.now });
      return id;
    });
    assert.equal(await h.t.mutation(command("recordAdmissionRequired"), { integrationId, reason: "request" }), true);
    await h.t.run(ctx => ctx.db.patch(integrationId, {
      ...(unsafe === "attempt" ? { automaticAdmissionAttempt: { collectorAccountId: h.accountId, attemptedAt: h.now } } : {}),
      ...(unsafe === "observation" ? { lastSuccessfulObservationAt: h.now } : {}),
      ...(unsafe === "grant" ? { statisticsAdmission: { authorizedAt: h.now, actor: { subject: "admin", issuer: "test", tokenIdentifier: "test|admin" }, reason: "old", collectorAccountId: h.accountId, joinPolicy: "request", epochStartedAt: h.now, phase: "ended", membershipOrigin: "unknown" } } : {}),
    }));
    if (unsafe) await assert.rejects(h.admit(), /cleanup_required/);
    else {
      assert.equal((await h.admin.query(preview, { profileId: h.profileId }))?.eligible, true);
      assert.equal((await h.admit()).integrationId, integrationId);
      assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
    }
  });
}
async function adminFixture() {
 const {t,row} = await fixture(); const now = Date.now();
 const ids = await t.run(async ctx => {
  const userId = await ctx.db.insert("users", {clerkUserId:"admin",email:"admin@example.test"});
  const grantId = await ctx.db.insert("accountFeatureGrants", {userId,feature:"super_admin",state:"active",grantedBy:{tokenIdentifier:"test|admin",issuer:"test",subject:"admin"},grantedAt:now,updatedAt:now});
  const key = `vrchat_group:${GROUP}`; const url = `https://vrchat.com/home/group/${GROUP}`;
  const profileId = await ctx.db.insert("profiles", {slug:"admission",displayName:"Admission",sortName:"admission",aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"self",updatedAt:now,profileType:"community",community:{categoryTags:[]},primaryGroupReference:{key,url,contributorUserId:userId},outboundLinks:[{type:"vrchat_profile",url,label:"Group",source:"community_submitted"}]});
  await ctx.db.insert("profileOwners", {profileId,userId,roleKey:"owner",state:"active",grantedAt:now,updatedAt:now});
  await ctx.db.insert("profileExternalLinks", {profileId,assetType:"vrchat_group",assetExternalId:GROUP,linkRole:"primary",state:"active",provenance:"directory_reference",createdAt:now,updatedAt:now});
  await ctx.db.insert("profileLinkDestinationReferences", {key,profileId});
  const destinationId = await ctx.db.insert("profileLinkDestinations", {key,kind:"vrchat_group",locator:GROUP,provider:"vrchat",status:"resolved",entityId:GROUP,name:"Admission group",observedAt:now,groupMetadata:{visibility:"public",joinPolicy:"request"}});
  const fleetId = await ctx.db.insert("collectorFleetSettings", {key:"global",killSwitchEnabled:false,globalRequestsPerMinute:30,automaticEnrollmentEnabled:false,automaticEnrollmentLimit:50,updatedAt:now});
  await ctx.db.delete(row._id);
  return {userId,grantId,profileId,destinationId,fleetId};
 });
 const admin = t.withIdentity({subject:"admin",issuer:"test",tokenIdentifier:"test|admin",email:"admin@example.test",emailVerified:true});
 const args = {profileId:ids.profileId,expectedVrchatGroupId:GROUP,expectedCollectorAccountId:row.assignedCollectorAccountId!,expectedMetadataObservedAt:now,reason:" Public statistics "};
 return {t,admin,now,...ids,accountId:row.assignedCollectorAccountId!,args,admit:()=>admin.mutation(command("admitStatistics"),args)};
}
for (const trigger of ["stop", "orphan"] as const) {
  it(`${trigger} revokes and fences explicit membership before provenance cleanup`, async () => {
    const h = await adminFixture();
    const result = await h.admit();
    await h.t.run(async ctx => {
      const row = await ctx.db.get(result.integrationId);
      assert.ok(row?.statisticsAdmission);
      await ctx.db.patch(row._id, {
        statisticsAdmission: { ...row.statisticsAdmission, membershipOrigin: "admission",
          operation: { kind: "request", startedAt: h.now, outcome: "uncertain" } },
      });
    });
    if (trigger === "stop") {
      await h.admin.mutation(command("setObservationDecision"), { vrchatGroupId: GROUP, decision: "stop" });
    } else {
      await h.t.run(ctx => ctx.db.patch(h.profileId, { publicSurfacingState: "suppressed" }));
      await h.t.mutation(command("reconcileRegisteredGroup"), { vrchatGroupId: GROUP });
    }
    const row = await h.t.run(ctx => ctx.db.get(result.integrationId));
    assert.ok(row?.statisticsAdmission);
    assert.equal(row.statisticsAdmission.phase, "cleanup_pending");
    assert.ok(row.statisticsAdmission.revokedAt !== undefined);
    assert.ok(row.leaseGeneration > 0);
    assert.equal(row.state, "disconnecting");
    assert.equal(row.statisticsAdmission.operation?.outcome, "uncertain");
    assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
    if (trigger === "stop") {
      await h.admin.mutation(command("setObservationDecision"), { vrchatGroupId: GROUP, decision: "resume" });
      assert.equal((await h.t.run(ctx => ctx.db.get(result.integrationId)))?.state, "disconnecting");
    }
  });
}

it("two admissions from the same preview reserve a single slot and attempt", async () => {
  const h = await adminFixture();
  await h.t.run(ctx => ctx.db.patch(h.fleetId, { automaticEnrollmentLimit: 1 }));
  const [first, second] = await Promise.all([h.admit(), h.admit()]);
  assert.deepEqual(first, second);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
  const events = await h.t.run(ctx => ctx.db.query("communityTelemetryAuditEvents").collect());
  assert.equal(events.filter(event => event.action === "statistics_admission.authorize").length, 1);
});

it("automatic queue reconciliation cannot reassign a terminal manual admission", async () => {
  const h = await adminFixture();
  const result = await h.admit();
  await h.t.run(async ctx => {
    const row = await ctx.db.get(result.integrationId);
    assert.ok(row?.statisticsAdmission);
    await ctx.db.patch(row._id, { state: "disconnected", assignedCollectorAccountId: undefined,
      statisticsAdmission: { ...row.statisticsAdmission, phase: "cancelled", revokedAt: h.now } });
    await ctx.db.patch(h.accountId, { assignedGroupCount: 0 });
    await ctx.db.patch(h.fleetId, { automaticEnrollmentEnabled: true, automaticEnrollmentScope: { kind: "all_eligible" } });
    const policy = await ctx.db.query("vrchatGroupObservationPolicies").unique();
    assert.ok(policy);
    await ctx.db.patch(policy._id, { queuedAdmission: { priority: "automatic", queuedAt: h.now, dueAt: h.now } });
  });
  const before = await h.t.run(ctx => ctx.db.get(result.integrationId));
  assert.equal((await h.t.mutation(command("admitQueued"), {})).admitted, 0);
  await h.t.mutation(command("reconcileRegisteredGroup"), { vrchatGroupId: GROUP });
  assert.deepEqual(await h.t.run(ctx => ctx.db.get(result.integrationId)), before);
});
it("admission is super-admin only, including a claimed community owner", async () => {
 const h = await adminFixture();
 assert.equal(await h.t.query(preview,{profileId:h.profileId}),null);
 await h.t.run(ctx=>ctx.db.patch(h.profileId,{claimState:"claimed_verified"}));
 await h.t.run(ctx=>ctx.db.patch(h.grantId,{state:"revoked"}));
 assert.equal(await h.admin.query(preview,{profileId:h.profileId}),null);
 await assert.rejects(h.admit(),/super.admin/i);
 const {row} = await fixture();
 for(const name of ["cancelStatisticsAdmission","checkStatisticsAdmission"]) await assert.rejects(h.admin.mutation(command(name),{integrationId:row._id,admissionAt:1}),/super.admin/i);
});
for(const invalid of ["private","stale","unresolved","unknown","nonprimary","capacity","zero","missing","stopped","conflict","fleet_stop","account_stop","cooldown","headroom","managed_priority","invalid_limit","wrong_group","wrong_time"] as const) it(`admission rejects ${invalid} without partial writes`,async()=>{
 const h=await adminFixture();
 await h.t.run(async ctx=>{
  if(invalid==="private") await ctx.db.patch(h.destinationId,{groupMetadata:{visibility:"private",joinPolicy:"request"}});
  if(invalid==="unknown") await ctx.db.patch(h.destinationId,{groupMetadata:undefined});
  if(invalid==="stale") await ctx.db.patch(h.destinationId,{observedAt:h.now-360001});
  if(invalid==="unresolved") await ctx.db.patch(h.destinationId,{status:"pending"});
  if(invalid==="nonprimary") await ctx.db.patch(h.profileId,{primaryGroupReference:undefined});
  if(invalid==="capacity") await ctx.db.patch(h.accountId,{assignedGroupCount:90});
  if(invalid==="zero") await ctx.db.patch(h.fleetId,{automaticEnrollmentLimit:0});
  if(invalid==="missing") await ctx.db.delete(h.fleetId);
  if(invalid==="fleet_stop") await ctx.db.patch(h.fleetId,{killSwitchEnabled:true});
  if(invalid==="account_stop") await ctx.db.patch(h.accountId,{killSwitchEnabled:true});
  if(invalid==="cooldown") await ctx.db.patch(h.accountId,{cooldownUntil:h.now+60000});
  if(invalid==="headroom") await ctx.db.patch(h.accountId,{reservedHeadroom:100});
  if(invalid==="invalid_limit") await ctx.db.patch(h.fleetId,{automaticEnrollmentLimit:51});
  if(invalid==="wrong_group") h.args.expectedVrchatGroupId="grp_wrong";
  if(invalid==="wrong_time") h.args.expectedMetadataObservedAt++;
  if(invalid==="managed_priority") await ctx.db.insert("vrchatGroupObservationPolicies",{vrchatGroupId:"grp_managed",decision:{kind:"enabled",at:h.now},queuedAdmission:{priority:"managed",queuedAt:h.now,dueAt:h.now},createdAt:h.now,updatedAt:h.now});
  if(invalid==="stopped") await ctx.db.insert("vrchatGroupObservationPolicies",{vrchatGroupId:GROUP,decision:{kind:"stopped",actor:"verified_operator",reason:"opt out",at:h.now},createdAt:h.now,updatedAt:h.now});
  if(invalid==="conflict") {const {row}=await fixture(); const {_id,_creationTime,...fields}=row; await ctx.db.insert("communityVrchatIntegrations",{...fields,vrchatGroupId:GROUP});}
 });
 await assert.rejects(h.admit(),/refresh/i);
 assert.equal(await h.t.run(ctx=>ctx.db.query("communityTelemetryAuditEvents").collect()).then(rows=>rows.length),0);
 assert.equal(await h.t.run(ctx=>ctx.db.query("communityVrchatIntegrations").collect()).then(rows=>rows.filter(row=>row.statisticsAdmission).length),0);
});
it("invite admission only authorizes the exact invitation branch",async()=>{
 const h=await adminFixture(); await h.t.run(ctx=>ctx.db.patch(h.destinationId,{groupMetadata:{visibility:"public",joinPolicy:"invite"}}));
 const result=await h.admit(); const row=(await h.t.run(ctx=>ctx.db.get(result.integrationId)))!;
 assert.equal(row.statisticsAdmission?.joinPolicy,"invite"); assert.equal(row.statisticsAdmission?.operation,undefined);
 assert.equal(row.statisticsAdmission?.membershipOrigin,"unknown");
});
it("confirmation reserves once and is idempotent with free-join enrollment disabled",async()=>{
 const h=await adminFixture(); const view=await h.admin.query(preview,{profileId:h.profileId});
 assert.equal(view.eligible,true); assert.equal(view.bot.collectorAccountId,h.accountId); assert.equal(view.bot.secretRef,undefined);
 const result=await h.admit(); assert.deepEqual(await h.admit(),result);
 const row=await h.t.run(ctx=>ctx.db.get(result.integrationId)); assert.equal(row?.statisticsAdmission?.reason,"Public statistics");
 assert.equal(row?.collectionScope?.kind,"automatic"); assert.equal(row?.namedMembershipCollectionEnabled,false);
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.accountId)))?.assignedGroupCount,1);
 assert.equal((await h.t.run(ctx=>ctx.db.query("communityTelemetryAuditEvents").collect())).length,1);
});
it("concurrent confirmations with different accounts reserve a single canonical grant",async()=>{
 const h=await adminFixture(); const second=await h.t.run(async ctx=>{const a=(await ctx.db.get(h.accountId))!; const {_id,_creationTime,...fields}=a; return ctx.db.insert("collectorAccounts",{...fields,accountAlias:"second",vrchatUserId:"usr_second"});});
 const results=await Promise.allSettled([h.admit(),h.admin.mutation(command("admitStatistics"),{...h.args,expectedCollectorAccountId:second})]);
 const granted=results.filter(result=>result.status==="fulfilled"); assert.equal(granted.length,1);
 const totalReserved=await h.t.run(async ctx=>(await ctx.db.query("collectorAccounts").collect()).reduce((sum,a)=>sum+a.assignedGroupCount,0)); assert.equal(totalReserved,1);
});
it("cancel fences leases, holds capacity, hides history and permits retry only after safe cleanup",async()=>{
 const h=await adminFixture(); const result=await h.admit();
 await h.t.run(async ctx=>{await ctx.db.insert("collectorAccountLeases",{integrationId:result.integrationId,collectorAccountId:h.accountId,workerId:"worker",fencingToken:0,state:"active",claimedAt:h.now,expiresAt:h.now+60000,updatedAt:h.now}); await ctx.db.patch(result.integrationId,{state:"active"});});
 await h.admin.mutation(command("cancelStatisticsAdmission"),result);
 const cancelled=(await h.t.run(ctx=>ctx.db.get(result.integrationId)))!;
 assert.equal(cancelled.statisticsAdmission?.phase,"cleanup_pending"); assert.equal(cancelled.leaseGeneration,1);
 assert.equal((await h.t.run(ctx=>ctx.db.query("collectorAccountLeases").first()))?.state,"released");
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.accountId)))?.assignedGroupCount,1);
 const {resolveGroupObservationPolicy}=await import("../../convex/_groupObservationPolicy");
 assert.equal((await h.t.run(ctx=>resolveGroupObservationPolicy(ctx.db,{vrchatGroupId:GROUP,profileId:h.profileId,now:h.now}))).kind,"hidden");
 await h.admin.mutation(command("cancelStatisticsAdmission"),result);
 await assert.rejects(h.admit(),/refresh/i);
 await h.t.run(async ctx=>{await ctx.db.patch(result.integrationId,{state:"disconnected",assignedCollectorAccountId:undefined,statisticsAdmission:{...cancelled.statisticsAdmission!,phase:"cancelled"}}); await ctx.db.patch(h.accountId,{assignedGroupCount:0});});
 const next=await h.admit(); assert.ok(next.admissionAt>result.admissionAt);
 const current=(await h.t.run(ctx=>ctx.db.get(next.integrationId)))!; assert.ok(current.telemetryEpochStartedAt!>cancelled.telemetryEpochStartedAt!);
 await h.admin.mutation(command("cancelStatisticsAdmission"),result);
 assert.equal((await h.t.run(ctx=>ctx.db.get(next.integrationId)))?.statisticsAdmission?.revokedAt,undefined);
 assert.equal((await h.t.run(ctx=>ctx.db.query("communityTelemetryAuditEvents").collect())).length,3);
});
it("check status respects cooldown, backoff and uncertain operations",async()=>{
 const h=await adminFixture(); const result=await h.admit(); const due=h.now+600000;
 await h.t.run(async ctx=>{const row=(await ctx.db.get(result.integrationId))!; await ctx.db.patch(h.accountId,{cooldownUntil:due}); await ctx.db.patch(row._id,{backoffUntil:due+1000,statisticsAdmission:{...row.statisticsAdmission!,membershipOrigin:"admission",operation:{kind:"request",startedAt:h.now,outcome:"uncertain"}}});});
 for(let i=0;i<2;i++) await h.admin.mutation(command("checkStatisticsAdmission"),result);
 const row=(await h.t.run(ctx=>ctx.db.get(result.integrationId)))!; assert.equal(row.nextPollAt,due+1000); assert.equal(row.statisticsAdmission?.operation?.outcome,"uncertain");
});
for(const phase of ["pending","cleanup_pending"] as const) it(`${phase} reservations consume the configured ceiling indefinitely`,async()=>{
 const h=await adminFixture(); const result=await h.admit();
 await h.t.run(async ctx=>{
  await ctx.db.patch(h.fleetId,{automaticEnrollmentLimit:1});
  const row=(await ctx.db.get(result.integrationId))!;
  await ctx.db.patch(row._id,{vrchatGroupId:"grp_other",statisticsAdmission:{...row.statisticsAdmission!,phase,revokedAt:phase==="cleanup_pending" ? h.now : undefined,authorizedAt:1}});
  const policy=(await ctx.db.query("vrchatGroupObservationPolicies").first())!; await ctx.db.delete(policy._id);
 });
 await assert.rejects(h.admit(),/automatic_limit/);
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.accountId)))?.assignedGroupCount,1);
});
it("retry rejects uncertain cleanup even if a terminal phase was recorded",async()=>{
 const h=await adminFixture(); const result=await h.admit();
 await h.t.run(async ctx=>{const row=(await ctx.db.get(result.integrationId))!; await ctx.db.patch(row._id,{state:"disconnected",assignedCollectorAccountId:undefined,statisticsAdmission:{...row.statisticsAdmission!,phase:"cancelled",revokedAt:h.now,operation:{kind:"request",startedAt:h.now,outcome:"uncertain"}}}); await ctx.db.patch(h.accountId,{assignedGroupCount:0});});
 await assert.rejects(h.admit(),/cleanup_required/);
});
it("check status cannot advance the most recently claimed inspection",async()=>{
 const h=await adminFixture(); const result=await h.admit();
 await h.t.run(ctx=>ctx.db.patch(result.integrationId,{lastClaimedAt:Date.now()+1000,nextPollAt:Date.now()+61000}));
 await h.admin.mutation(command("checkStatisticsAdmission"),result);
 assert.ok((await h.t.run(ctx=>ctx.db.get(result.integrationId)))!.nextPollAt!>=h.now+61000);
});
it("usable grants match the attempt, epoch and assigned account and exclude revoked or paused phases", async () => {
 const {row,t} = await fixture();
 const {admissionMatches} = await import("../../convex/_groupAdmission");
 const grant = {authorizedAt:200,actor:{tokenIdentifier:"test|admin",issuer:"test",subject:"admin"},reason:"Public aggregate statistics",collectorAccountId:row.assignedCollectorAccountId!,joinPolicy:"request" as const,epochStartedAt:100,phase:"pending" as const,membershipOrigin:"unknown" as const};
 await t.run(ctx => ctx.db.patch(row._id,{statisticsAdmission:grant}));
 const integration = {...row,statisticsAdmission:grant};
 assert.equal(admissionMatches(integration,200,grant.collectorAccountId),true);
 assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,phase:"active"}},200,grant.collectorAccountId),true);
 for (const phase of ["paused","ended","cleanup_pending","cancelled"] as const) assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,phase,revokedAt:phase === "cleanup_pending" || phase === "cancelled" ? 300 : undefined}},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches(integration,201,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,telemetryEpochStartedAt:101},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,assignedCollectorAccountId:undefined},200,grant.collectorAccountId),false);
 assert.equal(admissionMatches({...integration,statisticsAdmission:{...grant,revokedAt:300}},200,grant.collectorAccountId),false);
});
it("the helper rejects contradictory policy and phase combinations", async () => {
 const {row} = await fixture();
 const {assertStatisticsAdmission} = await import("../../convex/_groupAdmission");
 const grant = {authorizedAt:200,actor:{tokenIdentifier:"test|admin",issuer:"test",subject:"admin"},reason:"Reason",collectorAccountId:row.assignedCollectorAccountId!,joinPolicy:"request" as const,epochStartedAt:100,phase:"pending" as const,membershipOrigin:"admission" as const};
 assert.doesNotThrow(() => assertStatisticsAdmission(grant));
 assert.throws(() => assertStatisticsAdmission({...grant,joinPolicy:"free"}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,operation:{kind:"accept_invite",startedAt:200,outcome:"uncertain"}}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,phase:"cleanup_pending"}), /admission/i);
 assert.throws(() => assertStatisticsAdmission({...grant,reason:"   "}), /reason/i);
 assert.throws(() => assertStatisticsAdmission({...grant,reason:"x".repeat(501)}), /reason/i);
});

const telemetry = (name: string) => makeFunctionReference<"mutation">(`communityTelemetry:${name}`);
const explicitCapabilities = ["automatic_group_aggregates_v2", "explicit_group_statistics_admission_v1"];
async function workerFixture() {
 const h=await adminFixture(); const admitted=await h.admit();
 const heartbeat=()=>h.t.mutation(telemetry("recordCollectorHeartbeat"),{collectorAccountId:h.accountId,workerId:"worker",workerKeyHash:"test",releaseSha:"a".repeat(40),collectorVersion:"test",capabilities:explicitCapabilities,consecutiveControlFailures:0});
 await heartbeat();
 const claimed=await h.t.mutation(telemetry("claimDueAssignments"),{collectorAccountId:h.accountId,workerId:"worker",capabilities:explicitCapabilities});
 assert.equal(claimed.assignments.length,1);
 const assignment=claimed.assignments[0];
 const lease={integrationId:admitted.integrationId,collectorAccountId:h.accountId,workerId:"worker",fencingToken:assignment.fencingToken};
 const inspect=(membership:string,extra={})=>h.t.mutation(telemetry("recordStatisticsAdmissionInspection"),{...lease,admissionAt:admitted.admissionAt,membership,visibility:"public",joinPolicy:"request",...extra});
 const reserve=(automaticRequest:string,extra={})=>h.t.mutation(telemetry("reserveRequestBudget"),{...lease,requestCount:1,automaticRequest,statisticsAdmissionAt:admitted.admissionAt,...extra});
 return {...h,...admitted,assignment,lease,inspect,reserve,heartbeat};
}
it("inspection timestamps do not become successful aggregate observations", async () => {
  const h = await workerFixture();
  await h.inspect("member");
  const row = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(row?.statisticsAdmission?.phase, "active");
  assert.equal(row?.lastSuccessfulObservationAt, undefined);
});

it("group stop fences both a pending admission poll and an independent member sample", async () => {
  const h = await workerFixture();
  await h.inspect("member");
  const claim = await h.t.mutation(makeFunctionReference<"mutation">("groupMemberSnapshots:claim"), {
    worker: { collectorAccountId: h.accountId, workerId: "sampler", workerKeyHash: "test" },
  });
  assert.ok(claim);
  await h.admin.mutation(command("setObservationDecision"), { vrchatGroupId: GROUP, decision: "stop" });
  await assert.rejects(h.inspect("member"), /stale|lease/i);
  assert.equal(await h.t.mutation(makeFunctionReference<"mutation">("groupMemberSnapshots:complete"), {
    worker: { collectorAccountId: h.accountId, workerId: "sampler", workerKeyHash: "test" },
    linkId: claim.linkId, leaseToken: claim.leaseToken, memberCount: 42, observedAt: Date.now(),
  }), false);
});

for (const trigger of ["stop", "orphan"] as const) {
  it(`${trigger} keeps provenance cleanup claimable until acknowledged leave`, async () => {
    const h = await workerFixture();
    await h.inspect("absent");
    assert.equal((await h.reserve("request_join")).granted, true);
    await h.inspect("member");
    if (trigger === "stop") {
      await h.admin.mutation(command("setObservationDecision"), { vrchatGroupId: GROUP, decision: "stop" });
    } else {
      await h.t.run(ctx => ctx.db.patch(h.profileId, { publicSurfacingState: "suppressed" }));
      await h.t.mutation(command("reconcileRegisteredGroup"), { vrchatGroupId: GROUP });
    }
    const claim = await h.t.mutation(telemetry("claimDueAssignments"), {
      collectorAccountId: h.accountId, workerId: "worker", capabilities: explicitCapabilities,
    });
    assert.equal(claim.assignments.length, 1);
    assert.equal(claim.assignments[0].statisticsAdmission.revoked, true);
    h.lease.fencingToken = claim.assignments[0].fencingToken;
    assert.equal((await h.reserve("metadata")).granted, true);
    await h.inspect("member");
    assert.equal((await h.reserve("instances")).granted, false);
    assert.equal((await h.reserve("leave")).granted, true);
    assert.equal((await h.t.mutation(telemetry("recordStatisticsAdmissionCleanup"), {
      ...h.lease, admissionAt: h.admissionAt,
    })).accepted, true);
    assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.statisticsAdmission?.phase, "cancelled");
    assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 0);
  });
}

it("a destination visibility change suppresses fresh manual totals and retained membership", async () => {
  const h = await workerFixture();
  await h.inspect("member");
  const { getPublicCommunityTelemetry, getPublicGroupMembership } = await import("../../convex/_communityTelemetryPublic");
  const read = () => h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, h.profileId, Date.now()));
  assert.equal((await read())?.publicationPolicy, "automatic_aggregate");
  for (const visibility of ["private", "unknown"] as const) {
    await h.t.run(ctx => ctx.db.patch(h.destinationId, { groupMetadata: { visibility, joinPolicy: "request" } }));
    assert.equal(await read(), null);
    assert.equal(await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.profileId)), null);
  }
});

it("manual aggregate ingestion persists totals without instance or world details", async () => {
  const h = await workerFixture();
  await h.inspect("member");
  const now = Date.now();
  const providerInstanceId = "private-instance~group(grp_00000000-0000-4000-8000-000000000005)~groupAccessType(members)";
  const vrchatWorldId = "wrld_private-world";
  await h.t.mutation(telemetry("ingestAggregatePoll"), {
    ...h.lease, pollId: "manual-totals", observedAt: now, collectorVersion: "test", source: "first_party",
    groupMemberCount: 42, groupVisibility: "public", joinPolicy: "request", nextPollAt: now + 180000,
    instances: [{ providerInstanceId, providerLocation: `${vrchatWorldId}:${providerInstanceId}`, vrchatWorldId, population: 12 }],
  });
  const stored = await h.t.run(async ctx => ({
    population: await ctx.db.query("communityPopulationObservations").collect(),
    sessions: await ctx.db.query("instanceSessions").collect(),
    instances: await ctx.db.query("instancePopulationObservations").collect(),
  }));
  assert.equal(stored.population[0]?.totalPopulation, 12);
  assert.equal(stored.population[0]?.activeInstanceCount, 1);
  assert.deepEqual(stored.population[0]?.worldDistribution, []);
  assert.deepEqual(stored.sessions, []);
  assert.deepEqual(stored.instances, []);
  for (const secret of [providerInstanceId, vrchatWorldId, "usr_test", "Public statistics"]) {
    assert.equal(JSON.stringify(stored).includes(secret), false);
  }
  const { getPublicCommunityTelemetry } = await import("../../convex/_communityTelemetryPublic");
  const output = await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, h.profileId, now + 1));
  assert.equal(output?.currentPopulation?.value, 12);
  assert.equal(output?.currentPopulation?.activeInstanceCount, 1);
});
it("explicit backend persists one request before transport with automatic enrollment disabled",async()=>{
 const h=await workerFixture(); assert.equal(h.assignment.statisticsAdmission.admissionAt,h.admissionAt);
 assert.equal((await h.reserve("request_join")).granted,false);
 assert.equal((await h.inspect("absent")).accepted,true);
 assert.equal((await h.reserve("join")).granted,false);
 assert.equal((await h.reserve("request_join")).granted,true);
 const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;
 assert.equal(row.statisticsAdmission?.operation?.outcome,"uncertain"); assert.equal(row.statisticsAdmission?.membershipOrigin,"admission");
 assert.equal((await h.reserve("request_join")).granted,false);
 await h.inspect("absent"); assert.equal((await h.reserve("request_join")).granted,false);
 await h.inspect("requested"); await h.inspect("member");
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.integrationId)))?.statisticsAdmission?.phase,"active");
});
it("legacy v2 workers cannot claim cancelled explicit cleanup",async()=>{
 const h=await adminFixture(); const admitted=await h.admit(); await h.admin.mutation(command("cancelStatisticsAdmission"),admitted);
 await h.t.mutation(telemetry("recordCollectorHeartbeat"),{collectorAccountId:h.accountId,workerId:"worker",workerKeyHash:"test",releaseSha:"a".repeat(40),collectorVersion:"test",capabilities:["automatic_group_aggregates_v2"],consecutiveControlFailures:0});
 const result=await h.t.mutation(telemetry("claimDueAssignments"),{collectorAccountId:h.accountId,workerId:"worker",capabilities:["automatic_group_aggregates_v2"]}); assert.equal(result.assignments.length,0);
});

for (const bad of ["private", "unknown", "policy", "foreign_grant", "foreign_fence", "expired", "budget", "revoked", "foreign_account", "stale_inspection"] as const) it(`explicit backend rejects ${bad} before a write`,async()=>{
 const h=await workerFixture();
 if(bad==="foreign_grant") {assert.equal((await h.inspect("absent",{admissionAt:h.admissionAt+1})).accepted,false);return;}
 if(bad==="foreign_fence") {await assert.rejects(h.inspect("absent",{fencingToken:h.lease.fencingToken+1}),/stale/);return;}
 await h.inspect("absent",bad==="private"?{visibility:"private"}:bad==="unknown"?{visibility:"unknown"}:bad==="policy"?{joinPolicy:"free"}:{});
 if(bad==="expired") await h.t.run(async ctx=>{const lease=await ctx.db.query("collectorAccountLeases").first();await ctx.db.patch(lease!._id,{expiresAt:1});});
 if(bad==="budget") await h.t.run(ctx=>ctx.db.patch(h.accountId,{requestsPerMinute:0}));
 if(bad==="revoked") await h.admin.mutation(command("cancelStatisticsAdmission"),{integrationId:h.integrationId,admissionAt:h.admissionAt});
 if(bad==="stale_inspection") await h.t.run(async ctx=>{const row=(await ctx.db.get(h.integrationId))!;await ctx.db.patch(row._id,{statisticsAdmissionInspection:{...row.statisticsAdmissionInspection!,observedAt:1}});});
 if(bad==="foreign_account") await h.t.run(ctx=>ctx.db.patch(h.integrationId,{assignedCollectorAccountId:undefined}));
 if(["expired","revoked","foreign_account"].includes(bad)) await assert.rejects(h.reserve("request_join"),/stale/);
 else assert.equal((await h.reserve("request_join")).granted,false);
 const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;assert.equal(row.statisticsAdmission?.operation,undefined);
});
it("existing request is preexisting and its disappearance ends authority",async()=>{
 const h=await workerFixture(); await h.inspect("requested");
 assert.equal((await h.reserve("request_join")).granted,false);
 await h.inspect("absent"); const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;
 assert.equal(row.statisticsAdmission?.membershipOrigin,"preexisting");assert.equal(row.statisticsAdmission?.phase,"ended");
 assert.equal((await h.reserve("request_join")).granted,false);
});
it("invite reservation requires an exact fresh invitation and never repeats",async()=>{
 const h=await workerFixture(); await h.t.run(async ctx=>{const row=(await ctx.db.get(h.integrationId))!;await ctx.db.patch(row._id,{joinPolicy:"invite",statisticsAdmission:{...row.statisticsAdmission!,joinPolicy:"invite",operation:undefined}});});
 await h.inspect("absent",{joinPolicy:"invite"}); assert.equal((await h.reserve("accept_invite")).granted,false);
 await h.inspect("invited",{joinPolicy:"invite"}); assert.equal((await h.reserve("request_join")).granted,false); assert.equal((await h.reserve("accept_invite")).granted,true);
 await h.inspect("invited",{joinPolicy:"invite"}); assert.equal((await h.reserve("accept_invite")).granted,false);
});
async function cancelAndReclaim(h: Awaited<ReturnType<typeof workerFixture>>) {
 await h.admin.mutation(command("cancelStatisticsAdmission"),{integrationId:h.integrationId,admissionAt:h.admissionAt});
 const claim=await h.t.mutation(telemetry("claimDueAssignments"),{collectorAccountId:h.accountId,workerId:"worker",capabilities:explicitCapabilities});
 assert.equal(claim.assignments.length,1); h.lease.fencingToken=claim.assignments[0].fencingToken;
 assert.equal(claim.assignments[0].statisticsAdmission.revoked,true);
}
for(const status of ["requested","member","absent"] as const) it(`cancel preserves preexisting ${status} without leaving`,async()=>{
 const h=await workerFixture(); if(status!=="absent") await h.inspect(status);
 await cancelAndReclaim(h); await h.inspect(status);
 const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;assert.equal(row.statisticsAdmission?.phase,"cancelled");assert.equal(row.assignedCollectorAccountId,undefined);
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.accountId)))?.assignedGroupCount,0);
});
it("lost request and late approval retain capacity until acknowledged leave, never retry", async () => {
  const h = await workerFixture();
  await h.inspect("absent");
  await h.reserve("request_join");
  await cancelAndReclaim(h);
  await h.inspect("absent");
  assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
  assert.equal((await h.reserve("request_join")).granted, false);
  assert.equal((await h.reserve("withdraw_request")).granted, false);

  await h.inspect("requested");
  assert.equal((await h.reserve("withdraw_request")).granted, false);
  await h.inspect("member");
  assert.equal((await h.reserve("leave")).granted, true);
  assert.equal((await h.reserve("leave")).granted, false);

  await h.inspect("absent");
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.statisticsAdmission?.phase, "cleanup_pending");
  assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
  assert.equal((await h.t.mutation(telemetry("recordStatisticsAdmissionCleanup"), { ...h.lease, admissionAt: h.admissionAt })).accepted, true);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 0);
  await assert.rejects(h.t.mutation(telemetry("recordStatisticsAdmissionCleanup"), { ...h.lease, admissionAt: h.admissionAt }), /stale/);
});
it("managed adoption before cleanup write preserves membership and reservation",async()=>{
 const h=await workerFixture();await h.inspect("absent");await h.reserve("request_join");await cancelAndReclaim(h);
 await h.t.run(ctx=>ctx.db.patch(h.integrationId,{collectionScope:{kind:"managed",communityProfileId:h.profileId},communityProfileId:h.profileId,state:"active"}));
 assert.equal((await h.reserve("leave")).granted,false);
 await h.inspect("member"); const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;
 assert.equal(row.statisticsAdmission?.phase,"cancelled"); assert.equal(row.state,"active");assert.equal(row.assignedCollectorAccountId,h.accountId);
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.accountId)))?.assignedGroupCount,1);
});

it("reserved uncertain leave blocks managed adoption before any membership write can race it",async()=>{
 const h=await workerFixture();await h.inspect("absent");await h.reserve("request_join");await cancelAndReclaim(h);await h.inspect("member");await h.reserve("leave");
 await assert.rejects(h.admin.mutation(telemetry("connectGroup"),{communitySlug:"admission",vrchatGroupId:GROUP,groupVisibility:"public",joinPolicy:"request"}),/cleanup must be reconciled/);
 assert.equal((await h.t.run(ctx=>ctx.db.get(h.integrationId)))?.collectionScope?.kind,"automatic");
});

for(const stop of ["headroom","managed_priority","limit","account_stop","fleet_stop","cooldown"] as const) it(`explicit request honors ${stop} at write time`,async()=>{
 const h=await workerFixture();await h.inspect("absent");
 await h.t.run(async ctx=>{
  if(stop==="headroom")await ctx.db.patch(h.accountId,{reservedHeadroom:100});
  if(stop==="managed_priority")await ctx.db.insert("vrchatGroupObservationPolicies",{vrchatGroupId:"grp_priority",decision:{kind:"enabled",at:1},queuedAdmission:{priority:"managed",queuedAt:1,dueAt:1},createdAt:1,updatedAt:1});
  if(stop==="limit")await ctx.db.patch(h.fleetId,{automaticEnrollmentLimit:0});
  if(stop==="account_stop")await ctx.db.patch(h.accountId,{killSwitchEnabled:true});
  if(stop==="fleet_stop")await ctx.db.patch(h.fleetId,{killSwitchEnabled:true});
  if(stop==="cooldown")await ctx.db.patch(h.accountId,{cooldownUntil:Date.now()+60000});
 });
 assert.equal((await h.reserve("request_join")).granted,false);assert.equal((await h.t.run(ctx=>ctx.db.get(h.integrationId)))?.statisticsAdmission?.operation,undefined);
});

it("group stop cannot be undone by a live admission inspection",async()=>{
 const h=await workerFixture();await h.t.run(ctx=>ctx.db.patch(h.integrationId,{state:"disconnecting"}));
 assert.equal((await h.inspect("member")).accepted,false);assert.equal((await h.reserve("metadata")).granted,false);
});
it("cleanup membership failure retains cleanup responsibility",async()=>{
 const h=await workerFixture();await h.inspect("absent");await h.reserve("request_join");await cancelAndReclaim(h);
 await h.t.mutation(telemetry("recordPollFailure"),{...h.lease,statusClass:"membership",coverageState:"degraded",nextPollAt:Date.now()+60000,detail:"membership",collectorVersion:"test"});
 const row=(await h.t.run(ctx=>ctx.db.get(h.integrationId)))!;assert.equal(row.statisticsAdmission?.phase,"cleanup_pending");assert.equal(row.state,"disconnecting");assert.equal(row.assignedCollectorAccountId,h.accountId);
});

for(const phase of ["paused","ended"] as const) it(`${phase} status checks inspect without restoring collection or writes`,async()=>{
 const h=await workerFixture();await h.t.run(async ctx=>{const row=(await ctx.db.get(h.integrationId))!;await ctx.db.patch(row._id,{statisticsAdmission:{...row.statisticsAdmission!,phase},state:"degraded",nextPollAt:Date.now()+600000,lastClaimedAt:0});});
 await h.admin.mutation(command("checkStatisticsAdmission"),{integrationId:h.integrationId,admissionAt:h.admissionAt});
 const claim=await h.t.mutation(telemetry("claimDueAssignments"),{collectorAccountId:h.accountId,workerId:"worker",capabilities:explicitCapabilities});assert.equal(claim.assignments.length,1);h.lease.fencingToken=claim.assignments[0].fencingToken;
 assert.equal((await h.reserve("metadata")).granted,true);assert.equal((await h.inspect("member")).accepted,false);
 assert.equal((await h.reserve("instances")).granted,false);assert.equal((await h.reserve("request_join")).granted,false);assert.equal((await h.t.run(ctx=>ctx.db.get(h.integrationId)))?.statisticsAdmission?.phase,phase);
});
it("adopted grant history does not require explicit capability for managed dispatch", async () => {
  const h = await workerFixture();
  await h.inspect("member");
  await h.t.run(async ctx => {
    await ctx.db.insert("externalControlProofs", {
      userId: h.userId, assetType: "vrchat_group", assetExternalId: GROUP,
      controlLevel: "manager", state: "active", evidenceSource: "manual",
      verifiedAt: h.now, createdAt: h.now, updatedAt: h.now,
    });
  });
  await h.admin.mutation(telemetry("connectGroup"), {
    communitySlug: "admission", vrchatGroupId: GROUP,
    groupVisibility: "public", joinPolicy: "request",
  });
  const adopted = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(adopted?.collectionScope?.kind, "managed");
  assert.equal(adopted?.statisticsAdmission?.authorizedAt, h.admissionAt);
  assert.equal(adopted?.publicationPolicy, "automatic_aggregate");
  assert.equal(adopted?.namedMembershipCollectionEnabled, false);
  const { getPublicCommunityTelemetry } = await import("../../convex/_communityTelemetryPublic");
  const publicOutput = await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, h.profileId, Date.now()));
  assert.equal(publicOutput?.publicationPolicy, "automatic_aggregate");
  assert.equal("instanceHistory" in publicOutput!, false);
  assert.equal("membershipHistory" in publicOutput!, false);
  await h.t.run(ctx => ctx.db.patch(h.integrationId, { nextPollAt: 0 }));
  await h.t.mutation(telemetry("recordCollectorHeartbeat"), {
    collectorAccountId: h.accountId, workerId: "worker", workerKeyHash: "test",
    releaseSha: "a".repeat(40), collectorVersion: "legacy-v2",
    capabilities: ["automatic_group_aggregates_v2"], consecutiveControlFailures: 0,
  });
  const claimed = await h.t.mutation(telemetry("claimDueAssignments"), {
    collectorAccountId: h.accountId, workerId: "worker",
    capabilities: ["automatic_group_aggregates_v2"],
  });
  assert.equal(claimed.assignments.length, 1);
  assert.equal(claimed.assignments[0].collectionMode, "managed");
  assert.equal(claimed.assignments[0].statisticsAdmission, undefined);
  assert.deepEqual((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.statisticsAdmission, adopted?.statisticsAdmission);
});

it("manual admission processing and cleanup backlog alarm independently of free enrollment", async () => {
 const h = await adminFixture(); const admitted = await h.admit();
 const now = h.now + 16 * 60_000;
 const heartbeat = () => h.t.mutation(telemetry("recordCollectorHeartbeat"), { collectorAccountId: h.accountId, workerId: "old-v2-worker", workerKeyHash: "test", releaseSha: "a".repeat(40), collectorVersion: "test", capabilities: ["automatic_group_aggregates_v2"], consecutiveControlFailures: 0, now });
 const first = await heartbeat();
 assert.equal(first.automaticEnrollmentBacklog, true, "healthy v2 cannot inspect manual grants, even with free enrollment disabled");
 await h.t.run(async ctx => { const row = await ctx.db.get(admitted.integrationId); assert.ok(row?.statisticsAdmission); await ctx.db.patch(row._id, { statisticsAdmission: { ...row.statisticsAdmission, lastCheckedAt: now, operation: {kind:"request",startedAt:h.now,outcome:"confirmed"} }, nextPollAt: now + 60_000 }); });
 const waiting = await heartbeat(); assert.equal(waiting.automaticEnrollmentBacklog, false, "fresh external approval wait is not failure");
 assert.equal(waiting.statisticsAdmissionDiagnostics.externalWaiting, 1);
 await h.t.run(async ctx => { const row = await ctx.db.get(admitted.integrationId); assert.ok(row?.statisticsAdmission); await ctx.db.patch(row._id, {statisticsAdmission: {...row.statisticsAdmission, phase:"cleanup_pending",revokedAt:h.now},nextPollAt:h.now,consecutiveFailures:1}); });
 const cleanup = await heartbeat(); assert.equal(cleanup.automaticEnrollmentBacklog, true, "overdue cleanup remains actionable");
 await h.t.run(ctx => ctx.db.patch(admitted.integrationId, {nextPollAt: now + 180_000}));
 assert.equal((await heartbeat()).automaticEnrollmentBacklog, true, "unresolved cleanup is actionable despite regular inspection pacing");
 await h.t.run(async ctx => { const row = await ctx.db.get(admitted.integrationId); assert.ok(row?.statisticsAdmission); await ctx.db.patch(row._id, {statisticsAdmission:{...row.statisticsAdmission,phase:"pending",revokedAt:undefined},consecutiveFailures:3,nextPollAt:now+180_000}); });
 assert.equal((await heartbeat()).automaticEnrollmentBacklog, true, "repeated processing errors cannot hide behind their next retry time");
 assert.equal(cleanup.statisticsAdmissionDiagnostics.processingBacklog, 1);
 assert.ok(!JSON.stringify(cleanup.statisticsAdmissionDiagnostics).includes(GROUP));
});


it("admin preview includes the resolved primary group name", async () => {
 const h = await adminFixture();
 const view = await h.admin.query(makeFunctionReference<"query">("groupObservations:getStatisticsAdmission"), {profileId:h.profileId});
 assert.equal(view.groupName, "Admission group");
 assert.equal(view.vrchatGroupId, GROUP);
});

for (const priorChoice of [false, true]) it(`cancelled adopted admission requires a subsequent managed publication choice (prior=${priorChoice})`, async () => {
  const h = await workerFixture();
  await h.inspect("member");
  await h.t.run(ctx => ctx.db.insert("externalControlProofs", {
    userId: h.userId, assetType: "vrchat_group", assetExternalId: GROUP,
    controlLevel: "manager", state: "active", evidenceSource: "manual",
    verifiedAt: h.now, createdAt: h.now, updatedAt: h.now,
  }));
  await h.admin.mutation(telemetry("connectGroup"), {
    communitySlug: "admission", vrchatGroupId: GROUP, groupVisibility: "public", joinPolicy: "request",
  });
  const publish = () => h.admin.mutation(telemetry("setPublicMetric"), {
    communitySlug: "admission", metric: "currentPopulation", enabled: true,
  });
  const { resolveGroupObservationPolicy } = await import("../../convex/_groupObservationPolicy");
  const policy = () => h.t.run(ctx => resolveGroupObservationPolicy(ctx.db, {
    vrchatGroupId: GROUP, profileId: h.profileId, now: Date.now(),
  }));
  const historyStartAt = h.now - 1000;
  await h.t.run(async ctx => {
    const registry = await ctx.db.query("vrchatGroupObservationPolicies").unique();
    assert.ok(registry);
    await ctx.db.patch(registry._id, { publicHistoryStartAt: historyStartAt });
  });
  if (priorChoice) await publish();
  await h.admin.mutation(command("cancelStatisticsAdmission"), { integrationId: h.integrationId, admissionAt: h.admissionAt });
  const cancelled = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal((await policy()).kind, "hidden");
  await publish();
  const published = await policy();
  assert.equal(published.kind, "managed");
  assert.ok(published.kind === "managed");
  assert.equal(published.historyStartAt, historyStartAt);
  assert.equal(published.integration.namedMembershipCollectionEnabled, false);
  assert.deepEqual((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.statisticsAdmission, cancelled?.statisticsAdmission);
  await h.admin.mutation(command("setObservationDecision"), { vrchatGroupId: GROUP, decision: "stop" });
  await assert.rejects(publish(), /disconnecting or disconnected/);
  assert.equal((await policy()).kind, "hidden");
});

for (const membership of ["requested", "absent", "member"] as const) it(`successful ${membership} inspection recovers only non-collecting pending failures`, async () => {
  const h = await workerFixture();
  if (membership === "absent") await h.t.run(async ctx => {
    const row = await ctx.db.get(h.integrationId);
    assert.ok(row?.statisticsAdmission);
    await ctx.db.patch(row._id, { joinPolicy: "invite", statisticsAdmission: { ...row.statisticsAdmission, joinPolicy: "invite" } });
  });
  if (membership === "member") await h.inspect("member");
  for (let i = 0; i < 3; i++) {
    await h.t.mutation(telemetry("recordPollFailure"), { ...h.lease, statusClass: "500", coverageState: "degraded", nextPollAt: Date.now() + 60000, collectorVersion: "test" });
  }
  await h.inspect(membership, membership === "absent" ? { joinPolicy: "invite" } : {});
  const row = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(row?.consecutiveFailures, membership === "member" ? 3 : 0);
  const { statisticsAdmissionDiagnostics } = await import("../../convex/groupObservations");
  const diagnostics = await h.t.run(ctx => statisticsAdmissionDiagnostics(ctx.db, Date.now()));
  assert.equal(diagnostics.externalWaiting, membership === "member" ? 0 : 1);
  assert.equal(diagnostics.processingBacklog, membership === "member" ? 1 : 0);
  if (membership === "requested") {
    assert.equal(row?.statisticsAdmission?.operation, undefined);
    assert.ok(row?.statisticsAdmissionInspection);
    for (const inspection of [
      { ...row.statisticsAdmissionInspection, admissionAt: h.admissionAt - 1 },
      { ...row.statisticsAdmissionInspection, observedAt: Date.now() - 24 * 60 * 60_000 },
    ]) {
      await h.t.run(ctx => ctx.db.patch(h.integrationId, { statisticsAdmissionInspection: inspection }));
      const stale = await h.t.run(ctx => statisticsAdmissionDiagnostics(ctx.db, Date.now()));
      assert.equal(stale.externalWaiting, 0);
    }
  }
});
