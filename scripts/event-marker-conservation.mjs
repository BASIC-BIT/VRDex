import { createHash } from 'node:crypto';
import { readTransportProgram,partitionTransportPackets,reassemblePesPackets,inventoryAdtsFrames } from './event-marker-coded-inventory.mjs';
import { observeH264PictureOrder } from './event-marker-h264-inventory.mjs';
import { parseNativeStatistics,parseNativeProgress } from './event-marker-native-observations.mjs';
import { inspectAcquiredDependencies } from './event-marker-native-binding.mjs';
import { verifyProgramConstruction } from './event-marker-source-ledger.mjs';
import { verifyInvocationObservations } from './event-marker-runtime-observer.mjs';
import { requireProgram,same,verifyProgramRecipe,verifyProgramNegotiation,verifyProgramCompletion } from './event-marker-program-guards.mjs';
import { deriveEvidencePolicy,invocationAggregate,programResultLimits } from './event-marker-evidence-policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('marker_program_conservation');};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const checkedPrograms=new WeakMap();
export function inspectCheckedProgram(handle) {return checkedPrograms.get(handle);}
function elementary(raw,pes) {
 const spans=pes.packets.flatMap(p=>p.payloadSpans),bytes=Buffer.concat(spans.map(s=>raw.subarray(s.beginByte,s.endByte)));
 if(bytes.length!==pes.payloadBytes||sha(bytes)!==pes.payloadSHA256)fail();return {bytes,spans};
}
function sourceSpanResolver(raw,spans) {
 let index=0,cursor=0;
 return (begin,end)=>{
  if(begin!==cursor||end<=begin)fail();const result=[];
  while(cursor<end){const s=spans[index];if(!s)fail();const left=Math.max(begin,s.logicalOffset),right=Math.min(end,s.logicalOffset+s.endByte-s.beginByte);
   if(left!==cursor||right<=left)fail();const beginByte=s.beginByte+left-s.logicalOffset,endByte=beginByte+right-left;
   result.push({beginByte,endByte,logicalOffset:left,sha256:sha(raw.subarray(beginByte,endByte))});cursor=right;
   if(right===s.logicalOffset+s.endByte-s.beginByte)index++;
  }
  return result;
 };
}
/** Complete original TS -> derived ES -> parser packet/AU byte observations.
 * The admitted program family has one video AU per PES, checked by boundaries,
 * while audio PES may aggregate multiple ADTS packets. Native counters and
 * whole-source/runtime/EOF proof remain independent required comparisons. */
