import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partitionH264Nals, parseH264Parameters, observeH264SliceHeaders, observeH264AccessUnits, observeH264PictureOrder } from '../../scripts/event-marker-h264-inventory.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const avcc=bodies=>Buffer.concat(bodies.map(body=>{const size=Buffer.alloc(4);size.writeUInt32BE(body.length);return Buffer.concat([size,body]);}));
const annex=(bodies,lengths=bodies.map(()=>4))=>Buffer.concat(bodies.flatMap((body,i)=>[Buffer.from(lengths[i]===4?[0,0,0,1]:[0,0,1]),body]));

test('H264 framing retains every Annex-B prefix and NAL body without counting non-picture NALs as frames',()=>{
 // Opaque NAL fixtures test framing, not SPS/slice validity or decoded pictures.
 const bodies=['09f0','6742001e80','68ce3c80','06050000030180','658884','0cff80'].map(h=>Buffer.from(h,'hex'));
 const raw=annex(bodies,[4,4,4,3,3,3]),result=partitionH264Nals(raw,{byteCap:raw.length,framing:'annexB'});
 assert.equal(result.sha256,sha(raw));assert.deepEqual(result.nals.map(n=>n.type),[9,7,8,6,5,12]);assert.equal(result.nals[3].emulationPreventionBytes,1);assert.equal(result.nals[3].rbspSHA256,sha(Buffer.from('0500000180','hex')));
 let cursor=0;for(const [i,nal] of result.nals.entries()){assert.equal(nal.prefix.beginByte,cursor);assert.equal(nal.prefix.endByte,nal.body.beginByte);assert.equal(nal.body.sha256,sha(bodies[i]));assert.equal(nal.body.endByte-nal.body.beginByte,bodies[i].length);cursor=nal.body.endByte;assert(Object.isFrozen(nal.body));}assert.equal(cursor,raw.length);
 const lengthPrefixed=avcc(bodies),other=partitionH264Nals(lengthPrefixed,{byteCap:lengthPrefixed.length,framing:'avcc'});assert.deepEqual(other.nals.map(n=>[n.type,n.body.sha256,n.rbspSHA256]),result.nals.map(n=>[n.type,n.body.sha256,n.rbspSHA256]));
 assert(!Object.hasOwn(result,'frames'));assert(!Object.hasOwn(result,'accessUnits'));
});

test('H264 framing rejects ambiguous Annex-B bytes malformed escapes and unsupported headers',()=>{
 for(const hex of ['', '000001','00000000016580','000001658000','000001658000000000016580','000001e580','0000010080','0000016980','0000010780','0000010280','000001658800000080','0000016588000003','00000165880000030480','000001658800000280']) {
  const raw=Buffer.from(hex,'hex');assert.throws(()=>partitionH264Nals(raw,{byteCap:1000,framing:'annexB'}),/marker_h264_inventory/,hex);
 }
 const raw=annex([Buffer.from('6580','hex')]);assert.throws(()=>partitionH264Nals(raw,{byteCap:raw.length-1,framing:'annexB'}),/marker_h264_inventory/);
 for(const bytes of [Buffer.from('00000000','hex'),Buffer.from('000000056580','hex'),Buffer.from('00000002658000','hex')])assert.throws(()=>partitionH264Nals(bytes,{byteCap:100,framing:'avcc'}),/marker_h264_inventory/);
});

