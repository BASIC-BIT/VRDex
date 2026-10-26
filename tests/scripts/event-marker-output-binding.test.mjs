import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutputFacts } from '../../scripts/event-capacity-contracts.mjs';
const legacy=()=>({videoCodec:'h264',width:854,height:480,fps:30,pixelFormat:'yuv420p',audioCodec:'aac',channels:2,sampleRate:48000,audioKbps:160,maxGop:1,maxGap:.03,monotonic:true,
 identities:['a','b','slate'],avDriftMs:20,visualPsnrDb:35,markerCount:6,internalDelayMs:100,
 transitionMarkers:['a','b'].map(identity=>({identity,complete:true,programTick:30,sourcePts:90000,start:1,end:5,pairs:[1,2,3].map(v=>({videoPts:v,audioPts:v+.02,audioMinusVideoMs:20}))}))});
test('output admission rejects legacy unclassified timing receipts',()=>{
 assert.throws(()=>validateOutputFacts(legacy(),{videoPreset:'480p30',audioBitrateKbps:160},'vrcdn'),/marker_/);
});
