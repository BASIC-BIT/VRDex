import { createHash } from 'node:crypto';
import { gzipSync, inflateRawSync } from 'node:zlib';
const sha=value=>createHash('sha256').update(value).digest('hex');
const safe=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('marker_raw_bound');return n;};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const MEMBER_BYTES=65536;
/** Count/hash before retention, with one fixed member buffer. Exhausting a
 * retention bound closes the prefix, while later observed bytes still enter
 * the full count/hash. Native EOF and process success are separate evidence. */
export function createRawCapture({producerCap,remainingBytes}) {
 safe(producerCap);safe(remainingBytes);
 const observedHash=createHash('sha256'),retainedHash=createHash('sha256'),compressedHash=createHash('sha256'),pending=Buffer.alloc(MEMBER_BYTES),members=[];
 let observedBytes=0,inputBytes=0,retainedBytes=0,compressedBytes=0,filled=0,retentionStopped=false,result;
 function flush() {
  const raw=pending.subarray(0,filled),member=gzipSync(raw,{level:9,mtime:0});
  if(compressedBytes+member.length>remainingBytes){retentionStopped=true;filled=0;return;}
  retainedHash.update(raw);compressedHash.update(member);retainedBytes+=filled;compressedBytes+=member.length;
  members.push({bytes:member.length,sha256:sha(member),data:member.toString('base64')});filled=0;
 }
 function write(chunk) {
  if(result)throw Error('marker_raw_closed');if(!(chunk instanceof Uint8Array))throw Error('marker_raw_type');
  const bytes=Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength);observedBytes=safe(observedBytes+bytes.length);observedHash.update(bytes);
  let offset=0;
  while(offset<bytes.length&&inputBytes<producerCap&&!retentionStopped) {
   const count=Math.min(bytes.length-offset,MEMBER_BYTES-filled,producerCap-inputBytes);
   bytes.copy(pending,filled,offset,offset+count);filled+=count;inputBytes+=count;offset+=count;if(filled===MEMBER_BYTES)flush();
  }
  return {observedBytes,producerExceeded:observedBytes>producerCap,retentionStopped};
 }
 function finish() {
  if(result)return result;
  if(!retentionStopped&&(filled||observedBytes===0))flush();
  const observedSHA256=observedHash.digest('hex');
  result=freeze({originalBytes:observedBytes,originalSHA256:observedSHA256,observedBytes,observedSHA256,retainedBytes,retainedSHA256:retainedHash.digest('hex'),compressedBytes,compressedSHA256:compressedHash.digest('hex'),complete:retainedBytes===observedBytes&&members.length>0,members});return result;
 }
 return {write,finish};
}
function crc32(data) {
 let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
/** Lossless bounded member capture. The caller charges compressed bytes and
 * this numeric catalog against its original role/aggregate budget. */
export function captureRawMembers(raw,{producerCap,remainingBytes}) {
 if(!(raw instanceof Uint8Array))throw Error('marker_raw_type');safe(producerCap);safe(remainingBytes);
 const buffer=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),members=[];let retainedBytes=0,compressedBytes=0;
 for(let at=0;at<Math.min(buffer.length,producerCap);at+=MEMBER_BYTES) {
  const input=buffer.subarray(at,Math.min(at+MEMBER_BYTES,buffer.length,producerCap));
  const member=gzipSync(input,{level:9,mtime:0});
  if(compressedBytes+member.length>remainingBytes)break;
  members.push({bytes:member.length,sha256:sha(member),data:member.toString('base64')});retainedBytes+=input.length;compressedBytes+=member.length;
 }
 // Empty streams still have a complete gzip member and the SHA of empty data.
 if(!buffer.length){const member=gzipSync(buffer,{level:9,mtime:0});if(member.length<=remainingBytes){members.push({bytes:member.length,sha256:sha(member),data:member.toString('base64')});compressedBytes=member.length;}}
 const compressed=Buffer.concat(members.map(m=>Buffer.from(m.data,'base64')));
 return {originalBytes:buffer.length,originalSHA256:sha(buffer),observedBytes:buffer.length,observedSHA256:sha(buffer),retainedBytes,retainedSHA256:sha(buffer.subarray(0,retainedBytes)),compressedBytes,compressedSHA256:sha(compressed),complete:retainedBytes===buffer.length&&members.length>0,members};
}
function decodeMember(member,cap) {
 if(!member||typeof member.data!=='string'||!Number.isSafeInteger(member.bytes)||member.bytes<20||member.data.length!==4*Math.ceil(member.bytes/3))throw Error('marker_raw_member');
 const buffer=Buffer.from(member.data,'base64');
 if(buffer.length!==member.bytes||buffer.toString('base64')!==member.data||sha(buffer)!==member.sha256||buffer.readUInt16LE(0)!==0x8b1f||buffer[2]!==8||buffer[3]!==0||buffer.readUInt32LE(4)!==0)throw Error('marker_raw_member');
 let result;
 try {result=inflateRawSync(buffer.subarray(10),{maxOutputLength:Math.max(1,Math.min(MEMBER_BYTES,cap)),info:true});}catch{throw Error('marker_raw_decompression');}
 const end=10+result.engine.bytesWritten,raw=result.buffer;
 if(end+8!==buffer.length||raw.length>cap||raw.length>MEMBER_BYTES||buffer.readUInt32LE(end)!==crc32(raw)||buffer.readUInt32LE(end+4)!==raw.length)throw Error('marker_raw_member');
 return {raw,buffer};
}
/** Producer caps come from trusted role policy, never from the catalog. Every
 * deflate end, trailer and member is consumed; trailing zeros are rejected. */
