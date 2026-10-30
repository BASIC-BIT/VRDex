import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, cp, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root=process.cwd(), build=join(root,'apps/web/.next');
const traceFile=join(build,'server/app/api/v0/profiles/[slug]/assets/[assetId]/file/route.js.nft.json');
const trace=JSON.parse(await readFile(traceFile,'utf8'));
const logo=join(root,'docs/brand/wordmark/vrdex-wordmark.png');
assert(trace.files.some(file=>resolve(traceFile,'..',file)===logo),'production route trace must include canonical wordmark');
const scratch=await mkdtemp(join(tmpdir(),'mobile-media-artifact-'));
let child;
const portrait=await sharp({create:{width:512,height:512,channels:4,background:'#546478'}}).png().toBuffer();
let authorizationReads=0, objectReads=0, eligible=true;
const fixture=createServer(async(req,res)=>{
  if(req.url==='/pipeline'){
    let body='';for await(const part of req)body+=part;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(JSON.parse(body).map(command=>({result:command[0]==='PTTL'?60000:1}))));
  } else if(req.url==='/api/query'){
    let body='';for await(const part of req)body+=part;const query=JSON.parse(body);
    assert.equal(query.path,'profileAssets:getPublicAssetForStorage');authorizationReads++;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:'success',value:eligible?{nowPlayingEligible:true,revision:'1',storageKey:'fixture.png',mimeType:'image/png',byteSize:portrait.length}:null}));
  } else {objectReads++;res.writeHead(200,{'content-type':'image/png','content-length':portrait.length}).end(portrait);}
});
try {
  await cp(join(build,'standalone'),scratch,{recursive:true});
  const app=join(scratch,'apps/web');
  await cp(join(build,'static'),join(app,'.next/static'),{recursive:true});
  await cp(join(root,'apps/web/public'),join(app,'public'),{recursive:true});
  // Only traced docs may exist; source checkout fallback cannot satisfy this proof.
  const copiedLogo=await readFile(join(scratch,'docs/brand/wordmark/vrdex-wordmark.png'));
  assert.deepEqual(copiedLogo,await readFile(logo));
  assert.deepEqual(await readdir(join(scratch,'docs')),['brand']);
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
  const endpoint=`http://127.0.0.1:${fixture.address().port}`;
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  child=spawn(process.execPath,['server.js'],{cwd:app,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),CONVEX_URL:endpoint,NEXT_PUBLIC_CONVEX_URL:endpoint,CLERK_SECRET_KEY:'',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'',CONVEX_ADMIN_TOKEN:'',VRDEX_PROFILE_ASSET_ROLE_ARN:'',VRDEX_PROFILE_ASSET_BUCKET:'local-artifact-fixture',VRDEX_PROFILE_ASSET_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'local-fixture',AWS_SECRET_ACCESS_KEY:'local-fixture',AWS_SESSION_TOKEN:'',AWS_ENDPOINT_URL_S3:endpoint,VRDEX_RATE_LIMIT_STORE:'redis-rest',VRDEX_RATE_LIMIT_REDIS_REST_URL:endpoint,VRDEX_RATE_LIMIT_REDIS_REST_TOKEN:'local-fixture'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>{logs=(logs+b).slice(-4000);});child.stderr.on('data',b=>{logs=(logs+b).slice(-4000);});
  const origin=`http://127.0.0.1:${port}`;
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${origin}/brand/now-playing/neutral-wordmark-v1-512.png`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert(ready,logs);
  const neutral=await fetch(`${origin}/brand/now-playing/neutral-wordmark-v1-512.png`);assert.equal(neutral.status,200);assert.equal(neutral.headers.get('content-type'),'image/png');assert.match(neutral.headers.get('cache-control'),/public.*immutable/);assert.deepEqual(Buffer.from(await neutral.arrayBuffer()),await readFile(join(root,'apps/web/public/brand/now-playing/neutral-wordmark-v1-512.png')));
  const url=`${origin}/api/v0/profiles/dj/assets/asset/file?revision=1&brand=wordmark-v1-512`;
  const response=await fetch(url);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200,bytes.toString()+logs);assert.equal(response.headers.get('content-type'),'image/png');assert.equal((await sharp(bytes).metadata()).width,512);assert.equal(response.headers.get('cache-control'),'private, max-age=31536000, immutable');
  eligible=false;assert.equal((await fetch(url)).status,404,'cached derivative must reauthorize');assert.equal(objectReads,1);assert.equal(authorizationReads,2);
  console.log(JSON.stringify({trace:traceFile.replace(root+'/',''),canonicalLogoSha256:createHash('sha256').update(copiedLogo).digest('hex'),derivedPngSha256:createHash('sha256').update(bytes).digest('hex'),derivedBytes:bytes.length,authorizationReads,objectReads,neutralStatus:neutral.status,derivedStatus:response.status,deniedAfterCache:404,isolatedTracedTree:true,realProvider:false},null,2));
} finally {
  if(child&&child.exitCode===null){const closed=once(child,'close');child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),5000);await closed;clearTimeout(force);}
  fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(scratch,{recursive:true,force:true});
}
