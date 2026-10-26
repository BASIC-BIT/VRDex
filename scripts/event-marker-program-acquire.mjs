import { mkdir,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createAcquisitionDeadline,openNativeBindingDependencies,inspectAcquiredDependencies } from './event-marker-native-binding.mjs';
import { createQualificationOwner } from './marker-qualification/owner.mjs';
import { createArtifactStore,createInvocationStore } from './marker-qualification/artifacts.mjs';
import { constructTrainPcm } from './marker-qualification/train-construction.mjs';
import { generateNoise,encodeProgram } from './marker-qualification/codec-io.mjs';
import { readQualificationRecording } from './marker-qualification/codec-record.mjs';
import { captureNativeMetadata } from './event-marker-native-metadata.mjs';
import { retainBindingFailure } from './marker-qualification/binding-retention.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),ID='mass-320-48000stereo-073';
/** One unchanged canary train's PROGRAM acquisition. The explicit request is
 * ordinary runtime data bound by the manifest/K/Root audit. It is prepared with
 * compileTrain(enumerateQualification().invocations[exact id]) outside the
 * child. No qualification matrix, paired path, or capacity claim is emitted. */
export async function acquirePositiveProgram({directory,ownerFactory=createQualificationOwner,io={}}) {
 if(!/^\/tmp\/marker-program-[a-z0-9-]{1,80}$/.test(directory))throw Error('program_acquisition_directory');
 const control=io.control??createAcquisitionDeadline(90000),work=createAcquisitionDeadline(Math.max(0,control.deadline-performance.now()-1500));
 const scope=createInvocationStore(createArtifactStore(directory),{id:ID,kind:'mass'}),key=ID+'-program';let owner,cleanup,result,failure,metadata,created=false,binding;
 const close=()=>owner?.close({timeoutMs:Math.max(0,Math.min(1500,control.deadline-performance.now())),termMs:500});
 const abort=()=>{void close()?.catch(()=>{});};work.signal.addEventListener('abort',abort,{once:true});
 try {
  await work.run(()=>(io.fileSystem?.mkdir??mkdir)(directory,{recursive:false}));created=true;owner=await work.run(()=>ownerFactory());
  binding=await work.run(()=>(io.dependencies??openNativeBindingDependencies)({...work,registerImplementationAssets:files=>scope.registerImplementationAssets(files,key,'encode')}));if(!inspectAcquiredDependencies(binding))throw Object.assign(Error('program_acquisition_binding_unproven'),{bindingArtifacts:binding.artifacts});scope.selectNativePolicy(binding);
  for(const [i,a] of binding.artifacts.entries()){const original=await scope.write(key+'-prebinding-'+i+'.bin',Buffer.from(a.data,'base64'),196608,'runtimeBinding',work);scope.useRuntimeDependency(original,key,a.id);}await scope.json(key+'-prebinding.json',{...binding,artifacts:binding.artifacts.map(({data,...ref})=>ref)},196608,'runtimeBinding',work);
  const context=inspectAcquiredDependencies(binding).intent;metadata=context.imageFacts.kind==='localUnpublishedImage'?{kind:'local-notApplicable'}:{kind:'ecs-v4',originals:await captureNativeMetadata({store:scope,prefix:key,control:work,...io.metadata})};
  // Consume the exact immutable acquisition originals. No second manifest or
  // request filesystem read is hidden behind a hash-only observation.
  const original=id=>{const a=binding.artifacts.find(a=>a.id===id);if(!a||a.authentication?.state!=='matched')throw Error('program_acquisition_request');return Buffer.from(a.data,'base64');};
  const manifest=JSON.parse(original('runtime-manifest')),entry=manifest.entries.find(e=>e.id==='program-request');if(!entry||entry.relativePath!=='program-request.json')throw Error('program_acquisition_request');const raw=original('program-request'),request=JSON.parse(raw);
  if(request.schema!=='positive-program-acquisition-v1'||request.invocationId!==ID||request.groupId!=='canary-000'||request.settings?.videoPreset!=='480p30'||request.settings.audioBitrateKbps!==320||request.train?.sourceRate!==48000||request.train.frames!==Math.ceil(request.train.samples/1600)||!Array.isArray(request.train.slots)||!request.train.slots.length)throw Error('program_acquisition_scope');
  await scope.json(key+'-request-use.json',{acquisition:key,artifactId:'program-request',bytes:raw.length,sha256:sha(raw)},196608,'runtimeBinding',work);
  const noise=await work.run(()=>generateNoise(owner,48000,request.train.samples,{signal:work.signal,observeCapture:async(seed,capture)=>{await scope.write(key+'-noise-'+seed+'.pcm',capture.raw,2380800,'pcm',work);await scope.json(key+'-noise-'+seed+'-owner.json',{...capture,raw:undefined,stderr:Buffer.from(capture.stderr).toString('base64')},196608,'native',work);}}));
  const pcm=constructTrainPcm(request.train,noise),file=scope.path(key+'.ts'),producer=await encodeProgram(owner,{settings:request.settings,construction:{kind:'massFrames',train:request.train},frameCount:request.train.frames,pcm,path:file,store:scope},{...io,acquisition:work,dependencies:async()=>binding});
  result=await readQualificationRecording(owner,file,{settings:request.settings,path:'program',frames:request.train.frames,samples:request.train.samples,producerEvidence:producer.producerEvidence,store:scope},{...io,acquisition:work});
 }catch(error){failure=error;if(created&&!error.bindingFailure)await retainBindingFailure(scope,key,error,control,error.qualificationPrerequisite?'decode':'encode');}
 finally{work.signal.removeEventListener('abort',abort);work.dispose();try{cleanup=owner?await control.run(close):{closed:true,liveChildren:0,liveGroups:0};}catch(error){cleanup={closed:false};if(failure)failure.cleanupError=error;else failure=error;}}
 try{
  if(!cleanup?.closed&&!failure)failure=Error('program_acquisition_cleanup');
  const receipt={schema:'program-local-receipt-v1',scope:'single-canary-train-program-only',invocationId:ID,groupId:'canary-000',state:result&&!failure?'local-conditional-pending-outer':'Unproven',assurance:!failure?result?.assurance??null:null,cleanup,metadata,binding:binding?{candidateSHA:binding.candidateSHA,intentSHA:binding.intentSHA,contextSHA:binding.contextSHA,imageManifestSHA:inspectAcquiredDependencies(binding)?.intent.imageFacts.manifestSHA}:null,replayRef:result?.programProof.replayRef??null,pairedQualification:false,capacityAccepted:false,...(failure?{failure:{message:String(failure.message).slice(0,1024),journal:failure.bindingFailure??failure.recordFailure??null,secondary:failure.cleanupError?.message??failure.retentionError?.message??null}}:{})};
  if(result&&!failure)receipt.resultRef=await control.run(()=>scope.writeProgramOuter(key,key+'-result.json',Buffer.from(JSON.stringify(result)+'\n'),control));
  const bytes=Buffer.from(JSON.stringify(receipt)+'\n');if(result&&!failure)scope.checkProgramOuterFinal(key,bytes.length);else scope.checkFinal([bytes]);
  if(created)await control.run(()=>(io.fileSystem?.writeFile??writeFile)(directory+'/receipt.json',bytes,{flag:'wx',mode:0o600,signal:control.signal}));
  control.check();if(failure)throw Object.assign(failure,{receipt});return receipt;
 }catch(error){if(failure&&error!==failure){failure.finalizationError=error;throw failure;}throw error;}finally{control.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==4||process.argv[2]!=='--output-dir')throw Error('usage: node scripts/event-marker-program-acquire.mjs --output-dir /tmp/marker-program-RUN');try{console.log(JSON.stringify(await acquirePositiveProgram({directory:process.argv[3]})));}catch(error){console.error(JSON.stringify({state:'Unproven',error:error.message,receipt:error.receipt??null}));process.exitCode=1;}}