export function inventoryProgramTransport(raw,{byteCap}) {
 const bytes=Buffer.from(raw),program=readTransportProgram(bytes,{byteCap}),physical=partitionTransportPackets(bytes,{byteCap});
 const vp=program.streams.find(s=>s.type==='h264'),ap=program.streams.find(s=>s.type==='aac');
 const videoPes=reassemblePesPackets(bytes,{byteCap,pid:vp.pid,streamType:'h264'}),audioPes=reassemblePesPackets(bytes,{byteCap,pid:ap.pid,streamType:'aac'}),ve=elementary(bytes,videoPes),ae=elementary(bytes,audioPes);
 const order=observeH264PictureOrder(ve.bytes,{byteCap:ve.bytes.length,framing:'annexB'}),adts=inventoryAdtsFrames(ae.bytes,{byteCap:ae.bytes.length}),partition=order.inventory.headers.parameters.partition,sps=order.inventory.headers.parameters.sps;
 if(sps.length!==1||sps[0].pocType!==2||videoPes.packets.length!==order.pictures.length)fail();
 const videoSpans=sourceSpanResolver(bytes,ve.spans),audioSpans=sourceSpanResolver(bytes,ae.spans);
 const videoPackets=order.inventory.accessUnits.map((au,i)=>{
  const pes=videoPes.packets[i],begin=pes.payloadSpans[0].logicalOffset,end=begin+pes.payloadBytes;
  if(au.beginByte!==begin||au.endByte!==end||pes.pts===null||pes.dts!==pes.pts||!au.aud||au.aud.primaryPicType!==7||order.presentationOrder[i]!==i)fail();
  const nals=au.nalIndices.map(j=>partition.nals[j]);if(nals[0].type!==9||!ve.bytes.subarray(begin,begin+6).equals(Buffer.from('0000000109f0','hex')))fail();
  for(const [j,nal] of nals.slice(1).entries()){const prefix=j===0||[7,8].includes(nal.type)?4:3;if(nal.body.beginByte-nal.prefix.beginByte!==prefix)fail();}
  return {index:i,pts:pes.pts,dts:pes.dts,bytes:end-begin,sha256:au.sha256,muxBytes:end-begin-6,muxSHA256:sha(ve.bytes.subarray(begin+6,end)),sourceSpans:videoSpans(begin,end)};
 });
 const audioPackets=[];let frameIndex=0;
 for(const pes of audioPes.packets) {
  const begin=pes.payloadSpans[0].logicalOffset,end=begin+pes.payloadBytes;if(pes.pts===null||pes.dts!==pes.pts)fail();let next=begin,local=0;
  while(next<end) {
   const frame=adts.frames[frameIndex];if(!frame||frame.header.beginByte!==next||frame.payload.endByte>end)fail();
   const pts=pes.pts+local*1920;if(pts>=8589934592)fail();
   audioPackets.push({index:frameIndex,pts,dts:pts,bytes:frame.payload.endByte-next,sha256:frame.sha256,muxBytes:frame.payload.endByte-frame.payload.beginByte,muxSHA256:frame.payload.sha256,sourceSpans:audioSpans(next,frame.payload.endByte)});
   next=frame.payload.endByte;frameIndex++;local++;
  }
 }
 if(frameIndex!==adts.frames.length)fail();
 const video={pes:videoPes,elementarySHA256:sha(ve.bytes),nativeInputBytes:ve.bytes.length,muxPayloadBytes:ve.bytes.length-6*videoPackets.length,width:sps[0].width,height:sps[0].height,order,packets:videoPackets};
 const audio={pes:audioPes,elementarySHA256:sha(ae.bytes),nativeInputBytes:ae.bytes.length,muxPayloadBytes:adts.payloadBytes,channels:adts.frames[0].channels,packets:audioPackets};
 return freeze({file:{sha256:sha(bytes),bytes:bytes.length},physical,program,video,audio});
}

function nativePopulations(capture,role) {
 if(!capture||capture.native?.exitCode!==0||capture.native.signal!==null||capture.native.stopReason!==null||capture.channelEOF?.stderr!==true||capture.channelEOF?.progress!==true)fail();
 const statistics=parseNativeStatistics(capture.stderr,{stderrCap:role==='program'?65536:1048576}),progress=parseNativeProgress(capture.progress,{videoStreams:[{file:0,stream:0}]});
 if(progress.final.drop_frames.value||progress.final.dup_frames.value||statistics.fpsSummaries.length)fail();
 for(const warning of statistics.warnings)if(!(warning.kind==='queueBlocking'&&warning.queueSize===4)&&!(role==='program'&&warning.kind==='guessedLayout'&&warning.file===1&&warning.stream===0&&warning.layout==='stereo'))fail();
 return {statistics,progress};
}
const equal=(actual,expected)=>{for(const [key,value] of Object.entries(expected))if(actual?.[key]!==value)fail();};
/** Reconcile observed source/feed, complete original packet inventories and
 * BOTH native runs. These arithmetic observations do not prove source/runtime
 * closure, native EOF/drain or AAC content; the bound plan must supply those
 * premises separately before any classification or certificate is allowed. */
