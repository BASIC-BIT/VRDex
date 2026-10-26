import test from 'node:test';
import assert from 'node:assert/strict';
import {literalProfilePlan} from '../../scripts/marker-qualification/authority.mjs';
import {executeMalformed} from '../../scripts/marker-qualification/literal-invalid.mjs';
test('every frozen malformed case executes a real decoder or reference validation negative',()=>{
 const cases=literalProfilePlan.literalCases.find(f=>f.id==='malformed').names;
 assert.equal(cases.length,26);for(const name of cases){const facts=executeMalformed(name);assert(Buffer.byteLength(JSON.stringify(facts))<=512,name);}
});
