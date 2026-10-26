import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceDetector} from '../../scripts/marker-qualification/detector-reference.mjs';
import {literalPcm} from '../../scripts/marker-qualification/signals.mjs';
test('independent detector preserves nonzero original integer PTS and rejects continuity loss',()=>{
 const s=literalPcm({family:'pure',source:'a'}),base=referenceDetector(s.pcm,s.rows),origin=43200*48000;
 const rows=s.rows.map(r=>({...r,pts:r.pts+origin})),shifted=referenceDetector(s.pcm,rows);
 assert.deepEqual(shifted.episodes,base.episodes.map(e=>e.map((n,i)=>i<3?n+origin:n)));assert.equal(shifted.samples,base.samples);
 rows[1].pts++;assert.throws(()=>referenceDetector(s.pcm,rows),/reference_metadata/);
});
