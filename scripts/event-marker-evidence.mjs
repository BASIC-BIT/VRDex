import { MARKER_SCHEMA } from './event-source-markers.mjs';
import { IDENTITY_CODES, validateIdentityEpochs } from './event-marker-record.mjs';
import { associateContext } from './event-marker-association.mjs';
import { MARKER_WIRE_SCHEMA, packAudioEpisode, unpackAudioEpisode } from './event-marker-wire.mjs';
const CLASS={unknown:0,a:1,b:2,mixed:3};
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
    return packAudioEpisode(e);
  });
  const contexts=record.contexts.map(contextTuple);
  const result={schema:MARKER_SCHEMA,episodeEncoding:MARKER_WIRE_SCHEMA,recordingSha256:record.recordingSha256,audioStreamIndex:record.audioStreamIndex,videoStreamIndex:record.videoStreamIndex,
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
  if(record?.schema!==MARKER_SCHEMA||record.episodeEncoding!==MARKER_WIRE_SCHEMA)throw Error('marker_schema');
  assertMarkerEvidenceSize([record]);
  if(!/^[a-f0-9]{64}$/.test(record.recordingSha256)||!Number.isSafeInteger(record.audioStreamIndex)||record.audioStreamIndex<0||!Number.isSafeInteger(record.videoStreamIndex)||record.videoStreamIndex<0)throw Error('marker_recording_binding');
  for(const key of ['metadataSamples','decodedBytes','detectorBlockCount','videoFrames','localWindowCount'])if(!Number.isSafeInteger(record[key])||record[key]<0)throw Error('marker_count');
  if(record.metadataSamples<=0||record.videoFrames<2||safe(record.metadataSamples*2)!==record.decodedBytes||record.detectorBlockCount<Math.ceil(record.metadataSamples/480)||record.detectorBlockCount>record.metadataSamples)throw Error('marker_audio_conservation');
  if(!Array.isArray(record.audioRange)||record.audioRange.length!==2||!record.audioRange.every(Number.isSafeInteger)||record.audioRange[1]-record.audioRange[0]!==record.metadataSamples)throw Error('marker_audio_range');
  const classCounts=[0,0,0,0],residual=[0,0];let localTotal=0,previous;
  const episodes=record.episodes.map((leaf,id)=>{
    let e;try{e=unpackAudioEpisode(leaf);}catch{throw Error('marker_episode_tuple');}
    const {firstLoudLeft:first,lastLoudRight:last,closureRight:end,prelude:p,local,fits}=e;
    const length=safe(end.ordinal-first.ordinal),loud=e.loudEnd,cls=CLASS[e.identity];
    if(length<=0||length>12000||loud<=0||loud>=length||end.ordinal-last.ordinal>480||first.inRow%480||first.row>last.row||last.row>end.row||first.ordinal<0||end.ordinal>record.metadataSamples||previous&&first.ordinal<previous.closureRight.ordinal)throw Error('marker_episode_range');
    for(const point of [first,last,end])if(point.raw!==safe(record.audioRange[0]+point.ordinal)||point.row>=record.detectorBlockCount||point.inRow>point.ordinal||point.inRow>record.metadataSamples)throw Error('marker_episode_range');
    for(const [left,right] of [[first,last],[last,end]])if(left.row===right.row?right.inRow-left.inRow!==right.ordinal-left.ordinal:right.row-left.row>right.ordinal-left.ordinal||right.inRow>right.ordinal-left.ordinal)throw Error('marker_episode_range');
    if(p.kind==='FileOrigin'){
      if(id!==0||first.ordinal!==0||first.row!==0||first.inRow!==0||p.row!==0||p.offset!==0||p.count!==0||p.owner!==-1)throw Error('marker_prelude');
    }else{
      if(p.count<1||p.count>480||p.offset%480||p.count>first.ordinal||!(p.row===first.row&&p.offset+p.count===first.inRow||p.row+1===first.row&&first.inRow===0))throw Error('marker_prelude');
      if(p.kind==='PriorClosure'){
        if(!previous||p.owner!==id-1||first.ordinal!==previous.closureRight.ordinal||p.row!==previous.closureRight.row||p.offset+p.count!==previous.closureRight.inRow||p.count!==previous.closureRight.ordinal-previous.lastLoudRight.ordinal)throw Error('marker_prelude');
      }else if(p.kind!=='UnclaimedQuiet'||p.owner!==-1||previous&&first.ordinal-p.count<previous.closureRight.ordinal)throw Error('marker_prelude');
    }
    for(const [i,f] of fits.entries()) {
      if(!Number.isFinite(f.score)||f.score<0)throw Error('marker_fit_range');
      if(f.code===0) {
        if(f.openingGate<0||f.closingGate<f.openingGate||f.closingGate>length||f.maxResidual<0||f.maxResidualAt<0||f.maxResidualAt+48>length)throw Error('marker_fit_range');
        residual[i]+=Math.max(0,length-47);
      }
      const guardCode=p.kind==='UnclaimedQuiet'?(f.code===0?2:1):0,g=f.guard;
      if(g.code!==guardCode)throw Error('marker_fit_guard');
      if(guardCode===2){
        if(g.openingGate< -p.count||g.openingGate>Math.min(480,loud)||g.maxResidual<0||g.maxResidualAt< -p.count||g.maxResidualAt+48>length)throw Error('marker_fit_guard');
        residual[i]+=Math.max(0,length+p.count-47);
      }
    }
    if(local.windows!==Math.floor(length/480)||local.hits<0||local.hits>local.windows)throw Error('marker_local_conservation');
    localTotal+=local.windows;
    if(local.firstPair!==-1) {
      if(local.firstPair<0||local.firstPair%480||local.firstPair+960>length||local.hits<2)throw Error('marker_local_pair');
      for(let j=0;j<4;j+=2) {const major=Math.max(local.amplitudes[j],local.amplitudes[j+1]),minor=Math.min(local.amplitudes[j],local.amplitudes[j+1]);if(major<.4||minor<.1||minor/major<.2)throw Error('marker_local_pair');}
    }
    let identity='unknown',reason='single_carrier_inconsistent';
    if(loud<1440)reason='insufficient_samples';
    else if(local.firstPair>=0){identity='mixed';reason='simultaneous_local_energy';}
    else if(fits.every(f=>f.score>=.05)){identity='mixed';reason='simultaneous_energy';}
    else{
      const eligible=fits.map((f,i)=>f.code===0&&f.maxResidual<=.14&&f.score>=.6&&fits[1-i].score<.05);
      if(eligible.filter(Boolean).length===1){identity=eligible[0]?'a':'b';reason='none';}
      else if(fits.some(f=>f.code!==0))reason='invalid_metadata_or_fit';
    }
    if((identity==='a'||identity==='b')&&fits[identity==='a'?0:1].guard.maxResidual>.14){identity='unknown';reason='single_carrier_inconsistent';}
    if(e.identity!==identity||e.reason!==reason)throw Error(cls===1||cls===2?'marker_source_classification':'marker_rejected_classification');
    classCounts[cls]++;previous=e;return {id,...e};
  });
  if(!same(classCounts,record.classCounts)||!same(residual,record.residualWindowCounts)||residual.some(n=>n>12000000)||localTotal!==record.localWindowCount||localTotal>1200000)throw Error('marker_record_conservation');
  if(!Array.isArray(record.coefficientAndConditionRanges)||record.coefficientAndConditionRanges.length!==2)throw Error('marker_fit_summary');
  record.coefficientAndConditionRanges.forEach((summary,i)=>{
    const invalid=episodes.filter(e=>e.fits[i].code!==0).length;
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
