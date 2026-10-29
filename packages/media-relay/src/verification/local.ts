import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, request, type ServerResponse } from "node:http";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  stat,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";
import { type S3Client } from "@aws-sdk/client-s3";
import { createSourceRelay } from "../../../../workers/restream/source-relay.mjs";
import { createPackager } from "../worker/packager";
import { createRelayRegistry, type RelayControl } from "../worker/registry";
import { createAwsStorage } from "../providers/aws-storage";
import {
  type RenditionSnapshot,
  continuityAfter,
  parseSourceDescriptor,
} from "../contracts";
import type { ProofOptions } from "../../../../scripts/media-relay-proof";

async function disk(
  path: string,
  completed = new Set<string>(),
): Promise<{ total: number; partial: number; temporary: number }> {
  let total = 0,
    partial = 0,
    temporary = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((e) => e.name.endsWith(".m3u8"))) {
    const playlist = await readFile(join(path, entry.name), "utf8").catch(
      () => "",
    );
    for (const line of playlist.split(/\r?\n/))
      if (/^(video|audio)-[0-9]+\.ts$/.test(line))
        completed.add(join(path, line));
  }
  for (const entry of entries) {
    const p = join(path, entry.name);
    if (entry.isDirectory()) {
      const child = await disk(p, completed);
      total += child.total;
      partial += child.partial;
      temporary += child.temporary;
    } else {
      const size = (await stat(p).catch(() => null))?.size ?? 0;
      total += size;
      if (entry.name.endsWith(".tmp")) {
        partial += size;
        temporary += size;
      } else if (
        /^(video|audio)-[0-9]+\.ts$/.test(entry.name) &&
        !completed.has(p)
      )
        partial += size;
    }
  }
  return { total, partial, temporary };
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
  try {
    await closed;
  } finally {
    clearTimeout(kill);
  }
}
/** Local provider double below the production immutable-upload cache. No AWS SDK client or credentials exist. */
export async function runLocalProof(options: ProofOptions) {
  const started = Date.now(),
    abort = new AbortController();
  const failures: string[] = [],
    diagnostics: string[] = [];
  const interrupt = () => {
    failures.push("operator interrupted");
    abort.abort();
  };
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  const metrics = {
    maxActiveSources: 0,
    upstreamBytes: 0,
    videoBytes: 0,
    audioBytes: 0,
    cpuSeconds: 0,
    sampledProcessesPeak: 0,
    cpuPeakPercent: 0,
    memoryPeakBytes: 0,
    diskPeakBytes: 0,
    partialDiskPeakBytes: 0,
    tmpDiskPeakBytes: 0,
    queuePeak: 0,
    reconnects: 0,
    recoveredSources: 0,
    coldStartupMs: 0,
    warmStartupMs: 0,
    uploadCacheHits: 0,
    audienceRequests: 0,
    audienceReplayBytes: 0,
    storageOperations: { PUT: 0, HEAD: 0, GET: 0, LIST: 0, DELETE: 0 },
    uploadedBytes: 0,
    publicationCallbacks: 0,
  };
  const scratch = await mkdtemp(join(tmpdir(), "relay-proof-work-"));
  await mkdir(options.output, { recursive: true });
  const jobs = join(scratch, "jobs");
  await mkdir(jobs);
  const children = new Set<ChildProcess>(),
    responses = new Set<ServerResponse>(),
    objects = new Map<string, Buffer>();
  const snapshots = new Map<
    string,
    Partial<Record<"video" | "audio", RenditionSnapshot>>
  >();
  const firstReady = new Map<string, number>(),
    recovered = new Set<string>();
  const completedFiles = new Set<string>();
  const cpuByPid = new Map<number, number>();
  const putsByKey = new Map<string, number>();
  let rssPeak = 0,
    pending = 0,
    reconnectAt = 0,
    recoveredAt = 0,
    stopping = false,
    active = 0,
    sampling = false;
  const initialCpu = process.cpuUsage();
  const ticksPerSecond = Number(
    execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }),
  );
  const pageBytes = Number(
    execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }),
  );
  let previousCpu: number | undefined,
    previousSample = Date.now();
  const syntheticClient = {
    async send(command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) {
      const input = command.input,
        key = String(input.Key ?? "");
      switch (command.constructor.name) {
        case "PutObjectCommand": {
          metrics.storageOperations.PUT++;
          putsByKey.set(key, (putsByKey.get(key) ?? 0) + 1);
          const body = input.Body;
          const chunks: Buffer[] = [];
          if (typeof body === "string") chunks.push(Buffer.from(body));
          else
            for await (const chunk of body as Readable)
              chunks.push(Buffer.from(chunk));
          const data = Buffer.concat(chunks);
          objects.set(key, data);
          metrics.uploadedBytes += data.length;
          return {};
        }
        case "GetObjectCommand":
          metrics.storageOperations.GET++;
          return {
            Body: {
              transformToWebStream: () =>
                new ReadableStream({
                  start(c) {
                    c.enqueue(objects.get(key) ?? Buffer.alloc(0));
                    c.close();
                  },
                }),
            },
          };
        case "ListObjectsV2Command":
          metrics.storageOperations.LIST++;
          return { Contents: [] };
        default:
          throw Error("Unexpected local storage operation");
      }
    },
  } as unknown as S3Client;
  const stored = createAwsStorage(syntheticClient, "local-synthetic");
  const storage = {
    ...stored,
    async putSegment(args: Parameters<typeof stored.putSegment>[0]) {
      const before = putsByKey.get(args.objectKey) ?? 0;
      pending++;
      metrics.queuePeak = Math.max(
        metrics.queuePeak,
        registry?.diagnostics().pendingPublications ?? pending,
      );
      try {
        await stored.putSegment(args);
        if ((putsByKey.get(args.objectKey) ?? 0) === before)
          metrics.uploadCacheHits++;
      } finally {
        pending--;
      }
    },
  };
  let audienceOrigin = "";
  const provider = createServer((_req, res) => {
    if (_req.url?.startsWith("/media/")) {
      const object = objects.get(decodeURIComponent(_req.url.slice(7)));
      if (!object) {
        res.writeHead(404).end();
        return;
      }
      metrics.audienceRequests++;
      res.writeHead(200, { "Content-Type": "video/mp2t" }).end(object);
      return;
    }

    active++;
    metrics.maxActiveSources = Math.max(metrics.maxActiveSources, active);
    responses.add(res);
    const source = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=25",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        String(options.duration + 10),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-threads",
        "1",
        "-b:v",
        String(options.bitrate),
        "-minrate",
        String(options.bitrate),
        "-maxrate",
        String(options.bitrate),
        "-bufsize",
        String(options.bitrate * 2),
        "-x264-params",
        "nal-hrd=cbr:force-cfr=1",
        "-g",
        String(options.keyframe * 25),
        "-bf",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-frag_duration",
        "200000",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(source);
    res.writeHead(200, { "Content-Type": "video/mp4" });
    source.stdout?.on("data", (chunk: Buffer) => {
      metrics.upstreamBytes += chunk.length;
    });
    source.stdout?.pipe(res);
    source.stderr?.on("data", (chunk: Buffer) => {
      if (diagnostics.length < 200)
        diagnostics.push(chunk.toString().slice(0, 4096));
    });
    source.on("error", () => {
      failures.push("synthetic source failed");
      res.destroy();
    });
    res.once("close", () => {
      active--;
      responses.delete(res);
      void stopChild(source);
    });
  });
  let registry: ReturnType<typeof createRelayRegistry> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const bytes = await disk(jobs, completedFiles);
      metrics.tmpDiskPeakBytes = Math.max(
        metrics.tmpDiskPeakBytes,
        bytes.temporary,
      );
      metrics.diskPeakBytes = Math.max(metrics.diskPeakBytes, bytes.total);
      metrics.partialDiskPeakBytes = Math.max(
        metrics.partialDiskPeakBytes,
        bytes.partial,
      );
      // Owned descendant totals include synthetic encoders; deliberately conservative, not an isolated worker allocation.
      const todo = [
          process.pid,
          ...[...children].flatMap((child) => (child.pid ? [child.pid] : [])),
        ],
        seen = new Set<number>();
      let rss = 0,
        sampledProcesses = 0;
      while (todo.length) {
        const pid = todo.pop()!;
        if (seen.has(pid)) continue;
        seen.add(pid);
        try {
          const text = await readFile(`/proc/${pid}/stat`, "utf8");
          sampledProcesses++;
          const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
          const ticks = Number(fields[11]) + Number(fields[12]);
          cpuByPid.set(
            pid,
            Math.max(cpuByPid.get(pid) ?? 0, ticks / ticksPerSecond),
          );
          rss += Number(fields[21]) * pageBytes;
          for (const thread of await readdir(`/proc/${pid}/task`)) {
            const descendants = await readFile(
              `/proc/${pid}/task/${thread}/children`,
              "utf8",
            ).catch(() => "");
            todo.push(
              ...descendants.trim().split(/\s+/).filter(Boolean).map(Number),
            );
          }
        } catch {
          /* exited between bounded samples */
        }
      }
      metrics.sampledProcessesPeak = Math.max(
        metrics.sampledProcessesPeak,
        sampledProcesses,
      );
      rssPeak = Math.max(rssPeak, rss);
      const cpu = [...cpuByPid.values()].reduce((a, b) => a + b, 0),
        now = Date.now();
      if (previousCpu !== undefined && now > previousSample)
        metrics.cpuPeakPercent = Math.max(
          metrics.cpuPeakPercent,
          ((cpu - previousCpu) / (now - previousSample)) * 100000,
        );
      previousCpu = cpu;
      previousSample = now;
    } finally {
      sampling = false;
    }
  };
  const sources = Array.from({ length: options.sources }, (_, i) =>
    parseSourceDescriptor({
      streamKey: `vrcdn/Proof${i}/1` as const,
      streamId: `Proof${i}`,
      inputFormat: "vrcdn_fmp4" as const,
      packagingVersion: 1 as const,
    }),
  );
  const control: RelayControl = {
    async list() {
      return sources.map((source) => ({
        source,
        state: "queued",
        admissionRevision: 1,
      }));
    },
    async claim(source) {
      return {
        streamKey: source.streamKey,
        workerId: "local-proof",
        epoch: 1,
        serverNow: Date.now(),
        expiresAt: Date.now() + 30000,
        renewAfterMs: 10000,
      };
    },
    async renew(lease) {
      return { ...lease, serverNow: Date.now(), expiresAt: Date.now() + 30000 };
    },
    async read(lease) {
      const prior = snapshots.get(lease.streamKey);
      return {
        recoveryStartedAt: started,
        ...(prior?.video && prior?.audio
          ? {
              continuity: {
                video: continuityAfter(prior.video),
                audio: continuityAfter(prior.audio),
              },
            }
          : {}),
      };
    },
    async observe() {},
    async register() {},
    async commitSnapshot({ snapshot, objectKey, signal, isCurrent }) {
      signal.throwIfAborted();
      if (!isCurrent()) throw Error("Fenced");
      metrics.publicationCallbacks++;
      // Exercise the actual storage read/parse boundary once per published snapshot.
      await stored.readSnapshot({ objectKey, signal });
      const prior = snapshots.get(snapshot.streamKey) ?? {};
      prior[snapshot.rendition] = snapshot;
      snapshots.set(snapshot.streamKey, prior);
      for (const segment of snapshot.segments) {
        const key = segment.objectKey;
        if (!delivered.has(key)) {
          delivered.add(key);
          const response = await fetch(
            `${audienceOrigin}/media/${encodeURIComponent(key)}`,
            { signal },
          );
          if (!response.ok) throw Error("Local audience read failed");
          const bytes = (await response.arrayBuffer()).byteLength;
          metrics[
            snapshot.rendition === "video" ? "videoBytes" : "audioBytes"
          ] += bytes;
          const replay = await fetch(
            `${audienceOrigin}/media/${encodeURIComponent(key)}`,
            { signal },
          );
          if (!replay.ok) throw Error("Local replay failed");
          metrics.audienceReplayBytes += (
            await replay.arrayBuffer()
          ).byteLength;
        }
      }
      if (prior.video && prior.audio) {
        if (!firstReady.has(snapshot.streamKey))
          firstReady.set(snapshot.streamKey, Date.now());
        if (
          reconnectAt &&
          prior.video.generatedAt >= reconnectAt &&
          prior.audio.generatedAt >= reconnectAt &&
          prior.video.segments.some((s) => s.discontinuity) &&
          prior.audio.segments.some((s) => s.discontinuity)
        ) {
          recovered.add(snapshot.streamKey);
          if (recovered.size === options.sources && !recoveredAt)
            recoveredAt = Date.now();
        }
      }
    },
  };
  const delivered = new Set<string>();
  try {
    deadline = setTimeout(() => {
      failures.push("deadline exceeded");
      abort.abort();
    }, options.deadline * 1000);
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string")
      throw Error("Local listener unavailable");
    audienceOrigin = `http://127.0.0.1:${address.port}`;
    const packager = createPackager({
      createRelay: () =>
        createSourceRelay({
          inputFormat: "vrcdn_fmp4",
          resolveAddresses: (async () => [
            { address: "93.184.216.34", family: 4 },
          ]) as unknown as NonNullable<
            Parameters<typeof createSourceRelay>[0]
          >["resolveAddresses"],
          requestSource: ((
            _url: URL,
            _options: unknown,
            callback: Parameters<typeof request>[1],
          ) =>
            request(
              `http://127.0.0.1:${address.port}`,
              callback as never,
            )) as typeof request,
        }),
    });
    registry = createRelayRegistry({
      control,
      storage,
      binding: {
        workerId: "local-proof",
        workerEpoch: 1,
        allocation: {
          cpuUnits: 1024,
          memoryMiB: 2048,
          evidenceId: "local-synthetic-only",
        },
        maxSources: options.sources,
        draining: false,
      },
      directory: jobs,
      demand: {
        async read() {
          return {
            healthy: true,
            activity: sources.map((s) => ({
              streamKey: s.streamKey,
              lastActivityAt: Date.now(),
            })),
          };
        },
      },
      packager: async (args) =>
        packager({
          ...args,
          onFailure(failure) {
            if (
              failure.kind === "timestamp" ||
              failure.kind === "unsupported"
            ) {
              failures.push(failure.kind);
              diagnostics.push(failure.message);
            }
            args.onFailure(failure);
          },
        }),
      metrics(event) {
        if (
          (event.kind === "terminal" && !stopping) ||
          event.kind === "cleanup_timeout"
        )
          failures.push(event.kind);
      },
    });
    timer = setInterval(() => {
      registry?.reconcile();
      void sample();
    }, 50);
    registry.reconcile();
    while (
      !abort.signal.aborted &&
      Date.now() - started < options.duration * 1000
    ) {
      if (
        !reconnectAt &&
        firstReady.size === options.sources &&
        Date.now() - started >= (options.duration * 1000) / 2
      ) {
        reconnectAt = Date.now();
        metrics.reconnects = responses.size;
        for (const response of responses) response.destroy();
      }
      await delay(50);
    }
    metrics.coldStartupMs =
      firstReady.size === options.sources
        ? Math.max(...firstReady.values()) - started
        : 0;
    metrics.warmStartupMs =
      reconnectAt && recovered.size === options.sources
        ? recoveredAt - reconnectAt
        : 0;
    metrics.recoveredSources = recovered.size;
    if (firstReady.size !== options.sources)
      failures.push("not all sources became ready");
    if (recovered.size !== options.sources)
      failures.push("reconnect recovery unproven");
  } catch (error) {
    failures.push(
      error instanceof Error ? error.message : "local proof failed",
    );
  } finally {
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    stopping = true;
    await registry?.stop();
    for (const response of responses) response.destroy();
    await Promise.all([...children].map(stopChild));
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await sample();
    while (sampling) await delay(10);
  }
  metrics.cpuSeconds =
    Object.entries(process.cpuUsage(initialCpu)).reduce(
      (n, [, v]) => n + v,
      0,
    ) /
      1e6 +
    [...cpuByPid]
      .filter(([pid]) => pid !== process.pid)
      .reduce((n, [, v]) => n + v, 0);
  metrics.memoryPeakBytes = rssPeak;
  if (
    diagnostics.some((line) => /timestamp|non.monoton|DTS.*order/i.test(line))
  )
    failures.push("timestamp diagnostics require investigation");
  const remaining = await disk(jobs);
  const descendantAlive = await Promise.all(
    [...cpuByPid.keys()]
      .filter((pid) => pid !== process.pid)
      .map(async (pid) => {
        try {
          process.kill(pid, 0);
          return 1;
        } catch {
          return 0;
        }
      }),
  );
  const childrenAlive = Math.max(
    [...children].filter((c) => c.exitCode === null && c.signalCode === null)
      .length,
    descendantAlive.reduce<number>((a, b) => a + b, 0),
  );
  if (remaining.total || childrenAlive) failures.push("cleanup incomplete");
  const evidence = {
    version: 1,
    target: "local" as const,
    releaseEligible: false,
    partialDiskBoundVerified: false,
    providerCalls: 0,
    measurement: {
      ticksPerSecond,
      pageBytes,
      scope: "owned process tree including source generators",
    },
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    options,
    metrics,
    cleanup: { childrenAlive, scratchBytes: remaining.total },
    failures: [...new Set(failures)],
    diagnostics,
    limitations: [
      "Synthetic loopback, no AWS/provider/billing calls. Storage operation counts are local adapter transport calls, not billed operations.",
      "CPU and RSS cover proof process and descendants, including source generators; Kernel tick/page sizes obtained with getconf. No isolated Fargate capacity conclusion.",
      "Disk peaks are sampled; partial includes .tmp and segments not yet observed in a completed playlist. No enforced partial-disk quota: hosted release blocked.",
      "Transfer counts measure loopback HTTP payload bytes for one synthetic audience per rendition plus separate replay bytes, not CDN traffic.",
      "Hosted transport, remote throttling, native playlist cadence, phone behavior and strict CDN traffic ceilings remain unproven.",
    ],
  };
  process.removeListener("SIGTERM", interrupt);
  process.removeListener("SIGINT", interrupt);
  await rm(scratch, { recursive: true, force: true });
  await writeFile(
    join(options.output, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  return evidence;
}