const bits=(value,width)=>BigInt(value).toString(2).padStart(width,'0');
const ue=value=>{const b=BigInt(value+1).toString(2);return '0'.repeat(b.length-1)+b;};
const se=value=>ue(value<=0?-2*value:2*value-1);
function nalBits(header,text) {
 const padded=(text+'1').padEnd(Math.ceil((text.length+1)/8)*8,'0'),out=[header];let zeros=0;
 for(let i=0;i<padded.length;i+=8){const byte=parseInt(padded.slice(i,i+8),2);if(zeros===2&&byte<=3){out.push(3);zeros=0;}out.push(byte);zeros=byte===0?zeros+1:0;}return Buffer.from(out);
}
function spsFixture({profile=100,id=0,poc=0,frameOnly=1,gaps=0,logFrame=0,cropBottom=4,chroma=1,hrd=false,maxRefs=4,reorder=2,buffering=4,restriction=true,vuiPresent=true,picStruct=false}={}) {
 let text=bits(profile,8)+bits(profile===66?192:profile===77?64:0,8)+bits(31,8)+ue(id);
 if(profile>=100)text+=ue(chroma)+ue(0)+ue(0)+'00';
 text+=ue(logFrame)+ue(poc)+(poc===0?ue(0):'')+ue(maxRefs)+bits(gaps,1)+ue(39)+ue(22)+bits(frameOnly,1)+'11'+ue(0)+ue(0)+ue(0)+ue(cropBottom);
 if(!vuiPresent)return nalBits(0x67,text+'0');
 text+='1'+'1'+bits(1,8)+'000'+'1'+bits(1001,32)+bits(60000,32)+'1';
 text+=hrd?'1'+ue(0)+bits(0,4)+bits(0,4)+ue(99)+ue(199)+'1'+bits(23,5)+bits(23,5)+bits(23,5)+bits(0,5):'0';
 text+='0'+(hrd?'0':'')+bits(Number(picStruct),1)+(restriction?'11'+ue(0)+ue(0)+ue(10)+ue(10)+ue(reorder)+ue(buffering):'0');
 return nalBits(0x67,text);
}
function ppsFixture({id=0,sps=0,groups=0,redundant=0,bipred=2,extension=true,cabac=1,weighted=1,chromaOffset=-2,secondOffset=-2,transform8x8=1}={}) {
 let text=ue(id)+ue(sps)+bits(cabac,1)+'0'+ue(groups)+ue(0)+ue(0)+bits(weighted,1)+bits(bipred,2)+se(0)+se(0)+se(chromaOffset)+'10'+bits(redundant,1);
 if(extension)text+=bits(transform8x8,1)+'0'+se(secondOffset);return nalBits(0x68,text);
}
test('H264 parameters preserve progressive geometry POC and VUI/HRD operands with immutable original references',()=>{
 for(const profile of [66,77,100])for(const poc of [0,2]) {
  const sps=spsFixture({profile,poc,hrd:true}),pps=ppsFixture({cabac:profile===66?0:1,weighted:profile===66?0:1,bipred:profile===66?0:2,extension:profile===100}),raw=annex([sps,pps,sps,pps]),result=parseH264Parameters(raw,{byteCap:raw.length,framing:'annexB'}),parsed=result.sps[0];
  assert.equal(parsed.profile,profile);assert.equal(parsed.id,0);assert.equal(parsed.pocType,poc);assert.equal(parsed.log2MaxFrameNum,4);assert.equal(parsed.log2MaxPocLsb,poc===0?4:null);
  assert.equal(parsed.codedWidth,640);assert.equal(parsed.codedHeight,368);assert.equal(parsed.width,640);assert.equal(parsed.height,360);assert.deepEqual(parsed.crop,[0,0,0,4]);
  assert.deepEqual(parsed.vui.sar,[1,1]);assert.deepEqual(parsed.vui.timing,{numUnitsInTick:1001,timeScale:60000,fixedFrameRate:true});assert.equal(parsed.vui.nalHrd.cpb[0].bitRateValueMinus1,99);assert.equal(parsed.vui.nalHrd.cpbRemovalDelayLength,24);
  assert.deepEqual(parsed.nalIndices,[0,2]);assert.deepEqual(result.pps[0].nalIndices,[1,3]);assert.equal(result.pps[0].cabac,profile!==66);assert.equal(result.pps[0].weightedBipredIdc,profile===66?0:2);assert.equal(result.pps[0].chromaQpOffset,-2);assert.equal(parsed.bodySHA256,sha(sps));assert(Object.isFrozen(parsed.vui.nalHrd.cpb[0]));
 }
});
test('H264 parameters reject unsupported syntax truncation changed IDs and dangling PPS references',()=>{
 const goodSps=spsFixture(),goodPps=ppsFixture();
 const groups=[...['profile','poc','frameOnly','gaps','logFrame','cropBottom','chroma','id'].map((key,i)=>[spsFixture({[key]:[110,1,0,1,13,200,2,32][i]}),goodPps]),[goodSps,ppsFixture({groups:1})],[goodSps,ppsFixture({redundant:1})],[goodSps,ppsFixture({bipred:1})],[goodSps,ppsFixture({sps:1})],[goodSps,ppsFixture({id:256})],[goodSps,goodPps,spsFixture({cropBottom:3})],[goodSps,goodPps,Buffer.from('6580','hex'),spsFixture({id:1})],[goodSps],[goodPps]];
 for(const bodies of groups){const raw=annex(bodies);assert.throws(()=>parseH264Parameters(raw,{byteCap:raw.length,framing:'annexB'}),/marker_h264_inventory/);}
 for(const cut of [1,2,3,goodSps.length-1]){const raw=avcc([goodSps.subarray(0,cut),goodPps]);assert.throws(()=>parseH264Parameters(raw,{byteCap:raw.length,framing:'avcc'}),/marker_h264_inventory/);}
 const extended=avcc([Buffer.concat([goodSps,Buffer.from([0x80])]),goodPps]);assert.throws(()=>parseH264Parameters(extended,{byteCap:extended.length,framing:'avcc'}),/marker_h264_inventory/);
});

