import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inventoryAdtsFrames, parseAacSpecificConfig, partitionFlvBytes, partitionTransportPackets, reassemblePsiSections, reassemblePesPackets, readTransportProgram } from '../../scripts/event-marker-coded-inventory.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function frame(body,channels=2) {
 const size=body.length+7;
 return Buffer.concat([Buffer.from([0xff,0xf1,0x4c|(channels>>2),(channels&3)<<6|(size>>11),(size>>3)&255,(size&7)<<5|31,0xfc]),body]);
}

test('ADTS inventory tiles every original byte into seven-byte headers and raw payloads',()=>{
 // Opaque fixture bodies exercise framing only, not valid AAC decoding.
 const bodies=[Buffer.from([1,2,3]),Buffer.from([4,5])],raw=Buffer.concat(bodies.map(b=>frame(b))),result=inventoryAdtsFrames(raw,{byteCap:raw.length});
 assert.equal(result.sha256,sha(raw));assert.equal(result.bytes,raw.length);assert.equal(result.frames.length,2);
 assert.equal(result.headerBytes,14);assert.equal(result.payloadBytes,5);assert.equal(result.declaredSamples,2048);
 let cursor=0;
 for(const [index,item] of result.frames.entries()) {
  assert.equal(item.index,index);assert.equal(item.sampleRate,48000);assert.equal(item.channels,2);assert.equal(item.objectType,2);
  assert.equal(item.header.beginByte,cursor);assert.equal(item.header.endByte,cursor+7);assert.equal(item.payload.beginByte,cursor+7);cursor=item.payload.endByte;
  assert.equal(item.payload.sha256,sha(bodies[index]));assert.equal(item.sha256,sha(raw.subarray(item.header.beginByte,cursor)));assert.equal(item.originalSHA256,result.sha256);
  assert(Object.isFrozen(item.payload));
 }
 assert.equal(cursor,raw.length);assert(Object.isFrozen(result.frames));
 const mono=inventoryAdtsFrames(frame(Buffer.from([9]),1),{byteCap:8});assert.equal(mono.frames[0].channels,1);
 assert(!Object.hasOwn(result,'decodedSamples'));assert(!Object.hasOwn(result,'consumerReadEOF'));
});

test('ADTS inventory rejects unsupported headers, parameter changes and every unexplained byte',()=>{
 const valid=frame(Buffer.from([1,2,3])),mutate=(index,value)=>{const copy=Buffer.from(valid);copy[index]=value;return copy;};
 const bad=[Buffer.alloc(0),valid.subarray(0,6),valid.subarray(0,-1),Buffer.concat([valid,Buffer.from([0])]),Buffer.concat([Buffer.from([0]),valid]),mutate(0,0xfe),mutate(1,0xf9),mutate(1,0xf3),mutate(1,0xf0),mutate(2,0x0c),mutate(2,0x50),mutate(3,0),mutate(6,0xfd),mutate(5,0),Buffer.concat([valid,frame(Buffer.from([4]),1)])];
 for(const bytes of bad)assert.throws(()=>inventoryAdtsFrames(bytes,{byteCap:1000}),/marker_adts_inventory/);
 assert.throws(()=>inventoryAdtsFrames(valid,{byteCap:valid.length-1}),/marker_adts_inventory/);
 const payload=Buffer.alloc(8184,0x23),largest=inventoryAdtsFrames(frame(payload),{byteCap:8191});assert.equal(largest.frames[0].payload.endByte,8191);
});

test('AAC sequence configuration distinguishes explicit absent SBR from unspecified extension',()=>{
 for(const [config,channels] of [['1190',2],['1188',1]])for(const extension of ['', '56e500']) {
  const raw=Buffer.from(config+extension,'hex'),result=parseAacSpecificConfig(raw);
  assert.equal(result.objectType,2);assert.equal(result.sampleRate,48000);assert.equal(result.channels,channels);assert.equal(result.frameLength,1024);
  assert.equal(result.declaredSbr,extension?false:null);assert.equal(result.sha256,sha(raw));assert.equal(result.bytes,raw.length);assert(Object.isFrozen(result));
 }
 for(const hex of ['', '11', '119000','119056e5','119056e580','119056e501','119056e50000','1210','1180','1194','1192','1191','2990'])assert.throws(()=>parseAacSpecificConfig(Buffer.from(hex,'hex')),/marker_aac_config/);
});

