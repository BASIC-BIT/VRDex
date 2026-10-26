import { PROGRAM_SOURCE_CONTRACT } from './event-marker-program-contract.mjs';
import { createHash } from 'node:crypto';
import { diagnosticArguments } from './event-marker-native-capture.mjs';
import { parseNativeStatistics,parseNativeProgress } from './event-marker-native-observations.mjs';
import { programEncoderArguments } from '../workers/restream/program-renderer.mjs';
import { validateImplementationCatalog,expandImplementationCatalog } from './event-marker-implementation-assets.mjs';
import { expandNativeCatalog } from './event-marker-native-catalog.mjs';
import { validateViewRules,assertCatalogAlias } from './event-marker-platform-view.mjs';

export const PROGRAM_GUARDS=Object.freeze(Array.from({length:13},(_,i)=>'G'+i));
export { PROGRAM_SOURCE_CONTRACT };
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function requireProgram(condition,guard,reason){if(!condition)throw Object.assign(Error('marker_program_'+reason),{guard});}
const check=(v,r)=>requireProgram(v,'G0',r);
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const ref=r=>r&&['runtime','audit','observation'].includes(r.kind)&&typeof r.id==='string'&&r.id.length>0&&hash(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&(!r.range||Number.isSafeInteger(r.range.start)&&Number.isSafeInteger(r.range.length)&&r.range.start>=0&&r.range.length>0&&r.range.start+r.range.length<=r.bytes);
const path=p=>typeof p==='string'&&p.startsWith('/')&&!p.split('/').some(s=>s==='..'||s==='.');
const critical=['ffmpeg','ffprobe','libavcodec','libavformat','libavfilter','libavutil','libswresample','libswscale','libx264'];
/** G0 validates the finite runtime descriptions. An audit reference is pending
 * until independent Root replay joins its complete bytes to the real A/K.
 * The fixed operators below, never rule-name assertions, establish media facts. */
export function validateProgramDependencies({profile,proof,closure,plans,nativeCatalog,manifest,intent}) {
 closure=expandImplementationCatalog(closure);
 check(profile.schema==='native-profile-v2'&&profile.assuranceBasis==='trustedStackMeasurement','profile');
 check(ref(profile.nativeCatalogRef)&&profile.nativeCatalogRef.kind==='runtime'&&!Object.hasOwn(profile,'objects')&&manifest.entries.some(e=>e.id===profile.nativeCatalogRef.id&&e.bytes===profile.nativeCatalogRef.bytes&&e.sha256===profile.nativeCatalogRef.sha256),'native_catalog_ref');
 profile={...profile,objects:expandNativeCatalog(nativeCatalog)};
 check(ref(profile.platformAssumptionsRef)&&profile.platformAssumptionsRef.kind==='audit'&&ref(profile.sourceAuditRef)&&profile.sourceAuditRef.kind==='audit','audit_reference');
 check(same(profile.requiredGuards,PROGRAM_GUARDS)&&same(proof.contract,PROGRAM_SOURCE_CONTRACT),'guard_contract');
 check(proof.schema==='native-proof-descriptions-v2'&&proof.descriptions?.length===13,'guard_descriptions');
 for(const [i,d] of proof.descriptions.entries())check(d.guard===PROGRAM_GUARDS[i]&&ref(d.auditRef)&&d.auditRef.kind==='audit'&&Array.isArray(d.sourceRefs)&&d.sourceRefs.length>0&&d.sourceRefs.every(ref),'guard_description');
 check(Array.isArray(profile.objects)&&profile.objects.length>=critical.length&&profile.objects.length<=256,'objects');
 const ids=new Set(),names=new Set();
 for(const object of profile.objects){
  check(typeof object.id==='string'&&!ids.has(object.id)&&['critical','platform'].includes(object.partition)&&path(object.path)&&hash(object.sha256)&&Number.isSafeInteger(object.bytes)&&object.bytes>0&&object.bytes<=536870912,'object');ids.add(object.id);
  check(Array.isArray(object.aliases)&&object.aliases.length>0&&object.aliases.every(path)&&Array.isArray(object.links)&&object.links.every(l=>path(l.path)&&typeof l.target==='string')&&object.elf?.class===64&&object.elf?.machine===62&&Array.isArray(object.elf.needed)&&ref(object.provenanceRef),'object_identity');
  if(object.partition==='critical'){check(typeof object.semantic==='string'&&!names.has(object.semantic)&&ref(object.sourceBuildRef)&&object.sourceBuildRef.kind==='audit','critical_source');names.add(object.semantic);}
 }
 check(critical.every(n=>names.has(n)),'critical_partition');
 check(profile.executable&&ids.has(profile.executable.id)&&profile.objects.find(o=>o.id===profile.executable.id)?.semantic==='ffmpeg'&&path(profile.executable.path),'executable');
 check(profile.platform&&profile.platform.loader==='standard-elf'&&profile.platform.view?.kind==='stable-overlay'&&typeof profile.platform.kernelRelease==='string'&&Array.isArray(profile.platform.namespaces)&&profile.platform.namespaces.length>0&&!Object.hasOwn(profile.platform,'mountinfoSHA256')&&!Object.hasOwn(profile.platform,'rootIdentitySHA256'),'platform');
 check(profile.platform.view.identityRule==='named-alias-under-approved-mount'&&ref(profile.platform.view.auditRef)&&profile.platform.view.rootFilesystem==='overlay'&&profile.platform.view.devicePolicy==='retain-overlay-disagreement','mapping_view');
 validateViewRules(profile.platform.view);for(const object of profile.objects)for(const alias of object.aliases)assertCatalogAlias(alias,object);
 check(profile.platform.node&&typeof profile.platform.node.version==='string'&&path(profile.platform.node.execPath)&&Array.isArray(profile.platform.node.execArgv)&&profile.platform.node.execArgv.every(v=>typeof v==='string'),'node_platform');
 check(profile.environment&&same(profile.environment,intent.semanticEnvironment)&&typeof profile.environment.PATH==='string','environment');
 check(closure?.schema==='native-verifier-closure-v2'&&Array.isArray(closure.files)&&closure.files.length>0&&closure.files.length<=256,'closure');
 const paths=new Set();
 for(const f of closure.files){check(typeof f.path==='string'&&/^(scripts|workers)\/[a-zA-Z0-9_./-]+$/.test(f.path)&&!f.path.split('/').includes('..')&&!paths.has(f.path)&&hash(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=196608&&Array.isArray(f.imports)&&ref(f.sourceAuditRef),'closure_file');paths.add(f.path);}
 validateImplementationCatalog(closure);
 for(const required of ['scripts/event-marker-program-guards.mjs','scripts/event-marker-conservation.mjs','scripts/event-marker-clock.mjs','scripts/event-marker-native-binding.mjs','scripts/event-marker-runtime-observer.mjs','scripts/marker-qualification/codec-input.mjs','scripts/marker-qualification/marker-frame.mjs'])check(paths.has(required),'closure_missing');
 check(plans?.schema==='native-plans-v2'&&same(plans.domains,['externalFeed','externalCodedRecording'])&&plans.generator==='massFrames'&&plans.sourceRate===48000&&plans.sourceChannels===2,'plan');
 check(ref(plans.generatorAuditRef)&&plans.generatorAuditRef.kind==='audit','generator_audit');
 check(Number.isSafeInteger(plans.outerReserveBytes)&&plans.outerReserveBytes>0&&plans.outerReserveBytes<=196608,'outer_reserve');
 check(!Object.hasOwn(profile,'verified')&&!Object.hasOwn(profile,'approved')&&!Object.hasOwn(proof,'verified'),'supplied_approval');
 return {profile,proof,closure,plans,manifest,guardsRef:{kind:'runtime',id:manifest.entrypoints.proofDescriptions,sha256:manifest.entries.find(e=>e.id===manifest.entrypoints.proofDescriptions).sha256,bytes:manifest.entries.find(e=>e.id===manifest.entrypoints.proofDescriptions).bytes}};
}

export function programDecodeArguments(file,{width,height}) {
 return ['-hide_banner','-nostdin','-nostats','-loglevel','info','-copyts','-threads','2','-filter_threads','1','-i',file,'-map','0:v:0','-vf',`crop=${Math.max(4,Math.floor(192*width/1920))}:${Math.max(2,Math.floor(64*height/1080))}:${Math.floor(32*width/1920)}:${Math.floor(32*height/1080)},scale=2:1:flags=neighbor,format=yuv444p,settb=1/90000,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:direct=1:file='pipe\\:5',format=rgb24`,'-fps_mode','passthrough','-threads','1','-f','rawvideo','pipe:3','-map','0:a:0','-af',"aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,asettb=1/48000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Number_of_samples,ametadata=mode=print:direct=1:file='pipe\\:6'",'-ac','1','-ar','48000','-f','s16le','pipe:4'];
}
/** G2: full builder equality selects defaults from ffmpeg_opt.c init_options,
 * new_*_stream and open_input_file. UINT64_MAX is represented exactly. These
 * defaults are NOT operational output limits and cannot fund any retention. */
export function verifyProgramRecipe(capture,role,{settings,file,width,height}) {
 const original=role==='encode'?programEncoderArguments(settings):programDecodeArguments(file,{width,height}),stdio=role==='encode'?['ignore','pipe','pipe','pipe','pipe','pipe']:['ignore','ignore','pipe','pipe','pipe','pipe','pipe'];
 requireProgram(same(capture.argv,diagnosticArguments(original,{stdio})),'G2','recipe');
 return {recordingTime:'9223372036854775807',maxFrames:'9223372036854775807',limitFilesize:'18446744073709551615',copyts:role==='decode',startAtZero:false,seek:false,loop:0,tsScale:1,inputOffset:0,streamCopy:false,hardware:false,bitstreamFilter:false,outputCount:role==='encode'?1:2};
}

/** Exact original log lines plus offsets, preserving multiline av_log calls. */
export function nativeLines(raw) {
 requireProgram(raw instanceof Uint8Array&&raw.length>0&&raw.at(-1)===10,'G3','diagnostics');
 let at=0,level,context;const lines=[],bytes=Buffer.from(raw),digest=sha(bytes);
 for(let i=0;i<bytes.length;i++)if(bytes[i]===10){const original=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at,i)),m=/^((?:\[[^\[\]\n]+ @ 0x[0-9a-fA-F]+\] )*)\[(info|verbose|warning)\] (.*)$/.exec(original);let text;
  if(m){[,context,level,text]=m;}else {requireProgram(level&&!/^\s*\[/.test(original),'G3','log_level');text=original;}
  lines.push({text,level,context,ref:{sha256:digest,beginByte:at,endByte:i+1}});at=i+1;
 }
 return lines;
}
const once=(lines,pattern,guard,reason)=>{const rows=lines.filter(l=>pattern.test(l.text));requireProgram(rows.length===1,guard,reason);return rows[0];};
/** G3/G9 parse initialized av_dump_format tuples and the verbose fixed graph.
 * Stream-mapping is observed separately and never stands in for initialization. */
export function verifyProgramNegotiation(capture,role,{width,height,fps}) {
 const lines=nativeLines(capture.stderr),mapping=once(lines,/^Stream mapping:$/,'G3','mapping');
 const outputs=lines.filter(l=>/^Output #\d+,/.test(l.text)),inputs=lines.filter(l=>/^Input #\d+,/.test(l.text));
 requireProgram(inputs.length===(role==='encode'?2:1)&&outputs.length===(role==='encode'?1:2)&&outputs.every(l=>l.ref.beginByte>mapping.ref.beginByte),'G3','initialized_output');
 const streams=[];let current;
 for(const line of lines){const h=/^(Input|Output) #(\d+), ([^,]+), (?:from|to) '(.*)':$/.exec(line.text);if(h)current={direction:h[1],file:Number(h[2]),format:h[3],url:h[4]};
  const s=/^  Stream #(\d+):(\d+)(?:\[[^\]]+\])?(?:\([^)]*\))?: (Video|Audio): (.*)$/.exec(line.text);
  if(s){requireProgram(current&&Number(s[1])===current.file,'G3','stream_scope');streams.push({...current,stream:Number(s[2]),type:s[3],description:s[4],ref:line.ref});}
 }
 const find=(direction,file,stream)=>{const rows=streams.filter(s=>s.direction===direction&&s.file===file&&s.stream===stream);requireProgram(rows.length===1,'G3','stream_tuple');return rows[0];};
 const contains=(s,expressions)=>expressions.forEach(p=>requireProgram(p.test(s.description),'G3','negotiated_tuple'));
 const dimension=new RegExp(`(?:^|, )${width}x${height}(?:[ ,]|$)`),rate=new RegExp(`(?:^|, )${fps} (?:fps|tbr)(?:,|$)`);
 if(role==='encode'){
  const v=find('Input',0,0),a=find('Input',1,0),ov=find('Output',0,0),oa=find('Output',0,1);
  requireProgram(streams.length===4&&v.format==='rawvideo'&&v.url==='pipe:3'&&a.format==='s16le'&&a.url==='pipe:4'&&ov.format==='mpegts'&&ov.url==='pipe:1','G3','input_output');
  contains(v,[/^rawvideo\b/,/\byuv420p\b/,dimension,rate]);contains(a,[/^pcm_s16le\b/,/48000 Hz, stereo, s16/]);
  contains(ov,[/^h264\b/,/yuv420p\(progressive\)/,dimension,rate]);contains(oa,[/^aac \(LC\)/,/48000 Hz, stereo, fltp/]);
 }else{
  const v=find('Input',0,0),a=find('Input',0,1),ov=find('Output',0,0),oa=find('Output',1,0);
  requireProgram(streams.length===4&&v.format==='mpegts'&&ov.format==='rawvideo'&&ov.url==='pipe:3'&&oa.format==='s16le'&&oa.url==='pipe:4','G3','input_output');
  contains(v,[/^h264\b/,/yuv420p\(progressive\)/,dimension,rate]);contains(a,[/^aac \(LC\)/,/48000 Hz, stereo, fltp/]);
  contains(ov,[/^rawvideo\b/,/rgb24/,/2x1\b/]);contains(oa,[/^pcm_s16le\b/,/48000 Hz, mono, s16/]);
 }
 const sources=lines.filter(l=>/^\[graph(?: .* input from stream|_\d+_in_\d+_\d+)/.test(l.context)),videoSources=sources.filter(l=>/w:\d+ h:\d+ pixfmt:/.test(l.text)),audioSources=sources.filter(l=>/tb:.*samplefmt:/.test(l.text));
 requireProgram(videoSources.length===1&&audioSources.length===1,'G9','graph_sources');
 requireProgram(new RegExp(`w:${width} h:${height} pixfmt:yuv420p tb:1/${role==='encode'?fps:90000} fr:${fps}/1`).test(videoSources[0].text),'G9','video_source');
 requireProgram(new RegExp(`tb:1/48000 samplefmt:${role==='encode'?'s16':'fltp'} samplerate:48000 chlayout:stereo`).test(audioSources[0].text),'G9','audio_source');
 const conversion=lines.filter(l=>/ch:\d+ chl:.* fmt:.* r:\d+Hz -> ch:/.test(l.text));
 requireProgram(conversion.length===1,'G9','audio_conversion');
 requireProgram((role==='encode'?/ch:2 chl:stereo fmt:s16 r:48000Hz -> ch:2 chl:stereo fmt:fltp r:48000Hz$/:/ch:2 chl:stereo fmt:fltp r:48000Hz -> ch:1 chl:mono fmt:s16 r:48000Hz$/).test(conversion[0].text),'G9','audio_conversion');
 const contexts=[...new Set(lines.flatMap(l=>[...l.context.matchAll(/\[(?:Parsed_([^_ ]+)_\d+|auto_([^_ ]+)_\d+) @ /g)].map(m=>m[1]??m[2])))];
 const allowed=role==='encode'?['aresample']:['crop','scale','format','settb','signalstats','metadata','aresample','aformat','asettb','astats','ametadata'];
 requireProgram(contexts.every(x=>allowed.includes(x)),'G9','extra_filter');
 const scale=lines.filter(l=>/w:\d+ h:\d+ fmt:.* -> w:/.test(l.text)),crops=lines.filter(l=>/w:\d+ h:\d+ sar:.* -> w:/.test(l.text)),timeBases=lines.filter(l=>/^tb:\d+\/\d+ -> tb:/.test(l.text));
 if(role==='encode')requireProgram(scale.length===0&&crops.length===0&&timeBases.length===0,'G9','encoder_filter');
 else {
  const cw=Math.max(4,Math.floor(192*width/1920))&~1,ch=Math.max(2,Math.floor(64*height/1080))&~1;
  requireProgram(crops.length===1&&new RegExp(`^w:${width} h:${height} sar:\\d+/\\d+ -> w:${cw} h:${ch} sar:\\d+/\\d+$`).test(crops[0].text),'G9','crop_tuple');
  requireProgram(scale.length===2&&scale.some(l=>new RegExp(`^w:${cw} h:${ch} fmt:yuv420p sar:\\d+/\\d+ -> w:2 h:1 fmt:yuv444p sar:\\d+/\\d+ flags:0x10$`).test(l.text))&&scale.some(l=>/^w:2 h:1 fmt:yuv444p sar:\d+\/\d+ -> w:2 h:1 fmt:rgb24 sar:\d+\/\d+ flags:0x0$/.test(l.text)),'G9','scale_tuple');
  requireProgram(timeBases.length===2&&timeBases.some(l=>l.text==='tb:1/90000 -> tb:1/90000')&&timeBases.some(l=>l.text==='tb:1/48000 -> tb:1/48000'),'G9','time_base_tuple');
 }
 let startUs=null;
 if(role==='decode'){
  const start=once(lines,/^  Duration: .*, start: -?\d+\.\d{6}, bitrate: /,'G8','input_start');const m=/start: (-?)(\d+)\.(\d{6}),/.exec(start.text);startUs=Number((m[1]?'-':'')+(BigInt(m[2])*1000000n+BigInt(m[3])).toString());requireProgram(Number.isSafeInteger(startUs),'G8','input_start');
 }
 return {streams,sources: sources.map(s=>s.ref),conversion:conversion[0].ref,mapping:mapping.ref,initialized:outputs.map(s=>s.ref),startUs};
}

/** G10: the unique in-loop terminal line plus complete ordinary recipe/graph
 * excludes each alternative finish branch in ffmpeg.c. Success status or
 * output counts alone can never supply demux/decoder/filter/encoder drain. */
export function verifyProgramCompletion(capture,role,recipe,negotiated) {
 requireProgram(capture.native?.exitCode===0&&capture.native.signal===null&&capture.native.stopReason===null&&Object.values(capture.channelEOF??{}).length>0&&Object.values(capture.channelEOF).every(v=>v===true),'G10','native_completion');
 const stats=parseNativeStatistics(capture.stderr,{stderrCap:role==='encode'?65536:1048576}),progress=parseNativeProgress(capture.progress,{videoStreams:[{file:0,stream:0}]});
 requireProgram(stats.terminal.refs[0].beginByte>Math.max(...negotiated.initialized.map(r=>r.endByte))&&progress.final.progress.value==='end'&&progress.final.drop_frames.value===0&&progress.final.dup_frames.value===0&&!stats.fpsSummaries.length,'G10','terminal_order');
 for(const warning of stats.warnings)requireProgram(warning.kind==='queueBlocking'&&warning.queueSize===4||role==='encode'&&warning.kind==='guessedLayout'&&warning.file===1&&warning.stream===0&&warning.layout==='stereo','G10','warning');
 requireProgram(recipe.recordingTime==='9223372036854775807'&&recipe.maxFrames==='9223372036854775807'&&recipe.limitFilesize==='18446744073709551615'&&!recipe.streamCopy&&!recipe.hardware&&!recipe.seek&&!recipe.loop&&stats.outputs.length===recipe.outputCount&&stats.outputs.every(o=>o.streams.every(s=>['video','audio'].includes(s.type)))&&!nativeLines(capture.stderr).some(l=>/Correcting start time|[Cc]onceal|[Cc]orrupt|[Ee]rror|[Ff]ailed|Finishing stream .*without any data/.test(l.text)),'G10','finish_exclusion');
 return {demuxEOF:true,decoderDrain:true,sinkDrain:true,encoderDrain:true,terminal:stats.terminal.refs[0],progress:progress.final.progress.refs[0],countsSHA:stats.sha256};
}
