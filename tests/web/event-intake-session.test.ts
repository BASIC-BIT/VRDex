import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { it } from "node:test";
it("binds website intake to the session, rejects forged actors and cross-origin writes, and keeps responses private", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import {createWebsiteEventIntakeHandler} from "./apps/web/src/lib/server/event-intake-session.ts";
    let actor = "session-actor", calls = 0;
    const handle=createWebsiteEventIntakeHandler({actor:async()=>actor,commands:id=>async(operation,input)=>{assert.equal(id,"session-actor"); calls++; if(input.draftId==="stale") throw Error("VERSION_CONFLICT"); return {operation};},readPoster:async(id,source)=>{assert.equal(id,"session-actor");return "data:image/webp;base64,AAAA";}});
    const request=(input,origin="https://app.test")=>new Request("https://app.test/api/event-intake",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(input)});
    let response=await handle(request({operation:"extract",input:{draftId:"draft",sourceText:"event"}}));
    assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"private, no-store"); assert.equal(calls,1);
    assert.equal((await handle(request({operation:"extract",input:{draftId:"draft",actorUserId:"forged"}}))).status,400);
    assert.equal((await handle(request({operation:"extract",input:{draftId:"draft"}},"https://evil.test"))).status,403);
    assert.equal((await handle(request({operation:"artwork_select",input:{draftId:"stale",posterAssetId:"poster",expectedVersion:1}}))).status,409);
    response=await handle(request({operation:"poster_read",input:{posterAssetId:"poster"}}));assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.equal((await handle(request({operation:"extract",input:{draftId:"draft",sourceText:"x".repeat(300000)}}))).status,413);
    const broken=createWebsiteEventIntakeHandler({actor:async()=>{throw Error("private auth failure");}});
    const failed=await broken(request({operation:"extract",input:{draftId:"draft"}}));assert.equal(failed.status,503);assert.equal(failed.headers.get("cache-control"),"private, no-store");assert.doesNotMatch(await failed.text(),/private auth/);
    actor=null;assert.equal((await handle(request({operation:"extract",input:{draftId:"draft"}}))).status,401);
  `], {encoding:"utf8",env:{...process.env,TSX_TSCONFIG_PATH:"apps/web/tsconfig.json"}});
});
