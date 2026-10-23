import test from 'node:test';
import assert from 'node:assert/strict';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
import { referenceDetector, validateMinimumObservation } from '../../scripts/marker-qualification/detector-reference.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
test('minimum nominal lengths preserve phase-zero measured floor and exact quiet guards',()=>{
 for(const source of ['a','b'])for(const nominal of [1439,1440,1441]){
  const s=literalPcm({family:'pure',source,loudSamples:nominal},{onset:0,tail:480});s.rows=[{index:0,pts:0,samples:nominal},{index:1,pts:nominal,samples:480}];
  const ref=referenceDetector(s.pcm,s.rows),actual=decodeSourceAudio([s.pcm],s.rows);
  const facts=validateMinimumObservation(nominal,ref,actual);assert.equal(facts.nominalToneSamples,nominal);assert.equal(facts.measuredLoudSamples,Math.min(nominal,1440));
  for(const mutate of [a=>a.episodes[0].loudEnd++,a=>a.episodes[0].end++,a=>a.episodes[0].end--,a=>a.episodes[0].onset++,a=>a.metadataSamples--,a=>a.decodedBytes--,a=>a.detectorBlockCount--,a=>a.episodes[0].reason=nominal<1440?'none':'insufficient_samples']){
   const changed=structuredClone(actual);mutate(changed);assert.throws(()=>validateMinimumObservation(nominal,ref,changed),/literal_minimum_contract/);
  }
 }
});
