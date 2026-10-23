import assert from 'node:assert/strict';
import { decodeSourceAudio } from '../event-source-markers.mjs';
import { decodeMarkerVisuals } from '../event-marker-record.mjs';
import { validateMarkerRecord } from '../event-marker-evidence.mjs';
import { associateContext } from '../event-marker-association.mjs';
import { literalPcm } from './signals.mjs';
import { sourceMarkerFixture } from '../../tests/fixtures/source-marker-literal.mjs';
export function executeMalformed(name) {
 const signal=literalPcm({family:'pure',source:'a'});let chunks=[signal.pcm],rows=structuredClone(signal.rows),reason;
 const metadata={metadata_gap:()=>rows[1].pts++,metadata_overlap:()=>rows[1].pts--,duplicate_pts:()=>rows[1].pts=rows[0].pts,duplicate_index:()=>rows[1].index=0,fractional_pts:()=>rows[0].pts=.5,nan_pts:()=>rows[0].pts=NaN,infinite_pts:()=>rows[0].pts=Infinity,zero_samples:()=>rows[0].samples=0,negative_samples:()=>rows[0].samples=-1,nonnumeric_samples:()=>rows[0].samples='1024',pcm_short_byte:()=>chunks=[signal.pcm.subarray(1)],pcm_extra_byte:()=>chunks=[signal.pcm,Buffer.alloc(1)]};
 if(Object.hasOwn(metadata,name)) {metadata[name]();try{decodeSourceAudio(chunks,rows);}catch(error){reason=error.message;}assert.match(reason??'',/^marker_(audio_metadata|audio_continuity|pcm_length)$/);return {reason};}
 if(name==='unmatched_eof') {
  const pcm=signal.pcm.subarray(0,5760*2);rows=[{index:0,pts:0,samples:5760}];assert.throws(()=>decodeSourceAudio([pcm],rows),/marker_unmatched_eof/);return {reason:'marker_unmatched_eof'};
 }
 if(name==='ill_conditioned_fit') {
  const pcm=Buffer.alloc(8);for(let i=0;i<3;i++)pcm.writeInt16LE(22000,i*2);
  const actual=decodeSourceAudio([pcm],[0,1,2,3].map(index=>({index,pts:index,samples:1})));
  assert.equal(actual.episodes.length,1);assert(actual.episodes[0].fits.every(f=>f.code===2));assert.equal(actual.episodes[0].identity,'unknown');return {class:'unknown',fitCodes:actual.episodes[0].fits.map(f=>f.code)};
 }
 if(name==='unclosed_visual') {
  assert.throws(()=>decodeMarkerVisuals(Buffer.from([255,0,0,255,255,255]),[{index:0,pts:0}]),/marker_visual_unmatched_eof/);return {reason:'marker_visual_unmatched_eof'};
 }
 if(name==='fragment_multiple_episode'||name==='carryin_null_with_episode') {
  const r={videoRange:[0,900000],audioRange:[0,500000],identityEpochs:[[0,4],[90000,1]],watermarks:[{identity:'a',selectionVideoPts:90000,selectionTick:30,selectionSourcePts:9000,firstPulseTick:30,firstPulseSourcePts:9000,carryIn:true}],visuals:[{id:0,start:90000,end:99000,identity:'a',watermark:0}],episodes:[{id:0,onset:48000,end:49440,identity:'a'},{id:1,onset:49920,end:51840,identity:'a'}]};
  const c={kind:'transition',identity:'a',selection:90000,start:90000,end:450000,fullVisualIds:[],carryVisualId:0};
  if(name==='fragment_multiple_episode'){const actual=associateContext(r,c);assert(actual.failures.includes('fragment_multiple_episode'));return {reason:'fragment_multiple_episode'};}
  const wire=sourceMarkerFixture().markerEvidence;
  wire.visuals[0][1]-=27000;wire.visuals[0][2]-=27000;wire.episodes[0][0]-=14400;
  wire.watermarks[0][3]=wire.watermarks[0][0];wire.watermarks[0][4]=wire.watermarks[0][2];wire.watermarks[0][5]=true;
  wire.contexts[0][5].shift();wire.contexts[0][6][0][1]=2;wire.contexts[0][7]=[[0,0]];wire.contextCounts[1]--;
  assert.equal(validateMarkerRecord(wire).valid,true);
  wire.contexts[0][7][0][1]=null;
  assert.throws(()=>validateMarkerRecord(wire),/marker_context_partition/);
  return {reason:'marker_context_partition',forgedAbsentAudioRejected:true};
 }
 const record=sourceMarkerFixture().markerEvidence;
 const mutations={nan_fit:r=>r.coefficientAndConditionRanges[0].min[0]=NaN,duplicate_onset:r=>r.episodes[1][0]=r.episodes[0][0],missing_visual:r=>r.visuals.pop(),duplicate_visual:r=>r.visuals[1][0]=0,overlap_visual:r=>r.visuals[1][1]=r.visuals[0][1]+1,missing_watermark:r=>r.watermarks.pop(),inconsistent_watermark:r=>r.watermarks[0][6]=2,duplicate_disposition:r=>r.contexts[0][6].push([...r.contexts[0][6][0]]),fragment_full_overlap:r=>r.contexts[0][7]=[[r.contexts[0][5][0][0],r.contexts[0][5][0][2]]]};
 if(!Object.hasOwn(mutations,name))throw Error('literal_malformed_unimplemented');
 mutations[name](record);try{validateMarkerRecord(record);}catch(error){reason=error.message;}
 assert.match(reason??'',/^marker_/);return {reason};
}
