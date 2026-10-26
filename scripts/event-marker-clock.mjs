import { createHash } from 'node:crypto';
import { inspectCheckedProgram } from './event-marker-conservation.mjs';
/** Pure common-clock mathematics. These functions prove no capture provenance.
 * Every expression is a*A+b*V+c in the shared 720000 Hz coordinate system. */
export const CLOCK_HZ=720000;
const integer=n=>{if(!Number.isSafeInteger(n))throw Error('marker_clock_integer');return n;};
const exact=n=>integer(Number(n));
const mul=(a,b)=>exact(BigInt(integer(a))*BigInt(integer(b)));
const add=(a,b)=>exact(BigInt(integer(a))+BigInt(integer(b)));
const certificates=new WeakMap();
const hash=value=>createHash('sha256').update(value).digest('hex');
const frozen=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;};
function audioBinding(chunks,rows) {
 if(!Array.isArray(chunks)||!Array.isArray(rows)||!rows.length)throw Error('marker_clock_input');
 const sha=createHash('sha256');let bytes=0;
 for(const chunk of chunks){if(!(chunk instanceof Uint8Array))throw Error('marker_clock_input');bytes=add(bytes,chunk.byteLength);sha.update(chunk);}
 const vector=rows.map((r,i)=>{if(r.index!==i||!Number.isSafeInteger(r.pts)||!Number.isSafeInteger(r.samples)||r.samples<=0)throw Error('marker_clock_input');return [r.index,r.pts,r.samples];});
 return {bytes,pcmSHA:sha.digest('hex'),audioRowsSHA:hash(JSON.stringify(vector))};
}
function videoBinding(rgb,rows) {
 if(!(rgb instanceof Uint8Array)||!Array.isArray(rows)||!rows.length)throw Error('marker_clock_input');
 const vector=rows.map((r,i)=>{if(r.index!==i||!Number.isSafeInteger(r.pts))throw Error('marker_clock_input');return [r.index,r.pts];});
 return {rgbBytes:rgb.byteLength,rgbSHA:hash(rgb),videoRowsSHA:hash(JSON.stringify(vector))};
}
/** The literal path certifies exact unencoded coordinates only. An encoded
 * policy cannot enter through it or obtain a certificate from caller flags.
 * Its capture adapter/inventory verifier is a separately reviewed dependency. */
export function inspectClock(capture,policy,inputLedger) {
 if(policy?.mode!=='literal'||inputLedger?.kind!=='literal')return frozen({kind:'Unproven',reason:'capture_adapter_required'});
 try {
  const {audioChunks,audioRows,videoRows,rgb}=capture;
  if(![30,60].includes(policy.fps)||!Number.isSafeInteger(inputLedger.samples)||inputLedger.samples<=0||!Number.isSafeInteger(inputLedger.frames)||inputLedger.frames<=0)throw Error('marker_clock_input');
  const audio=audioBinding(audioChunks,audioRows),video=videoBinding(rgb,videoRows);let samples=0;
  for(const [i,row] of audioRows.entries()){if(i&&row.pts!==add(audioRows[i-1].pts,audioRows[i-1].samples))throw Error('marker_clock_audio_sequence');samples=add(samples,row.samples);}
  for(const [i,row] of videoRows.entries())if(row.pts!==add(videoRows[0].pts,mul(i,90000/policy.fps)))throw Error('marker_clock_video_sequence');
  if(samples!==inputLedger.samples||audio.bytes!==mul(samples,2)||videoRows.length!==inputLedger.frames||video.rgbBytes!==mul(videoRows.length,6))throw Error('marker_clock_conservation');
  const domain={audio:[mul(audioRows[0].pts,15),mul(audioRows[0].pts,15)],video:[mul(videoRows[0].pts,8),mul(videoRows[0].pts,8)]};
  const policySHA=hash(JSON.stringify({mode:'literal',fps:policy.fps})),inputSHA=hash(JSON.stringify({...inputLedger,...audio,...video}));
  const data={...audio,...video,samples,frames:videoRows.length,fps:policy.fps,policySHA,inputSHA};
  const certificate=frozen({kind:'ClockCompatible',sourceKind:'literal',mode:'exact',fps:policy.fps,quantum:0,domain,captureSHA:hash(JSON.stringify(data)),inputSHA,policySHA,samples,frames:videoRows.length});
  certificates.set(certificate,frozen(data));return certificate;
 }catch(error){return frozen({kind:'Violation',reason:error.message});}
}
export function assertAudioClock(certificate,chunks,rows) {
 const binding=certificates.get(certificate);if(!binding)throw Error('marker_clock_unproven');
 const actual=audioBinding(chunks,rows);for(const key of Object.keys(actual))if(actual[key]!==binding[key])throw Error('marker_clock_binding');return certificate;
}
export function assertVideoClock(certificate,rgb,rows) {
 const binding=certificates.get(certificate);if(!binding)throw Error('marker_clock_unproven');
 const actual=videoBinding(rgb,rows);for(const key of Object.keys(actual))if(actual[key]!==binding[key])throw Error('marker_clock_binding');return certificate;
}
/** Encoded TS factory; membership in the complete verifier's private map is
 * required before any singleton origin exists. Serialization loses authority. */
