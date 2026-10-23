import { gzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { lstat,writeFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export function createArtifactStore(directory,{byteCap=134152192}={}) {
 const entries=new Map();let total=0;
 const path=name=>{if(!/^[a-z0-9][a-z0-9._-]{0,159}$/.test(name))throw Error('artifact_name');return join(directory,name);};
 async function digest(name,cap) {
  const file=path(name),s=await lstat(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('artifact_type');
  if(s.size<1||s.size>cap)throw Error('byte_cap');
  const hash=createHash('sha256');let count=0;
  for await(const b of createReadStream(file)){count+=b.length;if(count>cap)throw Error('byte_cap');hash.update(b);}
  if(count!==s.size)throw Error('artifact_changed');
  return {name,bytes:count,sha256:hash.digest('hex')};
 }
 async function adopt(name,cap) {
  if(entries.has(name))throw Error('duplicate_artifact');
  const entry=await digest(name,cap);if(total+entry.bytes>byteCap)throw Error('byte_cap');
  entries.set(name,entry);total+=entry.bytes;return entry;
 }
 async function write(name,bytes,cap) {
  const file=path(name);
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>cap||total+bytes.length>byteCap)throw Error('byte_cap');
  await writeFile(file,bytes,{flag:'wx',mode:0o600});return adopt(name,cap);
 }
 async function json(name,value,cap) {const raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>8388608)throw Error('byte_cap');return write(name,name.endsWith('.gz')?gzipSync(raw):raw,cap);}
 async function seal() {
  const names=await readdir(directory);
  if(names.length!==entries.size||names.some(n=>!entries.has(n)))throw Error('unlisted_artifact');
  for(const e of entries.values()){const observed=await digest(e.name,e.bytes);if(observed.sha256!==e.sha256||observed.bytes!==e.bytes)throw Error('sha_mismatch');}
  return [...entries.values()];
 }
 return {path,write,json,adopt,seal,get total(){return total;},get entries(){return [...entries.values()];}};
}

/** One invocation's complete budget, including numeric observations and later
 * result shards. The fixed failure reserve is INSIDE both original caps. */
export function createInvocationStore(store,invocation) {
 const aggregate=invocation.kind==='mass'?16777216:invocation.kind==='compressed-source'?67108864:invocation.kind==='literal'?16777216:33554432;
 const numericCap=262144,reserve=65536,initial=new Set(store.entries.map(e=>e.name));
 const entries=()=>store.entries.filter(e=>!initial.has(e.name));
 const numeric=name=>/\.json(?:\.gz)?$/.test(name);
 const total=()=>entries().reduce((n,e)=>n+e.bytes,0),numbers=()=>entries().filter(e=>numeric(e.name)).reduce((n,e)=>n+e.bytes,0);
 const check=(name,bytes)=>{if(!name.startsWith(invocation.id+'-')||total()+bytes>aggregate-reserve||numeric(name)&&numbers()+bytes>numericCap-reserve)throw Error('invocation_byte_cap');};
 const path=name=>{if(!name.startsWith(invocation.id+'-'))throw Error('artifact_name');return store.path(name);};
 async function write(name,bytes,cap){check(name,bytes.length);return store.write(name,bytes,cap);}
 async function json(name,value,cap){const raw=Buffer.from(JSON.stringify(value)+'\n');if(raw.length>8388608)throw Error('invocation_byte_cap');return write(name,name.endsWith('.gz')?gzipSync(raw):raw,cap);}
 async function adopt(name,cap){const s=await lstat(path(name));check(name,s.size);return store.adopt(name,cap);}
 function checkFinal(shards){const size=shards.reduce((n,b)=>n+b.length,0);if(numbers()+size>numericCap||total()+size>aggregate)throw Error('invocation_byte_cap');return {numericBytes:numbers()+size,artifactBytes:total()+size,numericCap,artifactCap:aggregate,failureReserveBytes:reserve};}
 return {path,write,json,adopt,checkFinal,get remainingBytes(){return Math.max(0,aggregate-reserve-total());},get total(){return total();},get artifactBytes(){return total();},get numericBytes(){return numbers();},get entries(){return entries();}};
}
