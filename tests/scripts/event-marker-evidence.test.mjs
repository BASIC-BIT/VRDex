import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMarkerEvidenceSize } from '../../scripts/event-marker-evidence.mjs';
import { packMarkerLeaf } from '../../scripts/event-marker-wire.mjs';
import { MARKER_WIRE_LAYOUTS } from '../../scripts/event-marker-wire-layout.mjs';
// Structural bound witness only, not a physically valid receipt or admission.
function structural(){return Array.from({length:3},()=>({
  recordingSha256:'a'.repeat(64),audioStreamIndex:1,videoStreamIndex:0,metadataSamples:23040000,decodedBytes:46080000,detectorBlockCount:100000,
  coefficientAndConditionRanges:Array(8).fill([-.9999999999999999,.9999999999999999]),classCounts:[0,0,0,512],contextCounts:[16,768],outsideRequiredContexts:480,
  videoRange:[3790000000,3840000000],audioRange:[1990000000,2040000000],
  episodes:Array(512).fill(packMarkerLeaf('episode',Object.fromEntries(MARKER_WIRE_LAYOUTS.episode.fields.map(([name,type,count])=>[name,count===1?(type==='f64'?.9999999999999999:0):Array(count).fill(.9999999999999999)])))),
  visuals:Array.from({length:512},(_,i)=>[i,3790000000+i*90000,3790009000+i*90000,1,i%16]),
  watermarks:Array.from({length:16},(_,i)=>[999900+i,3790000000+i*90000,1999900000+i*48000,999900+i,1999900000+i*48000,true,1]),
  identityEpochs:Array.from({length:32},(_,i)=>[3790000000+i*90000,i%2?1:4]),
  contexts:Array.from({length:16},(_,i)=>[i%2,2,3799999999,3799999999,3800000000,Array.from({length:16},(_,j)=>[4095,3799999999,j,104400]),Array.from({length:32},(_,j)=>[j,j%6,4095]),[]])
}));}
test('marker evidence sizing retains all 32 identity epochs per recording inside original caps',(t)=>{
  const records=structural(),s=assertMarkerEvidenceSize(records);assert(s.bytes<=524288);assert(s.headersWithReserve<=8192);assert.equal(s.epochRows,96);
  t.diagnostic(JSON.stringify({structuralOnly:true,...s}));
});
test('marker evidence byte and count overflow fails without omission',()=>{
  const records=structural();assert.throws(()=>assertMarkerEvidenceSize([...records,...records]),/marker_evidence_bound/);
  records[0].identityEpochs.push([3900000000,4]);assert.throws(()=>assertMarkerEvidenceSize(records),/marker_identity_bound/);
});
test('marker evidence never rounds nonfinite or oversized diagnostic tuples to fit',()=>{
  const r=structural();r[0].coefficientAndConditionRanges[0][0]=NaN;assert.throws(()=>assertMarkerEvidenceSize(r),/marker_nonfinite/);
  const s=structural();s[0].episodes[0]+='x'.repeat(256);assert.throws(()=>assertMarkerEvidenceSize(s),/marker_episode_wire_bound/);
});
