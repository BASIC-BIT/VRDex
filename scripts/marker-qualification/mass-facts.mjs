import { audioEpisodeRawRange } from '../event-marker-clock.mjs';
import { compileTrain } from './trains.mjs';
import { validateIdentityEpochs } from '../event-marker-record.mjs';
import { assertDecodedCoverage,partitionTrainEpisodes } from './media-facts.mjs';
/** Saved mass evidence has one authority: the complete original record and
 * independent metadata-aligned detector table. Never trust copied case rows. */
export function deriveMassCases(invocation,decoded) {
 const train=compileTrain(invocation),record=decoded?.record,observation=decoded?.observation,reference=observation?.reference;
 const check=value=>{if(!value)throw Error('qualification_mass_observation');};
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),integer=Number.isSafeInteger;
 check(record&&observation&&reference&&Array.isArray(record.episodes)&&Array.isArray(reference.episodes)&&Array.isArray(reference.blocks));
 const audio=observation.audioRows,video=observation.videoRows;
 check(Array.isArray(audio)&&audio.length>0&&Array.isArray(video)&&video.length===train.frames);
 check(Array.isArray(record.audioRange)&&record.audioRange.length===2&&record.audioRange.every(integer)&&Array.isArray(record.videoRange)&&record.videoRange.length===2&&record.videoRange.every(integer));
 const ranges=[];let cursor=audio[0].pts,blockIndex=0,active;
 check(integer(cursor));
 for(const [index,row] of audio.entries()){
  check(row.index===index&&row.pts===cursor&&integer(row.samples)&&row.samples>0);
  for(let at=0;at<row.samples;at+=480){
   const block=reference.blocks[blockIndex++],count=Math.min(480,row.samples-at),start=row.pts+at;
   check(Array.isArray(block)&&block.length===4&&block[0]===index&&block[1]===start&&block[2]===count&&typeof block[3]==='boolean');
   if(block[3]&&!active)active={onset:start,loudEnd:start+count,firstRow:index};
   if(active){if(block[3])active.loudEnd=start+count;else{ranges.push([active.onset,active.loudEnd,start+count,active.firstRow,index-active.firstRow+1]);active=undefined;}}
  }
  cursor+=row.samples;check(integer(cursor));
 }
 check(!active&&blockIndex===reference.blocks.length&&reference.detectorBlocks===blockIndex&&record.detectorBlockCount===blockIndex);
 const samples=cursor-audio[0].pts;
 check(samples>0&&reference.samples===samples&&reference.bytes===samples*2&&reference.metadataRows===audio.length&&record.metadataSamples===samples&&record.decodedBytes===samples*2&&equal(record.audioRange,[audio[0].pts,cursor]));
 check(equal(reference.episodes,ranges)&&record.episodes.length===ranges.length);
 for(const [index,e] of record.episodes.entries()){
  check(e.id===index&&[e.onset,e.loudEnd,e.end,e.firstMetadataIndex,e.metadataRowCount].every(integer));
  check(equal(audioEpisodeRawRange(e),ranges[index]));
 }
 for(const [index,row] of video.entries())check(row.index===index&&integer(row.pts)&&row.pts===record.videoRange[0]+index*3000);
 check(record.videoFrames===video.length&&video.at(-1).pts===record.videoRange[1]);
 const coverage=assertDecodedCoverage(record,{frames:train.frames,fps:30,samples:train.samples});check(equal(decoded.coverage,coverage));
 validateIdentityEpochs(record);
 for(const key of ['visuals','identities','identityEpochs','videoRange','videoFrames'])check(equal(record[key],observation.visual?.[key]));
 check(Array.isArray(record.visuals)&&record.visuals.length===train.slots.length);
 const groups=partitionTrainEpisodes(train,record),refs=partitionTrainEpisodes(train,{...record,episodes:ranges.map(r=>({onset:r[0],end:r[2],range:r}))});
 const cases=train.slots.map(slot=>{
  const visual=record.visuals[slot.index],start=record.videoRange[0]+slot.visualFrame*3000;
  check(visual.id===slot.index&&visual.start===start&&visual.end===start+9000&&visual.identity===(slot.params.source??'a'));
  const fullFenceCovered=record.audioRange[0]*15<=(start-45000)*8&&record.audioRange[1]*15>=(start+45000)*8;
  if(slot.family==='missing')check(fullFenceCovered);
  return {episodes:groups[slot.index],referenceRanges:refs[slot.index].map(r=>r.range),visualCount:1,fullFenceCovered,coverage:record.audioRange};
 });
 // Old duplicated representations cannot disagree even when freshly rehashed.
 // New producers omit this redundant field entirely.
 if(Object.hasOwn(decoded,'cases'))check(equal(decoded.cases,cases));
 return cases;
}
