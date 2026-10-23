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
import { compileTrain,constructTrainPcm } from '../../scripts/marker-qualification/trains.mjs';
import { stereoMono } from '../../scripts/marker-qualification/codec-input.mjs';
import { decodeMarkerVisuals } from '../../scripts/event-marker-record.mjs';
import { assertDecodedCoverage } from '../../scripts/marker-qualification/media-facts.mjs';
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
 const visual=decodeMarkerVisuals(rgb,videoRows),record={...decodeSourceAudio([pcm],audioRows),...visual,watermarks:[],recordingSha256:'a'.repeat(64)};
 record.episodes.forEach((e,id)=>e.id=id);const reference=referenceDetector(pcm,audioRows),coverage=assertDecodedCoverage(record,{frames:train.frames,fps:30,samples:train.samples});
 const cases=train.slots.map(s=>({episodes:record.episodes.filter(e=>e.onset>=48000+s.start&&e.end<=48000+s.end),referenceRanges:reference.episodes.filter(e=>e[0]>=48000+s.start&&e[2]<=48000+s.end),visualCount:1,fullFenceCovered:true,coverage:record.audioRange}));
 return {record,observation:{reference,audioRows,videoRows,visual,pcmSha256:hash(pcm),rgbSha256:hash(rgb)},coverage,cases};
}
function serializedMass(inv,observed) {
 const pins={test:'serialized-complete-mass'},bytes=gzipSync(Buffer.from(JSON.stringify(observed))),files=new Map(['program','program_twitch'].map(path=>[`${inv.id}-${path}-decode.json.gz`,bytes]));
 const results=inv.rows.map((row,index)=>{const name=`${inv.id}-${row.params.path}-decode.json.gz`;return {index,...evaluateClassifierCase(row,prerequisiteStates('pass'),observed.cases[Math.floor(index/2)]),prerequisites:prerequisiteStates('pass'),observation:{name,bytes:bytes.length,sha256:hash(bytes)}};});
 return {pins,files,results,bundle:makeResultShards(inv,results,pins)};
}

test('serialized rehashed codec rows require actual stages and contract-matching observed evidence',()=>{
 const inv=authority.invocations.find(i=>i.id==='mass-320-48000stereo-000'),observed=completeMassObservation(inv),{pins,files,results,bundle}=serializedMass(inv,observed);
 assert.equal(validateResultUnion([inv],[bundle],pins,name=>files.get(name)).passed,true);
 const badFiles=new Map(files),badObservation=structuredClone(observed);badObservation.cases[0].episodes[0].identity='a';
 const name=`${inv.id}-program-decode.json.gz`,badBytes=gzipSync(Buffer.from(JSON.stringify(badObservation)));badFiles.set(name,badBytes);
 const contradictory=structuredClone(results);for(const r of contradictory)if(r.observation.name===name)r.observation={name,bytes:badBytes.length,sha256:hash(badBytes)};
 contradictory[0].facts.class='a';
 assert.throws(()=>validateResultUnion([inv],[makeResultShards(inv,contradictory,pins)],pins,n=>badFiles.get(n)),/qualification_result_semantic/);
 for(const mutate of [r=>delete r.prerequisites,r=>r.prerequisites.encode_complete='fail',r=>r.facts.class='a',r=>delete r.observation]){
  const changed=structuredClone(bundle),s=changed.shards[0],parsed=JSON.parse(unzip(s.bytes));mutate(parsed.rows[0]);s.bytes=zip(Buffer.from(JSON.stringify(parsed)+'\n'));s.length=s.bytes.length;s.sha256=hash(s.bytes);
  assert.throws(()=>validateResultUnion([inv],[changed],pins,name=>files.get(name)),/qualification_result/);
 }
});

test('mass union rejects rehashed original versus copied evidence and conservation contradictions',()=>{
 const inv=authority.invocations.find(i=>i.id==='mass-320-48000stereo-000'),original=completeMassObservation(inv),{pins,results}=serializedMass(inv,original);
 const withoutCopies=JSON.parse(JSON.stringify(original));delete withoutCopies.cases;
 const completeBytes=gzipSync(Buffer.from(JSON.stringify(withoutCopies))),completeRows=structuredClone(results);
 for(const r of completeRows){r.observation.bytes=completeBytes.length;r.observation.sha256=hash(completeBytes);}
 assert.equal(validateResultUnion([inv],[makeResultShards(inv,completeRows,pins)],pins,()=>completeBytes).passed,true);

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
  // JSON cloning deliberately breaks producer aliases: original and copied
  // tables can be changed independently, then both artifact and shards rehash.
  const changed=JSON.parse(JSON.stringify(original));mutate(changed);const bytes=gzipSync(Buffer.from(JSON.stringify(changed))),rows=structuredClone(results);
  for(const r of rows){r.observation.bytes=bytes.length;r.observation.sha256=hash(bytes);}
  assert.throws(()=>validateResultUnion([inv],[makeResultShards(inv,rows,pins)],pins,()=>bytes),/qualification_result_semantic/);
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