for(const profile of [66,77])test(`constrained profile ${profile} rejects PPS extension bits and preserves the native inferred second offset`,()=>{
 const options={cabac:profile===66?0:1,weighted:profile===66?0:1,bipred:profile===66?0:2,chromaOffset:2,secondOffset:-3,transform8x8:0};
 const ordinary=avcc([spsFixture({profile}),ppsFixture({...options,extension:false})]),parsed=parseH264Parameters(ordinary,{byteCap:ordinary.length,framing:'avcc'}).pps[0];
 assert.equal(parsed.chromaQpOffset,2);assert.equal(parsed.secondChromaQpOffset,2);assert.equal(parsed.transform8x8,false);
 for(const transform8x8 of [0,1]) {
  const high=avcc([spsFixture(),ppsFixture({...options,transform8x8})]),control=parseH264Parameters(high,{byteCap:high.length,framing:'avcc'}).pps[0];
  assert.equal(control.chromaQpOffset,2);assert.equal(control.secondChromaQpOffset,-3);assert.equal(control.transform8x8,Boolean(transform8x8));
 }
 const extended=avcc([spsFixture({profile}),ppsFixture(options)]);assert.throws(()=>parseH264Parameters(extended,{byteCap:extended.length,framing:'avcc'}),/marker_h264_inventory/);
 const reviewer=Buffer.from('00000008674d401eda0a15900000000568ee3240f0','hex');assert.throws(()=>parseH264Parameters(reviewer,{byteCap:reviewer.length,framing:'avcc'}),/marker_h264_inventory/);
});

test('SPS buffering covers references without requiring equality or a present restriction',()=>{
 for(const [maxRefs,buffering,reorder] of [[4,4,2],[3,4,2],[0,0,0]]) {
  const raw=avcc([spsFixture({maxRefs,buffering,reorder}),ppsFixture()]),sps=parseH264Parameters(raw,{byteCap:raw.length,framing:'avcc'}).sps[0];
  assert.equal(sps.maxReferenceFrames,maxRefs);assert.equal(sps.vui.restriction.maxDecFrameBuffering,buffering);assert.equal(sps.vui.restriction.maxReorderFrames,reorder);
 }
 for(const fields of [{restriction:false},{vuiPresent:false}]) {
  const raw=avcc([spsFixture(fields),ppsFixture()]),sps=parseH264Parameters(raw,{byteCap:raw.length,framing:'avcc'}).sps[0];assert.equal(sps.maxReferenceFrames,4);assert.equal(sps.vui?.restriction??null,null);
 }
 for(const buffering of [1,3]){const raw=avcc([spsFixture({maxRefs:4,buffering,reorder:0}),ppsFixture()]);assert.throws(()=>parseH264Parameters(raw,{byteCap:raw.length,framing:'avcc'}),/marker_h264_inventory/);}
 const reviewer=Buffer.from('0000000d6764001eacb2850ad00f162ea00000000468ee3248','hex');assert.throws(()=>parseH264Parameters(reviewer,{byteCap:reviewer.length,framing:'avcc'}),/marker_h264_inventory/);
});

// Synthetic headers followed by opaque data: these are not encoded pictures.
function sliceFixture({type=7,nalType=5,refIdc=3,firstMb=0,pps=0,frameNum=0,poc=0,pocLsb=0,idrId=0,cabac=true,weighted=true,override=null,reorder0=[],reorder1=[],weights=null,mmco=[],idrFlags='00',cabacInit=0,qpDelta=0,deblock=0,alpha=0,beta=0,alignment='1',payload='10110101'}={}) {
 const kind=type%5;let text=ue(firstMb)+ue(type)+ue(pps)+bits(frameNum,4);
 if(nalType===5)text+=ue(idrId);if(poc===0)text+=bits(pocLsb,4);
 if(kind===1)text+='1';
 if(kind===0||kind===1){text+=override?'1'+ue(override[0]-1)+(kind===1?ue(override[1]-1):''):'0';}
 const list=entries=>entries.length?'1'+entries.map(([idc,arg])=>ue(idc)+ue(arg)).join('')+ue(3):'0';
 if(kind!==2)text+=list(reorder0);if(kind===1)text+=list(reorder1);
 if(kind===0&&weighted){text+=ue(weights?.lumaDenom??0)+ue(weights?.chromaDenom??0);for(let i=0;i<(override?.[0]??1);i++){const w=weights?.entries[i];text+=w?.luma?'1'+w.luma.map(se).join(''):'0';text+=w?.chroma?'1'+w.chroma.flat().map(se).join(''):'0';}}
 if(refIdc){if(nalType===5)text+=idrFlags;else text+=mmco.length?'1'+mmco.map(([op,arg])=>ue(op)+ue(arg)).join('')+ue(0):'0';}
 if(cabac&&kind!==2)text+=ue(cabacInit);text+=se(qpDelta)+ue(deblock);if(deblock!==1)text+=se(alpha)+se(beta);
 const headerBits=text.length;if(cabac)text+=alignment.repeat((8-text.length%8)%8);
 return {body:nalBits((refIdc<<5)|nalType,text+payload),headerBits,dataStartBit:text.length};
}
const observeSlices=(bodies,framing='avcc')=>{const raw=framing==='avcc'?avcc(bodies):annex(bodies);return observeH264SliceHeaders(raw,{byteCap:raw.length,framing});};

