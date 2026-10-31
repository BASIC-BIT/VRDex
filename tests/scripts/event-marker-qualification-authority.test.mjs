import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateQualification, binding } from '../../scripts/marker-qualification/authority.mjs';
test('qualification authority retains every approved assertion and context contract',()=>{
 const {rows,invocations,groups}=enumerateQualification();
 assert.equal(rows.length,79996);assert.equal(new Set(rows.map(r=>r.id)).size,79996);
 assert.deepEqual(binding(rows),{count:79996,idsSha256:'c55078312b8e2b6d24c84f7caa82cd487b1a440da20c301ed0e69ab5f44a9f16',expectedContractsSha256:'2af9fce4e907623fa75a6f4191d102d10745d47573884e4d5553e28675993873'});
 assert.equal(rows.filter(r=>r.id.startsWith('q30/')).length,3072);assert.equal(groups.length,83);assert.equal(invocations.length,294);
 const assigned=groups.flatMap(g=>g.invocations);assert.equal(new Set(assigned).size,invocations.length);assert.equal(assigned.length,invocations.length);
 assert.deepEqual(groups[0].invocations,['mass-160-44100mono-000','mass-320-48000stereo-073','mass-160-48000stereo-024','mass-320-48000stereo-000']);
});
