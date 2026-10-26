import { makeNativeIntent,nativeJsonArtifact } from './event-marker-native-controller.mjs';
import { createHash } from 'node:crypto';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imageFactsFromEcr,nativeArtifact } from './event-marker-native-controller.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
/** Root's reviewed producer emits exact SDK parameter bytes. The trusted MCP
 * call_boto3 boundary must submit this entire object unchanged and retain the
 * complete request/response; no child reads private SDD or a future receipt. */
export function prepareEcsNativeLaunch({candidate,imageFacts,workload,semanticEnvironment,nonce,deadline,parameters}) {
 const pair=makeNativeIntent({candidate,imageFacts,workload,semanticEnvironment,nonce,deadline,transport:{kind:'base64',name:'VRDEX_NATIVE_BINDING_CONTEXT_B64'}}),input=JSON.parse(JSON.stringify(parameters));
 if(!input||!Array.isArray(input.overrides?.containerOverrides)||input.overrides.containerOverrides.filter(c=>c.name===workload.containerName).length!==1)throw Error('native_controller_override');
 if(input.overrides.containerOverrides.some(c=>(c.environment??[]).some(e=>e.name==='VRDEX_NATIVE_BINDING_CONTEXT_B64'||e.name==='VRDEX_NATIVE_BINDING_CONTEXT')))throw Error('native_controller_context_duplicate');
 const container=input.overrides.containerOverrides.find(c=>c.name===workload.containerName);if(JSON.stringify(container.command)!==JSON.stringify(workload.originalCommand))throw Error('native_controller_command');
 container.environment??=[];container.environment.push({name:'VRDEX_NATIVE_BINDING_CONTEXT_B64',value:pair.context.bytes.toString('base64')});
 if(Buffer.byteLength(JSON.stringify(input.overrides))>8192)throw Error('native_controller_override_cap');
 const parametersJSON=JSON.stringify(input),parametersSHA256=sha(Buffer.from(parametersJSON));
 return {...pair,launch:nativeJsonArtifact('observation','Q',{schema:'native-launch-v1',kind:'ecs-run-task',parameters:input,parametersJSON,parametersSHA256,boundary:{kind:'MCP-call_boto3',service:'ecs',operation:'run_task'},contextSHA:pair.context.ref.sha256,intentSHA:pair.intent.ref.sha256}),sdkInput:Buffer.from(parametersJSON)};
}
/** Public Root-only request producer. It performs no network or native work.
 * RunTask submission uses sdk-input.json bytes through the declared MCP SDK
 * boundary; keep the emitted originals and the complete returned SDK output. */
export async function emitEcsNativeLaunch(input,{read=path=>readFile(path),write}={}) {
 if(input?.schema!=='native-ecs-launch-input-v1')throw Error('native_controller_input');
 const candidateBytes=Buffer.from(await read(input.candidatePath)),manifest=Buffer.from(await read(input.imageManifestPath)),config=Buffer.from(await read(input.imageConfigPath));
 if(candidateBytes.length>196608||manifest.length>1048576||config.length>1048576)throw Error('native_controller_input_cap');
 const candidate={bytes:candidateBytes,ref:nativeArtifact('audit','K',candidateBytes)},imageFacts=imageFactsFromEcr({manifest,config,manifestDigest:input.manifestDigest,reference:input.imageReference,outerImageEvidenceId:'image'}),prepared=prepareEcsNativeLaunch({...input,candidate,imageFacts});
 const files=new Map([['K.json',candidateBytes],['I.json',prepared.intent.bytes],['C.json',prepared.context.bytes],['Q.json',prepared.launch.bytes],['image.json',Buffer.from(JSON.stringify(imageFacts))],['image-manifest.json',manifest],['image-config.json',config],['sdk-input.json',prepared.sdkInput]]);
 for(const [name,b] of files)await write(name,b);return [...files].map(([name,b])=>nativeArtifact('observation',name,b));
}