test('H264 slice headers retain I P B operands for POC0/2 and CABAC/CAVLC with original NAL identities',()=>{
 for(const poc of [0,2])for(const profile of [66,77,100]) {
  const cabac=profile!==66,weighted=cabac,sps=spsFixture({profile,poc}),pps=ppsFixture({cabac:Number(cabac),weighted:Number(weighted),bipred:cabac?2:0,extension:profile===100});
  const specs=[{}, {type:5,nalType:1,refIdc:2,frameNum:1,pocLsb:6}, ...(cabac?[{type:6,nalType:1,refIdc:0,frameNum:2,pocLsb:2}]:[])];
  const fixtures=specs.map(spec=>sliceFixture({...spec,poc,cabac,weighted})),result=observeSlices([sps,pps,...fixtures.map(f=>f.body)]);
  assert.deepEqual(result.slices.map(s=>s.kind),cabac?['I','P','B']:['I','P']);assert.deepEqual(result.slices.map(s=>s.frameNum),cabac?[0,1,2]:[0,1]);assert.deepEqual(result.slices.map(s=>s.pocLsb),poc===2?fixtures.map(()=>null):cabac?[0,6,2]:[0,6]);
  for(const [i,slice] of result.slices.entries()){assert.equal(slice.nalIndex,i+2);assert.equal(slice.ppsId,0);assert.equal(slice.spsId,0);assert.equal(slice.headerBits,fixtures[i].headerBits);assert.equal(slice.dataStartBit,fixtures[i].dataStartBit);assert.equal(result.parameters.partition.nals[slice.nalIndex].body.sha256,sha(fixtures[i].body));assert(Object.isFrozen(slice));}
  assert.equal(result.slices[0].idrPicId,0);assert.equal(result.slices[1].idrPicId,null);assert.equal(result.slices[1].refL0,1);assert.equal(result.slices[1].refL1,0);assert(!Object.hasOwn(result,'accessUnits'));assert(!Object.hasOwn(result,'pictures'));
  assert.deepEqual(observeSlices([sps,pps,...fixtures.map(f=>f.body)],'annexB').slices,result.slices);
 }
});

test('H264 weighted prediction reordering short-term marking and deblocking remain immutable header observations',()=>{
 const weights={lumaDenom:3,chromaDenom:2,entries:[{luma:[-2,7],chroma:[[4,-6],[3,5]]},{}]},p=sliceFixture({type:5,nalType:1,frameNum:3,override:[2],reorder0:[[0,1],[1,2]],weights,mmco:[[1,2],[1,0]],cabacInit:2,qpDelta:-7,deblock:2,alpha:-6,beta:6}),b=sliceFixture({type:6,nalType:1,refIdc:0,override:[2,1],reorder0:[[0,0],[1,1]],reorder1:[[0,2]]});
 const [first,second]=observeSlices([spsFixture(),ppsFixture(),p.body,b.body]).slices;
 assert.deepEqual(first.reorderingL0,[{idc:0,absDiffPicNumMinus1:1},{idc:1,absDiffPicNumMinus1:2}]);assert.deepEqual(first.weightTable,weights);assert.deepEqual(first.memoryManagement,[{operation:1,differenceOfPicNumsMinus1:2},{operation:1,differenceOfPicNumsMinus1:0}]);assert.equal(first.cabacInitIdc,2);assert.equal(first.sliceQp,19);assert.deepEqual(first.deblocking,{idc:2,alphaOffsetDiv2:-6,betaOffsetDiv2:6});assert(Object.isFrozen(first.weightTable.entries[0].chroma[0]));
 assert.equal(second.directSpatialMvPred,true);assert.equal(second.refL0,2);assert.equal(second.refL1,1);assert.equal(second.weightTable,null);assert.deepEqual(second.reorderingL1,[{idc:0,absDiffPicNumMinus1:2}]);assert.deepEqual(second.memoryManagement,[]);
});

