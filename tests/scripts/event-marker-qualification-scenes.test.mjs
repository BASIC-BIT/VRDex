import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScene,markerFrame} from '../../scripts/marker-qualification/scenes.mjs';
import {associationPlan} from '../../scripts/marker-qualification/authority.mjs';
test('scene compiler retains all approved operations and non-audio selection geometry',()=>{
 for(const s of associationPlan.scenes)for(const order of [['a','b'],['b','a']]){
  const c=compileScene(s.id,order);assert.equal(c.frames,390);assert.equal(c.samples,624000);assert.equal(c.identityAt(0),'slate');assert.equal(c.identityAt(30),order[0]);assert.equal(c.identityAt(c.selectionTick),c.selected);assert.equal(c.identityAt(360),'slate');
 }
 const c=compileScene('case8_identified',['a','b']);assert.equal(c.tones.find(t=>t.tag==='selected-0').start,246352);assert.equal(c.tones.find(t=>t.tag==='first-3').start,238640);assert.equal(c.sourceFlash('a',149),true);assert.equal(c.sourceFlash('b',153),true);
 const resumed=compileScene('same_source_cut_resume',['a','b']);assert.equal(resumed.identityAt(150),'slate');assert.equal(resumed.identityAt(151),'a');assert.equal(resumed.sourceFlash('a',150),true);
});
test('scene frame bytes preserve source luma and flash ROIs independently of tone',()=>{
 const a=markerFrame(854,480,'a',true,17),b=markerFrame(854,480,'b',false,17);assert.equal(a.length,854*480*3/2);
 assert.equal(a[14*854+14],81);assert.equal(b[14*854+14],41);assert.equal(a[14*854+71],235);assert.equal(b[14*854+71],16);assert.notEqual(a.buffer,b.buffer);
});
