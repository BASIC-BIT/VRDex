import { createHash } from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bad=()=>{throw Error('marker_h264_inventory');};

function rbsp(body) {
 const result=Buffer.alloc(body.length-1);let used=0,zeros=0,removed=0;
 for(let i=1;i<body.length;i++) {
  const value=body[i];
  if(zeros===2) {
   if(value===3){if(i+1===body.length||body[i+1]>3)bad();removed++;zeros=0;continue;}
   if(value<3)bad();
  }
  result[used++]=value;zeros=value===0?zeros+1:0;
 }
 return {bytes:result.subarray(0,used),removed};
}

/** Original framing only, not a picture/AU inventory. Annex-B supports the
 * pinned non-padded X path: no extra leading/trailing zero bytes. AVCC uses
 * four-byte lengths. All SPS/PPS/SEI/AUD/filler bodies remain accounted.
 * Parameter/slice syntax and source/runtime binding are separate premises. */
export function partitionH264Nals(raw,{byteCap,framing}) {
 if(!(raw instanceof Uint8Array)||!Number.isSafeInteger(byteCap)||byteCap<0||!raw.byteLength||raw.byteLength>byteCap||!['annexB','avcc'].includes(framing))bad();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),nals=[];
 const span=(beginByte,endByte)=>Object.freeze({beginByte,endByte,sha256:sha(bytes.subarray(beginByte,endByte))});
 const prefixLength=at=>bytes[at]===0&&bytes[at+1]===0?(bytes[at+2]===1?3:bytes[at+2]===0&&bytes[at+3]===1?4:0):0;
 let offset=0;
 while(offset<bytes.length) {
  let length,end;
  if(framing==='avcc'){length=4;if(bytes.length-offset<4)bad();const size=bytes.readUInt32BE(offset);if(size>bytes.length-offset-4)bad();end=offset+4+size;}
  else {
   length=prefixLength(offset);if(!length)bad();end=offset+length;
   while(end<bytes.length&&!prefixLength(end))end++;
   if(bytes[end-1]===0)bad();
  }
  const begin=offset+length;if(end-begin<2)bad();
  const body=bytes.subarray(begin,end),type=body[0]&31,refIdc=(body[0]>>5)&3;
  if(body[0]&128||![1,5,6,7,8,9,12].includes(type)||[5,7,8].includes(type)&&!refIdc||[6,9,12].includes(type)&&refIdc)bad();
  const decoded=rbsp(body);
  nals.push(Object.freeze({index:nals.length,type,refIdc,prefix:span(offset,begin),body:span(begin,end),rbspBytes:decoded.bytes.length,rbspSHA256:sha(decoded.bytes),emulationPreventionBytes:decoded.removed}));offset=end;
 }
 return Object.freeze({sha256:sha(bytes),bytes:bytes.length,framing,nals:Object.freeze(nals)});
}

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function bitReader(bytes) {
 let position=0;const length=bytes.length*8;
 const read=n=>{if(!Number.isInteger(n)||n<0||n>32||position+n>length)bad();let value=0;for(let i=0;i<n;i++,position++)value=value*2+((bytes[position>>3]>>(7-(position&7)))&1);return value;};
 const ue=(max=4294967294)=>{let zeros=0;while(read(1)===0)if(++zeros>31)bad();const value=2**zeros-1+read(zeros);if(value>max)bad();return value;};
 const se=(min=-2147483647,max=2147483647)=>{const code=ue(),value=code&1?(code+1)/2:-code/2;if(value<min||value>max)bad();return value;};
 const more=()=>{if(length-position>8)return true;if(position===length)return false;for(let p=position;p<length;p++)if(((bytes[p>>3]>>(7-(p&7)))&1)!==(p===position?1:0))return true;return false;};
 const end=()=>{if(read(1)!==1)bad();while(position&7)if(read(1)!==0)bad();if(position!==length)bad();};
 return {read,ue,se,more,end,position:()=>position};
}
function hrd(r) {
 const count=r.ue(31)+1,bitRateScale=r.read(4),cpbSizeScale=r.read(4),cpb=[];
 for(let i=0;i<count;i++)cpb.push({bitRateValueMinus1:r.ue(),cpbSizeValueMinus1:r.ue(),cbr:Boolean(r.read(1))});
 return {bitRateScale,cpbSizeScale,cpb,initialCpbRemovalDelayLength:r.read(5)+1,cpbRemovalDelayLength:r.read(5)+1,dpbOutputDelayLength:r.read(5)+1,timeOffsetLength:r.read(5)};
}
function vui(r) {
 let sar=null,overscan=null,signal=null,chromaLocation=null,timing=null,nalHrd=null,vclHrd=null,lowDelayHrd=null,restriction=null;
 if(r.read(1)) {
  const id=r.read(8),ratios=[[0,0],[1,1],[12,11],[10,11],[16,11],[40,33],[24,11],[20,11],[32,11],[80,33],[18,11],[15,11],[64,33],[160,99],[4,3],[3,2],[2,1]];
  if(id===255){sar=[r.read(16),r.read(16)];if(!sar[0]||!sar[1])bad();}else {if(id>=ratios.length)bad();sar=ratios[id];}
 }
 if(r.read(1))overscan=Boolean(r.read(1));
 if(r.read(1)){signal={format:r.read(3),fullRange:Boolean(r.read(1)),colour:null};if(signal.format>5)bad();if(r.read(1))signal.colour={primaries:r.read(8),transfer:r.read(8),matrix:r.read(8)};}
 if(r.read(1))chromaLocation=[r.ue(5),r.ue(5)];
 if(r.read(1)){timing={numUnitsInTick:r.read(32),timeScale:r.read(32),fixedFrameRate:Boolean(r.read(1))};if(!timing.numUnitsInTick||!timing.timeScale)bad();}
 if(r.read(1))nalHrd=hrd(r);if(r.read(1))vclHrd=hrd(r);if(nalHrd||vclHrd)lowDelayHrd=Boolean(r.read(1));
 const picStructPresent=Boolean(r.read(1));
 if(r.read(1)) {
  restriction={motionVectorsOverPictureBoundaries:Boolean(r.read(1)),maxBytesPerPicDenom:r.ue(16),maxBitsPerMbDenom:r.ue(16),log2MaxMvHorizontal:r.ue(16),log2MaxMvVertical:r.ue(16),maxReorderFrames:r.ue(16),maxDecFrameBuffering:r.ue(16)};
  if(restriction.maxReorderFrames>restriction.maxDecFrameBuffering)bad();
 }
 return {sar,overscan,signal,chromaLocation,timing,nalHrd,vclHrd,lowDelayHrd,picStructPresent,restriction};
}
function sequenceParameters(body) {
 const r=bitReader(rbsp(body).bytes),profile=r.read(8),constraints=r.read(8),level=r.read(8),id=r.ue(31);
 if(![66,77,100].includes(profile)||(constraints&15)!==0)bad();
 if(profile===100&& (r.ue(3)!==1||r.ue(6)!==0||r.ue(6)!==0||r.read(1)!==0||r.read(1)!==0))bad();
 const log2MaxFrameNum=r.ue(12)+4,pocType=r.ue(2);if(pocType===1)bad();
 const log2MaxPocLsb=pocType===0?r.ue(12)+4:null,maxReferenceFrames=r.ue(16);if(r.read(1)!==0)bad();
 const mbWidth=r.ue(134217725)+1,mbHeight=r.ue(134217725)+1;if(r.read(1)!==1)bad();
 const direct8x8=Boolean(r.read(1)),crop=r.read(1)?[r.ue(),r.ue(),r.ue(),r.ue()]:[0,0,0,0];
 const codedWidth=mbWidth*16,codedHeight=mbHeight*16,width=codedWidth-2*(crop[0]+crop[1]),height=codedHeight-2*(crop[2]+crop[3]);
 if(width<=0||height<=0)bad();const observedVui=r.read(1)?vui(r):null;r.end();
 if(observedVui?.restriction&&observedVui.restriction.maxDecFrameBuffering<maxReferenceFrames)bad();
 return {id,profile,constraints,level,chromaFormat:1,bitDepth:8,log2MaxFrameNum,pocType,log2MaxPocLsb,maxReferenceFrames,mbWidth,mbHeight,codedWidth,codedHeight,width,height,direct8x8,crop,vui:observedVui};
}
function pictureParameters(body,spsMap) {
 const r=bitReader(rbsp(body).bytes),id=r.ue(255),spsId=r.ue(31),sps=spsMap.get(spsId);if(!sps)bad();
 const cabac=Boolean(r.read(1)),bottomFieldPocPresent=Boolean(r.read(1));if(bottomFieldPocPresent||r.ue()!==0)bad();
 const refL0=r.ue(31)+1,refL1=r.ue(31)+1,weightedPred=Boolean(r.read(1)),weightedBipredIdc=r.read(2);if(![0,2].includes(weightedBipredIdc))bad();
 const initialQp=r.se(-26,25)+26,initialQs=r.se(-26,25)+26,chromaQpOffset=r.se(-12,12),deblockingPresent=Boolean(r.read(1)),constrainedIntra=Boolean(r.read(1));if(r.read(1)!==0)bad();
 let transform8x8=false,secondChromaQpOffset=chromaQpOffset;
 if(r.more()) {
  // h264_ps.c skips PPS extensions for constrained Baseline/Main; reject the
  // unsupported bits rather than expose fields the native decoder ignores.
  if(sps.profile!==100&&(sps.constraints&0xe0))bad();
  transform8x8=Boolean(r.read(1));if(r.read(1)!==0)bad();secondChromaQpOffset=r.se(-12,12);
 }r.end();
 if(sps.profile===66&&(cabac||weightedPred)||transform8x8&&sps.profile!==100)bad();
 return {id,spsId,cabac,bottomFieldPocPresent,refL0,refL1,weightedPred,weightedBipredIdc,initialQp,initialQs,chromaQpOffset,deblockingPresent,constrainedIntra,transform8x8,secondChromaQpOffset};
}

