import test from 'node:test';
import assert from 'node:assert/strict';
import { literalPcm, literalOnsets, toneAt } from '../../scripts/marker-qualification/signals.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
test('literal qualification observes original metadata onset and exactly 30ms contamination',()=>{
 for(const source of ['a','b'])for(const offset of [0,1,47,48,239,479]){
  const x=literalPcm({family:'pure',source},{onset:960+offset,noise:42});const d=decodeSourceAudio([x.pcm],x.rows);
  assert.equal(d.episodes[0].identity,source);assert.deepEqual(d.episodes.map(e=>e.onset),literalOnsets(x.pcm,x.rows));
 }
 for(const source of ['a','b'])for(const placement of [0,1,1439,1440,1441,3359,3360]){
  const x=literalPcm({family:'mixture_literal',source,placement,ratio:.25},{noise:'none'});const d=decodeSourceAudio([x.pcm],x.rows);
  assert.equal(d.episodes.length,1);assert.equal(d.episodes[0].identity,'mixed');assert.equal(d.episodes[0].reason,'simultaneous_local_energy');
 }
});
test('tone construction preserves clipping and source onset for hidden 105ms defect',()=>{
 const options={family:'hidden105',source:'b',phase:3,foreignPhase:2};
 assert.equal(toneAt(-1,options),0);assert.equal(toneAt(5280,options),0);
 const x=literalPcm(options),d=decodeSourceAudio([x.pcm],x.rows);
 assert.equal(d.episodes.length,1);assert.notEqual(d.episodes[0].identity,'b');assert.deepEqual(d.episodes.map(e=>e.onset),literalOnsets(x.pcm,x.rows));
});
