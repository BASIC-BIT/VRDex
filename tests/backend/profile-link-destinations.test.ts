import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
import { profileLinkPresentation } from "../../convex/_profileLinkPresentation";

mock.timers.enable({apis:["setTimeout"]});

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
  "../../convex/profileLinkDestinationDelivery.ts": () => import("../../convex/profileLinkDestinationDelivery"),
  "../../convex/profileLinkDestinations.ts": () => import("../../convex/profileLinkDestinations"),
};
const schema = (schemaModule as unknown as {default?: typeof schemaModule}).default ?? schemaModule;
const invite = "https://discord.gg/SlothGroup";
const key = "discord_guild:SlothGroup";
const artwork = "https://cdn.discordapp.com/icons/123456789012345678/0123456789abcdef0123456789abcdef.png?size=128";
async function fixture() {
  mock.timers.reset();
  mock.timers.enable({apis:["setTimeout"]});
  const t = convexTest({schema, modules});
  const clerkUserId = newClerkUserId();
  const now = Date.now();
  const profileId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", {clerkUserId, email: "destination@example.test", emailVerificationTime: now});
    const id = await ctx.db.insert("profiles", {slug: "sloth-destinations", displayName: "Sloth Destinations", sortName: "sloth destinations", aliases: [], tags: [], profileType: "person", person: {roleTags: []}, claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: now});
    await ctx.db.insert("profileOwners", {profileId:id,userId,roleKey:"owner",state:"active",grantedAt:now,updatedAt:now});
    return id;
  });
  const owner = t.withIdentity({subject:clerkUserId,issuer:"test",emailVerified:true});
  async function save(links: Array<{type:string;url:string;label?:string;labelMode?:"automatic"|"custom"}>) {
    const current = await t.query(api.profiles.getPublicBySlug,{slug:"sloth-destinations"});
    await owner.mutation(api.profiles.updateProfileFromBrowser,{slug:"sloth-destinations",expectedUpdatedAt:current!.updatedAt,outboundLinks:links});
  }
  async function claim() {
    await t.run(async ctx => {
      const row = await ctx.db.query("profileLinkDestinations").withIndex("by_key",q=>q.eq("key",key)).unique();
      if(row && row.workDueAt === undefined) await ctx.db.patch(row._id,{observedAt:0,retryEligibleAt:0});
      const budget = await ctx.db.query("profileLinkDestinationBudgets").first();
      if(budget) await ctx.db.patch(budget._id,{nextAllowedAt:0});
    });
    await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
    const {jobs} = await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"});
    assert.equal(jobs.length,1);
    return jobs[0];
  }
  const read = () => t.query(api.profiles.getPublicBySlug,{slug:"sloth-destinations"});
  return {t,owner,profileId,save,claim,read};
}

it("public write/read, editor preview and lookup share names while overrides and resets stay authored", async () => {
  const {t,owner,save,claim,read} = await fixture();
  await save([{type:"discord",url:invite}]);
  let job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Sloth's Server",artworkSourceUrl:artwork}});
  let profile = (await read())!;
  assert.equal(profileLinkPresentation(profile.outboundLinks[0]).label,"Sloth's Server");
  assert.equal(profile.outboundLinks[0].labelMode,"automatic");
  assert.equal(profile.outboundLinks[0].label,"Discord");
  assert.equal(profile.outboundLinks[0].url,invite);
  const lookup = await t.query(api.profiles.lookupPeople,{query:"Sloth Destinations"});
  assert.equal(lookup[0].outboundLinks[0].destination?.name,"Sloth's Server");
  const preview = await owner.query(api.profiles.previewProfileFromBrowser,{slug:profile.slug,expectedUpdatedAt:profile.updatedAt,outboundLinks:[{type:"discord",url:invite,label:"My community",labelMode:"custom"}]});
  assert.equal(profileLinkPresentation(preview.outboundLinks[0]).label,"My community");
  assert.equal(profileLinkPresentation((await read())!.outboundLinks[0]).label,"Sloth's Server");
  await save([{type:"discord",url:invite,label:"My community",labelMode:"custom"}]);
  job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Renamed Server"}});
  assert.equal(profileLinkPresentation((await read())!.outboundLinks[0]).label,"My community");
  await save([{type:"discord",url:invite,labelMode:"automatic"}]);
  assert.equal(profileLinkPresentation((await read())!.outboundLinks[0]).label,"Renamed Server");
  await save([{type:"discord",url:invite,label:"Discord"}]);
  assert.equal((await read())!.outboundLinks[0].labelMode,"automatic", "legacy full-array unchanged labels preserve stored mode");
});

