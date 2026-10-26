import { plan } from './authority.mjs';
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
export { constructTrainPcm } from './train-construction.mjs';
