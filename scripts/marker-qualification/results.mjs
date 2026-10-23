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
function validateRows(invocation,results) {
 if(results.length!==invocation.rows.length||results.length>2048)throw Error('qualification_result_count');
 for(const [i,r] of results.entries())if(r.index!==i||!['pass','fail','incomplete'].includes(r.status)||Buffer.byteLength(JSON.stringify(r.facts??{}))>512)throw Error('qualification_result_row');
}
export function makeResultShards(invocation,results,pins) {
 validateRows(invocation,results);
 const expected=binding(invocation.rows),shards=[];
 for(let first=0;first<results.length;first+=256) {
  const rows=results.slice(first,first+256),header={schema:'marker-qualification-results-v1',invocation:invocation.id,first,last:first+rows.length-1,expected,pins};
  if(Buffer.byteLength(JSON.stringify(header))>4096)throw Error('qualification_result_header_bound');
  const bytes=Buffer.from(JSON.stringify({...header,rows})+'\n');
  if(bytes.length>262144)throw Error('qualification_result_shard_bound');
  shards.push({first:header.first,last:header.last,sha256:sha(bytes),length:bytes.length,bytes});
 }
 if(shards.length>8)throw Error('qualification_result_shard_count');
 return {invocation:invocation.id,expected,pins,shards};
}
/** Reparse actual bytes, never trust the convenience bundle fields as results. */
export function validateResultUnion(invocations,bundles,pins) {
 if(bundles.length!==invocations.length||new Set(bundles.map(b=>b.invocation)).size!==bundles.length)throw Error('qualification_result_union');
 let count=0,passed=true;const allIds=new Set();
 for(const inv of invocations) {
  const bundle=bundles.find(b=>b.invocation===inv.id),expected=binding(inv.rows);
  if(!bundle||!equal(bundle.expected,expected)||!equal(bundle.pins,pins)||bundle.shards.length>8)throw Error('qualification_result_binding');
  const rows=[];
  for(const shard of bundle.shards) {
   if(!(shard.bytes instanceof Uint8Array)||shard.bytes.length!==shard.length||shard.length>262144||sha(shard.bytes)!==shard.sha256)throw Error('qualification_result_sha');
   const parsed=JSON.parse(Buffer.from(shard.bytes).toString());
   if(parsed.schema!=='marker-qualification-results-v1'||parsed.invocation!==inv.id||!equal(parsed.expected,expected)||!equal(parsed.pins,pins)||parsed.first!==rows.length||parsed.first!==shard.first||parsed.last!==shard.last||parsed.rows.length>256||parsed.last!==parsed.first+parsed.rows.length-1)throw Error('qualification_result_range');
   rows.push(...parsed.rows);
  }
  validateRows(inv,rows);
  for(const [index,row] of rows.entries()){const id=inv.rows[index].id;if(allIds.has(id))throw Error('qualification_result_duplicate');allIds.add(id);count++;passed&&=row.status==='pass';}
 }
 return {count,passed,union:binding(invocations.flatMap(i=>i.rows))};
}
