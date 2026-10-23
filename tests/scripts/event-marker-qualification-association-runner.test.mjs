import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAssociation } from '../../scripts/marker-qualification/association-runner.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
test('association source failure preserves all eight original IDs as incomplete and does not encode',async()=>{
 const invocation=enumerateQualification().invocations.find(i=>i.kind==='association'),calls=[];
 const results=await executeAssociation(invocation,{owner:{close:async()=>{calls.push('close');}},store:{total:0},io:{generateNoise:async()=>{calls.push('noise');throw Error('source_failure');}}});
 assert.equal(results.length,8);assert.deepEqual(results.map(r=>r.index),[0,1,2,3,4,5,6,7]);
 assert(results.every(r=>r.status==='incomplete'&&r.prerequisites.source_constructed==='fail'));
 assert.deepEqual(calls,['noise','noise','noise','noise']);
});
