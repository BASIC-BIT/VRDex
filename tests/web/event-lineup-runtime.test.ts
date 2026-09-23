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

const at = (hour: number, minute = 0) => (hour * 60 + minute) * 60_000;
const stream = (id: string) => ({ streamId: id, pcUrl: id, questUrl: id });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function runtimeFixture(slots: ConstructorParameters<typeof EventLineupSession>[0]["slots"], run: (fixture: {
  session: EventLineupSession;
  sources: Array<{ id: string; released: boolean; plays: number; gain: { gain: { value: number } } }>;
  step: (wall: number, duration?: number) => Promise<void>;
  rejectNext: () => void;
  allowNext: () => void;
  deferNext: () => (accepted: boolean) => void;
  silence: () => void;
  visibility: (value: string) => void;
}) => Promise<void>) {
  const previousDocument = globalThis.document;
  const previousAudioContext = globalThis.AudioContext;
  let wall = at(20), clock = 0, quiet = false, rejected = false;
  let nextResult: Promise<boolean> | undefined;
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const gain = () => ({ gain: { value: 0 }, connect() {} });
  class Context {
    destination = {};
    createGain() { return gain(); }
    addEventListener() {}
    removeEventListener() {}
    async resume() {}
    async close() {}
  }
  const sources: Array<{ id: string; released: boolean; plays: number; gain: ReturnType<typeof gain> }> = [];
  let tick = () => {};
  let session: EventLineupSession | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: Context });
    mock.method(globalThis, "setInterval", (callback: () => void) => { tick = callback; return 1; });
    mock.method(globalThis, "clearInterval", () => {});
    mock.method(Date, "now", () => wall);
    mock.method(performance, "now", () => clock);
    session = new EventLineupSession({ title: "Event", startAt: at(20), slots }, { append() {} } as unknown as HTMLElement, () => {}, async (_context, _destination, id) => {
      const source = { id, released: false, plays: 0, gain: gain(), video: { hidden: false },
        sample(observedAt: number) { return { observedAt, dbfs: quiet && id === "shared" ? -120 : 0, progressing: source.plays > 0 && !(rejected && id !== "shared"), analysisActive: true, paused: rejected && id !== "shared", disconnected: false }; },
        ready() { return source.plays > 0 && !(rejected && id !== "shared"); },
        async play() { source.plays++; if (nextResult && id !== "shared") return nextResult; if (rejected && id !== "shared") return false; return true; },
        pause() {}, release() { source.released = true; },
      };
      sources.push(source);
      return source as unknown as ObservedVrcdnSource;
    });
    await session.play(); await settle();
    await run({ session, sources,
      async step(time, duration = 100) { wall = time; for (let elapsed = 0; elapsed < duration; elapsed += 100) { clock += 100; tick(); await settle(); } },
      allowNext() { rejected = false; nextResult = undefined; },
      deferNext() { let finish!: (accepted: boolean) => void; nextResult = new Promise(resolve => { finish = resolve; }); return finish; },
      rejectNext() { rejected = true; }, silence() { quiet = true; }, visibility(value) { document.visibilityState = value; },
    });
  } finally {
    session?.dispose(); mock.restoreAll();
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: previousAudioContext });
  }
}
const repeated = [
  { key: "a", startAt: at(20), endAt: at(21), stream: stream("shared") },
  { key: "b", startAt: at(21), endAt: at(22), stream: stream("shared") },
  { key: "c", startAt: at(22), endAt: at(23), stream: stream("shared") },
  { key: "d", startAt: at(23), endAt: at(24), stream: stream("different") },
];
test("consecutive same-source slots advance identity without a duplicate and then hand off normally", async () => {
  await runtimeFixture(repeated, async ({ session, sources, step, silence }) => {
    await step(at(20, 58));
    assert.equal(sources.length, 1);
    assert.equal(session.state.current, "a");
    await step(at(21)); assert.equal(session.state.current, "b");
    await step(at(22)); assert.equal(session.state.current, "c");
    assert.equal(sources.length, 1); assert.equal(sources[0].released, false);
    await step(at(22, 58)); assert.equal(sources.length, 2);
    assert.equal(session.state.current, "c");
    silence(); await step(at(22, 58), 1400);
    assert.equal(session.state.current, "d");
    assert.equal(sources[0].released, true); assert.equal(sources[1].gain.gain.value, 1);
  });
});
test("foreground catchup traverses expired consecutive same-source slots", async () => {
  await runtimeFixture(repeated, async ({ session, sources, step, visibility }) => {
    visibility("hidden"); await step(at(22, 30)); assert.equal(session.state.current, "a");
    visibility("visible"); await step(at(22, 30));
    assert.equal(session.state.current, "c"); assert.equal(sources.length, 1);
    await step(at(22, 58)); assert.equal(sources.length, 2);
  });
});
for (const [name, replacement] of [
  ["missing", { ...repeated[1], stream: undefined }],
  ["different expired source", { ...repeated[1], stream: stream("other") }],
  ["simultaneous start", { ...repeated[1], startAt: at(20) }],
  ["out-of-order start", { ...repeated[1], startAt: at(19) }],
] as const) test(`same-source catchup retains the ${name} barrier`, async () => {
  await runtimeFixture(repeated, async ({ session, sources, step }) => {
    session.update({ title: "Event", startAt: at(20), slots: [repeated[0], replacement, ...repeated.slice(2)] });
    await step(at(22, 30)); assert.equal(session.state.current, "a"); assert.equal(sources.length, 1);
  });
});
test("manual selection never advances a same-source logical slot", async () => {
  await runtimeFixture(repeated, async ({ session, sources, step }) => {
    session.manual("a"); await step(at(22, 30));
    assert.equal(session.state.current, "a"); assert.equal(sources.length, 1);
  });
});
test("same-source overlapping slots advance only at the later boundary", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], startAt: at(20, 30) }], async ({ session, sources, step }) => {
    await step(at(20, 59)); assert.equal(session.state.current, "a"); assert.equal(sources.length, 1);
    await step(at(21)); assert.equal(session.state.current, "b");
  });
});
test("rejected next playback retains healthy current audio and exposes one gesture retry", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], stream: stream("different") }], async ({ session, sources, step, rejectNext }) => {
    rejectNext(); await step(at(20, 58), 8000);
    assert.equal(session.state.current, "a"); assert.equal(session.state.paused, false);
    assert.equal(session.state.nextPlaybackBlocked, true);
    assert.equal(sources.length, 2); assert.equal(sources[1].plays, 1);
    assert.equal(sources[0].gain.gain.value, 1); assert.equal(sources[1].gain.gain.value, 0);
  });
});

