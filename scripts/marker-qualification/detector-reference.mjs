import { createMinimumEpisodeVectors, MINIMUM_OBSERVATION_RULES as R } from './detector-expectations.mjs';
import { assertAudioClock, audioEpisodeRawRange } from '../event-marker-clock.mjs';
/** Independent integer-energy detector oracle, never calls the classifier.
 * The 0.15 RMS comparison is 400*sum(s16^2) > 9*32768^2*count. */
export function referenceDetector(pcm,rows,clock) {
 if(!Buffer.isBuffer(pcm)||!Array.isArray(rows)||pcm.length%2)throw Error('reference_payload');
 if(clock!==undefined)assertAudioClock(clock,[pcm],rows);
 const origin=rows[0]?.pts;if(!Number.isSafeInteger(origin))throw Error('reference_metadata');
 const blocks=[],episodes=[];let cursor=0,active;
 for(let rowIndex=0;rowIndex<rows.length;rowIndex++) {
  const row=rows[rowIndex];
  if(row.index!==rowIndex||!Number.isSafeInteger(row.pts)||!Number.isSafeInteger(row.samples)||row.samples<=0||clock===undefined&&row.pts!==origin+cursor)throw Error('reference_metadata');
  for(let at=0;at<row.samples;at+=480) {
   const count=Math.min(480,row.samples-at),start=row.pts+at;let energy=0;
   for(let i=0;i<count;i++){if((cursor+at+i)*2+2>pcm.length)throw Error('reference_bytes');const value=pcm.readInt16LE((cursor+at+i)*2);energy+=value*value;}
   const loud=400*energy>9*32768*32768*count;
   blocks.push([rowIndex,start,count,loud]);
   if(loud&&!active)active={onset:start,loudEnd:start+count,firstRow:rowIndex};
   if(active) {
    if(loud)active.loudEnd=start+count;
    else {episodes.push([active.onset,active.loudEnd,start+count,active.firstRow,rowIndex-active.firstRow+1]);active=undefined;}
   }
  }
  cursor+=row.samples;
 }
 if(active)throw Error('reference_unclosed');
 if(cursor*2!==pcm.length||blocks.reduce((n,r)=>n+r[2],0)!==cursor)throw Error('reference_conservation');
 return {samples:cursor,bytes:pcm.length,metadataRows:rows.length,detectorBlocks:blocks.length,blocks,episodes};
}
export function validateShortTailObservation(expected,reference,actual) {
 const fail=()=>{throw Error('literal_short_tail_contract');};
 for(const [key,value] of [['samples',actual.metadataSamples],['bytes',actual.decodedBytes],['detectorBlocks',actual.detectorBlockCount]])if(expected[key]!==value||reference[key]!==value)fail();
 if(reference.metadataRows!==expected.metadataRows||reference.blocks.length!==expected.detectorBlocks||reference.blocks.reduce((n,r)=>n+r[2],0)!==expected.samples)fail();
 const ranges=expected.episodes.map(e=>e.slice(0,5));
 if(JSON.stringify(reference.episodes)!==JSON.stringify(ranges))fail();
 let vector;try{vector=actual.episodes.map(e=>[...audioEpisodeRawRange(e),e.identity,e.reason]);}catch{fail();}
 if(JSON.stringify(vector)!==JSON.stringify(expected.episodes))fail();
 // Recheck every observed positive against the unchanged classification gates.
 for(const e of actual.episodes)if(['a','b'].includes(e.identity)) {
  const i=e.identity==='a'?0:1,f=e.fits[i];
  if(e.loudEnd<1440||f.code!==0||f.maxResidual>.14||f.score<.6||e.fits[1-i].score>=.05||e.local.firstPair!==-1)fail();
 }
 return vector;
}
/** The phase-zero one-sample tail at1440 is exactly zero for700/1300Hz.
 * Nominal tone length and measured loud length are separate facts. */
export function validateMinimumObservation(nominal,reference,actual) {
 const fixed=createMinimumEpisodeVectors(),expected=fixed[nominal];
 const fail=()=>{throw Error('literal_minimum_contract');};
 if(!expected||JSON.stringify(reference.episodes)!==JSON.stringify([expected]))fail();
 const blockCount=nominal===R.tailNominal?R.tailBlocks:R.ordinaryBlocks;
 if(reference.samples!==nominal+R.quietSamples||reference.bytes!==(nominal+R.quietSamples)*2||reference.metadataRows!==R.metadataRows||reference.detectorBlocks!==blockCount||reference.blocks.length!==blockCount||reference.blocks.reduce((n,b)=>n+b[2],0)!==nominal+R.quietSamples)fail();
 if(actual.metadataSamples!==reference.samples||actual.decodedBytes!==reference.bytes||actual.detectorBlockCount!==blockCount||actual.episodes.length!==1)fail();
 const e=actual.episodes[0];let vector;try{vector=audioEpisodeRawRange(e);}catch{fail();}
 if(JSON.stringify(vector)!==JSON.stringify(expected)||(e.reason==='insufficient_samples')!==(nominal===R.insufficientNominal))fail();
 return {nominalToneSamples:nominal,measuredLoudSamples:expected[1],quietGuardStart:expected[1],quietGuardEnd:expected[2],samples:reference.samples,bytes:reference.bytes,rows:R.metadataRows,blocks:blockCount};
}
