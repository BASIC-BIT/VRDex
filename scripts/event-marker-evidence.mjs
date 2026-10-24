import { MARKER_SCHEMA } from './event-source-markers.mjs';
import { IDENTITY_CODES, validateIdentityEpochs } from './event-marker-record.mjs';
import { associateContext } from './event-marker-association.mjs';
const CLASS={unknown:0,a:1,b:2,mixed:3};
const REASON={none:0,insufficient_samples:1,invalid_metadata_or_fit:2,single_carrier_inconsistent:3,simultaneous_energy:4,simultaneous_local_energy:5};
const DISPOSITION={paired_full:0,previous_epoch_tail:1,existing_carry_in_fragment:2,existing_steady_edge_fragment:3,recorded_pre_epoch_exclusion:4,failure:5};
const inverse=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[v,k]));
const CLASS_NAME=inverse(CLASS),IDENTITY_NAME=inverse(IDENTITY_CODES);
const safe=n=>{if(!Number.isSafeInteger(n))throw Error('marker_integer');return n;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bytes=value=>Buffer.byteLength(JSON.stringify(value,(_key,v)=>{
  if(typeof v==='number'&&!Number.isFinite(v))throw Error('marker_nonfinite');
  if(v===undefined)throw Error('marker_missing_field');
  return v;
}));

/** Size checks are separate from semantic admission; no diagnostics are rounded. */
export function assertMarkerEvidenceSize(records) {
  if(!Array.isArray(records))throw Error('marker_evidence_bound');
  let epochRows=0,references=0;
  for(const record of records) {
    for(const [field,count,wire,reason] of [
      ['episodes',4096,256,'episode'],['visuals',4096,48,'visual'],
      ['watermarks',64,96,'watermark'],['contexts',16,1024,'context'],
    ]) {
      const rows=record[field];
      if(!Array.isArray(rows)||rows.length>count)throw Error(`marker_${reason}_bound`);
      for(const row of rows)if(bytes(row)+1>wire)throw Error(`marker_${reason}_wire_bound`);
    }
    if(!Array.isArray(record.identityEpochs)||record.identityEpochs.length>32)throw Error('marker_identity_bound');
    epochRows+=record.identityEpochs.length;
    for(const row of record.contexts) {
      if(!Array.isArray(row[5])||!Array.isArray(row[6]))throw Error('marker_context_wire');
      references+=row[5].length+row[6].length;
    }
  }
  if(references>8192)throw Error('marker_reference_bound');
  const header={schema:MARKER_SCHEMA,records:records.map(({episodes,visuals,contexts,...header})=>header)};
  const headersWithReserve=bytes(header)+1024;
  const total=bytes({schema:MARKER_SCHEMA,records})+1024;
  if(headersWithReserve>8192||total>524288)throw Error('marker_evidence_bound');
  return {bytes:total,headersWithReserve,epochRows,references,reservedFailureBytes:1024};
}

function contextTuple(context) {
  return [context.kind==='transition'?0:1,CLASS[context.identity],context.selection,context.start,context.end,
    context.pairs.map(p=>[p.visualId,p.videoPts,p.episodeId,p.offsetNumerator]),
    context.dispositions.map(d=>[d.episodeId,DISPOSITION[d.code],d.visualId]),
    context.carryIn?[[context.carryIn.visualId,context.carryIn.episodeId]]:[]];
}
function summaryRanges(episodes) {
  return [0,1].map(i=>{
    const min=[null,null,null,null],max=[null,null,null,null];let invalidFits=0;
    for(const e of episodes) {
      const f=e.fits[i];if(f.code!==0){invalidFits++;continue;}
      [...f.coefficients,f.condition].forEach((n,k)=>{if(!Number.isFinite(n))throw Error('marker_nonfinite');min[k]=min[k]===null?n:Math.min(min[k],n);max[k]=max[k]===null?n:Math.max(max[k],n);});
    }
    return {min,max,invalidFits};
  });
}
/** Build fresh immutable wire rows; source observations are never changed. */
export function packMarkerRecord(record) {
  if(record.schema!==MARKER_SCHEMA)throw Error('marker_schema');
  const used=new Set(record.contexts.flatMap(c=>c.dispositions.map(d=>d.episodeId)));
  const classCounts=[0,0,0,0];
  const episodes=record.episodes.map((e,i)=>{
    if(e.id!==i)throw Error('marker_episode_reference');
    classCounts[CLASS[e.identity]]++;
    return [e.onset,e.end-e.onset,e.loudEnd,e.firstMetadataIndex,e.metadataRowCount,CLASS[e.identity],REASON[e.reason],e.fits[0].score,e.fits[1].score,
      ...e.fits.map(f=>[f.openingGate,f.closingGate,f.maxResidual,f.maxResidualAt,f.code]),
      [e.local.windows,e.local.hits,e.local.firstPair,...e.local.amplitudes]];
  });
  const contexts=record.contexts.map(contextTuple);
  const result={schema:MARKER_SCHEMA,recordingSha256:record.recordingSha256,audioStreamIndex:record.audioStreamIndex,videoStreamIndex:record.videoStreamIndex,
    metadataSamples:record.metadataSamples,decodedBytes:record.decodedBytes,detectorBlockCount:record.detectorBlockCount,
    audioRange:[...record.audioRange],videoRange:[...record.videoRange],videoFrames:record.videoFrames,
    residualWindowCounts:[...record.residualWindowCounts],localWindowCount:record.localWindowCount,
    coefficientAndConditionRanges:summaryRanges(record.episodes),classCounts,contextCounts:[contexts.length,contexts.reduce((n,c)=>n+c[5].length+c[6].length,0)],outsideRequiredContexts:record.episodes.length-used.size,
    episodes,contexts,visuals:record.visuals.map(v=>[v.id,v.start,v.end,IDENTITY_CODES[v.identity],v.watermark]),
    watermarks:record.watermarks.map(w=>[w.selectionTick,w.selectionVideoPts,w.selectionSourcePts,w.firstPulseTick,w.firstPulseSourcePts,w.carryIn,IDENTITY_CODES[w.identity]]),
    identityEpochs:record.identityEpochs.map(row=>[...row]),visualCount:record.visuals.length,watermarkCount:record.watermarks.length};
  assertMarkerEvidenceSize([result]);
  // Freeze every newly allocated row. JSON consumers receive their own copy.
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
  return freeze(result);
}

/** Recompute source classification predicates and complete context partitions.
 * Artifact SHA provenance still requires independent original-file verification. */
export function validateMarkerRecord(record) {
  if(record?.schema!==MARKER_SCHEMA)throw Error('marker_schema');
  assertMarkerEvidenceSize([record]);
  if(!/^[a-f0-9]{64}$/.test(record.recordingSha256)||!Number.isSafeInteger(record.audioStreamIndex)||record.audioStreamIndex<0||!Number.isSafeInteger(record.videoStreamIndex)||record.videoStreamIndex<0)throw Error('marker_recording_binding');
  for(const key of ['metadataSamples','decodedBytes','detectorBlockCount','videoFrames','localWindowCount'])if(!Number.isSafeInteger(record[key])||record[key]<0)throw Error('marker_count');
  if(record.metadataSamples<=0||record.videoFrames<2||safe(record.metadataSamples*2)!==record.decodedBytes||record.detectorBlockCount<Math.ceil(record.metadataSamples/480)||record.detectorBlockCount>record.metadataSamples)throw Error('marker_audio_conservation');
  if(!Array.isArray(record.audioRange)||record.audioRange.length!==2||!record.audioRange.every(Number.isSafeInteger)||record.audioRange[1]-record.audioRange[0]!==record.metadataSamples)throw Error('marker_audio_range');
  const classCounts=[0,0,0,0],residual=[0,0];let localTotal=0,previousEnd;
  const episodes=record.episodes.map((r,id)=>{
    if(!Array.isArray(r)||r.length!==12)throw Error('marker_episode_tuple');
    r.slice(0,7).forEach(safe);
    const [onset,length,loud,firstRow,rowCount,cls,reason,scoreA,scoreB,a,b,local]=r;
    if(length<=0||length>12000||loud<=0||loud>=length||firstRow<0||rowCount<=0||!(cls in CLASS_NAME)||reason<0||reason>5||onset<record.audioRange[0]||safe(onset+length)>record.audioRange[1]||(previousEnd!==undefined&&onset<previousEnd)||![scoreA,scoreB].every(n=>Number.isFinite(n)&&n>=0))throw Error('marker_episode_range');
    previousEnd=onset+length;
    for(const [i,f] of [a,b].entries()) {
      if(!Array.isArray(f)||f.length!==5||![0,1,2].includes(f[4]))throw Error('marker_fit_tuple');
      if(f[4]===0) {
        [f[0],f[1],f[3]].forEach(safe);
        if(f[0]<0||f[1]<f[0]||f[1]>length||!Number.isFinite(f[2])||f[2]<0||f[3]<0||f[3]+48>length)throw Error('marker_fit_range');
        residual[i]+=Math.max(0,length-47);
      } else if(f.slice(0,4).some(n=>n!==null))throw Error('marker_failed_fit');
    }
    if(!Array.isArray(local)||local.length!==7)throw Error('marker_local_tuple');
    local.slice(0,3).forEach(safe);
    if(local[0]!==Math.floor(length/480)||local[1]<0||local[1]>local[0])throw Error('marker_local_conservation');
    localTotal+=local[0];
    if(local[2]===-1) {if(local.slice(3).some(n=>n!==null))throw Error('marker_local_pair');}
    else {
      if(local[2]<0||local[2]%480||local[2]+960>length||local[1]<2)throw Error('marker_local_pair');
      for(let j=3;j<7;j+=2) {const major=Math.max(local[j],local[j+1]),minor=Math.min(local[j],local[j+1]);if(![local[j],local[j+1]].every(Number.isFinite)||major<.4||minor<.1||minor/major<.2)throw Error('marker_local_pair');}
    }
    if(cls===1||cls===2) {
      const own=cls===1?a:b,score=cls===1?scoreA:scoreB,other=cls===1?scoreB:scoreA;
      if(reason!==0||loud<1440||own[4]!==0||own[2]>.14||score<.6||other>=.05||local[2]!==-1)throw Error('marker_source_classification');
    } else if(reason===0||(cls===3&&!(reason===4&&scoreA>=.05&&scoreB>=.05||reason===5&&local[2]>=0)))throw Error('marker_rejected_classification');
    classCounts[cls]++;return {id,onset,end:onset+length,identity:CLASS_NAME[cls]};
  });
  if(!same(classCounts,record.classCounts)||!same(residual,record.residualWindowCounts)||residual.some(n=>n>12000000)||localTotal!==record.localWindowCount||localTotal>1200000)throw Error('marker_record_conservation');
  if(!Array.isArray(record.coefficientAndConditionRanges)||record.coefficientAndConditionRanges.length!==2)throw Error('marker_fit_summary');
  record.coefficientAndConditionRanges.forEach((summary,i)=>{
    const invalid=record.episodes.filter(e=>e[9+i][4]!==0).length;
    if(!summary||!same(Object.keys(summary).sort(),['invalidFits','max','min'])||summary.invalidFits!==invalid||!Array.isArray(summary.min)||!Array.isArray(summary.max)||summary.min.length!==4||summary.max.length!==4)throw Error('marker_fit_summary');
    if(invalid===episodes.length) {
      if([...summary.min,...summary.max].some(n=>n!==null))throw Error('marker_fit_summary');
    } else {
      for(let j=0;j<4;j++)if(!Number.isFinite(summary.min[j])||!Number.isFinite(summary.max[j])||summary.min[j]>summary.max[j])throw Error('marker_fit_summary');
      if(summary.min[3]<=0||summary.max[3]>100)throw Error('marker_fit_summary');
    }
  });
  const visuals=record.visuals.map((r,i)=>{
    if(!Array.isArray(r)||r.length!==5)throw Error('marker_visual_reference');r.forEach(safe);
    if(r[0]!==i||!(r[3] in IDENTITY_NAME)||r[2]<=r[1]||(i>0&&r[1]<record.visuals[i-1][2]))throw Error('marker_visual_reference');
    return {id:r[0],start:r[1],end:r[2],identity:IDENTITY_NAME[r[3]],watermark:r[4]};
  });
  const watermarks=record.watermarks.map(r=>{
    if(!Array.isArray(r)||r.length!==7||![1,2].includes(r[6])||typeof r[5]!=='boolean')throw Error('marker_watermark');r.slice(0,5).forEach(safe);
    return {selectionTick:r[0],selectionVideoPts:r[1],selectionSourcePts:r[2],firstPulseTick:r[3],firstPulseSourcePts:r[4],carryIn:r[5],identity:IDENTITY_NAME[r[6]]};
  });
  if(visuals.length!==record.visualCount||watermarks.length!==record.watermarkCount)throw Error('marker_visual_conservation');
  const raw={visuals,episodes,watermarks,audioRange:record.audioRange,videoRange:record.videoRange,identityEpochs:record.identityEpochs};validateIdentityEpochs(raw);
  const used=new Set();let transitionCount=0,steadyCount=0,references=0;
  const contexts=record.contexts.map(r=>{
    if(!Array.isArray(r)||r.length!==8||![0,1].includes(r[0])||![1,2].includes(r[1]))throw Error('marker_context_tuple');r.slice(0,5).forEach(safe);
    const kind=r[0]===0?'transition':'steady',identity=CLASS_NAME[r[1]],start=r[3],end=r[4];
    if(kind==='transition')transitionCount++;else steadyCount++;
    if(end-start!==(kind==='transition'?360000:540000)||!Array.isArray(r[7])||r[7].length>1)throw Error('marker_context_window');
    const carryVisualId=r[7].length?r[7][0][0]:undefined;
    const full=visuals.filter(v=>v.identity===identity&&(kind==='transition'?v.start>=start&&v.start<end:v.start>start+18000&&v.start<end-18000)&&v.id!==carryVisualId);
    if(full.length<(kind==='transition'?3:Math.floor(6-.4)))throw Error('marker_full_completeness');
    const actual=associateContext(raw,{kind,identity,selection:r[2],start,end,fullVisualIds:full.map(v=>v.id),carryVisualId});
    if(!actual.valid||!same(contextTuple(actual),r))throw Error('marker_context_partition');
    actual.dispositions.forEach(d=>used.add(d.episodeId));references+=actual.pairs.length+actual.dispositions.length;return actual;
  });
  if(transitionCount>8||steadyCount>8||!contexts.length||!same([contexts.length,references],record.contextCounts)||episodes.length-used.size!==record.outsideRequiredContexts)throw Error('marker_context_conservation');
  return {valid:true,contexts,episodes,visuals,watermarks,identityEpochs:record.identityEpochs};
}
