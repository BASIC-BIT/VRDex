import { compileTrain } from './trains.mjs';
import { validateIdentityEpochs } from '../event-marker-record.mjs';
import { resolveDestinationProfile } from '../../workers/restream/broadcast-profiles.mjs';
export function assertEncodedFormat(info,packets,settings,path,activeBitrate=false) {
 const p=resolveDestinationProfile({settings,destination:path==='program'?'vrcdn':'twitch'}),v=info?.streams?.find(s=>s.codec_type==='video'),a=info?.streams?.find(s=>s.codec_type==='audio');
 const rate=/^(\d+)\/(\d+)$/.exec(v?.r_frame_rate??''),fps=rate?Number(rate[1])/Number(rate[2]):NaN;
 if(info.streams.length!==2||v?.index!==0||a?.index!==1||v.codec_name!=='h264'||v.width!==p.width||v.height!==p.height||fps!==p.frameRate||v.pix_fmt!=='yuv420p'||a.codec_name!=='aac'||a.channels!==2||a.sample_rate!=='48000'||info.format?.format_name!==(path==='program'?'mpegts':'flv')||packets.monotonic!==true||!Number.isFinite(packets.maxGop)||packets.maxGop<=0||packets.maxGop>p.keyframeIntervalSeconds+.05||!Number.isSafeInteger(packets.packets)||packets.packets<1||!Number.isFinite(packets.audioKbps)||packets.audioKbps<=0||!Number.isFinite(packets.maxGap)||packets.maxGap<0)throw Error('format_failure');
 if(activeBitrate&&(packets.audioKbps<p.audioBitrateKbps*.75||packets.audioKbps>p.audioBitrateKbps*1.25))throw Error('format_failure');
 return {container:info.format.format_name,width:v.width,height:v.height,fps,videoCodec:v.codec_name,pixelFormat:v.pix_fmt,audioCodec:a.codec_name,channels:a.channels,sampleRate:48000,...packets};
}
export function assertDecodedCoverage(record,{frames,fps,samples}) {
 const {videoRange,audioRange}=record,step=90000/fps;
 if(!Number.isSafeInteger(frames)||frames<=0||!Number.isSafeInteger(samples)||samples<=0||record.videoFrames!==frames||videoRange[1]-videoRange[0]!==step*(frames-1)||audioRange[1]-audioRange[0]!==record.metadataSamples||record.decodedBytes!==record.metadataSamples*2||audioRange[0]*15>videoRange[0]*8||audioRange[1]*15<videoRange[0]*8+samples*15)throw Error('coverage_failure');
 return {videoRange,audioRange,frames,samples:record.metadataSamples,bytes:record.decodedBytes};
}
/** Assign entire observed episodes once. Slot coordinates use only the first
 * original VIDEO PTS, never an audio-derived offset or favorable trimming. */
export function partitionTrainEpisodes(train,record) {
 const origin=record.videoRange[0]*8,groups=train.slots.map(()=>[]);
 for(const e of record.episodes) {
  const indices=train.slots.flatMap((s,i)=>e.onset*15>=origin+s.start*15&&e.end*15<=origin+s.end*15?[i]:[]);
  if(indices.length!==1)throw Error('coverage_failure');groups[indices[0]].push(e);
 }
 return groups;
}

/** Qualification-only adapter. Every declared packet contributes to the exact
 * row/byte counts; malformed PTS/DTS never disappears through a legacy skip. */
export async function strictPacketFacts(owner,file,info) {
 const data=JSON.parse((await owner.run('ffprobe',['-v','error','-show_packets','-show_entries','packet=stream_index,pts,dts,pts_time,dts_time,flags,size','-of','json',file],{timeoutMs:60000,maxBytes:8388608})).toString());
 const streams=info?.streams,rows=data?.packets;
 if(!Array.isArray(streams)||streams.length!==2||!Array.isArray(rows)||rows.length<4||rows.length>65536)throw Error('probe_failure');
 const byStream=new Map();let maxGap=0,maxGop=0,packetBytes=0;
 for(const stream of streams){const tb=/^(\d+)\/(\d+)$/.exec(stream.time_base??'');if(!Number.isSafeInteger(stream.index)||!tb||+tb[1]<=0||+tb[2]<=0||byStream.has(stream.index))throw Error('probe_failure');byStream.set(stream.index,{index:stream.index,timeBase:stream.time_base,scale:+tb[1]/+tb[2],packets:0,bytes:0});}
 const decimal=v=>typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v));
 for(const row of rows){
  const stream=byStream.get(row.stream_index),size=typeof row.size==='string'&&/^\d+$/.test(row.size)?Number(row.size):NaN;
  if(!stream||!Number.isSafeInteger(row.pts)||!Number.isSafeInteger(row.dts)||!decimal(row.pts_time)||!decimal(row.dts_time)||!Number.isSafeInteger(size)||size<=0||typeof row.flags!=='string')throw Error('probe_failure');
  if(Math.abs(row.pts*stream.scale-Number(row.pts_time))>.000001||Math.abs(row.dts*stream.scale-Number(row.dts_time))>.000001)throw Error('probe_failure');
  if(stream.packets&&(row.pts<stream.lastPts||row.dts<stream.lastDts))throw Error('probe_failure');
  if(stream.packets)maxGap=Math.max(maxGap,(row.dts-stream.lastDts)*stream.scale);else{stream.firstPts=row.pts;stream.firstDts=row.dts;}
  if(row.stream_index===0&&row.flags.includes('K')){if(stream.lastKey!==undefined)maxGop=Math.max(maxGop,(row.dts-stream.lastKey)*stream.scale);stream.lastKey=row.dts;}
  stream.lastPts=row.pts;stream.lastDts=row.dts;stream.packets++;stream.bytes+=size;packetBytes+=size;
  if(!Number.isSafeInteger(packetBytes))throw Error('probe_failure');
 }
 const perStream=[...byStream.values()];if(perStream.some(s=>s.packets<2)||perStream.reduce((n,s)=>n+s.packets,0)!==rows.length||perStream.reduce((n,s)=>n+s.bytes,0)!==packetBytes)throw Error('probe_failure');
 const audio=byStream.get(1);if(!audio||audio.lastDts<=audio.firstDts)throw Error('probe_failure');
 return {monotonic:true,originalPacketPtsValidated:true,packets:rows.length,declaredPackets:rows.length,packetBytes,perStream,maxGap,maxGop,audioKbps:audio.bytes*8/((audio.lastDts-audio.firstDts)*audio.scale)/1000};
}

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
  check(equal([e.onset,e.onset+e.loudEnd,e.end,e.firstMetadataIndex,e.metadataRowCount],ranges[index]));
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
