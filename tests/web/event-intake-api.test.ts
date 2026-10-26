import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";

function probe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" },
  });
}
it("challenges for contribution scopes without granting owner tools", () => {
  probe(`import assert from "node:assert/strict";
    import {requiredHostedMcpScopesForToolNames} from "./apps/web/src/lib/server/vrdex-mcp.ts";
    assert.deepEqual(requiredHostedMcpScopesForToolNames(["vrdex_event_intake_publish"]), ["mcp:write","events:contribute"]);
    assert.deepEqual(requiredHostedMcpScopesForToolNames(["vrdex_event_intake_draft_get"]), ["mcp:read","events:contribute"]);
    assert.deepEqual(requiredHostedMcpScopesForToolNames(["vrdex_event_intake_event_get"]), ["mcp:read","events:contribute"]);
    assert.deepEqual(requiredHostedMcpScopesForToolNames(["vrdex_event_create"]), ["mcp:write","events:write"]);
  `);
});

it("shares actor-bound drafts, receipts and correction authority across website and adapters", () => {
  probe(`import assert from "node:assert/strict";
    import {convexTest} from "convex-test";
    import schemaModule from "./convex/schema.ts";
    import {api,internal} from "./convex/_generated/api.js";
    import {createEventIntakeCommands} from "./apps/web/src/lib/server/event-intake-api.ts";
    import {createVrdexMcpHandler} from "./apps/web/src/lib/server/vrdex-mcp.ts";
    import {makeFunctionReference} from "convex/server";
    import {convexToJson,jsonToConvex} from "convex/values";
    import {createApiTokenValue,hashApiTokenValue} from "./packages/api-contracts/src/tokens.ts";
    import {GET as getDraftRoute} from "./apps/web/src/app/api/v0/event-intake/[draftId]/route.ts";
    import {GET as getContributionRoute} from "./apps/web/src/app/api/v0/events/[slug]/contribution/route.ts";
    const schema=schemaModule.default??schemaModule;
    process.env.EVENT_DATE_ONLY_ENABLED="true";
    const t=convexTest({schema,modules:{
      "./convex/_generated/api.ts":()=>import("./convex/_generated/api.js"),
      "./convex/eventIntake.ts":()=>import("./convex/eventIntake.ts"),
      "./convex/eventCorrections.ts":()=>import("./convex/eventCorrections.ts"),
      "./convex/events.ts":()=>import("./convex/events.ts"),
      "./convex/mcpToolEvents.ts":()=>import("./convex/mcpToolEvents.ts"),
      "./convex/apiTokens.ts":()=>import("./convex/apiTokens.ts"),
    }});
    const [actorUserId,other]=await t.run(async ctx=>{
      const a=await ctx.db.insert("users",{clerkUserId:"intake-user"});const b=await ctx.db.insert("users",{clerkUserId:"other"});
      await ctx.db.insert("profiles",{slug:"public-club",displayName:"Club",sortName:"club",profileType:"community",community:{categoryTags:[]},aliases:[],tags:[],claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:Date.now()});return [a,b];
    });
    const admin={query:(ref,args)=>t.query(ref,args),mutation:(ref,args)=>t.mutation(ref,args),action:(ref,args)=>t.action(ref,args)};
    const commands=createEventIntakeCommands({actorUserId,admin});
    const handler=createVrdexMcpHandler({adminConvex:admin,verifyContributorEmail:async()=>{throw Error("Email gate must not run");}});
    const authInfo={token:"test",clientId:"client",scopes:["mcp:read","mcp:write","events:contribute"],extra:{subjectType:"user",userId:actorUserId,tokenId:"token",requestId:"request"}};
    async function call(name,args,auth=authInfo){const response=await handler.fetch(new Request("https://app.example.test/mcp",{method:"POST",headers:{accept:"application/json, text/event-stream","content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})}),{authInfo:auth});const text=await response.text();return JSON.parse(text.split(/\\r?\\n/).find(l=>l.startsWith("data: "))?.slice(6)??text).result;}
    const browser=t.withIdentity({subject:"intake-user",emailVerified:false});
    const saved=await browser.mutation(api.eventIntake.saveEventIntakeDraft,{patch:{communitySlug:"public-club",title:"Night",eventDate:"2027-10-15",timeTba:true}});
    process.env.CONVEX_URL="https://fixture.convex.cloud";process.env.CONVEX_ADMIN_TOKEN="fixture";process.env.VRDEX_API_TOKEN_PEPPER="fixture";process.env.VRDEX_RATE_LIMIT_STORE="memory";
    globalThis.fetch=async(url,init)=>{
      const target=new URL(String(url));assert.equal(target.hostname,"fixture.convex.cloud");
      const body=JSON.parse(init.body);const kind=target.pathname.split("/").at(-1);
      try { const value=await t[kind](makeFunctionReference(body.path),jsonToConvex(body.args[0]));return Response.json({status:"success",value:convexToJson(value)}); }
      catch(error){return Response.json({status:"error",errorMessage:error.message,...(error.data?{errorData:convexToJson(error.data)}:{})},{status:560});}
    };
    const parts=createApiTokenValue();const verifierHash=await hashApiTokenValue(parts.tokenValue,"fixture");
    await t.mutation(internal.apiTokens.createDeveloperTokenForApiOwner,{ownerUserId:actorUserId,label:"Intake",tokenPrefix:parts.tokenPrefix,verifierHash,scopes:["events:contribute"]});
    const getRoute=(token,url="https://app.example.test/api/v0/event-intake/"+saved.draftId)=>getDraftRoute(new Request(url,{headers:token?{authorization:"Bearer "+token}:{}}),{params:Promise.resolve({draftId:saved.draftId})});
    assert.equal((await getRoute()).status,401);
    assert.equal((await getRoute(null,"https://app.example.test/api/v0/event-intake/x?token=bad")).status,400);
    const apiRead=await getRoute(parts.tokenValue);assert.equal(apiRead.status,200);assert.equal((await apiRead.json()).draftId,saved.draftId);
    const malformedDraft=await getDraftRoute(new Request("https://app.example.test/api/v0/event-intake/not-a-convex-id",{headers:{authorization:"Bearer "+parts.tokenValue}}),{params:Promise.resolve({draftId:"not-a-convex-id"})});
    assert.equal(malformedDraft.status,400);
    const tokenId=await t.run(async ctx=>(await ctx.db.query("apiTokens").first())._id);
    await t.run(ctx=>ctx.db.patch(tokenId,{scopes:["events:write"]}));assert.equal((await getRoute(parts.tokenValue)).status,403);
    await t.run(ctx=>ctx.db.patch(tokenId,{scopes:["events:contribute"],ownerKind:"community"}));assert.equal((await getRoute(parts.tokenValue)).status,403);
    await t.run(ctx=>ctx.db.patch(tokenId,{ownerKind:"user",ownerUserId:other}));assert.equal((await getRoute(parts.tokenValue)).status,403);
    assert.equal((await commands("draft_get",{draftId:saved.draftId})).version,1);
    assert.equal((await call("vrdex_event_intake_draft_get",{draftId:saved.draftId})).structuredContent.draftId,saved.draftId);
    for(const scopes of [[],["mcp:read"],["events:contribute"],["mcp:read","events:write"]]) assert.equal((await call("vrdex_event_intake_draft_get",{draftId:saved.draftId},{...authInfo,scopes})).isError,true);
    assert.equal((await call("vrdex_event_intake_draft_get",{draftId:saved.draftId},{...authInfo,extra:{...authInfo.extra,subjectType:"client"}})).isError,true);
    assert.equal((await call("vrdex_event_create",{title:"No owner access",communitySlug:"public-club",startAt:Date.now()+86400000})).isError,true);
    await assert.rejects(createEventIntakeCommands({actorUserId:other,admin})("draft_get",{draftId:saved.draftId}));
    await assert.rejects(commands("draft_save",{patch:{title:"forged"},actorUserId:other}));
    const args={draftId:saved.draftId,expectedVersion:1,idempotencyKey:"once"};
    const first=(await call("vrdex_event_intake_publish",args)).structuredContent;
    assert.ok(first?.receiptId);assert.deepEqual(await commands("publish",args),first);
    const nearDraft=await browser.mutation(api.eventIntake.saveEventIntakeDraft,{patch:{communitySlug:"public-club",title:"Night Dance",eventDate:"2027-10-15",timeTba:true}});
    const near=await call("vrdex_event_intake_publish",{draftId:nearDraft.draftId,expectedVersion:1,idempotencyKey:"near"});
    assert.equal(near.isError,true);assert.match(near.content[0].text,/Near duplicate/);assert.match(near.content[0].text,/Night/);assert.doesNotMatch(near.content[0].text,/COMMAND_OUTCOME_UNKNOWN/);
    assert.deepEqual((await t.run(ctx=>ctx.db.query("eventAuditEvents").collect())).map(row=>[row.action,row.actorSurface]),[["created","mcp"]]);
    assert.deepEqual((await call("vrdex_event_intake_publish",args)).structuredContent,first);
    const refused=await call("vrdex_event_intake_draft_save",{draftId:saved.draftId,expectedVersion:1,patch:{title:"Late edit"}});
    assert.equal(refused.isError,true);
    assert.equal(refused.structuredContent?.isError,undefined);
    const read=await commands("draft_get",{draftId:saved.draftId});assert.equal(read.publishedReceiptId,first.receiptId);
    assert.equal((await t.run(ctx=>ctx.db.query("events").collect())).length,1);
    const event=await t.run(ctx=>ctx.db.get(first.eventId));
    await t.run(ctx=>ctx.db.patch(tokenId,{ownerKind:"user",ownerUserId:actorUserId,scopes:["events:contribute"]}));
    const routeRead=await getContributionRoute(new Request("https://app.example.test/api/v0/events/"+event.slug+"/contribution",{headers:{authorization:"Bearer "+parts.tokenValue}}),{params:Promise.resolve({slug:event.slug})});
    assert.equal(routeRead.status,200);assert.equal((await routeRead.json()).updatedAt,event.updatedAt);
    const contribution=await commands("event_get",{slug:event.slug});
    assert.equal(contribution.updatedAt,event.updatedAt);assert.equal(contribution.fields.title,"Night");
    assert.equal((await call("vrdex_event_intake_event_get",{slug:event.slug})).structuredContent.updatedAt,event.updatedAt);
    await assert.rejects(createEventIntakeCommands({actorUserId:other,admin})("event_get",{slug:event.slug}));
    await commands("event_update",{slug:event.slug,expectedUpdatedAt:contribution.updatedAt,patch:{title:"Corrected"}});
    assert.equal((await t.run(ctx=>ctx.db.get(first.eventId))).title,"Corrected");
    await assert.rejects(createEventIntakeCommands({actorUserId:other,admin})("event_retract",{slug:event.slug}));
    await commands("event_retract",{slug:event.slug});assert.equal((await t.run(ctx=>ctx.db.get(first.eventId))).publicationState,"draft_private");
    assert.deepEqual(await commands("event_retract",{slug:event.slug}),{eventId:first.eventId,changed:false});
    await assert.rejects(createEventIntakeCommands({actorUserId:other,admin})("event_retract",{slug:event.slug}));
    await handler.close();
  `);
});

