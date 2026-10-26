const must=(v,r)=>{if(!v)throw Error('marker_policy_'+r);};
export const LEGACY_POLICY=Object.freeze({id:'legacy-native-evidence-v1',normal:196608,final:262144,reserve:65536});
export const NATIVE_POLICY=Object.freeze({id:'r83-native-evidence-v1',normal:1572864,final:1638400,reserve:65536});
export function invocationAggregate(kind){const cap={mass:16777216,literal:16777216,association:33554432,profile:33554432,'compressed-source':67108864}[kind];must(cap,'invocation_kind');return cap;}
/** Selection is a property of acquired, authenticated dependencies and the
 * reviewed producing workload. The store passes its own invocation identity. */
export function deriveEvidencePolicy(deps,invocation){
 const selected=[deps?.profile?.evidencePolicy,deps?.plans?.evidencePolicy,deps?.intent?.execution?.policy];
 if(selected.every(v=>v===undefined||v===LEGACY_POLICY.id))return LEGACY_POLICY;
 must(deps?.profile?.assuranceBasis==='trustedStackMeasurement'&&selected.every(v=>v===NATIVE_POLICY.id),'selection');
 const e=validateExecution(deps.intent.execution);must(e.invocation.id===invocation.id&&e.invocation.kind===invocation.kind,'owned_invocation');
 validateExecutionCommand(e,deps.intent.workload.originalCommand);return NATIVE_POLICY;
}
export function validateExecution(e){
 must(e?.schema==='native-execution-v1'&&['program','native132'].includes(e.domain)&&[LEGACY_POLICY.id,NATIVE_POLICY.id].includes(e.policy)&&typeof e.invocation?.id==='string'&&/^[a-z0-9][a-z0-9-]{0,100}$/.test(e.invocation.id),'execution');
 invocationAggregate(e.invocation.kind);
 must(e.domain==='program'?e.producer==='root-program-v1'&&e.retrieval==='root-originals-v1'&&e.invocation.kind==='mass':e.producer==='ci-native132-v1'&&e.retrieval==='engine-binding-v1'&&e.invocation.id==='prelude'&&e.invocation.kind==='mass','scope');return e;
}
export function validateExecutionCommand(e,command){
 validateExecution(e);must(Array.isArray(command)&&command.every(v=>typeof v==='string'),'command');
 if(e.domain==='program')must(command.length===4&&command[0]==='node'&&command[1]==='scripts/event-marker-program-collector.mjs'&&command[2]==='--run-id'&&/^task6-[a-z0-9-]{1,74}$/.test(command[3]),'command');
 else must(command.length===6&&command[0]==='--signal=TERM'&&command[1]==='--kill-after=1s'&&command[2]==='360s'&&command[3]==='sh'&&command[4]==='-c'&&command[5]===NATIVE132_COMMAND,'command');
}
export const NATIVE132_COMMAND='node --version >&2 && python3 --version >&2 && ffmpeg -version >&2 || exit 1\n'+'node scripts/event-twitch-input-proof.mjs --case all --output-dir /tmp/event-capacity-ci-native\n'+'result=$?\ncat /tmp/event-capacity-ci-native/receipt.json\nexit "$result"';
