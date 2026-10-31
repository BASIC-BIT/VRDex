import type {
  ResourceSnapshot,
  WorkerAllocation,
} from "../../packages/media-relay/src/contracts";
export type ResourceCounters = {
  cpuUsageNs?: number;
  memoryUsedBytes?: number;
};
export function readCgroupCounters(): Promise<ResourceCounters>;
export function createResourceSampler(options: {
  allocation: WorkerAllocation;
  readCounters: () => Promise<ResourceCounters>;
  clock: () => number;
}): {
  sample(): Promise<void>;
  latest(): ResourceSnapshot | undefined;
  reset(): void;
};
