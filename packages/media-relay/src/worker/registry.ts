import { join } from "node:path";
import { z } from "zod";
import {
  createResourceSampler,
  readCgroupCounters,
} from "../../../../workers/restream/resource-sampler.mjs";
import {
  SourceDescriptorSchema,
  SourceStateSchema,
  PackagerContinuitySchema,
  OwnershipLeaseSchema,
  WorkerObservationSchema,
  continuityAfter,
  type SourceDescriptor,
  type OwnershipLease,
  type SourceState,
  type SourceTerminalReason,
  type StreamKey,
  type WorkerObservation,
  type RenditionSnapshot,
  type RelayContinuity,
} from "../contracts";
import { RELAY_POLICY, isSnapshotFresh, areRenditionsPlayable } from "../policy";
import { WorkerBindingSchema, type WorkerBinding } from "./deployment";
import { createLeaseWatchdog } from "./lease";
import { startPackager, type PackagerOptions } from "./packager";
import {
  createPublisher,
  type RelayStorage,
  type PublicationCommit,
} from "./publisher";
const sessionSchema = z.strictObject({
  recoveryStartedAt: z.number().finite().nonnegative(),
  progressAt: z.number().finite().nonnegative().optional(),
  continuity: PackagerContinuitySchema.optional(),
});
const discoverySchema = z
  .array(
    z.strictObject({
      source: SourceDescriptorSchema,
      state: SourceStateSchema,
      admissionRevision: z.number().int().nonnegative(),
    }),
  )
  .max(1000);
