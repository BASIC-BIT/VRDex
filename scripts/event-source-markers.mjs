/** Synthetic proof only. No selected source, video or timing-acceptance input. */
export const MARKER_SCHEMA = 'source-tones-v1';
export const SOURCE_FREQUENCIES = Object.freeze({ a: 700, b: 1300 });
export const MARKER_LIMITS = Object.freeze({ episodes:4096, episodeSamples:12000,
  residualWindows:12000000, localWindows:1200000, scratchBytes:65536 });
const basis = [700,1300].map(f => {
  const sin=new Float64Array(480), cos=new Float64Array(480);
  for(let i=0;i<480;i++) { sin[i]=Math.sin(2*Math.PI*f*i/48000);cos[i]=Math.cos(2*Math.PI*f*i/48000); }
  return {sin,cos};
});
const safe = value => { if(!Number.isSafeInteger(value)) throw Error('marker_integer');return value; };
const finite = value => { if(!Number.isFinite(value)) throw Error('marker_arithmetic');return value; };
export function markerOffset(audioSample,videoPts) { return safe(safe(15*safe(audioSample))-safe(8*safe(videoPts))); }

function fitCarrier(samples,length,loudEnd,firstEnd,lastStart,wave,matrix,ring,counters,frequencyIndex) {
  let sx=0,sxx=0,ss=0,sc=0,xs=0,xc=0;
  for(let i=0;i<loudEnd;i++) {
    const x=samples[i]/32768,s=wave.sin[i%480],c=wave.cos[i%480];
    sx+=x;sxx+=x*x;ss+=s;sc+=c;xs+=x*s;xc+=x*c;
  }
  const energy=sxx-sx*sx/loudEnd;
  const score=energy>0?finite(2*((xs-sx*ss/loudEnd)**2+(xc-sx*sc/loudEnd)**2)/(loudEnd*energy)):0;
  const invalid=code=>({score,openingGate:null,closingGate:null,maxResidual:null,maxResidualAt:null,code,condition:null,coefficients:null});
  const n=lastStart-firstEnd;
  if(n<=0) return invalid(1);
  matrix.fill(0);
  for(let i=firstEnd;i<lastStart;i++) {
    const x=samples[i]/32768,s=wave.sin[i%480],c=wave.cos[i%480];
    matrix[0]++;matrix[1]+=s;matrix[2]+=c;matrix[4]+=s*s;matrix[5]+=s*c;matrix[8]+=c*c;
    matrix[18]+=x;matrix[19]+=x*s;matrix[20]+=x*c;
  }
  matrix[3]=matrix[1];matrix[6]=matrix[2];matrix[7]=matrix[5];
  for(let i=0;i<9;i++) matrix[i]/=n;
  for(let i=18;i<21;i++) matrix[i]/=n;
  const [a,b,c,d,e,f,g,h,j]=matrix;
  const det=a*(e*j-f*h)-b*(d*j-f*g)+c*(d*h-e*g);
  if(!Number.isFinite(det)||Math.abs(det)<Number.EPSILON) return invalid(2);
  matrix.set([e*j-f*h,c*h-b*j,b*f-c*e,f*g-d*j,a*j-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d],9);
  for(let i=9;i<18;i++) matrix[i]/=det;
  let norm=0,inverseNorm=0;
  for(let row=0;row<3;row++) {
    norm=Math.max(norm,Math.abs(matrix[row*3])+Math.abs(matrix[row*3+1])+Math.abs(matrix[row*3+2]));
    inverseNorm=Math.max(inverseNorm,Math.abs(matrix[9+row*3])+Math.abs(matrix[10+row*3])+Math.abs(matrix[11+row*3]));
    matrix[21+row]=matrix[9+row*3]*matrix[18]+matrix[10+row*3]*matrix[19]+matrix[11+row*3]*matrix[20];
  }
  const condition=norm*inverseNorm;
  const dc=matrix[21],sn=matrix[22],cs=matrix[23];
  if(![condition,dc,sn,cs].every(Number.isFinite)||condition>100) return invalid(2);
  const model=i=>dc+sn*wave.sin[i%480]+cs*wave.cos[i%480];
  // Compare every integer edge gate in linear time. Equal costs keep earliest.
  const gate=(start,end,opening)=>{
    let cost=0;
    for(let i=start;i<end;i++) cost+=(samples[i]/32768-(opening?model(i):dc))**2;
    let best=cost,at=start;
    for(let i=start;i<end;i++) {
      const x=samples[i]/32768,noise=(x-dc)**2,carrier=(x-model(i))**2;
      cost+=opening?noise-carrier:carrier-noise;
      if(cost<best) {best=cost;at=i+1;}
    }
    return at;
  };
  const openingGate=gate(0,firstEnd,true),closingGate=gate(lastStart,length,false);
  const windows=Math.max(0,length-47);
  counters.residual[frequencyIndex]+=windows;
  if(counters.residual[frequencyIndex]>MARKER_LIMITS.residualWindows) throw Error('marker_residual_bound');
  let rolling=0,maxSquared=-1,maxResidualAt=0;
  ring.fill(0);
  for(let i=0;i<length;i++) {
    const residual=(samples[i]/32768-(i>=openingGate&&i<closingGate?model(i):dc))**2;
    rolling+=residual-ring[i%48];ring[i%48]=residual;
    if(i>=47&&rolling>maxSquared) {maxSquared=rolling;maxResidualAt=i-47;}
  }
  return {score,openingGate,closingGate,maxResidual:finite(Math.sqrt(Math.max(0,maxSquared)/48)),maxResidualAt,code:0,condition,coefficients:[dc,sn,cs]};
}