/** Parameter observations for the native progressive8-bit420 X family:
 * baseline/main/high, flat scaling, POC0/2, no FMO or redundant pictures.
 * Repeated identical parameter bodies remain individually referenced; changed
 * bodies or new parameter IDs after picture data fail. No AU claim is made. */
export function parseH264Parameters(raw,options) {
 const partition=partitionH264Nals(raw,options),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),spsMap=new Map(),ppsMap=new Map();let seenPicture=false;
 for(const nal of partition.nals) {
  if([1,5].includes(nal.type))seenPicture=true;
  if(![7,8].includes(nal.type))continue;
  const body=bytes.subarray(nal.body.beginByte,nal.body.endByte),parsed=nal.type===7?sequenceParameters(body):pictureParameters(body,spsMap),map=nal.type===7?spsMap:ppsMap,previous=map.get(parsed.id);
  if(previous){if(previous.bodySHA256!==nal.body.sha256)bad();previous.nalIndices.push(nal.index);}
  else {if(seenPicture)bad();map.set(parsed.id,{...parsed,bodySHA256:nal.body.sha256,nalIndices:[nal.index]});}
 }
 if(!spsMap.size||!ppsMap.size)bad();return freeze({partition,sps:[...spsMap.values()],pps:[...ppsMap.values()]});
}

