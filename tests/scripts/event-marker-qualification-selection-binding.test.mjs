import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMarkerSelections } from '../../scripts/event-marker-contexts.mjs';
import { sourceMarkerFixture } from '../fixtures/source-marker-literal.mjs';
import { validateMarkerRecord } from '../../scripts/event-marker-evidence.mjs';
test('qualification selection binding retains original watermarks before semantic rejection',()=>{
 const fixture=sourceMarkerFixture().markerEvidence,decoded=validateMarkerRecord(fixture);
 const selections=['a','b'].map((identity,index)=>({identity,revision:1,tick:30+240*index,fps:30,sourcePts:0,endTick:150+240*index,lastSourcePts:357000,carryIn:false,sourcePulses:[27000,117000,207000,297000],pulses:[0,1,2,3].map(n=>({tick:39+240*index+30*n,sourcePts:27000+90000*n}))}));
 const raw={...fixture,...decoded,watermarks:[]};raw.visuals.forEach(v=>v.watermark=-1);
 const bound=bindMarkerSelections(raw,selections);assert.equal(bound.length,2);assert(bound.every(b=>b.context.kind==='transition'));
 assert.equal(raw.watermarks.length,2);assert(bound.every(b=>b.context.fullVisualIds.length>=3));
 const wrong=structuredClone(selections);wrong[0].tick++;assert.throws(()=>bindMarkerSelections({...structuredClone(raw),watermarks:[]},wrong),/marker_/);
});
