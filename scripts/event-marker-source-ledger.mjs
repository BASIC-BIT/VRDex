import { createHash } from 'node:crypto';
import { replayRawMembers } from './event-marker-raw-capture.mjs';
import { massFrames } from './marker-qualification/codec-input.mjs';
import { inspectAcquiredDependencies } from './event-marker-native-binding.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>{throw Error('marker_source_'+reason);};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
/** Only the reviewed finite mass generator can enter the positive E slice.
 * JSON is snapshotted before construction; callbacks remain observation-only. */
export function snapshotProgramConstruction(value) {
 const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>196608)fail('parameters_bound');
 const parameters=freeze(JSON.parse(bytes));
 if(parameters?.kind!=='massFrames'||parameters.train?.sourceRate!==48000||!Number.isSafeInteger(parameters.train.frames)||parameters.train.frames<1||!Number.isSafeInteger(parameters.train.samples)||parameters.train.samples<=0||parameters.train.samples>1190400||parameters.train.frames!==Math.ceil(parameters.train.samples/1600)||!Array.isArray(parameters.train.slots)||parameters.train.slots.length>64)fail('parameters');
 for(const [i,s] of parameters.train.slots.entries())if(s.index!==i||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<0||s.end<=s.start||s.end>parameters.train.samples||!Number.isSafeInteger(s.visualFrame)||s.visualFrame<0||!['a','b',undefined].includes(s.params?.source)||i&&s.start<parameters.train.slots[i-1].end)fail('parameters');
 return {bytes,sha256:sha(bytes),parameters,frames:()=>massFrames(parameters.train)};
}
export function verifyProgramConstruction({parameters,pcm,source,feeds,binding,deadline=Number.MAX_VALUE,clock=()=>0}) {
 const dependencies=inspectAcquiredDependencies(binding);if(!dependencies)fail('generator_closure');
 const frozen=snapshotProgramConstruction(JSON.parse(Buffer.from(parameters).toString('utf8')));
 if(!Buffer.from(parameters).equals(frozen.bytes)||dependencies.plans.generator!=='massFrames'||source.parametersSHA256!==frozen.sha256||pcm.length!==frozen.parameters.train.samples*4||pcm.length!==source.audio.bytes||sha(pcm)!==source.audio.sha256)fail('immutable_input');
 const replay=prepareRegenerableSource({construct:frozen.frames,replay:frozen.frames,frameBytes:854*480*3/2,byteCap:frozen.parameters.train.frames*854*480*3/2,numericCap:196608,deadline,clock});
 if(JSON.stringify(replay.construction)!==JSON.stringify(source.video))fail('construction');
 const traces=Object.fromEntries(['video','audio'].map(k=>[k,JSON.parse('['+replayRawMembers(feeds[k].trace,{producerCap:196608}).toString().trimEnd().split('\n').join(',')+']')]));
 // Rehash submitted byte ranges independently, including writes crossing frame
 // boundaries. A successful-feed digest supplied by the producer is insufficient.
 function checkWrites(chunks,trace) {
  const iterator=chunks[Symbol.iterator]();let chunk=Buffer.alloc(0),offset=0,at=0,index=0,total=0;const whole=createHash('sha256');
  while(trace[at]?.event==='write') {const w=trace[at++],cb=trace[at++];if(w.index!==index++||cb?.event!=='callback'||cb.index!==w.index||cb.ok!==true||!Number.isSafeInteger(w.bytes)||w.bytes<=0)fail('feed_trace');let left=w.bytes;const h=createHash('sha256');
   while(left){if(offset===chunk.length){const n=iterator.next();if(n.done)fail('feed_extent');chunk=n.value;offset=0;}const length=Math.min(left,chunk.length-offset),part=chunk.subarray(offset,offset+length);h.update(part);whole.update(part);offset+=length;left-=length;total+=length;}
   if(h.digest('hex')!==w.sha256)fail('feed_write_hash');
  }
  if(offset!==chunk.length||!iterator.next().done||trace[at]?.event!=='end'||trace[at++].writes!==index||trace[at++]?.event!=='finish'||at!==trace.length)fail('feed_extent');return {bytes:total,sha256:whole.digest('hex')};
 }
 for(const [kind,chunks] of [['video',replay.replayFrames()],['audio',[Buffer.from(pcm)]]]){const observed=checkWrites(chunks,traces[kind]),feed=feeds[kind];if(!feed.complete||!feed.writeFinish||feed.error||observed.bytes!==feed.actualFedByteCount||observed.sha256!==feed.actualFedSHA256)fail('feed');}
 joinRegeneratedFeed(replay,feeds.video);
 return freeze({frames:replay.construction.frameCount,samples:pcm.length/4,parametersSHA256:frozen.sha256,videoSHA256:replay.construction.fullBytesSHA256,pcmSHA256:sha(pcm),generatorAuditRef:dependencies.plans.generatorAuditRef});
}
/** R81 construction precedes feed. Replay has its own hashes/exhaustion; these
 * observations need authenticated generator/input refs before they can form
 * finiteRegenerableRaw. No recipe SHA or digest concatenation stands for YUV. */