function sliceReordering(r,count,maxFrameNum) {
 const entries=[];if(!r.read(1))return entries;
 // Native X writes exactly one short-term operation per active reference.
 for(let i=0;i<count;i++){const idc=r.ue(3);if(idc>1)bad();entries.push({idc,absDiffPicNumMinus1:r.ue(maxFrameNum-1)});}
 if(r.ue(3)!==3)bad();return entries;
}
function sliceWeights(r,count) {
 const lumaDenom=r.ue(7),chromaDenom=r.ue(7),entries=[];
 for(let i=0;i<count;i++) {
  const entry={};if(r.read(1))entry.luma=[r.se(-128,127),r.se(-128,127)];
  if(r.read(1))entry.chroma=[[r.se(-128,127),r.se(-128,127)],[r.se(-128,127),r.se(-128,127)]];entries.push(entry);
 }
 return {lumaDenom,chromaDenom,entries};
}
function sliceHeader(body,nal,ppsMap,spsMap) {
 const r=bitReader(rbsp(body).bytes),firstMb=r.ue(),sliceType=r.ue(9),ppsId=r.ue(255),pps=ppsMap.get(ppsId);
 if(!pps||![5,6,7].includes(sliceType))bad();const sps=spsMap.get(pps.spsId),macroblocks=sps.mbWidth*sps.mbHeight;
 if(!Number.isSafeInteger(macroblocks)||firstMb>=macroblocks)bad();
 const kind=['P','B','I'][sliceType-5],frameNum=r.read(sps.log2MaxFrameNum),maxFrameNum=2**sps.log2MaxFrameNum,isIdr=nal.type===5;
 if(sps.profile===66&&kind==='B'||isIdr&&(kind!=='I'||frameNum!==0))bad();
 const idrPicId=isIdr?r.ue(65535):null,pocLsb=sps.pocType===0?r.read(sps.log2MaxPocLsb):null,directSpatialMvPred=kind==='B'?Boolean(r.read(1)):null;
 let refL0=kind==='I'?0:pps.refL0,refL1=kind==='B'?pps.refL1:0,referenceOverride=false;
 if(kind!=='I'){referenceOverride=Boolean(r.read(1));if(referenceOverride){refL0=r.ue(31)+1;if(kind==='B')refL1=r.ue(31)+1;}}
 if(refL0+refL1>16)bad();
 const reorderingL0=kind!=='I'?sliceReordering(r,refL0,maxFrameNum):[],reorderingL1=kind==='B'?sliceReordering(r,refL1,maxFrameNum):[],weightTable=kind==='P'&&pps.weightedPred?sliceWeights(r,refL0):null,memoryManagement=[];
 let idrMarking=null,adaptiveReferenceMarking=null;
 if(nal.refIdc) {
  if(isIdr){idrMarking={noOutputOfPriorPics:Boolean(r.read(1)),longTermReference:Boolean(r.read(1))};if(idrMarking.noOutputOfPriorPics||idrMarking.longTermReference)bad();}
  else {
   adaptiveReferenceMarking=Boolean(r.read(1));
   if(adaptiveReferenceMarking)while(true){const operation=r.ue(6);if(operation===0)break;if(operation!==1||memoryManagement.length===16)bad();memoryManagement.push({operation,differenceOfPicNumsMinus1:r.ue(maxFrameNum-1)});}
   if(adaptiveReferenceMarking&&!memoryManagement.length)bad();
  }
 }
 const cabacInitIdc=pps.cabac&&kind!=='I'?r.ue(2):null,qpDelta=r.se(-51,51),sliceQp=pps.initialQp+qpDelta;if(sliceQp<0||sliceQp>51)bad();
 let deblocking=null;
 if(pps.deblockingPresent){const idc=r.ue(2);deblocking={idc,alphaOffsetDiv2:idc!==1?r.se(-6,6):null,betaOffsetDiv2:idc!==1?r.se(-6,6):null};}
 const headerBits=r.position();if(pps.cabac)while(r.position()&7)if(r.read(1)!==1)bad();
 const dataStartBit=r.position();if(!r.more())bad();
 return {nalIndex:nal.index,nalType:nal.type,refIdc:nal.refIdc,firstMb,sliceType,kind,ppsId,spsId:sps.id,frameNum,idrPicId,pocLsb,directSpatialMvPred,referenceOverride,refL0,refL1,reorderingL0,reorderingL1,weightTable,idrMarking,adaptiveReferenceMarking,memoryManagement,cabacInitIdc,qpDelta,sliceQp,deblocking,headerBits,dataStartBit};
}

