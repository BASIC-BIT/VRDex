import { TONE_DEFAULTS as D, TONE_CONSTRUCTION as T, LITERAL_DEFAULTS as L, LITERAL_NOISE } from './construction-data.mjs';
import { SOURCE_FREQUENCIES } from '../event-source-markers.mjs';
export const quantize=x=>Math.max(-32768,Math.min(32767,Math.round(x*32768)));
const opposite=source=>source==='a'?'b':'a';
/** Tone only. Codec trains add actual FFmpeg seeded anoisesrc separately. */
export function toneAt(relative,{family,source=D.source,phase=D.phase,foreignPhase=D.foreignPhase,placement=D.placement,durationMs=D.durationMs,jump=D.jump,ratio=D.ratio,loudSamples=D.loudSamples}) {
 const f=SOURCE_FREQUENCIES[source],other=SOURCE_FREQUENCIES[opposite(source)];
 const tone=(frequency,offset=phase)=>T.amplitude*Math.sin(2*Math.PI*frequency*relative/T.sampleRateHz+offset*Math.PI/4);
 if(family==='hidden105'||family==='hidden105_literal') {
  if(relative<0||relative>=T.hiddenSamples)return 0;
  return relative<T.hiddenForeignSamples?tone(other,foreignPhase):tone(f);
 }
 if(relative<0||relative>=loudSamples||family==='missing')return 0;
 if(family==='unknown1000'||family==='1000Hz')return tone(T.unknownFrequencyHz);
 if(family==='phasejump'||family==='phasejump_literal')return tone(f,phase+(relative>=T.phaseJumpAt?jump:0));
 if(family==='foreign'||family==='foreign_literal') {
  const count=durationMs*T.samplesPerMillisecond,start=placement==='prefix'?0:placement==='suffix'?T.foreignWindowSamples-count:T.foreignCenterSample-Math.floor(count/2);
  return tone(relative>=start&&relative<start+count?other:f,relative>=start&&relative<start+count?foreignPhase:phase);
 }
 const own=tone(f);
 if(['q30','q30offset','eq30','mixture_literal'].includes(family)&&relative>=placement&&relative<placement+T.mixtureSamples)return own+(family==='eq30'?T.equalMixtureRatio:ratio)*tone(other,foreignPhase);
 return own;
}
/** Literal qualification noise is explicit deterministic xorshift32, not the
 * FFmpeg noise used by encoded qualification. No raw waveform is logged. */
export function literalPcm(options,{onset=L.onset,tail=L.tail,rowSamples=L.rowSamples,noise=L.noise,pulseSamples}={}) {
 const length=pulseSamples??(options.family.startsWith('hidden105')?T.hiddenSamples:options.loudSamples??D.loudSamples),count=onset+length+tail;
 const pcm=Buffer.alloc(count*2);let state=noise==='none'?0:Number(noise);
 for(let i=0;i<count;i++) {
  let n=0;if(noise!=='none'){state^=state<<13;state^=state>>>17;state^=state<<5;n=((state>>>0)/4294967296*2-1)*LITERAL_NOISE.amplitude;}
  pcm.writeInt16LE(quantize(toneAt(i-onset,options)+n),i*2);
 }
 const rows=[];for(let at=0;at<count;at+=rowSamples)rows.push({index:rows.length,pts:at,samples:Math.min(rowSamples,count-at)});
 return {pcm,rows,actualToneStart:onset,actualToneEnd:onset+length};
}
/** Independent detector-only baseline with the frozen metadata-row block rule. */
export function literalOnsets(pcm,rows) {
 const result=[];let offset=0,loud=false;
 for(const row of rows){for(let at=0;at<row.samples;at+=480){const n=Math.min(480,row.samples-at);let energy=0;for(let i=0;i<n;i++)energy+=(pcm.readInt16LE(offset+(at+i)*2)/32768)**2;const on=Math.sqrt(energy/n)>.15;if(on&&!loud)result.push(row.pts+at);loud=on;}offset+=row.samples*2;}
 return result;
}
