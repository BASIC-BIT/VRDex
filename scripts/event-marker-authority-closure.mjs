import { PROGRAM_AUTHORITY_REFS } from './event-marker-program-contract.mjs';
const must=(v,r)=>{if(!v)throw Error('native_authority_'+r);};
const valid=r=>r&&['audit','runtime'].includes(r.kind)&&typeof r.id==='string'&&r.id.length>0&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&/^[0-9a-f]{64}$/.test(r.sha256)&&(!r.range||Number.isSafeInteger(r.range.start)&&Number.isSafeInteger(r.range.length)&&r.range.start>=0&&r.range.length>0&&r.range.start+r.range.length<=r.bytes);
/** Mandatory originals always denote the complete body, including when a caller
 * supplies an otherwise valid full-length range or an explicit null range. */
export function isFullAuthorityReference(actual,expected){
 return Boolean(actual&&expected&&actual.kind===expected.kind&&actual.id===expected.id&&actual.bytes===expected.bytes&&actual.sha256===expected.sha256&&!Object.hasOwn(actual,'range'));
}
export function requireMandatoryAuthorityMembership(audits){
 must(Array.isArray(audits)&&audits.every(r=>valid(r)&&r.kind==='audit')&&new Set(audits.map(r=>r.id)).size===audits.length,'audit_catalog');
 for(const expected of PROGRAM_AUTHORITY_REFS)must(audits.some(actual=>isFullAuthorityReference(actual,expected)),'required_reference');
}
export function requiredAuthorityReferences({profile,proof,closure,plans,manifest}){
 const refs=[profile.platformAssumptionsRef,profile.sourceAuditRef,profile.platform.view.auditRef,plans.generatorAuditRef,...profile.objects.flatMap(o=>[o.provenanceRef,...(o.partition==='critical'?[o.sourceBuildRef]:[])]),...closure.files.map(f=>f.sourceAuditRef),...proof.descriptions.flatMap(d=>[d.auditRef,...d.sourceRefs]),...manifest.entries.flatMap(e=>e.dependsOn??[])];
 const unique=new Map();for(const r of refs){must(valid(r),'reference');const previous=unique.get(r.id);must(!previous||previous.kind===r.kind&&previous.bytes===r.bytes&&previous.sha256===r.sha256,'conflict');unique.set(r.id,r);}return refs;
}
export function requireAuthorityMembership(deps,audits){
 requireMandatoryAuthorityMembership(audits);
 for(const ref of requiredAuthorityReferences(deps)){const expected=ref.kind==='audit'?audits.find(a=>a.id===ref.id):deps.manifest.entries.find(a=>a.id===ref.id);must(expected&&expected.bytes===ref.bytes&&expected.sha256===ref.sha256,'required_reference');}
}
const common=['workers/restream/Dockerfile','workers/restream/install_twitch.py','workers/restream/packaging-manifest.json','workers/restream/twitch-requirements.lock','workers/restream/twitch-wheels.lock.json','scripts/event-marker-native-bundle.mjs'];
export function producerSourcePaths(execution,packaging){
 must(Array.isArray(packaging)&&packaging.length>0&&packaging.length<=256&&new Set(packaging).size===packaging.length&&packaging.every(p=>typeof p==='string'&&!p.startsWith('/')&&!p.split('/').includes('..')),'packaging');
 const selected=execution?.producer==='root-program-v1'?['scripts/event-marker-native-ecs-controller.mjs','scripts/event-marker-root-retrieval.mjs','scripts/event-marker-root-retrieval.py','scripts/event-marker-program-collector.mjs']:execution?.producer==='ci-native132-v1'?['.github/workflows/baseline-checks.yml','.github/scripts/restream-native.mjs','.github/scripts/restream-native-names.json','scripts/event-marker-native-ci-controller.mjs']:null;
 must(selected,'producer');return [...new Set([...common,...selected,...packaging])].sort();
}
