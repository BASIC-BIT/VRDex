import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMarkerVisuals, validateIdentityEpochs, precedingIdentityAt } from '../../scripts/event-marker-record.mjs';
function record(){return {videoRange:[0,900000],identityEpochs:[[0,4],[90000,1],[270000,4],[360000,1]],visuals:[{id:0,start:390000,end:399000,identity:'a',watermark:0}],watermarks:[{identity:'a',selectionVideoPts:360000}]};}
test('identity epochs preserve slate before same-source resume',()=>{
  const r=record();validateIdentityEpochs(r);assert.equal(precedingIdentityAt(r,360000),'slate');assert.equal(precedingIdentityAt(r,90000),'slate');
});
test('identity epochs reject missing forged duplicate redundant or unbound rows',()=>{
  for(const change of [r=>delete r.identityEpochs,r=>r.identityEpochs[0][0]++,r=>r.identityEpochs[2][0]=90000,r=>r.identityEpochs[2][1]=1,r=>r.identityEpochs[3][1]=2,r=>r.watermarks[0].identity='b',r=>r.videoRange[1]=350000,r=>r.watermarks[0].selectionVideoPts=90000,r=>r.visuals[0].watermark=1]) {
    const r=record();change(r);assert.throws(()=>validateIdentityEpochs(r),/marker_identity/);
  }
});
test('identity epochs enforce exact selection boundary and 32 row cap',()=>{
  const r=record();assert.throws(()=>precedingIdentityAt(r,360001),/marker_identity_selection/);
  const bounded={videoRange:[0,100000],identityEpochs:Array.from({length:32},(_,i)=>[i*1000,i%2?1:4]),visuals:[],watermarks:[]};
  validateIdentityEpochs(bounded);bounded.identityEpochs.push([32000,4]);assert.throws(()=>validateIdentityEpochs(bounded),/marker_identity_bound/);
});
test('visual records retain every actual integer identity and closed flash span',()=>{
  const rgb=Buffer.from([0,0,0,0,0,0,255,0,0,255,255,255,255,0,0,0,0,0,0,0,0,0,0,0]);
  const r=decodeMarkerVisuals(rgb,[0,3000,6000,9000].map((pts,index)=>({index,pts})));
  assert.deepEqual(r.identityEpochs,[[0,4],[3000,1],[9000,4]]);assert.deepEqual(r.videoRange,[0,9000]);assert.equal(r.visuals[0].start,3000);assert.equal(r.visuals[0].end,6000);
  assert.throws(()=>decodeMarkerVisuals(rgb.subarray(0,12),[{index:0,pts:0},{index:1,pts:3000}]),/marker_visual_unmatched_eof/);
});
