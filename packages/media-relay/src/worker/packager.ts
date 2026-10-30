import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  createSourceRelay,
  type SourceRelay,
  type RelayInput,
} from "../../../../workers/restream/source-relay.mjs";
import {
  parseSourceDescriptor,
  RenditionSnapshotSchema,
  PackagerContinuitySchema,
  type SourceDescriptor,
  type PlaybackMode,
  type Segment,
  type RenditionSnapshot,
} from "../contracts";
import { RELAY_POLICY } from "../policy";

export type PackagerFailure = {
  kind: "unsupported" | "source" | "packaging" | "timestamp";
  message: string;
};
/** Count discontinuities before the first new segment; do NOT include its restart marker. */
export type PackagerContinuity = Record<
  PlaybackMode,
  { nextSequence: number; discontinuitySequence: number }
>;
export type PackagerOptions = {
  source: SourceDescriptor;
  epoch: number;
  directory: string;
  signal: AbortSignal;
  continuity?: PackagerContinuity;
  /** Honour signal and fence durable publication against the owning lease. */
  onSnapshot(
    snapshot: RenditionSnapshot,
    signal: AbortSignal,
  ): void | Promise<void>;
  onFailure(failure: PackagerFailure): void;
};
const modes = ["video", "audio"] as const;
const probeSchema = z.object({
  streams: z.array(
    z.object({ codec_name: z.string(), codec_type: z.string() }),
  ),
});
class PackagingError extends Error {
  constructor(readonly failure: PackagerFailure) {
    super(failure.message);
  }
}
const failWith = (kind: PackagerFailure["kind"], message: string) =>
  new PackagingError({ kind, message });

/** TERM first, then KILL only this child. Always reap before releasing the acquisition. */
async function terminate(
  child: ChildProcess | undefined,
  exited: Promise<void> | undefined,
) {
  if (!child || !exited) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited;
    return;
  }
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

function readPlaylist(
  text: string,
  rendition: PlaybackMode,
  prefix: string,
  continuity: PackagerContinuity[PlaybackMode],
  restarted: boolean,
): Segment[] {
  let duration: number | undefined, date: number | undefined;
  const segments: Segment[] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    if (line.startsWith("#EXTINF:"))
      duration = Number(line.slice(8).split(",")[0]);
    else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
      date = Date.parse(line.slice(25));
    else if (line && !line.startsWith("#")) {
      const match = new RegExp(`^${rendition}-(\\d+)\\.ts$`).exec(line);
      if (
        !match ||
        duration === undefined ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        date === undefined ||
        !Number.isFinite(date)
      )
        throw failWith("packaging", "Invalid completed segment metadata");
      const sequence = Number(match[1]);
      if (!Number.isSafeInteger(sequence) || sequence < continuity.nextSequence)
        throw failWith("packaging", "Invalid media sequence");
      segments.push({
        sequence,
        objectKey: `${prefix}/${line}`,
        durationSeconds: duration,
        programDateTime: date,
        discontinuity: restarted && sequence === continuity.nextSequence,
      });
      duration = undefined;
      date = undefined;
    }
  }
  return segments;
}

