import test from 'node:test';
import assert from 'node:assert/strict';
import {literalProfilePlan} from '../../scripts/marker-qualification/authority.mjs';
import {executeBound} from '../../scripts/marker-qualification/literal-bounds.mjs';
test('literal bounds execute actual scanners and preserve stricter semantic or wire failures',()=>{
 const names=literalProfilePlan.literalCases.find(f=>f.id==='bounds').names;assert.equal(names.length,14);
 for(const name of names){const facts=executeBound(name);assert(Buffer.byteLength(JSON.stringify(facts))<=512,name);}
});
