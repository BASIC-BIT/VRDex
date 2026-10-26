import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough,Writable } from 'node:stream';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createQualificationOwner } from '../../scripts/marker-qualification/owner.mjs';
import { createArtifactStore,createInvocationStore } from '../../scripts/marker-qualification/artifacts.mjs';
import { encodeProgram } from '../../scripts/marker-qualification/codec-io.mjs';
import { readQualificationRecording } from '../../scripts/marker-qualification/codec-record.mjs';
import { inventoryProgramTransport } from '../../scripts/event-marker-conservation.mjs';
import { fakeProgramTransport,fakeProgramNativeLogs } from '../fixtures/marker-program-transport.mjs';
const dependencies=async()=>({kind:'Unproven',missing:['binding_context','source_guard_descriptions'],artifacts:[]});
const info={format:{format_name:'mpegts'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:854,height:480,r_frame_rate:'30/1',pix_fmt:'yuv420p',time_base:'1/90000'},{index:1,codec_type:'audio',codec_name:'aac',channels:2,sample_rate:'48000',time_base:'1/90000'}]};
const packetFacts={monotonic:true,maxGop:1,packets:7,audioKbps:160,maxGap:1/30};
async function exercise(mutate=()=>{}) {
 const directory=await mkdtemp(join(tmpdir(),'marker-program-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'}),transport=fakeProgramTransport(),inventory=inventoryProgramTransport(transport.bytes,{byteCap:transport.bytes.length}),logs=fakeProgramNativeLogs(inventory),commands=[];
 const owner=await createQualificationOwner({scan:async()=>[],signal:()=>{},spawn:(command,args,options)=>{
  const child=new EventEmitter();child.pid=100+commands.length;commands.push({command,args});child.stdio=options.stdio.map(mode=>mode==='pipe'?new PassThrough():null);child.stdout=child.stdio[1];child.stderr=child.stdio[2];
  const close=()=>setImmediate(()=>child.emit('close',0,null));
  if(args.includes('mpegts')) {
   let finished=0;for(const fd of [3,4]){child.stdio[fd]=new Writable({write(chunk,encoding,callback){callback();}});child.stdio[fd].once('finish',()=>{if(++finished===2)setImmediate(()=>{child.stdout.end(transport.bytes);child.stderr.end(logs.encoder);child.stdio[5].end(logs.progress);close();});});}
  }else setImmediate(()=>{
   const data={stderr:logs.decoder,progress:logs.progress,pcm:Buffer.alloc(10240),rgb:Buffer.alloc(12),video:Buffer.from([1920,4920].map((pts,i)=>`frame:${i} pts:${pts} pts_time:0\nlavfi.signalstats.YAVG=0\n`).join('')),audio:Buffer.from(Array.from({length:5},(_,i)=>`frame:${i} pts:${1024*i} pts_time:0\nlavfi.astats.Overall.Number_of_samples=1024\n`).join(''))};mutate(data);
   for(const [fd,key] of [[2,'stderr'],[3,'rgb'],[4,'pcm'],[5,'video'],[6,'audio'],[7,'progress']])child.stdio[fd].end(data[key]);close();
  });return child;
 }});
 try {
  let constructions=0;const frameFactory=function*(){constructions++;yield Buffer.alloc(854*480*3/2,1);yield Buffer.alloc(854*480*3/2,2);};
  const program=await encodeProgram(owner,{settings:{videoPreset:'480p30',audioBitrateKbps:160},frameFactory,frameCount:2,pcm:Buffer.alloc(12800),path:store.path('fake-program.ts'),store},{dependencies});
  assert.equal(constructions,2);assert.equal(program.producerEvidence.source.sourceJoin.frameCount,2);
  let caught;try{await readQualificationRecording(owner,store.path('fake-program.ts'),{settings:{videoPreset:'480p30',audioBitrateKbps:160},path:'program',frames:2,samples:3200,producerEvidence:program.producerEvidence,store},{probe:async()=>info,strictPacketFacts:async()=>packetFacts,dependencies});}catch(error){caught=error;}
  const entries=store.entries,conservation=entries.find(e=>e.name==='fake-program-decode-conservation.json.gz');
  return {error:caught,commands,entries,numericBytes:store.numericBytes,conservation:conservation?JSON.parse(gunzipSync(await readFile(store.path(conservation.name)))):null};
 }finally{await rm(directory,{recursive:true,force:true});}
}
test('actual program builder, owner and qualification decoder retain complete E→R observations but missing binding prevents classification',async()=>{
 const result=await exercise();assert.equal(result.error?.message,'marker_binding_unproven');assert.equal(result.error.qualificationPrerequisite,'decode_complete');assert(result.error.missingPremises.includes('source_guard_descriptions'));assert.equal(result.commands.length,2);assert(result.commands.every(c=>c.command==='ffmpeg'&&c.args.includes('repeat+level+verbose')));
 assert.equal(result.conservation.state,'Unproven');assert.equal(result.conservation.population.sourceSamples,3200);assert.equal(result.conservation.population.decodedSamples,5120);assert(result.entries.some(e=>e.role==='pcm'));assert(result.entries.some(e=>e.role==='videoMetadata'));assert(result.numericBytes<196608);
});
test('qualification orchestration reports population or original metadata failure before missing binding, retaining raw failed decode',async()=>{
 for(const mutate of [d=>d.stderr=Buffer.from(d.stderr.toString().replace('5120 samples','5119 samples')),d=>d.audio=Buffer.from('malformed original\n')]){
  const result=await exercise(mutate);assert.notEqual(result.error?.message,'marker_binding_unproven');assert.match(result.error?.message??'',/marker_/);assert(result.entries.some(e=>e.role==='pcm'));assert(result.entries.some(e=>e.role==='audioMetadata'));assert.equal(result.conservation,null);
 }
});

