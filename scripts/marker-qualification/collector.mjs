import { readFile,lstat,readdir,writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createQualificationOwner } from './owner.mjs';
const ARTIFACT_CAP=134152192,TERMINAL_CAP=65536;
const PREFIX='s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/';
async function digestFile(directory,name) {
 if(!/^[a-z0-9][a-z0-9._-]{0,159}$/.test(name))throw Error('collector_name');
 const file=`${directory}/${name}`,s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>67108864)throw Error('collector_file');
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(file)){bytes+=chunk.length;if(bytes>s.size)throw Error('collector_file_changed');hash.update(chunk);}
 if(bytes!==s.size)throw Error('collector_file_changed');return {name,bytes,sha256:hash.digest('hex')};
}
export async function inventoryArtifacts(directory) {
 const names=(await readdir(directory)).sort();if(names.length<1||names.length>256||names.includes('terminal.json'))throw Error('collector_file_count');
 const files=[];let total=0;
 for(const name of names){const file=await digestFile(directory,name);total+=file.bytes;if(total>ARTIFACT_CAP)throw Error('collector_byte_cap');files.push(file);}
 return files;
}
function bindArtifacts(inner,files) {
 const actual=files.filter(f=>f.name!=='receipt.json');
 return Array.isArray(inner?.artifacts)&&actual.length===inner.artifacts.length&&new Set(inner.artifacts.map(f=>f.name)).size===actual.length&&actual.every(f=>inner.artifacts.some(e=>e.name===f.name&&e.bytes===f.bytes&&e.sha256===f.sha256));
}
async function readInner(request) {
 const file=`${request.directory}/receipt.json`,s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>TERMINAL_CAP)throw Error('collector_inner');
 return JSON.parse(await readFile(file,'utf8'));
}
async function writeTerminal(request,terminal) {
 const bytes=Buffer.from(JSON.stringify(terminal)+'\n');if(bytes.length>TERMINAL_CAP)throw Error('collector_terminal_cap');
 await writeFile(`${request.directory}/terminal.json`,bytes,{flag:'wx',mode:0o600});return {name:'terminal.json',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
/** One fixed root-requested group. No scheduler, retry, local deletion or
 * capacity map mutation. The outer ECS660s/120s bounds remain root-owned. */
export async function collectQualification(request,effects={}) {
 const io={ownerFactory:createQualificationOwner,readInner,inventory:()=>inventoryArtifacts(request.directory),writeTerminal:terminal=>writeTerminal(request,terminal),clock:()=>performance.now(),...effects};
 const start=io.clock(),active=new Set();let terminated=false,inner,driverCode=1,cleanup={closed:false},files=[],bound=false,uploadsComplete=false,terminalUploaded=false,terminal;
 const stop=()=>{terminated=true;for(const owner of active)void owner.close().catch(()=>{});};effects.interrupt=stop;
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const hard=setTimeout(()=>{stop();process.exit(124);},600000);
 const remaining=deadline=>Math.max(0,deadline-(io.clock()-start));
 const upload=async(file,deadline)=>{
  if(terminated||remaining(deadline)<=0)throw Error('collector_deadline');
  const owner=await io.ownerFactory();active.add(owner);
  try{
   if(terminated)throw Error('collector_terminated');
   if(io.upload)await io.upload(owner,file);
   else await owner.run('aws',['s3','cp',`${request.directory}/${file.name}`,`${PREFIX}${request.runId}/qualification/${request.groupId}/${file.name}`,'--region','us-east-1','--only-show-errors','--no-progress'],{timeoutMs:Math.min(160000,remaining(deadline)),maxBytes:16384});
  }finally{
   const closed=await owner.close();active.delete(owner);if(!closed.closed||closed.emptyCensuses!==2)throw Error('collector_upload_cleanup');
  }
  if(terminated||remaining(deadline)<=0)throw Error('collector_deadline');
 };
 try {
  const owner=await io.ownerFactory();active.add(owner);
  try{await owner.run('node',['scripts/event-source-marker-qualification.mjs','--request','/tmp/marker-qualification-request.json'],{timeoutMs:remaining(420000),maxBytes:65536});driverCode=0;}
  catch{driverCode=1;}
  finally{cleanup=await owner.close();active.delete(owner);}
  if(!terminated&&cleanup.closed&&cleanup.emptyCensuses===2){
   try{inner=await io.readInner(request);}catch{}
   try{files=await io.inventory();bound=bindArtifacts(inner,files);}catch{}
   const uploadEnd=Math.min(580000,io.clock()-start+160000);
   if(files.length){
    try{for(const file of files)await upload(file,uploadEnd);uploadsComplete=true;}catch{uploadsComplete=false;}
   }
  }
  const workPassed=driverCode===0&&inner?.passed===true&&inner.groupId===request.groupId&&inner.schema==='marker-qualification-inner-v1'&&inner.capacityAccepted===false&&inner.outerCleanup?.closed===true&&inner.outerCleanup?.emptyCensuses===2&&inner.cleanup?.closed===true&&bound&&uploadsComplete&&cleanup.closed===true&&!terminated&&remaining(580000)>0;
  terminal={schema:'marker-qualification-terminal-v1',groupId:request.groupId,runId:request.runId,capacityAccepted:false,workPassed,driverCode,pins:inner?.pins,expected:inner?.expected,invocations:inner?.invocations,cleanup,artifactBindingComplete:bound,artifactUploadsComplete:uploadsComplete,artifacts:files,elapsedMs:io.clock()-start,interrupted:terminated,terminalOwnUpload:'pending',rootStoppedAttestationRequired:true,rootFullOriginalArtifactRetrievalRequired:true};
  if(!terminated&&cleanup.closed&&cleanup.emptyCensuses===2&&remaining(580000)>0){
   const terminalFile=await io.writeTerminal(terminal);
   if(!terminated&&remaining(600000)>0){try{await upload(terminalFile,600000);terminalUploaded=true;}catch{terminalUploaded=false;}}
  }
 }catch{terminal??={schema:'marker-qualification-terminal-v1',groupId:request.groupId,capacityAccepted:false,workPassed:false,cleanup,rootStoppedAttestationRequired:true};}
 finally{
  // Every owner present here is still this invocation's owner. close is
  // idempotent and never reopens its historical process census.
  for(const owner of active){try{await owner.close();}catch{};}active.clear();
  clearTimeout(hard);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
 }
 return {...terminal,workPassed:terminal?.workPassed===true&&!terminated&&terminalUploaded&&remaining(600000)>0,interrupted:terminated,terminalOwnUpload:terminalUploaded?'complete':'incomplete'};
}