export function reconcileProgramPopulation({inventory,source,feeds,encoder,decoder,videoRows,audioRows,rgbBytes,pcmBytes,fps}) {
 if(![30,60].includes(fps)||!source?.video||!source?.audio)fail();
 const F=source.video.frameCount,N=source.audio.bytes/4,frameBytes=inventory.video.width*inventory.video.height*3/2;
 if(!Number.isSafeInteger(F)||F<=0||!Number.isSafeInteger(N)||N<=0||source.video.byteCount!==F*frameBytes)fail();
 for(const [kind,bytes,hash] of [['video',source.video.byteCount,source.video.fullBytesSHA256],['audio',source.audio.bytes,source.audio.sha256]])if(!feeds[kind]?.complete||!feeds[kind].writeFinish||feeds[kind].actualFedByteCount!==bytes||feeds[kind].actualFedSHA256!==hash)fail();
 const K=Math.ceil(N/1024)+1,M=1024*K;
 if(inventory.video.packets.length!==F||inventory.audio.packets.length!==K||inventory.audio.channels!==2)fail();
 const e=nativePopulations(encoder,'program'),d=nativePopulations(decoder,'decode'),es=e.statistics,ds=d.statistics;
 if(es.inputs.length!==2||es.outputs.length!==1||es.inputs.some(i=>i.streams.length!==1)||es.outputs[0].streams.length!==2||ds.inputs.length!==1||ds.inputs[0].streams.length!==2||ds.outputs.length!==2||ds.outputs.some(o=>o.streams.length!==1))fail();
 equal(es.inputs[0].streams[0],{type:'video',packets:F,frames:F,bytes:source.video.byteCount,samples:null});
 const ia=es.inputs[1].streams[0];equal(ia,{type:'audio',bytes:source.audio.bytes,samples:N});if(ia.packets!==ia.frames||ia.frames<1)fail();
 equal(es.outputs[0].streams[0],{type:'video',frames:F,packets:F,bytes:inventory.video.muxPayloadBytes,samples:null});
 equal(es.outputs[0].streams[1],{type:'audio',frames:Math.ceil(N/1024),samples:N,packets:K,bytes:inventory.audio.muxPayloadBytes});
 equal(ds.inputs[0].streams[0],{type:'video',packets:F,frames:F,bytes:inventory.video.nativeInputBytes,samples:null});
 equal(ds.inputs[0].streams[1],{type:'audio',packets:K,frames:K,samples:M,bytes:inventory.audio.nativeInputBytes});
 equal(ds.outputs[0].streams[0],{type:'video',frames:F,packets:F,bytes:F*6,samples:null});
 equal(ds.outputs[1].streams[0],{type:'audio',frames:K,samples:M,packets:K,bytes:M*2});
 if(e.progress.final.frame.value!==F||d.progress.final.frame.value!==F||videoRows.length!==F||audioRows.length!==K||rgbBytes!==F*6||pcmBytes!==M*2)fail();
 let epoch=-1,ordinal=0;
 for(const [i,picture] of inventory.video.order.pictures.entries()) {
  if(picture.epoch!==epoch){epoch=picture.epoch;ordinal=0;}if(picture.poc!==2*ordinal++)fail();
  const pts=inventory.video.packets[i].pts;if(pts!==inventory.video.packets[0].pts+i*90000/fps||videoRows[i].index!==i||videoRows[i].pts!==pts)fail();
 }
 for(const [i,row] of audioRows.entries()) {
  const ticks=inventory.audio.packets[i].pts*8;if(ticks%15||row.index!==i||row.samples!==1024||row.pts!==ticks/15||row.pts!==audioRows[0].pts+1024*i)fail();
 }
 return freeze({kind:'ProgramPopulationObservations',file:inventory.file,sourceFrames:F,sourceSamples:N,codedPictures:F,codedAudioUnits:K,decodedSamples:M,primingSamples:1024,finalFillSamples:1024*Math.ceil(N/1024)-N,sourceVideoSHA256:source.video.fullBytesSHA256,sourceAudioSHA256:source.audio.sha256,nativeReferences:{encoderSHA256:es.sha256,decoderSHA256:ds.sha256,encoderProgressSHA256:e.progress.sha256,decoderProgressSHA256:d.progress.sha256}});
}

/** Secondary cross-check from complete original ffprobe rows. This separate
 * process does not establish the decoder's timestamp-correction or EOF state;
 * its complete packet population must agree with the original byte inventory. */
