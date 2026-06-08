import { spawn } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

export const DEFAULT_LIVE_CONTROL_PRESET = {
  controlMode: "overlay-alpha-volume-fade",
  controlPort: 5555,
  fadeMs: 500,
  fadeSteps: 30,
  holdAudioDelayMs: 750,
};

export const LIVE_CONTROL_MODES = new Set(["overlay-alpha-volume-fade", "hard-switch"]);

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function easeInOut(value) {
  return value * value * (3 - 2 * value);
}

function commandElapsedSeconds(startedAt, now) {
  return Number(((now - startedAt) / 1000).toFixed(3));
}

function pythonZmqSenderCode() {
  return String.raw`
import json
import sys
import zmq

port = sys.argv[1]
ctx = zmq.Context()
socket = ctx.socket(zmq.REQ)
socket.setsockopt(zmq.LINGER, 0)
socket.connect("tcp://127.0.0.1:" + port)
try:
    for line in sys.stdin:
        request = json.loads(line)
        socket.send_string(request["message"])
        poller = zmq.Poller()
        poller.register(socket, zmq.POLLIN)
        if poller.poll(3000):
            print(json.dumps({"id": request["id"], "response": socket.recv_string()}), flush=True)
        else:
            print(json.dumps({"id": request["id"], "error": "timed out waiting for FFmpeg ZMQ response"}), flush=True)
finally:
    socket.close()
    ctx.term()
`;
}

export class ZmqCommandClient {
  constructor(port = DEFAULT_LIVE_CONTROL_PRESET.controlPort, options = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    const pythonCommand = options.pythonCommand ?? process.env.VRDEX_RESTREAM_ZMQ_PYTHON_COMMAND ?? "python";
    this.child = (options.spawnProcess ?? spawn)(pythonCommand, ["-c", pythonZmqSenderCode(), String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });

    lines.on("line", (line) => {
      const parsed = JSON.parse(line);
      const pending = this.pending.get(parsed.id);

      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);

      if (parsed.error === undefined) {
        pending.resolve(parsed.response);
        return;
      }

      pending.reject(new Error(parsed.error));
    });

    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("close", (code) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`ZMQ client exited with ${code}${this.stderr ? `\n${this.stderr}` : ""}`));
      }

      this.pending.clear();
    });
  }

  send(message) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out sending FFmpeg ZMQ command: ${message}`));
      }, 5000);
      this.pending.set(id, { resolve: resolvePromise, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, message })}\n`);
    });
  }

  close() {
    this.child.stdin.end();
  }
}

