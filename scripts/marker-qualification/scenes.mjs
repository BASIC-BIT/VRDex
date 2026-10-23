import { SOURCE_FREQUENCIES } from '../event-source-markers.mjs';
import { associationPlan } from './authority.mjs';
const checked=n=>{if(!Number.isSafeInteger(n))throw Error('qualification_coordinate');return n;};
const coordinate=(text,S,F)=>{
 if(typeof text==='number')return checked(text);
 const m=/^(S_audio|F_audio)(?:([+-])(\d+))?$/.exec(text);
 if(!m)throw Error('qualification_coordinate');
 return checked((m[1]==='S_audio'?S:F)+(m[2]==='-'?-1:1)*Number(m[3]??0));
};
/** Compile the frozen operations into exact source sample/frame coordinates.
 * No decoded audio or expected classifier outcome influences these inputs. */
export function compileScene(name,sourceOrder) {
 const scene=associationPlan.scenes.find(s=>s.id===name);
 if(!scene||!Array.isArray(sourceOrder)||sourceOrder.length!==2||new Set(sourceOrder).size!==2||sourceOrder.some(s=>!['a','b'].includes(s)))throw Error('qualification_scene');
 const g=scene.geometry??{},first=sourceOrder[0],selected=name==='same_source_cut_resume'?first:sourceOrder[1];
 const selectionTick=g.resumeTick??g.selectionTick??150;
 const firstTicks=g.firstSourceFullTicks??[39,69,99,129],selectedTicks=g.selectedFullTicks??[159,189,219,249,279,309];
 const tones=[],S=selectionTick*1600,F=selectedTicks[0]*1600;
 const add=(tag,source,start,samples=4800)=>tones.push({tag,frequency:SOURCE_FREQUENCIES[source]??source,start:checked(start),samples:checked(samples)});
 firstTicks.forEach((tick,i)=>add('first-'+i,first,tick*1600+(g.selectedAudioFirstSample?240:0)));
 selectedTicks.forEach((tick,i)=>add('selected-'+i,selected,g.selectedAudioFirstSample!==undefined?g.selectedAudioFirstSample+i*48000:tick*1600));
 const firstSelected=()=>tones.find(t=>t.tag==='selected-0');
 const preceding=()=>tones.find(t=>t.tag==='first-'+(firstTicks.length-1));
 const carrier=op=>op.carrierHz??SOURCE_FREQUENCIES[op.carrier==='previous'?first:selected];
 const postDecode=[];
 for(const op of scene.operations) {
  if(op.op.startsWith('use_')||op.op==='no_carry_audio')continue;
  if(op.op.startsWith('post_decode_')){postDecode.push({...op});continue;}
  switch(op.op) {
   case 'shift_selected_audio':tones.filter(t=>t.tag.startsWith('selected-')).forEach(t=>t.start=checked(t.start+op.samples));break;
   case 'shift_first_selected_audio':firstSelected().start=checked(firstSelected().start+op.samples);break;
   case 'remove_first_selected_audio':tones.splice(tones.indexOf(firstSelected()),1);break;
   case 'replace_preceding_pulse_carrier':preceding().frequency=carrier(op);break;
   case 'add_equal_selected_tone_to_preceding_pulse':add('added-mixture',selected,preceding().start,preceding().samples);break;
   case 'replace_all_selected_audio_carriers':tones.filter(t=>t.tag.startsWith('selected-')).forEach(t=>t.frequency=carrier(op));break;
   case 'replace_first_selected_audio_carrier':firstSelected().frequency=carrier(op);break;
   case 'replace_all_carriers':tones.forEach(t=>t.frequency=carrier(op));break;
   case 'add_tone':add('added-'+tones.length,carrier(op),coordinate(op.startSample??op.start,S,F),op.samples);break;
   default:throw Error('qualification_operation');
  }
 }
 const sourceFlash=(source,tick)=>{
  const full=[...(source===first?firstTicks:[]),...(source===selected?selectedTicks:[])];
  const carryStart=g.selectedCarrySourceOnsetTick??g.sourcePulseOnsetTick,carryEnd=g.carryVisualEndTick??(carryStart===undefined?undefined:carryStart+3);
  return full.some(start=>tick>=start&&tick<start+3)||(source===selected&&carryStart!==undefined&&tick>=carryStart&&tick<carryEnd);
 };
 const identityAt=tick=>tick<30||tick>=360||tick===(g.slateTick??-1)?'slate':tick<150?first:tick<selectionTick?'slate':selected;
 for(const tone of tones)if(tone.start<0||tone.start+tone.samples>13*48000||tone.samples<=0)throw Error('qualification_tone_extent');
 return {name,scene,first,selected,selectionTick,firstTicks,selectedTicks,tones,postDecode,frames:390,samples:624000,sourceFlash,identityAt};
}
/** Frozen YUV source/flash ROIs. Fresh canvas; no rawvideo file is written. */
export function markerFrame(width,height,identity,flash,slot=0) {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<4||height<4||width%2||height%2||!['a','b','slate'].includes(identity)||!Number.isSafeInteger(slot)||slot<0)throw Error('qualification_frame');
 const size=width*height,frame=Buffer.alloc(size*3/2,128);frame.fill(16,0,size);
 const rectangle=(left,right,values)=>{
  const x0=Math.floor(left*width/1920),x1=Math.floor(right*width/1920),y1=Math.floor(128*height/1080);
  for(let y=0;y<y1;y++)frame.fill(values[0],y*width+x0,y*width+x1);
  for(let y=0;y<Math.ceil(y1/2);y++)for(const [index,value] of values.slice(1).entries())frame.fill(value,size+index*size/4+y*width/2+Math.floor(x0/2),size+index*size/4+y*width/2+Math.ceil(x1/2));
 };
 rectangle(0,128,identity==='a'?[81,90,240]:identity==='b'?[41,240,110]:[16,128,128]);rectangle(128,256,flash?[235,128,128]:[16,128,128]);
 // Stable visible slot ordinal outside both independently sampled ROIs.
 for(let bit=0;bit<8;bit++)if(slot&(1<<bit))for(let y=height-8;y<height;y++)frame.fill(200,y*width+bit*8,y*width+bit*8+6);
 return frame;
}