function classify(samples,length,edges,scratch,counters) {
  const local={windows:Math.floor(length/480),hits:0,firstPair:-1,amplitudes:[null,null,null,null]};
  counters.local+=local.windows;
  if(counters.local>MARKER_LIMITS.localWindows) throw Error('marker_local_bound');
  let previousHit=false,previousA=0,previousB=0;
  for(let start=0;start+480<=length;start+=480) {
    let as=0,ac=0,bs=0,bc=0;
    for(let i=0;i<480;i++) {const x=samples[start+i]/32768;as+=x*basis[0].sin[i];ac+=x*basis[0].cos[i];bs+=x*basis[1].sin[i];bc+=x*basis[1].cos[i];}
    const A=finite(Math.hypot(as,ac)/240),B=finite(Math.hypot(bs,bc)/240),major=Math.max(A,B),minor=Math.min(A,B);
    const hit=major>=.4&&minor>=.1&&minor/major>=.2;
    if(hit) local.hits++;
    if(hit&&previousHit&&local.firstPair<0) {local.firstPair=start-480;local.amplitudes=[previousA,previousB,A,B];}
    previousHit=hit;previousA=A;previousB=B;
  }
  const fits=basis.map((wave,i)=>fitCarrier(samples,length,edges.loudEnd,edges.firstEnd,edges.lastStart,wave,scratch.matrix,scratch.ring,counters,i));
  let identity='unknown',reason='single_carrier_inconsistent';
  if(edges.loudEnd<1440) reason='insufficient_samples';
  else if(local.firstPair>=0) {identity='mixed';reason='simultaneous_local_energy';}
  else if(fits.every(f=>f.score>=.05)) {identity='mixed';reason='simultaneous_energy';}
  else {
    const eligible=fits.map((f,i)=>f.code===0&&f.maxResidual<=.14&&f.score>=.6&&fits[1-i].score<.05);
    if(eligible.filter(Boolean).length===1) {identity=eligible[0]?'a':'b';reason='none';}
    else if(fits.some(f=>f.code!==0)) reason='invalid_metadata_or_fit';
  }
  return {identity,reason,fits,local};
}

/** Chunk boundaries are irrelevant; RMS blocks restart at EACH metadata row. */
export function decodeSourceAudio(chunks,rows) {
  if(!Array.isArray(chunks)||!Array.isArray(rows)||!rows.length) throw Error('marker_audio_metadata');
  let bytes=0,total=0,lastEnd;
  for(const chunk of chunks) {if(!(chunk instanceof Uint8Array)) throw Error('marker_pcm_type');bytes=safe(bytes+chunk.byteLength);}
  for(let i=0;i<rows.length;i++) {
    const r=rows[i];
    if(r.index!==i||!Number.isSafeInteger(r.pts)||!Number.isSafeInteger(r.samples)||r.samples<=0) throw Error('marker_audio_metadata');
    if(lastEnd!==undefined&&r.pts!==lastEnd) throw Error('marker_audio_continuity');
    lastEnd=safe(r.pts+r.samples);total=safe(total+r.samples);
  }
  if(safe(total*2)!==bytes) throw Error('marker_pcm_length');
  const samples=new Int16Array(MARKER_LIMITS.episodeSamples),matrix=new Float64Array(32),ring=new Float64Array(48);
  const scratchBytes=samples.byteLength+matrix.byteLength+ring.byteLength+basis.reduce((n,b)=>n+b.sin.byteLength+b.cos.byteLength,0);
  if(scratchBytes>MARKER_LIMITS.scratchBytes) throw Error('marker_scratch_bound');
  let ci=0,bi=0;
  const byte=()=>{while(ci<chunks.length&&bi===chunks[ci].byteLength){ci++;bi=0;}return chunks[ci][bi++];};
  const sample=()=>{const n=byte()|(byte()<<8);return n>=32768?n-65536:n;};
  const counters={residual:[0,0],local:0},episodes=[];
  let blockCount=0,episode,filled=0;
  // One block is staged in the episode backing's unused prefix when inactive.
  for(const row of rows) for(let start=0;start<row.samples;start+=480) {
    const count=Math.min(480,row.samples-start),position=episode?filled:0;
    if(position+count>samples.length) throw Error('marker_episode_bound');
    let energy=0;
    for(let i=0;i<count;i++) {const v=sample();samples[position+i]=v;energy+=(v/32768)**2;}
    blockCount++;
    const loud=Math.sqrt(energy/count)>.15,pts=safe(row.pts+start);
    if(loud&&!episode) {episode={onset:pts,firstMetadataIndex:row.index,firstEnd:count,lastStart:0,loudEnd:count};filled=0;}
    if(episode) {
      if(loud) {episode.lastStart=filled;episode.loudEnd=filled+count;}
      filled+=count;
      if(!loud) {
        if(episodes.length>=MARKER_LIMITS.episodes) throw Error('marker_episode_count_bound');
        episodes.push({...episode,end:safe(pts+count),metadataRowCount:row.index-episode.firstMetadataIndex+1,...classify(samples,filled,episode,{matrix,ring},counters)});
        episode=undefined;filled=0;
      }
    }
  }
  if(episode) throw Error('marker_unmatched_eof');
  return {schema:MARKER_SCHEMA,metadataSamples:total,decodedBytes:bytes,detectorBlockCount:blockCount,scratchBytes,audioRange:[rows[0].pts,lastEnd],residualWindowCounts:counters.residual,localWindowCount:counters.local,episodes};
}
