import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writeFile,rename } from 'node:fs/promises';
import { inspectAcquiredDependencies,expandImplementationObservations } from './event-marker-native-binding.mjs';
import { validateMountView } from './event-marker-platform-view.mjs';
import { inspectEngineArchive,validateBindingInventory } from './event-marker-engine-readback.mjs';
import { validateReceipt } from './event-marker-native132-receipt.mjs';
import { artifactUseEntries } from './marker-qualification/artifacts.mjs';
import { PROGRAM_SOURCE_CONTRACT } from './event-marker-program-guards.mjs';
import { requireAuthorityMembership,producerSourcePaths } from './event-marker-authority-closure.mjs';
import { validateExecution,validateExecutionCommand,deriveEvidencePolicy,invocationAggregate } from './event-marker-evidence-policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=v=>Buffer.from(JSON.stringify(v)),same=isDeepStrictEqual;
const must=(v,r)=>{if(!v)throw Error('native_controller_'+r);};
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const nativeArtifact=(kind,id,bytes)=>({kind,id,bytes:bytes.length,sha256:sha(bytes)});
export const nativeJsonArtifact=(kind,id,value)=>{const bytes=json(value);return {ref:nativeArtifact(kind,id,bytes),bytes};};

/** K closes first. Source/audit artifacts are complete originals, never future
 * approval, context, launch or receipt references. A is only in Root's ledger. */