test("viewer retry plays the retained next source, preserves current identity, then permits handoff", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], stream: stream("different") }], async ({ session, sources, step, rejectNext, allowNext, silence }) => {
    rejectNext(); await step(at(20, 58));
    assert.equal(session.state.nextPlaybackBlocked, true);
    allowNext(); session.retryNextPlayback(); await settle();
    assert.equal(session.state.nextPlaybackBlocked, false);
    assert.equal(session.state.current, "a"); assert.equal(sources.length, 2);
    assert.equal(sources[1].plays, 2); assert.equal(sources[1].gain.gain.value, 0);
    silence(); await step(at(20, 58), 1400);
    assert.equal(session.state.current, "b"); assert.equal(sources[1].gain.gain.value, 1);
  });
});
for (const oldAccepted of [true, false]) test(`a second gesture supersedes pending playback despite an older ${oldAccepted ? "acceptance" : "rejection"}`, async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], stream: stream("different") }], async ({ session, sources, step, rejectNext, deferNext, allowNext, silence }) => {
    rejectNext(); await step(at(20, 58));
    const finishOld = deferNext(); session.retryNextPlayback();
    allowNext(); session.retryNextPlayback(); await settle();
    assert.equal(session.state.nextPlaybackBlocked, false);
    assert.equal(sources.length, 2); assert.equal(sources[1].plays, 3);
    assert.equal(sources[0].gain.gain.value, 1); assert.equal(sources[1].gain.gain.value, 0);
    finishOld(oldAccepted); await settle();
    assert.equal(session.state.nextPlaybackBlocked, false);
    silence(); await step(at(20, 58), 1400);
    assert.equal(session.state.current, "b"); assert.equal(sources[1].gain.gain.value, 1);
  });
});
test("an obsolete acceptance cannot clear the newer gesture's pending or blocked state", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], stream: stream("different") }], async ({ session, sources, step, rejectNext, deferNext, allowNext, silence }) => {
    rejectNext(); await step(at(20, 58));
    const finishOld = deferNext(); session.retryNextPlayback();
    allowNext(); const finishLatest = deferNext(); session.retryNextPlayback();
    finishOld(true); await settle(); silence(); await step(at(20, 58), 8000);
    assert.equal(session.state.nextPlaybackBlocked, true);
    assert.equal(session.state.current, "a"); assert.equal(sources.length, 2);
    assert.equal(sources[1].gain.gain.value, 0);
    finishLatest(true); await settle(); await step(at(20, 58), 1400);
    assert.equal(session.state.current, "b"); assert.equal(sources[1].gain.gain.value, 1);
  });
});
for (const action of ["pause", "manual", "projection", "expiry", "dispose"] as const) {
  test(`pending rejected-source gesture cannot restore state after ${action}`, async () => {
    const slots = [repeated[0], { ...repeated[1], stream: stream("different") }];
    await runtimeFixture(slots, async ({ session, sources, step, rejectNext, deferNext }) => {
      rejectNext(); await step(at(20, 58));
      const finishFirst = deferNext(); session.retryNextPlayback();
      const finishSecond = deferNext(); session.retryNextPlayback();
      assert.equal(sources[1].plays, 3);
      if (action === "pause") session.pause();
      if (action === "manual") session.manual("a");
      if (action === "projection") session.update({ title: "Event", startAt: at(20), slots });
      if (action === "expiry") await step(at(22));
      if (action === "dispose") session.dispose();
      assert.equal(session.state.nextPlaybackBlocked, false);
      assert.equal(sources[1].released, true);
      finishSecond(false); finishFirst(true); await settle();
      assert.equal(session.state.nextPlaybackBlocked, false);
      assert.equal(session.state.current, "a"); assert.equal(sources[1].gain.gain.value, 0);
    });
  });
}
test("a repeated viewer rejection keeps the retained source and retry available", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], stream: stream("different") }], async ({ session, sources, step, rejectNext }) => {
    rejectNext(); await step(at(20, 58)); session.retryNextPlayback(); await settle();
    await step(at(20, 58), 12000);
    assert.equal(session.state.nextPlaybackBlocked, true); assert.equal(sources.length, 2);
    assert.equal(sources[1].plays, 2); assert.equal(session.state.current, "a");
  });
});
test("established-session gap handoff retains the approved early eligibility", async () => {
  await runtimeFixture([repeated[0], { ...repeated[1], startAt: at(21, 30), stream: stream("different") }], async ({ session, step, silence }) => {
    silence(); await step(at(21, 28), 1400);
    assert.equal(session.state.current, "b");
  });
});
