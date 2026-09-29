import { execFileSync } from "node:child_process";
import { it } from "node:test";

it("serves current review image bytes through version-bound reviewer storage with private response headers", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { registerHooks, createRequire } from "node:module";
    import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { pathToFileURL } from "node:url";
    const { ConvexError } = createRequire(import.meta.url)("convex/values");
    import { getFunctionName } from "convex/server";
    const state=globalThis.reviewRoute={token:"session",queries:[],reads:[],record:{storageKey:"current",mimeType:"image/png",profileDisplayName:"Profile"}};
    const sources={
      "@/lib/server/auth":'export const convexAuthToken=async()=>globalThis.reviewRoute.token;',
      "@/lib/server/convex-http":'export const convexHttpClient=()=>({setAuth:token=>{globalThis.reviewRoute.auth=token;},query:async(ref,args)=>{const s=globalThis.reviewRoute;s.queries.push({ref,args});if(s.error)throw s.error;return s.record;}});',
      "@/lib/server/profile-asset-storage":'export const isProfileAssetStorageConfigured=()=>true; export const getProfileAssetObject=async key=>{globalThis.reviewRoute.reads.push(key);return {body:new Uint8Array([137,80,78,71]),contentLength:4};};',
    };
    const directory=mkdtempSync(join(tmpdir(),"vrdex-review-route-"));
    const mocks=Object.fromEntries(Object.entries(sources).map(([key,source],i)=>{const path=join(directory,"mock-"+i+".mjs");writeFileSync(path,source);return [key,{url:pathToFileURL(path).href,path}];}));
    registerHooks({resolve(specifier,context,next){return mocks[specifier]?{url:mocks[specifier].url,shortCircuit:true}:next(specifier,context);}});
    try {
    const {GET}=await import("./apps/web/src/app/api/account/media-review/submissions/[submissionId]/file/route.ts");
    const context={params:Promise.resolve({submissionId:"submission"})};
    const request=(query="?image=current&assetId=asset&reviewVersion=version")=>new Request("https://example.test/api/account/media-review/submissions/submission/file"+query);
    const response=await GET(request(),context);
    assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[137,80,78,71]);
    assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.match(response.headers.get("content-security-policy"),/sandbox/);
    assert.equal(state.auth,"session");assert.equal(getFunctionName(state.queries[0].ref),"profileMediaSubmissions:getCurrentForStorage");
    assert.deepEqual(state.queries[0].args,{submissionId:"submission",assetId:"asset",expectedReviewVersion:"version"});
    assert.deepEqual(state.reads,["current"]);
    state.record=null;assert.equal((await GET(request(),context)).status,404);assert.equal(state.reads.length,1);
    state.error=new ConvexError({code:"MEDIA_REVIEW_ACCESS_REQUIRED"});assert.equal((await GET(request(),context)).status,403);assert.equal(state.reads.length,1);
    delete state.error;
    assert.equal((await GET(request("?image=current"),context)).status,404);
    state.token=undefined;assert.equal((await GET(request(),context)).status,401);
    state.token="session";state.record={storageKey:"candidate",mimeType:"image/png",profileDisplayName:"Profile"};
    assert.equal((await GET(request(""),context)).status,200);
    assert.equal(getFunctionName(state.queries.at(-1).ref),"profileMediaSubmissions:getCandidateForStorage");
    } finally { for (const mock of Object.values(mocks)) unlinkSync(mock.path); rmdirSync(directory); }
  `], { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json" }, stdio: "pipe" });
});
