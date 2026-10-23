import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { createInputSupervisor } from "./input-supervisor.mjs";
export { VIDEO_PROFILES as QUALITY_PROFILES } from "./broadcast-profiles.mjs";
import {
  VIDEO_PROFILES as QUALITY_PROFILES,
  parseMediaSettings,
} from "./broadcast-profiles.mjs";
/** Production encoder arguments, also usable by the offline format proof.
 * Raw video and PCM enter descriptors 3/4; encoded MPEGTS leaves stdout.
 * @param {import('./broadcast-profiles.mjs').MediaSettings} settings
 */
export function programEncoderArguments(settings) {
  const parsed = parseMediaSettings(settings);
  const profile = QUALITY_PROFILES[parsed.videoPreset];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-stats_period",
    "0.25",
    "-progress",
    "pipe:5",
    "-thread_queue_size",
    "4",
    "-f",
    "rawvideo",
    "-pixel_format",
    "yuv420p",
    "-video_size",
    `${profile.width}x${profile.height}`,
    "-framerate",
    String(profile.frameRate),
    "-i",
    "pipe:3",
    "-thread_queue_size",
    "4",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    "pipe:4",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-g",
    String(profile.frameRate),
    "-keyint_min",
    String(profile.frameRate),
    "-sc_threshold",
    "0",
    "-bf",
    "0",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1",
    "-b:v",
    `${profile.videoBitrateKbps}k`,
    "-minrate",
    `${profile.videoBitrateKbps}k`,
    "-maxrate",
    `${profile.videoBitrateKbps}k`,
    "-bufsize",
    `${profile.videoBitrateKbps * 2}k`,
    "-c:a",
    "aac",
    "-b:a",
    `${parsed.audioBitrateKbps}k`,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-mpegts_flags",
    "+resend_headers",
    "-muxdelay",
    "0",
    "-f",
    "mpegts",
    "pipe:1",
  ];
}
/** Stable encoder; subscribe receives MPEG-TS chunks synchronously and MUST NOT block.
 * Destination senders own their bounded queues; this module never waits on them.
 */