test('H264 slice observations reject unsupported or out-of-bound headers without accepting entropy as proof',()=>{
 const p={type:5,nalType:1},cases=[{type:8},{type:0},{pps:1},{firstMb:920},{frameNum:1},{idrId:65536},{idrFlags:'10'},{idrFlags:'01'},{...p,override:[33]},{...p,override:[17]},{type:6,nalType:1,override:[16,1]},{...p,reorder0:[[2,0]]},{...p,reorder0:[[0,16]]},{...p,reorder0:[[0,0],[0,1]]},{...p,mmco:[[5,0]]},{...p,mmco:[[0,0]]},{...p,mmco:Array.from({length:17},()=>[1,0])},{...p,mmco:[[1,16]]},{...p,cabacInit:3},{qpDelta:26},{qpDelta:-27},{deblock:3},{alpha:-7},{beta:7},{firstMb:1,alignment:'0'},{payload:''}];
 for(const fields of cases)assert.throws(()=>observeSlices([spsFixture(),ppsFixture(),sliceFixture(fields).body]),/marker_h264_inventory/,JSON.stringify(fields));
 assert.throws(()=>observeSlices([spsFixture(),ppsFixture()]),/marker_h264_inventory/);
 const body=sliceFixture({...p,weights:{lumaDenom:8,chromaDenom:0,entries:[{}]}}).body;assert.throws(()=>observeSlices([spsFixture(),ppsFixture(),body]),/marker_h264_inventory/);
 const badWeight=sliceFixture({...p,weights:{lumaDenom:0,chromaDenom:0,entries:[{luma:[128,0]}]}}).body;assert.throws(()=>observeSlices([spsFixture(),ppsFixture(),badWeight]),/marker_h264_inventory/);
 const ordinary=sliceFixture().body;for(let length=1;length<ordinary.length-1;length++)assert.throws(()=>observeSlices([spsFixture(),ppsFixture(),ordinary.subarray(0,length)]),/marker_h264_inventory/);
});

test('H264 header-only observations preserve multiple slice starts without inventing picture or macroblock coverage',()=>{
 const bodies=[spsFixture(),ppsFixture(),sliceFixture().body,sliceFixture({firstMb:460}).body],result=observeSlices(bodies);
 assert.deepEqual(result.slices.map(s=>s.firstMb),[0,460]);assert.equal(result.parameters.partition.nals.length,4);assert(!Object.hasOwn(result,'completeMacroblocks'));assert(Object.isFrozen(result.slices));
});


test('H264 bounded header loops retain the supported maximum reference and MMCO operands',()=>{
 const p=sliceFixture({type:5,nalType:1,override:[16],reorder0:Array.from({length:16},()=>[0,0]),mmco:Array.from({length:16},()=>[1,0]),deblock:1}),b=sliceFixture({type:6,nalType:1,refIdc:0,override:[8,8]}),result=observeSlices([spsFixture(),ppsFixture(),sliceFixture().body,p.body,b.body]);
 assert.equal(result.slices[0].headerBits,24);assert.equal(result.slices[0].dataStartBit,24);assert.deepEqual(result.slices[0].idrMarking,{noOutputOfPriorPics:false,longTermReference:false});assert.equal(result.slices[1].refL0,16);assert.equal(result.slices[1].reorderingL0.length,16);assert.equal(result.slices[1].weightTable.entries.length,16);assert.equal(result.slices[1].memoryManagement.length,16);assert.deepEqual(result.slices[1].deblocking,{idc:1,alphaOffsetDiv2:null,betaOffsetDiv2:null});assert.equal(result.slices[2].refL0+result.slices[2].refL1,16);
});

const seiFixture=entries=>{
 const bytes=[];for(const [type,payload] of entries){for(let n=type;n>=255;n-=255)bytes.push(255);bytes.push(type%255);for(let n=payload.length;n>=255;n-=255)bytes.push(255);bytes.push(payload.length%255,...payload);}return nalBits(6,bytes.map(b=>bits(b,8)).join(''));
};
const versionPayload=Buffer.concat([Buffer.from('dc45e9bde6d948b7962cd820d923eeef','hex'),Buffer.from('synthetic version witness\0')]);
const payloadBits=text=>Buffer.from(text.padEnd(Math.ceil(text.length/8)*8,'0').match(/.{8}/g)?.map(b=>parseInt(b,2))??[]);
const alignPayload=text=>payloadBits(text.length%8?text+'1':text);
const observeUnits=(bodies,framing='annexB')=>{const raw=framing==='avcc'?avcc(bodies):annex(bodies);return observeH264AccessUnits(raw,{byteCap:raw.length,framing});};

