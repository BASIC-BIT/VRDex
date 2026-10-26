import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { prepareRegenerableSource, joinRegeneratedFeed } from '../../scripts/event-marker-source-ledger.mjs';
import { captureNativeFeed } from '../../scripts/event-marker-native-capture.mjs';
import { createRawCapture } from '../../scripts/event-marker-raw-capture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const options=(construct,replay=construct)=>({construct,replay,frameBytes:4,byteCap:12,numericCap:8192,deadline:100,clock:()=>0});
test('regenerable source hashes original construction before independent replay and joins feed chunks across frame boundaries',async()=>{
 const original=[Buffer.from('abcd'),Buffer.from('efgh'),Buffer.from('ijkl')],events=[];
 const source=prepareRegenerableSource(options(function*(){events.push('construct');yield* original;},function*(){events.push('replay');yield* original.map(b=>Buffer.from(b));}));
 assert.deepEqual(events,['construct']);assert.equal(source.construction.fullBytesSHA256,sha(Buffer.concat(original)));assert.equal(source.construction.byteCount,12);assert.equal(source.construction.frameCount,3);
 assert.notEqual(source.construction.fullBytesSHA256,sha(Buffer.from(source.construction.frames.map(f=>f.sha256).join(''))));
 const replay=[...source.replayFrames()],bytes=Buffer.concat(replay),chunks=[bytes.subarray(0,3),bytes.subarray(3,9),bytes.subarray(9)],trace=createRawCapture({producerCap:8192,remainingBytes:8192}),sink=new Writable({write(b,e,cb){cb();}});
 const feed=await captureNativeFeed(sink,chunks,{byteCap:12,trace}),joined=joinRegeneratedFeed(source,feed);
 assert.deepEqual(events,['construct','replay']);assert.equal(joined.fullBytesSHA256,sha(bytes));assert.deepEqual(joined.sourceRangeMap.map(r=>r.frames.map(f=>[f.ordinal,f.inFrameByte,f.bytes])),[[[0,0,3]],[[0,3,1],[1,0,4],[2,0,1]],[[2,1,3]]]);assert(Object.isFrozen(joined.sourceRangeMap[1].frames));
});
test('regenerable source rejects wrong units incomplete replay reorder mutation and mismatched successful feed',async()=>{
 const data=[Buffer.from('abcd'),Buffer.from('efgh'),Buffer.from('ijkl')];
 assert.throws(()=>prepareRegenerableSource(options(()=>[Buffer.from('bad')])),/marker_source_/);
 for(const changed of [()=>data.slice(0,2),()=>[data[1],data[0],data[2]],()=>[Buffer.from('Abcd'),...data.slice(1)]]){const source=prepareRegenerableSource(options(()=>data,changed));assert.throws(()=>[...source.replayFrames()],/marker_source_/);}
 const source=prepareRegenerableSource(options(()=>data));[...source.replayFrames()];
 const feed=await captureNativeFeed(new Writable({write(b,e,cb){cb();}}),[Buffer.from('xxxxxxxxxxxx')],{byteCap:12,trace:createRawCapture({producerCap:8192,remainingBytes:8192})});assert.throws(()=>joinRegeneratedFeed(source,feed),/marker_source_/);
 const unfinished=prepareRegenerableSource(options(()=>data));assert.throws(()=>joinRegeneratedFeed(unfinished,feed),/marker_source_/);
 assert.throws(()=>prepareRegenerableSource({...options(()=>data),numericCap:1}),/marker_source_/);
 assert.throws(()=>prepareRegenerableSource({...options(()=>data),clock:()=>100}),/marker_source_/);
});