export function prepareRegenerableSource({construct,replay,frameBytes,byteCap,numericCap,deadline,clock}) {
 if(typeof construct!=='function'||typeof replay!=='function'||typeof clock!=='function'||![frameBytes,byteCap,numericCap].every(Number.isSafeInteger)||frameBytes<=0||byteCap<frameBytes||numericCap<=0||!Number.isFinite(deadline))fail('bounds');
 const checkTime=()=>{if(clock()>=deadline)fail('deadline');};
 const frames=[],hash=createHash('sha256');let byteCount=0,numericBytes=128,replayed=false,replayObservation;
 checkTime();
 for(const raw of construct()) {
  checkTime();if(!(raw instanceof Uint8Array)||raw.length!==frameBytes||byteCount+raw.length>byteCap)fail('unit');
  const bytes=Buffer.from(raw),row={ordinal:frames.length,byteOffset:byteCount,bytes:bytes.length,sha256:sha(bytes)};
  numericBytes+=Buffer.byteLength(JSON.stringify(row))+1;if(numericBytes>numericCap)fail('numeric_bound');
  frames.push(row);hash.update(bytes);byteCount+=bytes.length;
 }
 checkTime();if(!frames.length)fail('empty');
 const construction=freeze({frameCount:frames.length,byteCount,fullBytesSHA256:hash.digest('hex'),exhausted:true,frames});
 if(Buffer.byteLength(JSON.stringify(construction))>numericCap)fail('numeric_bound');
 function* replayFrames() {
  if(replayed)fail('replay_reused');replayed=true;const digest=createHash('sha256');let ordinal=0,count=0;
  for(const raw of replay()) {
   checkTime();if(!(raw instanceof Uint8Array)||ordinal>=frames.length||raw.length!==frameBytes)fail('replay_unit');
   const bytes=Buffer.from(raw);if(sha(bytes)!==frames[ordinal].sha256)fail('replay_hash');digest.update(bytes);count+=bytes.length;ordinal++;yield bytes;
  }
  checkTime();const fullBytesSHA256=digest.digest('hex');if(ordinal!==frames.length||count!==byteCount||fullBytesSHA256!==construction.fullBytesSHA256)fail('replay_extent');
  replayObservation=freeze({frameCount:ordinal,byteCount:count,fullBytesSHA256,exhausted:true});
 }
 return Object.freeze({construction,replayFrames,get replay(){return replayObservation;}});
}
/** Rebuild successful write/finish facts from their complete original trace,
 * then resolve every submitted byte range against original construction.
 * This is source/feed equality only, never native consumer EOF or drain. */
export function joinRegeneratedFeed(source,feed) {
 const construction=source.construction,replay=source.replay;
 if(!replay||!feed.complete||!feed.writeFinish||feed.error||feed.actualFedByteCount!==construction.byteCount||feed.actualFedSHA256!==construction.fullBytesSHA256||replay.fullBytesSHA256!==construction.fullBytesSHA256)fail('feed');
 const raw=replayRawMembers(feed.trace,{producerCap:196608});if(raw.at(-1)!==10)fail('trace');
 let lines;try{lines=raw.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));}catch{fail('trace');}
 const ranges=[];let cursor=0,index=0,at=0,frameIndex=0;
 while(lines[at]?.event==='write') {
  const write=lines[at++],callback=lines[at++];
  if(write.index!==index||!Number.isSafeInteger(write.bytes)||write.bytes<=0||!/^[0-9a-f]{64}$/.test(write.sha256)||callback?.event!=='callback'||callback.index!==index||callback.ok!==true)fail('trace');
  const end=cursor+write.bytes;if(!Number.isSafeInteger(end)||end>construction.byteCount)fail('feed_range');
  const frames=[];let position=cursor;
  while(position<end) {
   const frame=construction.frames[frameIndex];if(!frame)fail('feed_range');
   const begin=Math.max(cursor,frame.byteOffset),right=Math.min(end,frame.byteOffset+frame.bytes);
   if(begin!==position||right<=begin)fail('feed_range');frames.push({ordinal:frame.ordinal,inFrameByte:begin-frame.byteOffset,bytes:right-begin});position=right;
   if(position===frame.byteOffset+frame.bytes)frameIndex++;
  }
  if(position!==end)fail('feed_range');ranges.push({writeIndex:index,byteOffset:cursor,bytes:write.bytes,sha256:write.sha256,frames});cursor=end;index++;
 }
 if(lines[at]?.event!=='end'||lines[at++].writes!==index||lines[at++]?.event!=='finish'||at!==lines.length||cursor!==construction.byteCount||feed.writeCallbacks!==index)fail('trace');
 return freeze({frameCount:construction.frameCount,byteCount:construction.byteCount,fullBytesSHA256:construction.fullBytesSHA256,sourceRangeMap:ranges,traceSHA256:feed.trace.originalSHA256});
}
