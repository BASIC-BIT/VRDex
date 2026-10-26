import { createHash } from 'node:crypto';
import { LatestMediaBuffer } from '../../workers/restream/input-supervisor.mjs';
import { observeSelectionMarkers } from '../event-capacity-media.mjs';
import { markerFrame } from './scenes.mjs';
import { quantize } from './signals.mjs';
export function constructScenePcm(scene,noise) {
 if(!Buffer.isBuffer(noise)||noise.length!==scene.samples*2)throw Error('qualification_scene_noise');
 const pcm=Buffer.alloc(scene.samples*4);
 for(let i=0;i<scene.samples;i++) {
  let value=noise.readInt16LE(i*2)/32768;
  for(const tone of scene.tones)if(i>=tone.start&&i<tone.start+tone.samples)value+=.65*Math.sin(2*Math.PI*tone.frequency*(i-tone.start)/48000);
  const q=quantize(value);pcm.writeInt16LE(q,i*4);pcm.writeInt16LE(q,i*4+2);
 }
 return pcm;
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Offline construction through the actual timestamp buffer and original
 * observer, with exact ordinal clocks. This does not exercise wall scheduling. */
export function* sceneFrames(scene,pcm,state) {
 if(pcm.length!==scene.samples*4)throw Error('qualification_scene_pcm');
 const quality={width:854,height:480,frameRate:30},buffers={};let tick=0,selected='slate';
 state.sourceFrames??={a:[],b:[]};
 for(const identity of ['a','b']) {
  const buffer=new LatestMediaBuffer(854*480*3/2);
  buffers[identity]=observeSelectionMarkers({buffer},{source:{sourceId:identity,revision:1},quality},()=>tick,state.selections).buffer;
 }
 for(;tick<scene.frames;tick++) {
  const segment=pcm.subarray(tick*6400,(tick+1)*6400);
  for(const identity of ['a','b']) {
   const b=buffers[identity];b.videoTimestamp(tick,tick*3000);b.video(markerFrame(854,480,identity,scene.sourceFlash(identity,tick),tick));
   b.audioTimestamp(tick,tick*1600,1600);b.audio(segment);
   if(b.timingFailed||b.framePts!==tick*3000||b.frameIndex!==tick)throw Error('qualification_source_buffer');
   let luma=0;for(let y=0;y<4;y++)for(let x=0;x<4;x++)luma+=b.frame[Math.floor((32+y*16)*480/1080)*854+Math.floor((160+x*16)*854/1920)];
   state.sourceFrames[identity].push({tick,pts:b.framePts,index:b.frameIndex,flash:luma/16>180,sha256:sha(b.frame)});
  }
  const identity=scene.identityAt(tick),b=buffers[identity];
  if(identity!==selected&&b)b.beginPlayback();selected=identity;
  const frame=b?b.frame:markerFrame(854,480,'slate',false,tick),audio=b?b.takeAudio(6400):Buffer.alloc(6400);
  state.audio.push(audio);state.frames.push({tick,pts:tick*3000,identity,flash:b?scene.sourceFlash(identity,tick):false,sha256:sha(frame),pcmSha256:sha(audio)});
  yield frame;
 }
}
/** A bounded PCM file plus small frame ledger replaces retaining390rawframes.
 * Replay verifies every regenerated frame against the actual selected bytes. */
export function prepareScene(scene,pcm) {
 const state={selections:[],frames:[],audio:[]};for(const _ of sceneFrames(scene,pcm,state)){}
 const submittedPcm=Buffer.concat(state.audio);delete state.audio;
 return {...state,pcm:submittedPcm,*replayFrames(){for(const row of state.frames){const frame=markerFrame(854,480,row.identity,row.flash,row.tick);if(sha(frame)!==row.sha256)throw Error('qualification_frame_replay');yield frame;}}};
}
