import { readTaskMetadata, createManagedAllocationValidator } from './task-metadata.mjs';
import { createEventOutputs } from "./output-sender.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSourceRelay } from "./source-relay.mjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInputManager } from "./input-manager.mjs";
import { createTwitchInput } from "./twitch-input.mjs";
import { createOperatorControl } from "./operator-control.mjs";
import { createProgramRenderer } from "./program-renderer.mjs";
/** Every operation is bounded; watchdog is independent of this promise chain. */
export async function bounded(operation, timeoutMs = 3000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Worker operation timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Output contract: start, bounded synchronous enqueue, getState({publishing}),
 * synchronous stopNow (publication fence), asynchronous stop (cleanup).
 * The CLI installs independent primary and explicitly enabled optional senders.
 */
export function createEventWorker({
  identity,
  control,
  renderer,
  outputs,
  createRenderer,
  createOutputs,
  inputs,
  checkEnabled,
  validateConfiguration = () => {},
  clock = () => performance.now(),
  maxSessionMs = 43200000,
  requestTimeoutMs = 3000,
  metric = () => {},
}) {
  let stopped = false,
    started = false,
    busy = false,
    config,
    operator;
  let authorityUntil = -Infinity,
    runtimeUntil = Infinity,
    renewAt = Infinity,
    enabledUntil = -Infinity;
  let serverTime = 0,
    sampledAt = 0,
    unsubscribe;
  let startupUntil = Infinity,
    published = false;
  let lastOutput = 0,
    outputProgressAt = 0,
    silenceThresholdDb,
    outputConfiguration;
  const request = (name, args = {}) => {
    const captured = { ...identity, protocolVersion: 2, ...args };
    return bounded(
      (signal) => control(name, captured, signal),
      requestTimeoutMs,
    );
  };
  function fence(reason) {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    // This MUST precede all awaited cleanup, including renderer decoder shutdown.
    outputs?.stopNow();
    operator?.stop();
    void Promise.resolve(inputs?.stop()).catch(() => {});
    metric({ event: "event_worker_stopped", reason });
    if (started && clock() < authorityUntil && reason !== "operator-stop")
      void request("observeProgram", {
        state: "error",
        outputMs: lastOutput,
        publishing: false,
      }).catch(() => {});
    void Promise.resolve(renderer?.stop()).catch(() => {});
    void Promise.resolve(outputs?.stop()).catch(() => {});
  }
  function watchdog() {
    if (!started || stopped) return;
    const now = clock();
    const primary = outputs
      ?.getState()
      .destinations?.find((output) => output.outputId === config?.outputId);
    if (
      primary?.status === "invalid_setup" ||
      (!published && now > startupUntil)
    ) {
      fence("primary-startup-failed");
      return;
    }
    const deadline = Math.min(authorityUntil, runtimeUntil, enabledUntil);
    if (now >= deadline) {
      metric({
        event: "event_worker_authority_expired",
        authority:
          deadline === enabledUntil
            ? "kill-switch"
            : deadline === runtimeUntil
              ? "session-deadline"
              : "lease",
        expiredByMs: now - deadline,
      });
      fence("authority-expired");
    }
  }
  function acceptLease(lease, sentAt) {
    if (
      !lease.granted ||
      !Number.isFinite(lease.serverNow) ||
      !Number.isFinite(lease.expiresAt)
    )
      throw Error("Session authority denied");
    // Subtract the full round trip, conservatively anchoring at request start.
    authorityUntil =
      sentAt + Math.max(0, lease.expiresAt - lease.serverNow - 250);
    identity.epoch = lease.epoch;
    renewAt = sentAt + Math.min(lease.renewAfterMs, 10000);
    serverTime = lease.serverNow;
    sampledAt = clock();
  }
  const scheduleNow = () => serverTime + clock() - sampledAt;
  function actual() {
    const state = renderer.getState();
    if (state.outputMs > lastOutput) {
      lastOutput = state.outputMs;
      outputProgressAt = clock();
    }
    const publishing =
      outputs?.getState().publishing === true &&
      state.running &&
      state.outputMs > 0 &&
      clock() - outputProgressAt <= 2000;
    published ||= publishing;
    return { ...state, publishing };
  }
  async function report() {
    const destinations = outputs?.getState().destinations;
    if (destinations) {
      const result = await request("observeOutputs", { destinations });
      if (!result.accepted) throw Error("Output health rejected");
    }
    const state = actual();
    if (state.error || !state.running) throw Error("Renderer failed");
    if (!state.publishing) return;
    const { current, mode, pending, ordinaryReceiptPending, intentSequence } =
      operator.getState();
    // Do not advance the backend watermark past unresolved ordinary evidence.
    if (pending || ordinaryReceiptPending) return;
    if (
      state.renderedSourceId &&
      !(
        current?.sourceId === state.renderedSourceId &&
        current.revision === state.renderedSourceRevision &&
        current.available
      )
    )
      return;
    const result = await request("observeProgram", {
      state: state.renderedSourceId ? "live" : "hold",
      sourceId: state.renderedSourceId,
      outputId: config.outputId,
      outputMs: state.outputMs,
      publishing: true,
      mode,
      intentSequence,
      sourceRevision: state.renderedSourceRevision,
      slotKey: state.renderedSlotKey,
    });
    if (result.kind === "fenced" || (!result.kind && !result.accepted))
      throw Error("Observation rejected");
  }
  return {
    watchdog,
    getState: () => ({ stopped, ...operator?.getState(), authorityUntil }),
    async start() {
      try {
        if (!outputs && !createOutputs)
          throw Error("Output sender is unavailable");
        if (!(await bounded(checkEnabled, requestTimeoutMs)))
          throw Error("Worker disabled");
        enabledUntil = clock() + 10000;
        const sent = clock();
        const lease = await request("acquireSession");
        acceptLease(lease, sent);
        config = lease.configuration;
        validateConfiguration(config);
        outputConfiguration = JSON.stringify({
          outputId: config.outputId,
          outputs: config.outputs,
        });
        started = true;
        startupUntil = clock() + 15000;
        runtimeUntil = Math.min(
          sent + maxSessionMs,
          sent + config.sessionDeadline - lease.serverNow,
        );
        if (!config.outputs.some((output) => output.id === config.outputId))
          throw Error("Selected output unavailable");
        silenceThresholdDb = config.policy.silence?.thresholdDb;
        inputs.bindSettings?.(config.mediaSettings);
        renderer ??= createRenderer({
          mediaSettings: config.mediaSettings,
          quality: config.mediaSettings?.videoPreset,
          audioBitrateKbps: config.mediaSettings?.audioBitrateKbps,
          silenceThresholdDb,
        });
        operator = createOperatorControl({
          control: request,
          renderer,
          inputs,
          clock,
        });
        operator.applyConfiguration({
          ...config,
          epoch: identity.epoch,
          sessionId: identity.sessionId,
        });
        outputs ??= await bounded(
          () => createOutputs({ configuration: config, clock }),
          requestTimeoutMs,
        );
        if (stopped) {
          outputs.stopNow();
          throw Error("Authority expired");
        }
        await bounded(() => outputs.start(), requestTimeoutMs);
        watchdog();
        if (stopped) throw Error("Authority expired");
        unsubscribe = renderer.subscribe((chunk) => {
          watchdog();
          if (!stopped) outputs.enqueue(chunk);
        });
        await bounded(() => renderer.start(), requestTimeoutMs);
      } catch (error) {
        fence("startup-failed");
        throw error;
      }
    },
    async tick() {
      watchdog();
      if (stopped || busy || !started) return;
      busy = true;
      try {
        // Refresh halfway through the unchanged 10s authority window. A
        // 1s poll plus bounded 3s request must fit before watchdog expiry.
        if (clock() >= enabledUntil - 5000) {
          if (!(await bounded(checkEnabled, requestTimeoutMs)))
            throw Error("Worker disabled");
          enabledUntil = clock() + 10000;
        }
        if (clock() >= renewAt) {
          const sent = clock();
          acceptLease(await request("renewSession"), sent);
        }
        const fresh = await request("refreshConfiguration");
        if (!fresh.granted) throw Error("Configuration authority denied");
        config = fresh.configuration;
        validateConfiguration(config);
        serverTime = fresh.serverNow;
        sampledAt = clock();
        if (config.stopped) {
          fence("event-stopped");
          return;
        }
        operator.applyConfiguration({
          ...config,
          epoch: identity.epoch,
          sessionId: identity.sessionId,
        });
        if (
          JSON.stringify({
            outputId: config.outputId,
            outputs: config.outputs,
          }) !== outputConfiguration
        )
          throw Error("Destination configuration changed");
        watchdog();
        if (stopped) return;
        const claims = await request("claimCommands");
        if (!claims.granted) throw Error("Command authority denied");
        operator.advance({
          epoch: identity.epoch,
          sessionId: identity.sessionId,
          scheduleNow: scheduleNow(),
          commands: claims.commands,
          state: actual(),
          onFence: fence,
          onStop(command) {
            const state = actual();
            fence("operator-stop");
            void request("acknowledgeCommand", {
              commandId: command._id,
              sequence: command.sequence,
              outcome: "succeeded",
              observedState: "ended",
              observedSourceId: null,
              observedOutputId: config.outputId,
              outputMs: state.outputMs,
            }).catch(() => {});
          },
        });
        watchdog();
        if (!stopped) await report();
        metric({
          event: "event_worker_heartbeat",
          outputMs: lastOutput,
          remainingMs: Math.max(0, runtimeUntil - clock()),
        });
      } catch {
        fence("control-failed");
      } finally {
        busy = false;
      }
    },
    async stop() {
      fence("shutdown");
      await bounded(
        () => Promise.all([renderer?.stop(), outputs?.stop(), inputs.stop()]),
        4000,
      ).catch(() => {});
    },
  };
}
export function createHttpControl({ url, token, fetcher = fetch }) {
  const base = new URL(url);
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw Error("Invalid control endpoint");
  return async (name, args, signal) => {
    const response = await fetcher(new URL("/api/mutation", base), {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `eventMediaWorker:${name}`,
        args: { ...args, bridgeToken: token },
        format: "json",
      }),
    });
    if (!response.ok) throw Error("Control request failed");
    let text = "",
      bytes = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 262144) {
        await reader.cancel();
        throw Error("Control response exceeds bound");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (body.status !== "success") throw Error("Control mutation failed");
    return body.value;
  };
}
export async function checkHostedEnabled({
  parameter,
  region,
  run = promisify(execFile),
}) {
  if (!parameter || !region) return false;
  const { stdout } = await run(
    "aws",
    [
      "ssm",
      "get-parameter",
      "--name",
      parameter,
      "--region",
      region,
      "--output",
      "json",
      "--cli-connect-timeout",
      "2",
      "--cli-read-timeout",
      "2",
    ],
    { timeout: 3000, maxBuffer: 16384 },
  );
  return JSON.parse(stdout).Parameter?.Value === "true";
}
/** Real output factory; publication still requires hosted enablement and a lease. */
export async function runEventWorker({
  createOutputs = createEventOutputs,
  env = process.env,
} = {}) {
  if (!createOutputs) throw Error("Output sender is unavailable");
  const maxSessionMs =
    Number(env.VRDEX_RESTREAM_MAX_SESSION_SECONDS ?? 43200) * 1000;
  if (
    !Number.isSafeInteger(maxSessionMs) ||
    maxSessionMs < 1000 ||
    maxSessionMs > 86400000
  )
    throw Error("Invalid runtime bound");
  const validateConfiguration = createManagedAllocationValidator({
    expected: JSON.parse(env.VRDEX_EVENT_MEDIA_ALLOCATION_SNAPSHOT_JSON ?? 'null'),
    metadata: await readTaskMetadata({uri:env.ECS_CONTAINER_METADATA_URI_V4}),
  });
  const relay = await createSourceRelay({
    operatorEndpoints: JSON.parse(
      env.VRDEX_EVENT_MEDIA_SOURCE_ENDPOINTS_JSON ?? "[]",
    ),
  });
  let worker;
  worker = createEventWorker({
    identity: {
      eventId: env.VRDEX_EVENT_MEDIA_EVENT_ID,
      sessionId: env.VRDEX_EVENT_MEDIA_SESSION_ID,
      workerId: randomUUID(),
      epoch: Number(env.VRDEX_EVENT_MEDIA_EPOCH ?? 0),
    },
    control: createHttpControl({
      url: env.CONVEX_URL,
      token: env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN,
    }),
    createRenderer: (options) =>
      createProgramRenderer({ ...options, onError: () => void worker?.stop() }),
    createOutputs: (options) => createOutputs({ ...options, env }),
    maxSessionMs,
    validateConfiguration,
    checkEnabled: () =>
      checkHostedEnabled({
        parameter: env.VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER,
        region: env.AWS_REGION,
      }),
    inputs: createInputManager({
      createVrcdnInput: (args) => relay.createInput(args),
      createTwitchInput: (args) =>
        createTwitchInput({ ...args, source: args.source.input }),
    }),
    metric: (value) => console.log(JSON.stringify(value)),
  });
  let timer, poll;
  const close = () => {
    clearInterval(timer);
    clearInterval(poll);
    relay.stop();
  };
  timer = setInterval(() => {
    worker.watchdog();
    if (worker.getState().stopped) close();
  }, 50);
  poll = setInterval(() => void worker.tick(), 1000);
  const shutdown = () => {
    close();
    void worker.stop();
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, shutdown);
  try {
    await worker.start();
  } catch (error) {
    close();
    throw error;
  }
  return {
    worker,
    stop: async () => {
      close();
      await worker.stop();
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runEventWorker().catch(() => {
    console.error(JSON.stringify({ event: "event_worker_failed" }));
    process.exitCode = 1;
  });
