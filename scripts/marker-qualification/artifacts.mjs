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
 async function json(name,value,cap) {return write(name,Buffer.from(JSON.stringify(value)+'\n'),cap);}
 async function seal() {
  const names=await readdir(directory);
  if(names.length!==entries.size||names.some(n=>!entries.has(n)))throw Error('unlisted_artifact');
  for(const e of entries.values()){const observed=await digest(e.name,e.bytes);if(observed.sha256!==e.sha256||observed.bytes!==e.bytes)throw Error('sha_mismatch');}
  return [...entries.values()];
 }
 return {path,write,json,adopt,seal,get total(){return total;},get entries(){return [...entries.values()];}};
}
