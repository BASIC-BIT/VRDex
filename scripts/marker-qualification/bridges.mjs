import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { VIDEO_PROFILES } from '../../workers/restream/broadcast-profiles.mjs';
import { createFixture } from '../event-capacity-media.mjs';
import { SOURCE_FREQUENCIES } from '../event-source-markers.mjs';
import { markerFrame } from './scenes.mjs';
import { quantize } from './signals.mjs';
import { sourceBaseline } from './codec-input.mjs';
import { generateNoise,encodeProgram,encodeTwitch,decodeStereoFile,decodeVideoFrames,frameQuality } from './codec-io.mjs';
import { readQualificationRecording,applyDecodeStageFailure } from './codec-record.mjs';
import { prerequisiteStates,incompletePrerequisite,evaluateBridgeCase,matchBridgePulses } from './results.mjs';
const defaults={generateNoise,encodeProgram,encodeTwitch,createFixture,decodeStereoFile,decodeVideoFrames,frameQuality,readRecording:readQualificationRecording};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function profileInput(params,noise) {
 const profile=VIDEO_PROFILES[params.profile],samples=384000,frames=profile.frameRate*8,pcm=Buffer.alloc(samples*4);
 if(![42,43].every(seed=>noise[seed]?.length===samples*2))throw Error('source_failure');
 for(let i=0;i<samples;i++)for(let channel=0;channel<2;channel++){
  const tone=i%48000<4800?.65*Math.sin(2*Math.PI*SOURCE_FREQUENCIES[params.source]*i/48000):0;
  pcm.writeInt16LE(quantize(noise[42+channel].readInt16LE(i*2)/32768+tone),i*4+channel*2);
 }
 return {pcm,frames,samples,profile,*replayFrames(){for(let i=0;i<frames;i++)yield markerFrame(profile.width,profile.height,params.source,i%profile.frameRate<profile.frameRate/10,i);}};
}
/** Complete bridge pulse union; no nearest selection and no omitted first
 * pulse. Original measured onset and every visual/episode remain accountable. */
