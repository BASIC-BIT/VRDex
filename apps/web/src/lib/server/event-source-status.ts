import 'server-only';
import { createSourceStatusReader } from '../event-source-observations';
import { eventDjTarget } from '../event-dj-target';
import { parseVrcdnStreamLinks } from '../../../../../convex/_vrcdnLinks';
import { getVrcdnLiveObservation } from './vrcdn-live';
import { getTwitchLiveObservation } from './twitch-live';

export const getEventSourceStatuses = createSourceStatusReader(async source=>{
 const target=eventDjTarget(source.url);
 if(!target || target.key!==source.key) throw Error('Invalid public source');
 const stream=parseVrcdnStreamLinks(target.url);
 if(stream && !stream.directVideoUrl) return getVrcdnLiveObservation(stream.streamId);
 if(target.key.startsWith('twitch:')) {
  const result=await getTwitchLiveObservation([{url:target.url,type:'twitch',source:'owner_authored'}]);
  if(result) return {state:result.state.status,observedAt:result.observedAt};
 }
 return {state:'unavailable',observedAt:Date.now()};
});
