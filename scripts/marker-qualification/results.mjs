import { deriveMassCases } from './media-facts.mjs';
import { gzipSync,gunzipSync } from 'node:zlib';
import { matchSceneContract } from './scene-policy.mjs';
import { matchGlobalSceneContract } from './scene-faults.mjs';
import { markerOffset } from '../event-source-markers.mjs';
import { createHash } from 'node:crypto';
import { binding, plan, wire } from './authority.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>wire(a)===wire(b);
const required=plan.typedResultContract.prerequisites;
export const prerequisiteStates=state=>{
 if(!['pass','fail','not_run'].includes(state))throw Error('qualification_prerequisite');
 return Object.fromEntries(required.map(k=>[k,state]));
};
export function incompletePrerequisite(prerequisites) {
 if(!prerequisites||Object.keys(prerequisites).length!==required.length||required.some(k=>!['pass','fail','not_run'].includes(prerequisites[k])))return {status:'incomplete',reason:'prerequisite_invalid'};
 const key=required.find(k=>prerequisites[k]!=='pass');
 return key?{status:'incomplete',reason:'prerequisite_incomplete',prerequisite:key}:null;
}
export function compactEpisode(e) {
 return {onset:e.onset,end:e.end,loudEnd:e.loudEnd,firstRow:e.firstMetadataIndex,rows:e.metadataRowCount,class:e.identity,reason:e.reason,
  fits:e.fits.map(f=>[f.score,f.code,f.maxResidual,f.maxResidualAt,f.openingGate,f.closingGate]),local:[e.local.windows,e.local.hits,e.local.firstPair,...e.local.amplitudes]};
}
/** Expected labels are consumed only here, after source-independent decoding. */
export function evaluateClassifierCase(row,prerequisites,evidence) {
 const incomplete=incompletePrerequisite(prerequisites);if(incomplete)return incomplete;
 const c=row.contract,episodes=evidence.episodes,reference=evidence.referenceRanges;
 const fail=reason=>({status:'fail',reason});
 if(!Array.isArray(episodes)||!Array.isArray(reference))return fail('episode_evidence');
 if(c.outcome==='missing_audio') {
  if(episodes.length||reference.length||evidence.visualCount!==1||evidence.fullFenceCovered!==true)return fail('missing_audio_evidence');
  return {status:'pass',facts:{episodes:0,visuals:1,coverage:evidence.coverage}};
 }
 if(episodes.length!==c.episodeCount||reference.length!==c.episodeCount)return fail('episode_count');
 const e=episodes[0],r=reference[0];
 if(!equal([e.onset,e.onset+e.loudEnd,e.end,e.firstMetadataIndex,e.metadataRowCount],r))return fail('original_episode_changed');
 const identities=c.outcome==='source_identified'?[c.source]:c.outcomeOneOf??[c.outcome],reasons=c.reasonOneOf??[c.reason];
 if(!identities.includes(e.identity)||!reasons.includes(e.reason))return {...fail('classifier_outcome'),facts:compactEpisode(e)};
 if(c.adjacentHitPairRequired&&(e.local.firstPair<0||e.local.hits<2||e.local.amplitudes.some(a=>!Number.isFinite(a))))return fail('adjacent_pair_missing');
 if(c.bothFrequencyEvidenceRequired&&!(e.fits.every(f=>f.score>=.05)||e.local.firstPair>=0))return fail('frequency_evidence_missing');
 if(c.outcome==='source_identified') {
  const i=e.identity==='a'?0:1,f=e.fits[i];
  if(e.loudEnd<1440||f.code!==0||f.maxResidual>.14||f.score<.6||e.fits[1-i].score>=.05||e.local.firstPair!==-1)return fail('positive_fit_invalid');
 }
 return {status:'pass',facts:compactEpisode(e)};
}
export function evaluateBridgeCase(row,evidence,compressed) {
 const pulse=matchBridgePulses(evidence.decoded.record,row.contract.source,compressed?12:8);
 if(pulse.status!=='pass')return pulse;
 if(!Number.isFinite(evidence.quality?.fullFrameYuvPsnrDb)||evidence.quality.fullFrameYuvPsnrDb<28)return {status:'fail',reason:'bridge_quality'};
 const generations=(compressed?1:0)+(row.params.path==='program'?1:2);
 if(evidence.aacGenerations!==generations||evidence.artifact?.sha256!==evidence.decoded.record.recordingSha256)return {status:'fail',reason:'bridge_artifact_binding'};
 return {status:'pass',facts:{pulses:pulse.facts.pulses,maxAbsOffset:pulse.facts.maxAbsOffset,visualPsnrDb:evidence.quality.fullFrameYuvPsnrDb,aacGenerations:generations,artifactSha256:evidence.artifact.sha256}};
}
export function matchBridgePulses(record,source,pulses) {
 const fail=reason=>({status:'fail',reason});
 if(record.visuals.length!==pulses||record.episodes.length!==pulses||record.visuals.some(v=>v.identity!==source)||record.episodes.some(e=>e.identity!==source))return fail('bridge_pulse_identity_count');
 const used=new Set(),pairs=[];
 for(const visual of record.visuals){const candidates=record.episodes.filter(e=>Math.abs(markerOffset(e.onset,visual.start))<360000);if(candidates.length!==1||used.has(candidates[0].id))return fail('bridge_pulse_candidate');const e=candidates[0],offset=markerOffset(e.onset,visual.start);if(Math.abs(offset)>72000)return fail('bridge_av');used.add(e.id);pairs.push([visual.id,e.id,visual.start,e.onset,offset]);}
 return {status:'pass',facts:{pulses,pairs,maxAbsOffset:Math.max(...pairs.map(p=>Math.abs(p[4])))}};
}
export function observationName(invocation,index) {
 const row=invocation.rows[index];
 return invocation.kind==='mass'?`${invocation.id}-${row.params.path}-decode.json.gz`:invocation.kind==='association'?`${invocation.id}-scene-${Math.floor(index/2)}-observation.json.gz`:`${invocation.id}-${row.params.kbps}-${row.params.path}-decode.json.gz`;
}
export function observeVerdict(invocation,index,observed) {
 const row=invocation.rows[index];
 if(invocation.kind==='mass')return evaluateClassifierCase(row,prerequisiteStates('pass'),deriveMassCases(invocation,observed)[Math.floor(index/2)]);
 if(invocation.kind==='association'){
  const paths=observed.observations.filter(o=>o.path===row.params.path);if(paths.length!==1)throw Error('qualification_result_observation');
  return row.contract.contexts.first_transition.status==='blocked'?matchGlobalSceneContract(row.contract,paths[0].observation):matchSceneContract(row.contract,paths[0].observation);
 }
 return evaluateBridgeCase(row,observed,invocation.kind==='compressed-source');
}
function validateRows(invocation,results) {
 if(results.length!==invocation.rows.length||results.length>2048)throw Error('qualification_result_count');
 for(const [i,r] of results.entries()){
  if(r.index!==i||!['pass','fail','incomplete'].includes(r.status)||Buffer.byteLength(JSON.stringify(r.facts??{}))>512)throw Error('qualification_result_row');
  if(invocation.kind==='literal'){if(r.prerequisites!=='not_applicable')throw Error('qualification_result_literal_stages');}
  else {
   const incomplete=incompletePrerequisite(r.prerequisites);
   if(incomplete?.reason==='prerequisite_invalid'||incomplete&&r.status!=='incomplete'||!incomplete&&r.status==='incomplete'&&!['byte_cap','timeout','process_leak','invalid_result','unrun'].includes(r.reason))throw Error('qualification_result_prerequisites');
   if(!incomplete&&r.status!=='incomplete'&&(!r.observation||r.observation.name!==observationName(invocation,i)||!Number.isSafeInteger(r.observation.bytes)||r.observation.bytes<1||r.observation.bytes>262144||!/^[0-9a-f]{64}$/.test(r.observation.sha256)))throw Error('qualification_result_observation');
  }
 }
}
export function makeResultShards(invocation,results,pins) {
 validateRows(invocation,results);
 const expected=binding(invocation.rows),shards=[];
 for(let first=0;first<results.length;first+=256) {
  const rows=results.slice(first,first+256),header={schema:'marker-qualification-results-v1',invocation:invocation.id,first,last:first+rows.length-1,expected,pins};
  if(Buffer.byteLength(JSON.stringify(header))>4096)throw Error('qualification_result_header_bound');
  const raw=Buffer.from(JSON.stringify({...header,rows})+'\n');
  if(raw.length>262144)throw Error('qualification_result_shard_bound');
  const bytes=gzipSync(raw);
  shards.push({first:header.first,last:header.last,sha256:sha(bytes),length:bytes.length,bytes});
 }
 if(shards.length>8)throw Error('qualification_result_shard_count');
 return {invocation:invocation.id,expected,pins,shards};
}
/** Reparse actual bytes, never trust the convenience bundle fields as results. */
export function validateResultUnion(invocations,bundles,pins,readObservation) {
 if(bundles.length!==invocations.length||new Set(bundles.map(b=>b.invocation)).size!==bundles.length)throw Error('qualification_result_union');
 let count=0,passed=true;const allIds=new Set();
 for(const inv of invocations) {
  const bundle=bundles.find(b=>b.invocation===inv.id),expected=binding(inv.rows);
  if(!bundle||!equal(bundle.expected,expected)||!equal(bundle.pins,pins)||bundle.shards.length>8)throw Error('qualification_result_binding');
  const rows=[],observations=new Map();
  for(const shard of bundle.shards) {
   if(!(shard.bytes instanceof Uint8Array)||shard.bytes.length!==shard.length||shard.length>262144||sha(shard.bytes)!==shard.sha256)throw Error('qualification_result_sha');
   const parsed=JSON.parse(gunzipSync(shard.bytes,{maxOutputLength:262144}).toString());
   if(parsed.schema!=='marker-qualification-results-v1'||parsed.invocation!==inv.id||!equal(parsed.expected,expected)||!equal(parsed.pins,pins)||parsed.first!==rows.length||parsed.first!==shard.first||parsed.last!==shard.last||parsed.rows.length>256||parsed.last!==parsed.first+parsed.rows.length-1)throw Error('qualification_result_range');
   rows.push(...parsed.rows);
  }
  validateRows(inv,rows);
  for(const [index,row] of rows.entries()){
   if(inv.kind!=='literal'&&row.status!=='incomplete'&&!incompletePrerequisite(row.prerequisites)) {
    const ref=row.observation;let observed=observations.get(ref.name);
    if(!observed){
     if(typeof readObservation!=='function')throw Error('qualification_result_observation_missing');
     const bytes=readObservation(ref.name);if(!(bytes instanceof Uint8Array)||bytes.length!==ref.bytes||sha(bytes)!==ref.sha256)throw Error('qualification_result_observation_sha');
     try{observed=JSON.parse(gunzipSync(bytes,{maxOutputLength:8388608}).toString());}catch{throw Error('qualification_result_observation_decode');}
     observations.set(ref.name,{value:observed,sha256:ref.sha256,bytes:ref.bytes});
    }else{if(observed.sha256!==ref.sha256||observed.bytes!==ref.bytes)throw Error('qualification_result_observation_sha');observed=observed.value;}
    let verdict;try{verdict=observeVerdict(inv,index,observed);}catch{throw Error('qualification_result_semantic');}
    if(!equal(verdict,{status:row.status,...(row.reason===undefined?{}:{reason:row.reason}),...(row.facts===undefined?{}:{facts:row.facts})}))throw Error('qualification_result_semantic');
   }
   const id=inv.rows[index].id;if(allIds.has(id))throw Error('qualification_result_duplicate');allIds.add(id);count++;passed&&=row.status==='pass';}
 }
 return {count,passed,union:binding(invocations.flatMap(i=>i.rows))};
}
