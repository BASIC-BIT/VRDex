import { readFile,lstat,mkdir,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateQualificationRequest } from './marker-qualification/request.mjs';
import { qualificationPreflight } from './marker-qualification/preflight.mjs';
import { createQualificationOwner } from './marker-qualification/owner.mjs';
import { runQualificationGroup } from './marker-qualification/group.mjs';

/** Exact-image inner qualification command. Root's separately reviewed outer
 * collector uploads only after this receipt's two empty physical censuses;
 * root then binds its native STOPPED/exit/ENI/definition facts independently. */
export async function runQualificationCommand(args,effects={}) {
 const io={readFile,lstat,mkdir,writeFile,ownerFactory:createQualificationOwner,preflight:qualificationPreflight,workload:runQualificationGroup,...effects};
 if(args.length!==2||args[0]!=='--request'||args[1]!=='/tmp/marker-qualification-request.json')throw Error('qualification_arguments');
 const info=await io.lstat(args[1]);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8192)throw Error('qualification_request_file');
 const request=validateQualificationRequest(JSON.parse(await io.readFile(args[1],'utf8'))),began=performance.now();
 await io.mkdir(request.directory,{recursive:false,mode:0o700});
 const outer=await io.ownerFactory(),active=new Set([outer]);let interrupted=false,receipt,preflight,cleanup;
 const stop=()=>{interrupted=true;for(const owner of active)void owner.close().catch(()=>{});};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const deadline=setTimeout(stop,400000),hard=setTimeout(()=>process.exit(124),420000);
 try {
  preflight=await io.preflight(request,outer);
  if(interrupted)throw Error('qualification_deadline');
  receipt=await io.workload({...request,pins:preflight.pins},{workMs:Math.max(0,400000-(performance.now()-began)),onOwner:(owner,closedOwner)=>{if(closedOwner)active.delete(closedOwner);if(owner){active.add(owner);if(interrupted)void owner.close();}}});
 }catch(error){
  receipt={schema:'marker-qualification-inner-v1',groupId:request.groupId,capacityAccepted:false,passed:false,artifactCollectionComplete:false,failureCode:/^qualification_[a-z_]+$/.test(error.message)?error.message:'qualification_incomplete',rootStoppedAttestationRequired:true};
 }finally{
  clearTimeout(deadline);
  try{cleanup=await outer.close();}catch{cleanup={closed:false,reason:'process_leak'};}
  receipt={...receipt,preflight,outerCleanup:cleanup,interrupted,passed:receipt?.passed===true&&cleanup.closed===true&&!interrupted,capacityAccepted:false,elapsedMs:performance.now()-began,artifactUpload:'root_collector_pending',rootStoppedAttestationRequired:true};
  try {
   const bytes=Buffer.from(JSON.stringify(receipt)+'\n');if(bytes.length>65536)throw Error('qualification_terminal_bound');
   await io.writeFile(`${request.directory}/receipt.json`,bytes,{flag:'wx',mode:0o600});
   // This owned file is not read/uploaded until the process closes. A signal
   // during its write must replace the provisional positive with a negative.
   if(interrupted||performance.now()-began>=420000){receipt={...receipt,interrupted:true,passed:false};await io.writeFile(`${request.directory}/receipt.json`,Buffer.from(JSON.stringify(receipt)+'\n'),{flag:'w',mode:0o600});}
  }finally{clearTimeout(hard);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
 }
 return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 // Remains armed through final stdout and actual exit, including failed owner
 // closure. A negative cannot linger indefinitely on a surviving pipe.
 setTimeout(()=>process.exit(124),420000);
 try{const result=await runQualificationCommand(process.argv.slice(2));process.stdout.write(JSON.stringify({groupId:result.groupId,passed:result.passed,capacityAccepted:false})+'\n',()=>process.exit(result.passed?0:1));}
 catch{process.stderr.write('Marker qualification incomplete\n',()=>process.exit(1));}
}
