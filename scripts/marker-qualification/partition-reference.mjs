/** Independent raw detector/ownership replay. This module imports no production
 * classifier, clock certificate factory or wire producer. Raw partitions alone
 * do not establish timestamp compatibility or encoded count conservation. */
export function replayAudioPartition(pcm,rows) {
 if(!Buffer.isBuffer(pcm)||pcm.length%2||!Array.isArray(rows)||!rows.length)throw Error('reference_payload');
 let cursor=0,blockCount=0,active,previous,previousPts;
 const episodes=[];
 for(const [index,row] of rows.entries()) {
  if(row.index!==index||!Number.isSafeInteger(row.pts)||!Number.isSafeInteger(row.samples)||row.samples<=0||(previousPts!==undefined&&row.pts<=previousPts)||!Number.isSafeInteger(row.pts+row.samples)||!Number.isSafeInteger(cursor+row.samples))throw Error('reference_metadata');
  previousPts=row.pts;
  if((cursor+row.samples)*2>pcm.length)throw Error('reference_bytes');
  const endpoint=(inRow,side)=>({ordinal:cursor+inRow,row:index,inRow,raw:row.pts+inRow,side});
  for(let offset=0;offset<row.samples;offset+=480) {
   const count=Math.min(480,row.samples-offset);let energy=0;
   for(let i=0;i<count;i++){const n=pcm.readInt16LE(2*(cursor+offset+i));energy+=n*n;}
   const loud=400*energy>9*32768*32768*count;blockCount++;
   if(loud&&!active)active={firstLoudLeft:endpoint(offset,'left'),firstEnd:count,lastStart:0,prelude:previous?{...previous}:{kind:'FileOrigin',row:0,offset:0,count:0,owner:-1}};
   if(active) {
    if(loud){active.lastLoudRight=endpoint(offset+count,'right');active.lastStart=cursor+offset-active.firstLoudLeft.ordinal;}
    else {
     episodes.push({...active,closureRight:endpoint(offset+count,'right')});
     previous={kind:'PriorClosure',row:index,offset,count,owner:episodes.length-1};active=undefined;
    }
   }else previous={kind:'UnclaimedQuiet',row:index,offset,count,owner:-1};
  }
  cursor+=row.samples;
 }
 if(active)throw Error('reference_unclosed');if(cursor*2!==pcm.length)throw Error('reference_conservation');
 return {samples:cursor,bytes:pcm.length,rowCount:rows.length,blockCount,episodes};
}
/** Independent guard arithmetic under supplied core fit coefficients. Full
 * replay must independently verify those core fits before using this result. */
export function replayPreludeGuard(pcm,episode,fit,frequency) {
 const g=episode.prelude.kind==='UnclaimedQuiet'?episode.prelude.count:0;
 if(!g)return {code:0,openingGate:null,maxResidual:null,maxResidualAt:null};
 if(fit.code!==0)return {code:1,openingGate:null,maxResidual:null,maxResidualAt:null};
 if(![700,1300].includes(frequency)||!Number.isSafeInteger(g)||g<1||g>480||!fit.coefficients?.every(Number.isFinite))throw Error('reference_fit');
 const start=episode.firstLoudLeft.ordinal,length=episode.closureRight.ordinal-start;
 if(start<g||length>12000||episode.closureRight.ordinal*2>pcm.length)throw Error('reference_guard');
 const sin=Array.from({length:480},(_,i)=>Math.sin(2*Math.PI*frequency*i/48000)),cos=Array.from({length:480},(_,i)=>Math.cos(2*Math.PI*frequency*i/48000));
 const [dc,sn,cs]=fit.coefficients,model=i=>{const phase=((i%480)+480)%480;return dc+sn*sin[phase]+cs*cos[phase];},value=i=>pcm.readInt16LE(2*(start+i))/32768;
 let cost=0;
 for(let i=-g;i<episode.firstEnd;i++)cost+=(value(i)-model(i))**2;
 let minimum=cost,openingGate=-g;
 for(let i=-g;i<episode.firstEnd;i++){cost+=(value(i)-dc)**2-(value(i)-model(i))**2;if(cost<minimum){minimum=cost;openingGate=i+1;}}
 const ring=Array(48).fill(0);let sum=0,maximum=-1,maxResidualAt=-g;
 for(let i=-g;i<length;i++) {
  const residual=(value(i)-(i>=openingGate&&i<fit.closingGate?model(i):dc))**2,index=(i+g)%48;
  sum+=residual-ring[index];ring[index]=residual;
  if(i+g>=47&&sum>maximum){maximum=sum;maxResidualAt=i-47;}
 }
 const maxResidual=Math.sqrt(Math.max(0,maximum)/48);
 if(![minimum,maximum,maxResidual].every(Number.isFinite))throw Error('reference_arithmetic');
 return {code:2,openingGate,maxResidual,maxResidualAt};
}

