import assert from "node:assert/strict";
import test from "node:test";
import { closeStartupMarkerRecording, observeSelectionMarkers } from "../../scripts/event-capacity-media.mjs";
import { decodeMarkerVisuals } from "../../scripts/event-marker-record.mjs";

const decode = frames => decodeMarkerVisuals(Buffer.concat(frames), frames.map((_, index) => ({ index, pts: index * 3000 })));
const lit = Buffer.from([255, 0, 0, 255, 255, 255]);
const slate = Buffer.from([32, 32, 32, 32, 32, 32]);

test("startup stop closes a lit EOF on an acknowledged slate without changing the submitted selection", async () => {
  let tick = 60, selected = true, held = false, stopped = false, polls = 0;
  const selections = [], quality = { width: 192, height: 108, frameRate: 30 };
  const buffer = {
    frame: Buffer.alloc(192 * 108), frameIndex: 0, framePts: 0,
    publishFrame() {}, reset() {}, beginPlayback() {}, takeAudio() { return Buffer.alloc(6400); },
  };
  observeSelectionMarkers({ buffer }, { source: { sourceId: "a", revision: 1 }, quality }, () => tick, selections);
  buffer.beginPlayback();
  for (; tick < 240; tick++) {
    buffer.frame.fill(tick % 30 < 3 ? 255 : 0);
    buffer.frameIndex++;
    buffer.framePts += 3000;
    buffer.publishFrame();
    buffer.takeAudio();
  }
  const watermark = structuredClone(selections);
  assert.equal(watermark.length, 1);
  assert.equal(watermark[0].endTick, watermark[0].tick + 120);
  assert.equal(watermark[0].pulses.length, 4);
  const frames = [slate, lit];
  assert.throws(() => decode(frames), /marker_visual_unmatched_eof/);
  const renderer = {
    profile: quality,
    hold() { held = true; selected = false; },
    getState() {
      if (held && ++polls === 2) frames.push(slate);
      // A submitted slate alone is insufficient; output progress must acknowledge it.
      return { ticks: tick + (held ? 1 : 0), outputMs: polls >= 3 ? 8100 : 8000,
        renderedSourceId: selected || polls < 2 ? "a" : undefined };
    },
    async stop() { stopped = true; assert.equal(polls, 3); },
  };
  await closeStartupMarkerRecording(renderer);
  assert.equal(stopped, true);
  assert.deepEqual(selections, watermark);
  const facts = decode(frames);
  assert.equal(facts.visuals.length, 1);
  assert.equal(facts.visuals[0].end, 6000);
});

test("startup stop preserves renderer failures before claiming closure", async () => {
  const failure = Error("encoder failed"), calls = [];
  const renderer = {
    profile: { frameRate: 30 },
    getState: () => ({ ticks: 240, error: calls.length ? failure : undefined }),
    hold: () => calls.push("hold"),
    stop: () => calls.push("stop"),
  };
  await assert.rejects(closeStartupMarkerRecording(renderer), error => error === failure);
  assert.deepEqual(calls, ["hold"]);
});

test("startup stop fails at its deadline instead of stopping on an unacknowledged slate", async t => {
  let now = 0, stopped = false;
  t.mock.method(performance, "now", () => now++ * 5000);
  const renderer = {
    profile: { frameRate: 30 },
    getState: () => ({ ticks: 240, outputMs: 8000, renderedSourceId: undefined }),
    hold() {}, stop() { stopped = true; },
  };
  await assert.rejects(closeStartupMarkerRecording(renderer), /not rendered before deadline/);
  assert.equal(stopped, false);
});
