import { createHash } from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('marker_adts_inventory');};

/** Initial ASC for the supported LC48k mono/stereo path. The two-byte form
 * says nothing about a sync extension; only the explicit native encoder form
 * declares SBR absent (aacenc.c:95-122). Payload syntax is still independent. */
export function parseAacSpecificConfig(raw) {
 const bad=()=>{throw Error('marker_aac_config');};
 if(!(raw instanceof Uint8Array)||![2,5].includes(raw.byteLength))bad();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),word=bytes.readUInt16BE(0);
 const objectType=word>>11,frequencyIndex=(word>>7)&15,channels=(word>>3)&15;
 if(objectType!==2||frequencyIndex!==3||![1,2].includes(channels)||(word&7)!==0)bad();
 if(bytes.length===5&&(bytes[2]!==0x56||bytes[3]!==0xe5||bytes[4]!==0))bad();
 return Object.freeze({sha256:sha(bytes),bytes:bytes.length,objectType,sampleRate:48000,channels,frameLength:1024,declaredSbr:bytes.length===5?false:null});
}

/** T4 framing layer only. AAC payload syntax, no SBR/PCE, native decoder
 * survival and full original-container span mapping remain separate checks.
 * Header-declared samples are never a decoded-population certificate.
 * Source: libavcodec/adts_header.c; libavformat/adtsenc.c:128-163. */
export function inventoryAdtsFrames(raw,{byteCap}) {
 if(!(raw instanceof Uint8Array)||!Number.isSafeInteger(byteCap)||byteCap<0||!raw.byteLength||raw.byteLength>byteCap)fail();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),originalSHA256=sha(bytes),frames=[];
 let offset=0,channels,payloadBytes=0;
 while(offset<bytes.length) {
  if(bytes.length-offset<7)fail();
  const b=bytes.subarray(offset,offset+7);
  // Supported MPEG-4 AAC-LC, 48k, one raw block, no CRC. Do not search for
  // later sync words or discard leading/trailing bytes after a bad header.
  if(b[0]!==255||b[1]!==0xf1||(b[2]>>6)!==1||((b[2]>>2)&15)!==3||(b[6]&3)!==0)fail();
  const currentChannels=((b[2]&1)<<2)|(b[3]>>6),length=((b[3]&3)<<11)|(b[4]<<3)|(b[5]>>5);
  if(![1,2].includes(currentChannels)||channels!==undefined&&channels!==currentChannels||length<=7||length>bytes.length-offset)fail();
  channels=currentChannels;
  const span=(beginByte,endByte)=>Object.freeze({beginByte,endByte,sha256:sha(bytes.subarray(beginByte,endByte))});
  frames.push(Object.freeze({index:frames.length,originalSHA256,sha256:sha(bytes.subarray(offset,offset+length)),objectType:2,sampleRate:48000,channels,declaredSamples:1024,header:span(offset,offset+7),payload:span(offset+7,offset+length)}));
  payloadBytes+=length-7;offset+=length;
 }
 return Object.freeze({sha256:originalSHA256,bytes:bytes.length,headerBytes:frames.length*7,payloadBytes,declaredSamples:frames.length*1024,frames:Object.freeze(frames)});
}

/** T4 physical FLV partition. Bodies remain original opaque spans here;
 * AMF/AVC/AAC semantics and stream packet populations require further parsing.
 * Native demux tolerance never authorizes discarded or unexplained bytes. */
