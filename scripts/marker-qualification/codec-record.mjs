import { captureRawMembers,createRecordFailure } from '../event-marker-raw-capture.mjs';
import { open } from 'node:fs/promises';
import { startCapturedInvocation,retainCapture } from './invocation-capture.mjs';
import { inventoryProgramTransport,reconcileProgramPopulation,reconcileProgramPacketRows,verifyProgramRecording } from '../event-marker-conservation.mjs';
import { audioEpisodeRawRange,inspectProgramClock,assertProgramClock } from '../event-marker-clock.mjs';
import { inspectAcquiredDependencies,createAcquisitionDeadline } from '../event-marker-native-binding.mjs';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { probe,decodeQualifiedMediaMarkerRecord } from '../event-capacity-media.mjs';
import { decodeMarkerVisuals } from '../event-marker-record.mjs';
import { referenceDetector } from './detector-reference.mjs';
import { assertEncodedFormat,assertDecodedCoverage,strictPacketFacts } from './media-facts.mjs';
import { VIDEO_PROFILES } from '../../workers/restream/broadcast-profiles.mjs';
import { retainProgramReplay,replayProgramRecording } from './program-replay.mjs';
import { readFile } from 'node:fs/promises';
/** Decode exactly once; independent RMS detector sees the same original bytes
 * before classifier bounds can reject a fully captured long episode. */
