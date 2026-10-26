import { createHash } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
const zip=b=>gzipSync(b),unzip=b=>b[0]===31?gunzipSync(b).toString():Buffer.from(b).toString();
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClassifierCase, evaluateBridgeCase, observeVerdict, observationName, prerequisiteStates, makeResultShards, validateResultUnion } from '../../scripts/marker-qualification/results.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { referenceDetector } from '../../scripts/marker-qualification/detector-reference.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
import { compileTrain,constructTrainPcm } from '../../scripts/marker-qualification/trains.mjs';
import { stereoMono } from '../../scripts/marker-qualification/codec-input.mjs';
import { decodeMarkerVisuals } from '../../scripts/event-marker-record.mjs';
import { assertDecodedCoverage } from '../../scripts/marker-qualification/media-facts.mjs';
import { deriveMassCases } from '../../scripts/marker-qualification/mass-facts.mjs';
import { matchSceneContract } from '../../scripts/marker-qualification/scene-policy.mjs';
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

function completeMassObservation(inv) {
 // Child-free literal control, not native codec evidence. Build the complete
 // canonical train, independently detect every sample, and retain every row.
 const train=compileTrain(inv),noise=Buffer.alloc(train.samples*2),pcm=stereoMono(constructTrainPcm(train,{42:noise,43:noise})),audioRows=[];
 for(let at=0;at<train.samples;at+=1024)audioRows.push({index:audioRows.length,pts:48000+at,samples:Math.min(1024,train.samples-at)});
 const videoRows=Array.from({length:train.frames},(_,index)=>({index,pts:90000+index*3000})),rgb=Buffer.alloc(train.frames*6);
 for(let tick=0;tick<train.frames;tick++){
  const slot=train.slots.find(s=>tick*1600>=s.start&&tick*1600<s.end);if(!slot)continue;
  rgb[tick*6+(slot.params.source==='b'?2:0)]=255;if(tick>=slot.visualFrame&&tick<slot.visualFrame+3)rgb.fill(255,tick*6+3,tick*6+6);
 }
 const visual=decodeMarkerVisuals(rgb,videoRows),record={...decodeSourceAudio([pcm],audioRows),...visual,watermarks:[]};
 record.episodes.forEach((e,id)=>e.id=id);const reference=referenceDetector(pcm,audioRows),coverage=assertDecodedCoverage(record,{frames:train.frames,fps:30,samples:train.samples});
 const cases=train.slots.map(s=>({episodes:record.episodes.filter(e=>e.onset>=48000+s.start&&e.end<=48000+s.end),referenceRanges:reference.episodes.filter(e=>e[0]>=48000+s.start&&e[2]<=48000+s.end),visualCount:1,fullFenceCovered:true,coverage:record.audioRange}));
 return {record,observation:{reference,audioRows,videoRows,visual,pcmSha256:hash(pcm),rgbSha256:hash(rgb)},coverage,cases};
}
function serializedMass(inv,observed) {
 const pins={test:'serialized-complete-mass'},bytes=gzipSync(Buffer.from(JSON.stringify(observed))),files=new Map(['program','program_twitch'].map(path=>[`${inv.id}-${path}-decode.json.gz`,bytes]));
 const results=inv.rows.map((row,index)=>{const name=`${inv.id}-${row.params.path}-decode.json.gz`;return {index,...evaluateClassifierCase(row,prerequisiteStates('pass'),observed.cases[Math.floor(index/2)]),prerequisites:prerequisiteStates('pass'),observation:{name,bytes:bytes.length,sha256:hash(bytes)}};});
 return {pins,files,results,bundle:makeResultShards(inv,results,pins)};
}

test('serialized rehashed codec rows require actual stages and reject fabricated recording or replay proof',()=>{
 const inv=authority.invocations.find(i=>i.id==='mass-320-48000stereo-000'),observed=completeMassObservation(inv),{pins,files,bundle}=serializedMass(inv,observed);
 assert.deepEqual(deriveMassCases(inv,observed),observed.cases);
 assert.throws(()=>assertDecodedCoverage({...observed.record,recordingSha256:'a'.repeat(64)},{frames:observed.coverage.frames,fps:30,samples:observed.coverage.samples}),/marker_clock_unproven/);
 assert.throws(()=>validateResultUnion([inv],[bundle],pins,name=>files.get(name)),/qualification_result_program_replay/);
 assert.throws(()=>validateResultUnion([inv],[bundle],pins,name=>files.get(name),()=>observed),/marker_replay_proof_required/);
 const bad=JSON.parse(JSON.stringify(observed));bad.cases[0].episodes[0].identity='a';
 assert.throws(()=>deriveMassCases(inv,bad),/qualification_mass_observation/);
 for(const [mutate,reason] of [[r=>delete r.prerequisites,/qualification_result_prerequisites/],[r=>r.prerequisites.encode_complete='fail',/qualification_result_prerequisites/],[r=>r.facts.class='a',/qualification_result_program_replay/],[r=>delete r.observation,/qualification_result_observation/]]){
  const changed=structuredClone(bundle),shard=changed.shards[0],parsed=JSON.parse(unzip(shard.bytes));mutate(parsed.rows[0]);shard.bytes=zip(Buffer.from(JSON.stringify(parsed)+'\n'));shard.length=shard.bytes.length;shard.sha256=hash(shard.bytes);
  assert.throws(()=>validateResultUnion([inv],[changed],pins,name=>files.get(name)),reason);
 }
});

