import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { decodeVideoFrames,frameQuality } from '../../scripts/marker-qualification/codec-io.mjs';
function ownerFor(bytes){
 return {start(_command,args){assert(args.includes('passthrough'));const stdout=new PassThrough(),stderr=new PassThrough();const child={stdout,stderr,kill(){stdout.destroy();},closed:Promise.resolve(0)};
 queueMicrotask(()=>{for(let i=0;i<bytes.length;i+=7)stdout.write(bytes.subarray(i,i+7));stdout.end();stderr.end();});return child;}};
}
test('streaming bridge counts all source frames while submitting exact alternate ordinals',async()=>{
 const raw=Buffer.concat([0,1,2,3].map(n=>Buffer.alloc(24,n))),frames=[];
 for await(const frame of decodeVideoFrames(ownerFor(raw),'fixed-local-file',{width:4,height:4,frames:4,stride:2}))frames.push(frame);
 assert.deepEqual(frames.map(f=>[f.length,...new Set(f)]),[[24,0],[24,2]]);assert.notEqual(frames[0].buffer,frames[1].buffer);
 for(const bytes of [raw.subarray(0,-1),Buffer.concat([raw,Buffer.from([1])]),raw.subarray(0,72)])await assert.rejects(async()=>{for await(const _ of decodeVideoFrames(ownerFor(bytes),'fixed-local-file',{width:4,height:4,frames:4})){}},/coverage_failure/);
});
test('bridge quality compares every original frame and rejects missing reference coverage',async()=>{
 const raw=Buffer.concat([0,1].map(n=>Buffer.alloc(24,n))),refs=[raw.subarray(0,24),raw.subarray(24)];
 const quality=await frameQuality(ownerFor(raw),'fixed-local-file',{width:4,height:4,frames:2,referenceFrames:refs});assert.equal(quality.frames,2);assert.equal(quality.bytes,48);assert(quality.fullFrameYuvPsnrDb>28);
 await assert.rejects(()=>frameQuality(ownerFor(raw),'fixed-local-file',{width:4,height:4,frames:2,referenceFrames:refs.slice(0,1)}),/coverage_failure/);
});
