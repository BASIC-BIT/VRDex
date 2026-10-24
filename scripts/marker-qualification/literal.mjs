import { executeBound } from "./literal-bounds.mjs";
import { executeMalformed } from "./literal-invalid.mjs";
import assert from 'node:assert/strict';
import { decodeSourceAudio, markerOffset } from '../event-source-markers.mjs';
import { associateContext } from '../event-marker-association.mjs';
import { literalPcm, literalOnsets } from './signals.mjs';
import { literalProfilePlan } from './authority.mjs';
import { referenceDetector, validateShortTailObservation, validateMinimumObservation } from './detector-reference.mjs';
import { createHash } from 'node:crypto';
const rejectSources=e=>assert(!['a','b'].includes(e.identity),'literal_rejection');
const parse=row=>{
 const family=literalProfilePlan.literalCases.find(f=>f.id===row.params.family);
 if(!family)throw Error('literal_family');
 return family.axes?Object.fromEntries(Object.keys(family.axes).map((k,i)=>[k,row.params.values[i]])):{name:row.params.values[0]};
};
function decodeSignal(options,config) {
 const signal=literalPcm(options,config),result=decodeSourceAudio([signal.pcm],signal.rows);
 assert.deepEqual(result.episodes.map(e=>e.onset),literalOnsets(signal.pcm,signal.rows));
 assert.equal(result.metadataSamples*2,signal.pcm.length);assert(result.scratchBytes<=65536);
 return {signal,result};
}
function intervalRecord(source='a') {
 return {videoRange:[0,900000],audioRange:[0,500000],identityEpochs:[[0,4],[90000,source==='a'?1:2]],watermarks:[],
 visuals:[{id:0,start:180000,end:189000,identity:source,watermark:-1}],episodes:[{id:0,onset:96000,end:101280,identity:source}]};
}
function intervalContext(kind='transition',identity='a') {return {kind,identity,selection:90000,start:90000,end:450000,fullVisualIds:[0]};}
function compact(result) {
 const e=result.episodes[0];return {samples:result.metadataSamples,bytes:result.decodedBytes,episodes:result.episodes.length,scratch:result.scratchBytes,
  ...(e?{onset:e.onset,end:e.end,class:e.identity,reason:e.reason,scores:e.fits.map(f=>f.score),residual:e.fits.map(f=>f.maxResidual),localPair:e.local.firstPair}: {})};
}
/** Execute a single frozen literal assertion against implementation functions.
 * Failure is a required-case failure, never skip/xfail or a codec observation. */
