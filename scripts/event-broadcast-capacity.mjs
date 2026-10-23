import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createProgramRenderer } from "../workers/restream/program-renderer.mjs";
import { createInputSupervisor } from "../workers/restream/input-supervisor.mjs";
import { createInputManager } from "../workers/restream/input-manager.mjs";
import { createTwitchInput } from "../workers/restream/twitch-input.mjs";
import { createEventOutputs } from "../workers/restream/output-sender.mjs";
import { createProofWorker } from "./event-proof-fixtures.mjs";
import { resolveDestinationProfile } from "../workers/restream/broadcast-profiles.mjs";
import { readTaskMetadata } from "../workers/restream/task-metadata.mjs";
import { validateTaskMetadata } from "../workers/restream/worker-allocation.mjs";
import {
  parseCapacityArguments,
  quantile,
  validateCapacityReceipt,
} from "./event-capacity-contracts.mjs";
import { createProcessOwner, processTable } from "./event-proof-processes.mjs";
import {
  readCgroupCounters,
  resourceInterval,
} from "./event-capacity-resources.mjs";
import {
  createFixture,
  referenceFrames,
  verifyMedia,
} from "./event-capacity-media.mjs";
import { runProofEnvelope } from "./event-proof-envelope.mjs";

/** Runs only an isolated, synthetic, authenticated-metadata benchmark. The fixture
 * authority and local transport injection are never imported by production.
 */