export function createProgramRenderer({
  quality = "720p30",
  audioBitrateKbps = 160,
  onProgress = () => {},
  onObservation = () => {},
  onError = () => {},
  ffmpeg = "ffmpeg",
  silenceThresholdDb,
  clock = () => performance.now(),
  createInput = createInputSupervisor,
} = {}) {
  const settings = parseMediaSettings({
    videoPreset: quality,
    audioBitrateKbps,
  });
  const profile = QUALITY_PROFILES[settings.videoPreset];
  const inputs = new Map(),
    subscribers = new Set(),
    acknowledgements = new RenderAcknowledgements();
  let desired = [],
    stopped = false,
    stopPromise;
  const retiring = new Map();
  function pump() {
    if (stopped) return;
    for (const source of desired) {
      if (inputs.size + retiring.size >= 2) break;
      if (inputs.has(source.slotKey)) continue;
      const input = createInput({
        source,
        quality: profile,
        clock,
        onObservation,
        ffmpeg,
        silenceThresholdDb,
      });
      inputs.set(source.slotKey, input);
      if (running) input.start();
    }
  }
  function retire(input) {
    if (retiring.has(input)) return retiring.get(input);
    const cleanup = Promise.resolve(input.stop());
    retiring.set(input, cleanup);
    cleanup.then(
      () => {
        retiring.delete(input);
        pump();
      },
      () => {},
    );
    return cleanup;
  }
  let child,
    timer,
    running = false,
    selected,
    submittedSlotKey,
    submittedSourceId,
    submittedSourceRevision,
    renderedSlotKey,
    renderedSourceId,
    renderedSourceRevision,
    startedAt,
    ticks = 0,
    error,
    outputMs = 0;
  const frameBytes = (profile.width * profile.height * 3) / 2;
  const holdFrame = Buffer.alloc(frameBytes, 128);
  holdFrame.fill(32, 0, profile.width * profile.height);
  // Visible neutral slate with a brighter central rectangle; no product copy invented.
  for (let y = (profile.height / 3) | 0; y < (profile.height * 2) / 3; y++)
    holdFrame.fill(
      80,
      y * profile.width + ((profile.width / 3) | 0),
      y * profile.width + (((profile.width * 2) / 3) | 0),
    );
  const silence = Buffer.alloc((48000 / profile.frameRate) * 4);
  function fail(message) {
    if (error) return;
    error = new Error(message);
    clearTimeout(timer);
    running = false;
    onError(error);
    child?.kill("SIGKILL");
  }
  function tick() {
    if (!running) return;
    const due = Math.floor(((clock() - startedAt) * profile.frameRate) / 1000);
    if (due - ticks > profile.frameRate * 2)
      return fail("Program render clock exceeded its processing budget");
    while (ticks <= due) {
      // A slow encoder is a fatal session condition, never an unbounded raw-media queue.
      if (
        child.stdio[3].writableLength > frameBytes * 4 ||
        child.stdio[4].writableLength > 48000 * 4
      )
        break;
      const input = inputs.get(selected);
      const ready = input?.getObservation().ready;
      const actualSlotKey = ready ? selected : undefined;
      const actualSourceId = ready ? input.source.sourceId : undefined;
      const actualRevision = ready ? input.source.revision : undefined;
      if (
        actualSlotKey !== submittedSlotKey ||
        actualSourceId !== submittedSourceId ||
        actualRevision !== submittedSourceRevision
      ) {
        acknowledgements.submit(
          actualSlotKey,
          ((ticks + 1) * 1000) / profile.frameRate,
          actualSourceId,
          actualRevision,
        );
        submittedSourceRevision = actualRevision;
        submittedSourceId = actualSourceId;
        submittedSlotKey = actualSlotKey;
      }
      child.stdio[3].write(ready ? input.buffer.frame : holdFrame);
      child.stdio[4].write(
        ready ? input.buffer.takeAudio(silence.length) : silence,
      );
      ticks++;
    }
    timer = setTimeout(
      tick,
      Math.max(1, (ticks * 1000) / profile.frameRate - (clock() - startedAt)),
    );
  }
  return {
    profile,
    async reconcileSources(sources) {
      if (stopped) throw Error("Renderer is stopped");
      if (
        sources.length > 2 ||
        new Set(sources.map((s) => s.slotKey)).size !== sources.length
      )
        throw new Error("At most two distinct current/next inputs");
      desired = sources.map((source) => ({ ...source }));
      for (const [key, input] of inputs) {
        if (
          !desired.some(
            (s) =>
              s.slotKey === key &&
              s.sourceId === input.source.sourceId &&
              s.url === input.source.url &&
              s.revision === input.source.revision,
          )
        ) {
          inputs.delete(key);
          if (selected === key) selected = undefined;
          retire(input);
        }
      }
      pump();
    },
    getInputs: () => [...inputs.values()],
    getState: () => ({
      selectedSlotKey: selected,
      renderedSlotKey,
      renderedSourceId,
      renderedSourceRevision,
      outputMs,
      error,
      running,
      ticks,
      videoQueueBytes: child?.stdio[3].writableLength ?? 0,
    }),
    selectSource(slotKey) {
      if (!inputs.get(slotKey)?.getObservation().ready) return false;
      selected = slotKey;
      return true;
    },
    hold() {
      selected = undefined;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async start() {
      if (stopped) throw new Error("Renderer is stopped");
      if (running) return;
      if (child) throw new Error("Renderer cannot restart after stop");
      running = true;
      startedAt = clock();
      child = spawn(ffmpeg, programEncoderArguments(settings), {
        stdio: ["ignore", "pipe", "ignore", "pipe", "pipe", "pipe"],
      });
      child.on("error", () => fail("Program encoder failed to start"));
      child.on("close", (code) => {
        if (running) fail(`Program encoder exited (${code})`);
      });
      for (const pipe of [child.stdio[3], child.stdio[4]])
        pipe.on("error", () => {
          if (running) fail("Program encoder pipe closed");
        });
      child.stdout.on("data", (chunk) => {
        for (const listener of subscribers) listener(chunk);
      });
      createInterface({ input: child.stdio[5] }).on("line", (line) => {
        if (line.startsWith("out_time_us=")) {
          const next = Number(line.slice(12)) / 1000;
          if (!Number.isFinite(next) || next < 0) return;
          if (next < outputMs) return fail("Program timestamp regressed");
          outputMs = next;
          renderedSlotKey = acknowledgements.advance(outputMs);
          renderedSourceId = acknowledgements.renderedSourceId;
          renderedSourceRevision = acknowledgements.renderedSourceRevision;
          onProgress({
            outputMs,
            wallElapsedMs: clock() - startedAt,
            delayMs: clock() - startedAt - outputMs,
          });
        }
      });
      for (const input of inputs.values()) input.start();
      tick();
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      desired = [];
      selected = undefined;
      running = false;
      clearTimeout(timer);
      const cleanups = [...inputs.values()].map(retire);
      inputs.clear();
      const encoder =
        child && child.exitCode === null && child.signalCode === null
          ? new Promise((resolve) => {
              const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
              child.once("close", () => {
                clearTimeout(kill);
                resolve();
              });
              child.stdio[3].end();
              child.stdio[4].end();
            })
          : Promise.resolve();
      stopPromise = Promise.all([
        ...retiring.values(),
        ...cleanups,
        encoder,
      ]).then(() => {});
      return stopPromise;
    },
  };
}
export class RenderAcknowledgements {
  pending = [];
  renderedSlotKey = undefined;
  renderedSourceId = undefined;
  renderedSourceRevision = undefined;
  submit(slotKey, outputMs, sourceId, sourceRevision) {
    // At most two seconds of submitted switches can exist before the clock fails.
    if (this.pending.length >= 256)
      throw new Error("Program acknowledgement queue exceeded bound");
    this.pending.push({ slotKey, outputMs, sourceId, sourceRevision });
  }
  advance(outputMs) {
    while (this.pending[0]?.outputMs <= outputMs) {
      const rendered = this.pending.shift();
      this.renderedSlotKey = rendered.slotKey;
      this.renderedSourceId = rendered.sourceId;
      this.renderedSourceRevision = rendered.sourceRevision;
    }
    return this.renderedSlotKey;
  }
}