export function replayRawMembers(capture,{producerCap,requireComplete=true}) {
 safe(producerCap);
 for(const field of ['originalBytes','observedBytes','retainedBytes','compressedBytes'])safe(capture[field]);
 if(typeof capture.complete!=='boolean'||capture.retainedBytes>producerCap||capture.retainedBytes>capture.observedBytes||capture.originalBytes!==capture.observedBytes||!Array.isArray(capture.members)||capture.members.length>Math.ceil(producerCap/MEMBER_BYTES)+1||capture.complete&&capture.observedBytes>producerCap)throw Error('marker_raw_bound');
 if(requireComplete&&capture.complete!==true)throw Error('marker_raw_incomplete');
 const chunks=[],compressed=[];let count=0;
 for(const [index,member] of capture.members.entries()) {
  const decoded=decodeMember(member,producerCap-count);count+=decoded.raw.length;chunks.push(decoded.raw);compressed.push(decoded.buffer);
  if(index<capture.members.length-1&&decoded.raw.length!==MEMBER_BYTES)throw Error('marker_raw_member');
 }
 const raw=Buffer.concat(chunks),stored=Buffer.concat(compressed);
 if(count!==capture.retainedBytes||sha(raw)!==capture.retainedSHA256||stored.length!==capture.compressedBytes||sha(stored)!==capture.compressedSHA256||capture.complete&&(count!==capture.originalBytes||capture.originalSHA256!==capture.retainedSHA256||capture.observedSHA256!==capture.retainedSHA256))throw Error('marker_raw_conservation');
 return raw;
}
const stages=new Set(['feed','encode','inventory','decode','parse','reference','clock','classify','associate','serialize','retain']);
function prefix(text,cap) {
 let prefix=text.slice(0,cap);
 while(Buffer.byteLength(prefix)>cap)prefix=prefix.slice(0,-1);
 if(prefix.length&&/[\uD800-\uDBFF]/.test(prefix.at(-1)))prefix=prefix.slice(0,-1);
 return prefix;
}
const serializedBytes=value=>Buffer.byteLength(JSON.stringify(value));
const PRIMARY_BYTES=8192,SECONDARY_BYTES=2048,SECONDARY_ENTRY_BYTES=1536;
function errorEnvelope({recordKey,inputSHA,stage,completedPrerequisites,native,error}) {
 const originals=Object.fromEntries(['name','message','stack','code'].map(key=>[key,String(error?.[key]??'')]));
 const fields={},reducers=[];let exactComplete=true;
 const descriptor=(text,cap,get,set)=>{
  const fullBytes=Buffer.byteLength(text),sha256=sha(text),summary=bytes=>({fullBytes,sha256,prefix:prefix(text,bytes)});
  if(fullBytes>cap){set(summary(cap));exactComplete=false;}
  reducers.push({cap,get,set,summary});
 };
 for(const [key,cap] of [['name',64],['message',2048],['stack',4096],['code',128]]) {
  fields[key]=originals[key];descriptor(originals[key],cap,()=>fields[key],value=>{fields[key]=value;});
 }
 const nativeText=JSON.stringify(native??null);let nativeFact=structuredClone(native??null);
 descriptor(nativeText,512,()=>nativeFact,value=>{nativeFact=value;});
 const envelope={recordKey,inputSHA,stage,completedPrerequisites:[...completedPrerequisites],native:nativeFact,error:fields,exactComplete,reason:exactComplete?null:'error_repr_overflow'};
 const bytes=()=>{envelope.native=nativeFact;return serializedBytes(envelope);};
 if(bytes()>PRIMARY_BYTES) {
  envelope.exactComplete=false;envelope.reason='error_repr_overflow';
  // Fixed metadata remains exact. Only error/native prefixes are reduced,
  // using their actual escaped JSON contribution and final envelope bytes.
  while(bytes()>PRIMARY_BYTES) {
   const choices=reducers.map(r=>({r,saving:serializedBytes(r.get())-serializedBytes(r.summary(0))})).filter(c=>c.saving>0).sort((a,b)=>b.saving-a.saving);
   if(!choices.length)throw Error('marker_error_envelope_bound');
   const {r}=choices[0];r.set(r.summary(0));
   if(bytes()>PRIMARY_BYTES)continue;
   let low=0,high=r.cap;
   while(low<high){const middle=Math.ceil((low+high)/2);r.set(r.summary(middle));if(bytes()<=PRIMARY_BYTES)low=middle;else high=middle-1;}
   r.set(r.summary(low));
  }
 }
 if(bytes()>PRIMARY_BYTES)throw Error('marker_error_envelope_bound');
 return freeze(envelope);
}
/** Per-record write-once failure journal. Parsing/retention cannot overwrite
 * the primary stage or manufacture completed prerequisites for another role. */
