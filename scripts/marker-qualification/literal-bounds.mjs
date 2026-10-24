import assert from 'node:assert/strict';
import {decodeSourceAudio,MARKER_LIMITS} from '../event-source-markers.mjs';
import {decodeMarkerVisuals,validateIdentityEpochs} from '../event-marker-record.mjs';
import {associateContext} from '../event-marker-association.mjs';
import {assertMarkerEvidenceSize,validateMarkerRecord} from '../event-marker-evidence.mjs';
import {buildMarkerContexts} from '../event-marker-contexts.mjs';
import {validateCapacityReceipt} from '../event-capacity-contracts.mjs';
import {sourceMarkerFixture} from '../../tests/fixtures/source-marker-literal.mjs';
import {literalPcm} from './signals.mjs';
function repeated(episodes,loud,guard,extraLast=0,phase=0) {
 const tone=literalPcm({family:'pure',source:'a',loudSamples:loud,phase},{onset:0,tail:0}).pcm;
 const count=episodes*(loud+guard)+extraLast,pcm=Buffer.alloc(count*2),rows=[];let at=0;
 for(let i=0;i<episodes;i++) {
  tone.copy(pcm,at*2);rows.push({index:rows.length,pts:at,samples:loud});at+=loud;
  const quiet=guard+(i===episodes-1?extraLast:0);rows.push({index:rows.length,pts:at,samples:quiet});at+=quiet;
 }
 return {pcm,rows};
}
const decode=x=>decodeSourceAudio([x.pcm],x.rows);
function raw() {return {videoRange:[0,900000],audioRange:[0,500000],identityEpochs:[[0,4],[90000,1]],watermarks:[],visuals:[{id:0,start:180000,end:189000,identity:'a',watermark:-1}],episodes:[{id:0,onset:96000,end:100800,identity:'a'}]};}
const context=()=>({kind:'transition',identity:'a',selection:90000,start:90000,end:450000,fullVisualIds:[0]});
export function executeBound(name) {
 if(name==='episode_samples12000_pass12001_fail') {
  const good=repeated(1,11520,480,0,2);assert.equal(decode(good).episodes[0].end,12000);
  assert.throws(()=>decode(repeated(1,11521,480,0,2)),/marker_episode_bound/);return {observedEpisodeSamples:12000,excessRejected:true};
 }
 if(name==='episode_count4096_pass4097_fail') {
  const result=decode(repeated(4096,480,480));assert.equal(result.episodes.length,4096);assert(result.episodes.every(e=>e.identity==='unknown'));
  assert.throws(()=>decode(repeated(4097,480,480)),/marker_episode_count_bound/);return {observedEpisodes:4096,semanticResult:'insufficient_samples',excessRejected:true};
 }
 if(name==='residual_windows12000000_pass12000001_fail') {
  const result=decode(repeated(2400,4800,247));assert.deepEqual(result.residualWindowCounts,[12000000,12000000]);
  assert.throws(()=>decode(repeated(2400,4800,247,1)),/marker_residual_bound/);return {actualScanned:result.residualWindowCounts,episodes:result.episodes.length,excessRejected:true};
 }
 if(name==='visual_count4096_pass4097_fail') {
  const make=count=>{const rgb=Buffer.alloc(count*12),rows=[];for(let i=0;i<count*2;i++){rgb[i*6]=255;if(i%2===0)rgb.fill(255,i*6+3,i*6+6);rows.push({index:i,pts:i*3000});}return {rgb,rows};};
  const good=make(4096);assert.equal(decodeMarkerVisuals(good.rgb,good.rows).visuals.length,4096);const bad=make(4097);assert.throws(()=>decodeMarkerVisuals(bad.rgb,bad.rows),/marker_visual_bound/);return {observedVisuals:4096,excessRejected:true};
 }
 if(name==='candidate_count16_pass17_fail') {
  const r=raw();r.episodes=Array.from({length:16},(_,id)=>({id,onset:73000+id*2500,end:74000+id*2500,identity:'a'}));
  const actual=associateContext(r,context());assert.equal(actual.valid,false);assert(actual.failures.includes('duplicate_source_candidate'));
  r.episodes.push({id:16,onset:114000,end:115000,identity:'a'});assert.throws(()=>associateContext(r,context()),/marker_candidate_bound/);return {evaluatedCandidates:16,semanticResult:'duplicate_source_candidate',excessRejected:true};
 }
 if(name==='fullflash_count256_pass257_fail') {
  const r=raw();r.videoRange[1]=30000000;r.audioRange[1]=16000000;r.visuals=Array.from({length:256},(_,id)=>({id,start:180000+id*90000,end:189000+id*90000,identity:'a',watermark:-1}));r.episodes=r.visuals.map(v=>({id:v.id,onset:v.start*8/15,end:v.start*8/15+4800,identity:'a'}));
  const c={...context(),end:24000000,fullVisualIds:r.visuals.map(v=>v.id)};assert.equal(associateContext(r,c).valid,true);r.visuals.push({id:256,start:23220000,end:23229000,identity:'a',watermark:-1});c.fullVisualIds.push(256);assert.throws(()=>associateContext(r,c),/marker_visual_reference/);return {actualFullPairs:256,excessRejected:true};
 }
 if(name==='scratch_bytes65536_neverexceed') {const result=decode(repeated(1,4800,480));assert.equal(result.scratchBytes,40000);assert(result.scratchBytes<=65536);return {allocatedNumericBackingBytes:result.scratchBytes,limit:65536};}
 if(name==='local_windows1200000_pass1200001_fail') {
  // This independent cap cannot be reached under the earlier episode/sample
  // caps. Never pretend that 1.2M windows were scanned or fabricate a pass.
  const semanticMaximum=MARKER_LIMITS.episodes*Math.floor(MARKER_LIMITS.episodeSamples/480);assert.equal(semanticMaximum,102400);
  const record=sourceMarkerFixture().markerEvidence;record.localWindowCount=1200001;assert.throws(()=>validateMarkerRecord(record),/marker_record_conservation/);
  return {boundary:1200000,semanticMaximum,dominatedBy:'episode_and_sample_caps',excessRejected:true};
 }
 if(name==='watermark_count64_pass65_fail') {
  const record=sourceMarkerFixture().markerEvidence;while(record.watermarks.length<64)record.watermarks.push([...record.watermarks[0]]);
  // Structural size/count boundary only; duplicated watermarks are not proof.
  assertMarkerEvidenceSize([record]);record.watermarks.push([...record.watermarks[0]]);assert.throws(()=>assertMarkerEvidenceSize([record]),/marker_watermark_bound/);return {structuralRows:64,admission:false,excessRejected:true};
 }
 if(name==='transition_count8_pass9_fail'||name==='steady_count8_pass9_fail') {
  const r=raw(),transition=name.startsWith('transition');const count=9;
  assert.throws(()=>buildMarkerContexts(r,{selections:transition?Array(count).fill({}):[],windows:transition?[]:Array(count).fill({})}),/marker_context_bound/);
  const wire=sourceMarkerFixture().markerEvidence,c=wire.contexts[transition?0:2];wire.contexts=Array.from({length:8},()=>structuredClone(c));
  wire.contextCounts=[8,wire.contexts.reduce((n,c)=>n+c[5].length+c[6].length,0)];
  const used=new Set(wire.contexts.flatMap(c=>c[6].map(d=>d[0])));wire.outsideRequiredContexts=wire.episodes.length-used.size;
  assert.equal(validateMarkerRecord(wire).contexts.length,8);wire.contexts.push(structuredClone(c));wire.contextCounts[0]++;wire.contextCounts[1]+=c[5].length+c[6].length;
  assert.throws(()=>validateMarkerRecord(wire),/marker_context_conservation/);return {actualValidatedContexts:8,excessRejected:true};
 }
 if(name==='context_refs8192_pass8193_fail') {
  // Reference cap is separately enforced even when a smaller wire guard also
  // rejects these structural rows; no accepted-record claim follows.
  const record=sourceMarkerFixture().markerEvidence;record.contexts=[...Array(16)].map(()=>[0,1,90000,90000,450000,Array(256).fill([0,0,0,0]),Array(256).fill([0,0,-1]),[]]);
  assert.throws(()=>assertMarkerEvidenceSize([record]),/marker_context_wire_bound/);
  record.contexts[0][6].push([0,0,-1]);assert.throws(()=>assertMarkerEvidenceSize([record]),/marker_context_wire_bound|marker_reference_bound/);return {requestedReferences:[8192,8193],dominatedBy:'context_wire_bound',admission:false};
 }
 if(name==='marker_bytes524288_pass524289_fail') {
  // Structural byte witness only: duplicate rows deliberately do not qualify
  // as source evidence. Exercise the exact total-byte guard independently.
  const record=sourceMarkerFixture().markerEvidence,episode=[...record.episodes[0]];
  record.padding='';
  const initial=assertMarkerEvidenceSize([record]).bytes,perRow=Buffer.byteLength(JSON.stringify(episode))+1;
  const added=Math.floor((524288-initial)/perRow);
  for(let i=0;i<added;i++)record.episodes.push(structuredClone(episode));
  const before=assertMarkerEvidenceSize([record]).bytes;
  record.padding='x'.repeat(524288-before);assert.equal(assertMarkerEvidenceSize([record]).bytes,524288);
  record.padding+='x';assert.throws(()=>assertMarkerEvidenceSize([record]),/marker_evidence_bound/);
  return {structuralBytes:524288,admission:false,excessRejected:true};
 }
 if(name==='inner_bytes1048576_pass1048577_fail') {
  const marker=sourceMarkerFixture();
  const receipt={schemaVersion:1,terminal:true,request:{settings:{videoPreset:'480p30',audioBitrateKbps:160},cpuUnits:8192,memoryMiB:16384,durationSeconds:300,simulcastEnabled:false},cleanup:{closed:true,liveChildren:0,liveGroups:0},steady:{durationMs:300000,dualDecodeMs:300000,samples:300,maxSampleGapMs:1000,readinessLosses:0},resources:{cpuP95Percent:40,sampleCoverageMs:300000,memoryPeakBytes:1000000},maxCompressedBufferBytes:3000000,maxDecoders:2,maxAcquisitions:2,
   outputs:[{destination:'vrcdn',videoCodec:'h264',width:854,height:480,fps:30,pixelFormat:'yuv420p',audioCodec:'aac',channels:2,sampleRate:48000,audioKbps:160,maxGop:1,maxGap:.03,monotonic:true,identities:['a','b','slate'],visualPsnrDb:35,internalDelayMs:100,...marker}],artifacts:[{name:'vrcdn.ts',sha256:marker.markerEvidence.recordingSha256,bytes:1,complete:true}],padding:''};
  receipt.padding='x'.repeat(1048576-Buffer.byteLength(JSON.stringify(receipt)));
  assert.equal(Buffer.byteLength(JSON.stringify(receipt)),1048576);assert.equal(validateCapacityReceipt(receipt),receipt);
  receipt.padding+='x';assert.throws(()=>validateCapacityReceipt(receipt),/marker_receipt_bound/);
  return {syntheticValidatorBytes:1048576,actualCapacityEvidence:false,excessRejected:true};
 }
 throw Error('literal_bound_unimplemented');
}
