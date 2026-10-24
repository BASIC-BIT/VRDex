import test from 'node:test';
import assert from 'node:assert/strict';
import { markerFailureDetails } from '../../scripts/event-capacity-contracts.mjs';
test('capacity failure facts preserve only fixed marker reasons and no arbitrary error text',()=>{
 assert.deepEqual(markerFailureDetails(Error('marker_context_failure:missing_audio,foreign_interval')),{code:'marker_context_failure',reasons:['foreign_interval','missing_audio']});
 assert.deepEqual(markerFailureDetails(Error('marker_audio_continuity')),{code:'marker_audio_continuity',reasons:[]});
 for(const text of ['marker_unknown_secret','marker_context_failure:https://private.invalid/token','marker_context_failure:missing_audio,missing_audio','raw provider text'])assert.equal(markerFailureDetails(Error(text)),undefined);
});
