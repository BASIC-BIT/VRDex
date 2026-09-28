import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
const schema = (schemaModule as unknown as {default?:typeof schemaModule}).default??schemaModule;
const ref=(name:string)=>makeFunctionReference<"mutation">(`eventIntakeSources:${name}`);
async function fixture(){
 const t=convexTest({schema,modules:{"../../convex/_generated/api.ts":()=>import("../../convex/_generated/api"),"../../convex/eventIntake.ts":()=>import("../../convex/eventIntake"),"../../convex/events.ts":()=>import("../../convex/events"),"../../convex/eventIntakeSources.ts":()=>import("../../convex/eventIntakeSources")}});
 const rows=await t.run(async ctx=>{
 const actorUserId=await ctx.db.insert("users",{clerkUserId:"actor"});const other=await ctx.db.insert("users",{clerkUserId:"other"});
 const draftId=await ctx.db.insert("eventIntakeDrafts",{actorUserId,version:1,fields:{title:"Night"},provenance:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000});return{actorUserId,other,draftId};});return{t,...rows};
}
it("reserves private actor/draft-bound uploads with byte bounds and denies cross-actor completion",async()=>{
 const{t,actorUserId,other,draftId}=await fixture();const args={actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)};
 await assert.rejects(t.mutation(ref("beginPosterUpload"),{...args,byteLength:12*1024*1024+1}));
 const source=await t.mutation(ref("beginPosterUpload"),args);assert.match(source.storageKey,/^profile-assets\/event-posters\/private\//);
 await assert.rejects(t.mutation(ref("completePosterUpload"),{actorUserId:other,posterAssetId:source.posterAssetId,sha256:args.sha256}));
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:args.sha256});
 const stored=await t.run(ctx=>ctx.db.get(source.posterAssetId));assert.equal(stored?.state,"ready");assert.equal(stored?.artworkAssetId,undefined);
 assert.equal((await t.run(ctx=>ctx.db.query("eventPosterArtwork").collect())).length,0);
});
it("requires explicit fresh-version artwork selection and expires evidence independently",async()=>{
 const{t,actorUserId,draftId}=await fixture();const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 await assert.rejects(t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:0}));
 const selection=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1});assert.notEqual(selection.storageKey,source.storageKey);
 await t.run(ctx=>ctx.db.patch(source.posterAssetId,{uploadedAt:Date.now()-181*86400000,expiresAt:0}));
 const expired=await t.mutation(ref("claimExpiredSources"),{});assert.equal(expired.length,1);assert.ok(!expired[0].storageKeys.includes(selection.storageKey));
});

