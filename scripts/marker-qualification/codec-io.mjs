import { NATIVE_NOISE as N } from './construction-data.mjs';
import { once } from 'node:events';
import { createAcquisitionDeadline } from '../event-marker-native-binding.mjs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { programEncoderArguments } from '../../workers/restream/program-renderer.mjs';
import { outputArguments } from '../../workers/restream/output-sender.mjs';
import { VIDEO_PROFILES } from '../../workers/restream/broadcast-profiles.mjs';
import { captureNativeFeed } from '../event-marker-native-capture.mjs';
import { createRawCapture } from '../event-marker-raw-capture.mjs';
import { prepareRegenerableSource,joinRegeneratedFeed,snapshotProgramConstruction } from '../event-marker-source-ledger.mjs';
import { inventoryProgramTransport } from '../event-marker-conservation.mjs';
import { startCapturedInvocation,retainFeed } from './invocation-capture.mjs';
import { resolveDestinationProfile } from '../../workers/restream/broadcast-profiles.mjs';
import { parseMarkerMetadata } from '../event-marker-metadata.mjs';
export function localTwitchArguments(settings) {
 const target={url:'rtmp://example.invalid/app',key:'synthetic_qualification'},profile=resolveDestinationProfile({settings,destination:'twitch'});
 const original=outputArguments('twitch',target,profile),args=[],removed=[];
 for(let i=0;i<original.length;i++) {
  if(['-rw_timeout','-rtmp_playpath'].includes(original[i])){removed.push([i,original[i],original[++i]]);continue;}
  args.push(original[i]);
 }
 if(removed.length!==2||original.at(-1)!==target.url)throw Error('qualification_builder_transform');
 args[args.length-1]='pipe:1';
 const restored=[...args];restored[restored.length-1]=target.url;
 for(const [index,key,value] of removed)restored.splice(index,0,key,value);
 if(JSON.stringify(restored)!==JSON.stringify(original))throw Error('qualification_builder_reversal');
 return {args,originalSha256:createHash('sha256').update(JSON.stringify(original)).digest('hex'),transformedSha256:createHash('sha256').update(JSON.stringify(args)).digest('hex'),removed};
}
export async function feed(stream,chunks) {
 try {for await(const chunk of chunks){if(!stream.write(chunk))await once(stream,'drain');}stream.end();}
 catch {stream.destroy();throw Error('qualification_input_pipe');}
}
async function collect(child,{maxBytes,extraPipes=[],timeoutMs}) {
 const parts=[],extras=new Map(extraPipes.map(fd=>[fd,[]])),sizes=new Map(extraPipes.map(fd=>[fd,0]));let bytes=0,diagnostic=0,failed;
 const stop=code=>{failed??=code;try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
 const timer=setTimeout(()=>stop('timeout'),timeoutMs);
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)stop('byte_cap');else parts.push(chunk);});
 child.stderr.on('data',chunk=>{diagnostic+=chunk.length;if(diagnostic>65536)stop('diagnostic_cap');});
 for(const fd of extraPipes)child.stdio[fd].on('data',chunk=>{const size=sizes.get(fd)+chunk.length;sizes.set(fd,size);if(size>1048576)stop('metadata_cap');else extras.get(fd).push(chunk);});
 const code=await child.closed;clearTimeout(timer);
 if(code!==0||failed)throw Error(failed??'encode_failure');
 return {bytes:Buffer.concat(parts),extras:Object.fromEntries([...extras].map(([fd,chunks])=>[fd,Buffer.concat(chunks)])),diagnosticBytes:diagnostic};
}
async function writeArtifact(path,bytes,cap) {
 if(bytes.length>cap)throw Error('byte_cap');
 await writeFile(path,bytes,{flag:'wx',mode:0o600});
 return {name:path.split('/').at(-1),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function generateNoise(owner,rate,count,{observeCapture,signal}={}) {
 if(![44100,48000].includes(rate)||!Number.isSafeInteger(count)||count<=0||count>1190400)throw Error('qualification_noise_request');
 const output={};
 for(const seed of N.seeds) {
  const bytes=await owner.run('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i',`anoisesrc=color=${N.color}:sample_rate=${rate}:amplitude=${N.amplitude}:seed=${seed}:duration=${(count+rate*N.durationPaddingRateUnits)/rate}`,'-af',`atrim=end_sample=${count}`,'-ac',N.channelsText,'-ar',String(rate),'-f',N.sampleFormat,'pipe:1'],{timeoutMs:15000,maxBytes:count*2,signal,observeCapture:observeCapture?data=>observeCapture(seed,data):undefined});
  if(bytes.length!==count*2)throw Error('qualification_noise_extent');output[seed]=bytes;
 }
 return output;
}
export async function encodeProgram(owner,{settings,frames,frameFactory,construction,frameCount,pcm,path,store,maxBytes=5242880,timeoutMs=90000},io={}) {
 const ownsDeadline=!io.acquisition,acquisition=io.acquisition??createAcquisitionDeadline(timeoutMs);
 try {
 const profile=VIDEO_PROFILES[settings.videoPreset],frameBytes=profile.width*profile.height*3/2;
 if(!store||!Number.isSafeInteger(frameCount)||frameCount<1||!Number.isSafeInteger(frameCount*frameBytes))throw Error('marker_source_bounds');
 const parameters=construction?snapshotProgramConstruction(construction):null;
 const factory=parameters?.frames??frameFactory;
 const prefix=path.split('/').at(-1).replace(/\.ts$/,''),source=factory?prepareRegenerableSource({construct:factory,replay:factory,frameBytes,byteCap:frameCount*frameBytes,numericCap:196608,deadline:acquisition.deadline,clock:()=>performance.now()}):null;
 if(source&&source.construction.frameCount!==frameCount)throw Error('marker_source_extent');
 const immutablePcm=Buffer.from(pcm),audio={bytes:immutablePcm.length,sha256:createHash('sha256').update(immutablePcm).digest('hex')};
 const pcmRef=parameters?await acquisition.run(()=>store.write(`${prefix}-input.pcm`,immutablePcm,5242880,'pcm',acquisition)):null;
 const parametersRef=parameters?await acquisition.run(()=>store.write(`${prefix}-parameters.json`,parameters.bytes,196608,'sourceObservation',acquisition)):null;
 const constructionRef=await acquisition.run(()=>store.json(`${prefix}-source-construction.json.gz`,{video:source?.construction??null,audio},196608,'sourceObservation',acquisition));
 const args=programEncoderArguments(settings),session=await startCapturedInvocation(owner,{original:args,stdio:['ignore','pipe','pipe','pipe','pipe','pipe'],channels:{coded:{fd:1,cap:maxBytes,role:'coded',retention:'memory'}},stderrCap:65536,timeoutMs,store,prefix,recordKey:prefix,...io,acquisition,stage:'encode'});
 const feed=async(kind,fd,chunks,byteCap)=>{
  const result=await captureNativeFeed(session.child.stdio[fd],chunks,{byteCap,trace:createRawCapture({producerCap:196608,remainingBytes:store.remainingNumericBytes})});
  if(!result.complete)session.stop('input_pipe',result.error);await acquisition.run(()=>retainFeed(store,`${prefix}-${kind}-feed`,result,acquisition));return result;
 };
 const settled=await Promise.allSettled([session.finish(),feed('video',3,source?source.replayFrames():frames,frameCount*frameBytes),feed('audio',4,[immutablePcm],immutablePcm.length)]);
 const rejected=settled.find(item=>item.status==='rejected');if(rejected)throw rejected.reason;
 const [capture,videoFeed,audioFeed]=settled.map(item=>item.value);if(!capture.channelEOF.coded)throw Error('marker_capture_incomplete');
 const bytes=capture.coded,artifact=await acquisition.run(()=>store.write(path.split('/').at(-1),bytes,maxBytes,'coded',acquisition)),inventory=inventoryProgramTransport(bytes,{byteCap:maxBytes});
 const sourceJoin=source?joinRegeneratedFeed(source,videoFeed):null;
 const sourceObservations={video:source?.construction??null,audio,replay:source?.replay??null,sourceJoin,parametersSHA256:parameters?.sha256,pcmRef,parametersRef,missing:parameters?[]:source?['generator_closure','immutable_input_refs','replay_rule_ref']:['compressed_source_disposition_ledger']};
 await acquisition.run(()=>store.json(`${prefix}-source-replay.json.gz`,{constructionRef,replay:sourceObservations.replay,sourceJoin,missing:sourceObservations.missing},196608,'sourceObservation',acquisition));
 await acquisition.run(()=>store.json(`${prefix}-inventory.json.gz`,{file:inventory.file,videoPictures:inventory.video.packets.length,audioUnits:inventory.audio.packets.length},196608,'packet',acquisition));
 return {artifact,bytes,builderSha256:createHash('sha256').update(JSON.stringify(args)).digest('hex'),producerEvidence:{recordKey:prefix,file:inventory.file,inventory,source:sourceObservations,parameters:parameters?.bytes,inputPcm:parameters?immutablePcm:undefined,feeds:{video:videoFeed,audio:audioFeed},encoder:capture,store}};
 }finally{if(ownsDeadline)acquisition.dispose();}
}
export async function encodeTwitch(owner,{settings,program,path,maxBytes=5242880,timeoutMs=90000}) {
 const builder=localTwitchArguments(settings),child=owner.start('ffmpeg',builder.args,{stdio:['pipe','pipe','pipe','pipe']});
 const collected=collect(child,{maxBytes,extraPipes:[3],timeoutMs}),input=feed(child.stdin,[program]);
 const [result]=await Promise.all([collected,input]);
 const artifact=await writeArtifact(path,result.bytes,maxBytes);
 return {artifact,bytes:result.bytes,builderSha256:builder.originalSha256,localBuilderSha256:builder.transformedSha256};
}

/** Complete stereo source decode with original integer sample metadata. No
 * onset trimming, delay subtraction or favorable source alignment. */
export async function decodeStereoFile(owner,file) {
 const child=owner.start('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-copyts','-threads','2','-i',file,'-map','0:a:0','-vn','-af',"aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,asettb=1/48000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Number_of_samples,ametadata=mode=print:direct=1:file='pipe\\:4'",'-ac','2','-ar','48000','-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe','ignore','pipe']});
 const output=await collect(child,{maxBytes:3145728,extraPipes:[4],timeoutMs:30000}),rows=parseMarkerMetadata(output.extras[4].toString(),'audio');
 let end;for(const [i,r] of rows.entries()){if(r.index!==i||r.samples<=0||(end!==undefined&&r.pts!==end))throw Error('decode_failure');end=r.pts+r.samples;}
 if(!rows.length||rows.reduce((n,r)=>n+r.samples,0)*4!==output.bytes.length)throw Error('decode_failure');
 return {pcm:output.bytes,rows};
}

