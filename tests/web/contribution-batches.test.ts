import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("returns the same item receipt for first URL submission and authorized cross-client retries", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import sharp from "sharp";
    import { convexTest } from "convex-test";

    import { schema, modules as baseModules, seed, NOW } from "./tests/backend/_mediaReviewFixture.ts";
    import { createMcpContributionHandlers } from "./apps/web/src/lib/server/mcp-contribution-batches.ts";
    import { createMcpMediaUploadHandlers } from "./apps/web/src/lib/server/mcp-media-upload.ts";
    import { profileAssetUploadChecksum } from "./apps/web/src/lib/server/profile-asset-storage.ts";
    process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED="true";
    process.env.VRDEX_CONTRIBUTION_UPLOADS_ENABLED="true";
    process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY="true";
    process.env.VRDEX_MEDIA_CLEANUP_URL="https://example.test/cleanup";
    process.env.VRDEX_MEDIA_CLEANUP_TOKEN="test";
    process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED="true";
    const modules={...baseModules,"../../convex/contributionBatches.ts":()=>import("./convex/contributionBatches.ts"),"../../convex/contributionUploads.ts":()=>import("./convex/contributionUploads.ts")};
    const t=convexTest({schema,modules}),s=await seed(t);
    for(const client of ["first","second"])await t.run(ctx=>ctx.db.insert("oauthAccessTokens",{tokenId:client+"-token",clientId:client,subjectType:"user",userId:s.contributorUserId,resource:"https://example.test/mcp",scopes:["mcp:write","mcp:read","assets:contribute"],status:"active",issuedAt:Date.now(),expiresAt:Date.now()+3600000}));
    let client="first",fetches=0;
    const authority=async()=>({actorUserId:s.contributorUserId,oauthClientId:client,oauthTokenId:client+"-token",emailVerified:true,emailVerificationAttestedAt:Date.now()});
    const bytes=await sharp({create:{width:8,height:8,channels:4,background:"red"}}).png().toBuffer();
    const objects=new Map();
    const admin={mutation:(fn,args)=>t.mutation(fn,args),query:(fn,args)=>t.query(fn,args)};
    const uploads=createMcpMediaUploadHandlers({authority,admin,fetchSource:async()=>{fetches++;return {body:bytes,mimeType:"image/png"};},put:async({storageKey,body})=>{objects.set(storageKey,body);},read:async key=>({body:objects.get(key),contentType:"image/png"})});
    const call=createMcpContributionHandlers({authority,admin,uploads});
    const batch=await call("create",{idempotencyKey:"batch",label:"Collection"});
    await call("append",{batchId:batch.batchId,items:[{kind:"media",itemKey:"image",source:{description:"Artist image",publication:"public_allowed"},profileId:s.profileId,expectedUpdatedAt:NOW,placement:"profile_image",transport:"url",sourceUrl:"https://example.test/image.png",credit:"Artist",contentType:"image/png",byteLength:bytes.length,sha256:profileAssetUploadChecksum(bytes)}]});
    const command={batchId:batch.batchId,itemKey:"image",expectedRevision:1};
    const first=await call("submit",command);
    assert.equal(first.operationState,"committed");
    assert.deepEqual(await call("submit",command),first);
    client="second";
    assert.deepEqual(await call("submit",command),first);
    assert.equal(fetches,1);
    const submissions=await t.run(ctx=>ctx.db.query("profileMediaSubmissions").collect());
    assert.equal(submissions.length,1);
    const attempt=await t.run(ctx=>ctx.db.query("contributionItemAttempts").unique());
    assert.deepEqual(first,attempt.receipt);
    const reservation=await t.run(ctx=>ctx.db.query("contributionUploadReservations").unique());
    assert.equal(reservation.receipt.operationId,String(reservation.intentId));
    assert.notEqual(first.operationId,reservation.receipt.operationId);
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
});


