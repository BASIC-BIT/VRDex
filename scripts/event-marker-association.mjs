import { markerOffset } from './event-source-markers.mjs';
import { precedingIdentityAt, IDENTITY_CODES } from './event-marker-record.mjs';
const integer=n=>{if(!Number.isSafeInteger(n))throw Error('marker_integer');return n;};
const intersects=(start,end,left,right)=>start<right&&end>left;
const audioIntersects=(e,left,right)=>intersects(integer(15*e.onset),integer(15*e.end),integer(8*left),integer(8*right));
const candidate=(e,v)=>Math.abs(markerOffset(e.onset,v.start))<360000;
const classes=new Set(['a','b','unknown','mixed']);

/** Full global interval partition. Returns failures as facts, never a nearest pair. */
export function associateContext(record,context) {
  const {visuals,episodes,watermarks,audioRange,videoRange}=record;
  if(!Array.isArray(visuals)||visuals.length>4096||!Array.isArray(episodes)||episodes.length>4096||!Array.isArray(watermarks)||watermarks.length>64)throw Error('marker_evidence_bound');
  const visualMap=new Map(),episodeMap=new Map();
  for(const v of visuals) {
    [v.id,v.start,v.end,v.watermark].forEach(integer);
    if(visualMap.has(v.id)||v.end<=v.start||!['a','b','slate'].includes(v.identity)||v.watermark< -1||v.watermark>=watermarks.length)throw Error('marker_visual_reference');
    visualMap.set(v.id,v);
  }
  for(const e of episodes) {
    [e.id,e.onset,e.end].forEach(integer);
    if(episodeMap.has(e.id)||e.end<=e.onset||!classes.has(e.identity))throw Error('marker_episode_reference');
    episodeMap.set(e.id,e);
  }
  const {kind,identity,start,end,selection}=context;
  const previousIdentity=precedingIdentityAt(record,selection);
  if(context.previousIdentity!==undefined&&context.previousIdentity!==previousIdentity)throw Error('marker_identity_predecessor');
  [start,end,selection,...audioRange,...videoRange].forEach(integer);
  if(!['transition','steady'].includes(kind)||!['a','b'].includes(identity)||end<=start)throw Error('marker_context');
  if(record.identityEpochs.findLast(row=>row[0]<=start)?.[1]!==IDENTITY_CODES[identity]||record.identityEpochs.some(row=>row[0]>start&&row[0]<end&&row[1]!==IDENTITY_CODES[identity]))throw Error('marker_context_identity');
  const fullIds=context.fullVisualIds;
  if(!Array.isArray(fullIds)||fullIds.length>256||new Set(fullIds).size!==fullIds.length)throw Error('marker_visual_reference');
  const full=fullIds.map(id=>{const v=visualMap.get(id);if(!v||v.identity!==identity)throw Error('marker_visual_reference');return v;});
  if(context.carryVisualId!=null&&fullIds.includes(context.carryVisualId))throw Error('marker_full_fragment_overlap');
  const relevant=episodes.filter(e=>audioIntersects(e,start,end)||full.some(v=>audioIntersects(e,v.start-45000,v.start+45000)));
  if(relevant.length>8192)throw Error('marker_reference_bound');
  const failures=new Set(),used=new Map(),pairs=[],claimedFragments=new Map();
  const fail=reason=>failures.add(reason);
  const coverageStart=Math.min(start,...full.map(v=>v.start-45000));
  const coverageEnd=Math.max(end,...full.map(v=>v.start+45000));
  if(integer(audioRange[0]*15)>integer(coverageStart*8)||integer(audioRange[1]*15)<integer(coverageEnd*8)||videoRange[0]>start||videoRange[1]<end)fail('incomplete_context_coverage');
  for(const v of full) {
    const references=relevant.filter(e=>audioIntersects(e,v.start-45000,v.start+45000));
    if(references.length>16)throw Error('marker_candidate_bound');
    const candidates=references.filter(e=>e.identity===identity&&candidate(e,v)&&markerOffset(e.onset,selection)>=-72000);
    if(candidates.length!==1) {fail(candidates.length?'duplicate_source_candidate':'missing_audio');continue;}
    const e=candidates[0];
    if(used.has(e.id)) {fail('duplicate_episode_use');continue;}
    const offset=markerOffset(e.onset,v.start);
    used.set(e.id,{episodeId:e.id,code:'paired_full',visualId:v.id});
    pairs.push({visualId:v.id,episodeId:e.id,videoPts:v.start,audioSample:e.onset,offsetNumerator:offset});
    if(Math.abs(offset)>72000)fail('av_out_of_bounds');
  }
  const carry=context.carryVisualId==null?undefined:visualMap.get(context.carryVisualId);
  if(context.carryVisualId!=null) {
    const w=carry&&watermarks[carry.watermark];
    if(!carry||!w||carry.identity!==identity||w.identity!==identity||w.carryIn!==true||w.selectionVideoPts!==selection||w.firstPulseTick!==w.selectionTick||w.firstPulseSourcePts!==w.selectionSourcePts||!(carry.start<=selection&&selection<carry.end))throw Error('marker_carry_reference');
  }
  const edges=kind==='steady'?visuals.filter(v=>v.identity===identity&&!fullIds.includes(v.id)&&!(v.start>start+18000&&v.start<end-18000)&&intersects(v.start,v.end,start,end)):[];
  const dispositions=[];
  for(const e of relevant) {
    if(used.has(e.id)) {dispositions.push(used.get(e.id));continue;}
    let code,visualId=-1;
    const inFull=full.some(v=>candidate(e,v));
    if(e.identity==='unknown'||e.identity==='mixed')fail(e.identity+'_competitor');
    else if(previousIdentity!=='slate'&&e.identity===previousIdentity&&markerOffset(e.onset,selection)<0&&markerOffset(e.end,selection)<=72000)code='previous_epoch_tail';
    else {
      const fragments=[...(carry?[carry]:[]),...edges.filter(v=>v.id!==carry?.id)].filter(v=>e.identity===identity&&!inFull&&audioIntersects(e,v.start-9000,v.end+9000));
      if(fragments.length===1) {
        const v=fragments[0];visualId=v.id;
        if(claimedFragments.has(v.id))fail('fragment_multiple_episode');
        else {claimedFragments.set(v.id,e.id);code=v===carry?'existing_carry_in_fragment':'existing_steady_edge_fragment';}
      } else if(fragments.length>1)fail('fragment_multiple_visual');
      else if(markerOffset(e.onset,selection)<-72000&&markerOffset(e.end,start)<=0&&!full.some(v=>audioIntersects(e,v.start-45000,v.start+45000)))code='recorded_pre_epoch_exclusion';
      else fail(e.identity===identity?'unaccounted_episode':'foreign_interval');
    }
    dispositions.push({episodeId:e.id,code:code??'failure',visualId});
  }
  if(dispositions.length!==relevant.length||new Set(dispositions.map(d=>d.episodeId)).size!==relevant.length)throw Error('marker_partition_conservation');
  return {kind,identity,start,end,selection,valid:failures.size===0,failures:[...failures],pairs,dispositions,carryIn:carry?{visualId:carry.id,episodeId:claimedFragments.get(carry.id)??null}:null,relevantEpisodeCount:relevant.length};
}