it("rejects a poster completion bound to another draft", () => {
  probe(`import assert from "node:assert/strict";
    import {createEventIntakeCommands} from "./apps/web/src/lib/server/event-intake-api.ts";
    const run=createEventIntakeCommands({actorUserId:"actor",admin:{query:async()=>({draftId:"other-draft"}),mutation:async()=>{throw Error("unexpected storage mutation");},action:async()=>null}});
    await assert.rejects(run("poster_upload_complete",{draftId:"draft",posterAssetId:"poster"}),/POSTER_DRAFT_MISMATCH/);
    await assert.rejects(run("poster_upload_begin",{draftId:"draft",sourceUrl:"https://internal.example/",contentType:"image/png",byteLength:1,sha256:"a".repeat(64)}));
  `);
});
it("rejects the removed artwork clearing command shape", () => {
  probe(`import assert from "node:assert/strict";
    import {SelectEventArtworkSchema} from "./packages/api-contracts/src/event-intake.ts";
    assert.equal(SelectEventArtworkSchema.safeParse({draftId:"draft",posterAssetId:null,expectedVersion:3}).success,false);
  `);
});
it("forwards singular text and poster extraction sources to actor authorization", () => {
  probe(`import assert from "node:assert/strict";
    import {createEventIntakeCommands} from "./apps/web/src/lib/server/event-intake-api.ts";
    process.env.VRDEX_EVENT_INTAKE_AI_ENABLED="false";process.env.OPENAI_API_KEY="";
    const calls=[];
    const run=createEventIntakeCommands({actorUserId:"actor",admin:{query:async()=>{throw Error("unexpected query");},mutation:async(_ref,args)=>{calls.push(args);return {actorUserId:"actor",version:1};},action:async()=>{throw Error("unexpected action");}}});
    await run("extract",{draftId:"draft",sourceText:"Night",posterAssetId:"a"});
    await run("extract",{draftId:"draft",posterAssetId:"a"});
    assert.deepEqual(calls.map(({posterAssetId})=>posterAssetId),["a","a"]);
    assert.ok(calls.every(call=>call.actorUserId==="actor"&&call.reserveQuota===false));
  `);
});