/** Header observations for the pinned progressive X family, not decoded
 * pictures, entropy validation, macroblock coverage or an AU inventory.
 * Bit offsets refer to unescaped RBSP after the NAL header. Original byte
 * spans/hashes remain in parameters.partition; non-VCL syntax stays opaque.
 * Native X emits slice types5/6/7, <=16 active references, short-term list
 * operations and MMCO1 only (encoder.c:213-365; common/base.h:X264_REF_MAX).
 * Decoder survival, AU/POC and source/runtime binding are separate premises. */
export function observeH264SliceHeaders(raw,options) {
 const parameters=parseH264Parameters(raw,options),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),spsMap=new Map(parameters.sps.map(s=>[s.id,s])),ppsMap=new Map(parameters.pps.map(p=>[p.id,p])),slices=[];
 for(const nal of parameters.partition.nals)if(nal.type===1||nal.type===5)slices.push(sliceHeader(bytes.subarray(nal.body.beginByte,nal.body.endByte),nal,ppsMap,spsMap));
 if(!slices.length)bad();return freeze({parameters,slices});
}

function seiPayloadEnd(r,bytes) {
 // X bs_align_10 adds a stop bit only when the payload is not byte-aligned.
 if(r.position()&7)r.end();else if(r.position()!==bytes.length*8)bad();
}
function seiObservations(body,nalIndex,sps) {
 const bytes=rbsp(body).bytes,result=[];let offset=0;
 const extended=()=>{let value=0,part;do{if(offset>=bytes.length)bad();part=bytes[offset++];value+=part;}while(part===255);return value;};
 while(offset<bytes.length-1) {
  const messageBeginByte=offset,type=extended(),size=extended(),payloadBeginByte=offset;if(size>bytes.length-1-offset)bad();
  const payload=bytes.subarray(offset,offset+size);offset+=size;
  const item={nalIndex,type,messageBeginByte,payloadBeginByte,payloadEndByte:offset,payloadSHA256:sha(payload)},r=bitReader(payload),hrd=sps.vui?.nalHrd;
  if(type===0) {
   if(!hrd||sps.vui.vclHrd||hrd.cpb.length!==1)bad();item.spsId=r.ue(31);if(item.spsId!==sps.id)bad();
   item.initialCpbRemovalDelay=r.read(hrd.initialCpbRemovalDelayLength);item.initialCpbRemovalDelayOffset=r.read(hrd.initialCpbRemovalDelayLength);seiPayloadEnd(r,payload);
  } else if(type===1) {
   if(sps.vui?.vclHrd||!hrd&&!sps.vui?.picStructPresent)bad();
   item.cpbRemovalDelay=hrd?r.read(hrd.cpbRemovalDelayLength):null;item.dpbOutputDelay=hrd?r.read(hrd.dpbOutputDelayLength):null;item.picStruct=null;
   if(sps.vui.picStructPresent){item.picStruct=r.read(4);if(item.picStruct!==0||r.read(1)!==0)bad();}seiPayloadEnd(r,payload);
  } else if(type===5) {
   if(size<17||payload.subarray(0,16).toString('hex')!=='dc45e9bde6d948b7962cd820d923eeef'||payload[size-1]!==0||payload.subarray(16,size-1).includes(0))bad();item.uuid=payload.subarray(0,16).toString('hex');
  } else if(type===6) {
   item.recoveryFrameCount=r.ue(65535);item.exactMatch=Boolean(r.read(1));item.brokenLink=Boolean(r.read(1));item.changingSliceGroupIdc=r.read(2);
   if(!item.exactMatch||item.brokenLink||item.changingSliceGroupIdc)bad();seiPayloadEnd(r,payload);
  } else bad();
  result.push(item);
 }
 if(!result.length||offset!==bytes.length-1||bytes[offset]!==128)bad();return result;
}
function accessUnit(group,headers,bytes,index) {
 const {partition,sps}=headers.parameters,first=group.slices[0];if(!first||first.firstMb!==0)bad();
 const activeSps=sps.find(s=>s.id===first.spsId),identityKeys=['nalType','refIdc','sliceType','ppsId','spsId','frameNum','idrPicId','pocLsb','idrMarking','adaptiveReferenceMarking','memoryManagement'];
 for(const slice of group.slices)for(const key of identityKeys)if(JSON.stringify(slice[key])!==JSON.stringify(first[key]))bad();
 let aud=null;const sei=[],filler=[],seenTypes=new Set();
 for(const ni of group.nalIndices) {
  const nal=partition.nals[ni],body=bytes.subarray(nal.body.beginByte,nal.body.endByte);
  if(nal.type===9) {
   if(aud||ni!==group.nalIndices[0])bad();const r=bitReader(rbsp(body).bytes),primaryPicType=r.read(3);r.end();
   if(![0,1,2,7].includes(primaryPicType)||primaryPicType===0&&first.kind!=='I'||primaryPicType===1&&first.kind==='B')bad();aud={nalIndex:ni,primaryPicType};
  } else if(nal.type===6) {
   for(const item of seiObservations(body,ni,activeSps)){if(seenTypes.has(item.type))bad();seenTypes.add(item.type);sei.push(item);}
  } else if(nal.type===12) {
   const data=rbsp(body).bytes;if(ni<first.nalIndex||data[data.length-1]!==128||data.subarray(0,-1).some(value=>value!==255))bad();filler.push({nalIndex:ni,bytes:data.length-1});
  }
 }
 const needsTiming=Boolean(activeSps.vui?.nalHrd||activeSps.vui?.picStructPresent);
 if(activeSps.vui?.vclHrd||seenTypes.has(1)!==needsTiming||first.nalType===5&&activeSps.vui?.nalHrd&&!seenTypes.has(0))bad();
 const beginByte=partition.nals[group.nalIndices[0]].prefix.beginByte,endByte=partition.nals[group.nalIndices.at(-1)].body.endByte;
 return {index,beginByte,endByte,sha256:sha(bytes.subarray(beginByte,endByte)),nalIndices:group.nalIndices,sliceNalIndices:group.slices.map(s=>s.nalIndex),firstSliceNalIndex:first.nalIndex,aud,sei,filler};
}

