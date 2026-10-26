import test from 'node:test';
import assert from 'node:assert/strict';
import { constructScenePcm, sceneFrames } from '../../scripts/marker-qualification/playout.mjs';
import { compileScene } from '../../scripts/marker-qualification/scenes.mjs';
test('offline scene uses actual selected buffer PCM and observed watermarks through A slate A',()=>{
 for(const name of ['aligned','carryin_present','same_source_cut_resume']) {
  const scene=compileScene(name,['a','b']),noise=Buffer.alloc(scene.samples*2),pcm=constructScenePcm(scene,noise),state={selections:[],frames:[],audio:[]};
  for(const frame of sceneFrames(scene,pcm,state)){assert.equal(frame.length,854*480*3/2);}
  assert.equal(state.frames.length,390);assert.equal(state.audio.length,390);assert.equal(state.selections.length,2);
  assert.equal(state.selections[0].tick,30);assert.equal(state.selections[1].tick,scene.selectionTick);
  assert.equal(state.selections[1].identity,scene.selected);
  for(let tick=30;tick<360;tick++)if(scene.identityAt(tick)!=='slate')assert.deepEqual(state.audio[tick],pcm.subarray(tick*6400,(tick+1)*6400));
  assert(state.selections.every(s=>s.endTick===s.tick+120&&s.pulses.length>=4));
  if(name==='carryin_present')assert.equal(state.selections[1].carryIn,true);
 }
});
