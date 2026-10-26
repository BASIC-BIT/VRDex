import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkerMetadata} from '../../scripts/event-marker-metadata.mjs';
test('metadata protocol retains original integers and rejects discarded rows and long lines',()=>{
 const audio='frame:0 pts:48000 pts_time:1\nlavfi.astats.Overall.Number_of_samples=1024.000000\n';
 assert.deepEqual(parseMarkerMetadata(audio,'audio'),[{index:0,pts:48000,samples:1024}]);
 for(const text of [audio+'partial',audio.replace('1024.000000','1024.5'),audio.replace('pts:48000','pts:NaN'),audio.replace('pts_time:1','pts_time:'+ '0'.repeat(4096))])assert.throws(()=>parseMarkerMetadata(text,'audio'),/marker_metadata/);
});
