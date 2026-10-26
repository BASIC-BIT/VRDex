import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourceAudio } from '../../scripts/event-source-markers.mjs';
import { packAudioEpisode,packMarkerLeaf,unpackMarkerLeaf } from '../../scripts/event-marker-wire.mjs';
import { replayAudioWire } from '../../scripts/marker-qualification/audio-wire-reference.mjs';
import { literalPcm } from '../../scripts/marker-qualification/signals.mjs';
test('independent packed audio replay checks every endpoint fit guard and local tuple',()=>{
 const x=literalPcm({family:'foreign_literal',source:'a',placement:'prefix',durationMs:1,phase:1,foreignPhase:5},{onset:928}),record=decodeSourceAudio([x.pcm],x.rows),leaves=record.episodes.map(packAudioEpisode);
 assert.deepEqual(replayAudioWire(leaves,x.pcm,x.rows).episodes,record.episodes);
 for(const [key,value] of [['firstLoudLeft.raw',961],['firstLoudLeft.ordinal',961],['prelude.kind',2],['prelude.count',479],['prelude.owner',0],['a.guardResidual',.1],['a.guardCode',0],['class',1],['local.windows',0]]) {
  const altered=unpackMarkerLeaf('episode',leaves[0]);altered[key]=value;
  assert.throws(()=>replayAudioWire([packMarkerLeaf('episode',altered)],x.pcm,x.rows),/reference_wire_value/);
 }
 assert.throws(()=>replayAudioWire([...leaves,...leaves],x.pcm,x.rows),/reference_wire_count/);
});
test('packed audio uses canonical tag-defined zero for G0 invalid and absent values',()=>{
 const x=literalPcm({family:'pure',source:'a',loudSamples:480},{onset:0}),record=decodeSourceAudio([x.pcm],x.rows),leaves=record.episodes.map(packAudioEpisode);
 assert.deepEqual(replayAudioWire(leaves,x.pcm,x.rows).episodes,record.episodes);
 const altered=unpackMarkerLeaf('episode',leaves[0]);altered['a.guardOpening']=1;
 assert.throws(()=>replayAudioWire([packMarkerLeaf('episode',altered)],x.pcm,x.rows),/reference_wire_value/);
});
