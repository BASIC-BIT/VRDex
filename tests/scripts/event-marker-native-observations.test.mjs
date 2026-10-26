import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseNativeProgress, parseNativeStatistics } from '../../scripts/event-marker-native-observations.mjs';
const block=(progress='end',frame=12)=>`frame=${frame}\nfps=30.00\nstream_0_0_q=-1.0\nbitrate= 123.4kbits/s\ntotal_size=1234\nout_time_us=400000\nout_time_ms=400000\nout_time=00:00:00.400000\ndup_frames=0\ndrop_frames=0\nspeed=1.23x\nprogress=${progress}\n`;
const streams=[{file:0,stream:0}];

test('native progress reads every bounded original block and retains exact field byte references',()=>{
 const raw=Buffer.from(block('continue',5)+block()),result=parseNativeProgress(raw,{videoStreams:streams});
 assert.equal(result.blocks.length,2);assert.equal(result.final.frame.value,12);assert.equal(result.final.out_time_us.value,400000);assert.equal(result.final.progress.value,'end');
 const hash=createHash('sha256').update(raw).digest('hex');assert.equal(result.sha256,hash);
 for(const item of Object.values(result.final)){const ref=item.refs[0];assert.equal(ref.sha256,hash);assert.equal(raw.subarray(ref.beginByte,ref.endByte).toString(),item.original);}
 const noVideo=block().split('\n').filter(line=>! /^(?:frame|fps|stream_)/.test(line)).join('\n');
 assert.equal(parseNativeProgress(Buffer.from(noVideo),{videoStreams:[]}).final.dup_frames.value,0);
});

test('native progress rejects missing duplicate partial unsupported and overflowing facts',()=>{
 for(const text of [block('continue'),block().slice(0,-1),block()+block(),block().replace('drop_frames=0\n',''),block().replace('drop_frames=0','drop_frames=0\ndrop_frames=0'),block().replace('frame=12','frame=9007199254740992'),block().replace('frame=12','frame=-1'),block().replace('out_time_ms=400000','out_time_ms=400001'),block().replace('00:00:00.400000','00:00:00.400001'),block().replace('fps=30.00','fps=NaN'),block().replace('progress=end','other=1\nprogress=end'),block().replace('stream_0_0_q','stream_0_1_q')])assert.throws(()=>parseNativeProgress(Buffer.from(text),{videoStreams:streams}),/marker_native_progress/);
 assert.throws(()=>parseNativeProgress(Buffer.alloc(1048577,10),{videoStreams:streams}),/marker_native_progress/);
 assert.throws(()=>parseNativeProgress(Buffer.from([255,10]),{videoStreams:streams}),/marker_native_progress/);
});

const stats=`[verbose] No more output streams to write to, finishing.
[verbose] Input file #0 (original.ts):
[verbose]   Input stream #0:0 (video): 12 packets read (1000 bytes); 12 frames decoded;${' '}
[verbose]   Input stream #0:1 (audio): 20 packets read (400 bytes); 20 frames decoded (20480 samples);${' '}
[verbose]   Total: 32 packets (1400 bytes) demuxed
[verbose] Output file #0 (pipe:3):
[verbose]   Output stream #0:0 (video): 12 frames encoded; 12 packets muxed (72 bytes);${' '}
[verbose]   Total: 12 packets (72 bytes) muxed
[verbose] Output file #1 (pipe:4):
[verbose]   Output stream #1:0 (audio): 20 frames encoded (20480 samples); 20 packets muxed (40960 bytes);${' '}
[verbose]   Total: 20 packets (40960 bytes) muxed
`;
test('native statistics preserve input versus mux payload populations and raw line references',()=>{
 const raw=Buffer.from(stats),observed=parseNativeStatistics(raw,{stderrCap:65536});
 assert.equal(observed.inputs[0].streams[0].packets,12);assert.equal(observed.inputs[0].streams[1].samples,20480);
 assert.equal(observed.outputs[1].streams[0].bytes,40960);assert.equal(observed.outputs[0].streams[0].samples,null);
 assert.equal(observed.terminal.refs.length,1);assert.equal(raw.subarray(observed.terminal.refs[0].beginByte,observed.terminal.refs[0].endByte).toString(),'[verbose] No more output streams to write to, finishing.\n');
 assert.equal(observed.warnings.length,0);assert(Object.isFrozen(observed.inputs[0].streams[0]));
 const warned=parseNativeStatistics(Buffer.from('[warning] Guessed Channel Layout for Input Stream #0.1 : stereo\n'+stats),{stderrCap:65536});assert.equal(warned.warnings[0].kind,'guessedLayout');assert.equal(warned.warnings[0].layout,'stereo');
});
test('native statistics reject missing duplicate overflow inconsistent or unapproved diagnostic facts',()=>{
 for(const text of [stats.replace('32 packets (1400 bytes)','31 packets (1400 bytes)'),stats.replace('20 packets read (400 bytes)','20 packets read (401 bytes)'),stats.replace('20 frames decoded (20480 samples)','20 frames decoded'),stats.replace('Input stream #0:1','Input stream #0:0'),stats.replace('12 packets read','9007199254740992 packets read'),stats.replace('No more output streams to write to, finishing.','No more inputs to read from, finishing.'),stats+stats,stats.slice(0,-1),'[error] decoder corruption\n'+stats,'[warning] unknown warning\n'+stats,'[debug] extra trace\n'+stats])assert.throws(()=>parseNativeStatistics(Buffer.from(text),{stderrCap:65536}),/marker_native_trace/);
 assert.throws(()=>parseNativeStatistics(Buffer.alloc(65537),{stderrCap:65536}),/marker_native_trace/);
});

