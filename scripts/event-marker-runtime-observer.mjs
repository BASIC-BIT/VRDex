import { open,lstat,stat,readlink,readdir,realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { release } from 'node:os';
import { createHash } from 'node:crypto';
import { inspectAcquiredDependencies } from './event-marker-native-binding.mjs';
import { captureRawMembers,replayRawMembers } from './event-marker-raw-capture.mjs';
import { parseProcessStat } from './marker-qualification/owner.mjs';
import { sha,same,requireProgram } from './event-marker-program-guards.mjs';
import { validateMountView,assertMaterialPath,assertCatalogAlias } from './event-marker-platform-view.mjs';
const check=(v,r)=>requireProgram(v,'G1',r);

async function boundedOriginal(path,cap,control) {
 control.check();const file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);const chunks=[];let count=0;
 try{for(;;){control.check();const b=Buffer.alloc(Math.min(65536,cap-count+1)),{bytesRead}=await file.read(b);control.check();if(!bytesRead)break;count+=bytesRead;check(count<=cap,'runtime_cap');chunks.push(b.subarray(0,bytesRead));}return Buffer.concat(chunks);}finally{await file.close();}
}
const defaults={read:boundedOriginal,lstat,stat,readlink,readdir,realpath,kernel:release};
const identity=s=>({dev:String(s.dev),ino:String(s.ino),bytes:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const rootIdentity=s=>({dev:String(s.dev),ino:String(s.ino)});
const namedTuple=(n,i)=>[i,n.bytes,Buffer.from(n.sha256,'hex').toString('base64'),n.identity.dev,n.identity.ino,n.identity.mtimeMs,n.identity.ctimeMs,n.links.map(l=>l.target)];
/** Bounded ELF64 little-endian metadata, read from the same open descriptor
 * that is fully hashed. Dynamic names and interpreter remain named-file facts. */
async function namedObject(object,control,io) {
 const links=[];for(const link of object.links){control.check();const observed=await io.readlink(link.path);check(observed===link.target,'link');links.push({path:link.path,target:observed});}
 const before=await io.lstat(object.path);check(before.isFile()&&!before.isSymbolicLink()&&before.size===object.bytes,'named_type');
 const bytes=await io.read(object.path,object.bytes,control),after=await io.lstat(object.path);check(same(identity(before),identity(after))&&bytes.length===object.bytes&&sha(bytes)===object.sha256,'named_changed');
 const elf=parseElfIdentity(bytes);check(same(elf,object.elf),'elf');return {id:object.id,path:object.path,sha256:sha(bytes),bytes:bytes.length,identity:identity(after),links,elf};
}
export function parseElfIdentity(bytes) {
 check(bytes instanceof Uint8Array&&bytes.length>=64,'elf');const b=Buffer.from(bytes);check(b.subarray(0,7).equals(Buffer.from([127,69,76,70,2,1,1]))&&b.readUInt16LE(18)===62,'elf');
 const number=n=>{check(n<=BigInt(Number.MAX_SAFE_INTEGER),'elf_range');return Number(n);},ph=number(b.readBigUInt64LE(32)),size=b.readUInt16LE(54),count=b.readUInt16LE(56);check(size===56&&count>0&&count<=256&&ph+size*count<=b.length,'elf_range');
 const headers=Array.from({length:count},(_,i)=>{const p=ph+i*size;return {type:b.readUInt32LE(p),offset:number(b.readBigUInt64LE(p+8)),vaddr:number(b.readBigUInt64LE(p+16)),bytes:number(b.readBigUInt64LE(p+32))};});
 for(const h of headers)check(h.offset+h.bytes<=b.length,'elf_range');
 const cstring=(offset,end)=>{check(offset>=0&&offset<end&&end<=b.length,'elf_string');const zero=b.indexOf(0,offset);check(zero>=offset&&zero<end,'elf_string');return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(offset,zero));};
 const interpreter=headers.find(h=>h.type===3);const dynamic=headers.filter(h=>h.type===2);check(dynamic.length<=1,'elf_dynamic');let needed=[],rpath=null,runpath=null,soname=null;
 if(dynamic.length){const h=dynamic[0],rows=[];check(h.bytes%16===0,'elf_dynamic');let ended=false;for(let p=h.offset;p<h.offset+h.bytes;p+=16){const tag=number(b.readBigUInt64LE(p)),value=number(b.readBigUInt64LE(p+8));if(tag===0){ended=true;break;}rows.push({tag,value});}check(ended,'elf_dynamic');
  const str=rows.find(r=>r.tag===5),len=rows.find(r=>r.tag===10);check(str&&len,'elf_string');const load=headers.find(h=>h.type===1&&str.value>=h.vaddr&&str.value+len.value<=h.vaddr+h.bytes);check(load,'elf_string');const offset=load.offset+str.value-load.vaddr,get=r=>cstring(offset+r.value,offset+len.value);
  needed=rows.filter(r=>r.tag===1).map(get);for(const [tag,key] of [[15,'rpath'],[29,'runpath'],[14,'soname']]){const values=rows.filter(r=>r.tag===tag);check(values.length<=1,'elf_dynamic');const value=values.length?get(values[0]):null;if(key==='rpath')rpath=value;else if(key==='runpath')runpath=value;else soname=value;}
 }
 let buildId=null;for(const h of headers.filter(h=>h.type===4)){let p=h.offset;while(p<h.offset+h.bytes){check(p+12<=h.offset+h.bytes,'elf_note');const name=b.readUInt32LE(p),desc=b.readUInt32LE(p+4),type=b.readUInt32LE(p+8),np=p+12,dp=np+Math.ceil(name/4)*4,next=dp+Math.ceil(desc/4)*4;check(next<=h.offset+h.bytes,'elf_note');if(type===3&&b.subarray(np,np+name).equals(Buffer.from('GNU\0'))){check(buildId===null,'elf_note');buildId=b.subarray(dp,dp+desc).toString('hex');}p=next;}}
 return {class:64,machine:62,type:b.readUInt16LE(16),interpreter:interpreter?cstring(interpreter.offset,interpreter.offset+interpreter.bytes):null,needed,rpath,runpath,soname,buildId};
}
function environment(raw) {const b=Buffer.from(raw);check(b.at(-1)===0,'process_environment');const entries=b.subarray(0,-1).toString('utf8').split('\0').map(v=>{const at=v.indexOf('=');check(at>0,'process_environment');return [v.slice(0,at),v.slice(at+1)];});check(new Set(entries.map(([k])=>k)).size===entries.length,'process_environment');return Object.fromEntries(entries);}
export function parseProgramMaps(raw,profile,mounts) {
 const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);check(text.endsWith('\n'),'maps');const rows=[];
 for(const line of text.trimEnd().split('\n')){const m=/^([0-9a-f]+)-([0-9a-f]+) ([r-][w-][x-][ps]) ([0-9a-f]+) ([0-9a-f]+:[0-9a-f]+) (\d+)(?: +(.*))?$/.exec(line);check(m&&BigInt('0x'+m[1])<BigInt('0x'+m[2]),'maps');const name=m[7]??'',executable=m[3][2]==='x';check(!name.endsWith(' (deleted)'),'deleted_mapping');let object=null;
  if(name.startsWith('/')){object=profile.objects.find(o=>o.path===name||o.aliases.includes(name));check(object,'unknown_object');assertCatalogAlias(name,object);if(mounts)assertMaterialPath(name,mounts,profile.platform.view);}else if(executable)check(name==='[vdso]'&&profile.platform.vdso===true,'anonymous_executable');
  rows.push({start:m[1],end:m[2],permissions:m[3],offset:m[4],device:m[5],inode:m[6],path:name,objectId:object?.id??null});
 }check(rows.some(r=>r.objectId===profile.executable.id&&r.permissions[2]==='x'),'executable_mapping');return rows;
}

