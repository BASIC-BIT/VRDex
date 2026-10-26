import { decodeSourceAudio, SOURCE_FREQUENCIES } from '../../scripts/event-source-markers.mjs';
import { decodeMarkerVisuals } from '../../scripts/event-marker-record.mjs';
import { buildMarkerContexts } from '../../scripts/event-marker-contexts.mjs';
import { packMarkerRecord } from '../../scripts/event-marker-evidence.mjs';
const cache=new Map();
/** Literal PCM/pixels only. These are synthetic validator inputs, never capacity evidence. */
export function sourceMarkerFixture({carryIn=false}={}) {
 if(cache.has(carryIn))return structuredClone(cache.get(carryIn));
 const count=18*48000,pcm=Buffer.alloc(count*2),audioRows=[],videoRows=[],rgb=Buffer.alloc(541*6);
 for(let sample=0;sample<count;sample++) {
  const identity=sample<9*48000?'a':'b',base=(identity==='a'?1:9)*48000+14400;
  const n=sample-base,phase=((n%48000)+48000)%48000;
  if(carryIn&&sample>=48000&&sample<52800)pcm.writeInt16LE(Math.round(.65*Math.sin(2*Math.PI*SOURCE_FREQUENCIES.a*(sample-48000)/48000)*32768),sample*2);
  if(n>=0&&phase<4800&&sample<17*48000&&!(carryIn&&sample<67200))pcm.writeInt16LE(Math.round(.65*Math.sin(2*Math.PI*SOURCE_FREQUENCIES[identity]*phase/48000)*32768),sample*2);
 }
 for(let sample=0;sample<count;sample+=1024)audioRows.push({index:audioRows.length,pts:sample,samples:Math.min(1024,count-sample)});
 for(let i=0;i<=540;i++) {
  videoRows.push({index:i,pts:i*3000});
  if(i>=30&&i<510)rgb[i*6+(i<270?0:2)]=255;
  if(carryIn&&i>=30&&i<33||i>=39&&i<510&&(i-39)%30<3&&!(carryIn&&i<42))rgb.fill(255,i*6+3,i*6+6);
 }
 const record={...decodeSourceAudio([pcm],audioRows),...decodeMarkerVisuals(rgb,videoRows),watermarks:[],recordingSha256:'a'.repeat(64),audioStreamIndex:1,videoStreamIndex:0};
 record.episodes.forEach((e,id)=>e.id=id);
 const selections=['a','b'].map((identity,index)=>({identity,revision:1,tick:30+240*index,fps:30,sourcePts:0,endTick:150+240*index,lastSourcePts:357000,carryIn:carryIn&&index===0,
  sourcePulses:[carryIn&&index===0?0:27000,117000,207000,297000],pulses:[0,1,2,3].map(n=>({tick:carryIn&&index===0&&n===0?30:39+240*index+30*n,sourcePts:carryIn&&index===0&&n===0?0:27000+90000*n}))}));
 const bound=buildMarkerContexts(record,{selections,windows:[{identity:'a',start:2,end:8},{identity:'b',start:10,end:16}]});
 record.contexts=bound.contexts;
 const pairs=bound.contexts.flatMap(c=>c.pairs);
 const cached={markerSchema:record.schema,markerEvidence:packMarkerRecord(record),transitionMarkers:bound.transitions,markerWindows:bound.measured,markerCount:pairs.length,avDriftMs:Math.max(...pairs.map(p=>Math.abs(p.offsetNumerator/720)))};
 cache.set(carryIn,cached);return structuredClone(cached);
}
