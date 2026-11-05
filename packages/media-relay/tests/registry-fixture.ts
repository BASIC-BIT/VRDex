import assert from "node:assert/strict";
import {
  createRelayRegistry,
  type RegistryOptions,
  type RelayControl,
} from "../src/worker/registry";
import {
  parseSourceDescriptor,
  type RenditionSnapshot,
  type WorkerObservation,
} from "../src/contracts";
import type { PackagerOptions } from "../src/worker/packager";
import type { RelayStorage } from "../src/worker/publisher";
export const source = parseSourceDescriptor({
  streamKey: "vrcdn/Alpha/1",
  streamId: "Alpha",
  inputFormat: "vrcdn_fmp4",
  packagingVersion: 1,
});
export async function flush() {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
}
export function harness(overrides: Partial<RegistryOptions> = {}) {
  let now = 100000;
  const attempts: PackagerOptions[] = [],
    stopped: PackagerOptions[] = [],
    committed: RenditionSnapshot[] = [],
    observations: WorkerObservation[] = [];
  let sources = [{ source, admissionRevision: 0, state: "queued" as const }];
  const control: RelayControl = {
    async list() {
      return sources;
    },
    async claim(s) {
      return {
        streamKey: s.streamKey,
        workerId: "one",
        epoch: 1,
        serverNow: now,
        expiresAt: now + 30000,
        renewAfterMs: 10000,
      };
    },
    async renew(l) {
      return { ...l, serverNow: now, expiresAt: now + 30000 };
    },
    async read() {
      return { recoveryStartedAt: now };
    },
    async observe() {},
    async register(o) {
      observations.push(o);
    },
    async commitSnapshot({ snapshot, signal, isCurrent }) {
      signal.throwIfAborted();
      assert(isCurrent());
      committed.push(snapshot);
    },
  };
  const storage: RelayStorage = {
    async putSegment() {},
    async putSnapshot() {},
    async retire() {},
  };
  const options: RegistryOptions = {
    control,
    storage,
    clock: { monotonic: () => now, wall: () => now },
    binding: {
      workerId: "one",
      workerEpoch: 1,
      allocation: {
        cpuUnits: 1024,
        memoryMiB: 2048,
        evidenceId: "test-proof-1",
      },
      maxSources: 2,
      draining: false,
    },
    directory: "/tmp/vrdex-registry-unit",
    demand: {
      async read() {
        return {
          healthy: true,
          activity: sources.map((s) => ({
            streamKey: s.source.streamKey,
            lastActivityAt: now,
          })),
        };
      },
    },
    packager: async (opts) => {
      attempts.push(opts);
      return {
        async stop() {
          stopped.push(opts);
        },
      };
    },
    readCounters: async () => ({}),
    ...overrides,
  };
  const registry = createRelayRegistry(options);
  return {
    registry,
    options,
    control,
    storage,
    attempts,
    stopped,
    committed,
    observations,
    setSources: (value: typeof sources) => {
      sources = value;
    },
    async tick(ms = 0) {
      now += ms;
      registry.reconcile();
      await flush();
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}
export function output(
  attempt: PackagerOptions,
  now: number,
  sequence = 0,
  rendition: "video" | "audio" = "video",
  segmentCount = 1,
) {
  return attempt.onSnapshot(
    {
      streamKey: attempt.source.streamKey,
      epoch: attempt.epoch,
      rendition,
      targetDurationSeconds: 2,
      sequence,
      discontinuitySequence: 0,
      generatedAt: now,
      segments: Array.from({length: segmentCount}, (_, offset) => ({
          sequence: sequence + offset,
          objectKey: `attempt-1-test/${rendition}-${sequence + offset}.ts`,
          durationSeconds: 2,
          programDateTime: now,
          discontinuity: sequence > 0 && offset === 0,
        })),
    },
    attempt.signal,
  );
}
