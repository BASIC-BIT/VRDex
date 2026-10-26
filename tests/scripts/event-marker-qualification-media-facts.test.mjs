import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEncodedFormat, assertDecodedCoverage, partitionTrainEpisodes } from '../../scripts/marker-qualification/media-facts.mjs';
const info={format:{format_name:'mpegts'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:854,height:480,r_frame_rate:'30/1',pix_fmt:'yuv420p'},{index:1,codec_type:'audio',codec_name:'aac',channels:2,sample_rate:'48000'}]};
test('qualification formats and coverage reject missing fractional or shortened observed media',()=>{
 const settings={videoPreset:'480p30',audioBitrateKbps:320},packet={monotonic:true,maxGop:1,packets:120,audioKbps:319,maxGap:.0334};
 assert.equal(assertEncodedFormat(info,packet,settings,'program',true).audioKbps,319);
 for(const mutate of [x=>delete x.streams[0].r_frame_rate,x=>x.streams[0].r_frame_rate='NaN/1',x=>x.streams[1].channels=1,x=>x.format.format_name='flv']){const x=structuredClone(info);mutate(x);assert.throws(()=>assertEncodedFormat(x,packet,settings,'program',true),/format_failure/);}
 assert.throws(()=>assertEncodedFormat(info,{...packet,audioKbps:100},settings,'program',true),/format_failure/);
 const r={videoFrames:90,videoRange:[126000,393000],audioRange:[66176,212992],metadataSamples:146816,decodedBytes:293632};
 assertDecodedCoverage(r,{frames:90,fps:30,samples:144000});assert.throws(()=>assertDecodedCoverage({...r,videoFrames:89},{frames:90,fps:30,samples:144000}),/coverage_failure/);
 assert.throws(()=>assertDecodedCoverage({...r,audioRange:[67201,212992]},{frames:90,fps:30,samples:144000}),/coverage_failure/);
});
test('train partition preserves each global episode once and never clips cross-slot episodes',()=>{
 const train={slots:[{start:48000,end:62400},{start:62400,end:76800}]},record={audioRange:[0,130000],videoRange:[0,240000],episodes:[{onset:50000,end:55000},{onset:65000,end:70000}]};
 assert.deepEqual(partitionTrainEpisodes(train,record).map(a=>a.length),[1,1]);
 for(const e of [{onset:62000,end:63000},{onset:10,end:100},{onset:77000,end:78000}])assert.throws(()=>partitionTrainEpisodes(train,{...record,episodes:[...record.episodes,e]}),/coverage_failure/);
});