function tag(type,body,timestamp=0) {
 const header=Buffer.alloc(11),previous=Buffer.alloc(4);header[0]=type;header.writeUIntBE(body.length,1,3);header.writeUIntBE(timestamp%16777216,4,3);header[7]=Math.floor(timestamp/16777216);previous.writeUInt32BE(11+body.length);
 return Buffer.concat([header,body,previous]);
}
const flvHeader=Buffer.from('464c5601050000000900000000','hex');
test('FLV physical partition accounts for every header tag body and previous-size byte',()=>{
 const raw=Buffer.concat([flvHeader,tag(18,Buffer.from([2,0])),tag(8,Buffer.from([0xaf,0,0x11,0x90])),tag(9,Buffer.from([0x17,2,0,0,0]),0xfedcba98)]),result=partitionFlvBytes(raw,{byteCap:raw.length});
 assert.equal(result.sha256,sha(raw));assert.equal(result.tags.length,3);assert.equal(result.tags[2].timestamp,0xfedcba98);assert.equal(result.tags[1].type,8);
 let cursor=0;for(const span of result.spans){assert.equal(span.beginByte,cursor);cursor=span.endByte;assert.equal(span.sha256,sha(raw.subarray(span.beginByte,span.endByte)));assert(Object.isFrozen(span));}assert.equal(cursor,raw.length);
 assert.equal(result.spans.length,11);assert.equal(result.tags[1].body,result.spans[6]);assert(!Object.hasOwn(result,'pictures'));
 const extra=Buffer.concat([flvHeader.subarray(0,9),Buffer.from([0,1,2]),flvHeader.subarray(9),tag(8,Buffer.from([0xaf,1,3]))]);extra.writeUInt32BE(12,5);
 assert.equal(partitionFlvBytes(extra,{byteCap:extra.length}).spans[0].endByte,12);
});
test('FLV physical partition rejects hidden trailing truncated filtered or malformed tags',()=>{
 const raw=Buffer.concat([flvHeader,tag(8,Buffer.from([0xaf,1,3]))]);
 const modify=(index,value)=>{const bytes=Buffer.from(raw);bytes[index]=value;return bytes;};
 for(const bytes of [raw.subarray(0,8),raw.subarray(0,-1),Buffer.concat([raw,Buffer.from([0])]),modify(0,0),modify(0,0xc6),modify(3,2),modify(4,0x85),modify(8,8),modify(12,1),modify(13,0x28),modify(13,7),modify(16,255),modify(23,1),modify(raw.length-1,0)])assert.throws(()=>partitionFlvBytes(bytes,{byteCap:1000}),/marker_flv_partition/);
 assert.throws(()=>partitionFlvBytes(raw,{byteCap:raw.length-1}),/marker_flv_partition/);
});