export async function readQualificationRecording(owner,file,{settings,path,frames,samples,activeBitrate=false,allowEpisodeBound=false,producerEvidence,store=producerEvidence?.store},io={}) {
 io={probe,decodeQualifiedMediaMarkerRecord,strictPacketFacts,...io};
 const ownsDeadline=!io.acquisition,acquisition=io.acquisition??createAcquisitionDeadline(120000);
 const completed=[];let prerequisite='probe_complete',failure,failurePrefix;
 try {
 const recordKey=producerEvidence?.recordKey??file.split('/').at(-1).replace(/\.[^.]+$/,''),prefix=recordKey+'-decode';
 const original=store?await acquisition.run(()=>recordingBytes(file,store,acquisition)):null;
 if(original){failure=createRecordFailure({recordKey,inputSHA:original.sha256});failurePrefix=prefix;}
 const inventory=producerEvidence?inventoryProgramTransport(original.bytes,{byteCap:original.bytes.length}):null;
 if(producerEvidence&&(inventory.file.sha256!==producerEvidence.file.sha256||inventory.file.bytes!==producerEvidence.file.bytes))throw Error('sha_mismatch');
 const retainProbe=(name,cap)=>store?raw=>retainCapture(store,`${prefix}-${name}`,captureRawMembers(raw,{producerCap:cap,remainingBytes:store.remainingNumericBytes}),name==='packets'?'packet':'probe'):undefined;
 let packetCrosscheck;const probes={};
 const observeProbe=kind=>async data=>{probes[kind]=data;if(store)await store.json(`${prefix}-${kind}-owner.json`,{...data,raw:undefined,stderr:Buffer.from(data.stderr).toString('base64')},196608,'native');};
 const deps=inspectAcquiredDependencies(producerEvidence?.encoder?.binding);
 if(deps)store.reserveProgramOuter(recordKey,deps.plans.outerReserveBytes);
 const info=await acquisition.run(()=>io.probe(owner,file,{acquisition,observeRaw:retainProbe('probe',1048576),observeCapture:observeProbe('format')})),packets=await acquisition.run(()=>io.strictPacketFacts(owner,file,info,{acquisition,observeRaw:retainProbe('packets',8388608),observeCapture:observeProbe('packets'),observePackets:inventory?data=>{packetCrosscheck=reconcileProgramPacketRows({inventory,...data});}:undefined}));completed.push(prerequisite);prerequisite='declared_format_valid';
 const format=assertEncodedFormat(info,packets,settings,path,activeBitrate),profile=VIDEO_PROFILES[settings.videoPreset];completed.push(prerequisite);prerequisite='decode_complete';
 let observation,record,classificationFailure,material,clock,checkedProgram;
 const maxSeconds=samples/48000+1;
 const startCapture=store?({original,stdio})=>startCapturedInvocation(owner,{original,stdio,channels:{rgb:{fd:3,cap:Math.ceil(maxSeconds*61*6),role:'rgb',retention:'raw'},pcm:{fd:4,cap:Math.ceil(maxSeconds*48000*2+96000),role:'pcm',retention:'raw'},videoMetadata:{fd:5,cap:Math.ceil(maxSeconds*65536),role:'videoMetadata'},audioMetadata:{fd:6,cap:Math.ceil(maxSeconds*32768),role:'audioMetadata'}},stderrCap:1048576,timeoutMs:120000,store,prefix,recordKey,stage:'decode',...(io.dependencies?{dependencies:io.dependencies}:{}),observerIO:io.observerIO,acquisition}):undefined;
 try {
  record=await acquisition.run(()=>io.decodeQualifiedMediaMarkerRecord(owner,file,{width:profile.width,height:profile.height,maxSeconds,startCapture,finalProbe:(o,f)=>acquisition.run(()=>io.probe(o,f,{acquisition,observeRaw:retainProbe('final-probe',1048576),observeCapture:observeProbe('final')})),observeDecoded:async data=>{
   const pcm=Buffer.concat(data.audioChunks);
   let audioEnd=data.audioRows[0]?.pts,totalSamples=0;
   for(const [index,row] of data.audioRows.entries()){if(row.index!==index||row.samples<=0||row.pts!==audioEnd)throw Error('reference_metadata');audioEnd+=row.samples;totalSamples+=row.samples;}
   if(totalSamples*2!==pcm.length)throw Error('reference_conservation');
   if(original){const after=await acquisition.run(()=>recordingBytes(file,store,acquisition));if(after.identity!==original.identity||after.sha256!==original.sha256||after.bytes.length!==original.bytes.length)throw Error('sha_mismatch');}
   let population;
   if(producerEvidence?.source.video)population=reconcileProgramPopulation({inventory,source:producerEvidence.source,feeds:producerEvidence.feeds,encoder:producerEvidence.encoder,decoder:data.nativeCapture,videoRows:data.videoRows,audioRows:data.audioRows,rgbBytes:data.rgb.length,pcmBytes:pcm.length,fps:profile.frameRate});
   checkedProgram=verifyProgramRecording({bytes:original?.bytes,producer:producerEvidence,decoder:data.nativeCapture,capture:data,settings,file,fileIdentity:original?.fileIdentity,probes,budget:store?.programBudget(recordKey)});
   if(store)await store.json(`${prefix}-conservation.json.gz`,{state:checkedProgram.kind,missing:checkedProgram.missing??[],population:population??null,packetCrosscheck:packetCrosscheck??null,file:original?{bytes:original.bytes.length,sha256:original.sha256}:null,projection:checkedProgram.projection},196608,'observation');
   if(checkedProgram.kind!=='CheckedProgram'){const unproven=Error('marker_binding_unproven');unproven.missingPremises=checkedProgram.missing;throw unproven;}
   clock=inspectProgramClock(data,checkedProgram);assertProgramClock(clock);
   const reference=referenceDetector(pcm,data.audioRows,clock);material={pcm,audioRows:data.audioRows,rgb:data.rgb,videoRows:data.videoRows,checkedProgram,decoder:data.nativeCapture,probes,fileIdentity:original.fileIdentity};
   observation={reference,audioRows:data.audioRows,videoRows:data.videoRows,rgbSha256:createHash('sha256').update(data.rgb).digest('hex'),pcmSha256:createHash('sha256').update(pcm).digest('hex'),visual:decodeMarkerVisuals(data.rgb,data.videoRows,clock),assurance:clock.assurance,clock};
   return clock;
  }}));
 }catch(error){
  if(!allowEpisodeBound||error.message!=='marker_episode_bound'||!observation)throw error;
  classificationFailure='episode_bound';
  const r=observation.reference,rows=observation.audioRows;
  assertProgramClock(clock);record={...observation.visual,audioRange:[rows[0].pts,rows.at(-1).pts+rows.at(-1).samples],metadataSamples:r.samples,decodedBytes:r.bytes,episodes:[],clock,assurance:clock.assurance,recordingSha256:original.sha256,videoStreamIndex:0,audioStreamIndex:1};
 }
 if(!observation)throw Error('decode_failure');
 assertProgramClock(record?.clock);
 if(record.clock!==clock)throw Error('marker_clock_binding');
 if(!classificationFailure) {
  const actual=record.episodes.map(e=>audioEpisodeRawRange(e));
  if(JSON.stringify(actual)!==JSON.stringify(observation.reference.episodes))throw Error('decode_failure');
 }
 completed.push(prerequisite);prerequisite='intended_coverage_complete';
 const coverage=assertDecodedCoverage(record,{frames,fps:profile.frameRate,samples});
 const local={record,format,coverage,observation,classificationFailure,assurance:clock.assurance,programProof:{projection:checkedProgram.projection}};
 const retained=await acquisition.run(()=>retainProgramReplay(store,{recordKey,settings,file,fileIdentity:original.fileIdentity,result:local},acquisition));
 const result=await acquisition.run(()=>replayProgramRecording(retained,{resolveOriginal:ref=>acquisition.run(()=>readFile(store.path(ref.name),{signal:acquisition.signal})),resolveImplementation:io.resolveImplementation}));
 Object.defineProperty(result,'material',{value:material});return result;
 }catch(error){
  if(failure){
   failure.record({stage:error.message==='marker_binding_unproven'?'clock':prerequisite==='probe_complete'?'inventory':'decode',completedPrerequisites:completed,native:error.nativeCapture?.native??null,error});
   try{await store.writeFailure(`${failurePrefix}-failure.json`,failure.snapshot());}catch(retentionError){failure.record({stage:'retain',completedPrerequisites:completed,native:null,error:retentionError});}
   error.recordFailure=failure.snapshot();
  }
  error.qualificationPrerequisite=prerequisite;error.qualificationCompleted=[...completed];throw error;
 }finally{if(ownsDeadline)acquisition.dispose();}
}
export function applyDecodeStageFailure(states,error,fallback) {
 const ordered=['probe_complete','declared_format_valid','decode_complete','intended_coverage_complete'];
 const index=ordered.indexOf(error?.qualificationPrerequisite);
 if(fallback==='probe_complete'&&index>=0&&JSON.stringify(error.qualificationCompleted)===JSON.stringify(ordered.slice(0,index))){for(const key of error.qualificationCompleted)states[key]='pass';states[ordered[index]]='fail';return ordered[index];}
 states[fallback]='fail';return fallback;
}

async function recordingBytes(file,store,control) {
 const entry=store.entries.find(e=>store.path(e.name)===file&&e.role==='coded');if(!entry)throw Error('missing_artifact');
 control.check();const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);try {
  const before=await handle.stat();if(!before.isFile()||before.size!==entry.bytes||before.nlink!==1)throw Error('sha_mismatch');
  const parts=[];let count=0;
  for(;;){control.check();const chunk=Buffer.alloc(Math.min(65536,entry.bytes-count+1)),{bytesRead}=await handle.read(chunk);control.check();if(!bytesRead)break;count+=bytesRead;if(count>entry.bytes)throw Error('byte_cap');parts.push(chunk.subarray(0,bytesRead));}
  const after=await handle.stat(),identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
  const bytes=Buffer.concat(parts),sha256=createHash('sha256').update(bytes).digest('hex');if(identity(before)!==identity(after)||count!==entry.bytes||sha256!==entry.sha256)throw Error('sha_mismatch');
  return {bytes,sha256,identity:identity(before),fileIdentity:{regular:true,seekable:true,nlink:before.nlink,position:0,bytes:count,dev:String(before.dev),ino:String(before.ino),mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs}};
 }finally{await handle.close();}
}