test('H264 AU observations partition every original NAL and keep multiple slices in one header-consistent picture',()=>{
 const aud=Buffer.from('09f0','hex'),version=seiFixture([[5,versionPayload]]),filler=Buffer.from('0cffff80','hex'),bodies=[aud,spsFixture(),ppsFixture(),version,sliceFixture().body,sliceFixture({firstMb:460}).body,filler,aud,sliceFixture({type:5,nalType:1,frameNum:1,pocLsb:2}).body];
 for(const framing of ['annexB','avcc']) {
  const result=observeUnits(bodies,framing),raw=framing==='avcc'?avcc(bodies):annex(bodies),[first,second]=result.accessUnits;
  assert.deepEqual(result.accessUnits.map(a=>a.nalIndices),[[0,1,2,3,4,5,6],[7,8]]);assert.deepEqual(first.sliceNalIndices,[4,5]);assert.deepEqual(second.sliceNalIndices,[8]);assert.equal(first.firstSliceNalIndex,4);assert.equal(first.beginByte,0);assert.equal(first.endByte,second.beginByte);assert.equal(second.endByte,raw.length);
  for(const unit of result.accessUnits){assert.equal(unit.sha256,sha(raw.subarray(unit.beginByte,unit.endByte)));assert(Object.isFrozen(unit.nalIndices));}
  assert.deepEqual(first.aud,{nalIndex:0,primaryPicType:7});assert.deepEqual(first.filler,[{nalIndex:6,bytes:2}]);assert.equal(first.sei[0].type,5);assert.equal(first.sei[0].payloadSHA256,sha(versionPayload));assert.equal(first.sei[0].uuid,'dc45e9bde6d948b7962cd820d923eeef');assert(!Object.hasOwn(result,'decodedFrames'));assert(!Object.hasOwn(first,'completeMacroblocks'));assert(!Object.hasOwn(first,'poc'));
 }
});

test('H264 HRD and recovery SEI preserve original payload operands without creating timestamps or decoded-frame claims',()=>{
 const buffer=alignPayload(ue(0)+bits(123,24)+bits(456,24)),timing=alignPayload(bits(7,24)+bits(3,24)),recovery=alignPayload(ue(0)+'1000'),raw=[spsFixture({hrd:true}),ppsFixture(),seiFixture([[0,buffer],[5,versionPayload],[1,timing]]),sliceFixture().body,seiFixture([[6,recovery],[1,timing]]),sliceFixture({nalType:1,frameNum:1,pocLsb:2,refIdc:2}).body],result=observeUnits(raw);
 const sei=result.accessUnits[0].sei;assert.deepEqual(sei.map(s=>s.type),[0,5,1]);assert.equal(sei[0].spsId,0);assert.equal(sei[0].initialCpbRemovalDelay,123);assert.equal(sei[0].initialCpbRemovalDelayOffset,456);assert.equal(sei[2].cpbRemovalDelay,7);assert.equal(sei[2].dpbOutputDelay,3);assert.equal(sei[2].picStruct,null);
 assert.equal(result.accessUnits[1].sei[0].recoveryFrameCount,0);assert.equal(result.accessUnits[1].sei[0].exactMatch,true);assert.equal(result.accessUnits[1].sei[0].brokenLink,false);assert(Object.isFrozen(result.accessUnits[1].sei[0]));
});

test('H264 AU grouping rejects orphan prefixes filler placement duplicate metadata and inconsistent picture headers',()=>{
 const start=[spsFixture(),ppsFixture()],i=sliceFixture().body,p=sliceFixture({type:5,nalType:1,frameNum:1,pocLsb:2}).body,v=seiFixture([[5,versionPayload]]),f=Buffer.from('0cff80','hex'),cases=[
  [...start,i,Buffer.from('09f0','hex')],[...start,i,v],[...start,f,i],[...start,i,f,sliceFixture({firstMb:460}).body],[...start,Buffer.from('09f0','hex'),Buffer.from('09f0','hex'),i],
  [...start,i,sliceFixture({firstMb:460,pocLsb:2}).body],[...start,i,sliceFixture({firstMb:460,refIdc:2}).body],[...start,sliceFixture({firstMb:1}).body],[...start,i,sliceFixture({firstMb:460,nalType:1,frameNum:1}).body],
  [...start,seiFixture([[5,versionPayload],[5,versionPayload]]),i],[...start,Buffer.from('09a0','hex'),i],[...start,Buffer.from('0910','hex'),p],[...start,i,Buffer.from('0cff0080','hex')],
 ];
 for(const bodies of cases)assert.throws(()=>observeUnits(bodies),/marker_h264_inventory/);
 // A decreasing positive first_mb starts another native parser unit, which
 // cannot be claimed as a complete supported picture without its first slice.
 assert.throws(()=>observeUnits([...start,i,sliceFixture({firstMb:460}).body,sliceFixture({firstMb:400}).body]),/marker_h264_inventory/);
});

