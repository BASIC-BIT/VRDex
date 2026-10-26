import { unpackMarkerLeaf } from '../event-marker-wire.mjs';
import { replayAudioClassification } from './partition-reference.mjs';
/** Independent semantic replay reads every original PCM sample and metadata
 * row. The structural wire reader is shared; the producer/classifier is not. */
export function replayAudioWire(leaves,pcm,rows) {
 if(!Array.isArray(leaves)||leaves.length>4096)throw Error('reference_wire_count');
 const reference=replayAudioClassification(pcm,rows);
 if(leaves.length!==reference.episodes.length)throw Error('reference_wire_count');
 const classes={unknown:0,a:1,b:2,mixed:3},reasons={none:0,insufficient_samples:1,invalid_metadata_or_fit:2,single_carrier_inconsistent:3,simultaneous_energy:4,simultaneous_local_energy:5},preludes={FileOrigin:0,UnclaimedQuiet:1,PriorClosure:2};
 for(const [index,leaf] of leaves.entries()) {
  const actual=unpackMarkerLeaf('episode',leaf),e=reference.episodes[index],expected={};
  for(const role of ['firstLoudLeft','lastLoudRight','closureRight'])for(const field of ['ordinal','row','inRow','raw'])expected[`${role}.${field}`]=e[role][field];
  expected.class=classes[e.identity];expected.reason=reasons[e.reason];expected['prelude.kind']=preludes[e.prelude.kind];
  for(const field of ['row','offset','count','owner'])expected[`prelude.${field}`]=e.prelude[field];
  for(const [i,name] of ['a','b'].entries()) {
   const f=e.fits[i],guard=f.guard;
   Object.assign(expected,{[`${name}.score`]:f.score,[`${name}.opening`]:f.openingGate??0,[`${name}.closing`]:f.closingGate??0,[`${name}.residual`]:f.maxResidual??0,[`${name}.maxAt`]:f.maxResidualAt??0,[`${name}.code`]:f.code,[`${name}.guardCode`]:guard.code,[`${name}.guardOpening`]:guard.openingGate??0,[`${name}.guardResidual`]:guard.maxResidual??0,[`${name}.guardMaxAt`]:guard.maxResidualAt??0});
  }
  for(const field of ['windows','hits','firstPair'])expected[`local.${field}`]=e.local[field];expected['local.amplitudes']=e.local.amplitudes.map(n=>n??0);
  for(const key of Object.keys(expected)) {
   const left=Array.isArray(expected[key])?expected[key]:[expected[key]],right=Array.isArray(actual[key])?actual[key]:[actual[key]];
   if(left.length!==right.length||left.some((n,i)=>!Object.is(n,right[i])))throw Error('reference_wire_value');
  }
 }
 return reference;
}
