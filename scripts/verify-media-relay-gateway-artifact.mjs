import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const [zip,evidencePath]=process.argv.slice(2);
if(!zip || !evidencePath) throw Error('Supply actual packaged gateway ZIP and evidence destination');
const scratch=await mkdtemp(`${tmpdir()}/relay-gateway-artifact-`);
let server;
const originalFetch=globalThis.fetch,originalNow=Date.now;
const originalEnv={...process.env};
try {
  execFileSync('unzip',['-q',zip,'-d',scratch]);
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let now=originalNow(), current, secrets=0, reads=0, demands=0;
  Date.now=()=>now;
  server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req) body+=chunk;
    const target=req.headers['x-amz-target']??'';
    res.setHeader('Content-Type','application/json');
    if(target.includes('GetSecretValue')) {secrets++;res.end(JSON.stringify({SecretString:JSON.parse(body).SecretId.includes('signer')?privateKey.export({type:'pkcs8',format:'pem'}).toString():'local-control-fixture'}));}
    else if(target.includes('UpdateItem')) {demands++;res.end('{}');}
    else if(req.method==='GET') {reads++;res.end(JSON.stringify(current.snapshot));}
    else {res.statusCode=400;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  // These credentials and endpoint exist only in this proof process and address a local fake AWS API.
  process.env.AWS_ACCESS_KEY_ID='local-fixture';process.env.AWS_SECRET_ACCESS_KEY='local-fixture';delete process.env.AWS_SESSION_TOKEN;
  process.env.AWS_ENDPOINT_URL=endpoint;process.env.AWS_EC2_METADATA_DISABLED='true';
  process.env.MEDIA_RELAY_CONFIG=JSON.stringify({version:1,enabled:true,region:'us-east-1',controlUrl:'https://control.invalid',credentialRef:'arn:aws:secretsmanager:us-east-1:123456789012:secret:gateway',bucket:'local-bucket',demandTable:'local-demand',globalSourceCap:1,gatewayConcurrency:2,admissionPerMinute:10,trafficGiBPerMonth:1,releaseEvidence:'synthetic-artifact-only',origins:['https://app.invalid'],distributionOrigin:'https://media.invalid',signingKeyId:'LOCALKEY',signingKeyRef:'arn:aws:secretsmanager:us-east-1:123456789012:secret:signer'});
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://control.invalid/api/query');
    const request=JSON.parse(options.body);assert.equal(request.path,'mediaRelayWorker:readGateway');assert.equal(request.args.credential,'local-control-fixture');
    return Response.json({status:'success',value:current});
  };
  const {handler}=await import(pathToFileURL(`${scratch}/gateway.mjs`).href);
  const statuses=[];
  for(let i=0;i<6;i++) {
    now+=181000;
    const streamKey=`vrcdn/Source${i}/1`;
    const snapshot={streamKey,epoch:1,rendition:'video',targetDurationSeconds:2,sequence:0,discontinuitySequence:0,generatedAt:now,segments:[0,1,2].map(sequence=>({sequence,objectKey:`${streamKey}/epochs/1/attempt-1-abc/video-${sequence}.ts`,durationSeconds:2,programDateTime:now,discontinuity:false}))};
    current={kind:'active',grant:{id:'capability',streamKey,context:{kind:'profile',profileId:'profile',linkId:`Source${i}`},contextRevision:1,issuedAt:now-1,expiresAt:now+43200000,renditions:['video','audio']},state:'ready',epoch:1,leaseExpiresAt:now+30000,snapshot};
    const response=await handler({version:'2.0',rawPath:'/p/capability/video/index.m3u8',rawQueryString:'',headers:{origin:'https://app.invalid'},requestContext:{http:{method:'GET'}}});
    assert.equal(response.statusCode,200);assert.match(response.body,/Signature=/);assert.match(response.body,new RegExp(`vrcdn/Source${i}/1/`));statuses.push(response.statusCode);
  }
  const manifest=JSON.parse(await readFile(new URL('./manifest.json',pathToFileURL(zip)),'utf8'));
  const hash=createHash('sha256').update(await readFile(`${scratch}/gateway.mjs`)).digest('hex');assert.equal(hash,manifest.gateway.sha256);
  await writeFile(evidencePath,JSON.stringify({proof:'actual extracted gateway ZIP; local AWS HTTP protocol fixtures and control RPC double; no AWS access',gatewaySha256:hash,gatewayZipSha256:manifest.gatewayZip.sha256,sourceCap:1,sequentialSources:statuses.length,statuses,secrets,reads,demands},null,2)+'\n');
  console.log(JSON.stringify({result:'PASS',statuses,secrets,reads,demands}));
} finally {
  globalThis.fetch=originalFetch;Date.now=originalNow;
  for(const key of Object.keys(process.env)) if(!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env,originalEnv);
  if(server) await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