const waves=[700,1300].map(f=>({sin:Array.from({length:480},(_,i)=>Math.sin(2*Math.PI*f*i/48000)),cos:Array.from({length:480},(_,i)=>Math.cos(2*Math.PI*f*i/48000))}));
const finite=n=>{if(!Number.isFinite(n))throw Error('reference_arithmetic');return n;};
function replayCore(value,length,loud,first,last,wave,charge) {
 let sx=0,sxx=0,ss=0,sc=0,xs=0,xc=0;
 for(let i=0;i<loud;i++){const x=value(i),s=wave.sin[i%480],c=wave.cos[i%480];sx+=x;sxx+=x*x;ss+=s;sc+=c;xs+=x*s;xc+=x*c;}
 const energy=sxx-sx*sx/loud,score=energy>0?finite(2*((xs-sx*ss/loud)**2+(xc-sx*sc/loud)**2)/(loud*energy)):0;
 const invalid=code=>({score,openingGate:null,closingGate:null,maxResidual:null,maxResidualAt:null,code,condition:null,coefficients:null});
 const n=last-first;if(n<=0)return invalid(1);
 const m=Array(24).fill(0);
 for(let i=first;i<last;i++){const x=value(i),s=wave.sin[i%480],c=wave.cos[i%480];m[0]++;m[1]+=s;m[2]+=c;m[4]+=s*s;m[5]+=s*c;m[8]+=c*c;m[18]+=x;m[19]+=x*s;m[20]+=x*c;}
 m[3]=m[1];m[6]=m[2];m[7]=m[5];
 for(let i=0;i<9;i++)m[i]/=n;for(let i=18;i<21;i++)m[i]/=n;
 const [a,b,c,d,e,f,g,h,j]=m,det=a*(e*j-f*h)-b*(d*j-f*g)+c*(d*h-e*g);
 if(!Number.isFinite(det)||Math.abs(det)<Number.EPSILON)return invalid(2);
 const cofactors=[e*j-f*h,c*h-b*j,b*f-c*e,f*g-d*j,a*j-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
 for(let i=0;i<9;i++)m[9+i]=cofactors[i]/det;
 let norm=0,inverseNorm=0;
 for(let r=0;r<3;r++){norm=Math.max(norm,Math.abs(m[r*3])+Math.abs(m[r*3+1])+Math.abs(m[r*3+2]));inverseNorm=Math.max(inverseNorm,Math.abs(m[9+r*3])+Math.abs(m[10+r*3])+Math.abs(m[11+r*3]));m[21+r]=m[9+r*3]*m[18]+m[10+r*3]*m[19]+m[11+r*3]*m[20];}
 const condition=norm*inverseNorm,[dc,sn,cs]=m.slice(21);
 if(![condition,dc,sn,cs].every(Number.isFinite)||condition>100)return invalid(2);
 const model=i=>dc+sn*wave.sin[i%480]+cs*wave.cos[i%480];
 function edge(start,end,opening) {
  let cost=0;for(let i=start;i<end;i++)cost+=(value(i)-(opening?model(i):dc))**2;
  let best=cost,at=start;
  for(let i=start;i<end;i++){const x=value(i),noise=(x-dc)**2,carrier=(x-model(i))**2;cost+=opening?noise-carrier:carrier-noise;if(cost<best){best=cost;at=i+1;}}
  return at;
 }
 const openingGate=edge(0,first,true),closingGate=edge(last,length,false),ring=Array(48).fill(0);
 charge(Math.max(0,length-47));let rolling=0,maxSquared=-1,maxResidualAt=0;
 for(let i=0;i<length;i++){const residual=(value(i)-(i>=openingGate&&i<closingGate?model(i):dc))**2;rolling+=residual-ring[i%48];ring[i%48]=residual;if(i>=47&&rolling>maxSquared){maxSquared=rolling;maxResidualAt=i-47;}}
 return {score,openingGate,closingGate,maxResidual:finite(Math.sqrt(Math.max(0,maxSquared)/48)),maxResidualAt,code:0,condition,coefficients:[dc,sn,cs]};
}
/** Full independent numerical replay. It reproduces the specified arithmetic
 * order so exact f64 wire fields can be compared without decimal tolerances.
 * Provenance/conservation/clock admission remain separate prerequisites. */
export function replayAudioClassification(pcm,rows) {
 const partition=replayAudioPartition(pcm,rows),residualWindowCounts=[0,0];let localWindowCount=0;
 if(partition.episodes.length>4096)throw Error('reference_episode_count_bound');
 const episodes=partition.episodes.map(e=>{
  const start=e.firstLoudLeft.ordinal,length=e.closureRight.ordinal-start,loud=e.lastLoudRight.ordinal-start;
  if(length>12000)throw Error('reference_episode_bound');
  const value=i=>pcm.readInt16LE(2*(start+i))/32768,local={windows:Math.floor(length/480),hits:0,firstPair:-1,amplitudes:[null,null,null,null]};
  localWindowCount+=local.windows;if(localWindowCount>1200000)throw Error('reference_local_bound');
  let previousHit=false,previousA=0,previousB=0;
  for(let begin=0;begin+480<=length;begin+=480){
   let as=0,ac=0,bs=0,bc=0;
   for(let i=0;i<480;i++){const x=value(begin+i);as+=x*waves[0].sin[i];ac+=x*waves[0].cos[i];bs+=x*waves[1].sin[i];bc+=x*waves[1].cos[i];}
   const A=finite(Math.hypot(as,ac)/240),B=finite(Math.hypot(bs,bc)/240),major=Math.max(A,B),minor=Math.min(A,B),hit=major>=.4&&minor>=.1&&minor/major>=.2;
   if(hit)local.hits++;if(hit&&previousHit&&local.firstPair<0){local.firstPair=begin-480;local.amplitudes=[previousA,previousB,A,B];}previousHit=hit;previousA=A;previousB=B;
  }
  const fits=waves.map((wave,i)=>{
   const charge=n=>{residualWindowCounts[i]+=n;if(residualWindowCounts[i]>12000000)throw Error('reference_residual_bound');};
   const fit=replayCore(value,length,loud,e.firstEnd,e.lastStart,wave,charge);
   if(e.prelude.kind==='UnclaimedQuiet'&&fit.code===0)charge(Math.max(0,length+e.prelude.count-47));
   fit.guard=replayPreludeGuard(pcm,e,fit,i===0?700:1300);return fit;
  });
  let identity='unknown',reason='single_carrier_inconsistent';
  if(loud<1440)reason='insufficient_samples';
  else if(local.firstPair>=0){identity='mixed';reason='simultaneous_local_energy';}
  else if(fits.every(f=>f.score>=.05)){identity='mixed';reason='simultaneous_energy';}
  else {
   const eligible=fits.map((f,i)=>f.code===0&&f.maxResidual<=.14&&f.score>=.6&&fits[1-i].score<.05);
   if(eligible.filter(Boolean).length===1){identity=eligible[0]?'a':'b';reason='none';}
   else if(fits.some(f=>f.code!==0))reason='invalid_metadata_or_fit';
  }
  if((identity==='a'||identity==='b')&&fits[identity==='a'?0:1].guard.maxResidual>.14){identity='unknown';reason='single_carrier_inconsistent';}
  return {onset:e.firstLoudLeft.raw,end:e.closureRight.raw,firstMetadataIndex:e.firstLoudLeft.row,metadataRowCount:e.closureRight.row-e.firstLoudLeft.row+1,firstEnd:e.firstEnd,lastStart:e.lastStart,loudEnd:loud,firstLoudLeft:e.firstLoudLeft,lastLoudRight:e.lastLoudRight,closureRight:e.closureRight,prelude:e.prelude,identity,reason,fits,local};
 });
 return {metadataSamples:partition.samples,decodedBytes:partition.bytes,detectorBlockCount:partition.blockCount,residualWindowCounts,localWindowCount,episodes};
}