export function reconcileProgramPacketRows({inventory,rows,streams}) {
 if(!Array.isArray(rows)||!Array.isArray(streams)||streams.length!==2||streams.some((s,i)=>s.index!==i||s.time_base!=='1/90000'))fail();
 const positions=[0,0],packets=[inventory.video.packets,inventory.audio.packets],slices=new Map(inventory.video.order.inventory.headers.slices.map(s=>[s.nalIndex,s]));let bytes=0;
 for(const row of rows) {
  const stream=row.stream_index;if(stream!==0&&stream!==1)fail();const index=positions[stream]++,packet=packets[stream][index];
  if(!packet||row.pts!==packet.pts||row.dts!==packet.dts||row.size!==String(packet.bytes))fail();
  const key=stream===1||slices.get(inventory.video.order.pictures[index].firstSliceNalIndex).nalType===5;
  if(row.flags!==(key?'K_':'__'))fail();
  if(row.side_data_list!==undefined&&(!Array.isArray(row.side_data_list)||row.side_data_list.length>1||row.side_data_list.some(s=>s.side_data_type!=='MPEGTS Stream ID'||s.id!==(stream===0?224:192))))fail();
  bytes+=packet.bytes;
 }
 if(positions.some((n,i)=>n!==packets[i].length))fail();return freeze({kind:'ProbePacketCrosscheck',packets:rows.length,bytes,perStream:positions});
}

/** G6/G7 finite TS replay. Header/service probing starts at zero and restores
 * zero. Regular-file estimate_timings_from_pts closes parsers and clears BOTH
 * packet queues. Its final seek to zero differs from last_pos (>0); handle_packets
 * resets pending PES/CC/PCR/section state. Stable PAT/PMT/SPS/PPS/ADTS plus a
 * complete first PES therefore reproduce the same stream, regardless of probe
 * stop point. No output count selects a probe interpretation.
 *
 * MPEGTS_PUSH_DATA emits length-delimited PES on their final TS packet, zero
 * length PES at next start, then remaining PIDs in ascending order at file EOF.
 * H264 buffers one whole picture until the next AUD; AAC's need_next_header=0
 * emits each complete ADTS immediately. Finally read_frame_internal NULL-flushes
 * each parser in stream-index order and drains parse_queue before returning EOF.
 */
export function replayProgramDemux(inventory,{fileIdentity,fps}) {
 const demand=(v,r)=>requireProgram(v,'G6',r),{program,physical,video,audio}=inventory;
 demand(fileIdentity?.regular===true&&fileIdentity.seekable===true&&fileIdentity.nlink===1&&fileIdentity.position===0&&fileIdentity.bytes===inventory.file.bytes,'seekable_file');
 demand([30,60].includes(fps)&&program.streams[0].type==='h264'&&program.streams[1].type==='aac','stream_order');
 const tableEnd=t=>Math.max(...t.sections[0].spans.map(s=>s.endByte));
 const firstPes=Math.min(video.pes.packets[0].firstTransportPacket,audio.pes.packets[0].firstTransportPacket)*188;
 const initial=[program.sdt,program.pat,program.pmt];
 // Pinned mpegtsenc.c retransmit_si_info: SDT, then PAT/PMT for the
 // initial +resend_headers prefix, all complete before the first PES.
 demand(initial.every((table,i)=>Math.floor(table.sections[0].spans[0].beginByte/188)===i&&table.sections[0].spans.every(s=>s.beginByte>=i*188&&s.endByte<=(i+1)*188))&&tableEnd(program.sdt)<tableEnd(program.pat)&&tableEnd(program.pat)<tableEnd(program.pmt)&&tableEnd(program.pmt)<=firstPes&&physical.packets.slice(0,3).every((p,i)=>p.pid===[17,0,program.pmtPid][i]),'probe_rewind_prefix');
 // Bound all PES below the actual default split threshold. This grammar has no
 // arbitrary PES split; oversized packets cannot silently select another replay.
 for(const pes of [...video.pes.packets,...audio.pes.packets])demand(pes.payloadBytes<=204800&&pes.pts!==null&&pes.pts===pes.dts&&pes.firstTransportPacket*188>=firstPes,'pes_grammar');
 const emission=[];
 for(const [stream,collection] of [[0,video],[1,audio]])for(const p of collection.pes.packets){
  const at=p.endReason==='fileEnd'?physical.packets.length:p.completionPacket;demand(p.endReason!=='fileEnd'||p.declaredLength===0,'final_pes');
  emission.push({stream,pes:p.index,pid:p.pid,at,phase:p.endReason==='fileEnd'?1:0,reason:p.endReason});
 }
 emission.sort((a,b)=>a.at-b.at||a.phase-b.phase||a.pid-b.pid);
 const packets=[],pending=[null,null];let audioIndex=0;
 const slices=new Map(video.order.inventory.headers.slices.map(s=>[s.nalIndex,s]));
 const emit=(stream,index,event,sideData)=>{const p=[video,audio][stream].packets[index],key=stream===1||slices.get(video.order.pictures[index].firstSliceNalIndex).nalType===5;
  requireProgram(p,'G7','parser_packet');packets.push({stream,index,pts:p.pts,dts:p.dts,duration:stream?1920:90000/fps,bytes:p.bytes,flags:key?'K_':'__',sha256:p.sha256,event,sideData:sideData?[{side_data_type:'MPEGTS Stream ID',id:stream?192:224}]:[]});};
 for(const [event,e] of emission.entries())if(e.stream===0){if(pending[0]!==null)emit(0,pending[0],event,true);pending[0]=e.pes;}else{
  const pes=audio.pes.packets[e.pes],end=pes.payloadSpans[0].logicalOffset+pes.payloadBytes;let local=0;
  while(audioIndex<audio.packets.length&&audio.packets[audioIndex].sourceSpans[0].logicalOffset<end){const p=audio.packets[audioIndex];requireProgram(p.pts===pes.pts+1920*local,'G7','parser_timestamp');emit(1,audioIndex++,event,local++===0);}
  requireProgram(local>0,'G7','aac_pes');
 }
 requireProgram(pending[0]!==null&&audioIndex===audio.packets.length,'G7','parser_flush');emit(0,pending[0],emission.length,false);pending[0]=null;
 for(const stream of [0,1])requireProgram(packets.filter(p=>p.stream===stream).length===[video,audio][stream].packets.length,'G7','parser_population');
 return freeze({probe:{branch:'regular-ts-pts-scan-rewind',headerStart:0,oldOffset:0,restoredOffset:0,queuesFlushed:['raw_packet_buffer','packet_buffer','parse_queue'],parserReset:true,pesReset:true},emission,packets,finalFlush:{pidOrder:emission.filter(e=>e.phase===1).map(e=>e.pid),parserOrder:[0,1],pendingPES:0,pendingParsers:0,pendingPackets:0}});
}

