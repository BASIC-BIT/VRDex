import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as media from '../../scripts/event-capacity-media.mjs';
import { inspectClock,assertProgramClock } from '../../scripts/event-marker-clock.mjs';
import { assertDecodedCoverage } from '../../scripts/marker-qualification/media-facts.mjs';
import { assertReplayedProgram } from '../../scripts/marker-qualification/program-replay.mjs';
import { validateMarkerRecord } from '../../scripts/event-marker-evidence.mjs';

// SIMULATED native effects only: six independently placed 100ms, 700Hz pulses
// at 0.5..5.5s, with matching observed flash edges and a complete 7s capture.
function simulatedChannels({lagSamples=0,audioGap=false,videoGap=false}={}) {
 const samples=7*48000,frames=7*30,pcm=Buffer.alloc(samples*2),rgb=Buffer.alloc(frames*6);
 for(let pulse=0;pulse<6;pulse++) {
  const start=24000+pulse*48000+lagSamples;
  for(let i=0;i<4800;i++)pcm.writeInt16LE(Math.round(0.6*32767*Math.sin(2*Math.PI*700*i/48000)),(start+i)*2);
 }
 for(let i=0;i<frames;i++){rgb[i*6]=255;if(i%30>=15&&i%30<18&&i<180)rgb.fill(255,i*6+3,i*6+6);}
 const video=Array.from({length:frames},(_,i)=>`frame:${i} pts:${videoGap&&i===2?3000:i*3000} pts_time:0\nlavfi.signalstats.YAVG=10\n`).join('');
 const audio=Array.from({length:samples/480},(_,i)=>`frame:${i} pts:${i*480+(audioGap&&i===2?1:0)} pts_time:0\nlavfi.astats.Overall.Number_of_samples=480\n`).join('');
 return {pcm,rgb,video,audio};
}
function simulatedOwner(channels=simulatedChannels()) {
 const calls={start:0,probe:0};
 const owner={run:async()=>{calls.probe++;return Buffer.from(JSON.stringify({streams:[{codec_type:'video',index:0},{codec_type:'audio',index:1}]}));},start:()=>{
  calls.start++;const pipes=Array.from({length:7},()=>new PassThrough()),child={stdio:pipes,stderr:pipes[2],kill:()=>{}};
  child.closed=new Promise(resolve=>setImmediate(()=>{for(const [fd,k] of [[3,'rgb'],[4,'pcm'],[5,'video'],[6,'audio']])pipes[fd].end(channels[k]);resolve(0);}));return child;
 }};
 return {owner,calls,startCapture:()=>{const child=owner.start();return {child,stop:()=>{},finish:async()=>{await child.closed;return {native:{exitCode:0}};}};}};
}
const options={width:854,height:480,maxSeconds:7,windows:[{identity:'a',start:0,end:6}]};
async function withRecording(run) {
 const dir=await mkdtemp(join(tmpdir(),'marker-decode-SIMULATED-')),file=join(dir,'synthetic-bytes'),bytes=Buffer.from('SIMULATED recording identity; no native media');
 try{await writeFile(file,bytes);await run(file,bytes);}finally{await rm(dir,{recursive:true,force:true});}
}
test('ordinary public decode returns observed markers and file identity without qualification authority',()=>withRecording(async(file,bytes)=>{
 const {owner}=simulatedOwner(),record=await media.decodeMediaMarkerRecord(owner,file,options);
 assert.equal(record.episodes.length,6);assert(record.episodes.every(e=>e.identity==='a'));assert.equal(record.visuals.length,6);
 assert.equal(record.recordingSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(record.videoStreamIndex,0);assert.equal(record.audioStreamIndex,1);
 assert.equal(Object.hasOwn(record,'clock'),false);assert.equal(Object.hasOwn(record,'assurance'),false);
 for(const candidate of [record,structuredClone(record),{...record,clock:{kind:'ClockCompatible',sourceKind:'externalCodedRecording'}}]){
  assert.throws(()=>assertDecodedCoverage(candidate,{frames:210,fps:30,samples:336000}),/marker_clock_unproven/);
  assert.throws(()=>assertProgramClock(candidate.clock),/marker_clock_unproven/);assert.throws(()=>assertReplayedProgram(candidate),/proof_required/);
 }
}));
test('ordinary measurement reaches real association, packed wire validation and six A/V pairs',()=>withRecording(async file=>{
 const {owner}=simulatedOwner(),measurement=await media.measureMediaMarkers(owner,file,options);
 validateMarkerRecord(measurement.markerEvidence);assert.equal(measurement.markerCount,6);assert.equal(measurement.avDriftMs,0);assert.equal(measurement.markerWindows[0].pairs.length,6);assert.equal(measurement.markerDecode.complete,true);
 assert.equal(Object.hasOwn(measurement,'clock'),false);assert.equal(Object.hasOwn(measurement,'assurance'),false);
}));
for(const [name,channels,error] of [
 ['audio continuity',{audioGap:true},/^marker_audio_continuity$/],
 ['video continuity',{videoGap:true},/^marker_video_continuity$/],
 ['131ms A/V offset',{lagSamples:6288},/^marker_context_failure:av_out_of_bounds$/],
])test(`ordinary measurement preserves ${name} rejection`,()=>withRecording(async file=>{
 await assert.rejects(media.measureMediaMarkers(simulatedOwner(simulatedChannels(channels)).owner,file,options),caught=>{assert.match(caught.message,error);return true;});
}));
test('ordinary entry rejects qualification-only option presence before native effects',async()=>{
 for(const extra of [{observeDecoded:undefined},{startCapture:undefined},{observeDecoded:()=>{}},{startCapture:()=>{}},Object.create({observeDecoded:undefined})]){
  const {owner,calls}=simulatedOwner();const configured=Object.assign(Object.create(Object.getPrototypeOf(extra)),options,extra);
  await assert.rejects(media.decodeMediaMarkerRecord(owner,'unused',configured),/marker_qualified_decoder_required/);assert.deepEqual(calls,{start:0,probe:0});
 }
});
test('strict entry requires both callbacks before native effects',async()=>{
 assert.equal(typeof media.decodeQualifiedMediaMarkerRecord,'function');
 for(const extra of [{},{observeDecoded:()=>{}},{startCapture:()=>{}},{observeDecoded:null,startCapture:()=>{}},{observeDecoded:()=>{},startCapture:1}]){
  const {owner,calls}=simulatedOwner();await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,'unused',{...options,...extra}),/marker_clock_unproven/);assert.deepEqual(calls,{start:0,probe:0});
 }
});
test('strict malformed capture never falls back to owner.start or calls the observer',async()=>{
 assert.equal(typeof media.decodeQualifiedMediaMarkerRecord,'function');
 for(const capture of [undefined,null,{}, {child:{}}, {child:{stdio:[]},finish:()=>{},stop:()=>{}}]){
  const {owner,calls}=simulatedOwner();let observed=false;
  await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,'unused',{...options,startCapture:()=>capture,observeDecoded:()=>{observed=true;}}),/marker_clock_unproven/);
  assert.deepEqual(calls,{start:0,probe:0});assert.equal(observed,false);
 }
});
test('strict observer receives complete non-null capture and rejects unproven and literal clocks',()=>withRecording(async file=>{
 assert.equal(typeof media.decodeQualifiedMediaMarkerRecord,'function');
 for(const clock of [()=>undefined,()=>({kind:'ClockCompatible'}),()=>({sourceKind:'externalFeed',verified:true}),data=>inspectClock(data,{mode:'literal',fps:30},{kind:'literal',frames:210,samples:336000})]){
  const {owner,startCapture}=simulatedOwner();let observed=0;
  await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,file,{...options,startCapture,observeDecoded:data=>{observed++;assert(data.nativeCapture);assert.equal(data.audioRows.length,700);assert.equal(data.rgb.length,1260);return clock(data);}}),/marker_clock_unproven/);assert.equal(observed,1);
 }
 const {owner,startCapture}=simulatedOwner(),failure=Error('observer sentinel');await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,file,{...options,startCapture,observeDecoded:()=>{throw failure;}}),error=>error===failure);
}));
test('strict finish must supply a captured invocation before the observer',()=>withRecording(async file=>{
 assert.equal(typeof media.decodeQualifiedMediaMarkerRecord,'function');
 for(const terminal of [null,undefined,{}, {native:null}]){
  const {owner,startCapture}=simulatedOwner();let observed=false;
  await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,file,{...options,startCapture:()=>{const started=startCapture();return {...started,finish:async()=>{await started.finish();return terminal;}};},observeDecoded:()=>{observed=true;}}),/marker_clock_unproven/);assert.equal(observed,false);
 }
}));

