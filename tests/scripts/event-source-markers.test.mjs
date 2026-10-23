import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSourceAudio, MARKER_SCHEMA } from '../../scripts/event-source-markers.mjs';

// Pure PCM fixtures only. This file must never import process/media helpers.
function fixture({ frequency=700, phase=0, start=480, length=4800, rowsize=1024, alter }={}) {
  const count=start+length+960, pcm=Buffer.alloc(count*2), rows=[];
  for(let i=0;i<count;i++) {
    let v=i>=start&&i<start+length ? .65*Math.sin(2*Math.PI*frequency*(i-start)/48000+phase):0;
    if(alter) v=alter(i-start,v);
    pcm.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32768))),i*2);
  }
  for(let i=0;i<count;i+=rowsize) rows.push({index:rows.length,pts:480000+i,samples:Math.min(rowsize,count-i)});
  return {pcm,rows};
}
function decode(f,chunks=[f.pcm]) { return decodeSourceAudio(chunks,f.rows); }
for(const [frequency,identity] of [[700,'a'],[1300,'b']]) test(`source markers identify ${identity} without a selection input`,()=>{
  const f=fixture({frequency,phase:Math.PI/4}), result=decode(f);
  assert.equal(result.schema,MARKER_SCHEMA);
  assert.equal(result.episodes.length,1);
  assert.equal(result.episodes[0].identity,identity);
  assert.equal(result.episodes[0].onset,480480);
  assert.equal(result.metadataSamples*2,result.decodedBytes);
  assert(result.scratchBytes<=65536);
});
test('source markers preserve metadata-block onsets and byte partition',()=>{
  const f=fixture({start:1025,phase:1}), whole=decode(f);
  const chunks=[];for(let i=0;i<f.pcm.length;i+=3) chunks.push(f.pcm.subarray(i,i+3));
  assert.deepEqual(decode(f,chunks),whole);
  assert.equal(whole.episodes[0].onset,481024);
});
test('source markers reject the quarter-mixture interior without noise',()=>{
  const f=fixture({frequency:1300,rowsize:480,alter:(i,v)=>v+(i>=1440&&i<2880?.1625*Math.sin(2*Math.PI*700*i/48000):0)});
  const e=decode(f).episodes[0];assert.equal(e.identity,'mixed');assert.equal(e.reason,'simultaneous_local_energy');
  assert.equal(e.onset,480480);assert(e.local.firstPair>=0);assert(e.local.hits>=2);
});
test('source markers cannot relabel a foreign prefix by later dominance',()=>{
  const f=fixture({frequency:1300,rowsize:480,alter:(i,v)=>i>=0&&i<480?.65*Math.sin(2*Math.PI*700*i/48000):v});
  const e=decode(f).episodes[0];assert.equal(e.identity,'unknown');assert.equal(e.onset,480480);
  assert(e.fits.some(f=>f.maxResidual>.14));
});
test('source markers keep legacy 1000Hz unknown',()=>assert.equal(decode(fixture({frequency:1000})).episodes[0].identity,'unknown'));
test('source markers reject discontinuous metadata, incomplete PCM and unmatched loud EOF',()=>{
  const f=fixture(), gap=structuredClone(f.rows);gap[1].pts++;
  assert.throws(()=>decodeSourceAudio([f.pcm],gap),/marker_audio_continuity/);
  assert.throws(()=>decodeSourceAudio([f.pcm.subarray(1)],f.rows),/marker_pcm_length/);
  const loud=fixture({start:0,rowsize:480}), end=4800;
  assert.throws(()=>decodeSourceAudio([loud.pcm.subarray(0,end*2)],[{index:0,pts:0,samples:end}]),/marker_unmatched_eof/);
});
test('source markers enforce episode sample bounds without truncation',()=>{
  assert.throws(()=>decode(fixture({length:12480,rowsize:480})),/marker_episode_bound/);
});
test('source markers reject exactly 30ms mixtures at interior and boundary alignments',()=>{
  for(const frequency of [700,1300]) for(const at of [0,1,1439,1440,1441,3359,3360]) for(const phase of [0,Math.PI/4]) {
    const other=frequency===700?1300:700;
    const f=fixture({frequency,phase,rowsize:480,alter:(i,v)=>v+(i>=at&&i<at+1440?.1625*Math.sin(2*Math.PI*other*i/48000+Math.PI/2):0)});
    const e=decode(f).episodes[0];assert.equal(e.identity,'mixed',`${frequency}/${at}/${phase}`);assert.equal(e.reason,'simultaneous_local_energy');
    assert.equal(e.onset,480480);assert.equal(e.local.windows,Math.floor((e.end-e.onset)/480));
  }
});
test('source markers preserve pure phases and partial metadata edges',()=>{
  for(const frequency of [700,1300]) for(let phase=0;phase<8;phase++) for(const start of [481,527,719]) {
    const e=decode(fixture({frequency,phase:phase*Math.PI/4,start})).episodes[0];
    assert.equal(e.identity,frequency===700?'a':'b');assert(e.fits[frequency===700?0:1].maxResidual<=.14);
  }
});
test('source markers reject a one millisecond foreign prefix and suffix',()=>{
  for(const frequency of [700,1300]) for(let phase=0;phase<8;phase++) for(const at of [0,4752]) {
    const other=frequency===700?1300:700;
    const e=decode(fixture({frequency,rowsize:480,alter:(i,v)=>i>=at&&i<at+48?.65*Math.sin(2*Math.PI*other*i/48000+phase*Math.PI/4):v})).episodes[0];
    assert(!['a','b'].includes(e.identity),`${frequency}/${phase}/${at}`);
  }
});
