import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
import { executeLiteral } from '../../scripts/marker-qualification/literal.mjs';
test('literal qualification executes each implemented family with original samples and typed facts',()=>{
 const {rows}=enumerateQualification();const families=new Set();let count=0;
 for(const row of rows){if(!row.id.startsWith('literal/')||['bounds','malformed'].includes(row.params.family)||families.has(row.params.family))continue;families.add(row.params.family);const facts=executeLiteral(row);assert(Buffer.byteLength(JSON.stringify(facts))<=512);count++;}
 assert.equal(count,13);
});