it("temporary errors keep branding, reassignment replaces it, invalid and private links expose no artwork", async () => {
  const {t,profileId,save,claim,read} = await fixture();
  await save([{type:"discord",url:invite}]);
  let job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Old Server",artworkSourceUrl:artwork}});
  job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"transient"}});
  assert.equal((await read())!.outboundLinks[0].destination?.name,"Old Server");
  assert.ok((await read())!.outboundLinks[0].destination?.artworkUrl);
  job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"987654321098765432",displayName:"New Server"}});
  assert.equal((await read())!.outboundLinks[0].destination?.name,"New Server");
  assert.equal((await read())!.outboundLinks[0].destination?.artworkUrl,undefined);
  job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"invalid"}});
  assert.equal((await read())!.outboundLinks[0].destination?.status,"invalid");
  assert.equal((await read())!.outboundLinks[0].destination?.name,undefined);
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId}),null);
  job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Again",artworkSourceUrl:artwork}});
  assert.ok(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId}));
  await t.run(ctx=>ctx.db.patch(profileId,{fieldVisibility:{outboundLinks:"private"}}));
  assert.deepEqual((await read())!.outboundLinks,[]);
  assert.equal((await t.query(api.profiles.lookupPeople,{query:"Sloth Destinations"}))[0].outboundLinks.length,0);
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId}),null);
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  assert.equal((await t.run(ctx=>ctx.db.query("profileLinkDestinationReferences").collect())).length,0);
  await t.run(async ctx => {
    for (const row of await ctx.db.query("profileLinkDestinations").collect()) await ctx.db.patch(row._id,{nextAttemptAt:0});
    for (const budget of await ctx.db.query("profileLinkDestinationBudgets").collect()) await ctx.db.patch(budget._id,{nextAllowedAt:0});
  });
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
});

it("existing generated labels resolve but distinct legacy labels survive full-array edits", async () => {
  const {t,profileId,save,claim,read} = await fixture();
  await t.run(ctx=>ctx.db.patch(profileId,{outboundLinks:[{type:"discord",url:invite,label:"Discord",source:"reviewed"}]}));
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  const job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Fetched"}});
  assert.equal(profileLinkPresentation((await read())!.outboundLinks[0]).label,"Fetched");
  await t.run(ctx=>ctx.db.patch(profileId,{outboundLinks:[{type:"discord",url:invite,label:"Discord community",source:"reviewed"}]}));
  await save([{type:"discord",url:invite,label:"Discord community"},{type:"website",url:"https://example.test"}]);
  const link = (await read())!.outboundLinks[0];
  assert.equal(link.labelMode,undefined);
  assert.equal(link.source,"reviewed");
  assert.equal(profileLinkPresentation(link).label,"Discord community");
});


