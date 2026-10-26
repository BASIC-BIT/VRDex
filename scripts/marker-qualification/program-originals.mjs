import { validateExecutionCommand } from '../event-marker-evidence-policy.mjs';
const must=(v,r)=>{if(!v)throw Error('marker_replay_'+r);};
/** Trusted producing-channel inventory for this finite PROGRAM entrypoint.
 * This is not a role supplied by the record. Every accepted name is generated
 * by one reviewed channel, with its independent retained-file ceiling. */
export function programOriginalRole(name,prefix){
 must(typeof name==='string'&&name.startsWith(prefix),'original_channel');let suffix=name.slice(prefix.length),decode=false;if(suffix.startsWith('-decode-')){decode=true;suffix=suffix.slice(7);}
 if(!decode){if(suffix==='.ts')return ['coded',5242880];if(suffix==='-input.pcm')return ['pcm',5242880];if(suffix==='-parameters.json')return ['sourceObservation',196608];if(['-source-construction.json.gz','-source-replay.json.gz'].includes(suffix))return ['sourceObservation',196608];if(suffix==='-inventory.json.gz')return ['packet',196608];if(/^-(?:video|audio)-feed(?:-facts.json)?\.gz$/.test(suffix))return ['feed',196608];if(/^-(?:video|audio)-feed-catalog.json.gz$/.test(suffix))return ['catalog',196608];if(/^-noise-(42|43)\.pcm$/.test(suffix))return ['pcm',2380800];if(/^-noise-(42|43)-owner.json$/.test(suffix))return ['native',196608];if(/^-(?:prebinding(?:-\d+\.bin|\.json)|request-use\.json|metadata-[01](?:-owner)?\.json)$/.test(suffix))return ['runtimeBinding',196608];}
 if(suffix==='-argv.json.gz')return ['argv',196608];if(/^-binding(?:-\d+\.bin|\.json)$/.test(suffix))return ['runtimeBinding',196608];if(suffix==='-runtime.json')return ['runtimeBinding',196608];if(/^\-maps-(startup|terminal).gz$/.test(suffix))return ['procMaps',196608];if(suffix==='-native.json.gz')return ['native',196608];
 if(suffix==='-stderr.gz')return ['stderr',196608];if(suffix==='-progress.gz')return ['progressVideo',196608];if(/^-(stderr|progress)-catalog.json.gz$/.test(suffix))return ['catalog',196608];
 if(decode){if(suffix==='-pcm.raw')return ['pcm',2572800];if(suffix==='-rgb.raw')return ['rgb',9443];if(suffix==='-conservation.json.gz')return ['observation',196608];if(/^-(format|packets|final)-owner.json$/.test(suffix))return ['native',196608];if(/^-(probe|packets|final-probe|audiometadata|videometadata)-catalog.json.gz$/.test(suffix))return ['catalog',196608];const channel={'-probe.gz':'probe','-final-probe.gz':'probe','-packets.gz':'packet','-audiometadata.gz':'audioMetadata','-videometadata.gz':'videoMetadata'}[suffix];if(channel)return [channel,196608];}
 throw Error('marker_replay_original_channel');
}
export function checkProgramOriginalRoles(refs,recordKey,invocation){must(invocation?.kind==='mass'&&recordKey===invocation.id+'-program','invocation_domain');for(const ref of refs){const [role,cap]=programOriginalRole(ref.name,recordKey);must(ref.role===role&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=cap,'original_role_or_cap:'+ref.name+':'+ref.role+':'+role);}}

/** The authenticated producer selects the graph, never an optional original.
 * This public entrypoint always acquires both noise streams and ECS metadata.
 * Smaller E/D component fixtures do not define an accepted Root inventory. */
export function requireProgramFrontdoor(refs,prefix,invocation,deps,binding){
 const {execution,workload,imageFacts}=deps.intent;validateExecutionCommand(execution,workload.originalCommand);
 must(execution.domain==='program'&&execution.producer==='root-program-v1'&&execution.retrieval==='root-originals-v1'&&execution.invocation.id===invocation.id&&invocation.id==='mass-320-48000stereo-073'&&imageFacts.kind==='ecrManifestConfig','frontdoor_scope');
 const names=new Set(refs.map(r=>r.name)),required=['-prebinding.json','-request-use.json',...binding.artifacts.map((_,i)=>'-prebinding-'+i+'.bin'),...['42','43'].flatMap(seed=>['-noise-'+seed+'.pcm','-noise-'+seed+'-owner.json']),...[0,1].flatMap(i=>['-metadata-'+i+'.json','-metadata-'+i+'-owner.json'])];
 for(const suffix of required)must(names.has(prefix+suffix),'frontdoor_required:'+prefix+suffix);
}