it("binds source reads and extraction quotas to the actor and draft", async () => {
 const {t,actorUserId,other,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await assert.rejects(t.query(makeFunctionReference<"query">("eventIntakeSources:readActorSource"),{actorUserId:other,posterAssetId:source.posterAssetId}),/NOT_FOUND/);
 await assert.rejects(t.mutation(ref("authorizeExtraction"),{actorUserId,draftId,posterAssetId:source.posterAssetId}),/NOT_READY/);
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 for(let i=0;i<20;i++) await t.mutation(ref("authorizeExtraction"),{actorUserId,draftId,posterAssetId:source.posterAssetId});
 await assert.rejects(t.mutation(ref("authorizeExtraction"),{actorUserId,draftId}),/QUOTA/);
 assert.deepEqual((await t.run(ctx=>ctx.db.get(draftId)))?.fields,{title:"Night"});
});
it("reserves bytes before signing and rejects expired upload completion", async()=>{
 const{t,actorUserId,draftId}=await fixture();
 const args={actorUserId,draftId,contentType:"image/webp",byteLength:12*1024*1024,sha256:"a".repeat(64)};
 for(let i=0;i<5;i++) await t.mutation(ref("beginPosterUpload"),args);
 await assert.rejects(t.mutation(ref("beginPosterUpload"),args),/QUOTA/);
 const row=await t.run(ctx=>ctx.db.query("eventPosterSources").first());
 await t.run(ctx=>ctx.db.patch(row!._id,{uploadExpiresAt:Date.now()-1}));
 await assert.rejects(t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:row!._id,sha256:args.sha256}),/NOT_FOUND/);
});
it("keeps held evidence and retries deletion with token checks, without public artwork keys", async()=>{
 const{t,actorUserId,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const report=await t.run(async ctx=>{
  const eventId=await ctx.db.insert("events",{title:"Night",sortTitle:"night",sourceType:"contributor",sourceLabel:"Community-submitted",eventStatus:"scheduled",publicationState:"published",createdAt:0,updatedAt:0});
  return ctx.db.insert("eventReports",{eventId,kind:"report",reason:"review",createdAt:Date.now()});
 });
 await t.run(ctx=>ctx.db.patch(source.posterAssetId,{uploadedAt:0,expiresAt:0,holdReportId:report}));
 assert.deepEqual(await t.mutation(ref("claimExpiredSources"),{}),[]);
 await t.run(ctx=>ctx.db.patch(source.posterAssetId,{holdReportId:undefined}));
 const [work]=await t.mutation(ref("claimExpiredSources"),{});
 assert.ok(work);assert.deepEqual(await t.mutation(ref("claimExpiredSources"),{}),[]);
 await t.mutation(ref("confirmSourceDeletion"),{posterAssetId:source.posterAssetId,token:"wrong"});
 assert.equal((await t.run(ctx=>ctx.db.get(source.posterAssetId)))?.state,"deleting");
 await t.mutation(ref("confirmSourceDeletion"),{posterAssetId:source.posterAssetId,token:work.token});
 const expired=await t.run(ctx=>ctx.db.get(source.posterAssetId));
 assert.equal(expired?.state,"expired");assert.equal(expired?.storageKey,undefined);assert.equal(expired?.reservedBytes,0);assert.equal(expired?.sha256,"a".repeat(64));
});

it("publishes private evidence without artwork and attaches only a separately validated selected derivative",async()=>{
 process.env.EVENT_DATE_ONLY_ENABLED="true";
 for(const explicit of [false,true]) {
  const{t,actorUserId,draftId}=await fixture();
  await t.run(async ctx=>{
   await ctx.db.insert("profiles",{slug:"club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});
   await ctx.db.patch(draftId,{fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true}});
  });
  const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
  await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
  let artwork;
  if(explicit){
   artwork=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1});
   assert.equal(await t.query(makeFunctionReference<"query">("eventIntakeSources:publicArtwork"),{artworkAssetId:artwork.artworkAssetId}),null);
   await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:artwork.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100});
  }
  const published=await t.mutation(makeFunctionReference<"mutation">("eventIntake:commitPublishIntake"),{actorUserId,draftId,expectedVersion:explicit?2:1,idempotencyKey:"publish"});
  const event=await t.run(ctx=>ctx.db.get(published.eventId));
  if(explicit){
   assert.equal(event?.posterImageUrl,`/api/v0/events/${published.eventId}/artwork/${artwork.artworkAssetId}`);
   const publicEvent=await t.query(makeFunctionReference<"query">("events:getPublicBySlug"),{slug:event!.slug!});
   assert.equal(publicEvent?.posterImageUrl,event?.posterImageUrl);
   const searchDoc=await t.run(ctx=>ctx.db.query("searchDocuments").first());
   assert.equal(searchDoc?.imageUrl,event?.posterImageUrl);
   assert.equal((await t.query(makeFunctionReference<"query">("eventIntakeSources:publicArtwork"),{artworkAssetId:artwork.artworkAssetId})).storageKey,artwork.storageKey);
  }else assert.equal(event?.posterImageUrl,undefined);
  const evidence=await t.run(ctx=>ctx.db.get(source.posterAssetId));assert.equal(evidence?.eventId,published.eventId);
  assert.ok(evidence!.expiresAt<=Date.now()+86400000);
  const {sourceExpiry}=await import("../../convex/eventIntakeSources");
  assert.equal(await t.run(ctx=>sourceExpiry(ctx.db,evidence!)),evidence!.uploadedAt+180*86400000);
  await t.run(ctx=>ctx.db.patch(source.posterAssetId,{uploadedAt:0,expiresAt:0}));
  const [work]=await t.mutation(ref("claimExpiredSources"),{});
  if(explicit) assert.ok(!work.storageKeys.includes(artwork.storageKey));
  await t.mutation(ref("confirmSourceDeletion"),{posterAssetId:source.posterAssetId,token:work.token});
  assert.deepEqual(await t.mutation(ref("claimAbandonedArtwork"),{}),[]);
  if(explicit) assert.equal((await t.run(ctx=>ctx.db.get(artwork.artworkAssetId)))?.state,"published");
 }
});
it("rejects stale classifier decisions and atomically records outage reports while rechecking deterministic rules",async()=>{
 process.env.EVENT_DATE_ONLY_ENABLED="true";
 const{t,actorUserId,draftId}=await fixture();
 const args={actorUserId,draftId,expectedVersion:1,idempotencyKey:"classify",classification:{draftId,draftVersion:0,decision:"allow",reviewReason:"classifier_outage"}};
 const commit=makeFunctionReference<"mutation">("eventIntake:commitPublishIntake");
 await assert.rejects(t.mutation(commit,args),/CLASSIFICATION_VERSION/);
 args.classification.draftVersion=1;
 await assert.rejects(t.mutation(commit,args));
 assert.equal((await t.run(ctx=>ctx.db.query("events").collect())).length,0);
 await t.run(async ctx=>{
  await ctx.db.insert("profiles",{slug:"club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});
  await ctx.db.patch(draftId,{fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true}});
 });
 const result=await t.mutation(commit,args);
 assert.equal((await t.run(ctx=>ctx.db.query("eventReports").collect()))[0]?.eventId,result.eventId);
 await t.mutation(commit,args);
 assert.equal((await t.run(ctx=>ctx.db.query("eventReports").collect())).length,1);
});

it("uses current event dates for retention and respects private reviewer reads",async()=>{
 const{t,actorUserId,other,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const get=makeFunctionReference<"query">("eventIntakeSources:getPosterSource");
 await assert.rejects(t.query(get,{posterAssetId:source.posterAssetId}));
 await assert.rejects(t.withIdentity({subject:"other"}).query(get,{posterAssetId:source.posterAssetId}));
 assert.equal((await t.withIdentity({subject:"actor"}).query(get,{posterAssetId:source.posterAssetId})).sha256,"a".repeat(64));
 await t.run(async ctx=>{
  await ctx.db.insert("accountFeatureGrants",{userId:other,feature:"super_admin",state:"active",grantedBy:{tokenIdentifier:"test|reviewer",subject:"reviewer",issuer:"test"},grantedAt:Date.now(),updatedAt:Date.now()});
  const eventId=await ctx.db.insert("events",{title:"Night",sortTitle:"night",sourceType:"contributor",sourceLabel:"Community-submitted",eventDate:"2020-01-01",eventStatus:"scheduled",publicationState:"published",createdAt:0,updatedAt:0});
  await ctx.db.patch(source.posterAssetId,{eventId,expiresAt:0});
 });
 await assert.rejects(t.withIdentity({subject:"actor"}).query(get,{posterAssetId:source.posterAssetId}),/NOT_FOUND/);
 assert.equal((await t.mutation(ref("claimExpiredSources"),{})).length,1);
});

it("retries a deleting artwork with a fresh key and preserves the old cleanup claim",async()=>{
 const{t,actorUserId,other,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const args={actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1};
 const old=await t.mutation(ref("selectPosterArtwork"),args);
 await t.run(ctx=>ctx.db.patch(old.artworkAssetId,{expiresAt:0}));
 const [claim]=await t.mutation(ref("claimAbandonedArtwork"),{});
 const fresh=await t.mutation(ref("selectPosterArtwork"),args);
 assert.notEqual(fresh.artworkAssetId,old.artworkAssetId);assert.notEqual(fresh.storageKey,old.storageKey);
 assert.ok(fresh.writeExpiresAt>Date.now()&&fresh.writeExpiresAt<=Date.now()+600000);
 await assert.rejects(t.mutation(ref("recoverFailedArtworkWrite"),{actorUserId:other,artworkAssetId:old.artworkAssetId}),/ARTWORK_NOT_FOUND/);
 await t.mutation(ref("confirmArtworkDeletion"),{artworkAssetId:old.artworkAssetId,token:claim.token});
 assert.equal((await t.run(ctx=>ctx.db.get(old.artworkAssetId)))?.state,"expired");
 assert.equal((await t.run(ctx=>ctx.db.get(fresh.artworkAssetId)))?.state,"pending");
});

it("returns the selected artwork source independently of the current poster after replacement", async () => {
 const {t,actorUserId,draftId}=await fixture();
 const makeSource=async()=>{
  const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
  await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
  return source.posterAssetId;
 };
 const a=await makeSource();const b=await makeSource();
 const select=async(posterAssetId:string,expectedVersion:number)=>{
  const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId,expectedVersion});
  await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion,sha256:"b".repeat(64),byteLength:100});
 };
 await select(a,1);
 await t.mutation(makeFunctionReference<"mutation">("eventIntake:saveActorDraft"),{actorUserId,draftId,expectedVersion:2,patch:{posterSourceId:b}});
 const read=()=>t.withIdentity({subject:"actor"}).query(makeFunctionReference<"query">("eventIntake:getEventIntakeDraft"),{draftId});
 assert.equal((await read()).artworkSourceId,a);
 assert.equal((await read()).fields.posterSourceId,b);
 await select(b,3);
 assert.equal((await read()).artworkSourceId,b);
});
