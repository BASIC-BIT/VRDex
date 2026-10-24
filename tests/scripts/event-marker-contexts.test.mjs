import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkerContexts } from '../../scripts/event-marker-contexts.mjs';
const fixture=()=>({schema:'source-tones-v1',videoRange:[0,900000],audioRange:[0,500000],identityEpochs:[[0,4],[90000,1]],
 visuals:[0,1,2,3,4,5,6,7].map(i=>({id:i,start:117000+i*90000,end:126000+i*90000,identity:'a',watermark:-1})),
 episodes:[0,1,2,3,4,5,6,7].map(i=>({id:i,onset:62400+i*48000,end:67680+i*48000,identity:'a'})),watermarks:[]});
const selection=()=>({identity:'a',revision:1,tick:30,fps:30,sourcePts:0,endTick:150,lastSourcePts:357000,carryIn:false,
 pulses:[0,1,2,3].map(i=>({tick:39+i*30,sourcePts:27000+i*90000})),sourcePulses:[27000,117000,207000,297000]});
test('source contexts bind integer encoded epochs and original submitted source pulses',()=>{
 const record=fixture();const result=buildMarkerContexts(record,{selections:[selection()],windows:[{identity:'a',start:2,end:8}]});
 assert.equal(result.transitions[0].pairs.length,4);assert.equal(result.contexts.length,2);
 assert.equal(result.transitions[0].pairs[0].sourcePts,27000);assert.equal(record.watermarks[0].selectionVideoPts,90000);
});
test('source contexts reject missing submitted flashes, forged source watermark and incomplete transition',()=>{
 for(const mutate of [s=>s.pulses.pop(),s=>s.sourcePulses.push(330000),s=>s.endTick--,s=>s.identity='b']) {
  const s=selection();mutate(s);assert.throws(()=>buildMarkerContexts(fixture(),{selections:[s],windows:[]}),/marker_/);
 }
});
test('source contexts reject foreign source episodes inside otherwise correct full fences',()=>{
 const record=fixture();record.episodes.push({id:8,onset:70000,end:75000,identity:'b'});
 assert.throws(()=>buildMarkerContexts(record,{selections:[selection()],windows:[]}),/marker_context_failure/);
});
