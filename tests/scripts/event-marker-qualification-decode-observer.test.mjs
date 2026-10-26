import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeMediaMarkerRecord } from '../../scripts/event-capacity-media.mjs';
test('qualification observer sees complete originals but a missing encoded clock cannot return a naked record',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-decode-pure-'));try{
 const path=join(dir,'synthetic-bytes');await writeFile(path,'not media: injected owner only');
 let calls=0,observation;
 const owner={run:async()=>Buffer.from(JSON.stringify({streams:[{codec_type:'video',index:0},{codec_type:'audio',index:1}]})),start:()=>{
  const pipes=Array.from({length:7},()=>new PassThrough()),child={stdio:pipes,stderr:pipes[2],kill:()=>{throw Error('unexpected signal');}};
  child.closed=new Promise(resolve=>queueMicrotask(()=>{
   pipes[3].write(Buffer.from([255,0,0,0,0,0,255,0,0,0,0,0]));pipes[4].write(Buffer.alloc(960));
   pipes[5].write('frame:0 pts:90000 pts_time:1\nlavfi.signalstats.YAVG=10\nframe:1 pts:93000 pts_time:1.033\nlavfi.signalstats.YAVG=10\n');
   pipes[6].write('frame:0 pts:48000 pts_time:1\nlavfi.astats.Overall.Number_of_samples=480\n');resolve(0);
  }));return child;
 }};
 await assert.rejects(decodeMediaMarkerRecord(owner,path,{width:854,height:480,maxSeconds:2,observeDecoded:x=>{calls++;observation=x;}}),/marker_clock_unproven/);
 await assert.rejects(decodeMediaMarkerRecord(owner,path,{width:854,height:480,maxSeconds:2}),/marker_clock_unproven/);
 assert.equal(calls,1);assert.deepEqual(observation.audioRows,[{index:0,pts:48000,samples:480}]);assert.equal(observation.audioChunks.reduce((n,b)=>n+b.length,0),960);assert.deepEqual(observation.videoRows.map(r=>r.pts),[90000,93000]);assert.equal(observation.rgb.length,12);
 }finally{await rm(dir,{recursive:true});}
});
