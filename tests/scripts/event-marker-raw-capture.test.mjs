import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureRawMembers, replayRawMembers, createRecordFailure, createRawCapture } from '../../scripts/event-marker-raw-capture.mjs';
test('raw capture conserves complete members hashes and all decoded bytes',()=>{
 const raw=Buffer.alloc(140000);for(let i=0;i<raw.length;i++)raw[i]=i%251;
 const c=captureRawMembers(raw,{producerCap:raw.length,remainingBytes:10000});
 assert.equal(c.complete,true);assert.equal(c.members.length,3);assert.deepEqual(replayRawMembers(c,{producerCap:raw.length}),raw);
 for(const mutate of [x=>x.originalBytes--,x=>x.originalSHA256='0'.repeat(64),x=>x.members[0].data+='AA==',x=>x.members.pop(),x=>x.members[0].bytes++]) {
  const x=structuredClone(c);mutate(x);assert.throws(()=>replayRawMembers(x,{producerCap:raw.length}),/marker_raw/);
 }
 assert.throws(()=>replayRawMembers(c,{producerCap:raw.length-1}),/marker_raw/);
});
test('raw budget failures retain only whole prefix members and cannot replay as complete',()=>{
 const raw=Buffer.alloc(131073,17),full=captureRawMembers(raw,{producerCap:raw.length,remainingBytes:10000});
 const c=captureRawMembers(raw,{producerCap:raw.length,remainingBytes:full.members[0].bytes});
 assert.equal(c.complete,false);assert.equal(c.retainedBytes,65536);assert.equal(c.members.length,1);assert.equal(c.observedBytes,raw.length);
 assert.throws(()=>replayRawMembers(c,{producerCap:raw.length}),/marker_raw_incomplete/);
 assert.deepEqual(replayRawMembers(c,{producerCap:raw.length,requireComplete:false}),raw.subarray(0,65536));
});
test('record primary error is immutable and capture errors remain secondary',()=>{
 const state=createRecordFailure({recordKey:'program',inputSHA:'1'.repeat(64)}),error=Object.assign(new Error('first'),{code:'E_FIRST'});
 const primary=state.record({stage:'parse',completedPrerequisites:['decode'],native:{exitCode:0},error});
 error.message='changed';assert.equal(primary.error.message,'first');assert(Object.isFrozen(primary.native));
 state.record({stage:'retain',completedPrerequisites:[],native:{exitCode:1},error:new Error('second')});
 assert.equal(state.snapshot().primary,primary);assert.equal(state.snapshot().secondary.length,1);
 assert.throws(()=>{primary.completedPrerequisites.push('classify');},TypeError);
 const large=createRecordFailure({recordKey:'twitch',inputSHA:'2'.repeat(64)}).record({stage:'decode',completedPrerequisites:[],native:{exitCode:1},error:new Error('é'.repeat(3000))});
 assert.equal(large.exactComplete,false);assert.equal(large.reason,'error_repr_overflow');assert.equal(large.error.message.fullBytes,6000);assert(Buffer.byteLength(large.error.message.prefix)<=2048);
});
test('primary error final serialization stays within 8192 bytes including escaping and maximum metadata',()=>{
 for(const character of ['"','\\','\u0000'])for(const maximumMetadata of [false,true]) {
  const recordKey=maximumMetadata?'\u0000'.repeat(128):'program',completedPrerequisites=maximumMetadata?Array(16).fill('\u0000'.repeat(64)):['decode'];
  const error={name:character.repeat(64),message:character.repeat(2048),stack:character.repeat(4096),code:character.repeat(128)};
  const envelope=createRecordFailure({recordKey,inputSHA:'3'.repeat(64)}).record({stage:'parse',completedPrerequisites,native:maximumMetadata?{detail:'\u0000'.repeat(512)}:{exit:0},error});
  assert(Buffer.byteLength(JSON.stringify(envelope))<=8192,`${JSON.stringify(character)}/${maximumMetadata}`);
  assert.equal(envelope.recordKey,recordKey);assert.equal(envelope.stage,'parse');assert.deepEqual(envelope.completedPrerequisites,completedPrerequisites);
  assert.equal(envelope.exactComplete,false);assert.equal(envelope.reason,'error_repr_overflow');
  for(const [field,original] of Object.entries(error)) {
   const value=envelope.error[field];
   if(typeof value==='string')assert.equal(value,original);
   else {assert.equal(value.fullBytes,Buffer.byteLength(original));assert.equal(value.sha256,createHash('sha256').update(original).digest('hex'));assert(original.startsWith(value.prefix));assert(Buffer.byteLength(value.prefix)<={name:64,message:2048,stack:4096,code:128}[field]);}
  }
 }
});
test('producer overflow replays only its bounded retained prefix and never becomes complete',()=>{
 const raw=Buffer.alloc(65537,17),capture=captureRawMembers(raw,{producerCap:65536,remainingBytes:1000});
 assert.equal(capture.complete,false);assert.equal(capture.observedBytes,65537);assert.equal(capture.retainedBytes,65536);
 assert.deepEqual(replayRawMembers(capture,{producerCap:65536,requireComplete:false}),raw.subarray(0,65536));
 assert.throws(()=>replayRawMembers(capture,{producerCap:65536}),/marker_raw_incomplete/);
 assert.throws(()=>replayRawMembers({...capture,complete:true},{producerCap:65536,requireComplete:false}),/marker_raw_/);
 assert.throws(()=>replayRawMembers(capture,{producerCap:65535,requireComplete:false}),/marker_raw_bound/);
});
test('secondary failure retention is byte bounded and preserves ordered overflow accounting',()=>{
 const state=createRecordFailure({recordKey:'program',inputSHA:'4'.repeat(64)}),primary=state.record({stage:'parse',completedPrerequisites:['decode'],native:{exit:0},error:new Error('first')});
 const all=createHash('sha256');let bytes=0;
 for(let i=0;i<1000;i++) {
  const envelope=state.record({stage:'retain',completedPrerequisites:['decode'],native:{exit:1},error:{message:'"'.repeat(2048)+i,stack:'\\'.repeat(4096)}}),serialized=JSON.stringify(envelope);
  bytes+=Buffer.byteLength(serialized);all.update(serialized+'\n');
  const snapshot=state.snapshot();assert.equal(snapshot.primary,primary);
  assert(Buffer.byteLength(JSON.stringify({secondary:snapshot.secondary,secondarySummary:snapshot.secondarySummary}))<=2048);
 }
 const snapshot=state.snapshot();assert(snapshot.secondary.length>0);assert(snapshot.secondarySummary.overflowCount>0);
 assert.equal(snapshot.secondarySummary.count,1000);assert.equal(snapshot.secondarySummary.bytes,bytes);assert.equal(snapshot.secondarySummary.sha256,all.digest('hex'));
 assert.equal(snapshot.secondary.length+snapshot.secondarySummary.overflowCount,1000);assert(Object.isFrozen(snapshot.secondarySummary));
});

test('streaming raw capture hashes immutable observed bytes and retains exact complete-member prefixes',()=>{
 const raw=Buffer.alloc(140000);for(let i=0;i<raw.length;i++)raw[i]=(i*31)%251;
 for(const [producerCap,remainingBytes] of [[raw.length,200000],[70000,200000],[raw.length,600],[raw.length,0]]) {
  const expected=captureRawMembers(raw,{producerCap,remainingBytes}),sink=createRawCapture({producerCap,remainingBytes});
  for(let at=0;at<raw.length;at+=997){const chunk=Buffer.from(raw.subarray(at,at+997));sink.write(chunk);chunk.fill(0);}
  const captured=sink.finish();assert.deepEqual(captured,expected);assert.equal(sink.finish(),captured);
  assert.equal(captured.observedSHA256,createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(replayRawMembers(captured,{producerCap,requireComplete:false}),raw.subarray(0,captured.retainedBytes));
  assert.throws(()=>sink.write(Buffer.from('late')),/marker_raw_closed/);
 }
 const empty=createRawCapture({producerCap:0,remainingBytes:20}).finish();assert.equal(empty.complete,true);assert.equal(empty.members.length,1);assert.equal(replayRawMembers(empty,{producerCap:0}).length,0);
});
