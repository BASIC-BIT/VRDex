import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQualificationOwner } from '../../scripts/marker-qualification/owner.mjs';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
import { startCapturedInvocation } from '../../scripts/marker-qualification/invocation-capture.mjs';
const dependencies=async()=>({kind:'Unproven',missing:['binding_context'],artifacts:[]});
async function setup(run) {
 const directory=await mkdtemp(join(tmpdir(),'marker-capture-'));let child,actual;
 const owner=await createQualificationOwner({scan:async()=>[],signal:()=>{},spawn:(command,args,options)=>{actual={command,args,options};child=new EventEmitter();child.pid=123;child.stdio=options.stdio.map(mode=>mode==='pipe'?new PassThrough():null);child.stderr=child.stdio[2];return child;}});
 const store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'});
 try {await run({owner,store,get child(){return child;},get actual(){return actual;}});}finally{await rm(directory,{recursive:true,force:true});}
}
test('actual owner capture derives diagnostic arguments afresh, retains original bytes and observes real close/EOF separately',async()=>setup(async state=>{
 const session=await startCapturedInvocation(state.owner,{original:['-loglevel','error','-i','pipe:3','-f','mpegts','pipe:1'],stdio:['ignore','pipe','pipe','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store:state.store,prefix:'fake-program',dependencies});
 assert.equal(state.actual.command,'ffmpeg');assert(state.actual.args.includes('repeat+level+verbose'));assert.deepEqual(state.actual.args.slice(-5),['-i','pipe:3','-f','mpegts','pipe:1']);
 const result=session.finish();state.child.stderr.end('[verbose] original\n');state.child.stdio[7].end('progress=end\n');await new Promise(resolve=>setImmediate(resolve));state.child.emit('close',0,null);
 const observed=await result;assert.equal(observed.stderr.toString(),'[verbose] original\n');assert.equal(observed.native.exitCode,0);assert.equal(observed.native.signal,null);assert.equal(observed.channelEOF.stderr,true);assert.equal(observed.binding.kind,'Unproven');assert(!Object.hasOwn(observed,'consumerReadEOF'));assert(state.store.entries.some(e=>e.role==='stderr'));assert(state.store.numericBytes>0);
}));
test('actual close zero cannot replace a missing stream EOF, and owner signal remains a failure',async()=>{
 for(const signal of [null,'SIGTERM'])await setup(async state=>{
  const session=await startCapturedInvocation(state.owner,{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store:state.store,prefix:'fake-program',dependencies});
  const result=session.finish();state.child.stderr.write('partial');state.child.stdio[7].end('progress=end\n');await new Promise(resolve=>setImmediate(resolve));state.child.emit('close',signal?null:0,signal);
  await assert.rejects(result,error=>{assert.equal(error.nativeCapture.channelEOF.stderr,false);assert.equal(error.nativeCapture.native.signal,signal);return true;});assert(state.store.entries.some(e=>e.role==='native'));
 });
});

test('a capture pipe failure keeps its original error identity through partial retention and native close',async()=>setup(async state=>{
 const session=await startCapturedInvocation(state.owner,{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store:state.store,prefix:'fake-program',dependencies}),original=Error('original pipe failure');
 const result=session.finish();state.child.stderr.write('original prefix');state.child.stderr.emit('error',original);state.child.stdio[7].end('progress=end\n');await new Promise(resolve=>setImmediate(resolve));state.child.emit('close',null,'SIGKILL');
 await assert.rejects(result,error=>{assert.equal(error,original);assert.equal(error.nativeCapture.native.stopReason,'pipe_error');return true;});
}));

for(const late of [false,true])test(`acquisition deadline bounds ${late?'late':'pending'} dependency and prevents later spawn or retention`,async()=>setup(async state=>{
 let resolve,options,starts=0;
 const pending=new Promise(r=>{resolve=r;}),owner={start(){starts++;throw Error('unexpected spawn');}};
 const result=startCapturedInvocation(owner,{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:10,store:state.store,prefix:'fake-deadline',dependencies:input=>{options=input;return pending;}});
 const outcome=await Promise.race([result.then(()=>null,error=>error),new Promise(r=>setTimeout(()=>r('still pending'),80))]);
 assert.equal(outcome?.message,'timeout');assert(options.signal.aborted);assert(Number.isFinite(options.deadline));
 if(late){resolve({kind:'Unproven',missing:[],artifacts:[{id:'late',bytes:1,sha256:'a'.repeat(64),data:'YQ=='}]});await new Promise(r=>setTimeout(r,20));}
 assert.equal(starts,0);assert.equal(state.store.entries.length,0);
}));
test('pending pre-spawn retention expires and its late continuation cannot write or spawn',async()=>setup(async state=>{
 let release,options,starts=0,writes=0;
 const store={...state.store,json:async(...args)=>{options=args.at(-1);await new Promise(r=>{release=r;});options.check();writes++;}};
 const result=startCapturedInvocation({start(){starts++;}},{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:10,store,prefix:'fake-retention',dependencies});
 const outcome=await Promise.race([result.then(()=>null,error=>error),new Promise(r=>setTimeout(()=>r('still pending'),80))]);
 assert.equal(outcome?.message,'timeout');assert(options.signal.aborted);release();await new Promise(r=>setImmediate(r));assert.equal(writes,0);assert.equal(starts,0);
}));

test('original pipe failure stays primary when native catalog retention fails, using the bounded final reserve',async()=>setup(async state=>{
 const retentionError=Error('native journal retention failure'),store=Object.create(state.store);
 store.json=async(name,...args)=>{if(name.endsWith('-native.json.gz'))throw retentionError;return state.store.json(name,...args);};
 const session=await startCapturedInvocation(state.owner,{original:['-loglevel','error'],stdio:['ignore','ignore','pipe'],channels:{},stderrCap:65536,timeoutMs:1000,store,prefix:'fake-reserve',dependencies}),original=Object.assign(Error('original pipe failure'),{code:'EPIPE'});
 const result=session.finish();state.child.stderr.end('partial');state.child.stderr.emit('error',original);state.child.stdio[7].end();await new Promise(r=>setImmediate(r));state.child.emit('close',null,'SIGKILL');
 await assert.rejects(result,error=>error===original);
 const journal=JSON.parse(await readFile(state.store.path('fake-reserve-capture-failure.json')));
 assert.equal(journal.primary.error.message,original.message);assert.equal(journal.primary.error.code,'EPIPE');assert.equal(journal.secondary[0].error.message,retentionError.message);assert(Buffer.byteLength(JSON.stringify(journal.primary))<=8192);
}));