export async function runCapacityWorkload(
  request,
  {
    metadata,
    readCounters = readCgroupCounters,
    createSupervisor = createInputSupervisor,
  } = {},
) {
  const directory = request.outputDir;
  const owner = createProcessOwner();
  let worker, renderer, outputs, watchdog, poll, recording, recordingClosed;
  let phase = "setup",
    readinessLosses = 0,
    maxCompressedBufferBytes = 0,
    maxDecoders = 0,
    maxAcquisitions = 0,
    internalDelayMs = 0;
  let failure,
    receipt = {
      schemaVersion: 1,
      terminal: false,
      request,
      startedAt: new Date().toISOString(),
      actual: metadata
        ? {
            taskArn: metadata.task.TaskARN,
            taskLimits: metadata.task.Limits,
            containerLimits: metadata.container.Limits,
            image: metadata.container.Image,
            imageId: metadata.container.ImageID,
          }
        : undefined,
    };
  const decoderFacts = {};
  const observations = new Map(),
    acquisitions = new Set(),
    transitions = [],
    samples = [],
    phases = [],
    commands = [];
  const byteCap = Math.ceil((request.durationSeconds + 180) * 1500000); // all recordings; > worst admitted output rate
  let recordedBytes = 0,
    outputFailure;
  await mkdir(directory, { recursive: false });
  const sampleFile = createWriteStream(`${directory}/samples.ndjson`, {
    flags: "wx",
    mode: 0o600,
  });
  try {
    const references = {};
    receipt.inputs = {};
    for (const id of ["a", "b"]) {
      receipt.inputs[id] = await createFixture(
        owner,
        `${directory}/${id}.ts`,
        id,
      );
      references[id] = await referenceFrames(owner, `${directory}/${id}.ts`);
      await mkdir(`${directory}/${id}-hls`);
      owner.start(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-re",
          "-stream_loop",
          "-1",
          "-i",
          `${directory}/${id}.ts`,
          "-c",
          "copy",
          "-f",
          "hls",
          "-hls_time",
          "1",
          "-hls_list_size",
          "8",
          "-hls_flags",
          "delete_segments+temp_file",
          "-hls_segment_filename",
          `${directory}/${id}-hls/segment%d.ts`,
          `${directory}/${id}-hls/index.m3u8`,
        ],
        { stdio: "ignore" },
      );
    }
    // Fixtures are preencoded before steady sampling. Their live copy, TLS delivery,
    // all decoders/encoders/senders/receivers remain charged in the same cgroup.
    const now = Date.now();
    const compliance = {
      sourceConsent: "accepted",
      destinationAuthority: "accepted",
      providerRules: "accepted",
      rightsClearedMedia: "accepted",
    };
    const destinations = [
      "vrcdn",
      ...(request.simulcastEnabled ? ["twitch"] : []),
    ];
    const configuration = {
      outputId: "primary",
      mediaSettings: request.settings,
      sessionDeadline: now + (request.durationSeconds + 180) * 1000,
      mode: "automatic",
      policy: {},
      sources: ["a", "b"].map((id) => ({
        id,
        type: "twitch_watch",
        input: { kind: "twitch", channel: `fixture_${id}` },
        publicUrl: `https://www.twitch.tv/fixture_${id}`,
      })),
      slots: [
        {
          slotKey: "a",
          sourceId: "a",
          startAt: now - 1000,
          endAt: now + 60000,
          available: true,
        },
        {
          slotKey: "b",
          sourceId: "b",
          startAt: now + 60000,
          endAt: now + (request.durationSeconds + 170) * 1000,
          available: true,
        },
      ],
      outputs: destinations.map((destination) => ({
        id: destination === "vrcdn" ? "primary" : "optional",
        type: destination === "vrcdn" ? "vrcdn" : "external_rtmp",
        credential: { secretRef: destination },
        ...(destination === "twitch"
          ? {
              twitchSetup: {
                channel: "test",
                profile: "twitch-conservative-720p30",
              },
              simulcastEnabled: true,
            }
          : {}),
        profile: resolveDestinationProfile({
          settings: request.settings,
          destination,
        }),
        compliance,
      })),
    };
    const ports = { vrcdn: 19681, twitch: 19682 };
    for (const destination of destinations)
      owner.start(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-listen",
          "1",
          "-i",
          `rtmp://127.0.0.1:${ports[destination]}/live/test-key`,
          "-c",
          "copy",
          "-f",
          "mpegts",
          "-y",
          `${directory}/${destination}.ts`,
        ],
        { stdio: "ignore" },
      );
    outputs = createEventOutputs({
      configuration,
      spawnForDestination: (destination) => (cmd, args, opts) => {
        const local = [...args];
        local[local.length - 1] = `rtmp://127.0.0.1:${ports[destination]}/live`;
        return owner.start(cmd, local, opts);
      },
      resolveCredential: (ref) =>
        JSON.stringify({
          rtmpUrl:
            ref === "vrcdn"
              ? "rtmp://uk.ingest.vrcdn.live/live"
              : "rtmp://live.twitch.tv/app",
          streamKey: "test-key",
        }),
    });
    const inputs = createInputManager({
      createVrcdnInput: () => {
        throw Error("Unexpected input");
      },
      createTwitchInput: (args) => {
        const id = args.source.id;
        acquisitions.add(id);
        maxAcquisitions = Math.max(maxAcquisitions, acquisitions.size);
        const handle = createTwitchInput({
          ...args,
          source: args.source.input,
          onState: (event) => {
            args.onState(event);
            if (phase !== "steady")
              transitions.push({
                sourceId: id,
                kind: event.kind,
                reason: event.reason,
              });
            if (event.compressedBufferUpperBoundBytes)
              maxCompressedBufferBytes = Math.max(
                maxCompressedBufferBytes,
                event.compressedBufferUpperBoundBytes,
              );
          },
          spawnProcess: (_cmd, _args, opts) =>
            owner.start(
              "python3",
              [
                "-m",
                "workers.restream.tests.capacity_input",
                `${directory}/${id}-hls`,
              ],
              opts,
            ),
        });
        return {
          ...handle,
          dispose: async () => {
            await handle.dispose();
            acquisitions.delete(id);
          },
        };
      },
    });
    renderer = createProgramRenderer({
      quality: request.settings.videoPreset,
      audioBitrateKbps: request.settings.audioBitrateKbps,
      onProgress: (e) => {
        if (phase === "steady")
          internalDelayMs = Math.max(internalDelayMs, e.delayMs);
      },
      createInput: (args) =>
        createSupervisor({
          ...args,
          spawnProcess: (cmd, argv, opts) => {
            const child = owner.start(cmd, argv, opts);
            const facts = (decoderFacts[args.source.sourceId] ??= {
              videoBytes: 0,
              audioBytes: 0,
              ptsLines: 0,
              exits: 0,
              invalidData: 0,
            });
            child.stdio[3].on("data", (b) => (facts.videoBytes += b.length));
            child.stdio[4].on("data", (b) => (facts.audioBytes += b.length));
            child.stderr.on("data", (b) => {
              const s = b.toString();
              facts.ptsLines += (s.match(/pts_time:/g) ?? []).length;
              facts.invalidData += (
                s.match(/Invalid|Error|error|failed/g) ?? []
              ).length;
            });
            child.once("close", () => facts.exits++);
            return child;
          },
        }),
      onObservation: (e) => {
        const previous = observations.get(e.sourceId);
        if (phase === "steady" && previous?.ready && !e.ready) {
          readinessLosses++;
          transitions.push({
            at: performance.now(),
            sourceId: e.sourceId,
            ready: false,
          });
        }
        observations.set(e.sourceId, e);
      },
    });
    recording = createWriteStream(`${directory}/program.ts`, {
      flags: "wx",
      mode: 0o600,
      highWaterMark: 4 * 1048576,
    });
    recordingClosed = new Promise((resolve, reject) => {
      recording.once("close", resolve);
      recording.once("error", reject);
    });
    recordingClosed.catch(() => {});
    renderer.subscribe((chunk) => {
      recordedBytes += chunk.length;
      if (recordedBytes > byteCap || !recording.write(chunk)) {
        outputFailure = true;
        void worker?.stop();
      }
    });
    worker = createProofWorker({
      identity: {
        eventId: "capacity",
        sessionId: "capacity",
        workerId: "capacity",
        epoch: 0,
      },
      renderer,
      outputs,
      inputs,
      checkEnabled: async () => true,
      control: async (name, args) => {
        if (name === "acquireSession" || name === "renewSession")
          return {
            granted: true,
            epoch: 1,
            serverNow: Date.now(),
            expiresAt: Date.now() + 30000,
            renewAfterMs: 10000,
            configuration,
          };
        if (name === "refreshConfiguration")
          return { granted: true, serverNow: Date.now(), configuration };
        if (name === "claimCommands")
          return { granted: true, commands: [...commands] };
        if (name === "acknowledgeCommand") {
          const index = commands.findIndex((c) => c._id === args.commandId);
          if (index >= 0) commands.splice(index, 1);
        }
        return { accepted: true };
      },
    });
    await worker.start();
    watchdog = setInterval(() => worker.watchdog(), 50);
    poll = setInterval(() => void worker.tick(), 100);
    phase = "startup";
    const startupDeadline = performance.now() + 15000;
    for (;;) {
      await sleep(100);
      if (worker.getState().stopped || outputFailure)
        throw Error("Startup publication failed");
      if (
        renderer.getInputs().length === 2 &&
        renderer.getInputs().every((i) => i.getObservation().ready) &&
        renderer.getState().renderedSourceId === "a" &&
        outputs.getState().destinations.every((d) => d.publishing)
      )
        break;
      if (performance.now() > startupDeadline)
        throw Error("Dual input startup exceeded bound");
    }
    phase = "steady";
    let previous = await readCounters();
    const start = previous.at;
    let last = start;
    const intervals = [];
    receipt.steadyStartedAt = new Date().toISOString();
    phases.push({
      identity: "a",
      atSeconds: renderer.getState().outputMs / 1000 + 2,
    });
    while (performance.now() - start < request.durationSeconds * 1000) {
      await sleep(
        Math.max(0, start + (samples.length + 1) * 1000 - performance.now()),
      );
      const at = performance.now(),
        state = renderer.getState(),
        decoderInputs = renderer.getInputs();
      maxDecoders = Math.max(maxDecoders, decoderInputs.length);
      if (worker.getState().stopped || outputFailure || state.error)
        throw Error("Steady publication failed");
      assert.equal(decoderInputs.length, 2);
      assert(
        decoderInputs.every((i) => i.getObservation().ready),
        "Standby readiness loss",
      );
      assert.equal(
        state.renderedSourceId,
        "a",
        "Timetable alone must not hand off",
      );
      assert.equal(acquisitions.size, 2);
      assert(
        outputs.getState().destinations.every((d) => d.publishing),
        "Destination lost progress",
      );
      const next = await readCounters();
      const resource = resourceInterval(previous, next, request.cpuUnits);
      intervals.push(resource);
      previous = next;
      const row = {
        elapsedMs: at - start,
        gapMs: at - last,
        outputMs: state.outputMs,
        cpuPercent: resource.cpuPercent,
        memoryBytes: resource.memoryBytes,
        ready: decoderInputs.map((i) => ({
          sourceId: i.source.sourceId,
          ready: i.getObservation().ready,
        })),
      };
      samples.push(row);
      sampleFile.write(JSON.stringify(row) + "\n");
      last = at;
      if (readinessLosses) throw Error("Transient steady readiness loss");
      if (samples.length % 30 === 0)
        console.log(
          JSON.stringify({
            event: "capacity-progress",
            elapsedSeconds: Math.round((at - start) / 1000),
            samples: samples.length,
          }),
        );
    }
    phase = "handoff";
    receipt.steady = {
      durationMs: performance.now() - start,
      dualDecodeMs: performance.now() - start,
      readinessLosses,
      samples: samples.length,
      maxSampleGapMs: Math.max(...samples.map((s) => s.gapMs)),
    };
    receipt.resources = {
      cpuP95Percent: quantile(
        intervals.map((i) => i.cpuPercent),
        0.95,
      ),
      cpuP50Percent: quantile(
        intervals.map((i) => i.cpuPercent),
        0.5,
      ),
      sampleCoverageMs: intervals.reduce((sum, i) => sum + i.elapsedMs, 0),
      memoryPeakBytes: Math.max(...intervals.map((i) => i.memoryBytes)),
      accounting: "whole-cgroup-including-fixtures-and-receivers",
    };
    async function select(type, id, sequence) {
      commands.push({
        _id: `command-${sequence}`,
        sequence,
        commandType: type,
        ...(id ? { targetSourceId: id } : {}),
      });
      const until = performance.now() + 15000;
      while (commands.length || renderer.getState().renderedSourceId !== id) {
        await sleep(100);
        if (worker.getState().stopped || performance.now() > until)
          throw Error("Encoded transition failed");
      }
      await sleep(3000);
      phases.push({
        identity: id ?? "slate",
        atSeconds: renderer.getState().outputMs / 1000 - 1,
      });
    }
    await select("take_source", "b", 1);
    await sleep(7000);
    await select("cut_to_slate", undefined, 2);
    await sleep(3000);
    phase = "cleanup";
    clearInterval(watchdog);
    clearInterval(poll);
    await worker.stop();
    recording.end();
    await recordingClosed;
    // Receivers need SIGINT/TERM to close their muxes before offline inspection.
    receipt.cleanup = await owner.close();
    sampleFile.end();
    receipt.phases = phases;
    phase = "verify";
    const verifier = createProcessOwner();
    try {
      receipt.outputs = [];
      for (const destination of destinations)
        receipt.outputs.push(
          await verifyMedia(
            verifier,
            `${directory}/${destination}.ts`,
            request,
            destination,
            phases,
            references,
            internalDelayMs,
          ),
        );
    } finally {
      await verifier.close();
    }
    receipt.phases = phases;
    receipt.maxCompressedBufferBytes = maxCompressedBufferBytes;
    receipt.maxDecoders = maxDecoders;
    receipt.maxAcquisitions = maxAcquisitions;
    receipt.artifacts = [];
    for (const name of ["program.ts", ...destinations.map((d) => `${d}.ts`)]) {
      const bytes = await readFile(`${directory}/${name}`);
      receipt.artifacts.push({
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        complete: true,
      });
    }
    receipt.terminal = true;
    receipt.finishedAt = new Date().toISOString();
    validateCapacityReceipt(receipt);
    receipt.passed = true;
  } catch (error) {
    failure = error;
    receipt.passed = false;
    receipt.failurePhase = phase;
    receipt.failureCode =
      {
        "Missing identity frame": "missing_identity_frame",
        "Wrong encoded source identity": "wrong_identity",
        "Dual input startup exceeded bound": "startup_deadline",
        "Steady publication failed": "publication_failed",
        "Transient steady readiness loss": "readiness_loss",
        "Output identity/quality/timing contract failed":
          "identity_quality_timing",
        "Capacity contract failed": "capacity_limit",
        "Output format/packet contract failed": "format_packet",
        "Incomplete healthy dual interval": "sample_completeness",
      }[error.message] ?? "contract_failed";
    receipt.decoderFacts = decoderFacts;
    receipt.failureState = {
      worker: worker?.getState(),
      renderer: renderer?.getState(),
      observations: [...observations.values()],
      outputs: outputs?.getState(),
    };
    receipt.readinessLosses = readinessLosses;
    receipt.transitions = transitions;
  } finally {
    clearInterval(watchdog);
    clearInterval(poll);
    sampleFile.end();
    try {
      await worker?.stop();
      recording?.end();
      if (recordingClosed) await recordingClosed;
      receipt.cleanup = await owner.close();
    } catch {
      receipt.cleanup = { closed: false };
      receipt.passed = false;
      failure ??= Error("Cleanup failed");
    }
    receipt.terminal = true;
    receipt.finishedAt = new Date().toISOString();
    await writeFile(
      `${directory}/receipt.json`,
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  if (failure)
    throw Error(`Capacity ${receipt.failurePhase ?? "cleanup"} failed`);
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const request = parseCapacityArguments(process.argv.slice(2));
    if (process.env.VRDEX_PROOF_INNER === "capacity") {
      const metadata = await readTaskMetadata();
      validateTaskMetadata(
        {
          allocation: {
            cpuUnits: request.cpuUnits,
            memoryMiB: request.memoryMiB,
            evidenceId: "candidate-proof-only",
          },
        },
        metadata,
      );
      await runCapacityWorkload(request, { metadata });
    } else
      await runProofEnvelope({
        kind: "capacity",
        args: process.argv.slice(2),
        directory: request.outputDir,
        timeoutMs: (request.durationSeconds + 600) * 1000,
        byteCap: Math.ceil((request.durationSeconds + 180) * 1500000),
      });
  } catch {
    console.error("Capacity proof failed");
    process.exitCode = 1;
  }
}