async function snapshot(pid,profile,control,io,transport) {
 const originals={},read=async(name,path,cap)=>{const raw=await control.run(()=>io.read(path,cap,control));originals[name]=Buffer.from(raw);return raw;},link=async path=>{const value=await control.run(()=>io.readlink(path));check(Buffer.byteLength(value)<=4096,'link_cap');return value;};
 const before=parseProcessStat((await read('statBefore',`/proc/${pid}/stat`,8192)).toString());check(before.pid===pid&&before.parent===process.pid&&before.group===pid&&before.live,'process_identity');
 const maps=await read('maps',`/proc/${pid}/maps`,1048576),rows=parseProgramMaps(maps,profile);
 const cmdline=await read('cmdline',`/proc/${pid}/cmdline`,16384),env=await read('environ',`/proc/${pid}/environ`,65536),mountinfo=await read('mountinfo',`/proc/${pid}/mountinfo`,65536);
 const executable=await link(`/proc/${pid}/exe`),root=await link(`/proc/${pid}/root`),rootStat=rootIdentity(await control.run(()=>io.stat(`/proc/${pid}/root`))),namespaces={};
 for(const name of profile.platform.namespaces){check(['mnt','pid','user','uts','ipc','net','cgroup','time'].includes(name),'namespace');namespaces[name]=await link(`/proc/${pid}/ns/${name}`);}
 const fds={},fdStats={},names=await control.run(()=>io.readdir(`/proc/${pid}/fd`));check(names.length<=64,'fd_cap');
 for(const fd of names){check(/^\d+$/.test(fd),'fd');fds[fd]=await link(`/proc/${pid}/fd/${fd}`);const s=await control.run(()=>io.stat(`/proc/${pid}/fd/${fd}`));fdStats[fd]={...identity(s),regular:s.isFile(),nlink:s.nlink};}
 const after=parseProcessStat((await read('statAfter',`/proc/${pid}/stat`,8192)).toString());check(same(before,after),'process_reuse');
 const values=environment(env);check(!Object.keys(values).some(k=>/^(LD_|DYLD_)/.test(k)||['FFREPORT','AV_LOG_FORCE_COLOR'].includes(k)),'environment');
 for(const [name,value] of Object.entries(profile.environment))check(values[name]===value,'environment');
 const mounts=validateMountView(mountinfo,profile.platform.view,transport);parseProgramMaps(maps,profile,mounts);check(executable===profile.executable.path&&io.kernel()===profile.platform.kernelRelease,'platform_view');
 return {identity:before,executable,root,rootStat,namespaces,fds,fdStats,argv:Buffer.from(cmdline).toString('utf8').split('\0').slice(0,-1),environment:values,maps:rows,originals};
}
/** Prelaunch named-file checks and the immediate same-child observer. Only
 * filesystem/process IO is injectable; guard interpretation is never injected. */