export function inspectProgramClock(capture,handle) {
 const checked=inspectCheckedProgram(handle);if(!checked)return frozen({kind:'Unproven',reason:'checked_program_required'});
 try {
  const audio=audioBinding(capture.audioChunks,capture.audioRows),video=videoBinding(capture.rgb,capture.videoRows),binding=checked.binding;
  if(audio.pcmSHA!==binding.pcmSHA256||video.rgbSHA!==binding.rgbSHA256||hash(JSON.stringify(capture.audioRows))!==binding.audioRowsSHA256||hash(JSON.stringify(capture.videoRows))!==binding.videoRowsSHA256)throw Error('marker_clock_binding');
  const samples=checked.population.decodedSamples,frames=checked.population.codedPictures,fps=checked.fps;
  if(audio.bytes!==samples*2||video.rgbBytes!==frames*6||capture.audioRows.length!==checked.population.codedAudioUnits||capture.videoRows.length!==frames)throw Error('marker_clock_conservation');
  for(const [i,row] of capture.audioRows.entries())if(row.samples!==1024||row.pts!==capture.audioRows[0].pts+i*1024)throw Error('marker_clock_audio_sequence');
  for(const [i,row] of capture.videoRows.entries())if(row.pts!==capture.videoRows[0].pts+i*90000/fps)throw Error('marker_clock_video_sequence');
  const a=mul(capture.audioRows[0].pts,15),v=mul(capture.videoRows[0].pts,8),domain={audio:[a,a],video:[v,v]},inputSHA=checked.file.sha256,policySHA=hash(JSON.stringify({mode:'program-ts',fps,packetOrderSHA256:checked.packetOrderSHA256})),data={...audio,...video,samples,frames,fps,inputSHA,policySHA,checked};
  const certificate=frozen({kind:'ClockCompatible',sourceKind:'externalCodedRecording',mode:'exact',fps,quantum:0,domain,captureSHA:hash(JSON.stringify({...audio,...video})),inputSHA,policySHA,samples,frames,assurance:checked.assurance});certificates.set(certificate,frozen(data));return certificate;
 }catch(error){return frozen({kind:'Violation',reason:error.message});}
}
export function assertProgramClock(certificate) {
 const data=certificates.get(certificate);if(!data?.checked||certificate.sourceKind!=='externalCodedRecording'||certificate.assurance?.kind!=='trustedStackMeasurement'||certificate.assurance.nativeBindingVerified!==false||certificate.assurance.loaderComplete!==false||certificate.assurance.pendingOuterJoin!==true)throw Error('marker_clock_unproven');return data.checked;
}
export const audioCoordinate=ordinal=>[1,0,mul(15,ordinal)];
export function videoCoordinate(frame,fps,offset=0) {
 if(![30,60].includes(fps))throw Error('marker_clock_fps');
 return [0,1,add(mul(frame,CLOCK_HZ/fps),offset)];
}
export const constantCoordinate=value=>[0,0,integer(value)];
export const subtractClock=(left,right)=>left.map((n,i)=>add(n,-integer(right[i])));
const range=(lo,hi)=>({lo:integer(lo),hi:integer(hi),loOpen:false,hiOpen:false});
const nonempty=r=>r.lo<r.hi||r.lo===r.hi&&!r.loOpen&&!r.hiOpen;
function intersect(target,source) {
 if(source.lo>target.lo){target.lo=source.lo;target.loOpen=source.loOpen;}
 else if(source.lo===target.lo)target.loOpen ||=source.loOpen;
 if(source.hi<target.hi){target.hi=source.hi;target.hiOpen=source.hiOpen;}
 else if(source.hi===target.hi)target.hiOpen ||=source.hiOpen;
 return nonempty(target);
}
function domains(domain) {
 const a=range(...domain.audio),v=range(...domain.video);
 if(!nonempty(a)||!nonempty(v))throw Error('marker_clock_domain');
 return {a,v,d:range(add(a.lo,-v.hi),add(a.hi,-v.lo))};
}
function atom({value,op,bound}) {
 if(!Array.isArray(value)||value.length!==3||!['<','<=','>','>=','=='].includes(op))throw Error('marker_clock_predicate');
 const [a,b,c]=value.map(integer);let key,sign=1;
 if(a===0&&b===0)key='constant';
 else if(Math.abs(a)===1&&b===0){key='a';sign=a;}
 else if(a===0&&Math.abs(b)===1){key='v';sign=b;}
 else if(Math.abs(a)===1&&b===-a){key='d';sign=a;}
 else throw Error('marker_clock_unproven');
 let edge=add(integer(bound),-c);
 if(sign<0){edge=-edge;op=({'<':'>','<=':'>=','>':'<','>=':'<=','==':'=='})[op];}
 return {key,op,edge};
}
const compare=(a,op,b)=>op==='<'?a<b:op==='<='?a<=b:op==='>'?a>b:op==='>='?a>=b:a===b;
function constrain(r,{op,edge}) {
 const s={...r};
 if(op==='<'||op==='<='){s.hi=edge;s.hiOpen=op==='<';}
 else if(op==='>'||op==='>='){s.lo=edge;s.loOpen=op==='>';}
 else{s.lo=s.hi=edge;s.loOpen=s.hiOpen=false;}
 return intersect(r,s);
}
/** Feasibility of rectangle A,V intersected with a strip D=A-V. No grids,
 * independent marginal assignments or floating point epsilon are used. */