/** Root supplies the complete actual boundary outputs after cleanup/retrieval.
 * This only materializes references; independent replay decides acceptance. */
export async function emitEcsNativeLedger(input,{read=readFile,write}={}){
 if(input?.schema!=='native-ecs-terminal-input-v1')throw Error('native_controller_terminal_input');const originals=new Map(),ref=async(id,path,cap=196608)=>{const b=Buffer.from(await read(path));if(b.length<1||b.length>cap)throw Error('native_controller_terminal_cap');originals.set(id,b);return nativeArtifact('observation',id,b);};
 const documents={};for(const id of ['K','I','C','Q','image']){await ref(id,input.paths[id]);documents[id]=JSON.parse(originals.get(id));}
 const receiptRef=await ref('receipt.json',input.paths.receipt,65536),receipt=JSON.parse(originals.get('receipt.json')),collectorTerminalRef=await ref('terminal.json',input.paths.terminal,65536),readbackRef=await ref('artifact-readback',input.paths.readback),retrievalInputRef=await ref('retrieval-input',input.paths.retrievalInput),retrievalCompletionRef=await ref('retrieval-completion',input.paths.retrievalCompletion),runTaskResponseRef=await ref('run-task-response',input.paths.runTaskResponse,1048576),taskReadbackRef=await ref('task-readback',input.paths.taskReadback,1048576),imageManifestRef=await ref('image-manifest',input.paths.imageManifest,1048576),imageConfigRef=await ref('image-config',input.paths.imageConfig,1048576),manifest=JSON.parse(await read(input.paths.artifactUses));
 const metadata=[];for(const [i,path] of input.paths.metadata.entries())metadata.push(await ref('metadata-'+i,path,65536));const task=JSON.parse(originals.get('task-readback')).tasks?.[0],container=task?.containers?.find(c=>c.name===documents.I.workload.containerName),completion=JSON.parse(originals.get('retrieval-completion'));
 if(completion.readbackSHA!==readbackRef.sha256||completion.inputSHA!==retrievalInputRef.sha256||receipt.schema!=='program-local-receipt-v1')throw Error('native_controller_terminal_join');
 const ledger={schema:'native-outer-ledger-v1',domain:'program',startedAtUTC:task.startedAt,requestSHA:sha(originals.get('Q')),intentSHA:sha(originals.get('I')),contextSHA:sha(originals.get('C')),imageConfigSHA:documents.image.configSHA,nativeExit:container?.exitCode??null,nativeSignal:null,receiptRef,collectorTerminalRef,readbackRef,retrievalInputRef,retrievalCompletionRef,runTaskResponseRef,taskReadbackRef,imageManifestRef,imageConfigRef,artifactUseRef:receipt.replayRef,artifactUsesSHA:sha(Buffer.from(JSON.stringify(manifest.budget.uses))),metadata:{originals:metadata,elapsedMs:Math.max(...receipt.metadata.originals.map(r=>r.elapsedMs))},rawImageID:JSON.parse(originals.get('metadata-1')).ImageID};
 originals.set('L',Buffer.from(JSON.stringify(ledger)+'\n'));for(const [id,b] of originals)await write(id,b);return {state:'outer-ledger-pending-independent-replay',ledger,originals:[...originals].map(([id,b])=>nativeArtifact('observation',id,b))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const terminal=process.argv[2]==='--complete',args=process.argv.slice(terminal?3:2),[inputPath,output]=args;if(!inputPath||!output||args.length!==2)throw Error('usage: node scripts/event-marker-native-ecs-controller.mjs [--complete] INPUT_JSON OUTPUT_DIR');const raw=await readFile(inputPath);if(raw.length>196608)throw Error('native_controller_input_cap');await mkdir(output,{recursive:false});const write=(name,b)=>writeFile(resolve(output,name),b,{flag:'wx',mode:0o600});const result=terminal?await emitEcsNativeLedger(JSON.parse(raw),{write}):await emitEcsNativeLaunch(JSON.parse(raw),{write});console.log(JSON.stringify(result));}
