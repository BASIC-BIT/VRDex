import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPlayableWindow, areRenditionsPlayable } from "../src/policy";
import type { RenditionSnapshot } from "../src/contracts";
function snapshot(rendition: "video" | "audio", duration = 9): RenditionSnapshot {
  return { streamKey: "vrcdn/Alpha/1", epoch: 1, rendition, targetDurationSeconds: 3, sequence: 0, discontinuitySequence: 0, generatedAt: 1000, segments: [0,1,2,3,4].map(sequence => ({sequence,objectKey:`attempt-1-abc/${rendition}-${sequence}.ts`,durationSeconds:duration/5,programDateTime:1000+sequence*1800,discontinuity:false})) };
}
test("playable window uses three actual target durations, below and exact boundary", () => {
  assert.equal(hasPlayableWindow(snapshot("video", 8.999)), false);
  assert.equal(hasPlayableWindow(snapshot("video", 9)), true);
  assert.equal(hasPlayableWindow({...snapshot("video", 9),targetDurationSeconds:4}),false);
});
test("playable pair requires both fresh renditions in the current epoch", () => {
  const video=snapshot("video"),audio=snapshot("audio");
  assert.equal(areRenditionsPlayable({video,audio},1000,1),true);
  assert.equal(areRenditionsPlayable({video},1000,1),false);
  assert.equal(areRenditionsPlayable({video,audio:snapshot("audio",8.999)},1000,1),false);
  assert.equal(areRenditionsPlayable({video,audio},1000,2),false);
  assert.equal(areRenditionsPlayable({video,audio:{...audio,epoch:2}},1000,2),false);
  assert.equal(areRenditionsPlayable({video,audio},11000,1),false);
  assert.equal(areRenditionsPlayable({video,audio:{...audio,segments:audio.segments.map(s=>({...s,objectKey:s.objectKey.replace("attempt-1-abc","attempt-1-new")}))}},1000,1),false);
});
