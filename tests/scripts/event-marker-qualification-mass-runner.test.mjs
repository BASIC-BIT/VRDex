import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMass } from '../../scripts/marker-qualification/mass.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
test('mass executor retains source failure as incomplete rather than expected negative',async()=>{
 const invocation=enumerateQualification().invocations.find(i=>i.id==='mass-320-48000stereo-000'),calls=[];
 const result=await executeMass(invocation,{owner:{},store:{total:0},io:{generateNoise:async()=>{calls.push('noise');throw Error('source_failure');}}});
 assert.deepEqual(calls,['noise']);assert.equal(result.length,128);assert(result.every(r=>r.status==='incomplete'&&r.reason==='source_failure'));assert(result.every(r=>r.prerequisites.source_constructed==='fail'&&r.prerequisites.physical_children_closed==='not_run'));
});
