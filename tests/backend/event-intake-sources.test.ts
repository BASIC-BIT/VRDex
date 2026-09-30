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
 assert.equal((await t.mutation(ref("authorizeExtraction"),{actorUserId,draftId,reserveQuota:false})).version,1);
 assert.equal((await t.run(ctx=>ctx.db.query("eventIntakeModelAttempts").collect())).length,20);
 assert.deepEqual((await t.run(ctx=>ctx.db.get(draftId)))?.fields,{title:"Night"});
});
it("saves one pending poster and checks actor, draft, readiness and expiry before extraction quota", async () => {
 const {t,actorUserId,other,draftId}=await fixture();
 const make=async(actorUserId:typeof other,draftId:typeof draftId)=>t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const source=await make(actorUserId,draftId);
 const foreignDraft=await t.run(ctx=>ctx.db.insert("eventIntakeDrafts",{actorUserId,version:1,fields:{title:"Other"},provenance:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000}));
 const foreign=await make(actorUserId,foreignDraft);
 const otherDraft=await t.run(ctx=>ctx.db.insert("eventIntakeDrafts",{actorUserId:other,version:1,fields:{title:"Other actor"},provenance:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000}));
 const otherSource=await make(other,otherDraft);
 const save=makeFunctionReference<"mutation">("eventIntake:saveActorDraft");
 for(const posterSourceId of [foreign.posterAssetId,otherSource.posterAssetId]) await assert.rejects(t.mutation(save,{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId}}),/POSTER_/);
 assert.equal((await t.run(ctx=>ctx.db.get(draftId)))?.version,1);
 await t.mutation(save,{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId:source.posterAssetId}});
 const auth=ref("authorizeExtraction");
 await assert.rejects(t.mutation(auth,{actorUserId,draftId,posterAssetId:source.posterAssetId}),/NOT_READY/);
 assert.equal((await t.run(ctx=>ctx.db.query("eventIntakeModelAttempts").collect())).length,0);
 for(const posterAssetId of [source.posterAssetId,foreign.posterAssetId]) await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId,sha256:"a".repeat(64)});
 await assert.rejects(t.mutation(auth,{actorUserId,draftId,posterAssetId:foreign.posterAssetId}),/NOT_READY/);
 await assert.rejects(t.mutation(auth,{actorUserId,draftId,posterAssetId:otherSource.posterAssetId}),/NOT_FOUND/);
 assert.equal((await t.mutation(auth,{actorUserId,draftId,posterAssetId:source.posterAssetId})).version,2);
 await t.run(ctx=>ctx.db.patch(source.posterAssetId,{expiresAt:0,uploadedAt:0}));
 await assert.rejects(t.mutation(auth,{actorUserId,draftId,posterAssetId:source.posterAssetId}),/NOT_FOUND/);
 await assert.rejects(t.mutation(save,{actorUserId,draftId,expectedVersion:2,patch:{posterSourceId:source.posterAssetId}}),/NOT_FOUND/);
 assert.equal((await t.run(ctx=>ctx.db.query("eventIntakeModelAttempts").collect())).length,1);
});
it("replacement clears source suggestions while retaining accepted fields",async()=>{
 const{t,actorUserId,draftId}=await fixture();
 const make=()=>t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const first=await make(),second=await make();
 const save=makeFunctionReference<"mutation">("eventIntake:saveActorDraft");
 await t.mutation(save,{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId:first.posterAssetId}});
 await t.mutation(save,{actorUserId,draftId,expectedVersion:2,patch:{tentative:{title:"Extracted"},evidence:[{fieldPath:"event.title",origin:"poster",excerpt:null,assessment:"explicit"}],questions:["event.title: check"]}});
 await t.mutation(save,{actorUserId,draftId,expectedVersion:3,patch:{posterSourceId:second.posterAssetId}});
 const fields=(await t.run(ctx=>ctx.db.get(draftId)))?.fields;
 assert.equal(fields.title,"Night");assert.equal(fields.tentative,undefined);assert.equal(fields.evidence,undefined);assert.equal(fields.questions,undefined);
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
  } else await t.mutation(makeFunctionReference<"mutation">("eventIntake:saveActorDraft"),{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId:null}});
  const published=await t.mutation(makeFunctionReference<"mutation">("eventIntake:commitPublishIntake"),{actorUserId,draftId,expectedVersion:2,idempotencyKey:"publish"});
  const event=await t.run(ctx=>ctx.db.get(published.eventId));
  if(explicit){
   assert.equal(event?.posterImageUrl,`/api/v0/events/${published.eventId}/artwork/${artwork.artworkAssetId}`);
   const publicEvent=await t.query(makeFunctionReference<"query">("events:getPublicBySlug"),{slug:event!.slug!});
   assert.equal(publicEvent?.posterImageUrl,event?.posterImageUrl);
   const searchDoc=await t.run(ctx=>ctx.db.query("searchDocuments").first());
   assert.equal(searchDoc?.imageUrl,event?.posterImageUrl);
   assert.equal((await t.query(makeFunctionReference<"query">("eventIntakeSources:publicArtwork"),{artworkAssetId:artwork.artworkAssetId})).storageKey,artwork.storageKey);
   assert.equal(await t.query(makeFunctionReference<"query">("eventIntakeSources:publicArtwork"),{artworkAssetId:"not-a-convex-id"}),null);
   await t.run(ctx=>ctx.db.patch(published.eventId,{posterImageUrl:undefined}));
   assert.equal(await t.query(makeFunctionReference<"query">("eventIntakeSources:publicArtwork"),{artworkAssetId:artwork.artworkAssetId}),null);
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
 const duplicate=await t.run(ctx=>ctx.db.insert("eventIntakeDrafts",{actorUserId,version:1,fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true,summary:"Discarded text"},provenance:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000}));
 const discarded=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId:duplicate,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:discarded.posterAssetId,sha256:"a".repeat(64)});
 await t.mutation(makeFunctionReference<"mutation">("eventIntake:saveActorDraft"),{actorUserId,draftId:duplicate,expectedVersion:1,patch:{posterSourceId:null}});
 assert.equal((await t.mutation(commit,{actorUserId,draftId:duplicate,expectedVersion:2,idempotencyKey:"duplicate",classification:{draftId:duplicate,draftVersion:2,decision:"allow",reviewReason:"classifier_sample"}})).eventId,result.eventId);
 assert.equal((await t.run(ctx=>ctx.db.get(discarded.posterAssetId)))?.eventId,undefined);
 assert.equal((await t.run(ctx=>ctx.db.query("eventReports").collect())).length,1);
 assert.deepEqual(await t.mutation(commit,{...args,classification:{draftId,draftVersion:1,decision:"block"}}),result);
});

