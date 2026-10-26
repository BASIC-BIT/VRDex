import test from 'node:test';
import assert from 'node:assert/strict';
import { replayAudioPartition, replayPreludeGuard, replayAudioClassification } from '../../scripts/marker-qualification/partition-reference.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
test('independent partition derives original endpoint sides and predecessor ownership from PCM',()=>{
 for(const rowSamples of [481,527,1024]) {
  const x=literalPcm({family:'pure',source:'a'},{rowSamples}),actual=decodeSourceAudio([x.pcm],x.rows),reference=replayAudioPartition(x.pcm,x.rows);
  assert.equal(reference.samples,actual.metadataSamples);assert.equal(reference.blockCount,actual.detectorBlockCount);
  assert.deepEqual(reference.episodes.map(({firstLoudLeft,lastLoudRight,closureRight,prelude})=>({firstLoudLeft,lastLoudRight,closureRight,prelude})),actual.episodes.map(({firstLoudLeft,lastLoudRight,closureRight,prelude})=>({firstLoudLeft,lastLoudRight,closureRight,prelude})));
 }
});
test('independent partition preserves noncontiguous raw row endpoints without asserting a clock certificate',()=>{
 const x=literalPcm({family:'pure',source:'a'}),rows=x.rows.map((r,i)=>({...r,pts:r.pts-(i%3)*8})),reference=replayAudioPartition(x.pcm,rows);
 assert.equal(reference.samples,x.pcm.length/2);assert.equal(reference.episodes[0].firstLoudLeft.raw,960);
 assert.throws(()=>replayAudioPartition(x.pcm.subarray(2),rows),/reference_/);
});
test('independent prelude pass reproduces the veto without production classifier imports',()=>{
 const x=literalPcm({family:'foreign_literal',source:'a',placement:'prefix',durationMs:1,phase:1,foreignPhase:5},{onset:928});
 const actual=decodeSourceAudio([x.pcm],x.rows),reference=replayAudioPartition(x.pcm,x.rows);
 for(let i=0;i<2;i++)assert.deepEqual(replayPreludeGuard(x.pcm,reference.episodes[0],actual.episodes[0].fits[i],i===0?700:1300),actual.episodes[0].fits[i].guard);
});
test('independent full audio replay recomputes exact fits local energy classes and guard work',()=>{
 for(const source of ['a','b'])for(const family of ['pure','foreign_literal','mixture_literal','1000Hz'])for(const rowSamples of [481,1024]) {
  const x=literalPcm({family,source,placement:family==='foreign_literal'?'prefix':1440,durationMs:1,phase:1,foreignPhase:5},{onset:928,rowSamples,noise:'43'});
  const actual=decodeSourceAudio([x.pcm],x.rows),reference=replayAudioClassification(x.pcm,x.rows);
  assert.deepEqual(reference.episodes,actual.episodes,`${source}/${family}/${rowSamples}`);
  assert.deepEqual(reference.residualWindowCounts,actual.residualWindowCounts);assert.equal(reference.localWindowCount,actual.localWindowCount);
 }
});
