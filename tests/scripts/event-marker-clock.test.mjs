import test from 'node:test';
import assert from 'node:assert/strict';
import { audioCoordinate, videoCoordinate, subtractClock, clockMay, clockMust, packetOriginCell, replayFlvAudioPts, expectedAacCounts, audioEndpoint, replayFpsIdentity, inspectClock, assertAudioClock, assertVideoClock } from '../../scripts/event-marker-clock.mjs';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { referenceDetector } from '../../scripts/marker-qualification/detector-reference.mjs';

test('clock predicates retain one shared origin and exact open boundaries',()=>{
 const domain={audio:[-720,240],video:[38640,39600]};
 assert.deepEqual(subtractClock(videoCoordinate(2,30),videoCoordinate(1,30)),[0,0,24000]);
 assert.equal(clockMust(domain,[{value:[0,0,72000],op:'<=',bound:72000}]),true);
 assert.equal(clockMay(domain,[{value:[0,0,360000],op:'<',bound:360000}]),false);
 assert.equal(clockMay(domain,[{value:[1,0,0],op:'>',bound:0},{value:[1,0,0],op:'<',bound:0}]),false);
 assert.equal(clockMay(domain,[{value:[1,0,0],op:'>=',bound:0},{value:[0,1,0],op:'<=',bound:39000},{value:[1,-1,0],op:'<',bound:-39000}]),false);
 assert.deepEqual(audioCoordinate(1024),[1,0,15360]);
 assert.throws(()=>audioCoordinate(Number.MAX_SAFE_INTEGER),/marker_clock_integer/);
 assert.throws(()=>clockMay(domain,[{value:[1,1,0],op:'<',bound:0}]),/marker_clock_unproven/);
});
test('FLV cells use packet residuals and native timestamps use exact recurrence',()=>{
 assert.deepEqual(packetOriginCell([0,21,42,64],15360,720),[-720,240]);
 assert.deepEqual(replayFlvAudioPts([0,21,42,64,85,106,128,149]).pts,[0,1024,2040,3072,4096,5112,6144,7168]);
 assert.equal(replayFlvAudioPts([0,21,42,64]).resets,1);
 assert.throws(()=>packetOriginCell([0,23],15360,720),/marker_clock_diameter/);
});
test('AAC conservation derives priming and fill from independently fed input',()=>{
 assert.deepEqual(expectedAacCounts(1017600),{inputSamples:1017600,accessUnits:995,samples:1018880,priming:1024,fill:256});
 assert.deepEqual(expectedAacCounts(1018880),{inputSamples:1018880,accessUnits:996,samples:1019904,priming:1024,fill:0});
 assert.throws(()=>expectedAacCounts(0),/marker_clock_input/);
});
test('row-right and next-row-left preserve distinct raw PTS at one ordinal',()=>{
 const rows=[{index:0,pts:1024,samples:1024},{index:1,pts:2040,samples:1024}];
 const right=audioEndpoint(rows,0,1024,'right'),left=audioEndpoint(rows,1,0,'left');
 assert.equal(right.ordinal,left.ordinal);assert.equal(right.raw,2048);assert.equal(left.raw,2040);
 assert.throws(()=>audioEndpoint(rows,0,1025,'right'),/marker_endpoint/);
});
test('fps identity requires independently supplied EOF and rejects drop or duplication',()=>{
 assert.deepEqual(replayFpsIdentity([4860,7920,10890,13860],{num:1,den:90000},30,16860),[{ordinal:0,pts:2},{ordinal:1,pts:3},{ordinal:2,pts:4},{ordinal:3,pts:5}]);
 assert.throws(()=>replayFpsIdentity([0,3000,6000],{num:1,den:90000},30,undefined),/marker_clock_fps_eof/);
 assert.throws(()=>replayFpsIdentity([0,3000,6000],{num:1,den:90000},30,6000),/marker_clock_fps_identity/);
 assert.throws(()=>replayFpsIdentity([0,6000,9000],{num:1,den:90000},30,12000),/marker_clock_fps_identity/);
 assert.throws(()=>replayFpsIdentity([0,1000,6000],{num:1,den:90000},30,9000),/marker_clock_fps_identity/);
});
test('literal clock certificates bind immutable domains to original raw bytes rows and policy',()=>{
 const pcm=Buffer.alloc(2048),rgb=Buffer.alloc(12),audioRows=[{index:0,pts:3,samples:1024}],videoRows=[{index:0,pts:7},{index:1,pts:3007}];
 const c=inspectClock({audioChunks:[pcm],audioRows,rgb,videoRows},{mode:'literal',fps:30},{kind:'literal',samples:1024,frames:2});
 assert.equal(c.kind,'ClockCompatible');assert.deepEqual(c.domain,{audio:[45,45],video:[56,56]});
 assertAudioClock(c,[pcm],audioRows);assertVideoClock(c,rgb,videoRows);
 assert.deepEqual(decodeSourceAudio([pcm],audioRows,c),decodeSourceAudio([pcm],audioRows));
 assert.deepEqual(referenceDetector(pcm,audioRows,c),referenceDetector(pcm,audioRows));
 assert.throws(()=>decodeSourceAudio([pcm],audioRows,{kind:'ClockCompatible'}),/marker_clock_unproven/);
 assert.throws(()=>referenceDetector(pcm,audioRows,structuredClone(c)),/marker_clock_unproven/);
 assert(Object.isFrozen(c.domain.audio));assert.throws(()=>{c.domain.audio[0]=0;},TypeError);
 assert.throws(()=>assertAudioClock(structuredClone(c),[pcm],audioRows),/marker_clock_unproven/);
 assert.throws(()=>assertAudioClock(c,[Buffer.alloc(2048,1)],audioRows),/marker_clock_binding/);
 assert.throws(()=>assertAudioClock(c,[pcm],[{...audioRows[0],pts:4}]),/marker_clock_binding/);
 assert.throws(()=>assertVideoClock(c,rgb,[{...videoRows[0],pts:8},videoRows[1]]),/marker_clock_binding/);
 assert.equal(inspectClock({audioChunks:[pcm],audioRows,rgb,videoRows},{mode:'flv1ms',fps:30},{kind:'encoded',samples:1024,frames:2}).kind,'Unproven');
 assert.equal(inspectClock({audioChunks:[pcm],audioRows,rgb,videoRows},{mode:'literal',fps:30},{kind:'literal',samples:1023,frames:2}).kind,'Violation');
});
test('shared-origin feasibility agrees with an independent bounded rational witness oracle',()=>{
 // The oracle grid exists only in this small test. The implementation uses
 // constant-size interval/strip intersections and never scans origins.
 const domain={audio:[-2,2],video:[-2,2]},expressions=[[1,0,0],[0,1,0],[1,-1,0],[-1,1,0]],operators=['<','<=','>','>=','=='];
 let seed=31;
 const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let trial=0;trial<300;trial++) {
  const predicates=Array.from({length:1+next(5)},()=>({value:expressions[next(expressions.length)],op:operators[next(operators.length)],bound:next(7)-3}));
  const witnesses=[];
  for(let a=-8;a<=8;a++)for(let v=-8;v<=8;v++)witnesses.push(predicates.every(p=>{
   const left=p.value[0]*a+p.value[1]*v,right=p.bound*4;
   return p.op==='<'?left<right:p.op==='<='?left<=right:p.op==='>'?left>right:p.op==='>='?left>=right:left===right;
  }));
  assert.equal(clockMay(domain,predicates),witnesses.some(Boolean),JSON.stringify(predicates));
  assert.equal(clockMust(domain,predicates),witnesses.every(Boolean),JSON.stringify(predicates));
 }
});