test('native statistics reject malformed diagnostic prefix starts after INFO and VERBOSE',()=>{
 const malformed=['[error]decoder failure','[error decoder failure','[decoder @ 0x1234 [error] decoder failure','[decoder @ 0x1234][error] decoder failure','[decoder @ invalid] [error] decoder failure','[decoder [nested @ 0x1234] [verbose] hidden prefix','[verbose]','  [error]decoder failure'];
 for(const level of ['info','verbose'])for(const line of malformed)assert.throws(()=>parseNativeStatistics(Buffer.from(stats+`[${level}] accepted previous line\n${line}\n`),{stderrCap:65536}),/marker_native_trace/,`${level}: ${line}`);
});

test('native statistics preserve legitimate unprefixed multiline output and raw references',()=>{
 const prefix='[info] ffmpeg version source-fixture\n  configuration: fixed source options\n\n  libavutil      57. 28.100\n',continued=stats.replaceAll('[verbose] ','');
 const raw=Buffer.from(prefix+'[verbose] native multiline statistics\n'+continued),result=parseNativeStatistics(raw,{stderrCap:65536});
 assert.equal(result.inputs[0].streams[1].samples,20480);assert.equal(result.outputs[1].streams[0].bytes,40960);
 const ref=result.inputs[0].streams[0].refs[0];assert.equal(raw.subarray(ref.beginByte,ref.endByte).toString(),'  Input stream #0:0 (video): 12 packets read (1000 bytes); 12 frames decoded; \n');
 assert.equal(result.sha256,createHash('sha256').update(raw).digest('hex'));
});

const fpsLine=(context='Parsed_fps_0 @ 0x1234',input=12,output=12,dropped=0,duplicated=0)=>`[${context}] [verbose] ${input} frames in, ${output} frames out; ${dropped} frames dropped, ${duplicated} frames duplicated.\n`;
test('native fps summaries reject duplicate exact contexts while preserving distinct filters',()=>{
 const first=fpsLine(),second=fpsLine('Parsed_fps_0 @ 0x5678'),third=fpsLine('Parsed_fps_1 @ 0x1234');
 const setup='[Parsed_fps_0 @ 0x1234] [verbose] fps=60/1\n[Parsed_fps_0 @ 0x1234] [verbose] Set first pts to 0\n';
 const raw=Buffer.from(stats+setup+first+second+third),result=parseNativeStatistics(raw,{stderrCap:65536});assert.equal(result.fpsSummaries.length,3);assert.equal(new Set(result.fpsSummaries.map(s=>s.context)).size,3);
 for(const summary of result.fpsSummaries){const ref=summary.refs[0];assert(raw.subarray(ref.beginByte,ref.endByte).toString().includes(summary.context.trim()));}
 assert.throws(()=>parseNativeStatistics(Buffer.from(stats+first+first),{stderrCap:65536}),/marker_native_trace/);
});

test('native fps summaries enforce exact population conservation without rounded sums',()=>{
 const max=Number.MAX_SAFE_INTEGER;
 assert.equal(parseNativeStatistics(Buffer.from(stats+fpsLine(undefined,12,14,1,3)),{stderrCap:65536}).fpsSummaries[0].duplicated,3);
 assert.equal(parseNativeStatistics(Buffer.from(stats+fpsLine(undefined,max,max-1,2,1)),{stderrCap:65536}).fpsSummaries[0].input,max);
 for(const line of [fpsLine(undefined,1,1,1,0),fpsLine(undefined,max,max,1,2)])assert.throws(()=>parseNativeStatistics(Buffer.from(stats+line),{stderrCap:65536}),/marker_native_trace/);
});

test('native statistics reject malformed fps-summary-shaped lines instead of ignoring them',()=>{
 const good=fpsLine();
 for(const line of [good.replace('12 frames in','-1 frames in'),good.replace('12 frames in','NaN frames in'),good.replace('frames out;','frames out,'),good.replace('frames duplicated.','frames duplicated'),good.replace('frames in','frame in'),good.replace('frames dropped, 0 frames duplicated.','frames dropped.'),good.replaceAll('frames ',''),good.replace('Parsed_fps_0','ordinary_filter_0')])assert.throws(()=>parseNativeStatistics(Buffer.from(stats+line),{stderrCap:65536}),/marker_native_trace/);
});