function tsPacket(pid,counter,{adaptation=null,payload=true,start=false}={}) {
 const bytes=Buffer.alloc(188,0xff);bytes[0]=0x47;bytes[1]=(pid>>8)|(start?0x40:0);bytes[2]=pid&255;bytes[3]=(payload?0x10:0)|(adaptation?0x20:0)|counter;
 if(adaptation){bytes[4]=adaptation.length;adaptation.copy(bytes,5);}return bytes;
}
test('TS physical partition preserves every packet header adaptation PCR and payload span',()=>{
 const pcr=Buffer.from([0x10,0,0,0,0,0x7e,1]),adapt=Buffer.alloc(183,0xff);adapt[0]=0;
 const raw=Buffer.concat([tsPacket(256,15,{start:true,adaptation:pcr}),tsPacket(256,15,{adaptation:adapt,payload:false}),tsPacket(256,0),tsPacket(8191,9),tsPacket(8191,3)]);
 const result=partitionTransportPackets(raw,{byteCap:raw.length});assert.equal(result.sha256,sha(raw));assert.equal(result.packets.length,5);assert.equal(result.packets[0].pcrTicks,1);assert.equal(result.packets[0].payloadStart,true);assert.equal(result.packets[1].payload,null);
 let cursor=0;for(const span of result.spans){assert.equal(span.beginByte,cursor);cursor=span.endByte;assert.equal(span.sha256,sha(raw.subarray(span.beginByte,span.endByte)));}assert.equal(cursor,raw.length);assert(Object.isFrozen(result.packets));
 assert.equal(result.packets[2].continuityCounter,0);assert(!Object.hasOwn(result,'accessUnits'));
});
test('TS physical partition rejects loss duplicate payload malformed adaptation and unsupported transport',()=>{
 const raw=tsPacket(256,0),modify=(i,value)=>{const copy=Buffer.from(raw);copy[i]=value;return copy;};
 const bad=[Buffer.alloc(0),raw.subarray(0,-1),Buffer.concat([raw,Buffer.from([0])]),modify(0,0),modify(1,0x81),modify(3,0x90),modify(3,0),Buffer.concat([raw,tsPacket(256,0)]),Buffer.concat([raw,tsPacket(256,2)]),tsPacket(256,0,{adaptation:Buffer.from([0,0])}),tsPacket(256,0,{adaptation:Buffer.from([0x10])}),tsPacket(256,0,{adaptation:Buffer.from([0x80])}),tsPacket(256,0,{adaptation:Buffer.from([0x01])}),tsPacket(256,0,{adaptation:Buffer.from([0x10,0,0,0,0,0,0])}),tsPacket(256,0,{adaptation:Buffer.from([0x10,0,0,0,0,0x7f,255])}),tsPacket(256,0,{adaptation:Buffer.from([0]),payload:false})];
 for(const bytes of bad)assert.throws(()=>partitionTransportPackets(bytes,{byteCap:1000}),/marker_ts_partition/);
 assert.throws(()=>partitionTransportPackets(raw,{byteCap:187}),/marker_ts_partition/);
});

// Fixed MPEG-2 PAT section; CRC independently checked with bitwise polynomial arithmetic.
const pat=Buffer.from('00b00d0001c100000001e100e8f95e7d','hex');
function psiPacket(section,counter=0) {const packet=tsPacket(0,counter,{start:true});packet[4]=0;section.copy(packet,5);return packet;}
test('PSI reassembly retains original payload spans and validates every section CRC',()=>{
 const raw=Buffer.concat([psiPacket(pat),psiPacket(pat,1)]),result=reassemblePsiSections(raw,{byteCap:raw.length,pid:0});
 assert.equal(result.sections.length,2);assert.equal(result.sections[0].sha256,sha(pat));assert.equal(result.sections[0].tableID,0);assert.equal(result.sections[0].tableIDExtension,1);assert.equal(result.sections[0].version,0);
 for(const section of result.sections){const reconstructed=Buffer.concat(section.spans.map(s=>raw.subarray(s.beginByte,s.endByte)));assert.deepEqual(reconstructed,pat);assert(Object.isFrozen(section.spans));}
 const first=tsPacket(0,0,{start:true,adaptation:Buffer.alloc(178,255)});first[5]=0;first[183]=0;pat.subarray(0,4).copy(first,184);
 const second=tsPacket(0,1);pat.subarray(4).copy(second,4);
 const fragmented=Buffer.concat([first,second]),parts=reassemblePsiSections(fragmented,{byteCap:376,pid:0}).sections[0].spans;
 assert.equal(parts[0].beginByte,184);assert.equal(parts.at(-1).endByte,204);assert.deepEqual(Buffer.concat(parts.map(s=>fragmented.subarray(s.beginByte,s.endByte))),pat);
 const continued=tsPacket(0,1,{start:true});continued[4]=12;pat.subarray(4).copy(continued,5);pat.copy(continued,17);
 const joined=Buffer.concat([first,continued]),split=reassemblePsiSections(joined,{byteCap:376,pid:0});assert.equal(split.sections.length,2);
 for(const section of split.sections)assert.deepEqual(Buffer.concat(section.spans.map(s=>joined.subarray(s.beginByte,s.endByte))),pat);
 assert.equal(split.spans.reduce((sum,s)=>sum+s.endByte-s.beginByte,0),189);
});
test('PSI rejects CRC mismatch incomplete section invalid pointers and unexplained continuation bytes',()=>{
 const valid=psiPacket(pat),change=(index,value)=>{const copy=Buffer.from(valid);copy[index]=value;return copy;};
 for(const bytes of [change(5+15,0),change(1,0),change(4,184),change(5+16,0),change(6,0xb3),change(7,0xff),change(10,0)])assert.throws(()=>reassemblePsiSections(bytes,{byteCap:188,pid:0}),/marker_psi_sections/);
 assert.throws(()=>reassemblePsiSections(valid,{byteCap:188,pid:1}),/marker_psi_sections/);
});

