import test from 'node:test';
import assert from 'node:assert/strict';
import {localTwitchArguments} from '../../scripts/marker-qualification/codec-io.mjs';
import {outputArguments} from '../../workers/restream/output-sender.mjs';
import {resolveDestinationProfile} from '../../workers/restream/broadcast-profiles.mjs';
test('qualification local Twitch transform removes only two network pairs and reverses exactly',()=>{
 for(const videoPreset of ['480p30','480p60','720p30','720p60','1080p30','1080p60'])for(const audioBitrateKbps of [160,320]){
  const settings={videoPreset,audioBitrateKbps},original=outputArguments('twitch',{url:'rtmp://example.invalid/app',key:'synthetic_qualification'},resolveDestinationProfile({settings,destination:'twitch'})),actual=localTwitchArguments(settings);
  const restored=[...actual.args];restored[restored.length-1]=original.at(-1);for(const [index,key,value] of actual.removed)restored.splice(index,0,key,value);
  assert.deepEqual(restored,original);assert.equal(actual.args.at(-1),'pipe:1');assert.equal(actual.args[actual.args.indexOf('-f')+1],'mpegts');assert.equal(actual.args[actual.args.lastIndexOf('-f')+1],'flv');assert(!actual.args.includes('-rw_timeout'));assert(!actual.args.includes('-rtmp_playpath'));
 }
});
