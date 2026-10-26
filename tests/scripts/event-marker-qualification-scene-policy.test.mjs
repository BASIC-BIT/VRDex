import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
import { compileScene } from '../../scripts/marker-qualification/scenes.mjs';
import { constructScenePcm,prepareScene } from '../../scripts/marker-qualification/playout.mjs';
import { stereoMono } from '../../scripts/marker-qualification/codec-input.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { decodeMarkerVisuals } from '../../scripts/event-marker-record.mjs';
import { observeSceneContexts,matchSceneContract } from '../../scripts/marker-qualification/scene-policy.mjs';
import { observeGlobalScene,applySceneFault,matchGlobalSceneContract } from '../../scripts/marker-qualification/scene-faults.mjs';
import { referenceDetector } from '../../scripts/marker-qualification/detector-reference.mjs';
const authority=enumerateQualification();
function observation(name){
 const row=authority.rows.find(r=>r.id.startsWith(`assoc/${name}/a_to_b,42,160,program`)),scene=compileScene(name,['a','b']),pcm=constructScenePcm(scene,Buffer.alloc(scene.samples*2)),submitted=prepareScene(scene,pcm),mono=stereoMono(submitted.pcm),audioRows=[];
 for(let i=0;i<scene.samples;i+=1024)audioRows.push({index:audioRows.length,pts:i,samples:Math.min(1024,scene.samples-i)});
 const videoRows=submitted.frames.map(f=>({index:f.tick,pts:f.pts})),rgb=Buffer.alloc(scene.frames*6);
 for(const f of submitted.frames){if(f.identity!=='slate')rgb[f.tick*6+(f.identity==='a'?0:2)]=255;if(f.flash)rgb.fill(255,f.tick*6+3,f.tick*6+6);}
 let decoded,classificationFailure;try{decoded=decodeSourceAudio([mono],audioRows);}catch(e){if(e.message!=='marker_episode_bound')throw e;classificationFailure='episode_bound';}
 const reference=referenceDetector(mono,audioRows),record={...(decoded??{audioRange:[0,scene.samples],metadataSamples:scene.samples,decodedBytes:mono.length,episodes:[]}),...decodeMarkerVisuals(rgb,videoRows),watermarks:[]};record.episodes.forEach((e,id)=>e.id=id);
 return {row,scene,submitted,record,videoRows,reference,classificationFailure,material:{pcm:mono,audioRows}};
}
test('association contract checks all three actual contexts and rejects wrong-context or unrelated outcomes',()=>{
 const failures=[];
 for(const name of authority.rows.filter(r=>r.id.startsWith('assoc/')&&r.id.endsWith('/a_to_b,42,160,program')&&!Object.values(r.contract.contexts).some(c=>c.status==='blocked')).map(r=>r.id.split('/')[1])) {
  const x=observation(name),observed=observeSceneContexts(x);const result=matchSceneContract(x.row.contract,observed);if(result.status!=='pass'){failures.push({name,result,contexts:Object.fromEntries(Object.entries(observed.contexts).map(([key,c])=>[key,{expected:x.row.contract.contexts[key].reason,actual:c.failures,pairs:c.pairs.length}])),episodes:observed.record.episodes.filter(e=>e.onset>200000&&e.onset<300000).map(e=>[e.id,e.onset,e.end,e.identity,e.reason])});continue;}
  const changed=structuredClone(observed);changed.contexts.first_transition.failures=['unaccounted_episode'];changed.contexts.first_transition.valid=false;
  assert.equal(matchSceneContract(x.row.contract,changed).status,'fail');
  if(x.row.contract.contexts.first_transition.exactReasons){
   for(const [key,c] of Object.entries(observed.contexts)){
    for(const reason of c.failures){const m=structuredClone(observed);m.contexts[key].failures=m.contexts[key].failures.filter(r=>r!==reason);assert.equal(matchSceneContract(x.row.contract,m).status,'fail');}
    const m=structuredClone(observed);m.contexts[key].failures.push('extra_reason');assert.equal(matchSceneContract(x.row.contract,m).status,'fail');
   }
   for(const mutate of [m=>m.record.episodes.pop(),m=>m.record.episodes[0].onset++,m=>m.record.episodes[0].end--,m=>m.record.identityEpochs[0][1]=1,m=>m.record.watermarks[0].selectionSourcePts++,m=>m.record.audioRange[1]=1,m=>m.contexts.first_transition.pairs.pop()]){const m=structuredClone(observed);mutate(m);assert.equal(matchSceneContract(x.row.contract,m).status,'fail');}
  }
 }
 assert.deepEqual(failures,[]);
});

test('global negative requires real bound or exact mutation and complete original baseline',()=>{
 for(const name of ['foreign_long_tail','unknown_long_tail','truncated_closure','duplicate_visual_reference','missing_watermark','full_fragment_overlap']){
  const x=observation(name),global=x.classificationFailure?observeGlobalScene(x):applySceneFault(x.row.contract,observeSceneContexts(x),x.material);
  const result=matchGlobalSceneContract(x.row.contract,global);
  assert.equal(result.status,'pass',name+':'+JSON.stringify(result));
  const changed=structuredClone(global);changed.globalFailure='unrelated';assert.equal(matchGlobalSceneContract(x.row.contract,changed).status,'fail');
  if(['missing_watermark','full_fragment_overlap'].includes(name)){
   assert.equal(global.baseline.contexts.selected_transition.carryIn.episodeId,null);
   for(const mutate of [m=>m.mutated.record.episodes[0].onset++,m=>m.mutated.record.visuals[0].end++,m=>m.mutated.contexts.first_transition.start++,m=>m.mutated.unrelated=1]){const m=structuredClone(global);mutate(m);m.mutation.changedSha256=sha(m.mutated);assert.equal(matchGlobalSceneContract(x.row.contract,m).reason,'exact_mutation_delta');}
   const noop=structuredClone(global);noop.mutated=structuredClone(noop.baseline);noop.mutation.changedSha256=sha(noop.mutated);assert.equal(matchGlobalSceneContract(x.row.contract,noop).reason,'mutation_sha');
   for(const mutate of [m=>m.baseline.contexts.first_transition.valid=false,m=>m.baseline.contexts.first_transition.failures.push('foreign_interval')]){const m=structuredClone(global);mutate(m);assert.equal(matchGlobalSceneContract(x.row.contract,m).reason,'baseline_must_pass');}
   const contract=structuredClone(x.row.contract);contract.unmutatedBaselineContexts.first_transition.status='fail';assert.equal(matchGlobalSceneContract(contract,global).reason,'baseline_must_pass');
  }
 }
});

test('exact context scalar must agree with its complete observed reason set',()=>{
 const x=observation('carryin_present'),observed=observeSceneContexts(x);
 assert.equal(x.row.contract.contexts.first_transition.reason,'foreign_interval');
 for(const reason of ['none','unrelated']){const contract=structuredClone(x.row.contract);contract.contexts.first_transition.reason=reason;assert.equal(matchSceneContract(contract,observed).reason,'context_reason_consistency');}
 assert.equal(matchSceneContract(x.row.contract,observed).status,'pass');
});