export { matchBridgePulses } from './results.mjs';
export async function executeBridge(invocation,{owner,store,io=defaults,clock=()=>performance.now()}) {
 const prerequisites=prerequisiteStates('not_run'),startBytes=store.total,compressed=invocation.kind==='compressed-source',results=[];let stage='source_constructed',postStarted;
 try {
  const params=invocation.rows[0].params,source=params.source;let input,sourceEvidence,sourcePath;
  if(compressed){
   const name=`${invocation.id}-source.ts`;sourcePath=store.path(name);const format=await io.createFixture(owner,sourcePath,source);await store.adopt(name,16777216);postStarted=clock();prerequisites.source_constructed='pass';stage='source_baseline_complete';
   const original=await io.readRecording(owner,sourcePath,{settings:{videoPreset:'1080p60',audioBitrateKbps:320},path:'program',frames:720,samples:576000,activeBitrate:true});
   const stereo=await io.decodeStereoFile(owner,sourcePath),baseline=sourceBaseline(stereo.pcm,48000,2),pulse=matchBridgePulses(original.record,source,12);
   if(pulse.status!=='pass'||stereo.rows[0].pts!==original.record.audioRange[0]||stereo.rows.at(-1).pts+stereo.rows.at(-1).samples!==original.record.audioRange[1]||stereo.pcm.length!==original.record.decodedBytes*2)throw Error('source_failure');
   await store.write(`${invocation.id}-source.pcm`,stereo.pcm,3145728);
   sourceEvidence={format,baseline,original,stereoRows:stereo.rows,pulse,submission:{sourceVideoOrigin:original.record.videoRange[0],sourceAudioOrigin:stereo.rows[0].pts,sourceFrameStride:2,sourceFrames:720,submittedFrames:360,audioSamples:stereo.pcm.length/4,trimmedSamples:0,delaySubtracted:0}};
   input={pcm:stereo.pcm,frames:360,samples:576000,profile:VIDEO_PROFILES['480p30'],replayFrames:()=>io.decodeVideoFrames(owner,sourcePath,{width:854,height:480,frames:720,stride:2})};
  }else{
   const noise=await io.generateNoise(owner,48000,384000);input=profileInput(params,noise);prerequisites.source_constructed='pass';stage='source_baseline_complete';
   sourceEvidence={baseline:sourceBaseline(input.pcm,48000,2),sourceFrames:input.frames,sourceFrameRate:input.profile.frameRate};await store.write(`${invocation.id}-source.pcm`,input.pcm,3145728);
  }
  prerequisites.source_baseline_complete='pass';
  const sourceBytes=Buffer.from(JSON.stringify(sourceEvidence)+'\n');if(sourceBytes.length>8388608)throw Error('byte_cap');await store.write(`${invocation.id}-source.json.gz`,gzipSync(sourceBytes),262144);
  const branches=compressed?[160,320]:[params.kbps];
  for(const kbps of branches){
   if(compressed&&clock()-postStarted>=180000)throw Error('timeout');
   const settings={videoPreset:compressed?'480p30':params.profile,audioBitrateKbps:kbps},prefix=`${invocation.id}-${kbps}`;stage='encode_complete';
   const programName=`${prefix}-program.ts`,program=await io.encodeProgram(owner,{settings,frames:input.replayFrames(),pcm:input.pcm,path:store.path(programName),maxBytes:Math.min(8388608,store.remainingBytes??8388608)});await store.adopt(programName,8388608);
   const twitchName=`${prefix}-twitch.flv`,twitch=await io.encodeTwitch(owner,{settings,program:program.bytes,path:store.path(twitchName),maxBytes:Math.min(8388608,store.remainingBytes??8388608)});await store.adopt(twitchName,8388608);prerequisites.encode_complete='pass';
   for(const [path,name,builder] of [['program',programName,program],['program_twitch',twitchName,twitch]]){
    stage='probe_complete';const decoded=await io.readRecording(owner,store.path(name),{settings,path,frames:input.frames,samples:input.samples,activeBitrate:true});
    for(const key of ['probe_complete','declared_format_valid','decode_complete','intended_coverage_complete'])prerequisites[key]='pass';
    const quality=await io.frameQuality(owner,store.path(name),{width:input.profile.width,height:input.profile.height,frames:input.frames,referenceFrames:input.replayFrames()});
    const pulse=matchBridgePulses(decoded.record,source,compressed?12:8);stage='artifact_sha_bound';const artifact=store.entries.find(e=>e.name===name);if(decoded.record.recordingSha256!==artifact.sha256)throw Error('sha_mismatch');
    const detail={decoded,quality,pulse,artifact,builderSha256:builder.builderSha256,localBuilderSha256:builder.localBuilderSha256,aacGenerations:(compressed?1:0)+(path==='program'?1:2)};
    const bytes=Buffer.from(JSON.stringify(detail)+'\n');if(bytes.length>8388608)throw Error('byte_cap');const observation=await store.write(`${prefix}-${path}-decode.json.gz`,gzipSync(bytes),262144);prerequisites.artifact_sha_bound='pass';
    const index=invocation.rows.findIndex(r=>r.params.kbps===kbps&&r.params.path===path);
    results.push({index,kind:'association',observation,prerequisites:{...prerequisites},evaluate:states=>incompletePrerequisite(states)??evaluateBridgeCase(invocation.rows[index],detail,compressed)});
   }
  }
  if(store.total-startBytes>(compressed?67108864:33554432)||compressed&&clock()-postStarted>=180000)throw Error('byte_cap');
  return results.sort((a,b)=>a.index-b.index);
 }catch(error){stage=applyDecodeStageFailure(prerequisites,error,stage);const reason=error.message==='invocation_byte_cap'?'byte_cap':['timeout','byte_cap','source_failure','encode_failure','probe_failure','format_failure','decode_failure','coverage_failure','sha_mismatch'].includes(error.message)?error.message:stage.startsWith('source')?'source_failure':stage==='encode_complete'?'encode_failure':'decode_failure';return invocation.rows.map((_,index)=>({index,status:'incomplete',reason,prerequisites:{...prerequisites}}));}
}