it("VRChat jobs fence workers and exact identities while three group destinations remain distinct", async () => {
  const {t,save,read} = await fixture();
  const ids = [1,2,3].map(n => `grp_00000000-0000-4000-8000-${String(n).padStart(12,"0")}`);
  await save(ids.map(id => ({type:"other",url:`https://vrchat.com/home/group/${id}`,labelMode:"automatic"})));
  const before = (await read())!;
  const accountId = await t.run(ctx => ctx.db.insert("collectorAccounts",{
    vrchatUserId:"usr_00000000-0000-4000-8000-000000000099",accountAlias:"destinations-test",state:"ready",capacity:100,reservedHeadroom:10,assignedGroupCount:0,requestsPerMinute:10,secretRef:"test",workerKeyHash:"key-v1",credentialGeneration:1,killSwitchEnabled:false,createdAt:Date.now(),updatedAt:Date.now(),
  }));
  let worker = {collectorAccountId:String(accountId),workerId:"worker-1",workerKeyHash:"key-v1"};
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"vrchat"})).jobs.length,0);
  const {jobs} = await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"vrchat",worker,limit:3});
  assert.equal(jobs.length,3);
  assert.ok((await t.run(ctx=>ctx.db.query("collectorFleetSettings").first()))?.destinationWorkDueAt);
  const first = jobs[0];
  const result = {status:"resolved" as const,entityId:first.locator,displayName:"Group One",artworkSourceUrl:"https://files.vrchat.cloud/file_00000000-0000-4000-8000-000000000001/1/file"};
  assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key:first.key,leaseToken:first.leaseToken,worker:{...worker,workerId:"intruder"},result})).accepted,false);
  assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key:first.key,leaseToken:first.leaseToken,worker,result:{...result,entityId:"grp_00000000-0000-4000-8000-000000000999"}})).accepted,false);
  await t.run(ctx=>ctx.db.patch(accountId,{workerKeyHash:"key-v2"}));
  assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key:first.key,leaseToken:first.leaseToken,worker,result})).accepted,false);
  worker = {...worker,workerKeyHash:"key-v2"};
  await t.run(async ctx=>{
    for(const row of await ctx.db.query("profileLinkDestinations").collect()) await ctx.db.patch(row._id,{workDueAt:0,leaseExpiresAt:0});
  });
  const renewed = await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"vrchat",worker,limit:3});
  assert.equal(renewed.jobs.length,3);
  assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key:first.key,leaseToken:first.leaseToken,worker,result})).accepted,false);
  for (const [index,job] of renewed.jobs.entries()) {
    assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,worker,result:{...result,entityId:job.locator,displayName:`Group ${index+1}`}})).accepted,true);
  }
  assert.equal((await t.run(ctx=>ctx.db.query("collectorFleetSettings").first()))?.destinationWorkDueAt,undefined);
  const after = (await read())!;
  assert.equal(new Set(after.outboundLinks.map(link=>profileLinkPresentation(link).label)).size,3);
  assert.deepEqual(after.outboundLinks.map(link=>link.url),ids.map(id=>`https://vrchat.com/home/group/${id}`));
  assert.ok(after.outboundLinks.every(link=>link.destination?.artworkUrl));
  assert.equal(after.updatedAt,before.updatedAt);
  assert.equal(after.trustLabel,before.trustLabel);
});

it("artwork checks its rendering profile directly even behind a hundred stale references", async () => {
  const {t,profileId,save,claim,read} = await fixture();
  await save([{type:"discord",url:invite}]);
  const job = await claim();
  await t.mutation(internal.profileLinkDestinations.recordResult,{key:job.key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Current Public Server",artworkSourceUrl:artwork}});
  const staleIds = await t.run(async ctx => {
    // The old reference scan would have exhausted its budget on these rows.
    const refs = await ctx.db.query("profileLinkDestinationReferences").collect();
    for(const ref of refs) await ctx.db.delete(ref._id);
    const ids = [];
    for(let i=0;i<101;i++) {
      const id = await ctx.db.insert("profiles",{slug:`stale-artwork-${i}`,displayName:"Old",sortName:"old",aliases:[],tags:[],profileType:"person",person:{roleTags:[]},claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now(),fieldVisibility:{outboundLinks:"private"},outboundLinks:[{type:"discord",url:invite,label:"Discord",source:"reviewed"}]});
      ids.push(id);
      await ctx.db.insert("profileLinkDestinationReferences",{key,profileId:id});
    }
    await ctx.db.insert("profileLinkDestinationReferences",{key,profileId});
    return ids;
  });
  const url = new URL((await read())!.outboundLinks[0].destination!.artworkUrl!,"https://vrdex.test");
  assert.equal(url.searchParams.get("profile"),String(profileId));
  assert.equal((await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId}))?.artworkSourceUrl,artwork);
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId:staleIds[0]}),null);
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId:"not-a-profile-id"}),null);
  await t.run(ctx=>ctx.db.patch(profileId,{outboundLinks:[]}));
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{key,profileId}),null);
});

