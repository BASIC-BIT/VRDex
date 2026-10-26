import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createQualificationOwner, parseProcessStat } from '../../scripts/marker-qualification/owner.mjs';

test('qualification owner closes newly orphaned identities and requires two empty censuses',async()=>{
 let now=0,scans=0,alive=true;const signals=[];
 const base={pid:1,startTicks:'10',live:true},orphan={pid:71,startTicks:'22',live:true};
 const owner=await createQualificationOwner({scan:async()=>{scans++;return scans===1?[base]:alive?[base,orphan]:[base];},clock:()=>now,sleep:async n=>{now+=n;},signal:(pid,sig)=>{signals.push([pid,sig]);alive=false;},spawn:()=>{throw Error('no child permitted');}});
 const closed=await owner.close();assert.equal(closed.closed,true);assert.equal(closed.emptyCensuses,2);assert.deepEqual(signals,[[71,'SIGTERM']]);assert(scans>=4);
});
test('qualification owner never signals recycled baseline or observed identity and fails surviving census',async()=>{
 let now=0,scans=0;const signals=[];
 const row=(pid,startTicks)=>({pid,startTicks,live:true});
 const owner=await createQualificationOwner({scan:async()=>{scans++;return scans===1?[row(1,'10')]:[row(1,'10'),row(71,scans===2?'22':'23')];},clock:()=>now,sleep:async n=>{now+=n;},signal:(pid,sig)=>signals.push([pid,sig]),spawn:()=>{throw Error('no child');}});
 const result=await owner.close({timeoutMs:120,termMs:20});assert.equal(result.closed,false);assert.equal(result.reason,'process_leak');assert(signals.every(([pid])=>pid===71));assert(result.survivors.length===1);
});
test('qualification owner bounds children and prevents post-close spawn',async()=>{
 let now=0,next=80;const children=[];
 const owner=await createQualificationOwner({scan:async()=>[],clock:()=>now,sleep:async n=>{now+=n;},signal:()=>{},spawn:()=>{const c=new EventEmitter();c.pid=next++;children.push(c);return c;}});
 const a=owner.start('ffmpeg',[]),b=owner.start('ffmpeg',[]);assert.throws(()=>owner.start('ffmpeg',[]),/child_bound/);
 a.emit('close',0);assert.equal(await a.closed,0);const c=owner.start('ffmpeg',[]);b.emit('close',0);c.emit('close',0);
 assert.equal((await owner.close()).closed,true);assert.throws(()=>owner.start('ffmpeg',[]),/owner_closed/);
});
test('qualification proc parser preserves start ticks and ignores zombie ownership',()=>{
 const fields=['S','1','71',...Array(16).fill('0'),'987654321'];
 assert.deepEqual(parseProcessStat('71 (name with ) spaces) '+fields.join(' ')),{pid:71,parent:1,group:71,startTicks:'987654321',live:true});
 fields[0]='Z';assert.equal(parseProcessStat('71 (x) '+fields.join(' ')).live,false);assert.throws(()=>parseProcessStat('bad'),/proc_stat/);
});

test('qualification owner preserves actual close code and signal separately from early spawn errors',async()=>{
 let now=0,next=90;
 const owner=await createQualificationOwner({scan:async()=>[],clock:()=>now,sleep:async n=>{now+=n;},signal:()=>{},spawn:()=>{const c=new EventEmitter();c.pid=next++;return c;}});
 for(const [exitCode,signal] of [[0,null],[null,'SIGTERM']]) {
  const child=owner.start('ffmpeg',[]);child.emit('close',exitCode,signal);
  assert.equal(await child.closed,exitCode);assert.deepEqual(await child.nativeClosed,{exitCode,signal});assert(Object.isFrozen(await child.nativeClosed));
 }
 const failed=owner.start('ffmpeg',[]),error=Object.assign(new Error('missing executable'),{code:'ENOENT'});failed.emit('error',error);
 assert.equal(await failed.closed,1);assert.equal(failed.nativeError,error);
 failed.emit('close',-2,null);assert.deepEqual(await failed.nativeClosed,{exitCode:-2,signal:null});
 assert.equal((await owner.close()).closed,true);
});
