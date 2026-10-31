import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root=process.cwd();
const scratch=await mkdtemp(path.join(tmpdir(),'vrdex-artwork-route-'));
const output=path.join(scratch,'route.mjs');
await build({ entryPoints:[root+'/apps/web/src/app/api/v0/profiles/[slug]/assets/[assetId]/file/route.ts'], outfile:output, bundle:true, platform:'node', format:'esm', packages:'external', plugins:[{name:'local-fixture',setup(b){
b.onResolve({filter:/^@convex-generated-api$/},()=>({path:'api',namespace:'fixture'}));
b.onResolve({filter:/^@\/lib\/server\//},a=> {
if(a.path.endsWith('/convex-http'))return {path:'convex',namespace:'fixture'};
if(a.path.endsWith('/profile-asset-storage'))return {path:'storage',namespace:'fixture'};
if(a.path.endsWith('/api-v0'))return {path:'boundary',namespace:'fixture'};
return {path:path.join(root,'apps/web/src',a.path.slice(2)+'.ts'),external:true};
});
b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents: a.path==='api'?'export const api={profileAssets:{getPublicAssetForStorage:"asset"}}':a.path==='convex'?'export const convexHttpClient=()=>({query:async()=>globalThis.__task10Asset})':a.path==='storage'?'export const isProfileAssetStorageConfigured=()=>true; export const getProfileAssetObject=async()=>({body:globalThis.__task10Bytes})':'export const rejectBearerTokenQuery=()=>null; export const rejectInvalidOrRateLimitedPublicApiRequest=async()=>null;',loader:'js'}));
}}]});

import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import sharp from 'sharp';
const { GET } = await import(pathToFileURL(output).href);
// Match the Next web app launch directory when loading the traced canonical logo.
process.chdir(path.join(root, 'apps/web'));
globalThis.__task10Bytes=await sharp({create:{width:512,height:512,channels:4,background:'#546478'}}).png().toBuffer();
globalThis.__task10Asset={nowPlayingEligible:true,revision:'1',storageKey:'fixture',mimeType:'image/png',byteSize:globalThis.__task10Bytes.length};
const server=createServer(async(req,res)=>{try {const response=await GET(new Request('http://localhost'+req.url),{params:Promise.resolve({slug:'dj',assetId:'asset'})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
const address=server.address(); assert.ok(address&&typeof address!=='string');
const url=`http://127.0.0.1:${address.port}/api/v0/profiles/dj/assets/asset/file?revision=1&brand=wordmark-v1-512`;
const first=await fetch(url); assert.equal(first.status,200); assert.equal(first.headers.get('cache-control'),'private, max-age=31536000, immutable'); assert.equal(first.headers.get('content-type'),'image/png');
const bytes=Buffer.from(await first.arrayBuffer()); assert.equal((await sharp(bytes).metadata()).width,512);
for(const replacement of [null,{...globalThis.__task10Asset,nowPlayingEligible:false},{...globalThis.__task10Asset,revision:'2'}]){globalThis.__task10Asset=replacement;assert.equal((await fetch(url)).status,404);}

}finally{await new Promise(resolve=>server.close(()=>resolve())); await rm(scratch,{recursive:true,force:true});}
