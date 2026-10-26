import { createHash } from 'node:crypto';
import { markerFrame } from './marker-frame.mjs';
export function sourceBaseline(pcm,rate,channels) {
 if(!Buffer.isBuffer(pcm)||![44100,48000].includes(rate)||![1,2].includes(channels)||pcm.length===0||pcm.length%(channels*2))throw Error('source_failure');
 const minimum=Array(channels).fill(32767),maximum=Array(channels).fill(-32768),energy=Array(channels).fill(0),clips=Array(channels).fill(0),samplesPerChannel=Array(channels).fill(0);
 for(let i=0;i<pcm.length/2;i++){const c=i%channels,v=pcm.readInt16LE(i*2);minimum[c]=Math.min(minimum[c],v);maximum[c]=Math.max(maximum[c],v);energy[c]+=v*v;samplesPerChannel[c]++;if(v===-32768||v===32767)clips[c]++;}
 return {rate,channels,samplesPerChannel,minimum,maximum,energy,clips,bytes:pcm.length,sha256:createHash('sha256').update(pcm).digest('hex')};
}
export function stereoMono(pcm) {
 if(!Buffer.isBuffer(pcm)||pcm.length%4)throw Error('source_failure');
 const mono=Buffer.alloc(pcm.length/2);
 for(let i=0;i<mono.length;i+=2)mono.writeInt16LE(Math.floor((pcm.readInt16LE(i*2)+pcm.readInt16LE(i*2+2))/2),i);
 return mono;
}
export function* massFrames(train) {
 for(let tick=0;tick<train.frames;tick++) {
  const slot=train.slots.find(s=>tick*1600>=s.start&&tick*1600<s.end),identity=slot?(slot.params.source??'a'):'slate';
  yield markerFrame(854,480,identity,!!slot&&tick>=slot.visualFrame&&tick<slot.visualFrame+3,slot?.index??0);
 }
}
