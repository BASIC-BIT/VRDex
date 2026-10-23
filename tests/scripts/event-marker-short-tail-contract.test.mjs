import test from 'node:test';
import assert from 'node:assert/strict';
import {literalProfilePlan} from '../../scripts/marker-qualification/authority.mjs';
import {literalPcm} from '../../scripts/marker-qualification/signals.mjs';
import {referenceDetector,validateShortTailObservation} from '../../scripts/marker-qualification/detector-reference.mjs';
import {decodeSourceAudio} from '../../scripts/event-source-markers.mjs';
const family=literalProfilePlan.literalCases.find(f=>f.id==='metadata_short_tail');
function facts(source,size){const x=literalPcm({family:'pure',source},{onset:960,rowSamples:size,noise:'none'});return {x,reference:referenceDetector(x.pcm,x.rows),actual:decodeSourceAudio([x.pcm],x.rows),expected:family.caseContracts[`${source},${size}`]};}
test('R38 exact ten fixed short-tail cases retain independently derived complete vectors',()=>{
 for(const source of ['a','b'])for(const size of [481,527,528,719,959]){const f=facts(source,size);assert.equal(validateShortTailObservation(f.expected,f.reference,f.actual).length,f.expected.episodes.length);}
});
test('R38 rejects every omission shift merge split guard row conservation and classification mutation',()=>{
 const f=facts('a',481);
 const mutations=[a=>a.episodes.shift(),a=>{a.episodes[0].end=a.episodes[1].end;a.episodes.pop();},a=>a.episodes.push(structuredClone(a.episodes[1])),a=>a.episodes.splice(1,0,{...a.episodes[1],end:a.episodes[1].end-1}),a=>a.episodes[0].onset++,a=>a.episodes[0].loudEnd++,a=>a.episodes[0].end++,a=>a.episodes[0].end--,a=>a.episodes[1].firstMetadataIndex++,a=>a.episodes[1].metadataRowCount--,a=>a.metadataSamples--,a=>a.decodedBytes--,a=>a.detectorBlockCount--,a=>a.episodes[0].identity='a',a=>a.episodes[1].identity='unknown',a=>a.episodes[1].identity='mixed',a=>a.episodes[1].identity='b'];
 for(const mutate of mutations){const actual=structuredClone(f.actual);mutate(actual);assert.throws(()=>validateShortTailObservation(f.expected,f.reference,actual),/literal_short_tail_contract/);}
 const reference=structuredClone(f.reference);reference.blocks.splice(5,1);assert.throws(()=>validateShortTailObservation(f.expected,reference,f.actual),/literal_short_tail_contract/);
 const rows=structuredClone(f.x.rows);rows[2].samples--;assert.throws(()=>referenceDetector(f.x.pcm,rows),/reference_/);
});
