import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProgramController,
  FFmpegProcess,
  buildLiveControlFilterGraph,
  buildSyntheticLiveControlFfmpegArgs,
  easeInOut,
} from "../../workers/restream/live-control.mjs";

class FakeCommandClient {
  messages: string[] = [];

  async send(message: string) {
    this.messages.push(message);

    return "0 OK";
  }
}

describe("restream live control", () => {
  it("uses smoothstep easing for runtime fades", () => {
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(0.5), 0.5);
    assert.equal(easeInOut(1), 1);
  });

  it("builds a commandable FFmpeg filter graph", () => {
    const graph = buildLiveControlFilterGraph({ durationSeconds: 12 });

    assert.match(graph, /streamselect@base=inputs=3:map=0/);
    assert.match(graph, /streamselect@next=inputs=3:map=1/);
    assert.match(graph, /colorchannelmixer@overlay-alpha=aa=0/);
    assert.match(graph, /volume@audio-source-a=1/);
    assert.match(graph, /volume@audio-hold=0/);
    assert.match(graph, /volume@audio-source-b=0/);
    assert.match(graph, /zmq\[v\]/);
  });

  it("builds synthetic FFmpeg args with the live-control graph", () => {
    const args = buildSyntheticLiveControlFfmpegArgs({
      scenePaths: {
        "source-a": "source-a.png",
        "hold-slate": "hold-slate.png",
        "source-b": "source-b.png",
      },
      hlsDir: "hls",
      playlistPath: "hls/program.m3u8",
      width: 1920,
      height: 1080,
      frameRate: 60,
      durationSeconds: 12,
    });

    const filterGraph = args[args.indexOf("-filter_complex") + 1];
    const segmentPattern = args[args.indexOf("-hls_segment_filename") + 1];

    assert.match(filterGraph, /streamselect@base/);
    assert.match(filterGraph, /colorchannelmixer@overlay-alpha/);
    assert.match(segmentPattern, /program-%03d\.ts$/);
    assert.equal(args.includes("-progress"), false);
  });

  it("can enable FFmpeg progress output for output-timeline scheduling", () => {
    const args = buildSyntheticLiveControlFfmpegArgs({
      scenePaths: {
        "source-a": "source-a.png",
        "hold-slate": "hold-slate.png",
        "source-b": "source-b.png",
      },
      hlsDir: "hls",
      playlistPath: "hls/program.m3u8",
      width: 1920,
      height: 1080,
      frameRate: 60,
      durationSeconds: 12,
      progressPipe: true,
    });

    assert.deepEqual(args.slice(1, 6), ["-nostats", "-stats_period", "0.1", "-progress", "pipe:1"]);
  });

  it("tracks FFmpeg output progress in milliseconds", () => {
    const ffmpeg = Object.create(FFmpegProcess.prototype) as FFmpegProcess;
    ffmpeg.progressMs = 0;
    ffmpeg.progressBuffer = "";

    ffmpeg.readProgress(Buffer.from("frame=1\nout_time_ms=1250000\n"));
    ffmpeg.readProgress(Buffer.from("out_time_ms=250"));
    ffmpeg.readProgress(Buffer.from("0000\n"));

    assert.equal(ffmpeg.getProgressMs(), 2500);
  });

  it("expands semantic program switches into runtime filter commands", async () => {
    const client = new FakeCommandClient();
    const commandLog: Array<Record<string, unknown>> = [];
    let nowMs = 0;
    const controller = new ProgramController(client, {
      commandLog,
      startedAt: 0,
      now: () => nowMs,
      waitUntil: async (elapsedMs: number) => {
        nowMs = elapsedMs;
      },
      preset: {
        fadeMs: 100,
        fadeSteps: 2,
        holdAudioDelayMs: 25,
      },
    });

    await controller.runProofTimeline();

    assert.deepEqual(
      commandLog.filter((event) => event.kind === "operator-command").map((event) => event.command),
      ["switch_hold", "switch_source"],
    );
    assert.deepEqual(client.messages.slice(0, 6), [
      "streamselect@base map 0",
      "streamselect@next map 1",
      "colorchannelmixer@overlay-alpha aa 0.000",
      "volume@audio-source-a volume 1.000",
      "volume@audio-hold volume 0.000",
      "volume@audio-source-b volume 0.000",
    ]);
    assert(client.messages.includes("streamselect@next map 1"));
    assert(client.messages.includes("streamselect@base map 1"));
    assert(client.messages.includes("streamselect@next map 2"));
    assert(client.messages.includes("streamselect@base map 2"));
    assert(client.messages.includes("volume@audio-source-a volume 0.000"));
    assert(client.messages.includes("volume@audio-hold volume 1.000"));
    assert(client.messages.includes("volume@audio-source-b volume 1.000"));
  });
});
