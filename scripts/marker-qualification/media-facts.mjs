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