export class FFmpegProcess {
  constructor(args, options = {}) {
    this.args = args;
    this.child = (options.spawnProcess ?? spawn)(options.command ?? "ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.stdout = "";
    this.stderr = "";
    this.closed = false;
    this.exitCode = undefined;
    this.progressMs = 0;
    this.progressBuffer = "";

    this.child.stdout.on("data", (chunk) => {
      this.stdout += chunk;
      this.readProgress(chunk);
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("close", (code) => {
      this.closed = true;
      this.exitCode = code;
    });
  }

  readProgress(chunk) {
    this.progressBuffer += chunk;
    const lines = this.progressBuffer.split(/\r?\n/);
    this.progressBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const match = line.match(/^out_time_ms=(\d+)$/);

      if (match) {
        this.progressMs = Math.max(this.progressMs, Number(match[1]) / 1000);
      }
    }
  }

  logs() {
    return { stdout: this.stdout, stderr: this.stderr };
  }

  getProgressMs() {
    return this.progressMs;
  }

  wait() {
    return new Promise((resolvePromise, reject) => {
      this.child.on("error", reject);
      this.child.on("close", (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        reject(new Error(`ffmpeg exited with ${code}\n${this.stderr}`));
      });
    });
  }

  stop(signal = "SIGTERM") {
    this.child.kill(signal);
  }
}

function buildOverlayFadeFilterGraph({ durationSeconds }) {
  return [
    "[0:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS,split=2[v0base][v0next]",
    "[1:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS,split=2[v1base][v1next]",
    "[2:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS,split=2[v2base][v2next]",
    "[v0base][v1base][v2base]streamselect@base=inputs=3:map=0[base]",
    "[v0next][v1next][v2next]streamselect@next=inputs=3:map=1[nextraw]",
    "[nextraw]format=rgba,colorchannelmixer@overlay-alpha=aa=0[next]",
    "[base][next]overlay=format=auto,zmq[v]",
    "[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS,volume@audio-source-a=1[a0]",
    "[4:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS,volume@audio-hold=0[a1]",
    "[5:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS,volume@audio-source-b=0[a2]",
    `[6:a]atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,volume@audio-silence=0[a3]`,
    "[a0][a1][a2][a3]amix=inputs=4:normalize=0:duration=first[a]",
  ].join(";");
}

function buildHardSwitchFilterGraph() {
  return [
    "[0:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v0]",
    "[1:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v1]",
    "[2:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v2]",
    "[v0][v1][v2]streamselect@video-source=inputs=3:map=0,zmq[v]",
    "[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a0]",
    "[4:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a1]",
    "[5:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a2]",
    "[a0][a1][a2]astreamselect@audio-source=inputs=3:map=0[a]",
  ].join(";");
}

export function buildLiveControlFilterGraph({ durationSeconds, controlMode = DEFAULT_LIVE_CONTROL_PRESET.controlMode }) {
  if (controlMode === "hard-switch") {
    return buildHardSwitchFilterGraph();
  }

  return buildOverlayFadeFilterGraph({ durationSeconds });
}

export function buildSyntheticLiveControlFfmpegArgs({
  scenePaths,
  hlsDir,
  playlistPath,
  width,
  height,
  frameRate,
  durationSeconds,
  controlMode = DEFAULT_LIVE_CONTROL_PRESET.controlMode,
  x264Preset = "veryfast",
  progressPipe = false,
}) {
  const segmentPattern = join(hlsDir, "program-%03d.ts");

  return [
    "-hide_banner",
    ...(progressPipe ? ["-nostats", "-stats_period", "0.1", "-progress", "pipe:1"] : []),
    "-y",
    "-re",
    "-loop",
    "1",
    "-framerate",
    String(frameRate),
    "-t",
    String(durationSeconds),
    "-i",
    scenePaths["source-a"],
    "-re",
    "-loop",
    "1",
    "-framerate",
    String(frameRate),
    "-t",
    String(durationSeconds),
    "-i",
    scenePaths["hold-slate"],
    "-re",
    "-loop",
    "1",
    "-framerate",
    String(frameRate),
    "-t",
    String(durationSeconds),
    "-i",
    scenePaths["source-b"],
    ...[
      `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`,
      `sine=frequency=220:sample_rate=48000:duration=${durationSeconds}`,
      `sine=frequency=880:sample_rate=48000:duration=${durationSeconds}`,
      ...(controlMode === "hard-switch" ? [] : [`anullsrc=channel_layout=stereo:sample_rate=48000:duration=${durationSeconds}`]),
    ].flatMap((source) => ["-re", "-f", "lavfi", "-i", source]),
    "-filter_complex",
    buildLiveControlFilterGraph({ durationSeconds, controlMode }),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    x264Preset,
    "-tune",
    "zerolatency",
    "-profile:v",
    "high",
    "-level:v",
    "4.2",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(frameRate),
    "-g",
    String(frameRate),
    "-keyint_min",
    String(frameRate),
    "-sc_threshold",
    "0",
    "-b:v",
    "3500k",
    "-maxrate",
    "3500k",
    "-bufsize",
    "7000k",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ];
}

export class ProgramController {
  constructor(commandClient, options = {}) {
    this.commandClient = commandClient;
    this.commandLog = options.commandLog ?? [];
    this.preset = { ...DEFAULT_LIVE_CONTROL_PRESET, ...(options.preset ?? {}) };
    this.startedAt = options.startedAt ?? performance.now();
    this.now = options.now ?? (() => performance.now());
    this.waitUntil = options.waitUntil ?? this.defaultWaitUntil.bind(this);
  }

  elapsedSeconds() {
    return commandElapsedSeconds(this.startedAt, this.now());
  }

  async defaultWaitUntil(elapsedMs) {
    const remainingMs = elapsedMs - (this.now() - this.startedAt);

    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
  }

  operatorCommand(command, extra = {}) {
    this.commandLog.push({ elapsedSeconds: this.elapsedSeconds(), kind: "operator-command", command, ...extra });
  }

  async sendFilterCommand({ target, command, value, kind }) {
    const message = `${target} ${command} ${value}`;
    const response = await this.sendZmq(message);
    const event = {
      elapsedSeconds: this.elapsedSeconds(),
      kind,
      target,
      command,
      value,
      response,
    };
    this.commandLog.push(event);

    return event;
  }

  async sendZmq(message, retries = 20) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await this.commandClient.send(message);
        const status = Number(response.split(/\s+/)[0]);

        if (status === 0) {
          return response;
        }

        throw new Error(`FFmpeg ZMQ command failed: ${message} -> ${response}`);
      } catch (error) {
        lastError = error;
        await sleep(150);
      }
    }

