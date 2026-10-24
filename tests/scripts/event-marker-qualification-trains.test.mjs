import test from 'node:test';
import assert from 'node:assert/strict';
import {enumerateQualification} from '../../scripts/marker-qualification/authority.mjs';
import {compileTrain,constructTrainPcm} from '../../scripts/marker-qualification/trains.mjs';
test('all frozen mass trains preserve physical pairs complete guards and source formats',()=>{
 const {invocations}=enumerateQualification();let count=0,max=0;
 for(const inv of invocations.filter(v=>v.kind==='mass')){const train=compileTrain(inv);assert.equal(train.slots[0].start,48000);assert.equal(train.slots.at(-1).end+48000,train.samples);max=Math.max(max,train.samples);count++;}
 assert.equal(count,176);assert.equal(max,1190400);
});
test('encoded train construction requires actual complete noise and retains source byte bound',()=>{
 const {invocations}=enumerateQualification(),train=compileTrain(invocations.find(v=>v.id==='mass-160-44100mono-000'));
 assert.throws(()=>constructTrainPcm(train,{}),/qualification_noise_extent/);
 const count=Math.round(train.samples*44100/48000),noise={42:Buffer.alloc(count*2),43:Buffer.alloc(count*2)};
 const pcm=constructTrainPcm(train,noise);assert.equal(pcm.length,count*2);assert(pcm.length<=2097152);
});
