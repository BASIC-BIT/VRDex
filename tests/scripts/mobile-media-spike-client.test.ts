import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = readFileSync("scripts/mobile-media-spike/hosted/client.js", "utf8");
function fixture(mode: string) {
  const elements = new Map<string, { value: string; src?: string; listeners: Map<string, () => Promise<void>>; [key: string]: unknown }>();
  for (const id of ["video", "audio", "mode", "status", "pip", "stop", "events", "start", "notes", "dj", "save"]) {
    elements.set(`#${id}`, { value: id === "mode" ? mode : "", listeners: new Map(), pause() {}, removeAttribute() {}, load() {}, play: async () => {}, canPlayType: () => "probably", addEventListener(event: string, callback: () => Promise<void>) { this.listeners.set(event, callback); } });
  }
  runInNewContext(source, { document: {querySelector: (id: string) => elements.get(id), addEventListener() {}, visibilityState: "visible"}, navigator: {}, window: {addEventListener() {}}, setInterval() {}, setTimeout() {}, URL, Date });
  return {elements, start: elements.get("#start")!.listeners.get("click")!};
}
test("spike playback selects only the five approved static URLs", async () => {
  for (const [mode, url, element] of [
    ["relay", "/relay/index.m3u8", "video"],
    ["relay-audio", "/relay/audio/index.m3u8", "audio"],
    ["live", "https://stream.vrcdn.live/live/basicbit.live.mp4", "video"],
    ["video", "/media/video.m3u8", "video"],
    ["audio", "/media/audio.m3u8", "audio"],
  ]) {
    const f = fixture(mode); await f.start(); assert.equal(f.elements.get(`#${element}`)?.src, url);
  }
});
test("DOM-injected unknown modes never become media URLs", async () => {
  for (const mode of ["../arbitrary", "https://unreviewed.invalid/x", "<svg/onload=alert(1)>", "constructor", "__proto__", ""]) {
    const f = fixture(mode); await f.start();
    assert.equal(f.elements.get("#video")?.src, undefined);
    assert.equal(f.elements.get("#audio")?.src, undefined);
  }
});