/** Canonical AU/header observations over complete original elementary bytes.
 * Prefix NALs start the next AU after VCL; decreasing/equal first_mb starts a
 * new picture (h264_parser.c:85-170). Every AU requires first_mb0 and consistent
 * picture identity; payload entropy and macroblock coverage remain unproven.
 * This is NOT native P packet replay: AVCC demux packet boundaries and separate
 * codec extradata must be accounted by container integration. No timestamps,
 * POC, decoder survival or native origin follow from this observation alone. */
export function observeH264AccessUnits(raw,options) {
 const headers=observeH264SliceHeaders(raw,options),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),sliceMap=new Map(headers.slices.map(s=>[s.nalIndex,s])),accessUnits=[];let group={nalIndices:[],slices:[]},hasFiller=false;
 const finish=()=>{accessUnits.push(accessUnit(group,headers,bytes,accessUnits.length));group={nalIndices:[],slices:[]};hasFiller=false;};
 for(const nal of headers.parameters.partition.nals) {
  const slice=sliceMap.get(nal.index),last=group.slices.at(-1);
  if(last&&([6,7,8,9].includes(nal.type)||slice&&slice.firstMb<=last.firstMb))finish();
  if(slice){if(hasFiller)bad();group.slices.push(slice);}if(nal.type===12)hasFiller=true;group.nalIndices.push(nal.index);
 }
 if(group.nalIndices.length)finish();return freeze({headers,accessUnits});
}

