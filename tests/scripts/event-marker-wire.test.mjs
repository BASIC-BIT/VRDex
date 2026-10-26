import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_WIRE_LAYOUTS } from '../../scripts/event-marker-wire-layout.mjs';
import { packMarkerLeaf, unpackMarkerLeaf, packMarkerContext, unpackMarkerContext, packMarkerEnvelope, inspectMarkerEnvelope } from '../../scripts/event-marker-wire.mjs';
const zeros=kind=>Object.fromEntries(MARKER_WIRE_LAYOUTS[kind].fields.map(([name,type,count])=>[name,count===1?(type==='sha256'?'0'.repeat(64):0):Array(count).fill(type==='sha256'?'0'.repeat(64):0)]));
test('wire-v2 leaves preserve fixed byte layouts and exact finite f64',()=>{
 for(const [kind,layout] of Object.entries(MARKER_WIRE_LAYOUTS)) {
  const values=zeros(kind),packed=packMarkerLeaf(kind,values);
  assert.equal(Buffer.from(packed,'base64').length,layout.bytes);assert.deepEqual(unpackMarkerLeaf(kind,packed),values);
 }
 const e=zeros('episode');e['a.score']=.08283515699729625;e['b.score']=Number.MIN_VALUE;e['a.guardOpening']=-480;
 assert.deepEqual(unpackMarkerLeaf('episode',packMarkerLeaf('episode',e)),e);
 assert.equal(JSON.stringify(packMarkerLeaf('episode',e)).length+1,251);
});
test('wire-v2 rejects trailing bytes noncanonical base64 overflow and omitted numeric data',()=>{
 const e=zeros('episode'),packed=packMarkerLeaf('episode',e);
 for(const bad of [packed+'\n',packed+'=',Buffer.concat([Buffer.from(packed,'base64'),Buffer.of(0)]).toString('base64')])assert.throws(()=>unpackMarkerLeaf('episode',bad),/marker_wire/);
 for(const value of [NaN,Infinity,null,undefined])assert.throws(()=>packMarkerLeaf('episode',{...e,'a.score':value}),/marker_wire/);
 assert.throws(()=>packMarkerLeaf('episode',{...e,'a.maxAt':65536}),/marker_wire/);
 assert.throws(()=>packMarkerLeaf('episode',{...e,extra:1}),/marker_wire/);
 const raw=Buffer.from(packed,'base64');raw.writeDoubleLE(Infinity,75);assert.throws(()=>unpackMarkerLeaf('episode',raw.toString('base64')),/marker_wire/);
});
test('wire-v2 rejects sparse fixed vectors rather than inventing zero values',()=>{
 for(const [kind,layout] of Object.entries(MARKER_WIRE_LAYOUTS))for(const [name,,count] of layout.fields)if(count>1) {
  const values=zeros(kind);values[name]=Array(count);
  assert.throws(()=>packMarkerLeaf(kind,values),/marker_wire/,`${kind}/${name}`);
  values[name]=zeros(kind)[name];delete values[name][count-1];
  assert.throws(()=>packMarkerLeaf(kind,values),/marker_wire/,`${kind}/${name}/last`);
 }
 const explicit=zeros('header');assert.deepEqual(unpackMarkerLeaf('header',packMarkerLeaf('header',explicit)),explicit);
});
test('wire-v2 context retains full pair/disposition vectors inside exact bound',()=>{
 const header=zeros('contextHeader'),pairs=Array.from({length:48},()=>zeros('contextPair')),dispositions=Array.from({length:25},()=>zeros('contextDisposition'));
 header.pairDispositionCounts=[48,25];
 const packed=packMarkerContext(header,pairs,dispositions);assert.equal(Buffer.from(packed,'base64').length,765);assert.equal(JSON.stringify(packed).length+1,1023);
 assert.deepEqual(unpackMarkerContext(packed),{header,pairs,dispositions});
 assert.throws(()=>packMarkerContext(header,pairs,dispositions.slice(1)),/marker_wire/);
});
test('wire-v2 envelope keeps all per-role counts header reserve and total byte caps',()=>{
 const h=zeros('header');h.versionModeFpsReserved=[2,0,30,0];
 const record=[packMarkerLeaf('header',h),[packMarkerLeaf('episode',zeros('episode'))],[],[],[],[]];
 const envelope=packMarkerEnvelope([record]);assert.equal(envelope[0],2);assert(Object.isFrozen(envelope[1][0][1]));
 assert.equal(inspectMarkerEnvelope(envelope).references,0);
 const tooMany=structuredClone(envelope);tooMany[1][0][1]=Array(4097).fill(record[1][0]);assert.throws(()=>inspectMarkerEnvelope(tooMany),/marker_episode_bound/);
 const reserved=structuredClone(h);reserved.versionModeFpsReserved[3]=1;assert.throws(()=>packMarkerEnvelope([[packMarkerLeaf('header',reserved),[],[],[],[],[]]]),/marker_wire_header/);
 const wrongQuantum=structuredClone(h);wrongQuantum.versionModeFpsReserved[1]=1;assert.throws(()=>packMarkerEnvelope([[packMarkerLeaf('header',wrongQuantum),[],[],[],[],[]]]),/marker_wire_header/);
 assert.throws(()=>packMarkerEnvelope(Array(16).fill(record)),/marker_evidence_bound/);
 const tooLarge=structuredClone(record);tooLarge[1]=Array(2200).fill(record[1][0]);assert.throws(()=>packMarkerEnvelope([tooLarge]),/marker_evidence_bound/);
});