export function partitionFlvBytes(raw,{byteCap}) {
 const bad=()=>{throw Error('marker_flv_partition');};
 if(!(raw instanceof Uint8Array)||!Number.isSafeInteger(byteCap)||byteCap<0||raw.byteLength>byteCap||raw.byteLength<13)bad();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),originalSHA256=sha(bytes),spans=[],tags=[];
 if(bytes[0]!==0x46||bytes[1]!==0x4c||bytes[2]!==0x56||bytes[3]!==1||(bytes[4]&~5)!==0)bad();
 const headerBytes=bytes.readUInt32BE(5);if(headerBytes<9||headerBytes>bytes.length-4||bytes.readUInt32BE(headerBytes)!==0)bad();
 const add=(beginByte,endByte,role)=>{const span=Object.freeze({beginByte,endByte,role,sha256:sha(bytes.subarray(beginByte,endByte))});spans.push(span);return span;};
 add(0,headerBytes,'fileHeader');add(headerBytes,headerBytes+4,'firstPreviousTagSize');
 let offset=headerBytes+4;
 while(offset<bytes.length) {
  if(bytes.length-offset<15)bad();
  const type=bytes[offset],length=bytes.readUIntBE(offset+1,3),timestamp=bytes.readUIntBE(offset+4,3)+bytes[offset+7]*16777216;
  if(![8,9,18].includes(type)||length===0||bytes.readUIntBE(offset+8,3)!==0||length>bytes.length-offset-15)bad();
  const bodyBegin=offset+11,bodyEnd=bodyBegin+length;
  if(bytes.readUInt32BE(bodyEnd)!==length+11)bad();
  const header=add(offset,bodyBegin,'tagHeader'),body=add(bodyBegin,bodyEnd,'tagBody'),previousSize=add(bodyEnd,bodyEnd+4,'previousTagSize');
  tags.push(Object.freeze({index:tags.length,type,timestamp,header,body,previousSize}));offset=bodyEnd+4;
 }
 return Object.freeze({sha256:originalSHA256,bytes:bytes.length,flags:bytes[4],spans:Object.freeze(spans),tags:Object.freeze(tags)});
}

/** Exact188-byte physical TS layer (mpegts.c handle_packet; mpegtsenc.c PCR
 * writer). PSI/PES/CRC and AU reassembly are separate mandatory layers.
 * Unsupported transport/adaptation features are rejected, never skipped. */
export function partitionTransportPackets(raw,{byteCap}) {
 const bad=()=>{throw Error('marker_ts_partition');};
 if(!(raw instanceof Uint8Array)||!Number.isSafeInteger(byteCap)||byteCap<0||!raw.byteLength||raw.byteLength>byteCap||raw.byteLength%188)bad();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),spans=[],packets=[],continuity=new Map();
 const add=(beginByte,endByte,role)=>{const span=Object.freeze({beginByte,endByte,role,sha256:sha(bytes.subarray(beginByte,endByte))});spans.push(span);return span;};
 for(let offset=0;offset<bytes.length;offset+=188) {
  const end=offset+188,pid=((bytes[offset+1]&31)<<8)|bytes[offset+2],control=(bytes[offset+3]>>4)&3,counter=bytes[offset+3]&15;
  const payloadStart=Boolean(bytes[offset+1]&64),hasPayload=Boolean(control&1);
  if(bytes[offset]!==0x47||(bytes[offset+1]&128)||(bytes[offset+3]&192)||control===0||payloadStart&&!hasPayload)bad();
  if(pid!==8191&&continuity.has(pid)&&counter!==((continuity.get(pid)+(hasPayload?1:0))&15))bad();
  continuity.set(pid,counter);
  const header=add(offset,offset+4,'packetHeader');let cursor=offset+4,adaptation=null,pcrTicks=null;
  if(control&2) {
   const length=bytes[cursor],adaptEnd=cursor+1+length;
   if(adaptEnd>end||hasPayload&&adaptEnd===end||!hasPayload&&adaptEnd!==end)bad();
   adaptation=add(cursor,adaptEnd,'adaptation');cursor++;
   if(length) {
    const flags=bytes[cursor++];if(flags&0x8f)bad();
    if(flags&16) {
     if(adaptEnd-cursor<6)bad();const p=bytes.subarray(cursor,cursor+6);
     const base=p[0]*33554432+p[1]*131072+p[2]*512+p[3]*2+(p[4]>>7),extension=((p[4]&1)<<8)|p[5];
     if((p[4]&0x7e)!==0x7e||extension>=300)bad();pcrTicks=base*300+extension;cursor+=6;
    }
    for(;cursor<adaptEnd;cursor++)if(bytes[cursor]!==255)bad();
   }
   cursor=adaptEnd;
  }
  const payload=hasPayload?add(cursor,end,'payload'):null;
  packets.push(Object.freeze({index:packets.length,pid,continuityCounter:counter,payloadStart,pcrTicks,header,adaptation,payload}));
 }
 return Object.freeze({sha256:sha(bytes),bytes:bytes.length,spans:Object.freeze(spans),packets:Object.freeze(packets)});
}

