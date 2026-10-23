import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runQualificationGroup } from '../../scripts/marker-qualification/group.mjs';
const pins={imageDigest:'sha256:'+'a'.repeat(64),sourceManifestSha256:'b'.repeat(64),planSha256:'c'.repeat(64),expectedContractsSha256:'d'.repeat(64)};
test('group closes physical owners before result acceptance and accounts every unrun ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-group-pure-'));let now=0;const events=[];
 try {
 const result=await runQualificationGroup({groupId:'canary-000',directory:dir,pins},{clock:()=>now,ownerFactory:async()=>({close:async()=>{events.push('close');return {closed:true,emptyCensuses:2};}}),execute:async(inv)=>{events.push(inv.id);now+=210000;return inv.rows.map((_,index)=>({index,status:'pass',facts:{syntheticControl:true}}));}});
 assert.equal(result.passed,false);assert.equal(result.completedInvocations,1);assert.equal(result.invocations.length,4);assert.equal(result.invocations[2].counts.incomplete,result.invocations[2].expected.count);assert.deepEqual(events.filter(e=>e==='close').length,1);assert.equal(result.artifacts.length,4);assert.equal(result.capacityAccepted,false);
 }finally{await rm(dir,{recursive:true});}
});
test('group ownership failure invalidates otherwise successful observations before sealing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-group-leak-pure-'));
 try {
 const result=await runQualificationGroup({groupId:'compressed-source-000',directory:dir,pins},{ownerFactory:async()=>({close:async()=>({closed:false,reason:'process_leak'})}),execute:async inv=>inv.rows.map((_,index)=>({index,status:'pass',facts:{syntheticControl:true}}))});
 assert.equal(result.passed,false);assert.equal(result.cleanup.closed,false);assert.equal(result.invocations[0].counts.incomplete,4);assert.equal(result.invocations[0].counts.pass,0);
 }finally{await rm(dir,{recursive:true});}
});