test('encodeProgram stdout error preserves original identity and bounded primary journal through close',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'marker-stdout-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'}),primary=Object.assign(Error('original-output-pipe-failure'),{code:'EPIPE'});
 const owner=await createQualificationOwner({scan:async()=>[],signal:()=>{},spawn:(_command,_args,options)=>{
  const child=new EventEmitter();child.pid=123;child.stdio=options.stdio.map(mode=>mode==='pipe'?new PassThrough():null);child.stdout=child.stdio[1];child.stderr=child.stdio[2];let finished=0;
  for(const fd of [3,4]){child.stdio[fd]=new Writable({write(_b,_e,cb){cb();}});child.stdio[fd].once('finish',()=>{if(++finished===2)setImmediate(()=>{child.stdout.emit('error',primary);child.stdout.end();child.stderr.end('[error] native pipe error\n');child.stdio[5].end('progress=end\n');setImmediate(()=>child.emit('close',null,'SIGKILL'));});});}return child;
 }});
 try{
  await assert.rejects(encodeProgram(owner,{settings:{videoPreset:'480p30',audioBitrateKbps:160},frameFactory:function*(){yield Buffer.alloc(854*480*3/2);},frameCount:1,pcm:Buffer.alloc(4),path:store.path('fake-program.ts'),store},{dependencies}),error=>{assert.equal(error,primary);assert.equal(error.nativeCapture.native.stopReason,'pipe_error');return true;});
  const journal=JSON.parse(gunzipSync(await readFile(store.path('fake-program-native.json.gz'))));assert.equal(journal.primary.error.message,primary.message);assert.equal(journal.primary.error.code,'EPIPE');assert.equal(journal.primary.error.stack,primary.stack);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('encodeProgram includes construction retention in the same deadline and prevents late writes or spawn',async()=>{
 let release,starts=0,writes=0,control;
 const result=encodeProgram({start(){starts++;throw Error('unexpected spawn');}},{settings:{videoPreset:'480p30',audioBitrateKbps:160},frameFactory:function*(){yield Buffer.alloc(854*480*3/2);},frameCount:1,pcm:Buffer.alloc(4),path:'fake-program.ts',timeoutMs:20,store:{json:async(...args)=>{control=args.at(-1);await new Promise(r=>{release=r;});control.check();writes++;}}},{dependencies});
 const outcome=await Promise.race([result.then(()=>null,error=>error),new Promise(r=>setTimeout(()=>r('still pending'),100))]);
 assert.equal(outcome?.message,'timeout');assert(control.signal.aborted);release();await new Promise(r=>setImmediate(r));assert.equal(writes,0);assert.equal(starts,0);
});

test('actual qualification decoder captures its original pipe error at decode stage',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'marker-decoder-error-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'}),primary=Object.assign(Error('original decoder stderr failure'),{code:'EPIPE'});
 const owner=await createQualificationOwner({scan:async()=>[],signal:()=>{},spawn:(_command,_args,options)=>{
  const child=new EventEmitter();child.pid=123;child.stdio=options.stdio.map(mode=>mode==='pipe'?new PassThrough():null);child.stderr=child.stdio[2];
  setImmediate(()=>{child.stderr.emit('error',primary);for(const stream of child.stdio)stream?.end();setImmediate(()=>child.emit('close',null,'SIGKILL'));});return child;
 }});
 try{
  await store.write('fake-program.ts',Buffer.from('opaque source-only fake recording'),1024,'coded');
  await assert.rejects(readQualificationRecording(owner,store.path('fake-program.ts'),{settings:{videoPreset:'480p30',audioBitrateKbps:160},path:'program',frames:2,samples:3200,store},{probe:async()=>info,strictPacketFacts:async()=>packetFacts,dependencies}),error=>{assert.equal(error,primary);assert.equal(error.recordFailure.primary.stage,'decode');return true;});
  const journal=JSON.parse(gunzipSync(await readFile(store.path('fake-program-decode-native.json.gz'))));assert.equal(journal.primary.stage,'decode');assert.equal(journal.primary.error.message,primary.message);assert.equal(journal.primary.error.code,'EPIPE');assert.equal(journal.primary.error.stack,primary.stack);assert.equal(journal.native.stopReason,'pipe_error');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('actual encoder stdout error remains encode stage with its original identity',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'marker-encoder-stage-')),store=createInvocationStore(createArtifactStore(directory),{id:'fake',kind:'mass'}),primary=Object.assign(Error('original encoder stdout failure'),{code:'EPIPE'});
 const owner=await createQualificationOwner({scan:async()=>[],signal:()=>{},spawn:(_command,_args,options)=>{
  const child=new EventEmitter();child.pid=123;child.stdio=options.stdio.map(mode=>mode==='pipe'?new PassThrough():null);child.stdout=child.stdio[1];child.stderr=child.stdio[2];let finished=0;
  for(const fd of [3,4]){child.stdio[fd]=new Writable({write(_b,_e,cb){cb();}});child.stdio[fd].once('finish',()=>{if(++finished===2)setImmediate(()=>{child.stdout.emit('error',primary);child.stdout.end();child.stderr.end();child.stdio[5].end();setImmediate(()=>child.emit('close',null,'SIGKILL'));});});}return child;
 }});
 try{
  await assert.rejects(encodeProgram(owner,{settings:{videoPreset:'480p30',audioBitrateKbps:160},frameFactory:function*(){yield Buffer.alloc(854*480*3/2);},frameCount:1,pcm:Buffer.alloc(4),path:store.path('fake-program.ts'),store},{dependencies}),error=>error===primary);
  const journal=JSON.parse(gunzipSync(await readFile(store.path('fake-program-native.json.gz'))));assert.equal(journal.primary.stage,'encode');assert.equal(journal.primary.error.message,primary.message);assert.equal(journal.primary.error.stack,primary.stack);assert.equal(journal.primary.error.code,'EPIPE');
 }finally{await rm(directory,{recursive:true,force:true});}
});
