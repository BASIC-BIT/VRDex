import assert from "node:assert/strict";
import { test } from "node:test";
import { EventPlaybackOwner } from "../../apps/web/src/lib/event-playback-owner";
import { pictureInPictureState, togglePictureInPicture } from "../../apps/web/src/lib/media-element-controls";
test("PiP capability follows the owned element; a legacy adapter with no media cannot advertise it", async () => {
  const before = globalThis.document;
  let requests = 0;
  const video = {requestPictureInPicture:async () => {requests++;}} as unknown as HTMLVideoElement;
  Object.defineProperty(globalThis,"document",{configurable:true,value:{pictureInPictureEnabled:true,pictureInPictureElement:null}});
  let owned: HTMLVideoElement | undefined;
  const owner = new EventPlaybackOwner(() => ({get media(){return owned;},async play(){return true;},pause(){},setVolume(){},setMuted(){},update(){},dispose(){}}));
  try {
    await owner.setMode("video");
    await owner.play({kind:"vrcdn",profileId:"dj",profileSlug:"dj",title:"DJ",href:"/people/dj",sourceId:"DJ",src:"https://media/video",transport:"video"});
    assert.equal(pictureInPictureState(video).supported,true,"a mounted video alone may be capable");
    assert.equal(pictureInPictureState(owner.media as HTMLVideoElement ?? null).supported,false);
    owned=video;
    assert.equal(pictureInPictureState(owner.media as HTMLVideoElement).supported,true);
    await togglePictureInPicture(owner.media as HTMLVideoElement);
    assert.equal(requests,1);
    owner.close();
    assert.equal(pictureInPictureState(owner.media as HTMLVideoElement ?? null).supported,false);
  } finally {owner.close();Object.defineProperty(globalThis,"document",{configurable:true,value:before});}
});