export function createRecordFailure({recordKey,inputSHA}) {
 if(typeof recordKey!=='string'||Buffer.byteLength(recordKey)>128||!/^[0-9a-f]{64}$/.test(inputSHA))throw Error('marker_error_binding');
 let primary,entryBytes=0,count=0,totalBytes=0,overflowCount=0,overflowBytes=0;
 const secondary=[],allHash=createHash('sha256'),overflowHash=createHash('sha256');
 const summary=()=>({count,bytes:totalBytes,sha256:allHash.copy().digest('hex'),overflowCount,overflowBytes,overflowSha256:overflowHash.copy().digest('hex')});
 const record=({stage,completedPrerequisites,native,error})=>{
  if(!stages.has(stage)||!Array.isArray(completedPrerequisites)||completedPrerequisites.length>16||completedPrerequisites.some(s=>typeof s!=='string'||Buffer.byteLength(s)>64))throw Error('marker_error_stage');
  const envelope=errorEnvelope({recordKey,inputSHA,stage,completedPrerequisites,native,error});
  if(!primary){primary=envelope;return envelope;}
  const serialized=JSON.stringify(envelope),length=Buffer.byteLength(serialized);
  count=safe(count+1);totalBytes=safe(totalBytes+length);allHash.update(serialized+'\n');
  // Each recording gets 2048 bytes of the existing native/partial-catalog
  // reserve. Up to 1536 bytes retain entries; 512 cover counters/hashes/JSON.
  // Full error envelopes fit when possible; otherwise retain a small summary.
  let retained=envelope,needed=length+1;
  if(entryBytes+needed>SECONDARY_ENTRY_BYTES) {
   const message=envelope.error.message;
   retained=freeze({stage,fullBytes:length,sha256:sha(serialized),messagePrefix:prefix(typeof message==='string'?message:message.prefix,128)});needed=serializedBytes(retained)+1;
  }
  if(entryBytes+needed<=SECONDARY_ENTRY_BYTES){secondary.push(retained);entryBytes+=needed;}
  else {overflowCount=safe(overflowCount+1);overflowBytes=safe(overflowBytes+length);overflowHash.update(serialized+'\n');}
  return envelope;
 };
 const snapshot=()=>{
  const journal={secondary:Object.freeze([...secondary]),secondarySummary:freeze(summary())};
  if(serializedBytes(journal)>SECONDARY_BYTES)throw Error('marker_secondary_bound');
  return Object.freeze({primary,...journal});
 };
 return {record,snapshot};
}
