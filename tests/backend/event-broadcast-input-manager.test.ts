import assert from "node:assert/strict";
import { it } from "node:test";
import { createInputManager } from "../../workers/restream/input-manager.mjs";
const deferred = () => {
  let resolve!: (v?: any) => void, reject!: (v?: any) => void;
  const promise = new Promise<any>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const settings = { videoPreset: "480p30", audioBitrateKbps: 160 };
const desired = (id: string, revision = 1) => ({
  slotKey: `slot-${id}`,
  source: {
    id,
    revision,
    type: "vrcdn_link",
    publicUrl: `https://stream.vrcdn.live/live/${id}.live.ts`,
  },
});
function fixture() {
  const handles: any[] = [];
  let live = 0,
    high = 0;
  const create = ({ source, signal, onState }: any) => {
    const ready = deferred(),
      close = deferred();
    const h = { source, signal, onState, ready, close, disposed: 0 };
    handles.push(h);
    high = Math.max(high, ++live);
    return {
      transportReady: ready.promise,
      dispose: () => {
        h.disposed++;
        return close.promise.then(() => {
          live--;
        });
      },
    };
  };
  const manager = createInputManager({
    settings,
    createVrcdnInput: create,
    createTwitchInput: create,
  });
  return { manager, handles, counts: () => ({ live, high }) };
}
it("pending transport does not block reconcile; retirement occupies capacity and only latest desire starts", async () => {
  const f = fixture(),
    a = desired("a"),
    b = desired("b");
  assert.equal(
    f.manager.reconcile({
      current: a,
      candidate: b,
      epoch: 1,
      intentSequence: 0,
    }),
    undefined,
  );
  f.handles[0].ready.resolve({ url: "http://local/a" });
  await flush();
  assert.equal(f.manager.readySources().length, 1);
  f.manager.reconcile({
    current: a,
    candidate: desired("c"),
    epoch: 1,
    intentSequence: 1,
  });
  f.manager.reconcile({
    current: a,
    candidate: desired("d"),
    epoch: 1,
    intentSequence: 2,
  });
  assert.equal(f.handles.length, 2);
  assert.equal(f.handles[1].disposed, 1);
  f.handles[1].ready.resolve({ url: "http://obsolete/b" });
  await flush();
  assert.equal(f.manager.readySources().length, 1);
  f.handles[1].close.resolve();
  await flush();
  assert.equal(f.handles.length, 3);
  assert.equal(f.handles[2].source.id, "d");
  assert.equal(f.counts().high, 2);
});
it("Cut/stop and epoch or revision changes fence readiness without awaiting physical cleanup", async () => {
  const f = fixture();
  f.manager.reconcile({ current: desired("a"), epoch: 1, intentSequence: 0 });
  f.manager.reconcile({
    current: desired("a", 2),
    epoch: 2,
    intentSequence: 2,
  });
  f.handles[0].ready.resolve({ url: "http://obsolete/a" });
  await flush();
  assert.deepEqual(f.manager.readySources(), []);
  f.manager.reconcile({ epoch: 2, intentSequence: 3 });
  const stop = f.manager.stop();
  f.handles[1].ready.resolve({ url: "http://obsolete/new" });
  await flush();
  assert.deepEqual(f.manager.readySources(), []);
  for (const h of f.handles) h.close.resolve();
  await stop;
  f.manager.reconcile({ current: desired("b"), epoch: 3, intentSequence: 4 });
  assert.equal(f.handles.length, 2);
});
it("promoting candidate to current reuses identity; settings bind is inert and immutable", async () => {
  const f = fixture(),
    a = desired("a");
  f.manager.reconcile({ candidate: a, epoch: 1, intentSequence: 0 });
  f.manager.reconcile({ current: a, epoch: 1, intentSequence: 1 });
  assert.equal(f.handles.length, 1);
  f.manager.bindSettings({ ...settings });
  assert.throws(() =>
    f.manager.bindSettings({ ...settings, videoPreset: "720p30" }),
  );
  let starts = 0;
  const m = createInputManager({
    createVrcdnInput: () => {
      starts++;
      return { transportReady: new Promise(() => {}), dispose: async () => {} };
    },
  });
  m.reconcile({ current: a, epoch: 1, intentSequence: 0 });
  assert.equal(starts, 0);
  m.bindSettings(settings);
  assert.equal(starts, 1);
});
import { createOperatorControl } from "../../workers/restream/operator-control.mjs";
function controllerFixture() {
  let now = 0,
    holds = 0,
    selected: string | undefined,
    config: any = {
      controlProtocolVersion: 2,
      epoch: 1,
      sessionId: "session",
      intentSequence: 0,
      committedIntent: { kind: "automatic" },
      policy: {},
      sessionDeadline: 1000000,
      outputId: "out",
      sources: ["a", "b"].map((id) => desired(id).source),
      slots: ["a", "b"].map((id, i) => ({
        slotKey: `slot-${id}`,
        sourceId: id,
        startAt: i * 1000,
        available: true,
      })),
    };
  const calls: any[] = [],
    requests = new Map<string, ReturnType<typeof deferred>>(),
    observations: any[] = [];
  const renderer = {
    hold: () => {
      holds++;
      selected = undefined;
    },
    selectSource: (key: string) => {
      selected = key;
      return true;
    },
    reconcileSources: () => {},
    getInputs: () =>
      observations.map((o) => ({ source: o, getObservation: () => o })),
  };
  const inputs = {
    reconcile: () => {},
    readySources: () => [],
    stop: async () => {},
  };
  const controller = createOperatorControl({
    renderer,
    inputs,
    clock: () => now,
    control: (name: string, args: any) => {
      calls.push({ name, args });
      const p = requests.get(name);
      return p
        ? p.promise
        : Promise.resolve({
            kind: "ok",
            preparationExpiresAt: 15000,
            intentSequence: args.sequence,
          });
    },
  });
  controller.applyConfiguration(config);
  const advance = (commands: any[] = []) =>
    controller.advance({
      epoch: 1,
      sessionId: "session",
      scheduleNow: now,
      commands,
      state: {
        running: true,
        publishing: true,
        outputMs: 100,
        renderedSourceId: undefined,
      },
      onFence: () => {
        throw Error("unexpected fence");
      },
    });
  return {
    controller,
    config,
    calls,
    requests,
    observations,
    advance,
    setNow: (n: number) => {
      now = n;
    },
    counts: () => ({ holds, selected }),
  };
}
const take = (sequence = 1) => ({
  _id: `c${sequence}`,
  sequence,
  commandType: "take_source",
  controlPhase: "preparing",
  controlTarget: {
    kind: "source",
    mode: "manual",
    source: { slotKey: "slot-b", sourceId: "b", revision: 1 },
  },
});
it("pending Begin/promote cannot block Cut, and stale promotion cannot reselect", async () => {
  const f = controllerFixture(),
    begin = deferred();
  f.requests.set("beginPreparation", begin);
  f.advance([take()]);
  f.controller.applyConfiguration({
    ...f.config,
    intentSequence: 2,
    committedIntent: { kind: "slate" },
  });
  assert.equal(f.controller.getState().committedIntent.kind, "slate");
  assert.ok(f.counts().holds > 0);
  begin.resolve({ kind: "ok", preparationExpiresAt: 15000 });
  await flush();
  f.advance();
  assert.equal(f.calls.filter((c) => c.name === "promoteOperation").length, 0);
  const g = controllerFixture(),
    promote = deferred();
  g.requests.set("promoteOperation", promote);
  g.observations.push({
    slotKey: "slot-b",
    sourceId: "b",
    revision: 1,
    ready: true,
    observedAt: 0,
  });
  g.advance([take()]);
  await flush();
  g.advance();
  g.controller.applyConfiguration({
    ...g.config,
    intentSequence: 2,
    committedIntent: { kind: "slate" },
  });
  promote.resolve({ kind: "ok", intentSequence: 1 });
  await flush();
  g.advance();
  assert.equal(g.counts().selected, undefined);
  assert.equal(g.controller.getState().intentSequence, 2);
});
it("takeover uses original expiry through encoded confirmation and keeps promoted manual intent", async () => {
  const f = controllerFixture();
  f.setNow(14900);
  f.config = {
    ...f.config,
    intentSequence: 1,
    committedIntent: { kind: "manual", sourceId: "b", revision: 1 },
    pendingOperation: {
      ...take(),
      controlPhase: "promoting",
      preparationExpiresAt: 15000,
    },
  };
  f.controller.applyConfiguration(f.config);
  f.advance([f.config.pendingOperation]);
  await flush();
  f.setNow(15001);
  f.advance();
  await flush();
  assert.equal(
    f.calls.find((c) => c.name === "acknowledgeCommand")?.args.failureReason,
    "expired",
  );
  assert.equal(f.controller.getState().committedIntent.kind, "manual");
});
import { createEventWorker } from "../../workers/restream/event-worker.mjs";
import { createProgramRenderer } from "../../workers/restream/program-renderer.mjs";
it("actual worker renews while acquisition and disposal hang; Cancel, Cut, then Stop preempt synchronously", async () => {
  const f = fixture();
  let now = 0,
    renewals = 0,
    stops = 0,
    holds = 0,
    encoded: any,
    prepared: any[] = [],
    commands: any[] = [],
    outputMs = 1;
  const config: any = {
    controlProtocolVersion: 2,
    mediaSettings: settings,
    intentSequence: 0,
    committedIntent: { kind: "manual", sourceId: "a", revision: 1 },
    sessionDeadline: 1000000,
    policy: {},
    sources: ["a", "b"].map((id) => ({
      ...desired(id).source,
      eventSlotId: `slot-${id}`,
    })),
    slots: ["a", "b"].map((id) => ({
      slotKey: `slot-${id}`,
      sourceId: id,
      startAt: 0,
      available: true,
    })),
    outputId: "out",
    outputs: [{ id: "out" }],
  };
  const renderer = {
    start: async () => {},
    stop: async () => {},
    subscribe: () => () => {},
    hold: () => {
      holds++;
      encoded = undefined;
    },
    reconcileSources: (s: any[]) => {
      prepared = s;
    },
    getInputs: () =>
      prepared.map((source) => ({
        source,
        getObservation: () => ({
          ...source,
          ready: true,
          progressing: true,
          observedAt: now,
        }),
      })),
    selectSource: (key: string) => {
      encoded = prepared.find((s) => s.slotKey === key);
      return !!encoded;
    },
    getState: () => ({
      running: true,
      outputMs: ++outputMs,
      renderedSourceId: encoded?.sourceId,
      renderedSlotKey: encoded?.slotKey,
      renderedSourceRevision: encoded?.revision,
    }),
  };
  const worker = createEventWorker({
    identity: { eventId: "e", sessionId: "s", workerId: "w" },
    inputs: f.manager,
    renderer,
    clock: () => now,
    checkEnabled: async () => true,
    outputs: {
      start: async () => {},
      stop: async () => {},
      stopNow: () => {
        stops++;
      },
      getState: () => ({ publishing: true }),
    },
    control: async (name: string, args: any) => {
      if (name === "acquireSession" || name === "renewSession") {
        if (name === "renewSession") renewals++;
        return {
          granted: true,
          epoch: 1,
          expiresAt: now + 30000,
          serverNow: now,
          renewAfterMs: 10000,
          configuration: structuredClone(config),
        };
      }
      if (name === "refreshConfiguration")
        return {
          granted: true,
          serverNow: now,
          configuration: structuredClone(config),
        };
      if (name === "claimCommands") return { granted: true, commands };
      if (name === "beginPreparation")
        return { kind: "ok", preparationExpiresAt: now + 15000 };
      if (name === "acknowledgeCommand") {
        commands = [];
        config.pendingOperation = undefined;
        return { kind: "ok" };
      }
      return { kind: "ok", accepted: true };
    },
  });
  await worker.start();
  await worker.tick();
  f.handles[0].ready.resolve({ url: "http://local/a" });
  await flush();
  await worker.tick();
  await worker.tick();
  assert.equal(worker.getState().current.sourceId, "a");
  commands = [take()];
  config.pendingOperation = commands[0];
  await worker.tick();
  assert.equal(f.handles.length, 2);
  now = 6000;
  await worker.tick();
  now = 11000;
  await worker.tick();
  assert.equal(renewals, 1);
  assert.equal(encoded.sourceId, "a");
  commands = [];
  config.pendingOperation = undefined;
  await worker.tick();
  assert.equal(f.handles[1].disposed, 1);
  assert.equal(encoded.sourceId, "a");
  commands = [take(2)];
  config.pendingOperation = commands[0];
  await worker.tick();
  assert.equal(f.handles.length, 2, "retiring candidate still owns capacity");
  config.intentSequence = 3;
  config.committedIntent = { kind: "slate" };
  config.pendingOperation = undefined;
  commands = [];
  await worker.tick();
  assert.equal(worker.getState().committedIntent.kind, "slate");
  assert.ok(holds > 0);
  assert.equal(stops, 0);
  f.handles[1].ready.resolve({ url: "http://late/b" });
  await flush();
  await worker.tick();
  assert.equal(encoded, undefined);
  assert.deepEqual(f.manager.readySources(), []);
  commands = [{ _id: "stop", sequence: 4, commandType: "stop_program" }];
  await worker.tick();
  assert.equal(stops, 1);
  assert.equal(worker.getState().stopped, true);
  for (const h of f.handles) h.close.resolve();
  await worker.stop();
  assert.equal(f.counts().high, 2);
});
it("decoder latest-desire pump counts retiring supervisors and hold preempts closure", async () => {
  const created: any[] = [];
  let live = 0,
    high = 0;
  const renderer = createProgramRenderer({
    createInput: ({ source }: any) => {
      const close = deferred();
      const input = {
        source,
        close,
        start: () => {},
        stop: () =>
          close.promise.then(() => {
            live--;
          }),
        getObservation: () => ({ ready: true }),
      };
      created.push(input);
      high = Math.max(high, ++live);
      return input;
    },
  });
  const source = (id: string, revision = 1) => ({
    slotKey: id,
    sourceId: id,
    revision,
    url: `http://local/${id}/${revision}`,
  });
  await renderer.reconcileSources([source("a"), source("b")]);
  assert.equal(renderer.selectSource("b"), true);
  await renderer.reconcileSources([source("a"), source("c")]);
  await renderer.reconcileSources([source("a"), source("d")]);
  renderer.hold();
  assert.equal(created.length, 2);
  assert.equal(renderer.getState().selectedSlotKey, undefined);
  created[1].close.resolve();
  await flush();
  assert.equal(created.length, 3);
  assert.equal(created[2].source.sourceId, "d");
  assert.equal(high, 2);
  const stop = renderer.stop();
  for (const input of created) input.close.resolve();
  await stop;
});
it("Cancel retains prior intent and old failed RPC cannot clear a newer operation", async () => {
  const f = controllerFixture(),
    old = deferred();
  f.requests.set("beginPreparation", old);
  f.advance([take()]);
  await flush();
  f.controller.applyConfiguration({ ...f.config, pendingOperation: undefined });
  assert.equal(f.controller.getState().committedIntent.kind, "automatic");
  const newer = { ...take(2), _id: "new" };
  f.controller.applyConfiguration({ ...f.config, pendingOperation: newer });
  f.requests.set("beginPreparation", deferred());
  f.advance([newer]);
  old.resolve({ kind: "failed", reason: "actor_revoked" });
  await flush();
  assert.equal(f.controller.getState().pending.command._id, "new");
  assert.equal(f.controller.getState().committedIntent.kind, "automatic");
});
it("manual fallback retains pinned intent after actor revocation and recovers only matching decoded identity", async () => {
  const f = controllerFixture();
  f.config = {
    ...f.config,
    intentSequence: 1,
    committedIntent: { kind: "manual", sourceId: "b", revision: 1 },
  };
  f.config.sources[1].eventSlotId = "slot-b";
  f.controller.applyConfiguration(f.config);
  f.advance();
  assert.equal(f.controller.getState().committedIntent.kind, "manual");
  assert.equal(f.counts().selected, undefined);
  f.observations.push({
    slotKey: "slot-b",
    sourceId: "b",
    revision: 1,
    ready: true,
    progressing: true,
    observedAt: 0,
  });
  f.controller.applyConfiguration({ ...f.config, actorRevoked: true });
  f.advance();
  assert.equal(f.counts().selected, "slot-b");
  f.controller.applyConfiguration({
    ...f.config,
    intentSequence: 2,
    committedIntent: { kind: "slate" },
    sources: [],
  });
  f.advance();
  f.controller.applyConfiguration(f.config);
  f.advance();
  assert.equal(f.controller.getState().committedIntent.kind, "slate");
  assert.equal(f.counts().selected, undefined);
});
it("Return to auto in gap promotes exact slate target with no acquisition and rejects older configuration", async () => {
  const f = controllerFixture();
  f.config = {
    ...f.config,
    intentSequence: 1,
    committedIntent: { kind: "slate" },
  };
  f.controller.applyConfiguration(f.config);
  const cmd = {
    _id: "gap",
    sequence: 2,
    commandType: "set_automatic_mode",
    controlPhase: "preparing",
    controlTarget: { kind: "slate", mode: "automatic" },
  };
  f.advance([cmd]);
  await flush();
  f.advance([cmd]);
  await flush();
  f.advance([cmd]);
  await flush();
  assert.deepEqual(
    f.calls.find((c) => c.name === "promoteOperation").args.target,
    cmd.controlTarget,
  );
  assert.equal(f.controller.getState().committedIntent.kind, "automatic");
  assert.equal(
    f.calls.find((c) => c.name === "acknowledgeCommand").args.observedSourceId,
    null,
  );
  f.controller.applyConfiguration(f.config);
  assert.equal(f.controller.getState().intentSequence, 2);
});
it("preparing takeover and Begin roundtrip cannot renew the original remaining budget", async () => {
  const f = controllerFixture(),
    begin = deferred();
  f.setNow(14900);
  f.requests.set("beginPreparation", begin);
  const operation = { ...take(), preparationExpiresAt: 15000 };
  f.config = { ...f.config, pendingOperation: operation };
  f.controller.applyConfiguration(f.config);
  f.advance([operation]);
  await flush();
  f.setNow(14980);
  begin.resolve({ kind: "ok", preparationExpiresAt: 15000 });
  await flush();
  assert.equal(f.controller.getState().pending.deadline, 15000);
  f.setNow(15001);
  f.advance([operation]);
  await flush();
  assert.equal(
    f.calls.find((c) => c.name === "acknowledgeCommand").args.failureReason,
    "expired",
  );
  assert.equal(f.controller.getState().committedIntent.kind, "automatic");
});
it("encoded acknowledgement retries preserve the exact successful evidence fingerprint", async () => {
  const f = controllerFixture(),
    ack = deferred();
  f.requests.set("acknowledgeCommand", ack);
  const command = {
    _id: "slate",
    sequence: 1,
    commandType: "set_automatic_mode",
    controlPhase: "preparing",
    controlTarget: { kind: "slate", mode: "automatic" },
  };
  f.advance([command]);
  await flush();
  f.advance([command]);
  await flush();
  const first = f.calls.find((c) => c.name === "acknowledgeCommand");
  assert.ok(first);
  ack.reject(Error("reply lost"));
  await flush();
  f.requests.delete("acknowledgeCommand");
  f.setNow(1001);
  f.advance([command]);
  await flush();
  const requests = f.calls.filter((c) => c.name === "acknowledgeCommand");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].args, first.args);
});
it("factory failure and rejected readiness stay input-local, while terminal retry waits for cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const ready = deferred(),
    closed = deferred();
  const manager = createInputManager({
    settings,
    createVrcdnInput: () => {
      calls++;
      if (calls === 1) throw Error("provider unavailable");
      return { transportReady: ready.promise, dispose: () => closed.promise };
    },
  });
  manager.reconcile({ current: desired("a"), epoch: 1, intentSequence: 0 });
  assert.deepEqual(manager.readySources(), []);
  manager.reconcile({ current: desired("a"), epoch: 1, intentSequence: 0 });
  ready.reject(Error("transport unavailable"));
  await flush();
  t.mock.timers.tick(1000);
  assert.equal(calls, 2, "terminal retry still owns physical slot");
  // A replacement of the same identity cannot overlap its predecessor.
  closed.resolve();
  await flush();
  assert.equal(calls, 3);
  manager.reconcile({ epoch: 1, intentSequence: 1 });
  await manager.stop();
});
it("authoritative promoting refresh preserves its receipt when promotion response is delayed", async () => {
  const f = controllerFixture(),
    promote = deferred();
  f.requests.set("promoteOperation", promote);
  f.config.sources[1].eventSlotId = "slot-b";
  f.observations.push({
    slotKey: "slot-b",
    sourceId: "b",
    revision: 1,
    ready: true,
    progressing: true,
    observedAt: 0,
  });
  f.advance([take()]);
  await flush();
  f.controller.applyConfiguration({
    ...f.config,
    intentSequence: 1,
    committedIntent: { kind: "manual", sourceId: "b", revision: 1 },
    pendingOperation: { ...take(), controlPhase: "promoting" },
  });
  assert.equal(f.controller.getState().pending?.command._id, "c1");
  assert.equal(f.controller.getState().committedIntent.kind, "manual");
  promote.resolve({ kind: "ok", intentSequence: 1 });
  await flush();
  assert.equal(f.controller.getState().pending?.phase, "promoting");
  assert.equal(f.counts().selected, "slot-b");
});