/** G8 on actual ordered parser packets. All PTS are positive and less than
 * half the 33-bit wrap interval; wrap_timestamp ADD_OFFSET is inert. For the
 * exact copyts recipe, ts_offset=0. The start correction branch is evaluated
 * even when start_us=0: the enabled stream minimum must equal the start. The
 * copyts wrap exception is also evaluated for every next_dts operand. */
export function replayProgramTimestamps(replay,negotiated,{videoRows,audioRows,fps}) {
 const demand=(v,r)=>requireProgram(v,'G8',r),rescale=n=>Number((BigInt(n)*1000000n+45000n)/90000n),first=[null,null],last=[null,null],next=[null,null],out=[[],[]];
 for(const p of replay.packets)if(first[p.stream]===null)first[p.stream]=p.pts;
 demand(first.every(Number.isSafeInteger)&&negotiated.startUs===Math.min(...first.map(rescale)),'start_timestamp');
 let sharedLast=null;
 for(const packet of replay.packets){const s=packet.stream,pts=packet.pts,dts=packet.dts,us=rescale(dts),duration=s?1920:90000/fps;
  demand(pts===dts&&pts>=0&&pts<4294967296&&packet.duration===duration,'wrap_or_duration');
  const startTicks=Number((BigInt(negotiated.startUs)*90000n+500000n)/1000000n);
  demand(dts<=startTicks+4294967296,'initial_wrap');
  if(last[s]!==null){demand(pts===last[s]+duration,'timestamp_gap');const wrap=rescale(dts+8589934592);demand(Math.abs(wrap-next[s])>=Math.abs(us-next[s])/10,'copyts_wrap_correction');}
  // With start_us=0 the correction guard is entered, but new_start==start.
  demand(negotiated.startUs!==0||Math.min(...first.map(rescale))===0,'start_correction');
  if(s===1){const ticks=pts*8;demand(Number.isSafeInteger(ticks)&&ticks%15===0,'audio_rescale');const sample=ticks/15;
   // av_rescale_delta: interval [floor((2*t-1)*8/30),ceil((2*t+1)*8/30)]
   // contains the previous exact end; the first call uses exact center. Equal
   // 48k input/output rates and default swr async=0 leave this result unchanged.
   const previous=out[1].at(-1);demand(previous===undefined||sample===previous+1024,'rescale_delta');out[1].push(sample);
  }else out[0].push(pts);last[s]=pts;next[s]=us+(s?Math.floor(1024*1000000/48000):Math.floor(1000000/fps));sharedLast=us;
 }
 demand(same(out[0],videoRows.map(r=>r.pts))&&same(out[1],audioRows.map(r=>r.pts)),'decoded_pts');
 return freeze({audioPts:out[1],videoPts:out[0],startUs:negotiated.startUs,lastTimestampUs:sharedLast,audioTimeBase:[1,48000],videoTimeBase:[1,90000],corrections:0});
}