it("retires a published derivative after deselection or retraction", async () => {
 for (const change of ["deselect", "retract"] as const) {
 const {t,actorUserId,draftId}=await fixture();
 await t.run(async ctx=>{
  await ctx.db.insert("profiles",{slug:"club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});
  await ctx.db.patch(draftId,{fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true}});
 });
 process.env.EVENT_DATE_ONLY_ENABLED="true";
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1});
 await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100});
 const published=await t.mutation(makeFunctionReference<"mutation">("eventIntake:commitPublishIntake"),{actorUserId,draftId,expectedVersion:2,idempotencyKey:"artwork"});
 await t.run(ctx=>ctx.db.patch(selected.artworkAssetId,{expiresAt:0}));
 assert.deepEqual(await t.mutation(ref("claimAbandonedArtwork"),{}),[]);
 assert.ok((await t.run(ctx=>ctx.db.get(selected.artworkAssetId)))!.expiresAt>Date.now());
 await t.run(ctx=>ctx.db.patch(published.eventId,change==="deselect"?{posterImageUrl:undefined}:{publicationState:"draft_private"}));
 await t.run(ctx=>ctx.db.patch(selected.artworkAssetId,{expiresAt:0}));
 const [claim]=await t.mutation(ref("claimAbandonedArtwork"),{});
 assert.deepEqual(claim.storageKeys,[selected.storageKey]);
 assert.equal((await t.run(ctx=>ctx.db.get(published.eventId)))?.posterImageUrl,undefined);
 await t.mutation(ref("confirmArtworkDeletion"),{artworkAssetId:selected.artworkAssetId,token:claim.token});
 assert.equal((await t.run(ctx=>ctx.db.get(selected.artworkAssetId)))?.state,"expired");
 }
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

it("clears old artwork on replacement and processes the new singular poster", async () => {
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
 assert.equal((await read()).artworkSourceId,undefined);
 assert.equal((await read()).fields.posterSourceId,b);
 await select(b,3);
 assert.equal((await read()).artworkSourceId,b);
});

