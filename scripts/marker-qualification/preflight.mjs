import { readFile,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { enumerateQualification,binding,plan,associationPlan,literalProfilePlan,wire } from './authority.mjs';
import { validateNativeTask } from './request.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateSourceManifest(manifest,packaging,revision) {
 if(!manifest||manifest.schema!==1||manifest.revision!==revision||!Array.isArray(manifest.files)||manifest.files.length!==packaging.length||new Set(packaging).size!==packaging.length||new Set(manifest.files.map(f=>f.path)).size!==packaging.length)throw Error('qualification_sources');
 for(const f of manifest.files)if(Object.keys(f).sort().join(',')!=='bytes,path,sha256'||!packaging.includes(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>8388608||!/^[0-9a-f]{64}$/.test(f.sha256))throw Error('qualification_sources');
 return manifest.files;
}
export function validateCanaryAuthority(receipt,pins) {
 const a=enumerateQualification(),ids=a.groups[0].invocations,expected=binding(ids.flatMap(id=>a.invocations.find(i=>i.id===id).rows));
 if(!receipt||receipt.schema!=='marker-qualification-terminal-v1'||receipt.groupId!=='canary-000'||receipt.workPassed!==true||receipt.artifactUploadsComplete!==true||receipt.cleanup?.closed!==true||wire(receipt.pins)!==wire(pins)||wire(receipt.expected)!==wire(expected)||!Array.isArray(receipt.invocations)||receipt.invocations.length!==ids.length)throw Error('qualification_canary');
 for(const [i,id] of ids.entries()){const r=receipt.invocations[i],count=a.invocations.find(v=>v.id===id).rows.length;if(r.id!==id||r.counts.pass!==count||r.counts.fail!==0||r.counts.incomplete!==0)throw Error('qualification_canary');}
 return true;
}
async function boundedFile(path,max) {
 const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>max)throw Error('qualification_source_file');
 const bytes=await readFile(path);if(bytes.length!==s.size)throw Error('qualification_source_file');return bytes;
}
export async function qualificationPreflight(request,owner,{env=process.env}={}) {
 if(process.versions.node!==plan.runtimeRequired.node)throw Error('qualification_runtime_node');
 const sourceBytes=await boundedFile(request.sourceManifestPath,131072);
 if(sha(sourceBytes)!==request.sourceManifestSha256)throw Error('qualification_sources_sha');
 const packaging=JSON.parse(await readFile('workers/restream/packaging-manifest.json','utf8'));
 const files=validateSourceManifest(JSON.parse(sourceBytes),packaging,request.revision);
 for(const f of files){const bytes=await boundedFile(f.path,f.bytes);if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('qualification_sources_sha');}
 const version=await owner.run('ffmpeg',['-version'],{timeoutMs:10000,maxBytes:16384});
 if(!/^ffmpeg version 5\.1\.9(?:[-\s])/m.test(version.toString()))throw Error('qualification_runtime_ffmpeg');
 const endpoint=env.ECS_CONTAINER_METADATA_URI_V4;
 if(typeof endpoint!=='string'||!/^http:\/\/169\.254\.170\.2\/v4\/[a-zA-Z0-9-]+$/.test(endpoint))throw Error('qualification_metadata_uri');
 const response=await fetch(endpoint+'/task',{signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('qualification_metadata_response');
 const chunks=[];let total=0;
 for await(const chunk of response.body){total+=chunk.length;if(total>65536)throw Error('qualification_metadata_bound');chunks.push(chunk);}
 const text=Buffer.concat(chunks).toString();
 const native=validateNativeTask(JSON.parse(text),request),authority=enumerateQualification();
 const pins={imageDigest:request.imageDigest,sourceManifestSha256:request.sourceManifestSha256,planSha256:sha(wire({plan,associationPlan,literalProfilePlan})),expectedContractsSha256:binding(authority.rows).expectedContractsSha256};
 if(request.groupId!=='canary-000'){
  const bytes=await boundedFile(request.canaryReceiptPath,65536);if(sha(bytes)!==request.canaryReceiptSha256)throw Error('qualification_canary_sha');validateCanaryAuthority(JSON.parse(bytes),pins);
 }
 return {pins,native,sourceFileCount:files.length,nodeVersion:process.versions.node,ffmpegVersion:'5.1.9',rootNativeStoppedAndRetrievalAttestationStillRequired:true};
}