function validateProbeOriginals(probes,inventory,replay,file) {
 requireProgram(probes&&same(Object.keys(probes),['format','packets','final']),'G7','probe_originals');
 let format;
 for(const [kind,original] of Object.entries(probes)){
  requireProgram(original.raw instanceof Uint8Array&&original.native?.exitCode===0&&original.native.signal===null&&original.channelEOF?.stdout===true&&original.channelEOF?.stderr===true&&!original.error&&original.command==='ffprobe'&&Array.isArray(original.args),'G7','probe_completion');
  const args=kind==='packets'?['-v','error','-show_packets','-show_entries','packet=stream_index,pts,dts,pts_time,dts_time,flags,size','-of','json',file]:['-v','error','-show_streams','-show_format','-of','json',file];requireProgram(same(original.args,args),'G7','probe_recipe');
  const parsed=JSON.parse(Buffer.from(original.raw).toString());
  if(kind==='packets'){
   requireProgram(parsed.packets.length===replay.packets.length,'G7','probe_packet_count');
   for(const [i,row] of parsed.packets.entries()){const p=replay.packets[i];requireProgram(row.stream_index===p.stream&&row.pts===p.pts&&row.dts===p.dts&&row.size===String(p.bytes)&&row.flags===p.flags&&(!row.duration||row.duration===p.duration)&&same(row.side_data_list??[],p.sideData),'G7','probe_packet_order');}
   reconcileProgramPacketRows({inventory,rows:parsed.packets,streams:format.streams});
  }else{requireProgram(parsed.format?.format_name==='mpegts'&&parsed.streams?.length===2&&parsed.streams[0].index===0&&parsed.streams[1].index===1&&parsed.streams.every(s=>s.time_base==='1/90000')&&parsed.streams[0].width===inventory.video.width&&parsed.streams[0].height===inventory.video.height&&parsed.streams[0].codec_name==='h264'&&parsed.streams[1].codec_name==='aac'&&parsed.streams[1].sample_rate==='48000'&&parsed.streams[1].channels===2,'G7','probe_format');if(kind==='format')format=parsed;else requireProgram(same(parsed.streams,format.streams),'G7','final_probe');}
 }
 return {streams:[0,1],formatSHA256:sha(probes.format.raw),packetsSHA256:sha(probes.packets.raw),finalSHA256:sha(probes.final.raw)};
}

/** The sole checked-program constructor. Every source-sensitive guard runs on
 * original bytes/actual operands. No exported registration or serialized tag
 * can create the private handle. External approval is deliberately pending. */
