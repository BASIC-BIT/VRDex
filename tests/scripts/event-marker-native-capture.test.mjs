import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { createRawCapture, replayRawMembers } from '../../scripts/event-marker-raw-capture.mjs';
import { diagnosticArguments, restoreDiagnosticArguments, captureNativeFeed } from '../../scripts/event-marker-native-capture.mjs';
import { programEncoderArguments } from '../../workers/restream/program-renderer.mjs';
import { localTwitchArguments } from '../../scripts/marker-qualification/codec-io.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

test('diagnostic argv preserves and reverses every original program and local Twitch media argument',()=>{
 for(const videoPreset of ['480p30','480p60','720p30','720p60','1080p30','1080p60'])for(const audioBitrateKbps of [160,320]) {
  const settings={videoPreset,audioBitrateKbps};
  for(const [original,stdio,fd] of [[programEncoderArguments(settings),['ignore','pipe','pipe','pipe','pipe','pipe'],5],[localTwitchArguments(settings).args,['pipe','pipe','pipe','pipe'],3]]) {
   const binding=diagnosticArguments(original,{stdio});
   assert.deepEqual(restoreDiagnosticArguments(binding),original);assert.equal(binding.originalSHA256,sha(original));assert.equal(binding.diagnosticSHA256,sha(binding.args));
   assert.equal(binding.progressFd,fd);assert.deepEqual(binding.stdio,stdio);assert.equal(binding.args.filter(s=>s==='-progress').length,1);
   assert.equal(binding.args[binding.args.indexOf('-loglevel')+1],'repeat+level+verbose');assert.equal(binding.args.filter(s=>s==='-nostats').length,1);
   assert(Object.isFrozen(binding)&&Object.isFrozen(binding.args)&&Object.isFrozen(binding.edits));
  }
 }
});

test('diagnostic argv allocates only proven-unused fd7 and rejects ambiguous logging or progress',()=>{
 const original=['-hide_banner','-nostdin','-loglevel','info','-i','original.ts','-f','rawvideo','pipe:3','-af',"ametadata=file='pipe\\:6'",'-f','s16le','pipe:4'];
 const binding=diagnosticArguments(original,{stdio:['ignore','ignore','pipe','pipe','pipe','pipe','pipe']});
 assert.deepEqual(restoreDiagnosticArguments(binding),original);assert.equal(binding.progressFd,7);assert.equal(binding.stdio[7],'pipe');assert.equal(binding.args[0],'-progress');assert.equal(binding.args[1],'pipe:7');
 for(const args of [original.filter(x=>!['-loglevel','info'].includes(x)),[...original,'-v','error'],[...original,'-report'],[...original,'-loglevel=debug'],[...original,'-progress','pipe:3'],[...original,'-progress','pipe:3','-progress','pipe:4'],[...original,'pipe:7'],[...original,"metadata=file='pipe\\:7'"],original.map(x=>x==='info'?'debug':x)])assert.throws(()=>diagnosticArguments(args,{stdio:['ignore','ignore','pipe','pipe','pipe','pipe','pipe']}),/marker_native_argv/);
 assert.throws(()=>diagnosticArguments(original,{stdio:['ignore','ignore','pipe','pipe','pipe','pipe','pipe','pipe']}),/marker_native_argv/);
 const changed=structuredClone(binding);changed.args[changed.args.indexOf('original.ts')]='other.ts';changed.diagnosticSHA256=sha(changed.args);assert.throws(()=>restoreDiagnosticArguments(changed),/marker_native_argv/);
});

test('diagnostic argv rejects independent debug options and stream or boolean forms before binding',()=>{
 const original=['-hide_banner','-loglevel','info','-i','original.ts','-f','rawvideo','pipe:3'],stdio=['ignore','ignore','pipe','pipe'];
 const switches=[['-debug_ts'],['-debug','1'],['-debug','0'],['-fdebug','1'],['-fdebug','0'],['-debug:v:0','1'],['-vdebug','1'],['-adebug','1'],['-sdebug','1'],['-nodebug_ts'],['-debug_ts:v'],['-nodebug_ts:v'],['-debug=1'],['-fdebug=1'],['-debug_ts=1']];
 for(const options of switches)for(const args of [[...options,...original],[...original,...options]])assert.throws(()=>diagnosticArguments(args,{stdio}),/marker_native_argv/,options.join(' '));
 const filename=original.map(s=>s==='original.ts'?'debug_ts.ts':s);assert.deepEqual(restoreDiagnosticArguments(diagnosticArguments(filename,{stdio})),filename);
});

