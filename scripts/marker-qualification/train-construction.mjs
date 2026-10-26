import { NATIVE_NOISE, TRAIN_CONSTRUCTION } from './construction-data.mjs';
import { toneAt,quantize } from './signals.mjs';
/** Add the generated carrier to actual seeded noise bytes, preserving clipping.
 * The caller supplies FFmpeg anoisesrc results; encoded cases never call the
 * literal PRNG. Both channels use the declared slot seed from the frozen plan. */
export function constructTrainPcm(train,noiseBySeed) {
 const channels=train.sourceRate===44100?1:2,count=Math.round(train.samples*train.sourceRate/48000),pcm=Buffer.alloc(count*channels*2);
 for(const seed of NATIVE_NOISE.seeds)if(!(noiseBySeed[seed] instanceof Uint8Array)||noiseBySeed[seed].length!==count*2)throw Error('qualification_noise_extent');
 const noiseViews=Object.fromEntries(NATIVE_NOISE.seeds.map(seed=>[seed,Buffer.from(noiseBySeed[seed].buffer,noiseBySeed[seed].byteOffset,noiseBySeed[seed].byteLength)]));
 const tones=train.slots.map(slot=>({family:slot.family,...slot.params}));
 let slotIndex=0;
 for(let i=0;i<count;i++) {
  const sample48=i*48000/train.sourceRate;
  while(slotIndex+1<train.slots.length&&sample48>=train.slots[slotIndex].end)slotIndex++;
  const slot=train.slots[slotIndex],inSlot=sample48>=slot.start&&sample48<slot.end;
  const seed=inSlot?slot.params.seed:TRAIN_CONSTRUCTION.gapSeed,noise=noiseViews[seed].readInt16LE(i*2)/32768;
  const relative=(i-slot.sourceStart)*48000/train.sourceRate;
  const tone=inSlot?toneAt(relative,tones[slotIndex]):0;
  const value=quantize((inSlot&&slot.family==='missing'&&slot.params.kind==='silence'?0:noise)+tone);
  for(let ch=0;ch<channels;ch++)pcm.writeInt16LE(value,(i*channels+ch)*2);
 }
 if(pcm.length>(channels===1?2097152:5242880))throw Error('qualification_source_byte_cap');
 return pcm;
}
