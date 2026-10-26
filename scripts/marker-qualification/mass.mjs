import { audioEpisodeRawRange } from '../event-marker-clock.mjs';
import { compileTrain,constructTrainPcm } from './trains.mjs';
import { sourceBaseline,stereoMono,massFrames } from './codec-input.mjs';
import { generateNoise,encodeProgram,encodeTwitch } from './codec-io.mjs';
import { normalizeMono } from './normalization-io.mjs';
import { readQualificationRecording,applyDecodeStageFailure } from './codec-record.mjs';
import { decodeSourceAudio } from '../event-source-markers.mjs';
import { referenceDetector } from './detector-reference.mjs';
import { prerequisiteStates } from './results.mjs';
import { deriveMassCases } from './mass-facts.mjs';
const defaults={generateNoise,normalizeMono,encodeProgram,encodeTwitch,readRecording:readQualificationRecording};
const fixedReason=error=>['source_failure','encode_failure','probe_failure','format_failure','decode_failure','coverage_failure','timeout','byte_cap','invocation_byte_cap','missing_artifact','sha_mismatch','process_leak'].includes(error.message)?error.message:null;
export async function executeMass(invocation,{owner,store,io=defaults}) {
 const prerequisites=prerequisiteStates('not_run'),results=[];let stage='source_constructed';
 const pass=key=>{prerequisites[key]='pass';},startBytes=store.total;
 try {
  const train=compileTrain(invocation),settings={videoPreset:'480p30',audioBitrateKbps:train.slots[0].params.kbps};
  const noise=await io.generateNoise(owner,train.sourceRate,Math.round(train.samples*train.sourceRate/48000));
  const original=constructTrainPcm(train,noise),source=sourceBaseline(original,train.sourceRate,train.sourceRate===44100?1:2);pass('source_constructed');stage='source_baseline_complete';
  await store.write(`${invocation.id}-source.pcm`,original,train.sourceRate===44100?2097152:5242880,'pcm');
  let pcm=original,normalization;
  if(train.sourceRate===44100){normalization=await io.normalizeMono(owner,original);pcm=normalization.pcm;await store.write(`${invocation.id}-normalized.pcm`,pcm,5242880,'pcm');}
  if(pcm.length!==train.samples*4)throw Error('coverage_failure');
  const mono=stereoMono(pcm),rows=[];for(let at=0;at<train.samples;at+=1024)rows.push({index:rows.length,pts:at,samples:Math.min(1024,train.samples-at)});
  const baseline=decodeSourceAudio([mono],rows),reference=referenceDetector(mono,rows);
  if(JSON.stringify(baseline.episodes.map(e=>audioEpisodeRawRange(e)))!==JSON.stringify(reference.episodes))throw Error('source_failure');
  await store.json(`${invocation.id}-source.json.gz`,{source,baseline,reference,...(normalization?{normalization:{...normalization,pcm:undefined}}:{}),slots:train.slots.map(s=>({index:s.index,start:s.start,end:s.end,sourceStart:s.sourceStart,sourceRate:s.sourceRate,visualFrame:s.visualFrame}))},262144,'sourceObservation');
  pass('source_baseline_complete');stage='encode_complete';
  const programName=`${invocation.id}-program.ts`,program=await io.encodeProgram(owner,{settings,frameFactory:()=>massFrames(train),...(train.sourceRate===48000?{construction:{kind:'massFrames',train}}:{}),frameCount:train.frames,pcm,store,path:store.path(programName),maxBytes:Math.min(5242880,store.remainingBytes??5242880)});
  const twitchName=`${invocation.id}-twitch.flv`,twitch=await io.encodeTwitch(owner,{settings,program:program.bytes,path:store.path(twitchName),maxBytes:Math.min(5242880,store.remainingBytes??5242880)});await store.adopt(twitchName,5242880,'coded');pass('encode_complete');
  for(const [path,name,builder] of [['program',programName,program],['program_twitch',twitchName,twitch]]) {
   stage='probe_complete';
   const decoded=await io.readRecording(owner,store.path(name),{settings,path,frames:train.frames,samples:train.samples,producerEvidence:builder.producerEvidence,store});
   pass('probe_complete');pass('declared_format_valid');pass('decode_complete');stage='intended_coverage_complete';
   const bySlot=deriveMassCases(invocation,decoded);
   pass('intended_coverage_complete');stage='artifact_sha_bound';
   const artifact=store.entries.find(e=>e.name===name);
   if(decoded.record.recordingSha256!==artifact.sha256)throw Error('sha_mismatch');
   const observation=await store.json(`${invocation.id}-${path}-decode.json.gz`,{...decoded,builder:{originalSha256:builder.builderSha256,localSha256:builder.localBuilderSha256}},262144,'observation');
   pass('artifact_sha_bound');
   for(const slot of train.slots){const index=slot.index*2+(path==='program'?0:1);results.push({index,kind:'classifier',observation,prerequisites:{...prerequisites},evidence:bySlot[slot.index]});}
  }
  if(store.total-startBytes>16777216)throw Error('byte_cap');
  return results.sort((a,b)=>a.index-b.index);
 }catch(error) {
  stage=applyDecodeStageFailure(prerequisites,error,stage);
  const reason=(error.message==='invocation_byte_cap'?'byte_cap':fixedReason(error))??({source_constructed:'source_failure',source_baseline_complete:'source_failure',encode_complete:'encode_failure',probe_complete:'probe_failure',declared_format_valid:'format_failure',decode_complete:'decode_failure',intended_coverage_complete:'coverage_failure',artifact_sha_bound:'sha_mismatch'}[stage]);
  return invocation.rows.map((_,index)=>({index,status:'incomplete',reason,prerequisites:{...prerequisites}}));
 }
}
