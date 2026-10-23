import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { decodeMarkerVisuals } from '../../scripts/event-marker-record.mjs';
import { associateContext } from '../../scripts/event-marker-association.mjs';
import { packMarkerRecord, validateMarkerRecord } from '../../scripts/event-marker-evidence.mjs';
// Complete literal PCM/pixel fixture, no encoder, process, network or provider.
function measured() {
  const count=408000,pcm=Buffer.alloc(count*2),audioRows=[];
  for(let i=0;i<count;i++) {
    const start=62400+Math.floor((i-62400)/48000)*48000;
    const on=i>=62400&&i<307200&&i-start<4800;
    if(on)pcm.writeInt16LE(Math.round(.65*Math.sin(2*Math.PI*700*(i-start)/48000)*32768),i*2);
  }
  for(let i=0;i<count;i+=1024)audioRows.push({index:audioRows.length,pts:i,samples:Math.min(1024,count-i)});
  const rgb=Buffer.alloc(241*6),videoRows=[];
  for(let i=0;i<=240;i++) {
    videoRows.push({index:i,pts:i*3000});if(i>=30)rgb[i*6]=255;
    if(i>=39&&i<189&&(i-39)%30<3)rgb.fill(255,i*6+3,i*6+6);
  }
  const r={...decodeSourceAudio([pcm],audioRows),...decodeMarkerVisuals(rgb,videoRows),recordingSha256:'a'.repeat(64),audioStreamIndex:1,videoStreamIndex:0,
    watermarks:[{identity:'a',selectionTick:30,selectionVideoPts:90000,selectionSourcePts:0,firstPulseTick:39,firstPulseSourcePts:27000,carryIn:false}]};
  r.episodes.forEach((e,id)=>e.id=id);r.visuals.forEach(v=>v.watermark=0);
  r.contexts=[associateContext(r,{kind:'transition',identity:'a',start:90000,end:450000,selection:90000,fullVisualIds:[0,1,2,3]})];
  return r;
}
test('marker receipt revalidates actual literal fits references and complete partition',()=>{
  const record=packMarkerRecord(measured());assert.equal(validateMarkerRecord(record).valid,true);
  assert.equal(record.metadataSamples*2,record.decodedBytes);
});
test('marker receipt rejects old schema and tampered measured identity pairs or conservation',()=>{
  const record=packMarkerRecord(measured());
  for(const mutate of [r=>delete r.schema,r=>r.episodes[0][5]=2,r=>r.contexts[0][5][0][3]++,r=>r.contexts[0][6].pop(),r=>r.metadataSamples++,r=>r.identityEpochs.shift(),r=>r.visuals[0][2]=r.visuals[0][1],r=>r.coefficientAndConditionRanges[0].max[3]=101,r=>r.coefficientAndConditionRanges[0].invalidFits++]) {
    const r=structuredClone(record);mutate(r);assert.throws(()=>validateMarkerRecord(r),/marker_/);
  }
});
