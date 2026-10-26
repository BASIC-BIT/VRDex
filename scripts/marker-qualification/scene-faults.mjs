import { audioEpisodeRawRange } from '../event-marker-clock.mjs';
import { createHash } from 'node:crypto';
import { bindSceneDescriptors,matchSceneContract } from './scene-policy.mjs';
import { associateContext } from '../event-marker-association.mjs';
import { decodeSourceAudio } from '../event-source-markers.mjs';
const sha=value=>createHash('sha256').update(value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const check=(value,reason)=>{if(!value)throw Error(reason);};
const blocked=descriptors=>Object.fromEntries(Object.entries(descriptors).map(([key,c])=>[key,{identity:c.identity,selection:c.selection,start:c.start,end:c.end,status:'blocked',pairs:[],dispositions:[]} ]));
export function observeGlobalScene(input) {
 const {origin,descriptors}=bindSceneDescriptors(input);
 return {origin,globalFailure:input.classificationFailure,contexts:blocked(descriptors),reference:input.reference,record:input.record,tones:input.scene.tones,mutation:null};
}
export function applySceneFault(contract,baseline,material) {
 const copy=structuredClone(baseline),name=baseline.sceneName,originalSha256=sha(baseline);let caught,details={};
 try {
  if(name==='truncated_closure') {
   const selected=copy.contexts.selected_transition.identity,e=copy.record.episodes.filter(e=>e.identity===selected).at(-1);
   audioEpisodeRawRange(e);
   const endpoint=e.lastLoudRight,cut=endpoint.raw,count=endpoint.ordinal;
   const rows=material.audioRows.slice(0,endpoint.row+1).map((r,index)=>({...r,samples:index===endpoint.row?endpoint.inRow:r.samples}));
   const bytes=material.pcm.subarray(0,count*2);
   details={cut,originalBytes:material.pcm.length,viewBytes:bytes.length,originalPcmSha256:sha(material.pcm),viewPcmSha256:sha(bytes),originalRows:material.audioRows.length,viewRows:rows.length,viewSamples:rows.reduce((n,r)=>n+r.samples,0)};
   copy.record.audioRange[1]=cut;copy.record.decodedBytes=bytes.length;copy.record.metadataSamples=count;
   decodeSourceAudio([bytes],rows);
  } else if(name==='missing_watermark') {
   const c=copy.contexts.selected_transition;copy.record.visuals.find(v=>v.id===c.carryVisualId).watermark=-1;associateContext(copy.record,c);
  } else if(name==='duplicate_visual_reference') {
   const c=copy.contexts.selected_transition;copy.record.visuals.push(structuredClone(copy.record.visuals.find(v=>v.id===c.fullVisualIds[0])));associateContext(copy.record,c);
  } else if(name==='full_fragment_overlap') {
   const c=copy.contexts.selected_transition;c.carryVisualId=c.fullVisualIds[0];associateContext(copy.record,c);
  } else throw Error('unknown_fault');
 }catch(error){caught=error.message;}
 const allowed={truncated_closure:['marker_unmatched_eof','unmatched_closure'],missing_watermark:['marker_carry_reference','watermark_missing'],duplicate_visual_reference:['marker_visual_reference','visual_reference_duplicate'],full_fragment_overlap:['marker_full_fragment_overlap','full_fragment_overlap']};
 const pair=allowed[name],globalFailure=pair&&caught===pair[0]?pair[1]:'unexpected_fault';
 return {origin:baseline.origin,globalFailure,contexts:blocked(baseline.contexts),baseline,mutated:copy,mutation:{name,actualError:caught,originalSha256,changedSha256:sha(copy),...details}};
}
export function matchGlobalSceneContract(contract,observed) {
 try {
  check(Object.keys(observed.contexts).join(',')==='first_transition,selected_transition,selected_steady','global_contexts');
  check(observed.globalFailure===contract.outcome,'global_reason');
  for(const [key,c] of Object.entries(contract.contexts)) {
   const actual=observed.contexts[key];
   check(c.status==='blocked'&&c.reason===observed.globalFailure&&actual.status==='blocked'&&actual.pairs.length===0&&actual.dispositions.length===0&&actual.identity===c.source&&actual.start-observed.origin===c.windowVideoTicks[0]&&actual.end-observed.origin===c.windowVideoTicks[1],'global_context_vector');
  }
  if(contract.outcome==='episode_bound') {
   check(!observed.mutation&&observed.reference.samples===observed.record.metadataSamples&&observed.reference.bytes===observed.record.decodedBytes&&observed.reference.blocks.reduce((n,b)=>n+b[2],0)===observed.reference.samples,'global_original_conservation');
   const rule=contract.contexts.first_transition.requiredEvidence.find(r=>r.rule==='global_episode_bound'),[start,end]=rule.sourceInputRangeSamples;
   const episodes=observed.reference.episodes.filter(e=>e[0]*15<(observed.origin*8+end*15)&&e[2]*15>(observed.origin*8+start*15));
   check(episodes.length===1&&episodes[0][1]-episodes[0][0]>12000&&episodes[0][2]>episodes[0][1]&&observed.tones.some(t=>t.start===start&&t.start+t.samples===end),'global_contiguous_bound');
   return {status:'pass',facts:{reason:'episode_bound',episode:episodes[0],samples:observed.reference.samples,bytes:observed.reference.bytes}};
  }
  check(contract.unmutatedBaselineContexts&&Object.values(contract.unmutatedBaselineContexts).every(c=>c.status==='pass'&&c.reason==='none'&&(!c.exactReasons||c.exactReasons.length===0))&&Object.values(observed.baseline.contexts).every(c=>c.valid===true&&c.failures.length===0),'baseline_must_pass');
  check(contract.unmutatedBaselineContexts&&matchSceneContract({contexts:contract.unmutatedBaselineContexts},observed.baseline).status==='pass','unmutated_baseline_contract');
  const m=observed.mutation;check(m&&m.originalSha256===sha(observed.baseline)&&m.changedSha256===sha(observed.mutated)&&m.changedSha256!==m.originalSha256,'mutation_sha');
  const expectedCopy=structuredClone(observed.baseline),c=expectedCopy.contexts.selected_transition;
  if(contract.outcome==='watermark_missing')expectedCopy.record.visuals.find(v=>v.id===c.carryVisualId).watermark=-1;
  else if(contract.outcome==='full_fragment_overlap')c.carryVisualId=c.fullVisualIds[0];
  else if(contract.outcome==='visual_reference_duplicate')expectedCopy.record.visuals.push(structuredClone(expectedCopy.record.visuals.find(v=>v.id===c.fullVisualIds[0])));
  else if(contract.outcome==='unmatched_closure'){expectedCopy.record.audioRange[1]=m.cut;expectedCopy.record.decodedBytes=m.viewBytes;expectedCopy.record.metadataSamples=m.viewSamples;}
  check(sha(expectedCopy)===sha(observed.mutated),'exact_mutation_delta');
  if(contract.outcome==='unmatched_closure') {
   check(m.actualError==='marker_unmatched_eof'&&m.viewBytes===m.viewSamples*2&&m.viewBytes<m.originalBytes&&m.viewPcmSha256!==m.originalPcmSha256&&m.viewRows<=m.originalRows,'closure_mutation');
  }else{
   const expected={watermark_missing:'marker_carry_reference',visual_reference_duplicate:'marker_visual_reference',full_fragment_overlap:'marker_full_fragment_overlap'};
   check(m.actualError===expected[contract.outcome],'reference_mutation');
  }
  return {status:'pass',facts:{reason:observed.globalFailure,originalSha256:m.originalSha256,changedSha256:m.changedSha256}};
 }catch(error){return {status:'fail',reason:/^[a-z_]+$/.test(error.message)?error.message:'global_contract_error'};}
}
