import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourceAudio, SOURCE_FREQUENCIES } from '../../scripts/event-source-markers.mjs';
import { associateContext } from '../../scripts/event-marker-association.mjs';
import { packMarkerRecord, validateMarkerRecord } from '../../scripts/event-marker-evidence.mjs';
import { packAudioEpisode, packMarkerLeaf, unpackMarkerLeaf } from '../../scripts/event-marker-wire.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
import { sourceMarkerFixture } from '../fixtures/source-marker-literal.mjs';

// Complete source-only PCM scans. The prefix precedes all required contexts;
// every counter, predecessor and endpoint comes from the actual decoder.
function literalRecord(prefix) {
 const base=sourceMarkerFixture().markerEvidence,count=18*48000,pcm=Buffer.alloc(count*2),rows=[];
 prefix?.pcm.copy(pcm);
 for(let sample=62400;sample<17*48000;sample++){
  const identity=sample<9*48000?'a':'b',n=sample-(identity==='a'?62400:446400),phase=((n%48000)+48000)%48000;
  if(n>=0&&phase<4800)pcm.writeInt16LE(Math.round(.65*Math.sin(2*Math.PI*SOURCE_FREQUENCIES[identity]*phase/48000)*32768),sample*2);
 }
 if(prefix)rows.push(...prefix.rows);
 for(let at=prefix?.pcm.length/2||0;at<count;at+=1024)rows.push({index:rows.length,pts:at,samples:Math.min(1024,count-at)});
 const record={...decodeSourceAudio([pcm],rows),recordingSha256:base.recordingSha256,audioStreamIndex:1,videoStreamIndex:0,
  videoRange:base.videoRange,videoFrames:base.videoFrames,identityEpochs:base.identityEpochs,
  visuals:base.visuals.map(([id,start,end,identity,watermark])=>({id,start,end,identity:identity===1?'a':'b',watermark})),
  watermarks:base.watermarks.map(([selectionTick,selectionVideoPts,selectionSourcePts,firstPulseTick,firstPulseSourcePts,carryIn,identity])=>({selectionTick,selectionVideoPts,selectionSourcePts,firstPulseTick,firstPulseSourcePts,carryIn,identity:identity===1?'a':'b'}))};
 record.episodes.forEach((e,id)=>e.id=id);
 record.contexts=base.contexts.map(c=>associateContext(record,{kind:c[0]===0?'transition':'steady',identity:c[1]===1?'a':'b',selection:c[2],start:c[3],end:c[4],fullVisualIds:c[5].map(p=>p[0])}));
 assert(record.contexts.every(c=>c.valid));
 return record;
}
const changedLeaf=(record,index,change)=>{
 const next=structuredClone(record),leaf=unpackMarkerLeaf('episode',next.episodes[index]);change(leaf);next.episodes[index]=packMarkerLeaf('episode',leaf);return next;
};

test('literal record round trips all three predecessors through the shared 185-byte episode wire',()=>{
 for(const prefix of [undefined,literalPcm({family:'pure',source:'a'},{onset:0}),literalPcm({family:'pure',source:'a'},{onset:960,rowSamples:481})]){
  const raw=literalRecord(prefix),packed=packMarkerRecord(raw);
  assert.equal(packed.episodeEncoding,'marker-wire-v2');
  assert.deepEqual(packed.episodes,raw.episodes.map(packAudioEpisode));
  assert(packed.episodes.every(e=>Buffer.from(e,'base64').length===185&&Buffer.byteLength(JSON.stringify(e))+1<=256));
  assert.equal(validateMarkerRecord(JSON.parse(JSON.stringify(packed))).valid,true);
  const expected=[0,0];for(const e of raw.episodes)for(const [i,f] of e.fits.entries())if(f.code===0){expected[i]+=e.end-e.onset-47;if(f.guard.code===2)expected[i]+=e.end-e.onset+e.prelude.count-47;}
  assert.deepEqual(packed.residualWindowCounts,expected);
  assert(raw.episodes.some(e=>e.prelude.kind===(prefix?.rows[0].samples===481?'PriorClosure':prefix?'FileOrigin':'UnclaimedQuiet')));
 }
});

test('packed guard veto and independent prelude endpoint guard and scan mutations survive serialization',()=>{
 const raw=literalRecord(literalPcm({family:'foreign_literal',source:'a',placement:'prefix',durationMs:1,phase:1,foreignPhase:5},{onset:928})),packed=packMarkerRecord(raw),e=raw.episodes[0];
 assert.equal(e.identity,'unknown');assert(e.fits[0].maxResidual<=.14&&e.fits[0].guard.maxResidual>.14);
 assert.equal(validateMarkerRecord(packed).valid,true);
 for(const [name,change] of [
  ['prelude owner',l=>l['prelude.owner']=0],['prelude count',l=>l['prelude.count']++],
  ['prelude offset',l=>l['prelude.offset']++],['raw endpoint',l=>l['closureRight.raw']++],
  ['ordinal endpoint',l=>l['firstLoudLeft.ordinal']++],['endpoint row',l=>l['closureRight.row']=0],
  ['guard code',l=>l['a.guardCode']=0],['guard location',l=>l['a.guardMaxAt']=-481],
  ['guard opening',l=>l['a.guardOpening']=-481],['guard residual',l=>l['a.guardResidual']=-1],
  ['source veto',l=>{l.class=1;l.reason=0;}],
 ])assert.throws(()=>validateMarkerRecord(changedLeaf(packed,0,change)),/marker_(episode|prelude|fit|source|rejected)/,name);
 for(const delta of [-1,1]){const bad=structuredClone(packed);bad.residualWindowCounts[0]+=delta;assert.throws(()=>validateMarkerRecord(bad),/marker_record_conservation/);}
 const adjacent=packMarkerRecord(literalRecord(literalPcm({family:'pure',source:'a'},{onset:960,rowSamples:481})));
 const index=adjacent.episodes.findIndex(s=>unpackMarkerLeaf('episode',s)['prelude.kind']===2);
 assert(index>0);assert.throws(()=>validateMarkerRecord(changedLeaf(adjacent,index,l=>l['prelude.owner']=-1)),/marker_prelude/);
});