export function verifyProgramRecording({bytes,producer,decoder,capture,settings,file,fileIdentity,probes,budget}) {
 const missing=[...(producer?.source?.missing??['producer_source_conservation']),...(producer?.encoder?.binding?.missing??[]),...(decoder?.binding?.missing??[])];
 const eb=inspectAcquiredDependencies(producer?.encoder?.binding),db=inspectAcquiredDependencies(decoder?.binding);
 if(!eb||!db||missing.length)return freeze({kind:'Unproven',missing:[...new Set([...missing,...(!eb?['producer_native_binding']:[]),...(!db?['decoder_native_binding']:[])])]});
 requireProgram(same(eb.projection,db.projection),'G0','runtime_cross_binding');
 const inventory=inventoryProgramTransport(bytes,{byteCap:5242880}),{width,height}=inventory.video,fps=Number(settings.videoPreset.match(/(?:p)(30|60)$/)?.[1]);
 requireProgram(inventory.file.sha256===producer.file.sha256&&inventory.file.bytes===producer.file.bytes,'G11','origin_file');
 const source=verifyProgramConstruction({parameters:producer.parameters,pcm:producer.inputPcm,source:producer.source,feeds:producer.feeds,binding:producer.encoder.binding});
 const recipe={encode:verifyProgramRecipe(producer.encoder,'encode',{settings,file,width,height}),decode:verifyProgramRecipe(decoder,'decode',{settings,file,width,height})};
 const negotiated={encode:verifyProgramNegotiation(producer.encoder,'encode',{width,height,fps}),decode:verifyProgramNegotiation(decoder,'decode',{width,height,fps})};
 const runtime={encode:verifyInvocationObservations(producer.encoder.runtime,producer.encoder.binding,producer.encoder.argv,{role:'encode'}),decode:verifyInvocationObservations(decoder.runtime,decoder.binding,decoder.argv,{role:'decode',file,fileIdentity})};
 const completion={encode:verifyProgramCompletion(producer.encoder,'encode',recipe.encode,negotiated.encode),decode:verifyProgramCompletion(decoder,'decode',recipe.decode,negotiated.decode)};
 const stdout=producer.encoder.references.coded;requireProgram(stdout?.complete&&stdout.observedBytes===inventory.file.bytes&&stdout.observedSHA256===inventory.file.sha256&&producer.encoder.channelEOF.coded===true,'G11','stdout_file_lineage');
 // G5: finite raw-pipe units. Rawvideo has no remainder, PCM block_align=4.
 // The exact recipe excludes NOBUFFER, GENPTS, wallclock and early-limit paths;
 // source/feed equality and main-thread P totals independently check dequeue.
 requireProgram(producer.source.video.byteCount===source.frames*width*height*3/2&&producer.inputPcm.length===source.samples*4&&producer.inputPcm.length%4===0,'G5','raw_units');
 const replay=replayProgramDemux(inventory,{fileIdentity,fps}),time=replayProgramTimestamps(replay,negotiated.decode,{...capture,fps});
 const probe=validateProbeOriginals(probes,inventory,replay,file);
 const pcm=Buffer.concat(capture.audioChunks),population=reconcileProgramPopulation({inventory,source:producer.source,feeds:producer.feeds,encoder:producer.encoder,decoder,videoRows:capture.videoRows,audioRows:capture.audioRows,rgbBytes:capture.rgb.length,pcmBytes:pcm.length,fps});
 const policy=deriveEvidencePolicy(eb,budget?.invocation);requireProgram(budget?.invocation?.kind==='mass'&&budget.policyId===policy.id&&budget.artifactCap===invocationAggregate('mass')&&budget.normalNumericCap===policy.normal&&budget.finalNumericCap===policy.final&&budget.failureReserve===65536&&Number.isSafeInteger(budget.numericBytes)&&Number.isSafeInteger(budget.reservedOuterBytes)&&budget.reservedOuterBytes>0&&budget.reservedOuterBytes===eb.plans.outerReserveBytes&&budget.reservedOuterBytes<=programResultLimits(eb,budget.invocation).reservation&&budget.numericBytes+budget.reservedOuterBytes<=policy.normal&&Array.isArray(budget.uses)&&budget.uses.length>0,'G12','artifact_uses');
 const binding={pcmSHA256:sha(pcm),rgbSHA256:sha(capture.rgb),audioRowsSHA256:sha(JSON.stringify(capture.audioRows)),videoRowsSHA256:sha(JSON.stringify(capture.videoRows))};
 const data=freeze({file:inventory.file,population,fps,binding,packetOrderSHA256:sha(JSON.stringify(replay.packets)),time,probe,assurance:producer.encoder.binding.assurance,completion,runtime,budget});
 const handle=freeze({kind:'CheckedProgram',projection:{file:inventory.file,fps,samples:population.decodedSamples,frames:population.codedPictures,binding,packetOrderSHA256:data.packetOrderSHA256,completion,assurance:data.assurance}});checkedPrograms.set(handle,data);return handle;
}
