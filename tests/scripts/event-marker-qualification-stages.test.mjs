import test from 'node:test';
import assert from 'node:assert/strict';
import { readQualificationRecording,applyDecodeStageFailure } from '../../scripts/marker-qualification/codec-record.mjs';
import { strictPacketFacts } from '../../scripts/marker-qualification/media-facts.mjs';
import { prerequisiteStates } from '../../scripts/marker-qualification/results.mjs';
test('successful probe followed by wrong format is typed format failure, never probe success fabrication',async()=>{
 let decoded=false;
 const io={probe:async()=>({streams:[{index:0,time_base:'1/1'},{index:1,time_base:'1/1'}],format:{format_name:'mpegts'}}),decodeQualifiedMediaMarkerRecord:async()=>{decoded=true;throw Error('unexpected');}};
 const owner={run:async()=>Buffer.from(JSON.stringify({packets:[0,1].flatMap(i=>[0,1].map(t=>({stream_index:i,pts:t,dts:t,pts_time:String(t),dts_time:String(t),size:'100',flags:'K_'})))}))};
 let error;try{await readQualificationRecording(owner,'synthetic',{settings:{videoPreset:'480p30',audioBitrateKbps:160},path:'program',frames:30,samples:48000},io);}catch(e){error=e;}
 const states=prerequisiteStates('not_run');assert.equal(applyDecodeStageFailure(states,error,'probe_complete'),'declared_format_valid');
 assert.equal(states.probe_complete,'pass');assert.equal(states.declared_format_valid,'fail');assert.equal(states.decode_complete,'not_run');assert.equal(decoded,false);
});

test('qualification caller accounts every packet PTS DTS and byte before probe completion',async()=>{
 const info={format:{format_name:'mpegts'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:854,height:480,r_frame_rate:'30/1',pix_fmt:'yuv420p',time_base:'1/90000'},{index:1,codec_type:'audio',codec_name:'aac',channels:2,sample_rate:'48000',time_base:'1/48000'}]};
 const packets=[{stream_index:0,pts:0,dts:0,pts_time:'0.000000',dts_time:'0.000000',size:'100',flags:'K_'},{stream_index:1,pts:0,dts:0,pts_time:'0.000000',dts_time:'0.000000',size:'200',flags:'K_'},{stream_index:0,pts:90000,dts:90000,pts_time:'1.000000',dts_time:'1.000000',size:'100',flags:'K_'},{stream_index:1,pts:48000,dts:48000,pts_time:'1.000000',dts_time:'1.000000',size:'200',flags:'K_'}];
 const summary=await strictPacketFacts({run:async()=>Buffer.from(JSON.stringify({packets}))},'injected',info);
 assert.equal(summary.packets,4);assert.equal(summary.declaredPackets,4);assert.equal(summary.packetBytes,600);assert.deepEqual(summary.perStream.map(s=>[s.packets,s.bytes]),[[2,200],[2,400]]);
 for(const mutate of [null,p=>{p[2].pts=-90000;p[2].pts_time='-1.000000';},p=>p.push({stream_index:0,size:'100',pts_time:'N/A',dts_time:'N/A'}),p=>{delete p[2].pts;},p=>{p[2].dts_time='NaN';},p=>{p[2].size='NaN';},p=>{p[2].stream_index=7;}]){
  const rows=structuredClone(packets);mutate?.(rows);let decoded=false,caught;
  const owner={run:async(command,args)=>{assert.equal(command,'ffprobe');assert(args.includes('json'));return Buffer.from(JSON.stringify({packets:rows}));}};
  try{await readQualificationRecording(owner,'injected',{settings:{videoPreset:'480p30',audioBitrateKbps:160},path:'program',frames:30,samples:48000},{probe:async()=>info,decodeQualifiedMediaMarkerRecord:async()=>{decoded=true;throw Error('decode_sentinel');}});}catch(e){caught=e;}
  assert.equal(decoded,mutate===null);assert.equal(caught.qualificationPrerequisite,mutate?'probe_complete':'decode_complete');
  assert.deepEqual(caught.qualificationCompleted,mutate?[]:['probe_complete','declared_format_valid']);
 }
});
