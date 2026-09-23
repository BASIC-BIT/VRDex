import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { EventLineupSession } from "../../apps/web/src/lib/event-lineup-runtime";
import type { ObservedVrcdnSource } from "../../apps/web/src/lib/vrcdn-observed-source";

test("a prepared next source is released when its authored interval ends", async () => {
  const at = (hour: number, minute = 0) => (hour * 60 + minute) * 60_000;
  let scheduleNow = at(20);
  const previousDocument = globalThis.document;
  const previousAudioContext = globalThis.AudioContext;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  let tick = () => {};
  let releasedNext = 0;
  const connections: string[] = [];
  const stream = (id: string) => ({ streamId: id, pcUrl: id, questUrl: id });
  const slots = [
    { key: "a", startAt: at(20), endAt: at(21), stream: stream("a") },
    { key: "b", startAt: at(20, 30), endAt: at(21, 30), stream: stream("b") },
    { key: "c", startAt: at(21, 30), endAt: at(22, 30), stream: stream("c") },
  ];
  const gain = () => ({ gain: { value: 0 }, connect() {} });
  class FakeAudioContext {
    destination = {};
    createGain() { return gain(); }
    addEventListener() {}
    removeEventListener() {}
    async resume() {}
    async close() {}
  }
  const createSource = async (_context: AudioContext, _destination: GainNode, id: string): Promise<ObservedVrcdnSource> => {
    connections.push(id);
    return {
      video: { hidden: false }, gain: gain(),
      sample(observedAt: number) { return { observedAt, dbfs: 0, progressing: true, analysisActive: true, paused: false, disconnected: false }; },
      ready() { return true; },
      async play() { return true; },
      pause() {},
      release() { if (id === "b") releasedNext++; },
    } as unknown as ObservedVrcdnSource;
  };
  let session: EventLineupSession | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeAudioContext });
    globalThis.setInterval = ((callback: () => void) => { tick = callback; return 1; }) as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;
    mock.method(Date, "now", () => scheduleNow);
    session = new EventLineupSession({ title: "Event", startAt: at(20), slots }, { append() {} } as unknown as HTMLElement, () => {}, createSource);
    await session.play();
    await new Promise<void>(resolve => setImmediate(resolve));
    scheduleNow = at(20, 58);
    tick();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(connections, ["a", "b"]);
    assert.equal(releasedNext, 0);

    scheduleNow = at(21, 30);
    tick();
    assert.equal(releasedNext, 1);
    assert.equal(session.state.current, "a");
    assert.deepEqual(connections, ["a", "b"]);
  } finally {
    session?.dispose();
    mock.restoreAll();
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: previousAudioContext });
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }
});