it("legacy eligibility timestamps never request work, but a public visit requests it once", async () => {
  const {t,profileId} = await fixture();
  await t.run(async ctx => {
    await ctx.db.patch(profileId,{outboundLinks:[{type:"discord",url:invite,label:"Discord",source:"reviewed"}]});
    await ctx.db.insert("profileLinkDestinations",{key,kind:"discord_guild",locator:"SlothGroup",provider:"discord",status:"resolved",name:"Cached",observedAt:Date.now()-25*3600000,nextAttemptAt:0,lastReferencedAt:0});
  });
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
  await Promise.all(Array.from({length:100},()=>t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"})));
  assert.equal((await t.run(ctx=>ctx.db.query("profileLinkDestinations").collect())).length,1);
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,1);
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
});


it("time, search, and unchanged saves cannot enqueue refresh or failed retry", async test => {
  let now = Date.now();
  test.mock.method(Date,"now",()=>now);
  const {t,save,read} = await fixture();
  await save([{type:"discord",url:invite}]);
  const job = (await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs[0];
  await t.mutation(internal.profileLinkDestinations.recordResult,{key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Cached"}});
  const pending = () => t.run(async ctx => (await ctx.db.system.query("_scheduled_functions").collect()).filter(row=>row.state.kind === "pending"));
  assert.equal((await pending()).length,0);
  now += 25*3600000;
  await read();
  await t.query(api.profiles.lookupPeople,{query:"Sloth Destinations"});
  await save([{type:"discord",url:invite,label:"Custom",labelMode:"custom"}]);
  assert.equal((await pending()).length,0);
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  const retried = (await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs[0];
  assert.ok(retried);
  await t.mutation(internal.profileLinkDestinations.recordResult,{key,leaseToken:retried.leaseToken,result:{status:"transient"}});
  assert.equal((await pending()).length,0);
  const failed = await t.run(ctx=>ctx.db.query("profileLinkDestinations").first());
  assert.equal(failed?.observedAt,now-25*3600000);
  assert.equal(failed?.retryEligibleAt,now+15*60000);
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  assert.equal((await pending()).length,0);
  now += 15*60000;
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
  assert.equal((await pending()).length,0);
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  assert.equal((await pending()).length,1);
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,1);
});

it("one-shot Discord dispatcher coalesces visits, respects budget, and cancels recovery when drained", async test => {
  let now = Date.now();
  test.mock.method(Date,"now",()=>now);
  const fetcher = test.mock.method(globalThis,"fetch",async (url: string | URL | Request) => {
    const code = new URL(String(url)).pathname.split("/").at(-1);
    return new Response(JSON.stringify({type:0,code,guild:{id:"123456789012345678",name:"Resolved"}}),{status:200});
  });
  const {t,save} = await fixture();
  await save([{type:"discord",url:invite},{type:"discord",url:"https://discord.gg/Second"}]);
  await Promise.all(Array.from({length:100},()=>t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"})));
  const pending = () => t.run(async ctx => (await ctx.db.system.query("_scheduled_functions").collect()).filter(row=>row.state.kind === "pending"));
  assert.equal((await pending()).length,1);
  const firstBudget = await t.run(ctx=>ctx.db.query("profileLinkDestinationBudgets").first());
  mock.timers.tick(0);
  await t.finishInProgressScheduledFunctions();
  assert.equal(fetcher.mock.callCount(),1);
  const secondBudget = await t.run(ctx=>ctx.db.query("profileLinkDestinationBudgets").first());
  assert.equal(secondBudget?.dispatcherDueAt,now+60000);
  await t.action(internal.profileLinkDestinationDelivery.refreshDiscord,{dispatcherToken:firstBudget!.dispatcherToken});
  assert.equal(fetcher.mock.callCount(),1,"stale dispatcher is inert");
  now += 60000;
  mock.timers.tick(60000);
  await t.finishInProgressScheduledFunctions();
  assert.equal(fetcher.mock.callCount(),2);
  assert.equal((await pending()).length,0);
  assert.equal((await t.run(ctx=>ctx.db.query("profileLinkDestinationBudgets").first()))?.dispatcherToken,undefined);
  assert.ok((await t.run(ctx=>ctx.db.query("profileLinkDestinations").collect())).every(row=>row.workDueAt===undefined));
  now += 25*3600000;
  await t.action(internal.profileLinkDestinationDelivery.refreshDiscord,{dispatcherToken:secondBudget!.dispatcherToken});
  assert.equal(fetcher.mock.callCount(),2);
});

it("membership removal invalidates leases and re-publication queues a fresh destination", async () => {
  const {t,profileId,save} = await fixture();
  await save([{type:"discord",url:invite}]);
  const job = (await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs[0];
  await t.run(ctx=>ctx.db.patch(profileId,{fieldVisibility:{outboundLinks:"private"}}));
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  assert.equal(await t.run(ctx=>ctx.db.query("profileLinkDestinations").first()),null);
  assert.equal((await t.mutation(internal.profileLinkDestinations.recordResult,{key,leaseToken:job.leaseToken,result:{status:"resolved",entityId:"123456789012345678",displayName:"Late"}})).accepted,false);
  await t.run(ctx=>ctx.db.patch(profileId,{fieldVisibility:undefined}));
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  const row = await t.run(ctx=>ctx.db.query("profileLinkDestinations").first());
  assert.ok(row?.workDueAt);
  assert.equal(row?.name,undefined);
  await save([{type:"discord",url:"https://discord.gg/Replacement"}]);
  const rows = await t.run(ctx=>ctx.db.query("profileLinkDestinations").collect());
  assert.equal(rows.length,1);
  assert.equal(rows[0].key,"discord_guild:Replacement");
  assert.equal(rows[0].name,undefined);
});

it("legacy profiles reconcile missing references without turning unrelated saves into work", async () => {
  const {queueProfileLinkDestinations} = await import("../../convex/_profileLinkDestinationCache");
  const {t,profileId} = await fixture();
  await t.run(async ctx => {
    await ctx.db.patch(profileId,{outboundLinks:[{type:"discord",url:invite,label:"Discord",source:"reviewed"}]});
    await ctx.db.insert("profileLinkDestinations",{key,kind:"discord_guild",locator:"SlothGroup",provider:"discord",status:"resolved",name:"Legacy cache",observedAt:0,nextAttemptAt:0,lastReferencedAt:0});
    const previousProfile = (await ctx.db.get(profileId))!;
    const current = {...previousProfile,displayName:"Unrelated rename"};
    assert.deepEqual(await queueProfileLinkDestinations(ctx,current,Date.now(),{previousProfile}),[]);
    assert.equal((await ctx.db.query("profileLinkDestinationReferences").collect()).length,1);
    assert.equal((await ctx.db.query("profileLinkDestinations").first())?.workDueAt,undefined);
    assert.equal((await ctx.db.query("profileLinkDestinations").first())?.name,"Legacy cache");
    const added = {...current,outboundLinks:[...current.outboundLinks!,{type:"discord",url:"https://discord.gg/NewLink",label:"Discord",source:"reviewed" as const}]};
    assert.deepEqual(await queueProfileLinkDestinations(ctx,added,Date.now(),{previousProfile:current}),["discord_guild:NewLink"]);
  });
});

it("a live legacy lease blocks visits until it expires without losing cached branding", async test => {
  let now = Date.now();
  test.mock.method(Date,"now",()=>now);
  const {t,profileId} = await fixture();
  await t.run(async ctx => {
    await ctx.db.patch(profileId,{outboundLinks:[{type:"discord",url:invite,label:"Discord",source:"reviewed"}]});
    await ctx.db.insert("profileLinkDestinations",{key,kind:"discord_guild",locator:"SlothGroup",provider:"discord",status:"resolved",name:"Legacy cache",observedAt:0,nextAttemptAt:now+60000,lastReferencedAt:now,leaseToken:"old-lease",leaseExpiresAt:now+60000});
  });
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  assert.equal((await t.run(ctx=>ctx.db.query("profileLinkDestinations").first()))?.workDueAt,undefined);
  assert.equal((await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs.length,0);
  now += 60000;
  await t.mutation(api.profileLinkDestinations.requestForProfile,{slug:"sloth-destinations"});
  const job = (await t.mutation(internal.profileLinkDestinations.claimPending,{provider:"discord"})).jobs[0];
  assert.ok(job);
  assert.notEqual(job.leaseToken,"old-lease");
  assert.equal((await t.run(ctx=>ctx.db.query("profileLinkDestinations").first()))?.name,"Legacy cache");
});