test('mass literal derivation rejects original versus copied evidence and conservation contradictions',()=>{
 const inv=authority.invocations.find(i=>i.id==='mass-320-48000stereo-000'),original=completeMassObservation(inv);
 assert.throws(()=>assertDecodedCoverage({...original.record,recordingSha256:'a'.repeat(64)},{frames:original.coverage.frames,fps:30,samples:original.coverage.samples}),/marker_clock_unproven/);
 const withoutCopies=JSON.parse(JSON.stringify(original));delete withoutCopies.cases;
 assert.deepEqual(deriveMassCases(inv,withoutCopies),deriveMassCases(inv,original));

 const mutations=[
  x=>{delete x.record;delete x.observation;delete x.coverage;},
  x=>{x.record.episodes=[];x.record.metadataSamples=0;x.record.decodedBytes=0;x.observation.reference.episodes=[];x.observation.reference.samples=0;x.observation.reference.bytes=0;},
  x=>x.record.episodes[0].onset++,x=>x.record.episodes[0].identity='a',x=>x.record.episodes.pop(),x=>x.record.episodes.push(structuredClone(x.record.episodes[0])),
  x=>x.observation.reference.episodes[0][0]++,x=>x.observation.reference.episodes.pop(),x=>x.observation.reference.episodes.push(structuredClone(x.observation.reference.episodes[0])),
  x=>x.observation.reference.blocks.pop(),x=>x.observation.reference.blocks[0][2]--,x=>x.observation.audioRows[1].pts++,x=>x.observation.videoRows.pop(),
  x=>x.record.audioRange[1]++,x=>x.record.decodedBytes+=2,x=>x.coverage.samples++,x=>x.coverage.bytes+=2,
  x=>x.record.visuals[0].start+=3000,x=>x.record.visuals.pop(),x=>x.record.visuals.push(structuredClone(x.record.visuals[0])),
  x=>x.cases[0].episodes[0].onset++,x=>x.cases[0].referenceRanges[0][0]++,x=>x.cases.pop(),x=>x.cases.push(structuredClone(x.cases[0])),
 ];
 for(const mutate of mutations){
  // JSON cloning breaks producer aliases, so originals and copied case tables
  // are independently tested at the pure source conservation boundary.
  const changed=JSON.parse(JSON.stringify(original));mutate(changed);
  assert.throws(()=>deriveMassCases(inv,changed),/qualification_mass_observation|coverage_failure|marker_/);

 }
});

test('plain scene and bridge observations remain literal contracts and cannot claim replay admission',()=>{
 for(const kind of ['association','profile']){
  const inv=authority.invocations.find(i=>i.kind===kind),pins={test:kind},files=new Map(),results=[];
  for(const [index,row] of inv.rows.entries()){
   const name=observationName(inv,index);let detail,verdict;
   if(kind==='association'){
    detail={observations:['program','program_twitch'].map(path=>({path,observation:{contexts:{}}}))};
    verdict=matchSceneContract(row.contract,detail.observations[0].observation);assert.equal(verdict.status,'fail');
   }else{
    // A labeled source-only pulse table tests the pure bridge matcher; its
    // hash is a binding operand, never a coded-recording/clock certificate.
    const record={recordingSha256:'a'.repeat(64),visuals:Array.from({length:8},(_,id)=>({id,start:id*90000,identity:row.contract.source})),episodes:Array.from({length:8},(_,id)=>({id,onset:id*48000,identity:row.contract.source}))};
    detail={decoded:{record},quality:{fullFrameYuvPsnrDb:30},artifact:{sha256:record.recordingSha256},aacGenerations:row.params.path==='program'?1:2};
    verdict=evaluateBridgeCase(row,detail,false);assert.equal(verdict.status,'pass');
    for(const mutate of [x=>x.decoded.record.episodes.pop(),x=>x.decoded.record.episodes[0].identity='unknown',x=>x.decoded.record.episodes[0].onset+=7201,x=>x.quality.fullFrameYuvPsnrDb=27,x=>x.aacGenerations++,x=>x.artifact.sha256='b'.repeat(64)]){const changed=structuredClone(detail);mutate(changed);assert.equal(evaluateBridgeCase(row,changed,false).status,'fail');}
    const changed=structuredClone(detail);changed.quality.fullFrameYuvPsnrDb=40;assert.notDeepEqual(evaluateBridgeCase(row,changed,false).facts,verdict.facts);
   }
   assert.throws(()=>observeVerdict(inv,index,detail),/marker_replay_proof_required/);
   const bytes=gzipSync(Buffer.from(JSON.stringify(detail)));files.set(name,bytes);
   results.push({index,prerequisites:prerequisiteStates('pass'),observation:{name,bytes:bytes.length,sha256:hash(bytes)},...verdict});
  }
  const bundle=makeResultShards(inv,results,pins);assert.throws(()=>validateResultUnion([inv],[bundle],pins,n=>files.get(n)),/qualification_result_program_replay/);
  const changed=structuredClone(bundle),shard=changed.shards[0],parsed=JSON.parse(unzip(shard.bytes));
  if(kind==='association'){parsed.rows[0].status='pass';delete parsed.rows[0].reason;}else parsed.rows[0].facts.visualPsnrDb=40;
  shard.bytes=zip(Buffer.from(JSON.stringify(parsed)));shard.length=shard.bytes.length;shard.sha256=hash(shard.bytes);
  assert.throws(()=>validateResultUnion([inv],[changed],pins,n=>files.get(n)),/qualification_result_program_replay/);
 }
});
