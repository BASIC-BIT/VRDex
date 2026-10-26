import { audioEpisodeRawRange } from '../event-marker-clock.mjs';
import { bindMarkerSelections } from '../event-marker-contexts.mjs';
import { associateContext } from '../event-marker-association.mjs';
import { markerOffset } from '../event-source-markers.mjs';
import { validateIdentityEpochs } from '../event-marker-record.mjs';
const check=(value,code)=>{if(!value)throw Error(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const overlap=(a,b,c,d)=>a<d&&b>c;
export function bindSceneDescriptors({scene,submitted,record,videoRows}) {
 const bindings=bindMarkerSelections(record,submitted.selections);
 check(bindings.length===2,'selection_count');
 const origin=videoRows[0].pts,selected=bindings[1].context,start=origin+(scene.scene.geometry?.steadyWindowVideoPts?.[0]??scene.selectionTick*3000),end=origin+(scene.scene.geometry?.steadyWindowVideoPts?.[1]??scene.selectionTick*3000+540000);
 const full=record.visuals.filter(v=>v.identity===scene.selected&&v.start>start+18000&&v.start<end-18000);
 const descriptors={first_transition:bindings[0].context,selected_transition:selected,selected_steady:{kind:'steady',identity:scene.selected,selection:selected.selection,start,end,fullVisualIds:full.map(v=>v.id),carryVisualId:selected.carryVisualId}};
 return {origin,descriptors};
}
export function observeSceneContexts({scene,submitted,record,videoRows,reference}) {
 const {origin,descriptors}=bindSceneDescriptors({scene,submitted,record,videoRows});
 const contexts=Object.fromEntries(Object.entries(descriptors).map(([key,c])=>[key,{...c,...associateContext(record,c)}]));
 return {origin,contexts,record,videoRows,reference,selections:submitted.selections,tones:scene.tones,sourceFrames:submitted.sourceFrames,sceneName:scene.name};
}
function evaluateRule(rule,context,observation) {
 const {record,origin,videoRows,reference,tones,selections,sourceFrames}=observation;
 const {episodes,visuals}=record,full=context.fullVisualIds.map(id=>visuals.find(v=>v.id===id));
 const visual=ordinal=>{
  const pts=videoRows[ordinal]?.pts,found=visuals.filter(v=>v.start===pts);
  check(found.length===1,'visual_selector');return found[0];
 };
 const candidate=(v,source=context.identity)=>episodes.filter(e=>e.identity===source&&Math.abs(markerOffset(e.onset,v.start))<360000&&markerOffset(e.onset,context.selection)>=-72000);
 const pairFor=v=>context.pairs.find(p=>p.visualId===v.id);
 const pairPass=v=>{const p=pairFor(v);return !!p&&Math.abs(p.offsetNumerator)<=72000&&candidate(v).length===1;};
 const inputEpisodes=(start,end)=>episodes.filter(e=>overlap(e.onset*15,e.end*15,origin*8+start*15,origin*8+end*15));
 const episode=(start)=>{
  const inputs=tones.filter(t=>t.start===start);check(inputs.length>0,'source_selector');
  const found=inputEpisodes(start,Math.max(...inputs.map(t=>t.start+t.samples)));check(found.length===1,'episode_selector');return found[0];
 };
 const disposition=e=>context.dispositions.find(d=>d.episodeId===e.id);
 const boundedOriginal=e=>reference.episodes.some(r=>equal(audioEpisodeRawRange(e),r));
 const relevant=context.dispositions.map(d=>episodes.find(e=>e.id===d.episodeId));
 switch(rule.rule) {
  case 'complete_context_coverage': {
   check(equal(full.map(v=>videoRows.findIndex(r=>r.pts===v.start)),rule.fullVisualFrameOrdinals),'full_visual_ordinals');
   const begin=Math.min(context.start,...full.map(v=>v.start-45000)),end=Math.max(context.end,...full.map(v=>v.start+45000));
   check(record.audioRange[0]*15<=begin*8&&record.audioRange[1]*15>=end*8&&record.videoRange[0]<=context.start&&record.videoRange[1]>=context.end,'context_coverage');break;
  }
  case 'reference_and_partition_conservation': {
   validateIdentityEpochs(record);
   check(new Set(episodes.map(e=>e.id)).size===episodes.length&&new Set(visuals.map(v=>v.id)).size===visuals.length&&episodes.every(boundedOriginal),'original_references');
   const actual=associateContext(record,context);
   check(equal(actual.pairs,context.pairs)&&equal(actual.dispositions,context.dispositions)&&equal(actual.failures,context.failures)&&actual.valid===context.valid,'partition_changed');
   const wm=record.watermarks.find(w=>w.selectionVideoPts===context.selection&&w.identity===context.identity);
   check(!!wm&&selections.some(s=>s.tick===wm.selectionTick&&s.sourcePts===wm.selectionSourcePts&&s.identity===wm.identity),'watermark_provenance');break;
  }
  case 'full_pairs':check(context.pairs.length===rule.count&&full.every(pairPass)&&context.pairs.every(p=>episodes[p.episodeId].identity===rule.classification),'full_pairs');break;
  case 'observed_episode': {
   const e=episode(rule.sourceInputOnsetSample);check(e.identity===rule.classification&&boundedOriginal(e),'observed_episode');
   if(rule.classifierReason)check(e.reason===rule.classifierReason,'episode_classifier_reason');
   if(rule.intersectsCurrentInterval)check(overlap(e.onset*15,e.end*15,context.start*8,context.end*8),'episode_context_intersection');
   if(rule.disposition)check(disposition(e)?.code===rule.disposition,'episode_disposition');
   if(rule.failureReason)check(context.failures.includes(rule.failureReason),'episode_failure_reason');
   if(rule.onsetAfterSelectionFrame!==undefined)check(markerOffset(e.onset,videoRows[rule.onsetAfterSelectionFrame].pts)>0,'episode_after_selection');
   if(rule.conservativeEndAtMostSelectionPlusSamples!==undefined)check(e.end*15<=videoRows[rule.selectionFrameOrdinal].pts*8+rule.conservativeEndAtMostSelectionPlusSamples*15,'tail_end');
   if(rule.notPreviousEpochTail||rule.cannotBePreviousTail)check(disposition(e)?.code!=='previous_epoch_tail','wrong_tail_exemption');
   if(rule.notEligibleForTailOrFragment)check(disposition(e)?.code==='failure','unknown_exemption');
   if(rule.loudSamplesLessThan!==undefined)check(e.loudEnd<rule.loudSamplesLessThan,'short_episode');
   if(rule.openFenceVideoTicks)check(e.onset*15>(origin+rule.openFenceVideoTicks[0])*8&&e.onset*15<(origin+rule.openFenceVideoTicks[1])*8,'episode_open_fence');
   if(rule.expectedSource){const v=visual(rule.visualFrameOrdinal);check(v.identity===rule.expectedSource&&e.identity!==rule.expectedSource&&Math.abs(markerOffset(e.onset,v.start))<360000,'wrong_source_identity');}
   if(rule.carrierHz)check(tones.some(t=>t.start===rule.sourceInputOnsetSample&&t.frequency===rule.carrierHz),'source_carrier');break;
  }
  case 'unique_first_full_candidate_outside_av_gate': {
   const v=visual(rule.visualFrameOrdinal),c=candidate(v);check(c.length===1,'unique_candidate');const delta=Math.abs(markerOffset(c[0].onset,v.start));
   check(delta>rule.absoluteOffsetNumeratorGreaterThan&&delta<rule.absoluteOffsetNumeratorLessThan&&full.filter(f=>f.id!==v.id).every(pairPass),'measured_outside_gate');break;
  }
  case 'first_source_four_full_candidates_pass':check(rule.frameOrdinals.map(visual).every(pairPass),'first_full_pairs');break;
  case 'excluded_steady_visual_single_episode': {
   const v=visual(rule.visualFrameOrdinal),e=episode(rule.sourceInputOnsetSample);check(!context.fullVisualIds.includes(v.id)&&e.identity===rule.classification&&disposition(e)?.code===rule.disposition&&disposition(e)?.visualId===v.id&&!context.pairs.some(p=>p.episodeId===e.id),'steady_single_fragment');break;
  }
  case 'complete_missing_source_slot': {
   check(inputEpisodes(rule.sourceInputOnsetSample,rule.sourceInputOnsetSample+4800).length===0,'missing_slot_not_empty');
   const v=full.at(-1);check(episodes.filter(e=>Math.abs(markerOffset(e.onset,v.start))<360000).length===1&&pairPass(v),'missing_slot_full_fence');break;
  }
  case 'missing_full_candidate': {
   const v=visual(rule.visualFrameOrdinal);check(candidate(v).length===0&&!pairFor(v)&&full.filter(f=>f.id!==v.id).every(pairPass),'missing_candidate');break;
  }
  case 'excluded_steady_visual': {
   const v=visual(rule.visualFrameOrdinal);check(!context.fullVisualIds.includes(v.id)&&!context.pairs.some(p=>p.visualId===v.id)&&!context.dispositions.some(d=>d.visualId===v.id),'absent_steady_fragment');
   check(episodes.filter(e=>e.identity===context.identity&&e.onset*15>=(v.start-9000)*8&&e.onset*15<(v.end+9000)*8).length===0,'absent_steady_audio');break;
  }
  case 'other_first_full_pairs_pass':check(context.pairs.length===rule.count&&context.pairs.every(p=>Math.abs(p.offsetNumerator)<=72000),'remaining_first_pairs');break;
  case 'same_source_candidate_count': {
   const v=visual(rule.visualFrameOrdinal),c=candidate(v);check(c.length===rule.count,'candidate_count');
   if(rule.fartherThan100msStillCounts)check(c.some(e=>Math.abs(markerOffset(e.onset,v.start))>72000),'far_candidate');
   if(rule.competitorOutsideSteadyWindow)check(c.some(e=>e.onset*15<observation.contexts.selected_steady.start*8||e.onset*15>=observation.contexts.selected_steady.end*8),'external_candidate');break;
  }
  case 'excluded_steady_visual_multiple_episodes': {
   const v=visual(rule.visualFrameOrdinal),c=episodes.filter(e=>e.identity===context.identity&&overlap(e.onset*15,e.end*15,(v.start-9000)*8,(v.end+9000)*8));
   check(!context.fullVisualIds.includes(v.id)&&c.length===rule.episodeCount&&c.every(e=>!context.pairs.some(p=>p.episodeId===e.id))&&context.failures.includes('fragment_multiple_episode'),'multiple_fragment');break;
  }
  case 'unaffected_full_candidates_pass':check(full.filter(v=>rule.exceptVisualFrameOrdinal===null||v.id!==visual(rule.exceptVisualFrameOrdinal).id).every(pairPass),'unaffected_pairs');break;
  case 'wrong_source_full_candidates': {
   const target=rule.allSelectedPulses?full:full.slice(0,1);
   check(target.every(v=>candidate(v).length===0&&episodes.some(e=>['a','b'].includes(e.identity)&&e.identity!==context.identity&&Math.abs(markerOffset(e.onset,v.start))<360000)),'wrong_source_candidates');
   if(!rule.allSelectedPulses)check(full.slice(1).every(pairPass),'wrong_source_remaining');break;
  }
  case 'selected_full_candidates_pass':check(context.pairs.length===rule.count&&full.every(pairPass),'selected_full_pairs');break;
  case 'actual_carry_in_reference': {
   const s=selections.find(s=>origin+s.tick*3000===context.selection),wm=record.watermarks.find(w=>w.selectionVideoPts===context.selection),carry=context.carryIn;
   check(s?.carryIn===true&&wm?.carryIn===true&&carry&&sourceFrames[context.identity]?.[rule.sourceOnsetFrameOrdinal]?.flash===true,'carry_provenance');
   const v=visuals.find(v=>v.id===carry.visualId);check(v.start===context.selection&&!context.fullVisualIds.includes(v.id),'carry_partition');
   if(rule.audioFragmentSourceOnsetSample===null)check(carry.episodeId===null,'carry_null');
   else if(rule.audioFragmentSourceOnsetSample!==undefined)check(episode(rule.audioFragmentSourceOnsetSample).id===carry.episodeId,'carry_episode');
   if(carry.episodeId!==null)check(!context.pairs.some(p=>p.episodeId===carry.episodeId),'carry_full_overlap');
   if(rule.allFullPairsPass)check(full.every(pairPass),'carry_full_pairs');
   if(rule.submittedFragmentFrames)check(v.end===videoRows[rule.submittedFragmentFrames[1]].pts&&v.start===videoRows[rule.submittedFragmentFrames[0]].pts,'carry_frame_extent');break;
  }
  case 'one_contiguous_cross_source_episode': {
   const found=inputEpisodes(...rule.sourceInputRangeSamples);check(found.length===1&&rule.classificationOneOf.includes(found[0].identity)&&boundedOriginal(found[0])&&found[0].reason!=='none'&&relevant.some(e=>e.id===found[0].id),'cross_source_episode');break;
  }
  case 'extra_episode_outside_context_union': {
   const e=episode(rule.sourceInputOnsetSample);check(!context.dispositions.some(d=>d.episodeId===e.id),'outside_context_union');break;
  }
  case 'all_relevant_tone_episodes_unknown':check(relevant.length>0&&relevant.every(e=>e.identity==='unknown'&&boundedOriginal(e))&&rule.fullVisualFrameOrdinals.map(visual).every(v=>episodes.some(e=>e.identity==='unknown'&&Math.abs(markerOffset(e.onset,v.start))<360000))&&tones.every(t=>t.frequency===1000),'legacy_unknown');break;
  default:throw Error('unsupported_scene_rule');
 }
}
function expectedReason(expected,observation) {
 if(expected.reason!=='unclassified_cross_source_episode')return expected.reason;
 const cross=observation.record.episodes.filter(e=>e.onset*15<(observation.origin+450000)*8&&e.end*15>(observation.origin+450000)*8);
 check(cross.length===1&&['mixed','unknown'].includes(cross[0].identity),'cross_reason');return cross[0].identity+'_competitor';
}
export function matchSceneContract(contract,observation) {
 try {
  check(equal(Object.keys(observation.contexts),['first_transition','selected_transition','selected_steady']),'context_keys');
  for(const [key,expected] of Object.entries(contract.contexts)) {
   const actual=observation.contexts[key],reason=expectedReason(expected,observation);
   if(contract.requiredClassifierReasonsByClass){const cross=observation.record.episodes.filter(e=>e.onset*15<(observation.origin+450000)*8&&e.end*15>(observation.origin+450000)*8);check(cross.length===1&&contract.requiredClassifierReasonsByClass[cross[0].identity]?.includes(cross[0].reason),'cross_classifier_reason');}
   check(actual.identity===expected.source&&equal([actual.start-observation.origin,actual.end-observation.origin],expected.windowVideoTicks),'context_coordinates');
   if(expected.exactReasons!==undefined) {
    const primary=reason==='source_mismatch'?'foreign_interval':['insufficient_fragment_samples','unknown_fragment'].includes(reason)?'unknown_competitor':reason;
    check(Array.isArray(expected.exactReasons)&&(expected.status==='pass'?reason==='none'&&expected.exactReasons.length===0:expected.status==='fail'&&reason!=='none'&&expected.exactReasons.includes(primary)),'context_reason_consistency');
    check(Array.isArray(expected.exactReasons)&&equal(expected.exactReasons,[...new Set(expected.exactReasons)].sort())&&equal([...actual.failures].sort(),expected.exactReasons)&&actual.valid===(expected.exactReasons.length===0)&&expected.status===(actual.valid?'pass':'fail'),'exact_context_reasons');
    if(expected.requiredFullPairCount!==undefined)check(actual.pairs.length===expected.requiredFullPairCount,'required_pair_count');
   } else if(expected.status==='pass')check(actual.valid&&actual.failures.length===0,'unexpected_context_failure');
   else {
    check(expected.status==='fail'&&!actual.valid,'context_expected_failure');
    const primary=reason==='source_mismatch'?'foreign_interval':['insufficient_fragment_samples','unknown_fragment'].includes(reason)?'unknown_competitor':reason;
    check(actual.failures.includes(primary),'wrong_context_reason');
    // A non-selected/unknown carrier also leaves its full visual unpaired.
    // Preserve both observed reasons; the required candidate rules below prove
    // the causal relationship and every unaffected full pair separately.
    const allowed=new Set([primary,...(['foreign_interval','unknown_competitor','mixed_competitor'].includes(primary)?['missing_audio']:[]),...(primary==='duplicate_source_candidate'?['unaccounted_episode']:[])]);
    check(actual.failures.every(r=>allowed.has(r)),'unrelated_context_failure');
   }
   for(const rule of expected.requiredEvidence)evaluateRule(rule,actual,observation);
  }
  return {status:'pass',facts:{contexts:Object.values(observation.contexts).map(c=>({valid:c.valid,reasons:c.failures,pairs:c.pairs.length,maxOffset:Math.max(0,...c.pairs.map(p=>Math.abs(p.offsetNumerator)))}))}};
 }catch(error){return {status:'fail',reason:/^[a-z_]+$/.test(error.message)?error.message:'scene_contract_error'};}
}