test('H264 SEI rejects unknown malformed truncated and unsupported timing/recovery content',()=>{
 const start=[spsFixture(),ppsFixture()],i=sliceFixture().body;
 for(const nal of [seiFixture([[2,Buffer.from([0])]]),seiFixture([[5,Buffer.alloc(17)]]),seiFixture([[5,versionPayload.subarray(0,-1)]]),seiFixture([[6,alignPayload(ue(0)+'0000')]]),seiFixture([[6,alignPayload(ue(0)+'1100')]]),seiFixture([[6,alignPayload(ue(0)+'1001')]]),seiFixture([[6,alignPayload(ue(65536)+'1000')]]),seiFixture([[1,Buffer.alloc(0)]]),Buffer.from('0605100080','hex'),Buffer.from('06ff80','hex'),Buffer.from('0680','hex')])assert.throws(()=>observeUnits([...start,nal,i]),/marker_h264_inventory/);
 const hrd=[spsFixture({hrd:true}),ppsFixture()],buffer=alignPayload(ue(0)+bits(1,24)+bits(2,24)),timing=alignPayload(bits(0,24)+bits(0,24));
 for(const entries of [[[0,buffer]],[[1,timing]],[[0,buffer],[1,timing],[1,timing]],[[0,alignPayload(ue(1)+bits(1,24)+bits(2,24))],[1,timing]],[[0,buffer],[1,Buffer.concat([timing,Buffer.from([0x80])])]]])assert.throws(()=>observeUnits([...hrd,seiFixture(entries),i]),/marker_h264_inventory/);
});


test('H264 progressive picture timing and extended SEI lengths have exact payload alignment',()=>{
 const sps=spsFixture({picStruct:true}),pps=ppsFixture(),i=sliceFixture().body,timing=alignPayload('00000'),version=Buffer.concat([versionPayload.subarray(0,16),Buffer.alloc(300,65),Buffer.from([0])]),result=observeUnits([sps,pps,seiFixture([[5,version],[1,timing]]),i]);
 assert.equal(result.accessUnits[0].sei[0].payloadEndByte-result.accessUnits[0].sei[0].payloadBeginByte,317);assert.equal(result.accessUnits[0].sei[0].payloadSHA256,sha(version));assert.equal(result.accessUnits[0].sei[1].picStruct,0);assert.equal(result.accessUnits[0].sei[1].cpbRemovalDelay,null);
 for(const payload of [alignPayload('00001'),alignPayload('00010'),Buffer.from([0]),Buffer.from([4,128])])assert.throws(()=>observeUnits([sps,pps,seiFixture([[1,payload]]),i]),/marker_h264_inventory/);
 for(const [picType,spec] of [[0,{}],[1,{type:5,nalType:1}],[2,{type:6,nalType:1,refIdc:0}]]) {
  const observed=observeUnits([nalBits(9,bits(picType,3)),spsFixture(),ppsFixture(),sliceFixture(spec).body]);assert.equal(observed.accessUnits[0].aud.primaryPicType,picType);
 }
});

const pictureOrder=(specs,poc=0)=>{
 const bodies=[spsFixture({poc}),ppsFixture(),...specs.map(spec=>sliceFixture({...spec,poc}).body)],raw=annex(bodies);return observeH264PictureOrder(raw,{byteCap:raw.length,framing:'annexB'});
};
const pSlice=(frameNum,pocLsb)=>({type:5,nalType:1,refIdc:2,frameNum,pocLsb});
const bSlice=(frameNum,pocLsb,refIdc=0)=>({type:6,nalType:1,refIdc,frameNum,pocLsb});

test('H264 POC0 orders B pictures using reference state instead of incrementing by decode position',()=>{
 const observed=pictureOrder([{},pSlice(1,6),bSlice(2,2),bSlice(2,4),pSlice(2,12),bSlice(3,8),bSlice(3,10)]);
 assert.deepEqual(observed.pictures.map(p=>p.poc),[0,6,2,4,12,8,10]);assert.deepEqual(observed.presentationOrder,[0,2,3,1,5,6,4]);assert.deepEqual(observed.pictures.map(p=>p.frameNum),[0,1,2,2,2,3,3]);assert(observed.pictures.every(p=>p.epoch===0));assert(Object.isFrozen(observed.presentationOrder));assert(Object.isFrozen(observed.pictures[0]));assert(!Object.hasOwn(observed,'decodedFrames'));
 const pyramid=pictureOrder([{},pSlice(1,8),bSlice(2,4,2),bSlice(3,2),bSlice(3,6)]);assert.deepEqual(pyramid.pictures.map(p=>p.poc),[0,8,4,2,6]);assert.deepEqual(pyramid.presentationOrder,[0,3,2,4,1]);
});

test('H264 POC0 handles forward and backward LSB wraps and resets only at an IDR boundary',()=>{
 const specs=[{},...[2,4,6,8,10,12,16].map((poc,i)=>pSlice(i+1,poc%16)),bSlice(8,14),pSlice(8,2),{idrId:1},pSlice(1,2)],observed=pictureOrder(specs);
 assert.deepEqual(observed.pictures.map(p=>p.poc),[0,2,4,6,8,10,12,16,14,18,0,2]);assert.deepEqual(observed.pictures.map(p=>p.pocMsb),[0,0,0,0,0,0,0,16,0,16,0,0]);assert.deepEqual(observed.presentationOrder,[0,1,2,3,4,5,6,8,7,9,10,11]);assert.deepEqual(observed.pictures.map(p=>p.epoch),[0,0,0,0,0,0,0,0,0,0,1,1]);
 const half=pictureOrder([{},pSlice(1,8),pSlice(2,0)]);assert.deepEqual(half.pictures.map(p=>p.poc),[0,8,16]);
});

