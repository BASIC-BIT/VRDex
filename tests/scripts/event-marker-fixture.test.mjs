import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../../scripts/event-capacity-media.mjs';
test('fixture builders change only source tone between A and B',async()=>{
 const commands=[];
 const owner={async run(command,args){if(command==='ffmpeg'){commands.push(args);return Buffer.alloc(0);}assert.equal(command,'ffprobe');return Buffer.from(JSON.stringify({streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,r_frame_rate:'60/1'},{codec_type:'audio',codec_name:'aac',channels:2,sample_rate:'48000'}]}));}};
 await createFixture(owner,'/tmp/fixed-proof-source.ts','a');await createFixture(owner,'/tmp/fixed-proof-source.ts','b');
 const [a,b]=commands;assert(a.some(v=>v.includes('PI*700*t')));assert(b.some(v=>v.includes('PI*1300*t')));
 assert.deepEqual(a,b.map(v=>v.replaceAll('PI*1300*t','PI*700*t').replace('color=blue','color=red')));
 await assert.rejects(()=>createFixture(owner,'/tmp/fixed-proof-source.ts','unknown'),/marker_fixture_identity/);
 assert.equal(commands.length,2);
});
