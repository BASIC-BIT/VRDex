import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { compileScene } from './scenes.mjs';
import { constructScenePcm,prepareScene } from './playout.mjs';
import { sourceBaseline,stereoMono } from './codec-input.mjs';
import { referenceDetector } from './detector-reference.mjs';
import { generateNoise,encodeProgram,encodeTwitch } from './codec-io.mjs';
import { readQualificationRecording,applyDecodeStageFailure } from './codec-record.mjs';
import { observeSceneContexts,matchSceneContract } from './scene-policy.mjs';
import { observeGlobalScene,applySceneFault,matchGlobalSceneContract } from './scene-faults.mjs';
import { prerequisiteStates,incompletePrerequisite } from './results.mjs';
const defaults={generateNoise,encodeProgram,encodeTwitch,readRecording:readQualificationRecording};
const sha=b=>createHash('sha256').update(b).digest('hex');
const incomplete=(rows,first,prerequisites,reason)=>rows.map((_,n)=>({index:first+n,status:'incomplete',reason,prerequisites:{...prerequisites}}));
/** Four independent 13-second scenes. Never concatenate encoded PTS epochs.
 * All semantic matching is deferred until the group owner has physically closed. */
export async function executeAssociation(invocation,{owner,store,io=defaults,clock=()=>performance.now()}) {
 const results=[],startBytes=store.total;let numericBytes=0,stopped=false;
 for(let first=0;first<invocation.rows.length;first+=2) {
  const rows=invocation.rows.slice(first,first+2),prerequisites=prerequisiteStates('not_run'),began=clock();let stage='source_constructed',expired=false;
  if(stopped){results.push(...incomplete(rows,first,prerequisites,'unrun'));continue;}
  const timer=setTimeout(()=>{expired=true;void owner.close().catch(()=>{});},20000);timer.unref?.();
  const pending=[];
  try {
   const params=rows[0].params,name=rows[0].id.split('/')[1],scene=compileScene(name,params.sourceOrder.split('_to_'));
   const prefix=`${invocation.id}-scene-${first/2}`,settings={videoPreset:'480p30',audioBitrateKbps:params.kbps};
   const noise=await io.generateNoise(owner,48000,scene.samples),pcm=constructScenePcm(scene,noise[params.seed]),submitted=prepareScene(scene,pcm);
   prerequisites.source_constructed='pass';stage='source_baseline_complete';
   const source=sourceBaseline(pcm,48000,2),sourceRows=[];
   for(let at=0;at<scene.samples;at+=1024)sourceRows.push({index:sourceRows.length,pts:at,samples:Math.min(1024,scene.samples-at)});
   const reference=referenceDetector(stereoMono(pcm),sourceRows);
   await store.write(`${prefix}-source.pcm`,pcm,3145728,'pcm');prerequisites.source_baseline_complete='pass';stage='encode_complete';
   const programName=`${prefix}-program.ts`,program=await io.encodeProgram(owner,{settings,frameFactory:()=>submitted.replayFrames(),frameCount:scene.frames,pcm:submitted.pcm,store,path:store.path(programName),maxBytes:Math.min(3145728,store.remainingBytes??3145728),timeoutMs:20000});
   const twitchName=`${prefix}-twitch.flv`,twitch=await io.encodeTwitch(owner,{settings,program:program.bytes,path:store.path(twitchName),maxBytes:Math.min(3145728,store.remainingBytes??3145728),timeoutMs:20000});await store.adopt(twitchName,3145728,'coded');
   prerequisites.encode_complete='pass';
   const observations=[];
   for(const [offset,path,file,builder] of [[0,'program',programName,program],[1,'program_twitch',twitchName,twitch]]) {
    stage='probe_complete';
    const decoded=await io.readRecording(owner,store.path(file),{settings,path,frames:scene.frames,samples:scene.samples,producerEvidence:builder.producerEvidence,store,allowEpisodeBound:rows[offset].contract.outcome==='episode_bound'});
    for(const key of ['probe_complete','declared_format_valid','decode_complete','intended_coverage_complete'])prerequisites[key]='pass';
    stage='artifact_sha_bound';const artifact=store.entries.find(e=>e.name===file);
    // A classifier-bound negative still has the independently hashed original
    // recording; the classifier's incomplete record cannot supply a fake hash.
    if(!decoded.classificationFailure&&decoded.record.recordingSha256!==artifact.sha256)throw Error('sha_mismatch');
    const input={scene,submitted,record:decoded.record,videoRows:decoded.observation.videoRows,reference:decoded.observation.reference,classificationFailure:decoded.classificationFailure};
    let observation=decoded.classificationFailure?observeGlobalScene(input):observeSceneContexts(input);
    if(scene.postDecode.length)observation=applySceneFault(rows[offset].contract,observation,decoded.material);
    observations.push({path,artifact,builderSha256:builder.builderSha256,localBuilderSha256:builder.localBuilderSha256,format:decoded.format,coverage:decoded.coverage,observation});
    prerequisites.artifact_sha_bound='pass';
    const contract=rows[offset].contract,global=contract.contexts.first_transition.status==='blocked';
    pending.push({index:first+offset,kind:'association',prerequisites:{...prerequisites},evaluate:states=>incompletePrerequisite(states)??(global?matchGlobalSceneContract(contract,observation):matchSceneContract(contract,observation))});
   }
   const bytes=Buffer.from(JSON.stringify({source,reference,sourceRows,submittedPcmSha256:sha(submitted.pcm),submitted:{frames:submitted.frames,sourceFrames:submitted.sourceFrames,selections:submitted.selections},observations})+'\n');
   if(bytes.length>8388608)throw Error('byte_cap');
   const compressed=gzipSync(bytes,{level:6});numericBytes+=compressed.length;
   if(numericBytes>262144||store.total-startBytes+compressed.length>33554432)throw Error('byte_cap');
   const artifact=await store.write(`${prefix}-observation.json.gz`,compressed,262144,'observation');for(const result of pending)result.observation=artifact;
   if(expired||clock()-began>=20000)throw Error('timeout');
   results.push(...pending);
  }catch(error) {
   stage=applyDecodeStageFailure(prerequisites,error,stage);const timeout=expired||clock()-began>=20000;
   const reason=timeout?'timeout':error.message==='invocation_byte_cap'?'byte_cap':['byte_cap','sha_mismatch','source_failure','encode_failure','probe_failure','format_failure','decode_failure','coverage_failure'].includes(error.message)?error.message:stage==='source_constructed'||stage==='source_baseline_complete'?'source_failure':stage==='encode_complete'?'encode_failure':'decode_failure';
   results.push(...incomplete(rows,first,prerequisites,reason));stopped ||= timeout;
  }finally{clearTimeout(timer);}
 }
 return results;
}