test('H264 POC2 uses frame_num wrap and non-reference offsets while retaining AU identity',()=>{
 const observed=pictureOrder([{},...Array.from({length:19},(_,i)=>pSlice((i+1)%16,0))],2);
 assert.deepEqual(observed.pictures.map(p=>p.poc),Array.from({length:20},(_,i)=>i*2));assert.equal(observed.pictures[15].frameNumOffset,0);assert.equal(observed.pictures[16].frameNumOffset,16);assert.equal(observed.pictures[19].frameNumOffset,16);assert(observed.pictures.every(p=>p.pocMsb===null));assert.deepEqual(observed.presentationOrder,Array.from({length:20},(_,i)=>i));
 for(const [i,picture] of observed.pictures.entries()){assert.equal(picture.auIndex,i);assert.equal(picture.firstSliceNalIndex,observed.inventory.accessUnits[i].firstSliceNalIndex);}
 // This exercises the decoder recurrence, not an assertion that native X's
 // no-B POC2 encoder family would emit this synthetic disposable picture.
 const disposable=pictureOrder([{},pSlice(1,0),bSlice(2,0),pSlice(2,0)],2);assert.deepEqual(disposable.pictures.map(p=>p.poc),[0,2,3,4]);
 const wrapDisposable=pictureOrder([{},...Array.from({length:15},(_,i)=>pSlice(i+1,0)),bSlice(0,0),pSlice(0,0)],2);assert.deepEqual(wrapDisposable.pictures.slice(-2).map(p=>[p.frameNumOffset,p.poc]),[[16,31],[16,32]]);
});

test('H264 picture-order observations reject unanchored gaps duplicate POCs and invalid IDR POC',()=>{
 for(const specs of [[pSlice(0,0)],[{},pSlice(3,2)],[{},pSlice(1,0)],[{pocLsb:2}],[{},pSlice(1,10)]])assert.throws(()=>pictureOrder(specs),/marker_h264_inventory/);
 const changedSps=annex([spsFixture(),ppsFixture(),spsFixture({id:1}),ppsFixture({id:1,sps:1}),sliceFixture().body,sliceFixture({pps:1,idrId:1}).body]);assert.throws(()=>observeH264PictureOrder(changedSps,{byteCap:changedSps.length,framing:'annexB'}),/marker_h264_inventory/);
 const one=pictureOrder([{}, {...pSlice(1,2),firstMb:0},{...pSlice(1,2),firstMb:460}]);assert.equal(one.pictures.length,2);assert.deepEqual(one.presentationOrder,[0,1]);assert.equal(one.inventory.accessUnits[1].sliceNalIndices.length,2);
});


test('H264 IDR epoch transition rejects duplicate headers before resetting the POC duplicate check',()=>{
 const reviewer=Buffer.from('000000016742c01eda0a15900000000168ce324800000001658884ab5800000001658884ab58','hex');
 assert.throws(()=>observeH264PictureOrder(reviewer,{byteCap:reviewer.length,framing:'annexB'}),/marker_h264_inventory/);
 for(const framing of ['annexB','avcc'])for(const poc of [0,2])for(const following of [{},{payload:'11110000'},{idrId:2}]) {
  const bodies=[spsFixture({poc}),ppsFixture(),sliceFixture({poc}).body,sliceFixture({...following,poc}).body],raw=framing==='annexB'?annex(bodies):avcc(bodies);
  assert.throws(()=>observeH264PictureOrder(raw,{byteCap:raw.length,framing}),/marker_h264_inventory/);
 }
 // Intervening non-IDR pictures do not change native X's next IDR ID.
 assert.throws(()=>pictureOrder([{},pSlice(1,2),{}]),/marker_h264_inventory/);
});

test('H264 IDR alternation permits later ID reuse and multiple increasing slices of one IDR',()=>{
 for(const framing of ['annexB','avcc'])for(const poc of [0,2]) {
  const bodies=[spsFixture({poc}),ppsFixture(),...[
   {idrId:0},{idrId:0,firstMb:460},{idrId:1},{idrId:0},{idrId:0,firstMb:460},pSlice(1,2),{idrId:1},
  ].map(spec=>sliceFixture({...spec,poc}).body)],raw=framing==='annexB'?annex(bodies):avcc(bodies),result=observeH264PictureOrder(raw,{byteCap:raw.length,framing});
  assert.deepEqual(result.pictures.map(p=>[p.epoch,p.poc]),[[0,0],[1,0],[2,0],[2,2],[3,0]]);assert.deepEqual(result.presentationOrder,[0,1,2,3,4]);
  assert.deepEqual(result.inventory.accessUnits.map(a=>a.sliceNalIndices.length),[2,1,2,1,1]);
 }
});