/** One attempt, one guarded upstream and one copy-only FFmpeg input. Recovery belongs to the registry. */
export function createPackager({
  createRelay = () => createSourceRelay({ inputFormat: "vrcdn_fmp4" }),
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
}: {
  createRelay?: () => Promise<SourceRelay>;
  ffmpegPath?: string;
  ffprobePath?: string;
} = {}) {
  return async function start(
    options: PackagerOptions,
  ): Promise<{ stop(): Promise<void> }> {
    const source = parseSourceDescriptor(options.source);
    if (!Number.isSafeInteger(options.epoch) || options.epoch <= 0)
      throw Error("Invalid source epoch");
    const continuity = options.continuity ?? {
      video: { nextSequence: 0, discontinuitySequence: 0 },
      audio: { nextSequence: 0, discontinuitySequence: 0 },
    };
    if (!PackagerContinuitySchema.safeParse(continuity).success)
      throw Error("Invalid packager continuity");
    if (options.signal.aborted) throw options.signal.reason ?? Error("Aborted");
    await mkdir(options.directory, { recursive: true });
    const directory = await mkdtemp(
      join(options.directory, `attempt-${options.epoch}-`),
    );
    const prefix = basename(directory);
    const abort = new AbortController();
    let relay: SourceRelay | undefined,
      input: RelayInput | undefined,
      child: ChildProcess | undefined,
      exited: Promise<void> | undefined;
    let stopped = false,
      stopPromise: Promise<void> | undefined,
      scanTask = Promise.resolve(),
      failureSent = false;
    let diagnostics = "",
      codecsChecked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lastSequence = { video: -1, audio: -1 },
      targetDuration = { video: 1, audio: 1 };
    const stop = () => {
      if (stopPromise) return stopPromise;
      stopped = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      stopPromise = Promise.resolve().then(async () => {
        await terminate(child, exited);
        await input?.dispose();
        relay?.stop();
        await scanTask;
        await rm(directory, { recursive: true, force: true });
      });
      abort.abort();
      return stopPromise;
    };
    const onAbort = () => {
      // The returned stop promise still rejects for registry quarantine.
      void stop().catch(() => {});
    };
    const fail = (failure: PackagerFailure) => {
      if (stopped || failureSent) return;
      failureSent = true;
      // Deliver failure on either teardown outcome. Handling this detached chain
      // must not convert stopPromise into successful physical cleanup.
      void stop().then(
        () => options.onFailure(failure),
        () => options.onFailure(failure),
      ).catch(() => { /* A consumer callback cannot kill the shared worker. */ });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    const probe = (path: string): Promise<z.infer<typeof probeSchema>> =>
      new Promise((resolve, reject) => {
        let result: z.infer<typeof probeSchema> | PackagingError = failWith(
          "packaging",
          "Cannot inspect completed media",
        );
        const inspector = execFile(
          ffprobePath,
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type",
            "-of",
            "json",
            path,
          ],
          {
            timeout: 5000,
            killSignal: "SIGKILL",
            maxBuffer: 65536,
            signal: abort.signal,
          },
          (error, stdout) => {
            if (error) return;
            try {
              result = probeSchema.parse(JSON.parse(stdout));
            } catch {
              result = failWith("packaging", "Invalid media inspection result");
            }
          },
        );
        // Abort callbacks can fire before OS process close. Reap before scan/stop resolves.
        inspector.once("close", () => {
          if (result instanceof PackagingError) reject(result);
          else resolve(result);
        });
      });
    const scan = async () => {
      const snapshots: RenditionSnapshot[] = [];
      for (const rendition of modes) {
        let text: string;
        try {
          text = await readFile(join(directory, `${rendition}.m3u8`), "utf8");
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return;
          throw error;
        }
        const segments = readPlaylist(
          text,
          rendition,
          prefix,
          continuity[rendition],
          options.continuity !== undefined,
        );
        const first = segments[0];
        if (!first) return;
        for (const segment of segments)
          if (
            !(await stat(join(options.directory, segment.objectKey))).isFile()
          )
            throw failWith("packaging", "Completed segment is missing");
        targetDuration[rendition] = Math.max(
          targetDuration[rendition],
          ...segments.map((s) => Math.ceil(s.durationSeconds)),
        );
        snapshots.push(
          RenditionSnapshotSchema.parse({
            streamKey: source.streamKey,
            epoch: options.epoch,
            rendition,
            targetDurationSeconds: targetDuration[rendition],
            sequence: first.sequence,
            discontinuitySequence:
              continuity[rendition].discontinuitySequence +
              (options.continuity &&
              first.sequence > continuity[rendition].nextSequence
                ? 1
                : 0),
            generatedAt: Date.now(),
            segments,
          }),
        );
      }
      if (!codecsChecked) {
        for (const snapshot of snapshots) {
          const first = snapshot.segments[0];
          if (!first) return;
          const { streams } = await probe(
            join(options.directory, first.objectKey),
          );
          const audio = streams.filter((s) => s.codec_type === "audio"),
            video = streams.filter((s) => s.codec_type === "video");
          if (
            audio.length !== 1 ||
            audio[0]?.codec_name !== "aac" ||
            (snapshot.rendition === "video"
              ? video.length !== 1 || video[0]?.codec_name !== "h264"
              : video.length !== 0)
          )
            throw failWith(
              "unsupported",
              "Source requires H.264 video and AAC audio",
            );
        }
        codecsChecked = true;
      }
      for (const snapshot of snapshots) {
        if (stopped) return;
        const last = snapshot.segments.at(-1);
        if (!last || last.sequence <= lastSequence[snapshot.rendition])
          continue;
        // External upload work may stall. Cancellation fences this attempt and
        // detaches its callback; the publisher must honour this signal and lease.
        let cancel: (() => void) | undefined;
        const cancelled = new Promise<void>((resolve) => {
          abort.signal.addEventListener("abort", resolveAbort, { once: true });
          function resolveAbort() {
            resolve();
          }
          cancel = () => {
            abort.signal.removeEventListener("abort", resolveAbort);
          };
        });
        try {
          await Promise.race([
            Promise.resolve(options.onSnapshot(snapshot, abort.signal)),
            cancelled,
          ]);
        } finally {
          cancel?.();
        }
        if (stopped) return;
        lastSequence[snapshot.rendition] = last.sequence;
        // Published objects are immutable. Delete only older completed files from this attempt.
        for (const name of await readdir(directory)) {
          const match = new RegExp(`^${snapshot.rendition}-(\\d+)\\.ts$`).exec(
            name,
          );
          if (match && Number(match[1]) < snapshot.sequence)
            await rm(join(directory, name));
        }
      }
    };
    const tick = () => {
      if (stopped) return;
      scanTask = scan().catch((error) => {
        if (!stopped)
          fail(
            error instanceof PackagingError
              ? error.failure
              : { kind: "packaging", message: "Media publication failed" },
          );
      });
      void scanTask.then(() => {
        if (!stopped) timer = setTimeout(tick, 100);
      });
    };
    try {
      relay = await createRelay();
      if (stopped || options.signal.aborted) {
        relay.stop();
        await stop();
        return { stop };
      }
      input = relay.createInput({
        source: {
          id: source.streamKey,
          revision: options.epoch,
          type: "vrcdn_link",
          publicUrl: `https://stream.vrcdn.live/live/${source.streamId}.live.mp4`,
        },
        signal: abort.signal,
      });
      const { url } = await input.transportReady;
      if (stopped || options.signal.aborted) {
        await input.dispose();
        relay.stop();
        await stop();
        return { stop };
      }
      const args = [
        "-hide_banner",
        "-nostdin",
        "-copyts",
        "-start_at_zero",
        "-analyzeduration",
        "1000000",
        "-probesize",
        "1000000",
        "-protocol_whitelist",
        "http,tcp",
        "-f",
        "mp4",
        "-enable_drefs",
        "0",
        "-i",
        url,
      ];
      for (const rendition of modes) {
        args.push(
          ...(rendition === "video"
            ? ["-map", "0:v:0", "-map", "0:a:0"]
            : ["-map", "0:a:0", "-vn"]),
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          "-f",
          "hls",
          "-hls_time",
          String(RELAY_POLICY.targetSegmentDurationSeconds),
          "-hls_list_size",
          String(RELAY_POLICY.rollingWindowSegments),
          "-hls_flags",
          "temp_file+program_date_time",
          "-start_number",
          String(continuity[rendition].nextSequence),
          "-hls_segment_filename",
          join(directory, `${rendition}-%d.ts`),
          join(directory, `${rendition}.m3u8`),
        );
      }
      child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      exited = new Promise((resolve) => {
        child?.once("close", () => resolve());
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-16384);
        if (
          /Non-monoton(?:ous|ic)|non monotonically increasing|invalid DTS|DTS .* out of order|timestamp discontinuity/i.test(
            diagnostics,
          )
        )
          fail({
            kind: "timestamp",
            message: "Source timestamps are not monotonic",
          });
        const video = /Stream #0:\d+[^\n]*Video: ([a-zA-Z0-9_]+)/.exec(
          diagnostics,
        )?.[1];
        const audio = /Stream #0:\d+[^\n]*Audio: ([a-zA-Z0-9_]+)/.exec(
          diagnostics,
        )?.[1];
        if (
          (video && video !== "h264") ||
          (audio && audio !== "aac") ||
          /matches no streams/.test(diagnostics)
        )
          fail({
            kind: "unsupported",
            message: "Source requires H.264 video and AAC audio",
          });
      });
      child.once("error", () =>
        fail({ kind: "packaging", message: "Cannot start media packager" }),
      );
      child.once("close", () => {
        if (!stopped)
          fail({ kind: "source", message: "Source acquisition ended" });
      });
      tick();
    } catch {
      fail({ kind: "source", message: "Cannot acquire source" });
    }
    return { stop };
  };
}
export const startPackager = createPackager();
