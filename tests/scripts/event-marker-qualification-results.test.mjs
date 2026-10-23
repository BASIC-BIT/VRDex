import { createHash } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const zip=b=>gzipSync(b),unzip=b=>b[0]===31?gunzipSync(b).toString():Buffer.from(b).toString();
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClassifierCase, observeVerdict, observationName, prerequisiteStates, makeResultShards, validateResultUnion } from '../../scripts/marker-qualification/results.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { referenceDetector } from '../../scripts/marker-qualification/detector-reference.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
const authority=enumerateQualification();
const row=authority.rows.find(r=>r.id.startsWith('q30/'));
function evidence(){const s=literalPcm({family:'q30',source:'a',placement:0});const decoded=decodeSourceAudio([s.pcm],s.rows);return {episodes:decoded.episodes,referenceRanges:referenceDetector(s.pcm,s.rows).episodes};}
test('typed codec negative requires every real prerequisite and original complete episode',()=>{
 const p=prerequisiteStates('pass');assert.equal(evaluateClassifierCase(row,p,evidence()).status,'pass');
 for(const key of Object.keys(p))for(const state of ['fail','not_run']){const actual=evaluateClassifierCase(row,{...p,[key]:state},evidence());assert.equal(actual.status,'incomplete');assert.equal(actual.prerequisite,key);}
 const e=evidence();e.episodes[0].onset++;assert.equal(evaluateClassifierCase(row,p,e).status,'fail');
 for(const mutate of [e=>e.episodes=[],e=>e.episodes.push(e.episodes[0]),e=>e.episodes[0].identity='a',e=>e.episodes[0].reason='none',e=>e.episodes[0].local.firstPair=-1]){const e=evidence();mutate(e);assert.equal(evaluateClassifierCase(row,p,e).status,'fail');}
});
test('result shards preserve exact IDs contracts source pins byte hashes and disjoint union',()=>{
 const invocations=authority.invocations.filter(i=>i.kind==='literal').slice(0,2),pins={imageDigest:'sha256:'+'a'.repeat(64),sourceManifestSha256:'b'.repeat(64),planSha256:'c'.repeat(64),expectedContractsSha256:'d'.repeat(64)};
 const bundles=invocations.map(inv=>makeResultShards(inv,inv.rows.map((_,index)=>({index,status:'pass',prerequisites:'not_applicable',facts:{samples:7200}})),pins));
 assert.equal(validateResultUnion(invocations,bundles,pins).passed,true);
 for(const mutate of [b=>b.pop(),b=>b.push(b[0]),b=>b[0].shards[0].bytes[0]^=1,b=>b[0].invocation='wrong',b=>b[0].pins.imageDigest='sha256:'+'f'.repeat(64)]){
  const changed=structuredClone(bundles);mutate(changed);assert.throws(()=>validateResultUnion(invocations,changed,pins),/qualification_result/);
 }
 const failed=invocations[0].rows.map((_,index)=>({index,prerequisites:'not_applicable',status:index===12?'incomplete':'pass',reason:index===12?'timeout':undefined}));
 assert.equal(validateResultUnion([invocations[0]],[makeResultShards(invocations[0],failed,pins)],pins).passed,false);
 assert.throws(()=>makeResultShards(invocations[0],failed.slice(1),pins),/qualification_result/);
});

test('serialized rehashed codec rows require actual stages and contract-matching observed evidence',()=>{
 const inv=authority.invocations.find(i=>i.id==='mass-320-48000stereo-000'),pins={test:'serialized'},e=evidence();
 const observation=Buffer.from(JSON.stringify({cases:Array.from({length:inv.rows.length/2},()=>e)}));
 const files=new Map(['program','program_twitch'].map(path=>[`${inv.id}-${path}-decode.json.gz`,gzipSync(observation)]));
 const results=inv.rows.map((row,index)=>{const name=`${inv.id}-${row.params.path}-decode.json.gz`,bytes=files.get(name);return {index,...evaluateClassifierCase(row,prerequisiteStates('pass'),e),prerequisites:prerequisiteStates('pass'),observation:{name,bytes:bytes.length,sha256:hash(bytes)}};});
 const bundle=makeResultShards(inv,results,pins);assert.equal(validateResultUnion([inv],[bundle],pins,name=>files.get(name)).passed,true);
 const badFiles=new Map(files),badObservation=JSON.parse(observation);badObservation.cases[0].episodes[0].identity='a';
 const name=`${inv.id}-program-decode.json.gz`,badBytes=gzipSync(Buffer.from(JSON.stringify(badObservation)));badFiles.set(name,badBytes);
 const contradictory=structuredClone(results);for(const r of contradictory)if(r.observation.name===name)r.observation={name,bytes:badBytes.length,sha256:hash(badBytes)};
 contradictory[0].facts.class='a';
 assert.throws(()=>validateResultUnion([inv],[makeResultShards(inv,contradictory,pins)],pins,n=>badFiles.get(n)),/qualification_result_semantic/);

 for(const mutate of [r=>delete r.prerequisites,r=>r.prerequisites.encode_complete='fail',r=>r.facts.class='a',r=>delete r.observation]){
  const changed=structuredClone(bundle),s=changed.shards[0],parsed=JSON.parse(unzip(s.bytes));mutate(parsed.rows[0]);s.bytes=zip(Buffer.from(JSON.stringify(parsed)+'\n'));s.length=s.bytes.length;s.sha256=hash(s.bytes);
  assert.throws(()=>validateResultUnion([inv],[changed],pins,name=>files.get(name)),/qualification_result/);
 }
});


test('serialized scene and bridge rows re-evaluate full observations rather than summary status',()=>{
 for(const kind of ['association','profile']){
  const inv=authority.invocations.find(i=>i.kind===kind),pins={test:kind},files=new Map(),results=[];
  for(const [index,row] of inv.rows.entries()){
   const name=observationName(inv,index);let detail;
   if(kind==='association')detail={observations:['program','program_twitch'].map(path=>({path,observation:{contexts:{}}}))};
   else{const record={recordingSha256:'a'.repeat(64),visuals:Array.from({length:8},(_,id)=>({id,start:id*90000,identity:row.contract.source})),episodes:Array.from({length:8},(_,id)=>({id,onset:id*48000,identity:row.contract.source}))};detail={decoded:{record},quality:{fullFrameYuvPsnrDb:30},artifact:{sha256:record.recordingSha256},aacGenerations:row.params.path==='program'?1:2};}
   const bytes=gzipSync(Buffer.from(JSON.stringify(detail)));files.set(name,bytes);
   results.push({index,prerequisites:prerequisiteStates('pass'),observation:{name,bytes:bytes.length,sha256:hash(bytes)},...observeVerdict(inv,index,detail)});
  }
  const bundle=makeResultShards(inv,results,pins);assert.equal(validateResultUnion([inv],[bundle],pins,n=>files.get(n)).passed,kind==='profile');
  const changed=structuredClone(bundle),s=changed.shards[0],parsed=JSON.parse(unzip(s.bytes));
  if(kind==='association'){parsed.rows[0].status='pass';delete parsed.rows[0].reason;}else parsed.rows[0].facts.visualPsnrDb=40;
  s.bytes=zip(Buffer.from(JSON.stringify(parsed)));s.length=s.bytes.length;s.sha256=hash(s.bytes);
  assert.throws(()=>validateResultUnion([inv],[changed],pins,n=>files.get(n)),/qualification_result_semantic/);
 }
});
