/** Local TLS/browser boundary driven by the actual mock-provider production-module plan. No AWS proof. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { generateKeyPairSync, verify } from "node:crypto";
import { chromium } from "../apps/web/node_modules/@playwright/test/index.mjs";
import { createSegmentSigner } from "../packages/media-relay/src/gateway/signing";
async function main() {
const [planPath, evidencePath] = process.argv.slice(2);
if (!planPath || !evidencePath) throw Error("Supply Terraform test JSONL and evidence destination");
const rows = (await readFile(planPath,"utf8")).trim().split('\n').map(line=>JSON.parse(line));
assert.equal(rows.find(row=>row.test_summary)?.test_summary.status,'pass');
const plan = rows.find(row=>row['@testrun']==='enabled_private_scoped' && row.test_plan).test_plan;
const resource = (type: string) => plan.resource_changes.find((row: {type:string})=>row.type===type).change;
const distribution = resource('aws_cloudfront_distribution');
const cors = resource('aws_cloudfront_response_headers_policy').after.cors_config[0];
const behavior = distribution.after.default_cache_behavior[0];
assert.equal(distribution.after_unknown.default_cache_behavior[0].response_headers_policy_id,true);
assert.match(await readFile('infra/terraform/media-relay/main.tf','utf8'),/response_headers_policy_id\s*=\s*aws_cloudfront_response_headers_policy\.media\[0\]\.id/);
assert.equal(behavior.trusted_key_groups.length,1);
const cache = resource('aws_cloudfront_cache_policy').after.parameters_in_cache_key_and_forwarded_to_origin[0];
for (const [key, field] of [['headers_config','header_behavior'],['cookies_config','cookie_behavior'],['query_strings_config','query_string_behavior']]) assert.equal(cache[key][0][field],'none');
assert.deepEqual(cors.access_control_allow_methods[0].items,['GET','HEAD']);
assert.equal(cors.access_control_allow_credentials,false); assert.equal(cors.origin_override,true);
const origins: string[] = cors.access_control_allow_origins[0].items;
const configured = plan.output_changes.runtime_config_review.after.gateway.origins;
assert.deepEqual([...origins].sort(),[...configured].sort());
const scratch = await mkdtemp(`${tmpdir()}/relay-cors-`);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${scratch}/key.pem`,'-out',`${scratch}/cert.pem`,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const bytes=Buffer.alloc(188*3,0x47); // TS-shaped fixture bytes; this check proves CORS/readability, not decoding.
  let reads=0;
  server=createServer({key:await readFile(`${scratch}/key.pem`),cert:await readFile(`${scratch}/cert.pem`)},(req,res)=>{
    if(req.url === '/') { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<!doctype html><title>CORS boundary</title>'); return; }
    const origin=req.headers.origin;
    if(origin && origins.includes(origin)) res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Expose-Headers',cors.access_control_expose_headers[0].items.join(', '));
    const url=new URL(req.url!,`https://${req.headers.host}`), expires=Number(url.searchParams.get('Expires'));
    const signature=Buffer.from((url.searchParams.get('Signature')??'').replace(/-/g,'+').replace(/_/g,'=').replace(/~/g,'/'),'base64');
    const keyId=url.searchParams.get('Key-Pair-Id'); url.search='';
    const policy=JSON.stringify({Statement:[{Resource:url.href,Condition:{DateLessThan:{'AWS:EpochTime':expires}}}]});
    if(keyId!=='LOCALKEY' || expires*1000<=Date.now() || !verify('RSA-SHA1',Buffer.from(policy),publicKey,signature)) {res.writeHead(403);res.end();return;}
    reads++;res.writeHead(200,{'Content-Type':'video/mp2t','Content-Length':bytes.length,'Accept-Ranges':'bytes'});res.end(req.method==='HEAD'?undefined:bytes);
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address(); assert.ok(address && typeof address!=='string');
  const sign=createSegmentSigner({origin:`https://127.0.0.1:${address.port}`,keyPairId:'LOCALKEY',privateKey:privateKey.export({type:'pkcs8',format:'pem'}).toString(),clock:Date.now});
  const signed=sign({objectKey:'vrcdn/Alpha/1/epochs/1/attempt-1-abc/video-0.ts',expiresAt:Date.now()+301000});
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  await context.grantPermissions(['local-network-access']);
  const results=[];
  for(const origin of [...origins,'https://unreviewed.invalid']) {
    const page=await context.newPage();
    await page.route(`${origin}/`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>CORS boundary</title>'}));
    await page.goto(`${origin}/`);
    const observed=await page.evaluate(async url=>{
      try { const response=await fetch(url); const body=await response.arrayBuffer(); const head=await fetch(url,{method:'HEAD'}); const unsigned=await fetch(url.split('?')[0]);return {status:response.status,bytes:body.byteLength,head:head.status,length:head.headers.get('content-length'),unsigned:unsigned.status}; }
      catch {return {blocked:true};}
    },signed);
    if(origins.includes(origin)) assert.deepEqual(observed,{status:200,bytes:bytes.length,head:200,length:String(bytes.length),unsigned:403});
    else assert.deepEqual(observed,{blocked:true});
    results.push({origin,...observed});await page.close();
  }
  await writeFile(evidencePath,JSON.stringify({proof:'local TLS Chromium segment fetch using emitted production-module CORS policy; not AWS',cors,results,authorizedReads:reads,hostedSmoke:'OPEN'},null,2)+'\n');
  console.log(JSON.stringify({result:'PASS',origins:origins.length,unauthorizedOriginBlocked:true,signedAccessPreserved:true}));
} finally {
  await browser?.close();
  if(server) await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await rm(scratch,{recursive:true,force:true});
}

}
void main();