    throw lastError;
  }

  async sendMap(target, map, kind) {
    return this.sendFilterCommand({ target, command: "map", value: map, kind });
  }

  async sendVolume(target, volume, kind) {
    return this.sendFilterCommand({ target, command: "volume", value: volume.toFixed(3), kind });
  }

  async sendAlpha(alpha, kind) {
    return this.sendFilterCommand({
      target: "colorchannelmixer@overlay-alpha",
      command: "aa",
      value: alpha.toFixed(3),
      kind,
    });
  }

  async sendHardSwitch(sourceMap, kind) {
    await Promise.all([
      this.sendMap("streamselect@video-source", sourceMap, `video-${kind}`),
      this.sendMap("astreamselect@audio-source", sourceMap, `audio-${kind}`),
    ]);
  }

  async fadeValue({ startMs, durationMs, from, to, sendStep }) {
    const events = [];

    for (let step = 1; step <= this.preset.fadeSteps; step += 1) {
      await this.waitUntil(startMs + (durationMs * step) / this.preset.fadeSteps);
      const ratio = easeInOut(step / this.preset.fadeSteps);
      const value = from + (to - from) * ratio;
      events.push(await sendStep(value));
    }

    return events;
  }

  async initialize() {
    await this.waitUntil(750);

    if (this.preset.controlMode === "hard-switch") {
      await this.sendHardSwitch(0, "source-a-initial");
      return;
    }

    await this.sendMap("streamselect@base", 0, "video-base-initial");
    await this.sendMap("streamselect@next", 1, "video-next-initial");
    await this.sendAlpha(0, "video-overlay-alpha-initial");
    await this.sendVolume("volume@audio-source-a", 1, "audio-volume-source-a-initial");
    await this.sendVolume("volume@audio-hold", 0, "audio-volume-hold-initial");
    await this.sendVolume("volume@audio-source-b", 0, "audio-volume-source-b-initial");
  }

  async switchHold(atMs = 4000) {
    await this.waitUntil(atMs);
    this.operatorCommand("switch_hold");

    if (this.preset.controlMode === "hard-switch") {
      await this.sendHardSwitch(1, "hold");
      return;
    }

    await this.sendMap("streamselect@next", 1, "video-next-hold");
    await Promise.all([
      this.fadeValue({
        startMs: atMs,
        durationMs: this.preset.fadeMs,
        from: 0,
        to: 1,
        sendStep: (alpha) => this.sendAlpha(alpha, "video-alpha-fade-to-hold"),
      }),
      this.fadeValue({
        startMs: atMs,
        durationMs: this.preset.fadeMs,
        from: 1,
        to: 0,
        sendStep: (volume) => this.sendVolume("volume@audio-source-a", volume, "audio-fade-out-source-a"),
      }),
    ]);
    await this.sendMap("streamselect@base", 1, "video-base-hold");
    await this.sendAlpha(0, "video-overlay-alpha-reset-hold");
    await this.waitUntil(atMs + this.preset.holdAudioDelayMs);
    await this.fadeValue({
      startMs: atMs + this.preset.holdAudioDelayMs,
      durationMs: this.preset.fadeMs,
      from: 0,
      to: 1,
      sendStep: (volume) => this.sendVolume("volume@audio-hold", volume, "audio-fade-in-hold"),
    });
  }

  async switchSource(targetSourceKey, atMs = 8000) {
    const sourceMap = targetSourceKey === "source-b" ? 2 : 0;
    const sourceVolumeTarget = targetSourceKey === "source-b" ? "volume@audio-source-b" : "volume@audio-source-a";

    await this.waitUntil(atMs);
    this.operatorCommand("switch_source", { targetSourceKey });

    if (this.preset.controlMode === "hard-switch") {
      await this.sendHardSwitch(sourceMap, targetSourceKey);
      return;
    }

    await this.sendMap("streamselect@next", sourceMap, `video-next-${targetSourceKey}`);
    await Promise.all([
      this.fadeValue({
        startMs: atMs,
        durationMs: this.preset.fadeMs,
        from: 0,
        to: 1,
        sendStep: (alpha) => this.sendAlpha(alpha, `video-alpha-fade-to-${targetSourceKey}`),
      }),
      this.fadeValue({
        startMs: atMs,
        durationMs: this.preset.fadeMs,
        from: 1,
        to: 0,
        sendStep: (volume) => this.sendVolume("volume@audio-hold", volume, "audio-fade-out-hold"),
      }),
      this.fadeValue({
        startMs: atMs,
        durationMs: this.preset.fadeMs,
        from: 0,
        to: 1,
        sendStep: (volume) => this.sendVolume(sourceVolumeTarget, volume, `audio-fade-in-${targetSourceKey}`),
      }),
    ]);
    await this.sendMap("streamselect@base", sourceMap, `video-base-${targetSourceKey}`);
    await this.sendAlpha(0, `video-overlay-alpha-reset-${targetSourceKey}`);
  }

  async runProofTimeline() {
    await this.initialize();
    await this.switchHold(4000);
    await this.switchSource("source-b", 8000);

    return this.commandLog;
  }
}
