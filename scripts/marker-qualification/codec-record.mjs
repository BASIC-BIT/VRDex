import { createHash } from 'node:crypto';
import { probe,packetFacts,decodeMediaMarkerRecord } from '../event-capacity-media.mjs';
import { decodeMarkerVisuals } from '../event-marker-record.mjs';
import { referenceDetector } from './detector-reference.mjs';
import { assertEncodedFormat,assertDecodedCoverage } from './media-facts.mjs';
import { VIDEO_PROFILES } from '../../workers/restream/broadcast-profiles.mjs';
/** Decode exactly once; independent RMS detector sees the same original bytes
 * before classifier bounds can reject a fully captured long episode. */
export async function readQualificationRecording(owner,file,{settings,path,frames,samples,activeBitrate=false,allowEpisodeBound=false},io={probe,packetFacts,decodeMediaMarkerRecord}) {
 const completed=[];let prerequisite='probe_complete';
 try {
 const info=await io.probe(owner,file),packets=await io.packetFacts(owner,file);completed.push(prerequisite);prerequisite='declared_format_valid';
 const format=assertEncodedFormat(info,packets,settings,path,activeBitrate),profile=VIDEO_PROFILES[settings.videoPreset];completed.push(prerequisite);prerequisite='decode_complete';
 let observation,record,classificationFailure,material;
 try {
  record=await io.decodeMediaMarkerRecord(owner,file,{width:profile.width,height:profile.height,maxSeconds:samples/48000+1,observeDecoded:data=>{
   const pcm=Buffer.concat(data.audioChunks),reference=referenceDetector(pcm,data.audioRows);
   material={pcm,audioRows:data.audioRows};
   observation={reference,audioRows:data.audioRows,videoRows:data.videoRows,rgbSha256:createHash('sha256').update(data.rgb).digest('hex'),pcmSha256:createHash('sha256').update(pcm).digest('hex'),visual:decodeMarkerVisuals(data.rgb,data.videoRows)};
  }});
 }catch(error){
  if(!allowEpisodeBound||error.message!=='marker_episode_bound'||!observation)throw error;
  classificationFailure='episode_bound';
  const r=observation.reference,rows=observation.audioRows;
  record={...observation.visual,audioRange:[rows[0].pts,rows.at(-1).pts+rows.at(-1).samples],metadataSamples:r.samples,decodedBytes:r.bytes,episodes:[]};
 }
 if(!observation)throw Error('decode_failure');
 if(!classificationFailure) {
  const actual=record.episodes.map(e=>[e.onset,e.onset+e.loudEnd,e.end,e.firstMetadataIndex,e.metadataRowCount]);
  if(JSON.stringify(actual)!==JSON.stringify(observation.reference.episodes))throw Error('decode_failure');
 }
 completed.push(prerequisite);prerequisite='intended_coverage_complete';
 const coverage=assertDecodedCoverage(record,{frames,fps:profile.frameRate,samples});
 const result={record,format,coverage,observation,classificationFailure};
 Object.defineProperty(result,'material',{value:material});return result;
 }catch(error){error.qualificationPrerequisite=prerequisite;error.qualificationCompleted=[...completed];throw error;}
}
export function applyDecodeStageFailure(states,error,fallback) {
 const ordered=['probe_complete','declared_format_valid','decode_complete','intended_coverage_complete'];
 const index=ordered.indexOf(error?.qualificationPrerequisite);
 if(fallback==='probe_complete'&&index>=0&&JSON.stringify(error.qualificationCompleted)===JSON.stringify(ordered.slice(0,index))){for(const key of error.qualificationCompleted)states[key]='pass';states[ordered[index]]='fail';return ordered[index];}
 states[fallback]='fail';return fallback;
}