export function executeLiteral(row) {
 const family=row.params.family,p=parse(row);let result;
 if(family==='malformed')return executeMalformed(p.name);
 if(family==='bounds')return executeBound(p.name);
 if(family==='metadata_short_tail') {
  const signal=literalPcm({family:'pure',source:p.source},{onset:960,tail:1440,rowSamples:p.rowSamples,noise:'none'});
  const reference=referenceDetector(signal.pcm,signal.rows);
  result=decodeSourceAudio([signal.pcm],signal.rows);
  validateShortTailObservation(row.contract.caseContract,reference,result);
  const classes={unknown:0,a:1,b:2,mixed:3},reasons={none:0,insufficient_samples:1};
  return {samples:result.metadataSamples,bytes:result.decodedBytes,rows:reference.metadataRows,blocks:reference.detectorBlocks,
   blockSha256:createHash('sha256').update(JSON.stringify(reference.blocks)).digest('hex'),
   episodes:result.episodes.map(e=>[e.onset,e.onset+e.loudEnd,e.end,e.firstMetadataIndex,e.metadataRowCount,classes[e.identity],reasons[e.reason],e.fits.map(f=>f.score),e.fits.map(f=>[f.code,f.maxResidual]),e.local.firstPair])};
 }
 if(['detector_offset','mixture_literal','foreign_literal','hidden105_literal','phasejump_literal'].includes(family)) {
  const options={family:family==='detector_offset'||family==='metadata_short_tail'?'pure':family,source:p.source??p.dominant,phase:p.phase??0,foreignPhase:p.foreignPhase??0,
   placement:p.placementSamples??p.placement,ratio:p.ratio,durationMs:(p.durationSamples??0)/48,jump:p.jump??0};
  ({result}=decodeSignal(options,{onset:960+(p.onsetOffset??0),rowSamples:p.metadataRowSamples??p.rowSamples??1024,noise:p.noise??'none'}));
  assert.equal(result.episodes.length,1,'literal_episode_count:'+row.id);
  if(['detector_offset','metadata_short_tail'].includes(family))assert.equal(result.episodes[0].identity,options.source);
  else rejectSources(result.episodes[0]);
 } else if(family==='minimum_loud_length') {
  const x=literalPcm({family:'pure',source:p.source,loudSamples:p.loudSamples},{onset:0,tail:480});
  x.rows=[{index:0,pts:0,samples:p.loudSamples},{index:1,pts:p.loudSamples,samples:480}];
  result=decodeSourceAudio([x.pcm],x.rows);
  return {...compact(result),...validateMinimumObservation(p.loudSamples,referenceDetector(x.pcm,x.rows),result)};
 } else if(family==='byte_partition') {
  const x=literalPcm({family:'pure',source:p.source}),baseline=decodeSourceAudio([x.pcm],x.rows),chunks=[];
  for(let at=0,i=0;at<x.pcm.length;i++){const end=Math.min(x.pcm.length,at+p.chunkPattern[i%p.chunkPattern.length]);chunks.push(x.pcm.subarray(at,end));at=end;}
  result=decodeSourceAudio(chunks,x.rows);assert.deepEqual(result,baseline);
 } else if(family==='signed_gate'||family==='half_period_fence') {
  const r=intervalRecord(),c=intervalContext(p.context);r.episodes[0].onset+=p.offsetNumerator/15;r.episodes[0].end+=p.offsetNumerator/15;
  const actual=associateContext(r,c),inside=Math.abs(p.offsetNumerator)<360000;
  assert.equal(actual.pairs.length,inside?1:0);assert.equal(actual.valid,Math.abs(p.offsetNumerator)<=72000);
  if(inside)assert.equal(actual.pairs[0].offsetNumerator,p.offsetNumerator);
  return {offset:p.offsetNumerator,pairs:actual.pairs.length,valid:actual.valid,reasons:actual.failures};
 } else if(family==='steady_visual_edges') {
  const r=intervalRecord(),start=90000,end=630000,boundary=p.boundary==='left'?start+18000:end-18000;
  r.visuals[0].start=boundary+p.deltaVideoTicks;r.visuals[0].end=r.visuals[0].start+9000;
  const full=r.visuals.filter(v=>v.start>start+18000&&v.start<end-18000);
  const expected=p.boundary==='left'?p.deltaVideoTicks>0:p.deltaVideoTicks<0;assert.equal(full.length===1,expected);
  // Actual partition, not merely a duplicate edge comparison: non-full cases
  // must consume a same-source fragment, full cases must consume the pair.
  r.episodes[0].onset=Math.round(r.visuals[0].start*8/15);r.episodes[0].end=r.episodes[0].onset+4800;
  const actual=associateContext(r,{kind:'steady',identity:'a',selection:90000,start,end,fullVisualIds:full.map(v=>v.id)});
  assert.equal(actual.valid,true);assert.equal(actual.dispositions[0].code,expected?'paired_full':'existing_steady_edge_fragment');
  return {boundary,delta:p.deltaVideoTicks,disposition:actual.dispositions[0].code};
 } else if(family==='foreign_tail_end') {
  const previous=p.source,selected=previous==='a'?'b':'a',r=intervalRecord(selected),selection=90000;
  r.identityEpochs=[[0,previous==='a'?1:2],[selection,selected==='a'?1:2]];
  r.episodes.push({id:1,onset:47000,end:52800+p.endVsSelectionPlus100msSamples,identity:p.class==='unknown'?'unknown':previous});
  const actual=associateContext(r,intervalContext('transition',selected));
  const pass=p.class==='previous_source'&&p.endVsSelectionPlus100msSamples<=0;assert.equal(actual.valid,pass);
  return {valid:actual.valid,tailEnd:r.episodes[1].end,disposition:actual.dispositions.find(d=>d.episodeId===1).code};
 } else if(family==='nonmarkers_literal') {
  const tone=p.name==='1000Hz';
  ({result}=decodeSignal({family:tone?'1000Hz':'missing'},{noise:p.name==='noise_seed42'?42:p.name==='noise_seed43'?43:'none'}));
  result.episodes.forEach(rejectSources);assert.equal(result.episodes.length,tone?1:0);
 } else {
  // Boundary and malformed cases are dispatched separately so absent cases
  // cannot silently satisfy the qualification union.
  throw Error('literal_case_unimplemented');
 }
 return compact(result);
}
