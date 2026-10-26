import { spawn as nativeSpawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as nativeSleep } from 'node:timers/promises';

export function parseProcessStat(text) {
 const match=/^(\d+) \(/.exec(text),end=text.lastIndexOf(') ');
 if(!match||end<0)throw Error('qualification_proc_stat');
 const f=text.slice(end+2).trim().split(/\s+/);
 if(f.length<20||!/^\d+$/.test(f[19])||![f[1],f[2]].every(n=>/^\d+$/.test(n)))throw Error('qualification_proc_stat');
 return {pid:Number(match[1]),parent:Number(f[1]),group:Number(f[2]),startTicks:f[19],live:!['Z','X'].includes(f[0])};
}
async function processCensus() {
 const result=[];
 for(const entry of await readdir('/proc')) {
  if(!/^\d+$/.test(entry))continue;
  try {result.push(parseProcessStat(await readFile(`/proc/${entry}/stat`,'utf8')));}
  catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
 }
 return result;
}
const identity=row=>`${row.pid}:${row.startTicks}`;
/** Only for one isolated qualification container. Capturing all nonbaseline
 * identities also owns descendants that detach and reparent to PID1. */
export async function createQualificationOwner({scan=processCensus,spawn=nativeSpawn,signal=(pid,s)=>process.kill(pid,s),clock=()=>performance.now(),sleep=nativeSleep}={}) {
 const baseline=new Set((await scan()).map(identity)),children=new Set();let closing=false,closePromise;
 const active=()=>[...children].filter(c=>!c.settled);
 function start(command,args,options={}) {
  if(closing)throw Error('qualification_owner_closed');
  if(active().length>=2)throw Error('qualification_child_bound');
  const child=spawn(command,args,{...options,detached:true});children.add(child);
  child.nativeClosed=new Promise(resolve=>child.once('close',(exitCode,signal)=>resolve(Object.freeze({exitCode,signal:signal??null}))));
  child.closed=new Promise(resolve=>{
   const finish=code=>{if(!child.settled){child.settled=true;resolve(code);}};
   child.once('close',finish);child.once('error',error=>{child.nativeError=error;finish(1);});
  });
  child.on('error',()=>{});return child;
 }
 function signalGroup(child,s) {
  try{signal(-child.pid,s);}catch(error){if(error.code!=='ESRCH')throw error;}
 }
 async function run(command,args,{timeoutMs=30000,maxBytes=1048576,observeCapture,signal:abortSignal,...options}={}) {
  abortSignal?.throwIfAborted();
  const child=start(command,args,{...options,stdio:['ignore','pipe','pipe']});
  const chunks=[],stderr=[];let bytes=0,diagnostics=0,failure,stdoutEOF=false,stderrEOF=false;
  const stop=reason=>{failure??=reason;signalGroup(child,'SIGKILL');};
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>maxBytes)stop('byte_cap');else chunks.push(b);});
  child.stderr.on('data',b=>{diagnostics+=b.length;if(diagnostics>65536)stop('byte_cap');else stderr.push(Buffer.from(b));});
  child.stdout.once('end',()=>{stdoutEOF=true;});child.stderr.once('end',()=>{stderrEOF=true;});
  child.stdout.on('error',()=>stop('pipe_error'));child.stderr.on('error',()=>stop('pipe_error'));
  const timer=setTimeout(()=>stop('timeout'),timeoutMs);
  const onAbort=()=>stop('timeout');abortSignal?.addEventListener('abort',onAbort,{once:true});
  let code;try{code=await child.closed;}finally{clearTimeout(timer);abortSignal?.removeEventListener('abort',onAbort);}
  const native=await child.nativeClosed;
  await observeCapture?.({command,args:[...args],raw:Buffer.concat(chunks),stderr:Buffer.concat(stderr),native,channelEOF:{stdout:stdoutEOF,stderr:stderrEOF},error:failure??child.nativeError?.message??null});
  if(failure||code!==0||native.signal!==null||!stdoutEOF||!stderrEOF)throw Error(failure??'encode_failure');
  return Buffer.concat(chunks);
 }
 async function cleanup({timeoutMs=20000,termMs=500}={}) {
  closing=true;const startAt=clock(),seen=new Set();let empty=0,scans=0,last=[];
  while(clock()-startAt<timeoutMs) {
   last=(await scan()).filter(row=>row.live&&!baseline.has(identity(row)));scans++;
   if(last.length===0&&active().length===0){empty++;if(empty===2)return {closed:true,children:children.size,observedIdentities:seen.size,emptyCensuses:empty,censuses:scans,survivors:[],liveChildren:active().length,liveGroups:new Set(last.map(r=>r.group)).size};}
   else empty=0;
   const sig=clock()-startAt<termMs?'SIGTERM':'SIGKILL';
   for(const row of last) {
    seen.add(identity(row));
    // Recheck PID/startTicks immediately before signaling; a recycled PID must
    // be owned under its new identity by a later census, never by an old row.
    const current=(await scan()).find(r=>r.pid===row.pid&&r.live);
    if(!current||identity(current)!==identity(row))continue;
    try{signal(row.pid,sig);}catch(error){if(error.code!=='ESRCH')throw error;}
   }
   await sleep(20);
  }
  return {closed:false,reason:'process_leak',children:children.size,emptyCensuses:empty,censuses:scans,survivors:last.map(r=>({pid:r.pid,startTicks:r.startTicks})),unclosedChildren:active().length};
 }
 function close(options){closePromise??=cleanup(options);return closePromise;}
 return {start,run,close,children,signalGroup};
}