test('native feed captures immutable chunk hashes callbacks and finish without asserting consumer EOF',async()=>{
 const source=Buffer.from('abcdef'),seen=[];
 const stream=new Writable({highWaterMark:1,write(bytes,_encoding,done){source.fill(0);seen.push(Buffer.from(bytes));queueMicrotask(done);}});
 const trace=createRawCapture({producerCap:8388608,remainingBytes:196608});
 const result=await captureNativeFeed(stream,[source],{byteCap:6,trace});
 assert.equal(result.complete,true);assert.equal(result.writeFinish,true);assert.equal(result.attemptedBytes,6);assert.equal(result.writtenBytes,6);assert.equal(result.writeCallbacks,1);
 assert.equal(result.actualFedSHA256,createHash('sha256').update('abcdef').digest('hex'));assert.equal(Buffer.concat(seen).toString(),'abcdef');assert(!Object.hasOwn(result,'consumerReadEOF'));
 const events=replayRawMembers(result.trace,{producerCap:8388608}).toString().trim().split('\n').map(JSON.parse);
 assert.deepEqual(events.map(e=>e.event),['write','callback','end','finish']);assert.equal(events[0].sha256,result.actualFedSHA256);assert.equal(events[1].ok,true);
});

test('native feed retains callback or byte-bound failure and incomplete trace cannot certify writes',async()=>{
 const first=Object.assign(new Error('synthetic write failure'),{code:'E_PIPE'}),stream=new Writable({write(_bytes,_encoding,done){queueMicrotask(()=>done(first));}});
 const failed=await captureNativeFeed(stream,[Buffer.from('abc')],{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 assert.equal(failed.complete,false);assert.equal(failed.error,first);assert.equal(failed.attemptedBytes,3);assert.equal(failed.writtenBytes,0);assert.equal(failed.writeFinish,false);
 const events=replayRawMembers(failed.trace,{producerCap:8388608}).toString().trim().split('\n').map(JSON.parse);assert.equal(events[1].event,'callback');assert.equal(events[1].ok,false);
 let writes=0;const over=new Writable({write(_bytes,_encoding,done){writes++;done();}});
 const bounded=await captureNativeFeed(over,[Buffer.alloc(3)],{byteCap:2,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});assert.equal(bounded.complete,false);assert.match(bounded.error.message,/byte_cap/);assert.equal(writes,0);
 const unretained=await captureNativeFeed(new Writable({write(_bytes,_encoding,done){done();}}),[Buffer.from('abc')],{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:0})});
 assert.equal(unretained.writeFinish,true);assert.equal(unretained.complete,false);assert.equal(unretained.trace.complete,false);assert.match(unretained.error.message,/byte_cap/);
});

