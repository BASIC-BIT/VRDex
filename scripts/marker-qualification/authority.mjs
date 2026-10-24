import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
export const plan=load('plan.json'),associationPlan=load('association.json'),literalProfilePlan=load('literal-profile.json');
// Code-unit ordering matches Python's sorted ASCII keys used by the frozen plan.
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
export const wire=value=>JSON.stringify(sorted(value));
export function binding(rows) {
 const ids=createHash('sha256'),contracts=createHash('sha256');
 for(const r of rows){ids.update(r.id+'\n');contracts.update(wire([r.id,r.contract])+'\n');}
 return {count:rows.length,idsSha256:ids.digest('hex'),expectedContractsSha256:contracts.digest('hex')};
}
const token=v=>Array.isArray(v)?'['+v.map(token).join(';')+']':typeof v==='string'?v:JSON.stringify(v);
const ident=(prefix,values)=>prefix+'/'+values.map(token).join(',');
function* product(axes,prefix=[]) {if(!axes.length){yield prefix;return;}for(const v of axes[0])yield* product(axes.slice(1),[...prefix,v]);}
const resolveSources=(v,first,selected)=>Array.isArray(v)?v.map(x=>resolveSources(x,first,selected)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolveSources(x,first,selected)])):v==='first_source'?first:v==='selected_source'?selected:v;
export function enumerateQualification() {
 const rows=[],invocations=[],buckets=new Map();
 const append=(id,contract,params)=>{const row={id,contract,params};rows.push(row);return row;};
 for(const f of plan.families) {
  const keys=Object.keys(f.axes),axes=Object.values(f.axes).map(v=>typeof v==='string'?plan.dimensions[v]:v);
  for(const combo of product(axes)) {
   const params=Object.fromEntries(keys.map((k,i)=>[k,combo[i]])),contract={...f.resultContract};
   if(contract.source==='axis.source')contract.source=params.source;
   const row=append(ident(f.id,combo),contract,params),physical=ident(f.id,keys.filter(k=>k!=='path').map(k=>params[k]));
   const kind=f.id==='resample44100mono'?'44100mono':'48000stereo',key=params.kbps+':'+kind;
   if(!buckets.has(key))buckets.set(key,new Map());const bucket=buckets.get(key);
   if(!bucket.has(physical))bucket.set(physical,[]);bucket.get(physical).push(row);
  }
 }
 for(const [key,bucket] of [...buckets].sort(([a],[b])=>a<b?-1:a>b?1:0)) {
  const [kbps,kind]=key.split(':'),items=[...bucket];
  for(let start=0;start<items.length;start+=64) {
   const selected=items.slice(start,start+64),missing=selected.filter(([k])=>k.startsWith('missing/')).length;
   invocations.push({id:`mass-${kbps}-${kind}-${String(start/64).padStart(3,'0')}`,kind:'mass',rows:selected.flatMap(([,rs])=>rs),physicalCount:selected.length,sourceSamples:96000+(selected.length-missing)*14400+missing*57600});
  }
 }
 const physical=[];
 for(const scene of associationPlan.scenes)for(const [order,seed,kbps] of product(['sourceOrder','seed','kbps'].map(k=>associationPlan.dimensions[k]))) {
  const pair=[];
  for(const path of associationPlan.dimensions.path) {
   const values=[order,seed,kbps,path],source=scene.id==='same_source_cut_resume'?order[0]:order.at(-1);
   pair.push(append(ident('assoc/'+scene.id,values),resolveSources(scene.resultContract,order[0],source),{sourceOrder:order,seed,kbps,path}));
  }
  physical.push(pair);
 }
 for(let start=0;start<physical.length;start+=4)invocations.push({id:`assoc-${String(start/4).padStart(3,'0')}`,kind:'association',rows:physical.slice(start,start+4).flat()});
 const profile=literalProfilePlan.profileBridge;let ix=0;
 for(const [quality,source,kbps] of product([profile.profiles,profile.source,profile.kbps])) {
  const rs=profile.path.map(path=>append(ident('profile',[quality,source,kbps,path]),{stage:'association',outcome:'paired_source',source,allExpectedFullPairsRequired:true,maxAbsOffsetNumerator:72000,profileAndQualityRequired:true},{profile:quality,source,kbps,path}));
  invocations.push({id:`profile-${String(ix++).padStart(3,'0')}`,kind:'profile',rows:rs});
 }
 for(const source of literalProfilePlan.compressedSourceBridge.sourceIds) {
  const rs=[...product([[160,320],['program','program_twitch']])].map(([kbps,path])=>append(ident('compressed',[source,kbps,path]),{stage:'association',outcome:'paired_source',source,allExpectedFullPairsRequired:true,maxAbsOffsetNumerator:72000,sourceBaselineRequired:true},{source,kbps,path}));
  invocations.push({id:'compressed-'+source,kind:'compressed-source',rows:rs});
 }
 const literal=[];
 for(const f of literalProfilePlan.literalCases) {
  const combos=f.axes?product(Object.values(f.axes).map(v=>v==='integers0..479'?Array.from({length:480},(_,i)=>i):v)):f.names.map(n=>[n]);
  for(const combo of combos) {
   const contract={stage:'literal_contract',outcome:'contract_holds',requirements:f.expected};
   if(f.id==='metadata_short_tail')contract.caseContract=f.caseContracts[`${combo[0]},${combo[1]}`];
   literal.push(append(ident('literal/'+f.id,combo),contract,{family:f.id,values:combo}));
  }
 }
 for(let start=0;start<literal.length;start+=2048)invocations.push({id:`literal-${String(start/2048).padStart(3,'0')}`,kind:'literal',rows:literal.slice(start,start+2048)});
 const canary=plan.canary.trainIds,groups=[{id:'canary-000',invocations:[...canary]}];
 for(const [kind,limit] of [['mass',4],['association',3],['profile',3],['compressed-source',1],['literal',4]]) {
  const ids=invocations.filter(v=>v.kind===kind&&!canary.includes(v.id)).map(v=>v.id);
  for(let start=0;start<ids.length;start+=limit)groups.push({id:`${kind}-${String(start/limit).padStart(3,'0')}`,invocations:ids.slice(start,start+limit)});
 }
 if(rows.length!==79996||new Set(rows.map(r=>r.id)).size!==79996||groups.length!==83)throw Error('qualification_authority');
 return {rows,invocations,groups};
}