it("removes the only poster from an image-only draft and blocks late completions", async () => {
 const {t,actorUserId,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.run(ctx=>ctx.db.patch(draftId,{fields:{posterSourceId:source.posterAssetId}}));
 const complete=()=>t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 await complete();
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1,automatic:true});
 await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100,automatic:true});
 await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:2});
 const save=makeFunctionReference<"mutation">("eventIntake:saveActorDraft");
 await t.mutation(save,{actorUserId,draftId,expectedVersion:2,patch:{posterSourceId:null,posterDeclaration:null}});
 let cleared=await t.run(ctx=>ctx.db.get(draftId));
 assert.deepEqual(cleared?.fields,{posterSourceId:null});assert.equal(cleared?.artworkAssetId,undefined);assert.equal(cleared?.artworkIntentSourceId,undefined);
 await t.mutation(save,{actorUserId,draftId,expectedVersion:3,patch:{posterSourceId:null,sourceText:"Text only"}});
 await t.mutation(save,{actorUserId,draftId,expectedVersion:4,patch:{posterSourceId:null,tentative:{title:"Text suggestion"},evidence:[{fieldPath:"event.title",origin:"text",excerpt:"Text only",assessment:"explicit"}]}});
 const resumed=await t.run(ctx=>ctx.db.get(draftId));
 assert.equal(resumed?.fields.posterSourceId,null);assert.equal(resumed?.fields.tentative?.title,"Text suggestion");assert.equal(resumed?.fields.evidence?.length,1);
 assert.equal((await complete()).autoSourceId,undefined);
 assert.equal((await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:5,automatic:true})).skipped,true);
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:5,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(save,{actorUserId,patch:{}}),/meaningful/);
});
it("rejects an external draft edit during upload completion and automatic selection", async () => {
 const {t,actorUserId,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.run(ctx=>ctx.db.patch(draftId,{version:2,fields:{title:"Edited elsewhere"}}));
 await assert.rejects(t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64),expectedVersion:1}),/VERSION_CONFLICT/);
 assert.equal((await t.run(ctx=>ctx.db.get(source.posterAssetId)))?.state,"pending");
 const completed=await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64),expectedVersion:2});
 await t.run(ctx=>ctx.db.patch(draftId,{version:3,fields:{title:"Edited again"}}));
 await assert.rejects(t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:completed.version,automatic:true}),/VERSION_CONFLICT/);
 assert.deepEqual((await t.run(ctx=>ctx.db.get(draftId)))?.fields,{title:"Edited again"});
});

it("replays versioned completion after its own automatic artwork revision", async () => {
 const {t,actorUserId,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const args={actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64),expectedVersion:1};
 const completed=await t.mutation(ref("completePosterUpload"),args);
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:completed.version,automatic:true});
 await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100,automatic:true});
 const replay=await t.mutation(ref("completePosterUpload"),args);
 assert.equal(replay.version,2);
 assert.equal(replay.artworkAssetId,selected.artworkAssetId);
 const afterArtworkArgs={...args,expectedVersion:2};
 assert.equal((await t.mutation(ref("completePosterUpload"),afterArtworkArgs)).version,2);
 await t.run(ctx=>ctx.db.patch(draftId,{version:3,fields:{title:"Edited after artwork"}}));
 await assert.rejects(t.mutation(ref("completePosterUpload"),args),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(ref("completePosterUpload"),afterArtworkArgs),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(ref("completePosterUpload"),{...args,expectedVersion:3}),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:2,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:3,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 assert.deepEqual((await t.run(ctx=>ctx.db.get(draftId)))?.fields,{title:"Edited after artwork"});
});