/** PSI framing/CRC over original physical spans. Table-specific PAT/PMT/SDT
 * contents, stable maps and complete PID coverage are additional checks. */
export function reassemblePsiSections(raw,{byteCap,pid}) {
 const bad=()=>{throw Error('marker_psi_sections');};
 if(!Number.isInteger(pid)||pid<0||pid>=8191)bad();
 const physical=partitionTransportPackets(raw,{byteCap}),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),sections=[],spans=[];
 let pending=null;
 const span=(beginByte,endByte,role)=>{const item=Object.freeze({beginByte,endByte,role,sha256:sha(bytes.subarray(beginByte,endByte))});spans.push(item);return item;};
 const stuffing=(begin,end)=>{for(let i=begin;i<end;i++)if(bytes[i]!==255)bad();if(begin<end)span(begin,end,'psiStuffing');};
 function consume(begin,end,allowNew) {
  while(begin<end) {
   if(!pending) {
    if(bytes[begin]===255){stuffing(begin,end);return;}
    if(!allowNew)bad();pending={buffer:Buffer.alloc(1024),used:0,total:3,spans:[]};
   }
   const n=Math.min(pending.total-pending.used,end-begin),part=span(begin,begin+n,'psiSection');
   bytes.copy(pending.buffer,pending.used,begin,begin+n);pending.used+=n;pending.spans.push(part);begin+=n;
   if(pending.used===3&&pending.total===3) {
    const b=pending.buffer,length=((b[1]&15)<<8)|b[2];if((b[1]&0xb0)!==0xb0||length<9||length>1021)bad();pending.total=length+3;
   }
   if(pending.used===pending.total) {
    const b=pending.buffer.subarray(0,pending.total);let crc=0xffffffff;
    for(const value of b){crc=(crc^(value<<24))>>>0;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x80000000)?0x04c11db7:0))>>>0;}
    if(crc!==0||(b[5]&0xc1)!==0xc1||b[6]>b[7])bad();
    sections.push(Object.freeze({index:sections.length,sha256:sha(b),bytes:b.length,tableID:b[0],tableIDExtension:b.readUInt16BE(3),version:(b[5]>>1)&31,number:b[6],lastNumber:b[7],spans:Object.freeze(pending.spans)}));pending=null;
   }
  }
 }
 for(const packet of physical.packets)if(packet.pid===pid&&packet.payload) {
  let begin=packet.payload.beginByte;const end=packet.payload.endByte;
  if(packet.payloadStart) {
   const pointer=bytes[begin];span(begin,begin+1,'psiPointer');begin++;
   if(pointer>end-begin)bad();
   if(pending)consume(begin,begin+pointer,false);else stuffing(begin,begin+pointer);
   if(pending)bad();begin+=pointer;consume(begin,end,true);
  }else {
   if(!pending)bad();consume(begin,end,false);
  }
 }
 if(pending||!sections.length)bad();return Object.freeze({sha256:physical.sha256,bytes:physical.bytes,pid,sections:Object.freeze(sections),spans:Object.freeze(spans)});
}

/** PES framing from the complete original TS, preserving exact33-bit PTS/DTS.
 * File-end delimitation of zero-length video PES is a byte fact, not native
 * consumer EOF. PES packets are not H264/AAC parser packets or access units. */