export async function prepareInvocationObserver(binding,argv,control,providedIO={}) {
 const deps=inspectAcquiredDependencies(binding);if(!deps)return null;const io={...defaults,...providedIO},profile=deps.profile,named=[];
 for(const command of ['ffmpeg','ffprobe']){let resolved;for(const directory of profile.environment.PATH.split(':')){check(directory.startsWith('/')&&!directory.split('/').includes('..'),'executable_resolution');const path=directory+'/'+command;try{const s=await control.run(()=>io.lstat(path));if(s.isFile()||s.isSymbolicLink()){resolved=await control.run(()=>io.realpath(path));break;}}catch(error){if(error.code!=='ENOENT')throw error;}}check(resolved===profile.objects.find(o=>o.semantic===command)?.path,'executable_resolution');}
 for(const object of profile.objects)named.push(await control.run(()=>namedObject(object,control,io)));
 const view={root:await control.run(()=>io.readlink('/proc/self/root')),rootStat:rootIdentity(await control.run(()=>io.stat('/proc/self/root'))),mountinfo:await control.run(()=>io.read('/proc/self/mountinfo',65536,control)),namespaces:{},kernel:io.kernel()};
 for(const name of profile.platform.namespaces)view.namespaces[name]=await control.run(()=>io.readlink('/proc/self/ns/'+name));
 const mounts=validateMountView(view.mountinfo,profile.platform.view,deps.intent.transport);for(const path of [...profile.objects.flatMap(o=>[o.path,...o.aliases,...o.links.map(l=>l.path)]),...deps.closure.files.filter(f=>f.loaded).map(f=>'/app/'+f.path)])assertMaterialPath(path,mounts,profile.platform.view);check(view.kernel===profile.platform.kernelRelease,'platform_view');
 return {attach(child,onError){
  let startupPromise,terminalPromise,carry='',mapping=false,mappingRows=0,sequence=0;const events=[];
  const note=kind=>events.push({sequence:sequence++,kind});
  const take=()=>snapshot(child.pid,profile,control,io,deps.intent.transport);
  function diagnostics(chunk){carry+=chunk.toString('utf8');check(Buffer.byteLength(carry)<=1048576,'diagnostic_cap');let at;while((at=carry.indexOf('\n'))>=0){const line=carry.slice(0,at);carry=carry.slice(at+1);if(/\[info\] Stream mapping:$/.test(line)){check(!mapping,'mapping_repeat');mapping=true;note('mapping');}else if(mapping&&/(?:\[info\] )?  Stream #\d+:\d+ -> #\d+:\d+/.test(line)){mappingRows++;if(mappingRows===2){note('startup-request');startupPromise=control.run(take).then(value=>{note('startup-complete');return value;});startupPromise.catch(()=>{});}}}}
  let progressCarry='';function progress(chunk){progressCarry+=chunk.toString('utf8');check(Buffer.byteLength(progressCarry)<=1048576,'progress_cap');if(/(?:^|\n)progress=end\n/.test(progressCarry)&&!terminalPromise){note('terminal-request');terminalPromise=control.run(take).catch(error=>({absence:{code:error.code,message:error.message}})).then(value=>{note('terminal-complete');return value;});}progressCarry=progressCarry.slice(progressCarry.lastIndexOf('\n')+1);}
  child.once('close',()=>note('native-close'));
  child.stderr.on('data',chunk=>{try{diagnostics(chunk);}catch(error){onError(error);}});child.stdio[argv.progressFd].on('data',chunk=>{try{progress(chunk);}catch(error){onError(error);}});
  return {async finish(terminal){
   const startup=await startupPromise;check(startup&&mappingRows===2,'startup_missing');check(same(startup.argv.slice(1),argv.args)&&same(startup.namespaces,view.namespaces)&&startup.root===view.root&&same(startup.rootStat,view.rootStat)&&sha(startup.originals.mountinfo)===sha(view.mountinfo),'owned_launch');
   if(!terminalPromise){note('terminal-request-after-close');terminalPromise=control.run(take).catch(error=>({absence:{code:error.code,message:error.message}}));}
   const final=await terminalPromise;
   if(final.absence){check(['ENOENT','ESRCH'].includes(final.absence.code)&&terminal.exitCode===0&&terminal.signal===null&&!child.nativeError,'exit_before_read');let absent;try{await control.run(()=>io.read(`/proc/${child.pid}/stat`,8192,control));}catch(error){absent=error.code;}check(['ENOENT','ESRCH'].includes(absent),'exit_before_read');note('absence-after-owned-close');const mount=await control.run(()=>io.read('/proc/self/mountinfo',65536,control));check(sha(mount)===sha(view.mountinfo),'visibility_changed');final.absence.confirmation={path:`/proc/${child.pid}/stat`,code:absent,mountinfo:{bytes:mount.length,sha256:sha(mount),data:mount.toString('base64')}};}
   else check(same(startup.identity,final.identity)&&same(startup.namespaces,final.namespaces)&&startup.root===final.root&&same(startup.rootStat,final.rootStat)&&sha(startup.originals.mountinfo)===sha(final.originals.mountinfo),'terminal_identity');
   const after=[];for(const [i,object] of profile.objects.entries()){const s=await control.run(()=>io.lstat(object.path)),links=[];check(s.isFile()&&!s.isSymbolicLink()&&same(identity(s),named[i].identity),'named_changed');for(const link of object.links){const value=await control.run(()=>io.readlink(link.path));check(value===link.target,'link');links.push(value);}after.push([i,String(s.dev),String(s.ino),s.mtimeMs,s.ctimeMs,links]);}
   const compact=sample=>{if(sample.absence)return sample;const {originals,maps:derivedMaps,argv:derivedArgv,environment:derivedEnvironment,...facts}=sample;return {...facts,originals:Object.fromEntries(Object.entries(originals).map(([key,b])=>[key,key==='maps'?{channel:'proc-maps',capture:captureRawMembers(b,{producerCap:1048576,remainingBytes:196608})}:{bytes:b.length,sha256:sha(b),data:b.toString('base64')}]))};};
   return {kind:'InvocationObservations',namedDigestEncoding:'sha256-base64',pid:child.pid,ownerPid:process.pid,native:terminal,events,startup:compact(startup),terminal:compact(final),namedBefore:named.map(namedTuple),namedAfter:after,visibility:{mountinfo:{bytes:view.mountinfo.length,sha256:sha(view.mountinfo),data:view.mountinfo.toString('base64')},root:view.root,rootStat:view.rootStat,namespaces:view.namespaces,kernel:view.kernel},nativeBindingVerified:false,loaderComplete:false};
  }};
 }};
}

export function verifyInvocationObservations(observation,binding,argv,{role,file,fileIdentity}) {
 const deps=inspectAcquiredDependencies(binding);check(deps&&observation?.kind==='InvocationObservations','runtime_missing');const {profile}=deps;
 check(observation.nativeBindingVerified===false&&observation.loaderComplete===false,'runtime_flags');
 const parentMount=Buffer.from(observation.visibility.mountinfo.data,'base64');check(parentMount.length===observation.visibility.mountinfo.bytes&&sha(parentMount)===observation.visibility.mountinfo.sha256&&observation.visibility.kernel===profile.platform.kernelRelease,'platform_view');const mounts=validateMountView(parentMount,profile.platform.view,deps.intent.transport);for(const path of [...profile.objects.flatMap(o=>[o.path,...o.aliases,...o.links.map(l=>l.path)]),...deps.closure.files.filter(f=>f.loaded).map(f=>'/app/'+f.path)])assertMaterialPath(path,mounts,profile.platform.view);
 const order=kind=>{const found=observation.events.filter(e=>e.kind===kind);check(found.length===1,'runtime_events');return found[0].sequence;};check(observation.events.every((e,i)=>e.sequence===i)&&order('mapping')<order('startup-request')&&order('startup-request')<order('startup-complete')&&order('startup-complete')<order('native-close'),'runtime_events');
 check(observation.namedDigestEncoding==='sha256-base64'&&observation.namedBefore.length===profile.objects.length&&observation.namedAfter.length===profile.objects.length,'named_count');for(const [i,o] of profile.objects.entries()){const n=observation.namedBefore[i],a=observation.namedAfter[i];check(Array.isArray(n)&&n.length===8&&n[0]===i&&n[1]===o.bytes&&n[2]===Buffer.from(o.sha256,'hex').toString('base64')&&same(n[7],o.links.map(l=>l.target))&&same(a,[i,...n.slice(3,7),n[7]]),'named_identity');}
 for(const sample of [observation.startup,observation.terminal]){if(sample.absence){const c=sample.absence.confirmation,b=Buffer.from(c?.mountinfo?.data??'','base64');check(sample===observation.terminal&&['ENOENT','ESRCH'].includes(sample.absence.code)&&['ENOENT','ESRCH'].includes(c?.code)&&c.path===`/proc/${observation.pid}/stat`&&c.mountinfo.bytes===b.length&&sha(b)===sha(parentMount)&&order('native-close')<order('absence-after-owned-close')&&observation.native?.exitCode===0&&observation.native.signal===null,'exit_before_read');continue;}
  const originals=sample.originals;check(originals?.maps?.channel==='proc-maps'&&originals.maps.capture.members.length<=16,'maps_role');const maps=replayRawMembers(originals.maps.capture,{producerCap:1048576});parseProgramMaps(maps,profile,mounts);
  for(const key of ['statBefore','statAfter','cmdline','environ','mountinfo']){const r=originals[key],b=Buffer.from(r.data,'base64');check(b.length===r.bytes&&sha(b)===r.sha256,'original');}
  const stat=parseProcessStat(Buffer.from(originals.statBefore.data,'base64').toString()),end=parseProcessStat(Buffer.from(originals.statAfter.data,'base64').toString());check(same(stat,end)&&same(stat,sample.identity)&&stat.pid===observation.pid&&stat.group===stat.pid&&stat.parent===observation.ownerPid&&stat.live,'process_identity');
  const observedEnvironment=environment(Buffer.from(originals.environ.data,'base64'));check(same(Buffer.from(originals.cmdline.data,'base64').toString().split('\0').slice(1,-1),argv.args)&&Object.entries(profile.environment).every(([k,v])=>observedEnvironment[k]===v)&&!Object.keys(observedEnvironment).some(k=>/^(LD_|DYLD_)/.test(k)||['FFREPORT','AV_LOG_FORCE_COLOR','NODE_OPTIONS','NODE_PATH'].includes(k))&&sample.executable===profile.executable.path,'owned_launch');
  check(originals.mountinfo.sha256===sha(parentMount)&&sample.root===observation.visibility.root&&same(sample.rootStat,observation.visibility.rootStat)&&same(sample.namespaces,observation.visibility.namespaces),'platform_view');
 }
 if(!observation.terminal.absence)check(same(observation.startup.identity,observation.terminal.identity),'process_reuse');
 if(role==='encode')check(/^pipe:\[\d+\]$/.test(observation.startup.fds['1']??''),'stdout_lineage');
 else {const fds=Object.entries(observation.startup.fds).filter(([,v])=>v===file);check(fds.length===1&&fileIdentity?.regular===true&&fileIdentity?.seekable===true&&fileIdentity?.nlink===1,'file_descriptor');const observed=observation.startup.fdStats[fds[0][0]];check(observed?.regular===true&&observed.nlink===1&&['dev','ino','bytes','mtimeMs','ctimeMs'].every(k=>observed[k]===fileIdentity[k]),'file_descriptor_identity');}
 return {identity:observation.startup.identity,stdout:role==='encode'?observation.startup.fds['1']:null,assurance:binding.assurance};
}
