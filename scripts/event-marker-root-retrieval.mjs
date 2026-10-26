import { writeFile,readFile,readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createQualificationOwner,parseProcessStat } from './marker-qualification/owner.mjs';
import { createAcquisitionDeadline,readBounded } from './event-marker-native-binding.mjs';
import { validateExecutionCommand } from './event-marker-evidence-policy.mjs';
import { createOwnedCancellation } from './event-marker-owned-cancellation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),must=(v,r)=>{if(!v)throw Error('root_retrieval_'+r);},same=isDeepStrictEqual;
/** Root runs in a shared host workspace. Only the one fixed Python helper's
 * owned process group enters this census; unrelated new host processes never
 * become qualification-container descendants. The reviewed helper does not
 * fork or execute subprocesses. A recycled group leader fails ownership. */
export async function createRootRetrievalOwner({census=async()=>{const rows=[];for(const name of await readdir('/proc'))if(/^\d+$/.test(name)){try{rows.push(parseProcessStat(await readFile('/proc/'+name+'/stat','utf8')));}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}}return rows;},spawnProcess=spawn,readIdentity=pid=>parseProcessStat(readFileSync('/proc/'+pid+'/stat','utf8')), ...effects}={}){
 const groups=new Map();let identityError;const owner=await createQualificationOwner({...effects,scan:async()=>{const rows=await census();for(const [pid,start] of groups){const leader=rows.find(r=>r.pid===pid);must(!leader||leader.startTicks===start,'helper_identity_changed');}return rows.filter(r=>groups.has(r.group));},spawn:(command,args,options)=>{must(command==='python3'&&args[0]==='scripts/event-marker-root-retrieval.py','helper_command');const child=spawnProcess(command,args,options);try{const identity=readIdentity(child.pid);must(identity.pid===child.pid&&identity.group===child.pid&&identity.live,'helper_identity');groups.set(child.pid,identity.startTicks);}catch(error){identityError=error;child.kill('SIGKILL');}return child;}});return {...owner,run:async(...args)=>{try{const result=await owner.run(...args);if(identityError)throw identityError;return result;}catch(error){if(identityError&&error!==identityError)identityError.nativeFailure=error;throw identityError??error;}}};
}
/** The Python receipt remains provisional until THIS owned helper has returned
 * successfully and two physical censuses have completed inside the same Root
 * supplied absolute deadline. No runtime dependency points into private SDD. */
export async function retrieveProgramOriginals({inputPath,outputPath,deadline,signal,read=(path,control)=>readBounded(path,196608,control),write=writeFile,ownerFactory=createRootRetrievalOwner,clock=()=>performance.now()}){
 must(Number.isFinite(deadline)&&deadline>clock(),'deadline');const absolute=createAcquisitionDeadline(deadline-clock()),control=createOwnedCancellation({control:absolute,signal,cleanupMs:1500,name:'root_retrieval'});let owner,primary,capture,cleanup,result;
 try{const raw=await control.run(()=>read(inputPath,control));must(raw.length>0&&raw.length<=196608,'input_cap');const input=JSON.parse(raw),K=JSON.parse(await control.run(()=>read(input.candidatePath,control))),I=JSON.parse(await control.run(()=>read(input.intentPath,control))),Q=JSON.parse(await control.run(()=>read(input.launchPath,control)));must(same(Q,input.expected.launch),'launch_original');
  must(input.schema==='single-program-root-retrieval-input-v1'&&K.execution?.producer==='root-program-v1'&&same(K.execution,I.execution)&&I.candidateManifestSHA===input.config.candidateSHA&&input.config.candidateSHA===sha(Buffer.from(await control.run(()=>read(input.candidatePath,control)))),'scope');validateExecutionCommand(K.execution,I.workload.originalCommand);must(I.workload.originalCommand[3]===input.config.runId&&input.config.groupId==='canary-000'&&Q.intentSHA===sha(Buffer.from(await control.run(()=>read(input.intentPath,control))))&&Q.parametersJSON===JSON.stringify(Q.parameters),'launch');
  owner=await control.own(ownerFactory);const remaining=control.deadline-clock();must(remaining>0,'deadline');await control.run(()=>owner.run('python3',['scripts/event-marker-root-retrieval.py',inputPath,String(remaining/1000)],{timeoutMs:remaining,maxBytes:196608,signal:control.signal,observeCapture:c=>{capture=c;}}));
  must(capture?.native.exitCode===0&&capture.native.signal===null&&capture.channelEOF.stdout&&capture.channelEOF.stderr,'helper_exit');result=JSON.parse(capture.raw);
 }catch(error){primary=control.reason??error;}
 finally{try{if(owner)cleanup=await control.close(owner);await control.closeAll();}catch(error){if(primary)primary.cleanupError=error;else primary=control.reason??error;}}
 try{if(primary)throw primary;must(cleanup?.closed&&cleanup.emptyCensuses===2,'cleanup');control.check();const envelope={schema:'single-program-root-helper-v1',retrieval:result,helper:{command:'python3',script:'scripts/event-marker-root-retrieval.py',exitCode:capture.native.exitCode,signal:capture.native.signal,stdoutEOF:capture.channelEOF.stdout,stderrEOF:capture.channelEOF.stderr,stderrBase64:Buffer.from(capture.stderr).toString('base64'),inputPath,outputSHA256:sha(capture.raw),outputBytes:capture.raw.length,closedBeforeDeadline:true},cleanup,capacityAccepted:false,pairedQualification:false};const bytes=Buffer.from(JSON.stringify(envelope)+'\n');must(bytes.length<=196608,'output_cap');await control.run(()=>write(outputPath,bytes,{flag:'wx',mode:0o600,signal:control.signal}));control.check();return envelope;}finally{control.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [inputPath,outputPath,seconds]=process.argv.slice(2);must(inputPath&&outputPath&&Number.isFinite(Number(seconds))&&Number(seconds)>0,'usage');await retrieveProgramOriginals({inputPath,outputPath,deadline:performance.now()+Number(seconds)*1000});}
