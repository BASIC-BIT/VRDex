import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClassifierCase, prerequisiteStates, makeResultShards, validateResultUnion } from '../../scripts/marker-qualification/results.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { referenceDetector } from '../../scripts/marker-qualification/detector-reference.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
const authority=enumerateQualification();
const row=authority.rows.find(r=>r.id.startsWith('q30/'));
function evidence(){const s=literalPcm({family:'q30',source:'a',placement:0});const decoded=decodeSourceAudio([s.pcm],s.rows);return {episodes:decoded.episodes,referenceRanges:referenceDetector(s.pcm,s.rows).episodes};}
test('typed codec negative requires every real prerequisite and original complete episode',()=>{
 const p=prerequisiteStates('pass');assert.equal(evaluateClassifierCase(row,p,evidence()).status,'pass');
 for(const key of Object.keys(p))for(const state of ['fail','not_run']){const actual=evaluateClassifierCase(row,{...p,[key]:state},evidence());assert.equal(actual.status,'incomplete');assert.equal(actual.prerequisite,key);}
 const e=evidence();e.episodes[0].onset++;assert.equal(evaluateClassifierCase(row,p,e).status,'fail');
 for(const mutate of [e=>e.episodes=[],e=>e.episodes.push(e.episodes[0]),e=>e.episodes[0].identity='a',e=>e.episodes[0].reason='none',e=>e.episodes[0].local.firstPair=-1]){const e=evidence();mutate(e);assert.equal(evaluateClassifierCase(row,p,e).status,'fail');}
});
test('result shards preserve exact IDs contracts source pins byte hashes and disjoint union',()=>{
 const invocations=authority.invocations.filter(i=>i.kind==='literal').slice(0,2),pins={imageDigest:'sha256:'+'a'.repeat(64),sourceManifestSha256:'b'.repeat(64),planSha256:'c'.repeat(64),expectedContractsSha256:'d'.repeat(64)};
 const bundles=invocations.map(inv=>makeResultShards(inv,inv.rows.map((_,index)=>({index,status:'pass',facts:{samples:7200}})),pins));
 assert.equal(validateResultUnion(invocations,bundles,pins).passed,true);
 for(const mutate of [b=>b.pop(),b=>b.push(b[0]),b=>b[0].shards[0].bytes[0]^=1,b=>b[0].invocation='wrong',b=>b[0].pins.imageDigest='sha256:'+'f'.repeat(64)]){
  const changed=structuredClone(bundles);mutate(changed);assert.throws(()=>validateResultUnion(invocations,changed,pins),/qualification_result/);
 }
 const failed=invocations[0].rows.map((_,index)=>({index,status:index===12?'incomplete':'pass',reason:index===12?'timeout':undefined}));
 assert.equal(validateResultUnion([invocations[0]],[makeResultShards(invocations[0],failed,pins)],pins).passed,false);
 assert.throws(()=>makeResultShards(invocations[0],failed.slice(1),pins),/qualification_result/);
});