/** POC0/2 recurrence for complete progressive pictures beginning at an IDR,
 * with a fixed active SPS and no frame_num gaps/MMCO reset. This follows
 * h264_parse.c:279-365 and h264_parser.c:365-490: frame_num state advances for
 * every picture; previous POC state advances only for reference pictures.
 * Native X's frame_num increments after references (encoder.c:3881-3882).
 * Sorted indices express observed order only: they do not establish native
 * output survival, source ordinal, timestamp identity or contiguous POCs. */
export function observeH264PictureOrder(raw,options) {
 const inventory=observeH264AccessUnits(raw,options),slices=new Map(inventory.headers.slices.map(s=>[s.nalIndex,s])),spsMap=new Map(inventory.headers.parameters.sps.map(s=>[s.id,s])),pictures=[],seen=new Set();
 let epoch=-1,activeSpsId=null,previousIdrPicId=null,previousFrameNum=0,previousFrameNumOffset=0,previousPocMsb=0,previousPocLsb=0,expectedFrameNum=0;
 for(const au of inventory.accessUnits) {
  const slice=slices.get(au.firstSliceNalIndex),sps=spsMap.get(slice.spsId),maxFrameNum=2**sps.log2MaxFrameNum,isIdr=slice.nalType===5;
  if(activeSpsId===null)activeSpsId=sps.id;if(sps.id!==activeSpsId)bad();
  if(isIdr) {
   // A parser boundary alone does not establish a fresh IDR picture. Native
   // non-AVC-Intra X alternates this ID (encoder.c:2613-2633), reusing it later.
   if(previousIdrPicId!==null&&slice.idrPicId!==(previousIdrPicId^1))bad();previousIdrPicId=slice.idrPicId;
   if(slice.frameNum!==0||sps.pocType===0&&slice.pocLsb!==0)bad();epoch++;previousFrameNum=0;previousFrameNumOffset=0;previousPocMsb=0;previousPocLsb=0;expectedFrameNum=0;
  }
  if(epoch<0||slice.frameNum!==expectedFrameNum)bad();
  const frameNumOffset=previousFrameNumOffset+(slice.frameNum<previousFrameNum?maxFrameNum:0);if(frameNumOffset>2147483647)bad();
  let pocMsb=null,poc;
  if(sps.pocType===0) {
   const maxPocLsb=2**sps.log2MaxPocLsb;
   pocMsb=slice.pocLsb<previousPocLsb&&previousPocLsb-slice.pocLsb>=maxPocLsb/2?previousPocMsb+maxPocLsb:slice.pocLsb>previousPocLsb&&slice.pocLsb-previousPocLsb>maxPocLsb/2?previousPocMsb-maxPocLsb:previousPocMsb;
   poc=pocMsb+slice.pocLsb;
  } else poc=2*(frameNumOffset+slice.frameNum)-(slice.refIdc?0:1);
  if(poc<0||poc>2147483647)bad();const key=`${epoch}:${poc}`;if(seen.has(key))bad();seen.add(key);
  pictures.push({auIndex:au.index,firstSliceNalIndex:slice.nalIndex,epoch,spsId:sps.id,frameNum:slice.frameNum,frameNumOffset,pocMsb,poc});
  previousFrameNum=slice.frameNum;previousFrameNumOffset=frameNumOffset;expectedFrameNum=(slice.frameNum+(slice.refIdc?1:0))%maxFrameNum;
  if(slice.refIdc&&sps.pocType===0){previousPocMsb=pocMsb;previousPocLsb=slice.pocLsb;}
 }
 const presentationOrder=[...pictures].sort((a,b)=>a.epoch-b.epoch||a.poc-b.poc).map(p=>p.auIndex);return freeze({inventory,pictures,presentationOrder});
}