export function clockMay(domain,predicates) {
 const ds=domains(domain);
 for(const p of predicates){const x=atom(p);if(x.key==='constant'){if(!compare(0,x.op,x.edge))return false;}else if(!constrain(ds[x.key],x))return false;}
 return intersect(ds.d,{lo:add(ds.a.lo,-ds.v.hi),hi:add(ds.a.hi,-ds.v.lo),loOpen:ds.a.loOpen||ds.v.hiOpen,hiOpen:ds.a.hiOpen||ds.v.loOpen});
}
export function clockMust(domain,predicates) {
 const ds=domains(domain);
 return predicates.every(p=>{const {key,op,edge}=atom(p),r=key==='constant'?range(0,0):ds[key];return compare(r.lo,op,edge)&&compare(r.hi,op,edge);});
}
/** Input packet PTS are milliseconds. Cells are packet-only; decoded native
 * timestamps are independently checked against replayFlvAudioPts. */
export function packetOriginCell(packetPts,ordinalStep,quantum=720) {
 if(!Array.isArray(packetPts)||!packetPts.length||quantum!==720)throw Error('marker_clock_packets');
 let low,high;
 packetPts.forEach((pts,i)=>{const r=add(mul(pts,720),-mul(i,ordinalStep));low=low===undefined?r:Math.min(low,r);high=high===undefined?r:Math.max(high,r);});
 if(add(high,-low)>=quantum)throw Error('marker_clock_diameter');
 const cell=[add(high,-quantum),add(low,quantum)];
 if(cell[0]>cell[1])throw Error('marker_clock_intersection');return cell;
}
export function replayFlvAudioPts(packetPts) {
 let last,previous,resets=0;
 const pts=packetPts.map(t=>{
  integer(t);if(previous!==undefined&&t<=previous)throw Error('marker_clock_packet_order');
  if(previous!==undefined&&t-previous>21){last=undefined;resets++;}
  const center=mul(48,t),a=add(center,-24),b=add(center,24);
  const u=last===undefined||last<add(mul(2,a),-b)||last>add(mul(2,b),-a)?center:Math.max(a,Math.min(b,last));
  last=add(u,1024);previous=t;return u;
 });return {pts,resets};
}
export function expectedAacCounts(inputSamples) {
 integer(inputSamples);if(inputSamples<=0)throw Error('marker_clock_input');
 const frames=(BigInt(inputSamples)+1023n)/1024n,accessUnits=exact(frames+1n);
 return {inputSamples,accessUnits,samples:mul(accessUnits,1024),priming:1024,fill:exact(frames*1024n-BigInt(inputSamples))};
}
/** Pure replay of vf_fps.c:235-310 in its frozen nearest/no-start-offset
 * domain. eofPts is an independently captured upstream status timestamp,
 * never an inference from the number of output frames. */