function pts(value,prefix) {const n=BigInt(value);return Buffer.from([prefix<<4|Number((n>>30n)&7n)<<1|1,Number((n>>22n)&255n),Number((n>>15n)&127n)<<1|1,Number((n>>7n)&255n),Number(n&127n)<<1|1]);}
function pes(body,{audio=false,unbounded=false,ptsValue=90000,dtsValue=null}={}) {
 const optional=Buffer.concat([pts(ptsValue,dtsValue===null?2:3),...(dtsValue===null?[]:[pts(dtsValue,1)])]),head=Buffer.from([0,0,1,audio?0xc0:0xe0,0,0,0x80,dtsValue===null?0x80:0xc0,optional.length]);
 if(!unbounded)head.writeUInt16BE(body.length+optional.length+3,4);return Buffer.concat([head,optional,body]);
}
function transportPes(bytes,pid,counter=0,firstPayload=184) {
 const packets=[];let used=0;
 while(used<bytes.length){const n=Math.min(bytes.length-used,packets.length?184:firstPayload),adapt=n<184?Buffer.alloc(183-n,255):null;if(adapt?.length)adapt[0]=0;const packet=tsPacket(pid,counter++&15,{start:used===0,adaptation:adapt});bytes.copy(packet,188-n,used,used+n);used+=n;packets.push(packet);}return packets;
}
test('PES inventory splits headers from complete ES spans and preserves original33-bit timestamps',()=>{
 const bodies=[Buffer.alloc(300,0x31),Buffer.from([4,5,6])],first=transportPes(pes(bodies[0],{unbounded:true,ptsValue:8589934590,dtsValue:8589934580}),256,0,5),second=transportPes(pes(bodies[1]),256,first.length),raw=Buffer.concat([...first,...second]);
 const result=reassemblePesPackets(raw,{byteCap:raw.length,pid:256,streamType:'h264'});
 assert.equal(result.packets.length,2);assert.equal(result.payloadBytes,303);assert.equal(result.payloadSHA256,sha(Buffer.concat(bodies)));assert.equal(result.packets[0].pts,8589934590);assert.equal(result.packets[0].dts,8589934580);
 assert.equal(result.packets[0].endReason,'nextStart');assert.equal(result.packets[0].completionPacket,first.length);assert.equal(result.packets[1].endReason,'length');
 for(const [i,item] of result.packets.entries()){assert.deepEqual(Buffer.concat(item.payloadSpans.map(s=>raw.subarray(s.beginByte,s.endByte))),bodies[i]);assert.equal(item.payloadSHA256,sha(bodies[i]));assert.equal(item.payloadSpans[0].logicalOffset,i?300:0);assert(Object.isFrozen(item.payloadSpans));}
 const last=Buffer.concat(transportPes(pes(Buffer.from([9]),{unbounded:true}),256));assert.equal(reassemblePesPackets(last,{byteCap:188,pid:256,streamType:'h264'}).packets[0].endReason,'fileEnd');
 const audio=Buffer.concat(transportPes(pes(Buffer.from([1,2]),{audio:true}),257));assert.equal(reassemblePesPackets(audio,{byteCap:188,pid:257,streamType:'aac'}).packets[0].dts,90000);
});
test('PES inventory rejects missing starts lengths header fields and unsupported timestamp encodings',()=>{
 const original=pes(Buffer.from([1,2,3])),modify=(i,v)=>{const b=Buffer.from(original);b[i]=v;return b;};
 const bad=[original.subarray(0,8),original.subarray(0,-1),Buffer.concat([original,Buffer.from([0])]),modify(2,2),modify(3,0xc0),modify(6,0x84),modify(7,0x40),modify(7,0x81),modify(8,4),modify(9,0x21&~1),modify(11,0),modify(13,0)];
 for(const b of bad){const raw=Buffer.concat(transportPes(b,256));assert.throws(()=>reassemblePesPackets(raw,{byteCap:raw.length,pid:256,streamType:'h264'}),/marker_pes_packets/);}
 const noStart=Buffer.concat(transportPes(original,256));noStart[1]&=~0x40;assert.throws(()=>reassemblePesPackets(noStart,{byteCap:188,pid:256,streamType:'h264'}),/marker_pes_packets/);
 const unbounded=Buffer.concat(transportPes(pes(Buffer.from([1]),{audio:true,unbounded:true}),257));assert.throws(()=>reassemblePesPackets(unbounded,{byteCap:188,pid:257,streamType:'aac'}),/marker_pes_packets/);
});

