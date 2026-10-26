import { associateContext } from './event-marker-association.mjs';
import { IDENTITY_CODES, validateIdentityEpochs } from './event-marker-record.mjs';
const integer=n=>{if(!Number.isSafeInteger(n))throw Error('marker_integer');return n;};
const secondsToPts=n=>{if(!Number.isFinite(n))throw Error('marker_window');return integer(Math.round(n*90000));};
const requireValid=c=>{if(!c.valid)throw Error(`marker_context_failure:${c.failures.join(',')}`);return c;};
const pairSeconds=p=>({videoPts:p.videoPts/90000,audioPts:p.audioSample/48000,audioMinusVideoMs:p.offsetNumerator/720});

/** Bind independently decoded epochs to the existing submitted-frame watermarks.
 * Classifier output is consumed here; no selection facts enter its signal model. */
export function bindMarkerSelections(record,selections) {
 validateIdentityEpochs(record);
 if(!Array.isArray(selections)||selections.length>8)throw Error('marker_context_bound');
 const sourceEpochs=record.identityEpochs.filter(r=>r[1]===1||r[1]===2);
 const bindings=[];let origin;
 if(selections.length&&record.identityEpochs[0][1]!==IDENTITY_CODES.slate)throw Error('marker_preselection_coverage');
 for(const [index,s] of selections.entries()) {
  const epoch=sourceEpochs[index];
  for(const n of [s.tick,s.fps,s.sourcePts,s.endTick,s.lastSourcePts])integer(n);
  if(!epoch||epoch[1]!==IDENTITY_CODES[s.identity]||![30,60].includes(s.fps)||s.endTick!==s.tick+4*s.fps||!Array.isArray(s.pulses)||s.pulses.length<3||s.pulses.length>256||!Array.isArray(s.sourcePulses)||s.sourcePulses.length>256||typeof s.carryIn!=='boolean')throw Error('marker_selection_watermark');
  const start=epoch[0],end=integer(start+360000),step=90000/s.fps;
  origin??=integer(start-s.tick*step);
  // Existing one-frame correspondence allowance, now in integer PTS units.
  if(Math.abs(start-(origin+s.tick*step))>step+9)throw Error('marker_selection_alignment');
  if(record.videoRange[1]<end||record.audioRange[1]*15<(end+45000)*8)throw Error('marker_transition_coverage');
  for(const sourceOnset of s.sourcePulses) {
   integer(sourceOnset);if(sourceOnset>s.lastSourcePts)continue;
   if(s.pulses.filter(p=>p.sourcePts>=sourceOnset&&p.sourcePts-sourceOnset<=step).length!==1)throw Error('marker_unsubmitted_source_pulse');
  }
  const encoded=record.visuals.filter(v=>v.start>=start&&v.start<end);
  if(encoded.length!==s.pulses.length)throw Error('marker_encoded_flash_count');
  const watermark=record.watermarks.length;
  record.watermarks.push({identity:s.identity,selectionTick:s.tick,selectionVideoPts:start,selectionSourcePts:s.sourcePts,firstPulseTick:s.pulses[0].tick,firstPulseSourcePts:s.pulses[0].sourcePts,carryIn:s.carryIn});
  const submitted=new Map();let carryVisualId;
  for(let i=0;i<encoded.length;i++) {
   const v=encoded[i],p=s.pulses[i];integer(p.tick);integer(p.sourcePts);
   if(v.identity!==s.identity||p.tick<s.tick||p.tick>=s.endTick||(i&&p.tick<=s.pulses[i-1].tick)||Math.abs(v.start-(start+(p.tick-s.tick)*step))>step+9)throw Error('marker_encoded_flash_watermark');
   v.watermark=watermark;submitted.set(v.id,p);
   if(i===0&&s.carryIn&&p.tick===s.tick)carryVisualId=v.id;
  }
  if(s.carryIn&&carryVisualId===undefined)throw Error('marker_carry_watermark');
  bindings.push({selection:s,submitted,carryVisualId,context:{kind:'transition',identity:s.identity,selection:start,start,end,fullVisualIds:encoded.filter(v=>v.id!==carryVisualId).map(v=>v.id),carryVisualId}});
 }
 return bindings;
}

export function buildMarkerContexts(record,{selections=[],windows=[]}) {
 if(!Array.isArray(windows)||windows.length>8)throw Error('marker_context_bound');
 const bindings=bindMarkerSelections(record,selections),contexts=[],transitions=[];
 for(const b of bindings) {
  const {selection:s,submitted,carryVisualId}=b,{start,end}=b.context;
  const c=requireValid(associateContext(record,b.context));
  if(c.pairs.length<3)throw Error('marker_transition_full_count');contexts.push(c);
  transitions.push({identity:s.identity,revision:s.revision,programTick:s.tick,sourcePts:s.sourcePts,start:start/90000,end:end/90000,
   boundaryFragment:c.carryIn?{videoPts:record.visuals.find(v=>v.id===carryVisualId).start/90000,sourcePts:s.pulses[0].sourcePts,reason:'pulse-underway-at-selection',episodeId:c.carryIn.episodeId}:null,
   pairs:c.pairs.map(p=>({...pairSeconds(p),...submitted.get(p.visualId)})),complete:true});
 }
 const measured=windows.map(window=>{
  const start=secondsToPts(window.start),end=secondsToPts(window.end);
  if(end-start!==540000)throw Error('marker_steady_window');
  const epoch=record.identityEpochs.findLast(r=>r[0]<=start);
  const identity=window.identity??Object.keys(IDENTITY_CODES).find(k=>IDENTITY_CODES[k]===epoch?.[1]);
  if(!epoch||!['a','b'].includes(identity)||epoch[1]!==IDENTITY_CODES[identity])throw Error('marker_steady_identity');
  const full=record.visuals.filter(v=>v.identity===identity&&v.start>start+18000&&v.start<end-18000);
  if(full.length<5)throw Error('marker_steady_full_count');
  const c=requireValid(associateContext(record,{kind:'steady',identity,selection:epoch[0],start,end,fullVisualIds:full.map(v=>v.id)}));contexts.push(c);
  return {...window,identity,visualMarkers:full.length,audioMarkers:c.pairs.length,pairs:c.pairs.map(pairSeconds)};
 });
 return {contexts,transitions,measured};
}
