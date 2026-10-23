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
