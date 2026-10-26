import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fakeProgramTransport } from '../fixtures/marker-program-transport.mjs';
import { inventoryProgramTransport } from '../../scripts/event-marker-conservation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('program TS inventory joins original file spans through PES/ES/AU and separates native P from M payload bytes',()=>{
 const fixture=fakeProgramTransport(),result=inventoryProgramTransport(fixture.bytes,{byteCap:fixture.bytes.length});
 assert.equal(result.file.sha256,sha(fixture.bytes));assert.equal(result.video.packets.length,2);assert.equal(result.audio.packets.length,5);assert.equal(result.audio.pes.packets.length,3);
 assert.equal(result.video.nativeInputBytes,fixture.video.reduce((n,b)=>n+b.length,0));assert.equal(result.video.muxPayloadBytes,result.video.nativeInputBytes-12);assert.equal(result.audio.nativeInputBytes,50);assert.equal(result.audio.muxPayloadBytes,15);
 assert.deepEqual(result.video.packets.map(p=>p.pts),[1920,4920]);assert.deepEqual(result.audio.packets.map(p=>p.pts),[0,1920,3840,5760,7680]);
 for(const [kind,source] of [['video',fixture.video],['audio',fixture.audio]])for(const [i,p] of result[kind].packets.entries()){const bytes=Buffer.concat(p.sourceSpans.map(s=>fixture.bytes.subarray(s.beginByte,s.endByte)));assert.deepEqual(bytes,source[i]);assert.equal(p.sha256,sha(bytes));assert(Object.isFrozen(p.sourceSpans));}
 assert.equal(result.video.width,854);assert.equal(result.video.height,480);assert.equal(result.audio.channels,2);assert(!Object.hasOwn(result,'consumerReadEOF'));assert(!Object.hasOwn(result,'ClockCompatible'));
});
test('program inventory rejects missing/corrupted original bytes before native totals can rescue them',()=>{
 const {bytes}=fakeProgramTransport();for(const raw of [bytes.subarray(0,-1),Buffer.concat([bytes,Buffer.from([0])]),bytes.subarray(188)])assert.throws(()=>inventoryProgramTransport(raw,{byteCap:bytes.length+1}),/marker_/);
 const changed=Buffer.from(bytes);changed[10]^=1;assert.throws(()=>inventoryProgramTransport(changed,{byteCap:changed.length}),/marker_/);
});

test('complete source/native/coded/decoded populations reconcile with priming and final fill without claiming a clock certificate',async()=>{
 const {reconcileProgramPopulation}=await import('../../scripts/event-marker-conservation.mjs'),{fakeProgramNativeLogs}=await import('../fixtures/marker-program-transport.mjs');
 const fixture=fakeProgramTransport(),inventory=inventoryProgramTransport(fixture.bytes,{byteCap:fixture.bytes.length}),logs=fakeProgramNativeLogs(inventory);
 const source={video:{frameCount:2,byteCount:854*480*3,fullBytesSHA256:'a'.repeat(64)},audio:{bytes:12800,sha256:'b'.repeat(64)}};
 const captured=stderr=>({stderr,progress:logs.progress,native:{exitCode:0,signal:null,stopReason:null},channelEOF:{stderr:true,progress:true}});
 const request={inventory,source,feeds:{video:{complete:true,writeFinish:true,actualFedByteCount:source.video.byteCount,actualFedSHA256:source.video.fullBytesSHA256},audio:{complete:true,writeFinish:true,actualFedByteCount:12800,actualFedSHA256:source.audio.sha256}},encoder:captured(logs.encoder),decoder:captured(logs.decoder),videoRows:[{index:0,pts:1920},{index:1,pts:4920}],audioRows:Array.from({length:5},(_,index)=>({index,pts:1024*index,samples:1024})),rgbBytes:12,pcmBytes:10240,fps:30};
 const result=reconcileProgramPopulation(request);assert.equal(result.primingSamples,1024);assert.equal(result.finalFillSamples,896);assert.equal(result.decodedSamples,5120);assert.equal(result.kind,'ProgramPopulationObservations');assert(!Object.hasOwn(result,'ClockCompatible'));
 for(const change of [r=>r.pcmBytes--,r=>r.rgbBytes++,r=>r.feeds.video.actualFedSHA256='c'.repeat(64),r=>r.decoder.native.signal='SIGTERM',r=>r.decoder.channelEOF.stderr=false,r=>r.audioRows[4].samples--,r=>r.videoRows[1].pts++,r=>r.inventory.audio.packets.pop(),r=>r.encoder.stderr=Buffer.from(logs.encoder.toString().replace('3200 samples','3199 samples'))]) {const altered=structuredClone(request);change(altered);assert.throws(()=>reconcileProgramPopulation(altered),/marker_/);}
});

test('complete original probe packet rows cross-check every TS parser packet without substituting for native decoder observations',async()=>{
 const {reconcileProgramPacketRows}=await import('../../scripts/event-marker-conservation.mjs'),fixture=fakeProgramTransport(),inventory=inventoryProgramTransport(fixture.bytes,{byteCap:fixture.bytes.length});
 const rows=[...inventory.video.packets.map(p=>({stream_index:0,pts:p.pts,dts:p.dts,size:String(p.bytes),flags:p.index===0?'K_':'__'})),...inventory.audio.packets.map(p=>({stream_index:1,pts:p.pts,dts:p.dts,size:String(p.bytes),flags:'K_'}))],streams=[{index:0,time_base:'1/90000'},{index:1,time_base:'1/90000'}];
 assert.equal(reconcileProgramPacketRows({inventory,rows,streams}).packets,7);
 for(const change of [r=>r.pop(),r=>r[0].size=String(Number(r[0].size)-1),r=>r[2].pts++,r=>r[0].flags='KD',r=>r[2].side_data_list=[{side_data_type:'Skip Samples',skip_samples:1024}]]){const altered=structuredClone(rows);change(altered);assert.throws(()=>reconcileProgramPacketRows({inventory,rows:altered,streams}),/marker_/);}
});