export function makeNativeCandidate({sourceFiles,auditRefs,profileSHA,runtimeManifestSHA,observerClosureSHA,controller,environmentClass,execution}) {
 must(['ci','ecs'].includes(environmentClass)&&[profileSHA,runtimeManifestSHA,observerClosureSHA].every(hash)&&Array.isArray(sourceFiles)&&sourceFiles.length>0&&Array.isArray(auditRefs)&&auditRefs.length>0,'candidate');
 const refs=[...sourceFiles,...auditRefs];must(refs.every(r=>r&&typeof r.id==='string'&&hash(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&['implementationCode','runtimeData','audit'].includes(r.kind))&&new Set(refs.map(r=>r.id)).size===refs.length,'candidate_references');
 must(sourceFiles.every(r=>['implementationCode','runtimeData'].includes(r.kind)&&(r.imagePath==='/app/'+r.id||r.imagePath===null))&&auditRefs.every(r=>r.kind==='audit'),'candidate_roles');
 must(sourceFiles.some(r=>r.id===controller.id&&r.sha256===controller.sha256),'controller');
 if(execution)validateExecution(execution);
 return nativeJsonArtifact('audit','K',{schema:'native-candidate-v1',sourceContract:PROGRAM_SOURCE_CONTRACT,sourceFiles,auditRefs,profileSHA,runtimeManifestSHA,observerClosureSHA,controller,environmentClass,...(execution?{execution}:{})});
}
export function imageFactsFromEcr({manifest,config,manifestDigest,reference,outerImageEvidenceId}) {
 const m=JSON.parse(manifest),c=JSON.parse(config);must(sha(manifest)===manifestDigest?.replace(/^sha256:/,'')&&m.schemaVersion===2&&m.config?.digest==='sha256:'+sha(config)&&m.config.size===config.length,'manifest');
 must(c.os==='linux'&&c.architecture==='amd64'&&c.rootfs?.type==='layers'&&Array.isArray(c.rootfs.diff_ids)&&c.rootfs.diff_ids.length===m.layers?.length&&c.rootfs.diff_ids.every(d=>/^sha256:[0-9a-f]{64}$/.test(d)),'image_config');
 return {kind:'ecrManifestConfig',manifestSHA:sha(manifest),manifestBytes:manifest.length,configSHA:sha(config),configBytes:config.length,diffIdsSHA:sha(json(c.rootfs.diff_ids)),diffIds:c.rootfs.diff_ids,reference,outerImageEvidenceId};
}

/** R76 S3: bounded streaming classic Docker save. Only manifest/config/small
 * metadata occupy the <=1MiB parser; full layer tar bytes enter independent
 * hashes without rootfs extraction or a whole save file. */
export async function scanDockerSave(chunks,{imageId,inspect,terminal,check=()=>{}}) {
 const CAP=2147483648,PARSER=1048576,whole=createHash('sha256'),members=new Map();let total=0,pending=Buffer.alloc(0),current=null,padding=0,zeros=0,ended=false,retained=0,memberCount=0;
 const octal=b=>{const s=b.toString('ascii').replace(/\0.*$/,'').trim();must(/^[0-7]+$/.test(s),'tar_octal');const n=parseInt(s,8);must(Number.isSafeInteger(n),'tar_octal');return n;};
 const cstr=b=>{const zero=b.indexOf(0);return b.subarray(0,zero<0?b.length:zero).toString('utf8');};
 for await(const original of chunks){check();const chunk=Buffer.from(original.buffer,original.byteOffset,original.byteLength);total+=chunk.length;must(total<=CAP,'save_cap');whole.update(chunk);let offset=0;
  while(offset<chunk.length){
   if(padding){const n=Math.min(padding,chunk.length-offset);must(chunk.subarray(offset,offset+n).every(b=>b===0),'tar_padding');padding-=n;offset+=n;continue;}
   if(current){const take=Math.min(current.remaining,chunk.length-offset),b=chunk.subarray(offset,offset+take);current.hash.update(b);if(current.keep){retained+=b.length;must(retained<=PARSER,'parser_cap');current.parts.push(Buffer.from(b));}current.remaining-=take;offset+=take;
    if(current.remaining===0){padding=(512-current.bytes%512)%512;members.set(current.name,{bytes:current.bytes,sha256:current.hash.digest('hex'),data:current.keep?Buffer.concat(current.parts):null});current=null;}continue;
   }
   const need=512-pending.length,take=Math.min(need,chunk.length-offset);pending=Buffer.concat([pending,chunk.subarray(offset,offset+take)]);offset+=take;if(pending.length!==512)continue;
   const header=pending;pending=Buffer.alloc(0);if(header.every(b=>b===0)){zeros++;ended=zeros>=2;continue;}must(!ended&&zeros===0,'tar_after_eof');
   const name=cstr(header.subarray(0,100)),prefix=cstr(header.subarray(345,500)),size=octal(header.subarray(124,136)),type=header[156];let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];must(checksum===octal(header.subarray(148,156))&&!prefix&&/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').includes('..')&&!members.has(name),'tar_header');
   must(++memberCount<=1024,'tar_member_cap');retained+=1024;must(retained<=PARSER,'parser_cap');
   if(type===53){must(size===0&&name.endsWith('/'),'tar_directory');members.set(name,{bytes:0,sha256:sha(Buffer.alloc(0)),data:null});continue;}
   must(type===0||type===48,'tar_type');const keep=!name.endsWith('/layer.tar');must(!keep||size<=65536,'candidate_cap');must(!keep||retained+size<=PARSER,'parser_cap');
   current={name,bytes:size,remaining:size,hash:createHash('sha256'),keep,parts:[]};if(size===0){members.set(name,{bytes:0,sha256:sha(Buffer.alloc(0)),data:Buffer.alloc(0)});current=null;}
  }
 }
 must(!current&&!padding&&pending.length===0&&ended&&terminal?.exitCode===0&&terminal.signal===null&&terminal.stdoutEOF===true&&terminal.stderrEOF===true&&!terminal.error,'save_completion');
 const manifests=JSON.parse(members.get('manifest.json')?.data);must(Array.isArray(manifests)&&manifests.length===1,'save_manifest');const m=manifests[0],configuration=members.get(m.Config);must(configuration?.data&&m.Config===imageId.replace(/^sha256:/,'')+'.json'&&configuration.sha256===imageId.replace(/^sha256:/,''),'save_config');
 const config=JSON.parse(configuration.data),observed=JSON.parse(inspect);must(observed.length===1&&observed[0].Id===imageId&&same(observed[0].RootFS?.Layers,config.rootfs?.diff_ids)&&m.Layers.length===config.rootfs.diff_ids.length&&config.os==='linux'&&config.architecture==='amd64','save_inspect');
 m.Layers.forEach((name,i)=>must(members.get(name)?.sha256===config.rootfs.diff_ids[i].replace(/^sha256:/,''),'layer_diffid'));
 const allowed=new Set(['manifest.json','repositories',m.Config,...m.Layers]);for(const name of m.Layers){const directory=name.slice(0,name.lastIndexOf('/')+1);for(const suffix of ['', 'json','VERSION'])allowed.add(directory+suffix);}for(const [name] of members)must(allowed.has(name),'save_member');
 return {kind:'localUnpublishedImage',localImageId:imageId,configSHA:configuration.sha256,configBytes:configuration.bytes,diffIdsSHA:sha(json(config.rootfs.diff_ids)),diffIds:config.rootfs.diff_ids,outerImageEvidenceId:'image',archive:{bytes:total,sha256:whole.digest('hex'),complete:true},inspect:{bytes:inspect.length,sha256:sha(inspect)},originals:{configUTF8:configuration.data.toString(),manifestUTF8:members.get('manifest.json').data.toString(),inspectUTF8:inspect.toString(),layers:m.Layers.map(name=>({name,bytes:members.get(name).bytes,sha256:members.get(name).sha256})),terminal}};
}

export function makeNativeIntent({candidate,imageFacts,workload,semanticEnvironment,nonce,deadline,transport}) {
 const k=JSON.parse(candidate.bytes);must(candidate.ref.sha256===sha(candidate.bytes)&&k.schema==='native-candidate-v1'&&same(k.sourceContract,PROGRAM_SOURCE_CONTRACT),'candidate_hash');
 must(typeof nonce==='string'&&nonce.length>0&&Buffer.byteLength(nonce)<=128&&Number.isFinite(deadline)&&Array.isArray(workload.originalCommand)&&workload.originalCommand.every(v=>typeof v==='string')&&hash(imageFacts.configSHA)&&hash(imageFacts.diffIdsSHA)&&Number.isSafeInteger(imageFacts.configBytes)&&imageFacts.configBytes>0,'intent');
 must(!Object.keys(semanticEnvironment).some(k=>/^(?:LD_|DYLD_|VRDEX_NATIVE_BINDING_CONTEXT)/.test(k)||['NODE_OPTIONS','NODE_PATH'].includes(k))&&Object.values(semanticEnvironment).every(v=>typeof v==='string'),'environment');
 if(k.execution)validateExecutionCommand(k.execution,workload.originalCommand);
 const {originals:unused,...projection}=imageFacts;
 const intent=nativeJsonArtifact('observation','I',{schema:'native-intent-v1',nonce,candidateManifestSHA:candidate.ref.sha256,candidateManifestBytes:candidate.bytes.length,profileSHA:k.profileSHA,runtimeManifestSHA:k.runtimeManifestSHA,observerClosureSHA:k.observerClosureSHA,imageFacts:projection,workload,semanticEnvironment,transport,deadline,...(k.execution?{execution:k.execution}:{})});
 const context=nativeJsonArtifact('observation','C',{schema:'native-context-v1',intent:{utf8:intent.bytes.toString(),bytes:intent.bytes.length,sha256:intent.ref.sha256}});must(context.bytes.length<=4096,'context_cap');return {intent,context};
}
export async function installCiContext(context,directory) {
 must(context.bytes.length<=4096&&sha(context.bytes)===context.ref.sha256,'context');const temporary=directory+'/context.json.tmp',path=directory+'/context.json';await writeFile(temporary,context.bytes,{flag:'wx',mode:0o400});await rename(temporary,path);return path;
}
export function prepareCiCreate({candidate,imageFacts,workload,semanticEnvironment,nonce,deadline,originalArguments,contextPath}) {
 const pair=makeNativeIntent({candidate,imageFacts,workload,semanticEnvironment,nonce,deadline,transport:{kind:'file',name:'VRDEX_NATIVE_BINDING_CONTEXT',path:'/run/vrdex-native/context.json',hostPath:contextPath}});
 must(originalArguments[0]==='create'&&originalArguments.includes(imageFacts.localImageId)&&typeof contextPath==='string'&&contextPath.startsWith('/')&&!originalArguments.some(a=>a.includes('VRDEX_NATIVE_BINDING_CONTEXT')||a.includes('/run/vrdex-native/context.json')),'create_argv');
 const index=originalArguments.indexOf(imageFacts.localImageId),args=[...originalArguments.slice(0,index),'--mount',`type=bind,source=${contextPath},target=/run/vrdex-native/context.json,readonly`,'-e','VRDEX_NATIVE_BINDING_CONTEXT=/run/vrdex-native/context.json',...originalArguments.slice(index)];
 return {...pair,launch:nativeJsonArtifact('observation','Q',{schema:'native-launch-v1',kind:'docker-create',command:'docker',args,contextSHA:pair.context.ref.sha256,intentSHA:pair.intent.ref.sha256})};
}

/** Independent outer acceptance reads originals through Root-owned resolvers.
 * The child supplies only its pending refs; no child approval field is read. */
export async function verifyNativeOuterJoins({binding,manifest,budget,serialized,invocations,outerResolver,rootLedger}) {
 const originals=new Map(),get=async(id,cap=8388608)=>{if(originals.has(id)){const b=originals.get(id);must(b.length<=cap,'outer_original');return b;}const raw=await outerResolver(id);must(raw instanceof Uint8Array,'outer_original');const b=Buffer.from(raw);must(b.length>0&&b.length<=cap,'outer_original');originals.set(id,b);return b;};
 const documents={};for(const id of ['K','I','C','Q','L','image'])documents[id]=JSON.parse(await get(id,196608));const {K,I,C,Q,L,image}=documents;
 must(sha(originals.get('K'))===binding.candidateSHA&&sha(originals.get('I'))===binding.intentSHA&&sha(originals.get('C'))===binding.contextSHA&&K.profileSHA===binding.profileSHA&&K.runtimeManifestSHA===binding.manifestSHA&&K.observerClosureSHA===binding.observerClosureSHA&&same(K.sourceContract,PROGRAM_SOURCE_CONTRACT),'candidate_join');
 const {originals:imageOriginals,...imageProjection}=image;
 must(C.schema==='native-context-v1'&&C.intent.utf8===originals.get('I').toString()&&C.intent.sha256===sha(originals.get('I'))&&C.intent.bytes===originals.get('I').length&&originals.get('C').length<=4096&&I.candidateManifestSHA===sha(originals.get('K'))&&I.candidateManifestBytes===originals.get('K').length&&same(I.imageFacts,imageProjection),'intent_context_image');
 const sourceBodies=new Map();for(const ref of [...K.sourceFiles,...K.auditRefs]){const raw=await outerResolver(ref.id);must(raw instanceof Uint8Array&&raw.length===ref.bytes&&sha(raw)===ref.sha256,'candidate_member');sourceBodies.set(ref.id,raw);}
 requireAuthorityMembership(inspectAcquiredDependencies(binding),K.auditRefs);
 must(same(K.execution,I.execution),'execution_join');validateExecutionCommand(K.execution,I.workload.originalCommand);
 const packaging=JSON.parse(sourceBodies.get('workers/restream/packaging-manifest.json'));
 for(const path of producerSourcePaths(K.execution,packaging))must(K.sourceFiles.some(f=>f.id===path)&&sourceBodies.has(path),'producer_closure');
 must(K.controller.id===(K.execution.producer==='root-program-v1'?'scripts/event-marker-native-ecs-controller.mjs':'scripts/event-marker-native-ci-controller.mjs'),'selected_controller');
 // R87: the complete semantic eligibility catalog is bound to K. Full matching
 // code originals are required even after image cleanup; supplied totals or a
 // hash-only registry never substitute for source possession.
 for(const observed of expandImplementationObservations(binding.implementation,inspectAcquiredDependencies(binding).closure)){const ref=K.sourceFiles.find(r=>r.id===observed.path);must(ref&&ref.imagePath==='/app/'+observed.path&&ref.kind===observed.kind&&ref.bytes===observed.bytes&&ref.sha256===observed.sha256,'image_source_member');}
 const codeAssets=inspectAcquiredDependencies(binding).closure.files.filter(f=>f.loaded&&f.kind==='implementationCode');for(const index of budget.implementationAssets){const asset=codeAssets[index],ref=asset&&K.sourceFiles.find(r=>r.id===asset.path);must(ref?.kind==='implementationCode'&&sourceBodies.get(asset.path)?.length===asset.bytes&&ref.sha256===asset.sha256,'implementation_possession');}
 const ledger=await rootLedger.lookup(binding.candidateSHA);must(ledger&&ledger.original instanceof Uint8Array&&typeof ledger.ledgerId==='string'&&ledger.ledgerId.length>0,'external_approval');const A=JSON.parse(ledger.original);
 must(A.schema==='native-root-approval-v1'&&A.decision==='approve-trustedStackMeasurement'&&A.candidateSHA===sha(originals.get('K'))&&A.profileSHA===binding.profileSHA&&A.environmentClass===K.environmentClass&&A.ledgerId===ledger.ledgerId&&A.recordId===ledger.recordId&&same(A.auditRefs,K.auditRefs)&&Number.isFinite(Date.parse(A.issuedAtUTC))&&Date.parse(A.issuedAtUTC)<=Date.parse(L.startedAtUTC),'root_approval');
 const readRef=async(ref,cap)=>{const id=ref?.id??ref?.name;must(typeof id==='string'&&hash(ref.sha256)&&Number.isSafeInteger(ref.bytes),'outer_reference');const b=await get(id,cap);must(b.length===ref.bytes&&sha(b)===ref.sha256,'outer_hash');return b;};
 must(Q.schema==='native-launch-v1'&&Q.contextSHA===sha(originals.get('C'))&&Q.intentSHA===sha(originals.get('I'))&&L.schema==='native-outer-ledger-v1'&&L.requestSHA===sha(originals.get('Q'))&&L.contextSHA===sha(originals.get('C'))&&L.intentSHA===sha(originals.get('I'))&&L.imageConfigSHA===image.configSHA&&L.nativeExit===0&&L.nativeSignal===null,'launch_terminal');
 let domainNumeric=0,programReceipt,validatedArchiveIds=new Set();
 if(K.execution.domain==='program'){must(K.environmentClass==='ecs'&&L.domain==='program','domain');
 const terminal=JSON.parse(await readRef(L.receiptRef,65536));programReceipt=terminal;must(terminal.schema==='program-local-receipt-v1'&&terminal.assurance?.kind==='trustedStackMeasurement'&&terminal.assurance.pendingOuterJoin===true&&terminal.assurance.nativeBindingVerified===false&&terminal.assurance.loaderComplete===false&&terminal.cleanup?.closed===true&&terminal.cleanup.liveChildren===0&&terminal.cleanup.liveGroups===0,'inner_receipt');
 must(terminal.replayRef.sha256===L.artifactUseRef.sha256&&terminal.replayRef.bytes===L.artifactUseRef.bytes&&L.artifactUseRef.sha256===sha(Buffer.from(JSON.stringify(manifest)+'\n'))&&L.artifactUsesSHA===sha(json(manifest.budget.uses)),'artifact_uses');
 const metadataOriginals=[0,1].map(i=>artifactUseEntries(manifest.budget).find(r=>r.name===manifest.recordKey+'-metadata-'+i+'.json'));must(metadataOriginals.every(Boolean)&&same(metadataOriginals.map(r=>[r.bytes,r.sha256]),(terminal.metadata?.originals??[]).map(r=>[r.bytes,r.sha256])),'metadata_inventory');
 const resultOriginal=await readRef(terminal.resultRef,196608);must(resultOriginal.equals(Buffer.from(JSON.stringify(serialized)+'\n')),'result_original');
 const readback=JSON.parse(await readRef(L.readbackRef,196608)),expected=[...artifactUseEntries(manifest.budget).map(({event,kind,...ref})=>ref),{...terminal.replayRef},terminal.resultRef,L.receiptRef],readbackEntry=f=>({name:f.name??f.id,bytes:f.bytes,sha256:f.sha256});
 await verifyRootOriginalReadback({readback,expected,terminal,I,K,Q,L,readRef});
 }else{must(K.environmentClass==='ci'&&L.domain==='native132','domain');const readback=await verifyNative132Readback({L,readRef,sourceBodies,binding,budget});domainNumeric=readback.combined;validatedArchiveIds=readback.archiveIds;}
 if(K.environmentClass==='ci'){
  const o=imageOriginals;must(image.kind==='localUnpublishedImage'&&o&&sha(Buffer.from(o.configUTF8))===image.configSHA&&Buffer.byteLength(o.configUTF8)===image.configBytes&&sha(Buffer.from(o.inspectUTF8))===image.inspect.sha256&&image.archive.complete===true&&image.archive.bytes<=2147483648&&o.terminal.exitCode===0&&o.terminal.signal===null&&o.terminal.stdoutEOF===true&&o.terminal.stderrEOF===true,'ci_image');
  const config=JSON.parse(o.configUTF8),inspectedImage=JSON.parse(o.inspectUTF8),saved=JSON.parse(o.manifestUTF8);must(config.architecture==='amd64'&&config.os==='linux'&&same(config.rootfs.diff_ids,image.diffIds)&&sha(json(config.rootfs.diff_ids))===image.diffIdsSHA&&inspectedImage.length===1&&inspectedImage[0].Id===image.localImageId&&same(inspectedImage[0].RootFS.Layers,image.diffIds)&&saved.length===1&&saved[0].Config===image.configSHA+'.json'&&same(saved[0].Layers,o.layers.map(l=>l.name))&&same(o.layers.map(l=>'sha256:'+l.sha256),image.diffIds),'ci_image');
  const container=JSON.parse(await readRef(L.containerReadbackRef,196608)),cleanup=JSON.parse(await readRef(L.cleanupRef,196608));
  must(Q.kind==='docker-create'&&Q.command==='docker'&&Q.args.filter(a=>a==='VRDEX_NATIVE_BINDING_CONTEXT=/run/vrdex-native/context.json').length===1&&Q.args.filter(a=>a===`type=bind,source=${I.transport.hostPath},target=/run/vrdex-native/context.json,readonly`).length===1&&Q.args.includes(image.localImageId)&&container.length===1&&container[0].Image===image.localImageId&&container[0].Id===L.createdId&&container[0].State.ExitCode===0&&container[0].State.Running===false&&L.metadata?.kind==='local-notApplicable'&&cleanup.schema==='native-docker-cleanup-v1'&&cleanup.ownedName.stdout===''&&cleanup.ownedId.stdout===''&&[cleanup.remove,cleanup.ownedName,cleanup.ownedId].every(r=>r.code===0&&r.signal===null&&r.failure===null),'ci_join');
 }else{
  const m=await readRef(L.imageManifestRef,1048576),c=await readRef(L.imageConfigRef,1048576),derived=imageFactsFromEcr({manifest:m,config:c,manifestDigest:'sha256:'+image.manifestSHA,reference:image.reference,outerImageEvidenceId:image.outerImageEvidenceId});must(same(derived,image),'ecs_image');
  must(Q.kind==='ecs-run-task'&&Q.boundary?.kind==='MCP-call_boto3'&&Q.parametersJSON===JSON.stringify(Q.parameters)&&sha(Buffer.from(Q.parametersJSON))===Q.parametersSHA256&&Buffer.byteLength(JSON.stringify(Q.parameters.overrides))<=8192,'ecs_request');
  const overrides=Q.parameters.overrides.containerOverrides,matches=overrides.flatMap(c=>c.environment??[]).filter(e=>e.name==='VRDEX_NATIVE_BINDING_CONTEXT_B64'),selected=overrides.filter(c=>c.name===I.workload.containerName);must(matches.length===1&&matches[0].value===originals.get('C').toString('base64')&&selected.length===1&&same(selected[0].command,I.workload.originalCommand)&&Q.parameters.count===1,'ecs_context');
  const response=JSON.parse(await readRef(L.runTaskResponseRef,1048576)),readback=JSON.parse(await readRef(L.taskReadbackRef,1048576)),task=readback.tasks?.[0],launched=response.tasks?.[0],container=task?.containers?.find(c=>c.name===I.workload.containerName);must(response.tasks?.length===1&&readback.tasks?.length===1&&!response.failures?.length&&!readback.failures?.length&&task?.taskArn===launched?.taskArn&&task?.lastStatus==='STOPPED'&&container?.exitCode===0&&container.imageDigest===image.reference.split('@')[1],'ecs_terminal');
  must(programReceipt?.metadata?.kind==='ecs-v4'&&programReceipt.metadata.originals.length===2&&same(programReceipt.metadata.originals.map(r=>[r.bytes,r.sha256]),(L.metadata?.originals??[]).map(r=>[r.bytes,r.sha256]))&&L.metadata.elapsedMs===Math.max(...programReceipt.metadata.originals.map(r=>r.elapsedMs)),'metadata_original_binding');const metadata=[];for(const ref of L.metadata?.originals??[])metadata.push(JSON.parse(await readRef(ref,65536)));must(metadata.length===2&&L.metadata.elapsedMs<=2000&&L.metadata.elapsedMs>=0&&metadata[0].TaskARN===task.taskArn&&metadata[0].Containers?.some(c=>c.DockerId===container.runtimeId&&c.Name===I.workload.containerName)&&metadata[1].DockerId===container.runtimeId&&metadata[1].ImageID===L.rawImageID&&['sha256:'+image.configSHA,'sha256:'+image.manifestSHA].includes(L.rawImageID),'metadata_join');
  const deps=inspectAcquiredDependencies(binding);if(deps.profile.platform.view.mounts.some(m=>m.root.kind.startsWith('ecs-task-'))){must(invocations?.length===2,'ecs_view_observations');for(const observation of invocations){const original=observation.visibility.mountinfo,raw=Buffer.from(original.data,'base64');must(raw.length===original.bytes&&sha(raw)===original.sha256,'ecs_view_original');const rows=validateMountView(raw,deps.profile.platform.view,I.transport),id=rows.find(r=>r.ecsTaskId)?.ecsTaskId,containerId=rows.find(r=>r.ecsContainerId)?.ecsContainerId;must(id&&metadata[0].TaskARN.endsWith('/'+id)&&(!containerId||metadata[1].DockerId===containerId),'ecs_view_metadata');}}
 }
 // Only the exact archives validated by the native132 parser have already
 // entered domainNumeric, once per actual copy. PROGRAM has no exclusions.
 const policy=deriveEvidencePolicy(inspectAcquiredDependencies(binding),budget.invocation),charge=[...originals.entries()].filter(([id])=>!validatedArchiveIds.has(id)).reduce((n,[,b])=>n+b.length,0)+ledger.original.length;must(budget.policyId===policy.id&&budget.normalNumericCap===policy.normal&&budget.finalNumericCap===policy.final&&budget.failureReserve===policy.reserve&&budget.artifactCap===invocationAggregate(budget.invocation.kind)&&charge+domainNumeric<=budget.reservedOuterBytes&&budget.numericBytes+charge+domainNumeric<=policy.normal&&budget.artifactBytes+charge+domainNumeric<=budget.artifactCap-65536,'outer_budget');
 return {approvalRef:nativeArtifact('audit','A',ledger.original),...Object.fromEntries(['K','I','C','Q','L','image'].map(id=>[id,nativeArtifact(id==='K'?'audit':'observation',id,originals.get(id))])),chargedBytes:charge+domainNumeric,domainNumericBytes:domainNumeric,kind:K.execution.domain==='program'?'trustedStackMeasurement':'ValidatedNative132Transport',measurementAdmitted:K.execution.domain==='program',pendingOuterJoin:false,nativeBindingVerified:false,loaderComplete:false};
}

async function verifyNative132Readback({L,readRef,sourceBodies,binding,budget}){
 const readback=JSON.parse(await readRef(L.readbackRef,196608)),inventoryBytes=await readRef(L.inventoryRef,65536),inventory=validateBindingInventory(inventoryBytes),paths=['native-binding/inventory.json','receipt.json',...inventory.files.map(f=>f.path)];
 must(readback.schema==='native132-engine-readback-v1'&&same(readback.inventoryRef,L.inventoryRef)&&same(readback.nativeReceiptRef,L.nativeReceiptRef)&&same(readback.preludeReceiptRef,L.preludeReceiptRef)&&same(readback.copies.map(c=>c.path),paths),'native132_inventory');
 let combined=0;const bodies=new Map(),archiveIds=new Set();for(const c of readback.copies){must(same(c.request,['cp',L.createdId+':/tmp/event-capacity-ci-native/'+c.path,'-'])&&c.terminal.exitCode===0&&c.terminal.signal===null&&c.terminal.stdoutEOF&&c.terminal.stderrEOF&&!c.terminal.error&&Buffer.byteLength(c.stderrUTF8)<=131072,'native132_owner');const archive=await readRef(c.archiveRef,262144);combined+=archive.length;must(combined<=8388608,'native132_cap');const f=inventory.files.find(f=>f.path===c.path),expected={...f,path:c.path.split('/').at(-1),cap:c.path==='native-binding/inventory.json'?65536:c.path==='receipt.json'?131072:196608},member=inspectEngineArchive(archive,expected).files[0],body=archive.subarray(member.offset,member.offset+member.bytes);must(c.bodyRef.id===c.path&&c.bodyRef.bytes===body.length&&c.bodyRef.sha256===sha(body),'native132_member');bodies.set(c.path,body);archiveIds.add(c.archiveRef.id??c.archiveRef.name);}
 must(combined===readback.combinedArchiveBytes&&bodies.get('native-binding/inventory.json').equals(inventoryBytes),'native132_charge');
 validateReceipt(bodies.get('receipt.json').toString(),JSON.parse(sourceBodies.get('.github/scripts/restream-native-names.json')));
 const prelude=JSON.parse(bodies.get('native-binding/prelude-receipt.json')),observation=JSON.parse(bodies.get('native-binding/prelude-binding.json'));
 must(prelude.schema==='native-binding-prelude-v1'&&prelude.kind==='Unproven'&&prelude.measurementAdmitted===false&&prelude.nativeBindingVerified===false&&prelude.loaderComplete===false&&same(prelude.budget,budget)&&observation.candidateSHA===binding.candidateSHA&&observation.contextSHA===binding.contextSHA&&observation.manifestSHA===binding.manifestSHA,'native132_prelude');
 for(const [i,a] of binding.artifacts.entries()){const b=bodies.get('native-binding/prelude-original-'+i+'.bin');must(b&&b.length===a.bytes&&sha(b)===a.sha256,'native132_binding_original');}
 return {combined,archiveIds};
}
async function verifyRootOriginalReadback({readback,expected,terminal,I,K,Q,L,readRef}){
 must(K.execution.producer==='root-program-v1'&&K.execution.retrieval==='root-originals-v1'&&readback.schema==='single-program-root-helper-v1'&&readback.capacityAccepted===false&&readback.pairedQualification===false,'root_scope');
 const r=readback.retrieval,h=readback.helper,run=I.workload.originalCommand[3],name=f=>({name:f.name??f.id,bytes:f.bytes,sha256:f.sha256});
 must(h.command==='python3'&&h.script==='scripts/event-marker-root-retrieval.py'&&h.exitCode===0&&h.signal===null&&h.stdoutEOF&&h.stderrEOF&&h.closedBeforeDeadline&&readback.cleanup.closed&&readback.cleanup.emptyCensuses===2,'root_helper_completion');
 // The actual helper invocation and successful returned native capture are
 // retained independently by Root, not inferred from the provisional file.
 const completion=JSON.parse(await readRef(L.retrievalCompletionRef,196608));must(completion.schema==='root-helper-completion-v1'&&completion.exitCode===0&&completion.signal===null&&completion.completedAtMonotonic<completion.absoluteDeadlineMonotonic&&completion.readbackSHA===L.readbackRef.sha256&&completion.inputSHA===L.retrievalInputRef.sha256,'root_actual_return');
 const input=JSON.parse(await readRef(L.retrievalInputRef,196608));must(input.schema==='single-program-root-retrieval-input-v1'&&input.config.candidateSHA===I.candidateManifestSHA&&input.config.runId===run&&input.config.groupId==='canary-000'&&same(input.expected.launch,Q)&&input.expected.launch.intentSHA===L.intentSHA,'root_request');
 const terminalBytes=await readRef(L.collectorTerminalRef,65536),outer=JSON.parse(terminalBytes);must(outer.schema==='single-program-terminal-v1'&&outer.runId===run&&outer.groupId==='canary-000'&&outer.invocationId===I.execution.invocation.id&&outer.capacityAccepted===false&&outer.pairedQualification===false&&outer.programLocalComplete===true&&outer.artifactBindingComplete&&outer.artifactUploadsComplete&&outer.cleanup.closed&&outer.cleanup.emptyCensuses===2&&same(outer.receiptRef,name(L.receiptRef))&&same(outer.resultRef,terminal.resultRef)&&same(outer.replayRef,terminal.replayRef)&&outer.binding.candidateSHA===I.candidateManifestSHA&&outer.binding.contextSHA===L.contextSHA,'root_collector');
 const files=expected.map(name),byName=new Map(files.map(f=>[f.name,f]));must(byName.size===files.length&&same([...outer.artifacts].sort((a,b)=>a.name.localeCompare(b.name)),[...files].sort((a,b)=>a.name.localeCompare(b.name))),'root_inventory');
 const inventory=[{name:'terminal.json',bytes:terminalBytes.length,sha256:sha(terminalBytes)},...outer.artifacts];must(inventory.length<=257&&inventory.every(f=>Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=(['terminal.json','receipt.json'].includes(f.name)?65536:67108864))&&outer.artifacts.reduce((n,f)=>n+f.bytes,0)<=134152192,'root_group_cap');
 must(r.schema==='single-program-root-retrieval-v1'&&r.runId===run&&r.groupId==='canary-000'&&same(r.files,inventory)&&same(r.independentRemoteFiles,inventory)&&r.freeBeforeBytes>=536870912&&r.minimumFreeDuringBytes>=134217728&&r.localHighWaterBytes<=402653184&&r.finishedMonotonic<r.absoluteDeadlineMonotonic,'root_two_pass');
 must(r.native?.physicalClosed&&r.native.withinDeadlines&&r.native.exitCode===0&&same(r.native.records,input.records)&&same(r.native.expected,input.expected),'root_native_records');
 const rootTaskReadback=JSON.parse(await readRef(L.taskReadbackRef,1048576));must(same(input.records.task.response,rootTaskReadback),'root_task_readback');const task=input.records.task.response.tasks[0],definition=input.records.definition.response.taskDefinition,eni=input.records.eni.response;must(task.lastStatus==='STOPPED'&&task.taskArn===r.native.taskArn&&definition.status==='INACTIVE'&&definition.taskDefinitionArn===task.taskDefinitionArn&&Array.isArray(eni.NetworkInterfaces)&&eni.NetworkInterfaces.length===0,'root_physical_cleanup');
}
