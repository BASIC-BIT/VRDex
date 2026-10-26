import { readFile,writeFile,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createQualificationOwner } from './marker-qualification/owner.mjs';
import { inventoryArtifacts } from './marker-qualification/collector.mjs';
import { createAcquisitionDeadline } from './event-marker-native-binding.mjs';
import { createOwnedCancellation } from './event-marker-owned-cancellation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),must=(v,r)=>{if(!v)throw Error('program_collector_'+r);};
export const programDestination=run=>{must(/^task6-[a-z0-9-]{1,74}$/.test(run),'run');return `s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/${run}/qualification/canary-000/`;};
/** A distinct single-PROGRAM terminal. Native132, paired qualification and
 * capacity are separate domains. Upload begins only after physical closure. */
export async function collectPositiveProgram(runId,effects={}){
 const target=programDestination(runId),directory='/tmp/marker-program-'+runId,absolute=effects.control??createAcquisitionDeadline(600000),control=createOwnedCancellation({control:absolute,signal:effects.signal,cleanupMs:20000,name:'program_collector'}),io={ownerFactory:createQualificationOwner,inventory:()=>inventoryArtifacts(directory),read:async()=>{const p=directory+'/receipt.json',s=await lstat(p);must(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=65536,'receipt');return readFile(p);},write:(name,b)=>writeFile(directory+'/'+name,b,{flag:'wx',mode:0o600,signal:control.signal}),...effects};
 let owner,cleanup,driverCode=1,inner,files=[],bound=false,uploaded=false,terminalUploaded=false,primary,terminal;
 const secondary=error=>{if(primary)primary.cleanupError??=error;else primary=control.reason??error;};
 const upload=async(f,end)=>{
  let uploadOwner,failure;
  try{control.check();must(performance.now()<end,'upload_deadline');uploadOwner=await control.own(io.ownerFactory);await control.run(()=>io.upload?io.upload(uploadOwner,f,target+f.name,control.signal):uploadOwner.run('aws',['s3','cp',directory+'/'+f.name,target+f.name,'--region','us-east-1','--only-show-errors','--no-progress'],{timeoutMs:Math.min(160000,end-performance.now()),maxBytes:16384,signal:control.signal}));}
  catch(error){failure=control.reason??error;}
  finally{if(uploadOwner)try{const closed=await control.close(uploadOwner);must(closed.closed&&closed.emptyCensuses===2,'upload_cleanup');}catch(error){if(failure)failure.cleanupError=error;else failure=error;}}
  if(failure)throw failure;control.check();must(performance.now()<end,'upload_deadline');
 };
 try{
  try{owner=await control.own(io.ownerFactory);try{await control.run(()=>owner.run('node',['scripts/event-marker-program-acquire.mjs','--output-dir',directory],{timeoutMs:Math.min(400000,control.deadline-performance.now()),maxBytes:65536,signal:control.signal}));driverCode=0;}catch(error){primary=control.reason??error;}finally{cleanup=await control.close(owner);}
   control.check();must(cleanup?.closed&&cleanup.emptyCensuses===2,'physical_cleanup');const receiptBytes=await control.run(io.read);must(receiptBytes.length<=65536,'receipt');inner=JSON.parse(receiptBytes);files=await control.run(io.inventory);const receipt=files.find(f=>f.name==='receipt.json');must(receipt?.bytes===receiptBytes.length&&receipt.sha256===sha(receiptBytes),'receipt_binding');bound=inner.schema==='program-local-receipt-v1'&&inner.scope==='single-canary-train-program-only'&&inner.invocationId==='mass-320-48000stereo-073'&&inner.groupId==='canary-000'&&inner.pairedQualification===false&&inner.capacityAccepted===false&&inner.cleanup?.closed===true&&inner.cleanup.liveChildren===0&&inner.cleanup.liveGroups===0;
   const uploadEnd=Math.min(control.deadline,performance.now()+160000);for(const file of files)await upload(file,uploadEnd);uploaded=true;
  }catch(error){primary??=control.reason??error;}
  terminal={schema:'single-program-terminal-v1',runId,groupId:'canary-000',invocationId:'mass-320-48000stereo-073',destination:target,pairedQualification:false,capacityAccepted:false,programLocalComplete:driverCode===0&&bound&&uploaded&&inner?.state==='local-conditional-pending-outer'&&!primary&&!control.reason,driverCode,cleanup:cleanup??{closed:false},artifacts:files,artifactBindingComplete:bound,artifactUploadsComplete:uploaded,receiptRef:files.find(f=>f.name==='receipt.json')??null,resultRef:inner?.resultRef??null,replayRef:inner?.replayRef??null,binding:inner?.binding??null,rootStoppedAttestationRequired:true,rootFullOriginalArtifactRetrievalRequired:true,terminalOwnUpload:'pending',...(primary?{failure:String(primary.message).slice(0,512)}:{})};
  try{control.check();must(cleanup?.closed&&cleanup.emptyCensuses===2,'physical_cleanup');const raw=Buffer.from(JSON.stringify(terminal)+'\n');must(raw.length<=65536,'terminal_cap');await control.run(()=>io.write('terminal.json',raw));await upload({name:'terminal.json',bytes:raw.length,sha256:sha(raw)},control.deadline);terminalUploaded=true;control.check();}catch(error){primary??=control.reason??error;}
 }finally{try{await control.closeAll();}catch(error){secondary(error);}finally{primary??=control.reason;control.dispose();}}
 return {...terminal,programLocalComplete:terminal?.programLocalComplete===true&&terminalUploaded&&!primary,terminalOwnUpload:terminalUploaded?'complete':'incomplete',...(primary?{failure:String(primary.message).slice(0,512),secondary:primary.cleanupError?.message??null}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){must(process.argv.length===4&&process.argv[2]==='--run-id','usage');const terminal=await collectPositiveProgram(process.argv[3]);console.log(JSON.stringify(terminal));if(!terminal.programLocalComplete)process.exitCode=1;}
