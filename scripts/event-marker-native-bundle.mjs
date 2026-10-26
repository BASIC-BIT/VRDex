import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateProgramDependencies } from './event-marker-program-guards.mjs';
import { verifyImplementationSource,expandImplementationCatalog } from './event-marker-implementation-assets.mjs';
import { makeNativeCandidate,nativeArtifact } from './event-marker-native-controller.mjs';
import { requireAuthorityMembership,producerSourcePaths } from './event-marker-authority-closure.mjs';
import { validateExecution } from './event-marker-evidence-policy.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),must=(v,r)=>{if(!v)throw Error('native_bundle_'+r);};
const RUNTIME='workers/restream/native-binding/runtime/';
/** A deterministic materializer of EXPLICIT reviewed inputs. It validates whole
 * bytes and produces a new candidate; it never discovers eligibility, creates
 * an approval, or reads the private audit registry. A changed candidate needs a
 * new external Root decision. K stays outside the packaged runtime tree. */
export async function materializeNativeBundle(bundle,{readSource=path=>readFile(path),write}={}) {
 must(bundle?.schema==='native-reviewed-bundle-v1'&&['ci','ecs'].includes(bundle.environmentClass)&&Array.isArray(bundle.runtimeFiles)&&bundle.runtimeFiles.length>=5&&bundle.runtimeFiles.length<=257&&Array.isArray(bundle.sourceFiles)&&Array.isArray(bundle.auditRefs),'shape');
 const files=new Map();for(const f of bundle.runtimeFiles){must(typeof f.relativePath==='string'&&f.relativePath.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&!['.','..'].includes(p))&&!files.has(f.relativePath)&&typeof f.base64==='string','runtime_path');const b=Buffer.from(f.base64,'base64');must(b.toString('base64')===f.base64&&b.length===f.bytes&&b.length>0&&b.length<=196608&&sha(b)===f.sha256,'runtime_original');files.set(f.relativePath,b);}
 const manifestBytes=files.get('manifest.json');must(manifestBytes?.length<=65536,'manifest');const manifest=JSON.parse(manifestBytes);must(manifest.schema==='native-runtime-deps-v1'&&manifest.entries.length+1===files.size&&manifest.entries.length<=256,'manifest');
 for(const entry of manifest.entries){const b=files.get(entry.relativePath);must(b&&b.length===entry.bytes&&sha(b)===entry.sha256,'manifest_member');}
 const entry=key=>manifest.entries.find(e=>e.id===manifest.entrypoints[key]),read=key=>JSON.parse(files.get(entry(key)?.relativePath));
 const profile=read('profile'),proof=read('proofDescriptions'),closure=expandImplementationCatalog(read('verifierClosure')),plans=read('plans'),nativeCatalog=read('nativeCatalog');must(entry('profile').bytes<=65536,'profile_cap');const deps=validateProgramDependencies({profile,proof,closure,plans,nativeCatalog,manifest,intent:{semanticEnvironment:profile.environment}});requireAuthorityMembership(deps,bundle.auditRefs);validateExecution(bundle.execution);
 const sourceFiles=[],originals=new Map();for(const ref of bundle.sourceFiles){must(typeof ref.id==='string'&&/^(?:scripts|workers|tests|\.github\/(?:scripts|workflows))\/[A-Za-z0-9_./-]+$/.test(ref.id)&&!ref.id.split('/').includes('..'),'source_path');const b=await readSource(ref.id);must(b instanceof Uint8Array&&b.length===ref.bytes&&sha(b)===ref.sha256,'source_original');sourceFiles.push({...ref});originals.set(ref.id,b);const item=closure.files.find(f=>f.path===ref.id);if(item){must(ref.kind===item.kind&&ref.imagePath==='/app/'+item.path,'source_kind');verifyImplementationSource(item,b,closure);}}
 must(closure.files.every(f=>sourceFiles.some(s=>s.id===f.path&&s.bytes===f.bytes&&s.sha256===f.sha256&&s.kind===f.kind)),'source_closure');
 for(const path of producerSourcePaths(bundle.execution,JSON.parse(originals.get('workers/restream/packaging-manifest.json'))))must(originals.has(path),'producer_closure');
 const candidate=makeNativeCandidate({sourceFiles,auditRefs:bundle.auditRefs,profileSHA:entry('profile').sha256,runtimeManifestSHA:sha(manifestBytes),observerClosureSHA:entry('verifierClosure').sha256,controller:bundle.controller,environmentClass:bundle.environmentClass,execution:bundle.execution});
 if(write){for(const [path,b] of files)await write(RUNTIME+path,b);await write('provenance/native-binding/K.json',candidate.bytes);}
 return {candidate,runtimeFiles:[...files].map(([path,b])=>({path:RUNTIME+path,...nativeArtifact('runtime',path,b)})),state:'candidate-pending-external-Root-approval'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [bundlePath,sourceRoot,outputRoot]=process.argv.slice(2);if(!bundlePath||!sourceRoot||!outputRoot)throw Error('usage: node scripts/event-marker-native-bundle.mjs BUNDLE_JSON SOURCE_ROOT OUTPUT_ROOT');
 const bytes=await readFile(bundlePath);must(bytes.length<=2097152,'input_cap');const result=await materializeNativeBundle(JSON.parse(bytes),{readSource:path=>readFile(resolve(sourceRoot,path)),write:async(path,b)=>{const target=resolve(outputRoot,path);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,b,{flag:'wx',mode:0o600});}});console.log(JSON.stringify({candidate:result.candidate.ref,runtimeFiles:result.runtimeFiles,state:result.state}));
}
