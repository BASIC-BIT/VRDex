import { plan } from './authority.mjs';
import { toneAt, quantize } from './signals.mjs';
const safe=n=>{if(!Number.isSafeInteger(n))throw Error('qualification_train_integer');return n;};
/** Input construction only; never labels a decoded output episode. */
export function compileTrain(invocation) {
 if(invocation.kind!=='mass'||invocation.rows.length<1||invocation.rows.length>128)throw Error('qualification_train');
 const slots=[];let offset=48000;
 for(let i=0;i<invocation.rows.length;i+=2){
  const a=invocation.rows[i],b=invocation.rows[i+1];
  if(!b||a.params.path!=='program'||b.params.path!=='program_twitch'||a.id.slice(0,a.id.lastIndexOf(','))!==b.id.slice(0,b.id.lastIndexOf(',')))throw Error('qualification_physical_pair');
  const family=a.id.split('/')[0],f=plan.families.find(f=>f.id===family);
  if(!f)throw Error('qualification_train_family');
  const params={phase:f.phase??0,foreignPhase:f.foreignPhase??0,offset:f.offset??0,...a.params};
  const length=family==='missing'?57600:14400;
  const visualSample=offset+(family==='missing'?28800:family==='hidden105'?0:2400+(params.offset??0));
  const toneStart=offset+(family==='hidden105'?4560:2400+(params.offset??0));
  const sourceRate=family==='resample44100mono'?44100:48000;
  const sourceStart=sourceRate===44100?Math.round(toneStart*44100/48000):toneStart;
  slots.push({index:slots.length,family,params,rows:[a,b],start:offset,end:offset+length,toneStart,sourceStart,sourceRate,visualFrame:Math.floor(visualSample/1600)});
  offset+=length;
 }
 const samples=safe(offset+48000);
 if(samples!==invocation.sourceSamples||samples>1190400||slots.length!==invocation.physicalCount||slots.length>64)throw Error('qualification_train_extent');
 if(new Set(slots.map(s=>s.sourceRate)).size!==1)throw Error('qualification_train_rate');
 return {slots,samples,frames:Math.ceil(samples/1600),sourceRate:slots[0].sourceRate};
}
/** Add the generated carrier to actual seeded noise bytes, preserving clipping.
 * The caller supplies FFmpeg anoisesrc results; encoded cases never call the
 * literal PRNG. Both channels use the declared slot seed from the frozen plan. */
export function constructTrainPcm(train,noiseBySeed) {
 const channels=train.sourceRate===44100?1:2,count=Math.round(train.samples*train.sourceRate/48000),pcm=Buffer.alloc(count*channels*2);
 for(const seed of [42,43])if(!(noiseBySeed[seed] instanceof Uint8Array)||noiseBySeed[seed].length!==count*2)throw Error('qualification_noise_extent');
 const noiseViews=Object.fromEntries([42,43].map(seed=>[seed,Buffer.from(noiseBySeed[seed].buffer,noiseBySeed[seed].byteOffset,noiseBySeed[seed].byteLength)]));
 const tones=train.slots.map(slot=>({family:slot.family,...slot.params}));
 let slotIndex=0;
 for(let i=0;i<count;i++) {
  const sample48=i*48000/train.sourceRate;
  while(slotIndex+1<train.slots.length&&sample48>=train.slots[slotIndex].end)slotIndex++;
  const slot=train.slots[slotIndex],inSlot=sample48>=slot.start&&sample48<slot.end;
  const seed=inSlot?slot.params.seed:42,noise=noiseViews[seed].readInt16LE(i*2)/32768;
  const relative=(i-slot.sourceStart)*48000/train.sourceRate;
  const tone=inSlot?toneAt(relative,tones[slotIndex]):0;
  const value=quantize((inSlot&&slot.family==='missing'&&slot.params.kind==='silence'?0:noise)+tone);
  for(let ch=0;ch<channels;ch++)pcm.writeInt16LE(value,(i*channels+ch)*2);
 }
 if(pcm.length>(channels===1?2097152:5242880))throw Error('qualification_source_byte_cap');
 return pcm;
}
