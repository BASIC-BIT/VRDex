import test from 'node:test';
import assert from 'node:assert/strict';
import { associateContext } from '../../scripts/event-marker-association.mjs';
const visual=(id,time,identity='b')=>({id,start:Math.round(time*90000),end:Math.round((time+.1)*90000),identity,watermark:-1});
const episode=(id,time,identity='b',duration=.11)=>({id,onset:Math.round(time*48000),end:Math.round((time+duration)*48000),identity});
function data(){return {visuals:[0,1,2,3].map(i=>visual(i,5.3+i)),episodes:[0,1,2,3].map(i=>episode(i,5.3+i)),watermarks:[],audioRange:[0,15*48000],videoRange:[0,15*90000],identityEpochs:[[0,4],[90000,1],[450000,2]]};}
const context={kind:'transition',identity:'b',previousIdentity:'a',start:450000,end:810000,selection:450000,fullVisualIds:[0,1,2,3]};
test('source association preserves classified prior tail without selecting nearest',()=>{
  const r=data();r.episodes.unshift(episode(4,4.98,'a',.09));
  const x=associateContext(r,context);assert.equal(x.valid,true);assert.equal(x.pairs.length,4);
  assert(x.dispositions.some(r=>r.code==='previous_epoch_tail'&&r.episodeId===4));
});
test('source association keeps same-source competitors outside acceptance gate',()=>{
  const r=data();r.episodes.push(episode(4,5.5));
  const x=associateContext(r,context);assert.equal(x.valid,false);assert(x.failures.includes('duplicate_source_candidate'));
});
test('source association does not hide a foreign tail or unknown behind pre-epoch onset',()=>{
  for(const identity of ['a','unknown']) {const r=data();r.episodes.unshift(episode(4,4.4,identity,.8));const x=associateContext(r,context);assert.equal(x.valid,false);assert.equal(x.dispositions.length,5);}
});
test('source association keeps the entire half-period fence across a steady edge',()=>{
  const r=data();r.episodes.push(episode(4,5.0));
  const x=associateContext(r,{...context,kind:'steady',start:454500,end:994500});
  assert.equal(x.valid,false);assert(x.failures.includes('duplicate_source_candidate'));
});
test('source association has no future-epoch exception in previous full fence',()=>{
  const r=data();r.visuals=[{...visual(0,4.966666666666667,'a'),end:450000}];r.episodes=[episode(0,4.971666666666667,'a'),episode(1,5.132333333333333,'b')];
  const x=associateContext(r,{...context,identity:'a',previousIdentity:'slate',start:90000,end:450000,selection:90000,fullVisualIds:[0]});
  assert(x.failures.includes('foreign_interval'));assert.equal(x.dispositions.length,2);
});
test('source association enforces exact integer AV limits without rounding',()=>{
  for(const delta of [4799,4800,4801,-4799,-4800,-4801]) {const r=data();r.episodes[0].onset+=delta;r.episodes[0].end+=delta;const x=associateContext(r,context);assert.equal(x.valid,Math.abs(delta)<=4800);}
});
test('source association rejects missing duplicate and inconsistent immutable references',()=>{
  const r=data();assert.throws(()=>associateContext(r,{...context,fullVisualIds:[0,0,2,3]}),/marker_visual_reference/);
  r.visuals.push({...r.visuals[0]});assert.throws(()=>associateContext(r,context),/marker_visual_reference/);
});
test('source association records actual carry-in or explicit absent audio without consuming full pulses',()=>{
  for(const present of [false,true]) {
    const r=data();r.visuals.unshift({id:4,start:450000,end:456000,identity:'b',watermark:0});
    r.watermarks=[{identity:'b',selectionTick:150,selectionVideoPts:450000,selectionSourcePts:900000,firstPulseTick:150,firstPulseSourcePts:900000,carryIn:true}];
    // Move the first full pulse away from the actual fragment's half-period fence.
    for(const v of r.visuals) if(v.id!==4){v.start+=60000;v.end+=60000;}
    for(const e of r.episodes){e.onset+=32000;e.end+=32000;}
    if(present)r.episodes.push(episode(4,5.0,'b',.07));
    const x=associateContext(r,{...context,carryVisualId:4});assert.equal(x.valid,true);
    assert.deepEqual(x.carryIn,{visualId:4,episodeId:present?4:null});assert.equal(x.pairs.length,4);
  }
});
test('source association rejects unknown carry-in and inconsistent source watermark',()=>{
  const r=data();r.visuals.unshift({id:4,start:450000,end:456000,identity:'b',watermark:0});
  r.watermarks=[{identity:'b',selectionTick:150,selectionVideoPts:450000,selectionSourcePts:900000,firstPulseTick:150,firstPulseSourcePts:900001,carryIn:true}];
  assert.throws(()=>associateContext(r,{...context,carryVisualId:4}),/marker_carry_reference/);
  r.watermarks[0].firstPulseSourcePts=900000;r.episodes.push(episode(4,5.0,'unknown',.07));
  assert.equal(associateContext(r,{...context,carryVisualId:4}).valid,false);
});
test('source association rejects a missing full pulse even when the next cycle exists',()=>{
  const r=data();r.episodes.shift();assert(associateContext(r,context).failures.includes('missing_audio'));
});
test('source association cannot accept a claimed predecessor contradicting encoded epochs',()=>{
  assert.throws(()=>associateContext(data(),{...context,previousIdentity:'b'}),/marker_identity_predecessor/);
  const r=data();delete r.identityEpochs;assert.throws(()=>associateContext(r,context),/marker_identity_missing/);
});