export function replayFpsIdentity(inputPts,timeBase,fps,eofPts) {
 if(!Number.isSafeInteger(eofPts))throw Error('marker_clock_fps_eof');
 if(![30,60].includes(fps)||!Array.isArray(inputPts)||!inputPts.length||!Number.isSafeInteger(timeBase?.num)||timeBase.num<=0||!Number.isSafeInteger(timeBase.den)||timeBase.den<=0)throw Error('marker_clock_fps');
 const rescale=pts=>{
  const n=BigInt(integer(pts))*BigInt(timeBase.num)*BigInt(fps),d=BigInt(timeBase.den),abs=n<0n?-n:n;
  return exact((n<0n?-1n:1n)*((2n*abs+d)/(2n*d)));
 };
 const rounded=inputPts.map((pts,i)=>{if(i&&pts<=inputPts[i-1])throw Error('marker_clock_fps');return rescale(pts);});
 const eof=rescale(eofPts),map=[];let next=rounded[0];
 for(let i=0;i<rounded.length;i++) {
  const limit=i+1<rounded.length?rounded[i+1]:eof;
  while(next<limit){map.push({ordinal:i,pts:next});next=add(next,1);if(map.length>inputPts.length)throw Error('marker_clock_fps_identity');}
 }
 if(map.length!==inputPts.length||map.some((row,i)=>row.ordinal!==i))throw Error('marker_clock_fps_identity');
 return map;
}
/** Endpoint sides remain explicit: the right edge of one row need not have
 * the same raw PTS as the left edge of the next row at the same ordinal. */
export function audioEndpoint(rows,row,inRow,side) {
 integer(row);integer(inRow);if(!['left','right'].includes(side)||row<0||row>=rows.length||inRow<0||inRow>rows[row].samples)throw Error('marker_endpoint');
 let ordinal=0;
 for(let i=0;i<=row;i++){const r=rows[i];if(r.index!==i||!Number.isSafeInteger(r.samples)||r.samples<=0)throw Error('marker_endpoint');if(i<row)ordinal=add(ordinal,r.samples);}
 return {ordinal:add(ordinal,inRow),row,inRow,raw:add(rows[row].pts,inRow),side};
}

/** Project raw endpoint observations, never reconstruct them from a duration.
 * This is a representation check, not a capture/clock certificate. */
export function audioEpisodeRawRange(episode) {
  const first=episode.firstLoudLeft,last=episode.lastLoudRight,end=episode.closureRight;
  if(!first||!last||!end||first.side!=='left'||last.side!=='right'||end.side!=='right'||
    ![first.ordinal,last.ordinal,end.ordinal,first.row,last.row,end.row,first.inRow,last.inRow,end.inRow,first.raw,last.raw,end.raw].every(Number.isSafeInteger)||
    first.ordinal<0||last.ordinal<=first.ordinal||end.ordinal<=last.ordinal||first.row<0||last.row<first.row||end.row<last.row||
    first.inRow<0||last.inRow<=0||end.inRow<=0||
    episode.onset!==first.raw||episode.end!==end.raw||episode.loudEnd!==last.ordinal-first.ordinal||
    episode.firstMetadataIndex!==first.row||episode.metadataRowCount!==end.row-first.row+1)throw Error('marker_endpoint');
  return [first.raw,last.raw,end.raw,first.row,end.row-first.row+1];
}