test('native feed never promotes premature close or finalization failure to writeFinish',async()=>{
 const finishError=Object.assign(new Error('synthetic finish failure'),{code:'E_FINISH'});
 const closeEarly=new Writable({write(_bytes,_encoding,_done){this.destroy();}});
 const failEnd=new Writable({write(_bytes,_encoding,done){done();},final(done){done(finishError);}});
 for(const stream of [closeEarly,failEnd]) {
  const result=await captureNativeFeed(stream,[Buffer.from('abc')],{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
  assert.equal(result.complete,false);assert.equal(result.writeFinish,false);assert.equal(result.actualFedByteCount,null);assert.equal(result.actualFedSHA256,null);
  if(stream===failEnd){assert.equal(result.error,finishError);assert.equal(result.writtenBytes,3);assert.equal(result.writeCallbacks,1);}
  const events=replayRawMembers(result.trace,{producerCap:8388608}).toString().trim().split('\n').map(JSON.parse);assert(!events.some(e=>e.event==='finish'));
 }
});

test('feed trace finalization preserves an established primary and retains its secondary failure',async()=>{
 const primary=Object.assign(new Error('primary write error'),{code:'E_PRIMARY'}),secondary=Object.assign(new Error('trace finish error'),{code:'E_TRACE'});
 for(const prior of [true,false]) {
  const stream=new Writable({write(_bytes,_encoding,done){done(prior?primary:undefined);}});
  const trace={write:()=>({producerExceeded:false,retentionStopped:false}),finish:()=>{throw secondary;}};
  const result=await captureNativeFeed(stream,[Buffer.from('abc')],{byteCap:3,trace});
  assert.equal(result.complete,false);assert.equal(result.trace.complete,false);assert.equal(result.traceState,'unavailable');
  assert.equal(result.error,prior?primary:secondary);assert.deepEqual(result.secondaryErrors,prior?[secondary]:[]);
  assert.equal(result.attemptedBytes,3);assert.equal(result.writtenBytes,prior?0:3);assert.equal(result.writeFinish,!prior);
 }
});

test('successful feed hash commits pre-submission bytes even when the Writable mutates its buffer',async()=>{
 const source=Buffer.from('original'),expected=createHash('sha256').update(source).digest('hex');
 const stream=new Writable({write(bytes,_encoding,done){bytes.fill(120);done();}});
 const result=await captureNativeFeed(stream,[source],{byteCap:source.length,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 assert.equal(source.toString(),'original');assert.equal(result.complete,true);assert.equal(result.attemptedSHA256,expected);assert.equal(result.writtenSHA256,expected);assert.equal(result.actualFedSHA256,expected);
 const events=replayRawMembers(result.trace,{producerCap:8388608}).toString().trim().split('\n').map(JSON.parse);assert.equal(events[0].sha256,expected);
});

test('pipe terminal events interrupt a pending source iterator without waiting for uncooperative return',async()=>{
 for(const withError of [true,false]) {
  let entered,release,reads=0,cancelled=0;const waiting=new Promise(resolve=>{entered=resolve;}),never=new Promise(resolve=>{release=resolve;});
  const source={ [Symbol.asyncIterator](){return this;},next(){if(reads++===0)return Promise.resolve({value:Buffer.from('abc'),done:false});entered();return never;},return(){cancelled++;return new Promise(()=>{});} };
  const stream=new Writable({write(_bytes,_encoding,done){done();}}),primary=Object.assign(new Error('downstream failed between chunks'),{code:'E_GAP'});
  const feed=captureNativeFeed(stream,source,{byteCap:6,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
  try {
   await waiting;stream.destroy(withError?primary:undefined);
   const bounded=new Promise(resolve=>setImmediate(()=>setImmediate(()=>resolve('still pending'))));
   const result=await Promise.race([feed,bounded]);assert.notEqual(result,'still pending');
   assert.equal(result.complete,false);assert.equal(result.writeFinish,false);assert.equal(result.writtenBytes,3);assert.equal(cancelled,1);assert.equal(result.sourceCancellation.requested,true);assert.equal(result.sourceCancellation.complete,false);
   if(withError)assert.equal(result.error,primary);else assert.match(result.error.message,/qualification_input_pipe/);
  }finally{release({done:true});await feed;}
 }
});

test('feed cancellation failures remain observable without replacing the pipe primary',async()=>{
 const primary=Error('pipe write failure'),cleanup=Error('source cancellation failure');
 for(const asynchronous of [false,true]) {
  const source={ [Symbol.iterator](){return this;},next(){return {value:Buffer.from('abc'),done:false};},return(){if(asynchronous)return Promise.reject(cleanup);throw cleanup;} };
  const result=await captureNativeFeed(new Writable({write(_bytes,_encoding,done){done(primary);}}),source,{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
  assert.equal(result.error,primary);assert.equal(result.complete,false);assert.equal(result.sourceCancellation.requested,true);
  const outcome=await result.cancellationOutcome;assert.equal(outcome.complete,false);assert.equal(outcome.error,cleanup);
  if(!asynchronous)assert.deepEqual(result.secondaryErrors,[cleanup]);
 }
});

test('feed preserves async-from-sync promised bytes',async()=>{
 const seen=[],stream=new Writable({write(bytes,_encoding,done){seen.push(Buffer.from(bytes));done();}});
 const result=await captureNativeFeed(stream,[Promise.resolve(Buffer.from('promised'))],{byteCap:8,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 assert.equal(result.complete,true);assert.equal(Buffer.concat(seen).toString(),'promised');assert.equal(result.writtenBytes,8);
});

test('feed preserves rejecting sync-iterator value primary identity',async()=>{
 const primary=Error('promised chunk failure');let assimilated=false;
 const failed=await captureNativeFeed(new Writable({write(_bytes,_encoding,done){done();}}),[{then(_resolve,reject){assimilated=true;reject(primary);}}],{byteCap:8,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 assert.equal(assimilated,true);assert.equal(failed.error,primary);assert.equal(failed.writtenBytes,0);assert.equal(failed.complete,false);
});

test('pipe failure interrupts pending sync-iterator value and never writes its late bytes',async()=>{
 let entered,release,cancelled=0,writes=0;
 const waiting=new Promise(resolve=>{entered=resolve;}),value={then(resolve){release=resolve;entered();}};
 const chunks={[Symbol.iterator](){return this;},next(){return {value,done:false};},return(){cancelled++;return {done:true};}};
 const stream=new Writable({write(_bytes,_encoding,done){writes++;done();}}),primary=Error('pipe failed during promised value');
 const feed=captureNativeFeed(stream,chunks,{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 let settled=false;feed.then(()=>{settled=true;});
 await Promise.race([waiting,new Promise(resolve=>setImmediate(resolve))]);
 try {
  assert.equal(settled,false);stream.destroy(primary);
  const result=await Promise.race([feed,new Promise(resolve=>setImmediate(()=>setImmediate(()=>resolve('still pending'))))]);
  assert.notEqual(result,'still pending');assert.equal(result.error,primary);assert.equal(result.complete,false);assert.equal(cancelled,1);assert.equal(writes,0);
 }finally{release?.(Buffer.from('abc'));await feed;}
 await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,0);
});

test('true async iterators retain their value semantics without async-from-sync assimilation',async()=>{
 let assimilated=false;const value={then(resolve){assimilated=true;resolve(Buffer.from('abc'));}};
 const chunks={[Symbol.asyncIterator](){return this;},async next(){return {done:false,value};},async return(){return {done:true};}};
 const result=await captureNativeFeed(new Writable({write(_bytes,_encoding,done){done();}}),chunks,{byteCap:3,trace:createRawCapture({producerCap:8388608,remainingBytes:196608})});
 assert.equal(assimilated,false);assert.match(result.error.message,/marker_native_feed_type/);assert.equal(result.writtenBytes,0);
});
