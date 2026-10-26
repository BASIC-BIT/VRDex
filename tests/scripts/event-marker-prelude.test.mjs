import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
const decode=x=>decodeSourceAudio([x.pcm],x.rows);
test('a quiet predecessor vetoes a foreign prefix without changing the loud onset',()=>{
 for(const phase of [1,2]) {
  const x=literalPcm({family:'foreign_literal',source:'a',placement:'prefix',durationMs:1,phase,foreignPhase:5},{onset:928});
  const r=decode(x),e=r.episodes[0];
  assert.equal(e.onset,960);assert.equal(e.identity,'unknown');assert.equal(e.reason,'single_carrier_inconsistent');
  assert.equal(e.prelude.kind,'UnclaimedQuiet');assert.equal(e.prelude.count,480);
  assert(e.fits[0].maxResidual<=.14);assert(e.fits[0].guard.maxResidual>.14);
  assert.equal(e.fits[0].guard.maxResidualAt,-32);assert.equal(r.scratchBytes,40960);
  assert.deepEqual(r.residualWindowCounts,e.fits.map(f=>f.code===0?(e.end-e.onset-47)*2+480:0));
 }
});
test('R38 prior closure remains owned by the earlier episode and incurs no guard scan',()=>{
 const r=decode(literalPcm({family:'pure',source:'a'},{onset:960,rowSamples:481}));
 const e=r.episodes[1];
 assert.equal(e.onset,1443);assert.deepEqual(e.prelude,{kind:'PriorClosure',row:2,offset:480,count:1,owner:0});
 assert.equal(r.episodes[0].closureRight.raw,1443);assert.equal(e.firstLoudLeft.ordinal,1443);
 assert.equal(e.identity,'a');assert.equal(e.reason,'none');assert(e.fits.every(f=>f.guard.code===0));
});
test('file-origin and directly adjacent closure preludes allocate no backing and add no residual positions',()=>{
 const pcm=Buffer.alloc(2*5047*2),rows=[];
 const tone=literalPcm({family:'pure',source:'a'},{onset:0,tail:0}).pcm;
 for(let n=0;n<2;n++){tone.copy(pcm,n*5047*2);rows.push({index:2*n,pts:n*5047,samples:4800},{index:2*n+1,pts:n*5047+4800,samples:247});}
 const r=decode({pcm,rows});assert.equal(r.scratchBytes,40000);assert.deepEqual(r.residualWindowCounts,[10000,10000]);
 assert.equal(r.episodes[0].prelude.kind,'FileOrigin');assert.equal(r.episodes[1].prelude.kind,'PriorClosure');
 assert(r.episodes.every(e=>e.fits.every(f=>f.guard.code===0&&f.guard.maxResidual===null)));
});
