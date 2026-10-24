import assert from "node:assert/strict";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createProgramRenderer } from "../workers/restream/program-renderer.mjs";
import { createInputSupervisor } from "../workers/restream/input-supervisor.mjs";
import { createInputManager } from "../workers/restream/input-manager.mjs";
import { createTwitchInput } from "../workers/restream/twitch-input.mjs";
import { createProofWorker } from "./event-proof-fixtures.mjs";
import { createProcessOwner } from "./event-proof-processes.mjs";
import { probe, packetFacts } from "./event-capacity-media.mjs";
import {
  readCgroupCounters,
  resourceInterval,
} from "./event-capacity-resources.mjs";
import { quantile } from "./event-capacity-contracts.mjs";
import { readTaskMetadata } from "../workers/restream/task-metadata.mjs";
import { validateTaskMetadata } from "../workers/restream/worker-allocation.mjs";
const publicKinds = new Set([
  "acquiring",
  "warming",
  "transport_ready",
  "ad_wait",
  "unavailable",
  "cancelled",
  "buffer",
]);
const publicReasons = new Set([
  "destination_denied",
  "dns_denied",
  "dns_timeout",
  "proxy_denied",
  "credentials_denied",
  "tls_denied",
  "http_timeout",
  "response_limit",
  "dependency_mismatch",
  "unsupported_media",
  "provider_unavailable",
  "media_timeout",
  "preparation_timeout",
  "cancelled",
  "process_failed",
]);
/** Typed bounded observations, independent of raw provider diagnostics. */
export function createPublicObservations(
  sourceIds,
  clock = () => performance.now(),
) {
  const start = clock();
  const sources = Object.fromEntries(
    sourceIds.map((id) => [
      id,
      {
        counts: Object.fromEntries([...publicKinds].map((kind) => [kind, 0])),
        events: [],
        droppedEvents: 0,
        decoder: {
          observed: false,
          ready: false,
          readyTransitions: 0,
          losses: 0,
        },
      },
    ]),
  );
  return {
    state(id, event) {
      const row = sources[id];
      if (!row || !publicKinds.has(event?.kind)) return;
      row.counts[event.kind]++;
      const typed = { atMs: Math.round(clock() - start), kind: event.kind };
      if (event.kind === "unavailable")
        typed.reason = publicReasons.has(event.reason)
          ? event.reason
          : "provider_unavailable";
      row.latest = typed;
      if (event.kind !== "buffer") {
        if (row.events.length < 128) row.events.push(typed);
        else row.droppedEvents++;
      }
    },
    decoder(event) {
      const row = sources[event?.sourceId];
      if (!row || typeof event.ready !== "boolean") return;
      const previous = row.decoder;
      if (previous.ready && !event.ready) previous.losses++;
      if (!previous.ready && event.ready) previous.readyTransitions++;
      previous.observed = true;
      previous.ready = event.ready;
      previous.lastAtMs = Math.round(clock() - start);
    },
    snapshot() {
      return JSON.parse(
        JSON.stringify({
          sources,
          realAdMarkersObserved: Object.values(sources).some(
            (row) => row.counts.ad_wait > 0,
          ),
          adEvidenceKind: "public_hls_ad_wait_state",
          realAdPlaybackObserved: false,
        }),
      );
    },
  };
}
/** Public access is recorded privately only. There is no sender or endpoint input. */
export async function runPublicInputWorkload({ outputDir }, env = process.env) {
  const channels = JSON.parse(env.VRDEX_PROOF_PUBLIC_CHANNELS_JSON ?? "null");
  if (
    !Array.isArray(channels) ||
    channels.length !== 2 ||
    new Set(channels).size !== 2 ||
    channels.some((c) => typeof c !== "string" || !/^[a-z0-9_]{3,25}$/.test(c))
  )
    throw Error("Two canonical public channels required");
  const metadata = await readTaskMetadata();
  const cpuUnits = metadata.task.Limits?.CPU * 1024,
    memoryMiB = metadata.task.Limits?.Memory;
  if (!["4096:8192", "8192:16384"].includes(`${cpuUnits}:${memoryMiB}`))
    throw Error("Unapproved public proof shape");
  validateTaskMetadata(
    {
      allocation: { cpuUnits, memoryMiB, evidenceId: "candidate-public-only" },
    },
    metadata,
  );
  const owner = createProcessOwner();
  const observations = createPublicObservations(["source-0", "source-1"]);
  let worker,
    renderer,
    stream,
    closed,
    poll,
    watchdog,
    phase = "startup",
    passed = false,
    cleanup;
  const receipt = {
    schemaVersion: 1,
    kind: "private-public-input",
    channels,
    settings: { videoPreset: "720p30", audioBitrateKbps: 320 },
    cpuUnits,
    memoryMiB,
    plannedSteadySeconds: 1800,
    startedAt: new Date().toISOString(),
    taskArn: metadata.task.TaskARN,
    imageId: metadata.container.ImageID,
    publication: false,
  };
  let bytes = 0,
    losses = 0,
    bufferMax = 0,
    lastOutputAt = performance.now(),
    outputFault = false;
  const previousReady = new Map(),
    samples = [];
  await mkdir(outputDir, { recursive: false });
  try {
    stream = createWriteStream(`${outputDir}/program.ts`, {
      flags: "wx",
      highWaterMark: 4 * 1048576,
      mode: 0o600,
    });
    closed = new Promise((resolve, reject) => {
      stream.once("close", resolve);
      stream.once("error", reject);
    });
    closed.catch(() => {});
    renderer = createProgramRenderer({
      quality: "720p30",
      audioBitrateKbps: 320,
      createInput: (args) =>
        createInputSupervisor({ ...args, spawnProcess: owner.start }),
      onObservation: (e) => {
        observations.decoder(e);
        if (phase === "steady" && previousReady.get(e.sourceId) && !e.ready)
          losses++;
        previousReady.set(e.sourceId, e.ready);
      },
    });
    const inputs = createInputManager({
      createVrcdnInput: () => {
        throw Error("Unexpected source");
      },
      createTwitchInput: (args) =>
        createTwitchInput({
          ...args,
          source: args.source.input,
          spawnProcess: owner.start,
          onState: (e) => {
            observations.state(args.source.id, e);
            args.onState(e);
            bufferMax = Math.max(
              bufferMax,
              e.compressedBufferUpperBoundBytes ?? 0,
            );
          },
        }),
    });
    const now = Date.now(),
      configuration = {
        mediaSettings: receipt.settings,
        outputId: "private-recording",
        outputs: [{ id: "private-recording" }],
        sessionDeadline: now + 1980000,
        mode: "automatic",
        policy: {},
        sources: channels.map((channel, i) => ({
          id: `source-${i}`,
          type: "twitch_watch",
          input: { kind: "twitch", channel },
          publicUrl: `https://www.twitch.tv/${channel}`,
        })),
        slots: [
          {
            slotKey: "a",
            sourceId: "source-0",
            startAt: now - 1000,
            endAt: now + 60000,
            available: true,
          },
          {
            slotKey: "b",
            sourceId: "source-1",
            startAt: now + 60000,
            endAt: now + 1950000,
            available: true,
          },
        ],
      };
    const outputs = {
      start: async () => {},
      stopNow() {},
      stop: async () => {},
      enqueue(chunk) {
        bytes += chunk.length;
        lastOutputAt = performance.now();
        if (bytes > 1600 * 1048576 || !stream.write(chunk)) {
          outputFault = true;
          void worker.stop();
        }
      },
      getState: () => ({
        publishing: bytes > 0 && performance.now() - lastOutputAt < 2000,
      }),
    };
    worker = createProofWorker({
      identity: {
        eventId: "private-proof",
        sessionId: "private-proof",
        workerId: "private-proof",
        epoch: 0,
      },
      renderer,
      inputs,
      outputs,
      checkEnabled: async () => true,
      control: async (name) =>
        name === "acquireSession" || name === "renewSession"
          ? {
              granted: true,
              epoch: 1,
              serverNow: Date.now(),
              expiresAt: Date.now() + 30000,
              renewAfterMs: 10000,
              configuration,
            }
          : name === "refreshConfiguration"
            ? { granted: true, serverNow: Date.now(), configuration }
            : name === "claimCommands"
              ? { granted: true, commands: [] }
              : { accepted: true },
    });
    await worker.start();
    watchdog = setInterval(() => worker.watchdog(), 50);
    poll = setInterval(() => void worker.tick(), 100);
    const until = performance.now() + 30000;
    while (
      renderer.getInputs().length !== 2 ||
      renderer.getInputs().some((i) => !i.getObservation().ready) ||
      renderer.getState().renderedSourceId !== "source-0"
    ) {
      await sleep(100);
      if (worker.getState().stopped || performance.now() > until)
        throw Error("Public dual startup failed");
    }
    phase = "steady";
    let previous = await readCgroupCounters();
    const start = previous.at;
    receipt.steadyStartedAt = new Date().toISOString();
    receipt.startOutputMs = renderer.getState().outputMs;
    while (
      performance.now() - start < 1800000 ||
      renderer.getState().outputMs - receipt.startOutputMs < 1800000
    ) {
      await sleep(1000);
      const state = renderer.getState();
      assert(!worker.getState().stopped && !outputFault && !state.error);
      assert.equal(renderer.getInputs().length, 2);
      assert(renderer.getInputs().every((i) => i.getObservation().ready));
      assert.equal(losses, 0);
      const next = await readCgroupCounters();
      samples.push(resourceInterval(previous, next, cpuUnits));
      previous = next;
      if (samples.length % 30 === 0)
        await writeFile(
          `${outputDir}/samples.ndjson`,
          samples.map((s) => JSON.stringify(s)).join("\n") + "\n",
        );
    }
    receipt.steadyDurationMs = performance.now() - start;
    receipt.endOutputMs = renderer.getState().outputMs;
    assert(receipt.endOutputMs - receipt.startOutputMs >= 1800000);
    receipt.readinessLosses = losses;
    receipt.maxCompressedBufferBytes = bufferMax;
    assert(bufferMax > 0 && bufferMax <= 4194304);
    receipt.resources = {
      cpuP95Percent: quantile(
        samples.map((s) => s.cpuPercent),
        0.95,
      ),
      memoryPeakBytes: Math.max(...samples.map((s) => s.memoryBytes)),
      samples: samples.length,
      sampleCoverageMs: samples.reduce((n, s) => n + s.elapsedMs, 0),
    };
    phase = "cleanup";
    clearInterval(watchdog);
    clearInterval(poll);
    await worker.stop();
    stream.end();
    await closed;
    cleanup = await owner.close();
    phase = "verify";
    const verification = createProcessOwner();
    try {
      const media = await probe(verification, `${outputDir}/program.ts`);
      receipt.format = {
        durationSeconds: Number(media.format.duration),
        streams: media.streams.map((s) => ({
          codec: s.codec_name,
          width: s.width,
          height: s.height,
          fps: s.r_frame_rate,
          channels: s.channels,
          sampleRate: s.sample_rate,
        })),
      };
      receipt.packets = await packetFacts(
        verification,
        `${outputDir}/program.ts`,
      );
      assert(receipt.packets.maxGap < 0.2);
      assert(receipt.packets.maxGop <= 1.05);
    } finally {
      await verification.close();
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(`${outputDir}/program.ts`))
      hash.update(chunk);
    receipt.recording = {
      name: "program.ts",
      bytes: (await stat(`${outputDir}/program.ts`)).size,
      sha256: hash.digest("hex"),
      complete: true,
    };
    passed = true;
  } catch {
    receipt.failurePhase = phase;
    receipt.failureCode = "public_contract_failed";
  } finally {
    clearInterval(watchdog);
    clearInterval(poll);
    try {
      await worker?.stop();
      stream?.end();
      if (closed) await closed;
      cleanup = await owner.close();
    } catch {
      cleanup = { closed: false };
      passed = false;
    }
    Object.assign(receipt, {
      passed,
      terminal: true,
      cleanup,
      finishedAt: new Date().toISOString(),
      publicObservations: observations.snapshot(),
      forcedExpiryObserved: false,
      physicalPlaybackObserved: false,
    });
    await writeFile(
      `${outputDir}/receipt.json`,
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  if (!passed) throw Error("Private public-input proof failed");
}
