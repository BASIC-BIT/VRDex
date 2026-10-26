// Real bounded process boundary; all work is explicitly source-only fixture I/O.
import { spawn } from 'node:child_process';
import { readdir,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectPositiveProgram } from '../../scripts/event-marker-program-collector.mjs';
import { retrieveProgramOriginals,createRootRetrievalOwner } from '../../scripts/event-marker-root-retrieval.mjs';
import { createQualificationOwner,parseProcessStat } from '../../scripts/marker-qualification/owner.mjs';
import { createAcquisitionDeadline } from '../../scripts/event-marker-native-binding.mjs';
const phase=process.argv[2],send=value=>process.send?.(value),closed=[],abort=new AbortController(),hash=b=>createHash('sha256').update(b).digest('hex'),json=v=>Buffer.from(JSON.stringify(v));
process.on('message',message=>{if(message==='cancel-external')abort.abort(Error('SIMULATED_external_abort'));});
const census=async()=>{const rows=[];for(const entry of await readdir('/proc'))if(/^\d+$/.test(entry))try{rows.push(parseProcessStat(await readFile('/proc/'+entry+'/stat','utf8')));}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}return rows;};
const announce=child=>{send({event:'spawn',pid:child.pid,phase});let ready=false;child.stdout.on('data',b=>{if(!ready&&b.toString().includes('READY')){ready=true;send({event:'ready',pid:child.pid,phase});}});return child;};
const wrap=owner=>({...owner,close:async options=>{const result=await owner.close(options);closed.push(result);send({event:'closed',...result});return result;}});
const nodeWait="process.on('SIGTERM',()=>{});require('node:fs').writeSync(1,'READY\\n');setInterval(()=>{},1000)";
let uploads=0,writes=0;
try{
 if(phase==='helper'){
  const execution={schema:'native-execution-v1',domain:'program',producer:'root-program-v1',retrieval:'root-originals-v1',policy:'r83-native-evidence-v1',invocation:{id:'mass-320-48000stereo-073',kind:'mass'}},K=json({execution}),I=json({execution,candidateManifestSHA:hash(K),workload:{originalCommand:['node','scripts/event-marker-program-collector.mjs','--run-id','task6-simulated']}}),parameters={},Q={intentSHA:hash(I),parameters,parametersJSON:JSON.stringify(parameters)},input={schema:'single-program-root-retrieval-input-v1',candidatePath:'K',intentPath:'I',launchPath:'Q',expected:{launch:Q},config:{candidateSHA:hash(K),runId:'task6-simulated',groupId:'canary-000'}},files=new Map([['input',json(input)],['K',K],['I',I],['Q',json(Q)]]);
  const value=await retrieveProgramOriginals({inputPath:'input',outputPath:'out',deadline:performance.now()+10000,signal:abort.signal,read:async p=>files.get(p),write:async()=>{writes++;send({event:'write'});},ownerFactory:async()=>wrap(await createRootRetrievalOwner({spawnProcess:(command,args,options)=>{if(command!=='python3'||args[0]!=='scripts/event-marker-root-retrieval.py')throw Error('fixture_command');return announce(spawn('python3',['-B','-c',"import signal,time;signal.signal(signal.SIGTERM,lambda *_:None);print('READY',flush=True);time.sleep(30)"],options));}}))});
  send({event:'result',positive:true,value,writes,closed});
 }else{
  const receipt={schema:'program-local-receipt-v1',scope:'single-canary-train-program-only',invocationId:'mass-320-48000stereo-073',groupId:'canary-000',pairedQualification:false,capacityAccepted:false,cleanup:{closed:true,liveChildren:0,liveGroups:0},state:'local-conditional-pending-outer'},raw=json(receipt),files=[{name:'receipt.json',bytes:raw.length,sha256:hash(raw)}];
  const value=await collectPositiveProgram('task6-simulated',{control:createAcquisitionDeadline(30000),signal:abort.signal,read:async()=>raw,inventory:async()=>files,write:async()=>{writes++;send({event:'write'});},ownerFactory:async()=>{
   const groups=new Set(),owner=await createQualificationOwner({scan:async()=>(await census()).filter(r=>groups.has(r.group)),spawn:(command,args,options)=>{if(command!=='node'&&command!=='aws')throw Error('fixture_command');if(command==='aws')uploads++;const wait=phase==='driver'&&command==='node'||phase==='upload'&&command==='aws'||phase==='terminal-upload'&&command==='aws'&&uploads===2;const child=spawn(process.execPath,['-e',wait?nodeWait:"require('node:fs').writeSync(1,'SIMULATED completed\\n')"],options);groups.add(child.pid);return announce(child);}});return wrap(owner);
  }});send({event:'result',positive:value.programLocalComplete,value,writes,closed});
 }
}catch(error){send({event:'result',positive:false,failure:error.message,secondary:error.cleanupError?.message??null,writes,closed});}
finally{process.exitCode=1;process.disconnect?.();}