it("replacement invalidates pending old artwork even at the latest version",async()=>{
 const {t,actorUserId,draftId}=await fixture();
 const make=()=>t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const old=await make(),current=await make();
 const save=makeFunctionReference<"mutation">("eventIntake:saveActorDraft");
 await t.mutation(save,{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId:old.posterAssetId}});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:old.posterAssetId,sha256:"a".repeat(64)});
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:old.posterAssetId,expectedVersion:2,automatic:true});
 await t.mutation(save,{actorUserId,draftId,expectedVersion:2,patch:{posterSourceId:current.posterAssetId}});
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:3,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 const completed=await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:current.posterAssetId,sha256:"a".repeat(64)});
 assert.equal(completed.autoSourceId,current.posterAssetId);
});
it("lets a pending explicit choice beat automatic completion and rejects foreign selection", async () => {
 const {t,actorUserId,other,draftId}=await fixture();
 const make=async()=>t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const first=await make(), second=await make();
 const otherDraft=await t.run(ctx=>ctx.db.insert("eventIntakeDrafts",{actorUserId,version:1,fields:{title:"Other"},provenance:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000}));
 const foreign=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId:otherDraft,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const complete=async(posterAssetId:string)=>t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId,sha256:"a".repeat(64)});
 await complete(first.posterAssetId);await complete(second.posterAssetId);await complete(foreign.posterAssetId);
 await assert.rejects(t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:foreign.posterAssetId,expectedVersion:1}),/POSTER_/);
 await assert.rejects(t.mutation(ref("selectPosterArtwork"),{actorUserId:other,draftId,posterAssetId:first.posterAssetId,expectedVersion:1}));
 const auto=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:first.posterAssetId,expectedVersion:1,automatic:true});
 const explicit=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:second.posterAssetId,expectedVersion:1});
 await assert.rejects(t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:auto.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100,automatic:true}),/VERSION_CONFLICT/);
 const selected=await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:explicit.artworkAssetId,expectedVersion:1,sha256:"c".repeat(64),byteLength:100});
 assert.equal(selected.version,2);
 assert.equal((await t.run(ctx=>ctx.db.get(draftId)))?.artworkAssetId,explicit.artworkAssetId);
});

it("does not let a late legacy completion replace a newer singular source", async () => {
 const {t,actorUserId,draftId}=await fixture();
 const make=async()=>t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 const old=await make(), current=await make();
 await t.mutation(makeFunctionReference<"mutation">("eventIntake:saveActorDraft"),{actorUserId,draftId,expectedVersion:1,patch:{posterSourceId:current.posterAssetId}});
 const completed=await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:old.posterAssetId,sha256:"a".repeat(64)});
 assert.equal(completed.autoSourceId,undefined);
 assert.equal((await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:old.posterAssetId,expectedVersion:completed.version,automatic:true})).skipped,true);
});

it("refuses publication if selected artwork is unrelated to the saved poster", async () => {
 process.env.EVENT_DATE_ONLY_ENABLED="true";
 const {t,actorUserId,draftId}=await fixture();
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1});
 await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100});
 await t.run(async ctx=>{
  await ctx.db.insert("profiles",{slug:"club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});
  await ctx.db.patch(draftId,{fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true,posterSourceId:null}});
 });
 await assert.rejects(t.mutation(makeFunctionReference<"mutation">("eventIntake:commitPublishIntake"),{actorUserId,draftId,expectedVersion:2,idempotencyKey:"stale-art"}),/ARTWORK_NOT_READY/);
 assert.equal((await t.run(ctx=>ctx.db.query("events").collect())).length,0);
});

it("does not publish while artwork preparation is unfinished", async () => {
 process.env.EVENT_DATE_ONLY_ENABLED="true";
 const {t,actorUserId,draftId}=await fixture();
 await t.run(async ctx=>{
  await ctx.db.insert("profiles",{slug:"club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});
  await ctx.db.patch(draftId,{fields:{title:"Night",communitySlug:"club",eventDate:"2027-10-15",timeTba:true}});
 });
 const source=await t.mutation(ref("beginPosterUpload"),{actorUserId,draftId,contentType:"image/png",byteLength:128,sha256:"a".repeat(64)});
 await t.mutation(ref("completePosterUpload"),{actorUserId,posterAssetId:source.posterAssetId,sha256:"a".repeat(64)});
 const selected=await t.mutation(ref("selectPosterArtwork"),{actorUserId,draftId,posterAssetId:source.posterAssetId,expectedVersion:1,automatic:true});
 const publish=makeFunctionReference<"mutation">("eventIntake:commitPublishIntake");
 await assert.rejects(t.mutation(publish,{actorUserId,draftId,expectedVersion:1,idempotencyKey:"pending"}),/ARTWORK_NOT_READY/);
 await t.mutation(ref("completeArtwork"),{actorUserId,artworkAssetId:selected.artworkAssetId,expectedVersion:1,sha256:"b".repeat(64),byteLength:100,automatic:true});
 assert.ok((await t.mutation(publish,{actorUserId,draftId,expectedVersion:2,idempotencyKey:"ready"})).eventId);
});
