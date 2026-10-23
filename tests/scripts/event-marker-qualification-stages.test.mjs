import test from 'node:test';
import assert from 'node:assert/strict';
import { readQualificationRecording,applyDecodeStageFailure } from '../../scripts/marker-qualification/codec-record.mjs';
import { prerequisiteStates } from '../../scripts/marker-qualification/results.mjs';
test('successful probe followed by wrong format is typed format failure, never probe success fabrication',async()=>{
 let decoded=false;
 const io={probe:async()=>({streams:[],format:{format_name:'mpegts'}}),packetFacts:async()=>({}),decodeMediaMarkerRecord:async()=>{decoded=true;throw Error('unexpected');}};
 let error;try{await readQualificationRecording({},'synthetic',{settings:{videoPreset:'480p30',audioBitrateKbps:160},path:'program',frames:30,samples:48000},io);}catch(e){error=e;}
 const states=prerequisiteStates('not_run');assert.equal(applyDecodeStageFailure(states,error,'probe_complete'),'declared_format_valid');
 assert.equal(states.probe_complete,'pass');assert.equal(states.declared_format_valid,'fail');assert.equal(states.decode_complete,'not_run');assert.equal(decoded,false);
});