const demandSchema = z.strictObject({
  healthy: z.boolean(),
  activity: z
    .array(
      z.strictObject({
        streamKey: SourceDescriptorSchema.shape.streamKey,
        lastActivityAt: z.number().finite().nonnegative(),
      }),
    )
    .max(1000),
});
export type RelayControl = {
  list(signal: AbortSignal): Promise<z.infer<typeof discoverySchema>>;
  claim(source: SourceDescriptor, signal: AbortSignal): Promise<OwnershipLease>;
  renew(lease: OwnershipLease, signal: AbortSignal): Promise<OwnershipLease>;
  read(
    lease: OwnershipLease,
    signal: AbortSignal,
  ): Promise<z.infer<typeof sessionSchema>>;
  observe(args: {
    lease: OwnershipLease;
    state: SourceState;
    terminalReason?: SourceTerminalReason;
    progressAt: number;
    signal: AbortSignal;
  }): Promise<void>;
  register(observation: WorkerObservation, signal: AbortSignal): Promise<void>;
  commitSnapshot: PublicationCommit;
};
export type RegistryOptions = {
  control: RelayControl;
  storage: RelayStorage;
  binding: WorkerBinding;
  directory: string;
  demand: {
    read(args: {
      streamKeys: StreamKey[];
      signal: AbortSignal;
    }): Promise<z.infer<typeof demandSchema>>;
  };
  clock?: { monotonic: () => number; wall: () => number };
  limits?: {
    operationTimeoutMs?: number;
    retryDelayMs?: number;
    maxAttempts?: number;
    cleanupTimeoutMs?: number;
  };
  metrics?: (event: {
    kind: "failure" | "terminal" | "cleanup_timeout";
    streamKey?: StreamKey;
  }) => void;
  packager?: (options: PackagerOptions) => Promise<{ stop(): Promise<void> }>;
  readCounters?: () => Promise<{
    cpuUsageNs?: number;
    memoryUsedBytes?: number;
  }>;
};
type Attempt = {
  abort: AbortController;
  handle: Promise<{ stop(): Promise<void> }>;
  cleanup?: Promise<void>;
  snapshots: Partial<Record<"video" | "audio", RenditionSnapshot>>;
};
type Job = {
  source: SourceDescriptor;
  admissionRevision: number;
  state: SourceState;
  terminalReason?: SourceTerminalReason;
  lease?: OwnershipLease;
  watchdog: ReturnType<typeof createLeaseWatchdog>;
  publisher: ReturnType<typeof createPublisher>;
  abort: AbortController;
  attempt?: Attempt;
  continuity?: RelayContinuity;
  progressAt: number;
  progressMono: number;
  lastDemand: number;
  retryAt: number;
  attempts: number;
  renewAt: number;
  observed: string;
  terminalAcknowledged: boolean;
  renew: ReturnType<typeof slot>;
  observe: ReturnType<typeof slot>;
  initialize: ReturnType<typeof slot>;
};
/** A cancelled operation keeps its physical slot occupied. No accumulating detached retries. */
function slot(root: AbortSignal, timeoutMs: number) {
  let busy = false;
  const run = <T>(
    work: (signal: AbortSignal) => Promise<T>,
    success: (value: T) => void,
    failure: () => void = () => {},
  ) => {
    if (busy || root.aborted) return;
    busy = true;
    const abort = new AbortController();
    let finished = false;
    const cancel = () => {
      clearTimeout(timer);
      abort.abort();
      if (!finished) {
        finished = true;
        failure();
      }
    };
    root.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    // Physical settlement precedes consumers: discovery must not see a settled
    // observation as busy merely because a later finally microtask has not run.
    const release = () => {
      busy = false;
      clearTimeout(timer);
      root.removeEventListener("abort", cancel);
    };
    void Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        return work(abort.signal);
      })
      .then(
        (value) => {
          release();
          if (!finished && !abort.signal.aborted) {
            finished = true;
            success(value);
          }
        },
        () => {
          release();
          if (!finished) {
            finished = true;
            failure();
          }
        },
      )
      .catch(() => {
        failure();
      });
  };
  return Object.assign(run, { isIdle: () => !busy });
}
export function createRelayRegistry(options: RegistryOptions) {
  const { control, storage, demand, directory } = options;
  const binding = WorkerBindingSchema.parse(options.binding);
  const clock = options.clock ?? {
    monotonic: () => performance.now(),
    wall: () => Date.now(),
  };
  const limits = {
    operationTimeoutMs: 5000,
    retryDelayMs: 1000,
    maxAttempts: 8,
    cleanupTimeoutMs: 3000,
    ...options.limits,
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw Error("Invalid registry limit");
  const packager = options.packager ?? startPackager;
  const root = new AbortController(),
    jobs = new Map<StreamKey, Job>();
  const sampler = createResourceSampler({
    allocation: binding.allocation,
    readCounters: options.readCounters ?? readCgroupCounters,
    clock: clock.monotonic,
  });
  const register = slot(root.signal, limits.operationTimeoutMs),
    discover = slot(root.signal, limits.operationTimeoutMs),
    readDemand = slot(root.signal, limits.operationTimeoutMs),
    retire = slot(root.signal, limits.operationTimeoutMs);
  let stopped = false,
    draining = binding.draining,
    registered = false,
    healthyAt = -Infinity,
    nextPoll = 0,
    nextRetire = 0,
    stopPromise: Promise<void> | undefined;
  const metric = (
    kind: "failure" | "terminal" | "cleanup_timeout",
    streamKey?: StreamKey,
  ) => {
    try {
      options.metrics?.({ kind, streamKey });
    } catch {
      /* Telemetry never owns authority. */
    }
  };
  function cleanup(job: Job) {
    const attempt = job.attempt;
    if (!attempt) return Promise.resolve();
    attempt.abort.abort();
    if (!attempt.cleanup)
      attempt.cleanup = attempt.handle
        .then((h) => h.stop())
        .then(
          () => {
            if (job.attempt === attempt) job.attempt = undefined;
          },
          () => {
            terminal(job, "unavailable");
            metric("cleanup_timeout", job.source.streamKey);
          },
        );
    return attempt.cleanup;
  }
  function terminal(
    job: Job,
    state: "stopped" | "unavailable",
    reason: SourceTerminalReason = "unavailable",
  ) {
    if (job.state === "stopped" || job.state === "unavailable") return;
    job.state = state;
    if (state === "unavailable") job.terminalReason = reason;
    if (!job.lease) job.terminalAcknowledged = true;
    job.abort.abort();
    job.watchdog.stop();
    void cleanup(job);
    metric("terminal", job.source.streamKey);
  }
  function recover(job: Job) {
    if (job.state === "unavailable" || job.state === "stopped") return;
    job.state = "recovering";
    job.retryAt = clock.monotonic() + limits.retryDelayMs;
    void cleanup(job);
    metric("failure", job.source.streamKey);
  }
  function start(job: Job) {
    const lease = job.lease;
    if (
      !lease ||
      job.attempt ||
      !job.watchdog.check() ||
      job.abort.signal.aborted
    )
      return;
    if (job.attempts >= limits.maxAttempts) {
      terminal(job, "unavailable");
      return;
    }
    job.attempts++;
    const abort = new AbortController();
    // Schedule setup after installing the attempt, including synchronously failing adapters.
    const attempt: Attempt = {
      abort,
      snapshots: {},
      handle: Promise.resolve().then(() =>
        packager({
          source: job.source,
          epoch: lease.epoch,
          directory: join(directory, job.source.streamId),
          signal: abort.signal,
          ...(job.continuity
            ? { continuity: structuredClone(job.continuity) }
            : {}),
          async onSnapshot(snapshot, signal) {
            if (
              job.attempt !== attempt ||
              abort.signal.aborted ||
              !job.watchdog.check()
            )
              throw Error("Attempt fenced");
            const after = continuityAfter(snapshot);
            job.continuity ??= {
              video: { nextSequence: 0, discontinuitySequence: 0 },
              audio: { nextSequence: 0, discontinuitySequence: 0 },
            };
            job.continuity[snapshot.rendition] = after;
            await job.publisher.publishSnapshot({
              lease,
              snapshot,
              segments: { directory: join(directory, job.source.streamId) },
              signal,
            });
            if (
              job.attempt !== attempt ||
              abort.signal.aborted ||
              !job.watchdog.check()
            )
              throw Error("Attempt fenced");
            if (!isSnapshotFresh(snapshot, clock.wall()))
              throw Error("Stale output");
            attempt.snapshots[snapshot.rendition] = snapshot;
            const { video, audio } = attempt.snapshots;
            if (video && audio && areRenditionsPlayable(attempt.snapshots, clock.wall(), lease.epoch)) {
              job.progressAt = Math.min(video.generatedAt, audio.generatedAt);
              job.progressMono =
                clock.monotonic() - Math.max(0, clock.wall() - job.progressAt);
              job.state = "ready";
              job.attempts = 0;
            }
          },
          onFailure(failure) {
            if (job.attempt !== attempt || abort.signal.aborted) return;
            if (failure.kind === "unsupported")
              terminal(job, "unavailable", "unsupported");
            else recover(job);
          },
        }),
      ),
    };
    job.attempt = attempt;
    void attempt.handle.catch(() => {
      if (job.attempt === attempt && !abort.signal.aborted) recover(job);
    });
  }
  function admit(source: SourceDescriptor, admissionRevision: number) {
    if (
      stopped ||
      draining ||
      jobs.has(source.streamKey) ||
      jobs.size >= binding.maxSources
    )
      return;
    const now = clock.monotonic(),
      abort = new AbortController();
    const job: Job = {
      source,
      admissionRevision,
      state: "queued",
      abort,
      progressAt: 0,
      progressMono: now,
      lastDemand: now,
      retryAt: now,
      attempts: 0,
      renewAt: Infinity,
      observed: "",
      terminalAcknowledged: false,
      watchdog: createLeaseWatchdog({
        clock: clock.monotonic,
        fence: () => terminal(job, "unavailable"),
      }),
      publisher: createPublisher({
        storage,
        commitSnapshot: control.commitSnapshot,
        isCurrent: (lease) =>
          job.lease?.epoch === lease.epoch &&
          !abort.signal.aborted &&
          job.watchdog.check(),
        limits: {
          maxPending: 2,
          operationTimeoutMs: limits.operationTimeoutMs,
        },
      }),
      renew: slot(abort.signal, limits.operationTimeoutMs),
      observe: slot(root.signal, limits.operationTimeoutMs),
      initialize: slot(abort.signal, limits.operationTimeoutMs),
    };
    jobs.set(source.streamKey, job);
    const sentAt = clock.monotonic();
    job.initialize(
      async (signal) => {
        const lease = OwnershipLeaseSchema.parse(
          await control.claim(source, signal),
        );
        signal.throwIfAborted();
        if (
          lease.streamKey !== source.streamKey ||
          lease.workerId !== binding.workerId ||
          !job.watchdog.accept(lease, sentAt)
        )
          throw Error("Invalid source lease");
        job.lease = lease;
        job.state = "starting";
        job.renewAt = sentAt + lease.renewAfterMs;
        const session = sessionSchema.parse(await control.read(lease, signal));
        return session;
      },
      (session) => {
        job.continuity = session.continuity;
        job.progressAt = session.progressAt ?? 0;
        const baseline = session.progressAt ?? session.recoveryStartedAt;
        if (baseline > clock.wall()) {
          terminal(job, "unavailable");
          return;
        }
        job.progressMono = clock.monotonic() - (clock.wall() - baseline);
        if (
          clock.monotonic() - job.progressMono >=
          RELAY_POLICY.sourceRecoveryBudgetMs
        ) {
          terminal(job, "unavailable");
          return;
        }
        job.state = "starting";
        start(job);
      },
      () => terminal(job, "unavailable"),
    );
  }
  function observation(): WorkerObservation {
    return WorkerObservationSchema.parse({
      workerId: binding.workerId,
      workerEpoch: binding.workerEpoch,
      observedAt: clock.wall(),
      allocation: binding.allocation,
      activeJobs: [...jobs.values()].filter(
        (j) => j.state !== "stopped" && j.state !== "unavailable",
      ).length,
      resources: sampler.latest() ?? null,
      jobs: [...jobs.values()].flatMap((j) =>
        j.lease
          ? [
              {
                streamKey: j.source.streamKey,
                sourceEpoch: j.lease.epoch,
                state: j.state,
                progressAt: j.progressAt,
              },
            ]
          : [],
      ),
    });
  }
  function reconcile() {
    if (stopped) return;
    const now = clock.monotonic();
    // Authority checks run before and independently of all external work.
    for (const job of jobs.values()) {
      if (job.state !== "unavailable" && job.state !== "stopped") {
        if (now - job.progressMono >= RELAY_POLICY.sourceRecoveryBudgetMs)
          terminal(job, "unavailable");
        else if (now - job.lastDemand >= RELAY_POLICY.idleGraceMs)
          terminal(job, "stopped");
        else if (job.lease && job.watchdog.check()) {
          if (now >= job.renewAt) {
            const sentAt = now,
              lease = job.lease;
            job.renewAt = now + lease.renewAfterMs;
            job.renew(
              (signal) => control.renew(lease, signal),
              (reply) => {
                if (job.watchdog.accept(reply, sentAt)) job.lease = reply;
                else terminal(job, "unavailable");
              },
              () => terminal(job, "unavailable"),
            );
          }
          if (
            job.state === "ready" &&
            Object.values(job.attempt?.snapshots ?? {}).some(
              (s) => !isSnapshotFresh(s, clock.wall()),
            )
          )
            recover(job);
          if (job.state === "recovering" && !job.attempt && now >= job.retryAt)
            start(job);
        }
      }
      const lease = job.lease;
      const version = `${job.state}:${job.progressAt}`;
      // Terminal observations surrender the distributed lease. Abort fences
      // publication immediately, but only successful physical setup/stop may
      // surrender ownership early. Rejected cleanup retains attempt quarantine.
      const terminalPendingCleanup =
        (job.state === "unavailable" || job.state === "stopped") &&
        (job.attempt !== undefined || !job.initialize.isIdle());
      if (lease && job.observed !== version && !terminalPendingCleanup) {
        const state = job.state,
          progressAt = job.progressAt;
        job.observe(
          (signal) =>
            control.observe({
              lease,
              state,
              progressAt,
              signal,
              ...(job.terminalReason
                ? { terminalReason: job.terminalReason }
                : {}),
            }),
          () => {
            job.observed = version;
            if (state === "unavailable" || state === "stopped")
              job.terminalAcknowledged = true;
          },
        );
      }
    }
    if (now >= nextPoll) {
      nextPoll = now + 1000;
      void sampler.sample();
      register(
        (signal) => control.register(observation(), signal),
        () => {
          registered = true;
        },
        () => {
          registered = false;
        },
      );
      readDemand(
        (signal) => demand.read({ streamKeys: [...jobs.keys()], signal }),
        (raw) => {
          const result = demandSchema.parse(raw);
          healthyAt = result.healthy ? clock.monotonic() : -Infinity;
          if (result.healthy)
            for (const item of result.activity) {
              const job = jobs.get(item.streamKey);
              if (job && item.lastActivityAt <= clock.wall())
                job.lastDemand = Math.max(
                  job.lastDemand,
                  clock.monotonic() - (clock.wall() - item.lastActivityAt),
                );
            }
          if (registered && result.healthy) discovery();
        },
        () => {
          healthyAt = -Infinity;
        },
      );
      if (registered && now - healthyAt < limits.operationTimeoutMs)
        discovery();
    }
    if (now >= nextRetire) {
      nextRetire = now + 60000;
      retire(
        (signal) =>
          storage.retire({
            before: clock.wall() - RELAY_POLICY.objectRetentionMs,
            limit: 1000,
            signal,
          }),
        () => {},
      );
    }
  }
  function discovery() {
    discover(
      (signal) => control.list(signal),
      (raw) => {
        const rows = discoverySchema.parse(raw),
          keys = new Set(rows.map((r) => r.source.streamKey));
        for (const [key, job] of jobs)
          if (
            (!job.lease ||
              !keys.has(key) ||
              rows.some(
                (row) =>
                  row.source.streamKey === key &&
                  row.admissionRevision > job.admissionRevision,
              )) &&
            (job.terminalAcknowledged ||
              (!keys.has(key) &&
                (job.state === "stopped" || job.state === "unavailable"))) &&
            !job.attempt &&
            job.publisher.isIdle() &&
            job.renew.isIdle() &&
            job.observe.isIdle() &&
            job.initialize.isIdle()
          ) {
            job.watchdog.stop();
            jobs.delete(key);
          }
        if (clock.monotonic() - healthyAt >= limits.operationTimeoutMs) return;
        for (const row of rows) {
          const job = jobs.get(row.source.streamKey);
          if (row.state === "draining") {
            if (job) terminal(job, "stopped");
          } else if (row.state !== "stopped" && row.state !== "unavailable")
            admit(row.source, row.admissionRevision);
        }
      },
    );
  }
  const timer = setInterval(reconcile, RELAY_POLICY.localWatchdogIntervalMs);
  return {
    reconcile,
    diagnostics: () => ({
      activeJobs: jobs.size,
      pendingPublications: [...jobs.values()].reduce(
        (n, job) => n + job.publisher.pendingCount(),
        0,
      ),
    }),
    drain() {
      draining = true;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      clearInterval(timer);
      const cleanupTasks = [...jobs.values()].map((job) => {
        terminal(job, "stopped");
        return cleanup(job);
      });
      root.abort();
      sampler.reset();
      stopPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          metric("cleanup_timeout");
          resolve();
        }, limits.cleanupTimeoutMs);
        void Promise.allSettled(cleanupTasks).then(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
      return stopPromise;
    },
  };
}
