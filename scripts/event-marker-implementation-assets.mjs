import { posix } from 'node:path';
import { createHash } from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const must=(v,r)=>{if(!v)throw Error('marker_implementation_'+r);};
export const IMPLEMENTATION_ROOTS=Object.freeze(['scripts/event-marker-program-acquire.mjs','scripts/marker-qualification/codec-io.mjs','scripts/marker-qualification/codec-record.mjs']);
export const PROGRAM_BUILTINS=Object.freeze(['node:assert/strict','node:child_process','node:crypto','node:events','node:fs','node:fs/promises','node:os','node:path','node:perf_hooks','node:readline','node:timers/promises','node:url','node:util','node:zlib']);
const dataPath=path=>path.endsWith('.json')||['scripts/marker-qualification/authority.mjs','workers/restream/broadcast-profiles.mjs','scripts/event-capacity-fixture-data.mjs','scripts/event-marker-program-contract.mjs','scripts/marker-qualification/construction-data.mjs','scripts/marker-qualification/detector-expectations.mjs'].includes(path);
export function compactImplementationCatalog(closure){const paths=closure.files.map(f=>f.path),audits=[],audit=r=>{let i=audits.findIndex(a=>JSON.stringify(a)===JSON.stringify(r));if(i<0){i=audits.length;audits.push(r);}return i;};return {schema:closure.schema,accounting:closure.accounting,encoding:'references-v1',paths,approvedBuiltins:closure.approvedBuiltins,roots:closure.roots.map(p=>paths.indexOf(p)),auditRefs:audits,files:closure.files.map(f=>[paths.indexOf(f.path),f.kind==='implementationCode'?0:1,f.bytes,f.sha256,audit(f.sourceAuditRef),f.loaded?1:0,f.imports.map(e=>[['static','dynamic','data'].indexOf(e.kind),e.target.startsWith('node:')?-(closure.approvedBuiltins.indexOf(e.target)+1):paths.indexOf(e.target)])])};}
export function expandImplementationCatalog(c){if(c?.encoding!=='references-v1')return c;must(Array.isArray(c.paths)&&new Set(c.paths).size===c.paths.length&&Array.isArray(c.auditRefs)&&Array.isArray(c.files)&&c.paths.length===c.files.length,'catalog_encoding');const path=i=>{must(Number.isSafeInteger(i)&&i>=0&&i<c.paths.length,'path_index');return c.paths[i];};return {schema:c.schema,accounting:c.accounting,roots:c.roots.map(path),approvedBuiltins:c.approvedBuiltins,files:c.files.map(f=>{must(Array.isArray(f)&&f.length===7&&[0,1].includes(f[1])&&[0,1].includes(f[5])&&c.auditRefs[f[4]]&&Array.isArray(f[6]),'catalog_row');return {path:path(f[0]),kind:f[1]===0?'implementationCode':'runtimeData',bytes:f[2],sha256:f[3],sourceAuditRef:c.auditRefs[f[4]],loaded:f[5]===1,imports:f[6].map(e=>{must(Array.isArray(e)&&e.length===2&&[0,1,2].includes(e[0])&&Number.isSafeInteger(e[1]),'edge');const target=e[1]<0?c.approvedBuiltins[-e[1]-1]:path(e[1]);must(typeof target==='string','edge');return {kind:['static','dynamic','data'][e[0]],target};})};})};}
// A finite lexical scanner for module dependency syntax. It does not execute
// source, infer data eligibility from extensions, or authorize arbitrary node:*.
function tokens(text){const out=[];let i=0;while(i<text.length){const c=text[i];if(/\s/.test(c)){i++;continue;}if(text.startsWith('//',i)){const n=text.indexOf('\n',i);i=n<0?text.length:n+1;continue;}if(text.startsWith('/*',i)){const n=text.indexOf('*/',i+2);must(n>=0,'comment');i=n+2;continue;}
 if(c==='/'&&['(', '=', ',', '?', ':', '[', '!', '|', '&', 'return'].includes(out.at(-1)?.value)){i++;let escaped=false,group=false;while(i<text.length){const x=text[i++];if(escaped)escaped=false;else if(x==='\\')escaped=true;else if(x==='[')group=true;else if(x===']')group=false;else if(x==='/'&&!group)break;}while(/[a-z]/i.test(text[i]??'')&&i<text.length)i++;out.push({kind:'regexp',value:''});continue;}
 if(c==='"'||c==="'"){let v='',escape=false;i++;while(i<text.length){const x=text[i++];if(escape){v+='\\'+x;escape=false;}else if(x==='\\')escape=true;else if(x===c)break;else v+=x;}out.push({kind:'string',value:v});continue;}if(c==='`'){const begin=i++;let escaped=false;while(i<text.length){const x=text[i++];if(escaped)escaped=false;else if(x==='\\')escaped=true;else if(x==='`')break;}must(!/\$\{[^}]*\bimport\s*\(/.test(text.slice(begin,i)),'template_import');out.push({kind:'template',value:''});continue;}if(/[A-Za-z_$]/.test(c)){let v=c;i++;while(i<text.length&&/[A-Za-z0-9_$]/.test(text[i]))v+=text[i++];out.push({kind:'word',value:v});continue;}out.push({kind:'punctuation',value:c});i++;}return out;}
export function implementationImports(path,bytes) {
 const ts=tokens(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),out=[];
 for(let i=0;i<ts.length;i++)must(!(ts[i].kind==='word'&&['eval','require','Function'].includes(ts[i].value)&&ts[i+1]?.value==='('),'code_generation');
 const add=(token,kind)=>{must(token?.kind==='string'&&!token.value.includes('\\'),'unresolved_import');let target=token.value;if(target.startsWith('.'))target=posix.normalize(posix.join(posix.dirname(path),target));else must(target.startsWith('node:'),'loader');must(target.startsWith('node:')||/^(scripts|workers)\//.test(target)&&!target.includes('/../'),'path');out.push({kind,target});};
 for(let i=0;i<ts.length;i++)if(ts[i].kind==='word'&&['import','export'].includes(ts[i].value)){
  if(ts[i+1]?.value==='.')continue;
  if(ts[i].value==='import'&&ts[i+1]?.value==='('){add(ts[i+2],'dynamic');must(ts[i+3]?.value===')','dynamic_import');continue;}
  if(ts[i].value==='import'&&ts[i+1]?.kind==='string'){add(ts[i+1],'static');continue;}
  if(ts[i].value==='export'&&!['{','*'].includes(ts[i+1]?.value))continue;
  for(let j=i+1;j<ts.length&&ts[j].value!==';';j++)if(ts[j].value==='from'){add(ts[j+1],'static');break;}
 }
 // Exact reviewed module-load data calls; this mixed module stays runtime data
 // if it is actually loaded by the selected roots. No JS export launders it.
 if(path==='scripts/marker-qualification/authority.mjs')for(const name of ['plan.json','association.json','literal-profile.json'])out.push({kind:'data',target:posix.join(posix.dirname(path),name)});
 return out;
}
export async function collectImplementationCatalog({roots,read,sourceAuditRef,approvedBuiltins}) {
 must(Array.isArray(roots)&&roots.length>0&&Array.isArray(approvedBuiltins),'catalog');const files=new Map(),queue=roots.map(path=>({path,loaded:true}));
 while(queue.length){const {path,loaded}=queue.shift(),prior=files.get(path);if(prior){if(loaded&&!prior.loaded){prior.loaded=true;for(const e of prior.imports)if(!e.target.startsWith('node:'))queue.push({path:e.target,loaded:e.kind!=='dynamic'});}continue;}
  must(files.size<256,'catalog_count');const bytes=Buffer.from(await read(path)),imports=path.endsWith('.json')?[]:implementationImports(path,bytes),mixed=path==='scripts/marker-qualification/authority.mjs'||path.endsWith('.json');
  const entry={kind:mixed||dataPath(path)?'runtimeData':'implementationCode',path,bytes:bytes.length,sha256:sha(bytes),sourceAuditRef,loaded,imports};files.set(path,entry);
  for(const e of imports)if(e.target.startsWith('node:'))must(approvedBuiltins.includes(e.target),'builtin');else queue.push({path:e.target,loaded:loaded&&e.kind!=='dynamic'});
 }
 for(const f of files.values())must(!f.loaded||f.bytes<=196608,'file_cap');return {schema:'native-verifier-closure-v2',accounting:'implementationCode-v1',roots,approvedBuiltins,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
export function verifyImplementationSource(entry,bytes,closure) {
 must(bytes.length===entry.bytes&&sha(bytes)===entry.sha256,'source_hash');
 must(JSON.stringify(entry.path.endsWith('.json')?[]:implementationImports(entry.path,bytes))===JSON.stringify(entry.imports),'imports');
 for(const edge of entry.imports)must(edge.target.startsWith('node:')?closure.approvedBuiltins.includes(edge.target):closure.files.some(f=>f.path===edge.target),'closure');
 if(entry.kind==='implementationCode'){
  const text=Buffer.from(bytes).toString().trim();must(!dataPath(entry.path)&&!/^(?:export\s+default\s+)?[\[{]/.test(text)&&!/^export\s+(?:const|let|var)\s+\w+\s*=\s*(?:[\[{]|["'])[^]*;?\s*$/.test(text),'data_disguised');
 }
}

export function validateImplementationCatalog(closure) {
 closure=expandImplementationCatalog(closure);
 must(closure.accounting==='implementationCode-v1'&&JSON.stringify(closure.approvedBuiltins)===JSON.stringify(PROGRAM_BUILTINS)&&JSON.stringify(closure.roots)===JSON.stringify(IMPLEMENTATION_ROOTS),'roots');
 const byPath=new Map(closure.files.map(f=>[f.path,f])),loaded=new Set(),queue=[...closure.roots];
 while(queue.length){const path=queue.shift();if(loaded.has(path))continue;const f=byPath.get(path);must(f,'closure');loaded.add(path);for(const edge of f.imports){must(['static','dynamic','data'].includes(edge.kind)&&typeof edge.target==='string','edge');if(edge.target.startsWith('node:'))must(closure.approvedBuiltins.includes(edge.target),'builtin');else{must(byPath.has(edge.target),'closure');if(edge.kind!=='dynamic')queue.push(edge.target);}}}
 for(const f of closure.files)must(f.loaded===loaded.has(f.path)&&['implementationCode','runtimeData'].includes(f.kind)&&(!dataPath(f.path)||f.kind==='runtimeData')&&f.sourceAuditRef?.kind==='audit','eligibility');return closure.files.filter(f=>f.loaded);
}
