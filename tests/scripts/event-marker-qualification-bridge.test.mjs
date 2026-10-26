import test from 'node:test';
import assert from 'node:assert/strict';
import { executeBridge,matchBridgePulses,profileInput } from '../../scripts/marker-qualification/bridges.mjs';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
test('bridge precondition failures remain incomplete for both actual paths and all bitrates',async()=>{
 for(const kind of ['profile','compressed-source']){
  const invocation=enumerateQualification().invocations.find(i=>i.kind===kind),effects={generateNoise:async()=>{throw Error('source_failure');},createFixture:async()=>{throw Error('source_failure');}};
  const rows=await executeBridge(invocation,{owner:{},store:{total:0,path:n=>n},io:effects});assert.equal(rows.length,invocation.rows.length);assert(rows.every(r=>r.status==='incomplete'&&r.prerequisites.source_constructed==='fail'));
 }
});
test('bridge pulse union rejects wrong source, missing extra and out-of-gate original onsets',()=>{
 const visuals=[0,1,2].map((n,id)=>({id,start:n*90000,end:n*90000+9000,identity:'a'})),episodes=visuals.map(v=>({id:v.id,onset:v.start*8/15,end:v.start*8/15+5280,identity:'a'}));
 const record={visuals,episodes,audioRange:[0,144000],videoRange:[0,267000],identityEpochs:[[0,1]]};
 assert.equal(matchBridgePulses(record,'a',3).status,'pass');
 for(const mutate of [r=>r.episodes.pop(),r=>r.episodes.push({...r.episodes[0],id:3}),r=>r.episodes[1].identity='b',r=>r.episodes[1].onset+=7201]){const r=structuredClone(record);mutate(r);assert.equal(matchBridgePulses(r,'a',3).status,'fail');}
});
test('profile source retains independent stereo noise and every fixed phase-zero pulse',()=>{
 const count=384000,a=Buffer.alloc(count*2),b=Buffer.alloc(count*2);a.writeInt16LE(1000,20000);b.writeInt16LE(-500,20000);
 const input=profileInput({profile:'480p60',source:'b'}, {42:a,43:b});assert.equal(input.pcm.length,count*4);assert.equal(input.frames,480);assert.equal(input.pcm.readInt16LE(40000),1000);assert.equal(input.pcm.readInt16LE(40002),-500);
});
