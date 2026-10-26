import { createHash } from 'node:crypto';
import { diagnosticArguments } from '../event-marker-native-capture.mjs';
import { createRawCapture, replayRawMembers,createRecordFailure } from '../event-marker-raw-capture.mjs';
import { openNativeBindingDependencies,createAcquisitionDeadline } from '../event-marker-native-binding.mjs';
import { prepareInvocationObserver } from '../event-marker-runtime-observer.mjs';
import { retainBindingFailure } from './binding-retention.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** The trusted caller supplies the original builder arguments. Recompute A;
 * never authorize argv from a serialized reversible edit log. This acquisition
 * records actual channel EOF and native close, not consumer EOF or drain. */
export async function startCapturedInvocation(owner,{original,stdio,channels,stderrCap,timeoutMs,store,prefix,recordKey=prefix,stage='encode',dependencies=openNativeBindingDependencies,observerIO,acquisition}) {
 const ownsDeadline=!acquisition;acquisition??=createAcquisitionDeadline(timeoutMs);
 const {run,check,signal}=acquisition;
 try {
 if(!['encode','decode'].includes(stage))throw Error('marker_capture_stage');
 let binding;
 try{binding=await run(()=>dependencies({...acquisition,registerImplementationAssets:files=>{check();return store.registerImplementationAssets(files,recordKey,stage);}}));}catch(error){
  await retainBindingFailure(store,prefix,error,acquisition,stage);
  throw error;
 }
 const argv=diagnosticArguments(original,{stdio});
 if(binding.kind==='AcquiredDependencies')store.selectNativePolicy(binding);
 await run(()=>store.json(`${prefix}-argv.json.gz`,argv,196608,'argv',acquisition));
 // Dependencies are charged for this recording use, even if another recording
 // uses identical static bytes. Event originals remain distinct captures.
 for(const [index,artifact] of binding.artifacts.entries()) {
  let retained=store.entries.find(e=>e.role==='runtimeBinding'&&e.sha256===artifact.sha256&&e.bytes===artifact.bytes);
  retained??=await run(()=>store.write(`${prefix}-binding-${index}.bin`,Buffer.from(artifact.data,'base64'),196608,'runtimeBinding',acquisition));
  check();
  // E and D are distinct actual acquisitions, even inside one PROGRAM record.
  // Physical sharing does not erase the second full ordinary DATA use charge.
  store.useRuntimeDependency(retained,prefix,artifact.id);
 }
 await run(()=>store.json(`${prefix}-binding.json`,{...binding,artifacts:binding.artifacts.map(({data,...ref})=>ref)},196608,'runtimeBinding',acquisition));
 const observer=await run(()=>prepareInvocationObserver(binding,argv,acquisition,observerIO));
 check();
 const child=owner.start('ffmpeg',argv.args,{stdio:argv.stdio}),specs={...channels,stderr:{fd:2,cap:stderrCap,role:'stderr'},progress:{fd:argv.progressFd,cap:1048576,role:'progressVideo'}},captures={},eof={},errors=[];
 let stopReason=null,finished,firstError,failure;
 const stop=(reason,error)=>{
  if(stopReason)return;
  stopReason=reason;firstError=error??Error(reason);
  failure=createRecordFailure({recordKey,inputSHA:argv.diagnosticSHA256});
  failure.record({stage,completedPrerequisites:[],native:{stopReason},error:firstError});
  owner.signalGroup(child,'SIGKILL');
 };
 const invocation=observer?.attach(child,error=>stop('runtime_observation',error));
 for(const [name,spec] of Object.entries(specs)) {
  const capture=['raw','memory'].includes(spec.retention)?null:createRawCapture({producerCap:spec.cap,remainingBytes:store.remainingNumericBytes??196608}),parts=[],state={capture,parts,observedBytes:0,hash:createHash('sha256')};captures[name]=state;eof[name]=false;
  const stream=child.stdio[spec.fd];if(!stream){stop('missing_pipe');continue;}
  stream.on('data',chunk=>{state.observedBytes+=chunk.length;state.hash.update(chunk);const observed=capture?.write(chunk);if(state.observedBytes>spec.cap||observed?.producerExceeded||observed?.retentionStopped)stop('byte_cap');else parts.push(Buffer.from(chunk));});
  stream.once('end',()=>{eof[name]=true;});stream.on('error',error=>{errors.push({channel:name,message:error.message});stop('pipe_error',error);});
 }
 const onAbort=()=>stop('timeout',signal.reason);
 signal.addEventListener('abort',onAbort,{once:true});
 async function finish() {
  const terminal=await child.nativeClosed;
  const raw={},references={};let primary=firstError;
  let runtime;
  try{runtime=await run(()=>invocation?.finish(terminal));if(runtime){const retained=structuredClone(runtime);for(const phase of ['startup','terminal']){const maps=retained[phase].originals?.maps;if(!maps)continue;const c=maps.capture,raw=replayRawMembers(c,{producerCap:1048576}),compressed=Buffer.concat(c.members.map(m=>Buffer.from(m.data,'base64'))),artifact=await run(()=>store.write(`${prefix}-maps-${phase}.gz`,compressed,196608,'procMaps',acquisition));maps.capture={...c,artifact,members:c.members.map(({data,...m},i)=>{const b=raw.subarray(i*65536,(i+1)*65536);return {...m,originalBytes:b.length,originalSHA256:sha(b)};})};}await run(()=>store.json(`${prefix}-runtime.json`,retained,196608,'runtimeBinding',acquisition));}}catch(error){primary??=error;}
  for(const [name,{capture,parts,observedBytes,hash}] of Object.entries(captures)) {
   raw[name]=Buffer.concat(parts);
   if(!capture){
    try{references[name]={...(specs[name].retention==='memory'?{}:{artifact:await run(()=>store.write(`${prefix}-${name}.raw`,raw[name],specs[name].cap,specs[name].role,acquisition))}),observedBytes,observedSHA256:hash.digest('hex'),complete:observedBytes===raw[name].length&&eof[name]};if(!references[name].complete)primary??=Error('marker_capture_incomplete');}catch(error){primary??=error;}continue;
   }
   const retained=capture.finish();
   try {references[name]=await run(()=>retainCapture(store,`${prefix}-${name.toLowerCase()}`,retained,specs[name].role,acquisition));if(!retained.complete||!eof[name])primary??=Error('marker_capture_incomplete');}
   catch(error){primary??=error;}
  }
  const native={...terminal,stopReason};
  try{const retain=()=>store.json(`${prefix}-native.json.gz`,{native,primary:failure?.snapshot().primary??null,channelEOF:eof,errors,argvSHA256:argv.diagnosticSHA256,channels:references},196608,'native',primary?{}:acquisition);if(primary)await retain();else await run(retain);}catch(error){
   primary??=error;
   if(failure){
    failure.record({stage:'retain',completedPrerequisites:[],native,error});
    try{await store.writeFailure(`${prefix}-capture-failure.json`,failure.snapshot());}catch(retentionError){firstError.retentionError=retentionError;}
   }
  }
  if(terminal.exitCode!==0||terminal.signal!==null||stopReason||child.nativeError)primary??=Error(stopReason??'encode_failure');
  const result={...raw,native,channelEOF:{...eof},references,argv,binding,runtime};
  signal.removeEventListener('abort',onAbort);if(ownsDeadline)acquisition.dispose();
  if(primary){primary.nativeCapture=result;throw primary;}return result;
 }
 return {child,argv,binding,stop,finish(){return finished??=finish();}};
 }catch(error){acquisition.dispose();throw error;}
}
export async function retainCapture(store,prefix,capture,role,control={}) {
 const compressed=Buffer.concat(capture.members.map(member=>Buffer.from(member.data,'base64')));
 if(compressed.length!==capture.compressedBytes||sha(compressed)!==capture.compressedSHA256)throw Error('marker_raw_conservation');
 const original=await store.write(`${prefix}.gz`,compressed,196608,role,control);
 const retained=replayRawMembers(capture,{producerCap:capture.retainedBytes,requireComplete:false});
 const catalog={...capture,members:capture.members.map(({data,...ref},index)=>{const raw=retained.subarray(index*65536,(index+1)*65536);return {...ref,originalBytes:raw.length,originalSHA256:sha(raw)};}),artifact:original};
 await store.json(`${prefix}-catalog.json.gz`,catalog,196608,'catalog',control);return catalog;
}
export async function retainFeed(store,prefix,feed,control={}) {
 const trace=await retainCapture(store,prefix,feed.trace,'feed',control);
 const {trace:unused,error,secondaryErrors,...facts}=feed;
 await store.json(`${prefix}-facts.json.gz`,{...facts,error:error?{name:error.name,message:error.message}:null,secondaryErrors:secondaryErrors.map(e=>({name:e.name,message:e.message})),trace},196608,'feed',control);
 if(!feed.complete)throw feed.error??Error('marker_capture_incomplete');
 return replayRawMembers(feed.trace,{producerCap:196608});
}