export function reassemblePesPackets(raw,{byteCap,pid,streamType}) {
 const bad=()=>{throw Error('marker_pes_packets');};
 if(!Number.isInteger(pid)||pid<32||pid>=8191||!['h264','aac'].includes(streamType))bad();
 const physical=partitionTransportPackets(raw,{byteCap}),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),packets=[],payloadHash=createHash('sha256');
 let pending=null,payloadBytes=0,nativeStreamId;
 const timestamp=(b,offset,prefix)=>{
  if((b[offset]>>4)!==prefix||!(b[offset]&1)||!(b[offset+2]&1)||!(b[offset+4]&1))bad();
  return ((b[offset]>>1)&7)*1073741824+b[offset+1]*4194304+(b[offset+2]>>1)*32768+b[offset+3]*128+(b[offset+4]>>1);
 };
 function finish(endReason,completionPacket) {
  if(!pending||pending.bytes<9)bad();
  const h=pending.header,id=h[3],declared=h.readUInt16BE(4),headerBytes=9+h[8],flags=h[7];
  if(h[0]!==0||h[1]!==0||h[2]!==1||(streamType==='h264'?(id&0xf0)!==0xe0:(id&0xe0)!==0xc0)||nativeStreamId!==undefined&&nativeStreamId!==id)bad();
  nativeStreamId=id;
  if(h[6]!==0x80||![0,0x80,0xc0].includes(flags)||headerBytes>=pending.bytes||declared&&declared+6!==pending.bytes||!declared&&streamType!=='h264')bad();
  const required=flags===0xc0?10:flags===0x80?5:0;if(h[8]<required)bad();
  for(let i=9+required;i<headerBytes;i++)if(h[i]!==255)bad();
  const pts=required?timestamp(h,9,flags>>6):null,dts=flags===0xc0?timestamp(h,14,1):pts;
  const headerSpans=[],payloadSpans=[],packetHash=createHash('sha256');let consumed=0,logicalOffset=payloadBytes;
  for(const item of pending.spans) {
   let begin=item.beginByte;const end=item.endByte;
   if(consumed<headerBytes){const count=Math.min(end-begin,headerBytes-consumed);headerSpans.push(Object.freeze({beginByte:begin,endByte:begin+count,sha256:sha(bytes.subarray(begin,begin+count))}));begin+=count;consumed+=count;}
   if(begin<end){const value=bytes.subarray(begin,end);payloadSpans.push(Object.freeze({beginByte:begin,endByte:end,logicalOffset,sha256:sha(value)}));packetHash.update(value);payloadHash.update(value);logicalOffset+=value.length;consumed+=value.length;}
  }
  packets.push(Object.freeze({index:packets.length,pid,streamId:id,pts,dts,declaredLength:declared,bytes:pending.bytes,sha256:pending.hash.digest('hex'),headerBytes,payloadBytes:pending.bytes-headerBytes,payloadSHA256:packetHash.digest('hex'),headerSpans:Object.freeze(headerSpans),payloadSpans:Object.freeze(payloadSpans),firstTransportPacket:pending.firstTransportPacket,completionPacket,endReason}));
  payloadBytes=logicalOffset;pending=null;
 }
 for(const packet of physical.packets)if(packet.pid===pid&&packet.payload) {
  if(packet.payloadStart){if(pending)finish('nextStart',packet.index);pending={bytes:0,header:Buffer.alloc(264),spans:[],hash:createHash('sha256'),firstTransportPacket:packet.index};}
  if(!pending)bad();const span=packet.payload,value=bytes.subarray(span.beginByte,span.endByte);
  if(pending.bytes<264)value.copy(pending.header,pending.bytes,0,Math.min(value.length,264-pending.bytes));
  pending.bytes+=value.length;pending.spans.push(span);pending.hash.update(value);
  if(pending.bytes>=6){const declared=pending.header.readUInt16BE(4);if(declared&&pending.bytes>declared+6)bad();if(declared&&pending.bytes===declared+6)finish('length',packet.index);}
 }
 if(pending)finish('fileEnd',null);if(!packets.length)bad();
 return Object.freeze({sha256:physical.sha256,bytes:physical.bytes,pid,streamType,payloadBytes,payloadSHA256:payloadHash.digest('hex'),packets:Object.freeze(packets)});
}

/** Single immutable AV program from the supported mux family. Every observed
 * PID has a declared physical role. PES/AU contents remain separately checked;
 * this map alone asserts no decoder, encoder or runtime conservation. */