it("returns an OAuth scope challenge for intake writes and private readback", () => {
  probe(`import assert from "node:assert/strict";
    import {generateKeyPairSync} from "node:crypto";
    import {signOAuthAccessToken,createOAuthAccessTokenId} from "./apps/web/src/lib/server/oauth-jwt.ts";
    import {authorizeHostedMcpRequest} from "./apps/web/src/lib/server/vrdex-mcp.ts";
    const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
    process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY=privateKey.export({format:"pem",type:"pkcs8"}).toString();
    process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID="test";process.env.VRDEX_RATE_LIMIT_STORE="memory";
    const resource="https://app.example.test/mcp",clientId="vrdx_app_0123456789abcdef01234567";
    for(const name of ["vrdex_event_intake_publish","vrdex_event_intake_draft_get"]){
      const now=Math.floor(Date.now()/1000),tokenId=createOAuthAccessTokenId();
      const token=signOAuthAccessToken({aud:resource,client_id:clientId,exp:now+60,iat:now,iss:"https://app.example.test",jti:tokenId,scope:"mcp:read mcp:write events:write",sub:"user"});
      const result=await authorizeHostedMcpRequest(new Request(resource,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:{draftId:"draft"}}})}));
      assert.equal(result.response.status,403);assert.match(result.response.headers.get("www-authenticate"),/events:contribute/);
    }
  `);
});

