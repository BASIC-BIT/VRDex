import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("classifies contribution HTTP calls and challenges callbacks without requiring alternative grants", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { generateKeyPairSync } from "node:crypto";
    import { ConvexError } from "convex/values";
    import { authorizeHostedMcpRequest, createVrdexMcpHandler, mcpToolCallNamesFromRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";
    import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
    process.env.VRDEX_RATE_LIMIT_STORE = "memory";
    const resource = "https://app.example.test/mcp", clientId = "client";
    const media = { kind:"media", itemKey:"image", source:{ description:"Original", publication:"public_allowed" },
      profileId:"profile", expectedUpdatedAt:1, placement:"profile_image", transport:"local", credit:"Artist",
      contentType:"image/png", byteLength:512, sha256:"a".repeat(64) };
    const links = { kind:"profile_links", itemKey:"links", source:media.source, profileId:"profile", expectedUpdatedAt:1, links:[] };
    const upload = { mode:"contributor", profileId:"profile", expectedUpdatedAt:1, placement:"profile_image", contentType:"image/png",
      byteLength:512, sha256:"a".repeat(64), credit:"Artist", sourceDescription:"Original", idempotencyKey:"begin" };
    const cases = [
      ["vrdex_get_my_media_submission", {submissionId:"submission"}, "mcp:read", ["assets:contribute"]],
      ["vrdex_media_review_assignments", {}, "mcp:read", ["assets:review:read"]],
      ...["capacity","capacity_requests","status","batch_get","batch_items"].map(suffix => ["vrdex_contribution_"+suffix,
        suffix.startsWith("batch") ? {batchId:"batch"} : {}, "mcp:read", ["assets:contribute","profile:contribute","assets:review:read"]]),
      ["vrdex_contribution_batch_create", {idempotencyKey:"new",label:"Collection"}, "mcp:write", ["assets:contribute","profile:contribute"]],
      ["vrdex_contribution_batch_archive", {batchId:"batch"}, "mcp:write", ["assets:contribute","profile:contribute"]],
      ["vrdex_contribution_capacity_request", {key:"request",kind:"trusted_contributor",evidence:"https://example.test",reason:"collection"}, "mcp:write", ["assets:contribute","profile:contribute"]],
      ["vrdex_contribution_item_submit", {batchId:"batch",itemKey:"image",expectedRevision:1}, "mcp:write", ["assets:contribute","profile:contribute"]],
      ["vrdex_contribution_batch_append", {batchId:"batch",items:[media]}, "mcp:write", ["assets:contribute"]],
      ["vrdex_contribution_batch_append", {batchId:"batch",items:[links]}, "mcp:write", ["profile:contribute"]],
      ["vrdex_contribution_batch_append", {batchId:"batch",items:[media,links]}, "mcp:write", ["assets:contribute profile:contribute"]],
      ["vrdex_contribution_item_revise", {batchId:"batch",itemKey:"image",expectedRevision:1,item:media}, "mcp:write", ["assets:contribute"]],
      ["vrdex_media_upload_begin", upload, "mcp:write", ["assets:contribute"]],
      ["vrdex_media_upload_begin", {...upload,mode:"owner"}, "mcp:write", ["assets:write"]],
      ["vrdex_media_upload_complete", {intentId:"intent",idempotencyKey:"complete"}, "mcp:write", ["assets:contribute","assets:write"]],
    ];
    let callId=0;
    function request(name,args,token) { const call=(name,args)=>({jsonrpc:"2.0",id:++callId,method:"tools/call",params:{name,arguments:args}}); return new Request(resource,{method:"POST",headers:{accept:"application/json, text/event-stream","content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(Array.isArray(name)?name.map(([n,a])=>call(n,a)):call(name,args))}); }
    async function authorize(name,args,scope) {
      const now=Math.floor(Date.now()/1000), tokenId=createOAuthAccessTokenId();
      const token=signOAuthAccessToken({aud:resource,client_id:clientId,exp:now+60,iat:now,iss:"https://app.example.test",jti:tokenId,scope,sub:"user"});
      return authorizeHostedMcpRequest(request(name,args,token), {validateAccessTokenRecord:async input=>{
        assert.ok(input.requiredScopes.every(s=>scope.split(" ").includes(s)), JSON.stringify(input));
        return {ok:true,accessTokenRecordId:"record",clientId,resource,scopes:scope.split(" "),subjectType:"user",userId:"user",tokenId,trustTier:"standard"};
      }});
    }
    for(const [name,args,transport,alternatives] of cases) {
      assert.deepEqual(await mcpToolCallNamesFromRequest(request(name,args)),[name]);
      const missing=await authorize(name,args,transport);
      assert.equal(missing.response?.status,403,name);
      assert.match(missing.response.headers.get("www-authenticate"),/insufficient_scope/);
      for(const scopes of alternatives) {
        const result=await authorize(name,args,transport+" "+scopes);
        assert.equal(result.response,null,name+" "+scopes);
        let allowedCalls=0;
        const receipt={operationId:"op",operationState:"committed"};
        const handler=createVrdexMcpHandler({authInfo:{token:"token",clientId,scopes:[transport,...scopes.split(" ")],resource:new URL(resource),extra:{subjectType:"user",userId:"user",tokenId:"token",requestId:"request"}},verifyContributorEmail:async()=>true,
          adminConvex:{query:async()=>{allowedCalls++;return {page:[],isDone:true,continueCursor:""};},mutation:async()=>{allowedCalls++;return {...receipt,receipt};}}});
        const body=await (await handler.fetch(request(name,args))).text();
        assert.ok(allowedCalls>0,name+" "+scopes);
        assert.ok(!body.includes("insufficient_scope"),body);
        await handler.close();
      }
      let calls=0;
      const authInfo={token:"token",clientId,scopes:[transport],resource:new URL(resource),extra:{subjectType:"user",userId:"user",tokenId:"token",requestId:"request"}};
      const handler=createVrdexMcpHandler({authInfo,verifyContributorEmail:async()=>true,adminConvex:{query:async()=>{calls++;return null;},mutation:async()=>{calls++;return {operationId:"op",operationState:"committed"};}}});
      const response=await handler.fetch(request(name,args));
      const body=await response.text();
      assert.equal(calls,0,name);
      assert.match(body,/insufficient_scope/,name);
      await handler.close();
    }
    for(const [name,args,wrong] of [
      ["vrdex_contribution_batch_append",{batchId:"batch",items:[links]},"assets:contribute"],
      ["vrdex_media_upload_begin",upload,"assets:write"],
      ["vrdex_media_upload_begin",{...upload,mode:"owner"},"assets:contribute"],
    ]) assert.equal((await authorize(name,args,"mcp:write "+wrong)).response?.status,403,name);
    const mixed=[["vrdex_contribution_batch_append",{batchId:"batch",items:[media,links]}],["vrdex_media_review_assignments",{}]];
    assert.equal((await authorize(mixed,{},"mcp:write mcp:read assets:contribute assets:review:read")).response?.status,403);
    const mixedAllowed=await authorize(mixed,{},"mcp:write mcp:read assets:contribute profile:contribute assets:review:read");
    assert.equal(mixedAllowed.response,null,mixedAllowed.response && (mixedAllowed.response.status+" "+await mixedAllowed.response.text()));
    const anonymous=await authorizeHostedMcpRequest(request("vrdex_media_upload_begin",{...upload,mode:"owner"}));
    assert.equal(anonymous.response?.status,401);
    assert.match(anonymous.response.headers.get("www-authenticate"),/assets:write/);
    // Stored revision kind / upload mode is authoritative when the caller supplies only an ID.
    for (const [name,args,scope,requiredScope] of [
      ["vrdex_contribution_item_submit",{batchId:"batch",itemKey:"links",expectedRevision:1},"assets:contribute","profile:contribute"],
      ["vrdex_media_upload_complete",{intentId:"intent",idempotencyKey:"complete"},"assets:write","assets:contribute"],
    ]) {
      const handler=createVrdexMcpHandler({authInfo:{token:"token",clientId,scopes:["mcp:write",scope],resource:new URL(resource),extra:{subjectType:"user",userId:"user",tokenId:"token",requestId:"request"}},verifyContributorEmail:async()=>true,
        adminConvex:{query:async()=>null,mutation:async()=>{throw new ConvexError({code:name.includes("upload")?"UPLOAD_DELEGATION_DENIED":"BATCH_DELEGATION_DENIED",requiredScope});}}});
      const body=await (await handler.fetch(request(name,args))).text();
      assert.match(body,/insufficient_scope/); assert.ok(body.includes(requiredScope)); await handler.close();
    }
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
});