export function readTransportProgram(raw,{byteCap}) {
 const bad=()=>{throw Error('marker_ts_program');};
 const physical=partitionTransportPackets(raw,{byteCap}),bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength);
 function table(pid,tableID,privateBit) {
  const observed=reassemblePsiSections(raw,{byteCap,pid}),first=observed.sections[0];
  if(observed.sections.some(s=>s.tableID!==tableID||s.number!==0||s.lastNumber!==0||s.sha256!==first.sha256))bad();
  const data=Buffer.concat(first.spans.map(s=>bytes.subarray(s.beginByte,s.endByte)));
  if((data[1]&0x40)!==privateBit)bad();return {observed,data};
 }
 const pat=table(0,0,0),p=pat.data;
 if(p.length!==16||(p[10]&0xe0)!==0xe0)bad();
 const programNumber=p.readUInt16BE(8),pmtPid=p.readUInt16BE(10)&8191,transportStreamId=p.readUInt16BE(3);
 if(!programNumber||pmtPid<32||pmtPid===8191)bad();
 const pmt=table(pmtPid,2,0),m=pmt.data,streams=[];
 if(m.length<16||m.readUInt16BE(3)!==programNumber||(m[8]&0xe0)!==0xe0||m.readUInt16BE(10)!==0xf000)bad();
 const pcrPid=m.readUInt16BE(8)&8191;let cursor=12;
 while(cursor<m.length-4) {
  if(m.length-4-cursor<5||(m[cursor+1]&0xe0)!==0xe0||(m[cursor+3]&0xf0)!==0xf0)bad();
  const code=m[cursor],pid=m.readUInt16BE(cursor+1)&8191,size=m.readUInt16BE(cursor+3)&4095,end=cursor+5+size,descriptors=[];
  if(![0x1b,0x0f].includes(code)||pid<32||[8191,pmtPid].includes(pid)||streams.some(s=>s.pid===pid||s.type===(code===0x1b?'h264':'aac'))||end>m.length-4)bad();
  cursor+=5;
  while(cursor<end) {
   if(end-cursor<2||code!==0x0f||m[cursor]!==0x0a)bad();const length=m[cursor+1];cursor+=2;
   if(!length||length%4||length>end-cursor)bad();
   for(let i=0;i<length;i+=4){const language=m.subarray(cursor+i,cursor+i+3);if([...language].some(b=>b<97||b>122)||m[cursor+i+3]>3)bad();descriptors.push(Object.freeze({language:language.toString('ascii'),audioType:m[cursor+i+3]}));}cursor+=length;
  }
  streams.push(Object.freeze({pid,type:code===0x1b?'h264':'aac',descriptors:Object.freeze(descriptors)}));
 }
 if(streams.length!==2||!streams.some(s=>s.pid===pcrPid))bad();
 const sdt=table(17,0x42,0x40),s=sdt.data;
 if(s.length<23||s.readUInt16BE(3)!==transportStreamId||s[10]!==255||s.readUInt16BE(11)!==programNumber||s[13]!==0xfc||(s[14]&0xf0)!==0x80)bad();
 const descriptionBytes=s.readUInt16BE(14)&4095,end=16+descriptionBytes;
 if(end!==s.length-4||s[16]!==0x48||s[17]+2!==descriptionBytes||s[18]!==1)bad();
 const providerLength=s[19],nameLengthOffset=20+providerLength;
 if(nameLengthOffset>=end||nameLengthOffset+1+s[nameLengthOffset]!==end)bad();
 const service=Object.freeze({originalNetworkId:s.readUInt16BE(8),providerHex:s.subarray(20,nameLengthOffset).toString('hex'),nameHex:s.subarray(nameLengthOffset+1,end).toString('hex')});
 const allowed=new Set([0,17,pmtPid,8191,...streams.map(s=>s.pid)]);
 if(physical.packets.some(packet=>!allowed.has(packet.pid)))bad();
 return Object.freeze({sha256:physical.sha256,bytes:physical.bytes,transportStreamId,programNumber,pmtPid,pcrPid,streams:Object.freeze(streams),service,pat:pat.observed,pmt:pmt.observed,sdt:sdt.observed});
}
