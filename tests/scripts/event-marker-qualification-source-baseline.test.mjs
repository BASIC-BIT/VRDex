import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceBaseline, stereoMono, massFrames } from '../../scripts/marker-qualification/codec-input.mjs';
test('source baseline reads every original channel sample and binds exact bytes without source labels',()=>{
 const pcm=Buffer.alloc(16);[-32768,32767,100,-100,1000,1000,0,0].forEach((n,i)=>pcm.writeInt16LE(n,i*2));
 const result=sourceBaseline(pcm,48000,2);assert.deepEqual(result.samplesPerChannel,[4,4]);assert.deepEqual(result.minimum,[-32768,-100]);assert.deepEqual(result.maximum,[1000,32767]);assert.equal(result.bytes,16);assert.equal(result.sha256.length,64);
 assert.deepEqual([...new Int16Array(stereoMono(pcm).buffer)],[-1,0,1000,0]);assert.throws(()=>sourceBaseline(pcm.subarray(1),48000,2),/source_failure/);
});
test('mass frame construction uses declared video ordinal not observed audio onset',()=>{
 const train={frames:6,slots:[{start:0,end:9600,visualFrame:2,index:0,params:{source:'b'}}]};let i=0;
 for(const frame of massFrames(train)){assert.equal(frame[14*854+14],41);assert.equal(frame[14*854+71],i>=2&&i<5?235:16);i++;}assert.equal(i,6);
});