test('strict malformed owned capture is stopped and finished before rejection',async()=>{
 const events=[],owner={start:()=>{throw Error('uncaptured fallback');}};
 const child={stdio:[],closed:Promise.resolve(0)};
 await assert.rejects(media.decodeQualifiedMediaMarkerRecord(owner,'unused',{...options,startCapture:()=>({child,stop:()=>events.push('stop'),finish:async()=>{events.push('finish');throw Error('capture stopped');}}),observeDecoded:()=>{throw Error('unexpected observer');}}),/marker_clock_unproven/);
 assert.deepEqual(events,['stop','finish']);
});

import { gzipSync } from 'node:zlib';
import { enumerateQualification } from '../../scripts/marker-qualification/authority.mjs';
import { observeVerdict,prerequisiteStates,observationName,makeResultShards,validateResultUnion } from '../../scripts/marker-qualification/results.mjs';
test('ordinary facts, forged clock and serialized copies cannot enter verdict or outer result union',()=>withRecording(async file=>{
 const record=await media.decodeMediaMarkerRecord(simulatedOwner().owner,file,options),invocation=enumerateQualification().invocations.find(i=>i.kind==='mass'),pins={scope:'SIMULATED ordinary admission negative'};
 for(const candidate of [{record},JSON.parse(JSON.stringify({record})),{record:{...record,clock:{kind:'ClockCompatible',sourceKind:'externalCodedRecording'}}}]){
  assert.throws(()=>observeVerdict(invocation,0,candidate),/marker_replay_proof_required/);
  const bytes=gzipSync(Buffer.from(JSON.stringify(candidate))),sha256=createHash('sha256').update(bytes).digest('hex');
  const rows=invocation.rows.map((_,index)=>({index,status:'pass',prerequisites:prerequisiteStates('pass'),observation:{name:observationName(invocation,index),bytes:bytes.length,sha256}}));
  const bundle=makeResultShards(invocation,rows,pins);
  assert.throws(()=>validateResultUnion([invocation],[bundle],pins,()=>bytes,()=>candidate),/marker_replay_proof_required/);
 }
}));