/** Stream one complete owned frame at a time; never retain a rawvideo file.
 * All decoded frames are counted, even when the declared 60-to-30 bridge
 * submits every other source ordinal. Scaling matches the input supervisor. */
export async function* decodeVideoFrames(owner,file,{width,height,frames,stride=1}) {
 if(!Number.isSafeInteger(frames)||frames<1||![1,2].includes(stride))throw Error('decode_failure');
 const child=owner.start('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-copyts','-threads','2','-filter_threads','1','-i',file,'-map','0:v:0','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,'-fps_mode','passthrough','-an','-threads','1','-f','rawvideo','pipe:1'],{stdio:['ignore','pipe','pipe']});
 const frameBytes=width*height*3/2;let current=Buffer.alloc(frameBytes),filled=0,count=0,diagnostic=0,failure,completed=false;
 const stop=reason=>{failure??=reason;try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
 child.stderr.on('data',b=>{diagnostic+=b.length;if(diagnostic>65536)stop('byte_cap');});
 const timer=setTimeout(()=>stop('timeout'),60000);
 try {
  for await(const chunk of child.stdout){let offset=0;while(offset<chunk.length){const n=Math.min(frameBytes-filled,chunk.length-offset);chunk.copy(current,filled,offset,offset+n);filled+=n;offset+=n;if(filled===frameBytes){if(count>=frames)throw Error('coverage_failure');const frame=current;current=Buffer.alloc(frameBytes);filled=0;if(count++%stride===0)yield frame;}}}
  const code=await child.closed;if(code!==0||failure||filled!==0||count!==frames)throw Error(failure??'coverage_failure');completed=true;
 }finally{clearTimeout(timer);if(!completed){stop('decode_failure');await child.closed;}}
}
export async function frameQuality(owner,file,{width,height,frames,referenceFrames}) {
 const reference=referenceFrames[Symbol.asyncIterator]?.()??referenceFrames[Symbol.iterator]();
 let count=0,sum=0,bytes=0;
 try{
  for await(const frame of decodeVideoFrames(owner,file,{width,height,frames})){
   const next=await reference.next();if(next.done||next.value.length!==frame.length)throw Error('coverage_failure');
   for(let i=0;i<frame.length;i++){const d=frame[i]-next.value[i];sum+=d*d;}bytes+=frame.length;count++;
  }
  if(!(await reference.next()).done||count!==frames)throw Error('coverage_failure');
 }finally{await reference.return?.();}
 const psnr=10*Math.log10(255*255/Math.max(sum/bytes,.00001));if(!Number.isFinite(psnr))throw Error('coverage_failure');
 return {frames:count,bytes,fullFrameYuvPsnrDb:psnr};
}