function section(body) {
 const bytes=Buffer.from(body,'hex');let crc=0xffffffffn;
 for(const value of bytes){crc^=BigInt(value)<<24n;for(let i=0;i<8;i++)crc=((crc<<1n)^((crc&0x80000000n)?0x04c11db7n:0n))&0xffffffffn;}
 const tail=Buffer.alloc(4);tail.writeUInt32BE(Number(crc));return Buffer.concat([bytes,tail]);
}
const pmt=section('02b0170001c10000e101f0001be101f0000fe102f000');
const sdt=section('42f0230001c100000001ff0001fc80124810010646466d7065670753657276696365');
function tablePacket(pid,bytes,counter=0){const packet=psiPacket(bytes,counter);packet[1]=(packet[1]&0xe0)|(pid>>8);packet[2]=pid&255;return packet;}
const program=(extra=[])=>Buffer.concat([tablePacket(0,pat),tablePacket(256,pmt),tablePacket(17,sdt),...extra]);
test('transport program binds stable PAT PMT SDT and accounts for the closed AV PID set',()=>{
 const raw=program([tsPacket(257,0),tsPacket(258,0),tsPacket(8191,0),tablePacket(0,pat,1)]),result=readTransportProgram(raw,{byteCap:raw.length});
 assert.equal(result.programNumber,1);assert.equal(result.transportStreamId,1);assert.equal(result.pmtPid,256);assert.equal(result.pcrPid,257);
 assert.deepEqual(result.streams.map(s=>[s.pid,s.type]),[[257,'h264'],[258,'aac']]);assert.equal(result.pat.sections.length,2);assert.equal(result.service.providerHex,Buffer.from('FFmpeg').toString('hex'));assert.equal(result.service.nameHex,Buffer.from('Service').toString('hex'));assert(Object.isFrozen(result.streams[0]));
});
test('transport program rejects new maps extraneous PIDs unknown descriptors and non-AV streams',()=>{
 const rebuild=(bytes,index,value)=>{const b=Buffer.from(bytes.subarray(0,-4));b[index]=value;return section(b.toString('hex'));};
 const bad=[program([tsPacket(300,0)]),program([tablePacket(0,rebuild(pat,11,1),1)]),Buffer.concat([tablePacket(0,pat),tablePacket(256,rebuild(pmt,12,6)),tablePacket(17,sdt)]),Buffer.concat([tablePacket(0,pat),tablePacket(256,rebuild(pmt,14,2)),tablePacket(17,sdt)]),Buffer.concat([tablePacket(0,pat),tablePacket(256,pmt),tablePacket(17,rebuild(sdt,16,0x49))]),Buffer.concat([tablePacket(0,pat),tablePacket(256,pmt)]),Buffer.concat([tablePacket(0,rebuild(pat,6,1)),tablePacket(256,pmt),tablePacket(17,sdt)])];
 for(const raw of bad)assert.throws(()=>readTransportProgram(raw,{byteCap:raw.length}),/marker_(?:ts_program|psi_sections)/);
});