it("serves only the selected public artwork for the requested event", () => {
  probe(`import assert from "node:assert/strict";
    import {readEventArtwork} from "./apps/web/src/lib/server/event-intake-api.ts";
    let visibility={eventId:"event",storageKey:"derived-art",contentType:"image/webp",byteLength:3};let reads=0;
    const deps={query:async()=>visibility,read:async key=>{assert.equal(key,"derived-art");reads++;return {body:new Uint8Array([1,2,3]),contentType:"image/webp"};}};
    assert.equal((await readEventArtwork("wrong","art",deps)).status,404);assert.equal(reads,0);
    const good=await readEventArtwork("event","art",deps);assert.equal(good.status,200);assert.equal(good.headers.get("cache-control"),"private, no-store");
    visibility=null;assert.equal((await readEventArtwork("event","art",deps)).status,404);assert.equal(reads,1);
  `);
});

it("retains bounded duplicate choices and distinguishes a lost response from invalid input", () => {
  probe(`import assert from "node:assert/strict";
    import {ConvexError} from "convex/values";
    import {eventIntakeErrorResponse} from "./apps/web/src/lib/server/event-intake-api.ts";
    const duplicate=eventIntakeErrorResponse(new ConvexError({code:"NEAR_DUPLICATE",choices:[{eventId:"event",title:"Existing night",eventPath:"/events/night"}]}));
    assert.equal(duplicate.status,409);assert.match((await duplicate.json()).detail,/Existing night/);
    const lost=eventIntakeErrorResponse(new Error("secret transport exception"));assert.equal(lost.status,503);assert.doesNotMatch(await lost.text(),/secret/);
    assert.equal(eventIntakeErrorResponse(new ConvexError({code:"DUPLICATE_EVENT",eventId:"event"})).status,409);
    assert.equal(eventIntakeErrorResponse(new Error("DRAFT_PUBLISHED")).status,409);
    assert.equal(eventIntakeErrorResponse(new RangeError("Invalid time zone specified: Not/AZone")).status,400);
    assert.equal(eventIntakeErrorResponse(new Error("Lineup match must be a published public person.")).status,400);
    assert.equal(eventIntakeErrorResponse(new Error("Lineup keys and positions must be unique.")).status,400);
    assert.equal(eventIntakeErrorResponse(new Error('Validator error: Expected ID for table "eventIntakeDrafts", got bad-id')).status,400);
    assert.equal(eventIntakeErrorResponse(new Error("Source URL must be a safe HTTPS URL.")).status,400);
    assert.equal(eventIntakeErrorResponse(new Error("Set end time requires an earlier start time.")).status,400);
    assert.equal(eventIntakeErrorResponse(new Error("EXTRACTION_INPUT_INVALID")).status,400);
  `);
});

it("returns a bad request for malformed report JSON", () => {
  probe(`import assert from "node:assert/strict";
    import {reportEventRequest} from "./apps/web/src/lib/server/event-intake-api.ts";
    const response=await reportEventRequest(new Request("https://app.example.test/api/v0/events/night/report",{method:"POST",headers:{"content-type":"application/json"},body:"{"}),"night");
    assert.equal(response.status,400);
  `);
});
