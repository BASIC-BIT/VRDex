import { MARKER_WIRE_LAYOUTS, MARKER_WIRE_ENUMS } from './event-marker-wire-layout.mjs';
export const MARKER_WIRE_SCHEMA='marker-wire-v2';
const fail=()=>{throw Error('marker_wire');};
const kinds={u8:[1,0,255,'UInt8'],i8:[1,-128,127,'Int8'],u16:[2,0,65535,'UInt16LE'],i16:[2,-32768,32767,'Int16LE'],u32:[4,0,4294967295,'UInt32LE'],i64:[8,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'BigInt64LE'],u64:[8,0,Number.MAX_SAFE_INTEGER,'BigUInt64LE'],f64:[8,null,null,'DoubleLE'],sha256:[32]};
function layoutFor(kind){return MARKER_WIRE_LAYOUTS[kind]??fail();}
function write(buffer,offset,type,value) {
 const [size,min,max,method]=kinds[type];
 if(type==='sha256'){if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))fail();Buffer.from(value,'hex').copy(buffer,offset);}
 else if(type==='f64'){if(typeof value!=='number'||!Number.isFinite(value))fail();buffer.writeDoubleLE(value,offset);}
 else {if(!Number.isSafeInteger(value)||value<min||value>max)fail();buffer['write'+method](size===8?BigInt(value):value,offset);}
}
function read(buffer,offset,type) {
 const [size,,,method]=kinds[type];
 if(type==='sha256')return buffer.subarray(offset,offset+size).toString('hex');
 const value=buffer['read'+method](offset),n=typeof value==='bigint'?Number(value):value;
 if(type==='f64'?!Number.isFinite(n):!Number.isSafeInteger(n))fail();return n;
}
function packBytes(kind,values) {
 const layout=layoutFor(kind),buffer=Buffer.alloc(layout.bytes);
 if(!values||Object.keys(values).length!==layout.fields.length)fail();
 for(const [name,type,count,offset] of layout.fields) {
  if(!Object.hasOwn(values,name))fail();const entries=count===1?[values[name]]:values[name];
  if(!Array.isArray(entries)||entries.length!==count)fail();
  for(let index=0;index<count;index++) {
   if(!Object.hasOwn(entries,index))fail();
   write(buffer,offset+index*kinds[type][0],type,entries[index]);
  }
 }return buffer;
}
function unpackBytes(kind,buffer) {
 const layout=layoutFor(kind);if(buffer.length!==layout.bytes)fail();
 return Object.fromEntries(layout.fields.map(([name,type,count,offset])=>{
  const entries=Array.from({length:count},(_,i)=>read(buffer,offset+i*kinds[type][0],type));return [name,count===1?entries[0]:entries];
 }));
}
function unbase64(value,maxBytes) {
 if(typeof value!=='string'||value.length>4*Math.ceil(maxBytes/3)||value.length%4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail();
 const buffer=Buffer.from(value,'base64');if(buffer.length>maxBytes||buffer.toString('base64')!==value)fail();return buffer;
}
/** Structural codec only. A decoded leaf is not a clock or media certificate. */
export const packMarkerLeaf=(kind,values)=>packBytes(kind,values).toString('base64');
export const unpackMarkerLeaf=(kind,value)=>unpackBytes(kind,unbase64(value,layoutFor(kind).bytes));
export function packMarkerContext(header,pairs,dispositions) {
 if(!Array.isArray(pairs)||!Array.isArray(dispositions)||pairs.length>256||dispositions.length>8192||header.pairDispositionCounts?.[0]!==pairs.length||header.pairDispositionCounts?.[1]!==dispositions.length||64+12*pairs.length+5*dispositions.length>765)fail();
 return Buffer.concat([packBytes('contextHeader',header),...pairs.map(p=>packBytes('contextPair',p)),...dispositions.map(d=>packBytes('contextDisposition',d))]).toString('base64');
}
export function unpackMarkerContext(value) {
 const buffer=unbase64(value,765);if(buffer.length<64)fail();
 const header=unpackBytes('contextHeader',buffer.subarray(0,64)),[p,d]=header.pairDispositionCounts;
 if(p>256||d>8192||64+12*p+5*d!==buffer.length)fail();
 const pairs=Array.from({length:p},(_,i)=>unpackBytes('contextPair',buffer.subarray(64+12*i,76+12*i)));
 const dispositions=Array.from({length:d},(_,i)=>unpackBytes('contextDisposition',buffer.subarray(64+12*p+5*i,69+12*p+5*i)));
 return {header,pairs,dispositions};
}
export function packAudioEpisode(episode) {
 const values={};
 for(const [key,side] of [['firstLoudLeft','left'],['lastLoudRight','right'],['closureRight','right']]) {
  if(episode[key]?.side!==side)fail();
  for(const field of ['ordinal','row','inRow','raw'])values[`${key}.${field}`]=episode[key][field];
 }
 values.class=MARKER_WIRE_ENUMS.class[episode.identity];values.reason=MARKER_WIRE_ENUMS.reason[episode.reason];
 values['prelude.kind']=MARKER_WIRE_ENUMS.prelude[episode.prelude?.kind];
 for(const key of ['row','offset','count','owner'])values[`prelude.${key}`]=episode.prelude?.[key];
 const absent=(value,missing)=>{if(missing){if(value!==null)fail();return 0;}return value;};
 for(const [i,key] of ['a','b'].entries()) {
  const f=episode.fits?.[i];if(!f||![0,1,2].includes(f.code)||![0,1,2].includes(f.guard?.code))fail();
  values[`${key}.score`]=f.score;values[`${key}.code`]=f.code;values[`${key}.guardCode`]=f.guard.code;
  for(const [wire,field] of [['opening','openingGate'],['closing','closingGate'],['residual','maxResidual'],['maxAt','maxResidualAt']])values[`${key}.${wire}`]=absent(f[field],f.code!==0);
  for(const [wire,field] of [['guardOpening','openingGate'],['guardResidual','maxResidual'],['guardMaxAt','maxResidualAt']])values[`${key}.${wire}`]=absent(f.guard[field],f.guard.code!==2);
 }
 for(const key of ['windows','hits','firstPair'])values[`local.${key}`]=episode.local?.[key];
 values['local.amplitudes']=episode.local?.amplitudes.map(v=>absent(v,episode.local.firstPair===-1));
 return packMarkerLeaf('episode',values);
}
/** Exact envelope accounting is structural, never semantic/capture admission.
 * Headers include epochs/watermarks; the original 1024-byte failure reserve
 * stays inside both the combined-header and 512 KiB total limits. */
export function inspectMarkerEnvelope(envelope) {
 if(!Array.isArray(envelope)||envelope.length!==2||envelope[0]!==2||!Array.isArray(envelope[1]))throw Error('marker_schema');
 const records=envelope[1];let epochRows=0,references=0;
 for(const record of records) {
  if(!Array.isArray(record)||record.length!==6)throw Error('marker_wire_record');
  const header=unpackMarkerLeaf('header',record[0]),[version,mode,fps,reserved]=header.versionModeFpsReserved;
  if(version!==2||![0,1].includes(mode)||![30,60].includes(fps)||reserved!==0||header.quantum!==(mode===0?0:720))throw Error('marker_wire_header');
  for(const [index,kind,limit,wire] of [[1,'episode',4096,256],[2,'visual',4096,48],[3,'epoch',32,23],[4,'watermark',64,96],[5,'context',16,1024]]) {
   const rows=record[index];if(!Array.isArray(rows)||rows.length>limit)throw Error(`marker_${kind}_bound`);
   for(const row of rows) {
    if(typeof row!=='string'||Buffer.byteLength(JSON.stringify(row))+1>wire)throw Error(`marker_${kind}_wire_bound`);
    if(kind==='context'){const context=unpackMarkerContext(row);references+=context.pairs.length+context.dispositions.length;}
    else unpackMarkerLeaf(kind,row);
   }
  }
  epochRows+=record[3].length;
 }
 if(references>8192)throw Error('marker_reference_bound');
 const headers=[2,records.map(r=>[r[0],r[3],r[4]])],headersWithReserve=Buffer.byteLength(JSON.stringify(headers))+1024,bytes=Buffer.byteLength(JSON.stringify(envelope))+1024;
 if(headersWithReserve>8192||bytes>524288)throw Error('marker_evidence_bound');
 return {bytes,headersWithReserve,epochRows,references,reservedFailureBytes:1024};
}
export function packMarkerEnvelope(records) {
 const envelope=structuredClone([2,records]);inspectMarkerEnvelope(envelope);
 const freeze=x=>{if(Array.isArray(x)){x.forEach(freeze);Object.freeze(x);}};freeze(envelope);return envelope;
}
