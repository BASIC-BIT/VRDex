import { readFile as readCounterFile } from "node:fs/promises";
import { parseAllocation } from "./worker-allocation.mjs";

/** @typedef {{cpuUsageNs?:number,memoryUsedBytes?:number}} ResourceCounters */
/** @typedef {{sampleSequence:number,windowMs:number,sampleAgeMs:number,cpuUsagePercent?:number,memoryUsedBytes?:number}} ResourceSnapshot */
const validCounter = (value) => Number.isSafeInteger(value) && value >= 0;
function integer(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text.trim());
  return validCounter(value) ? value : undefined;
}
/** Container cgroup totals include Node and every decoder/encoder/sender child.
 * Memory includes page cache. v2 CPU microseconds become nanoseconds; v1 CPU is
 * already nanoseconds. Independent fallbacks preserve either available metric.
 * Only fixed kernel paths are read; no process, host, provider or billing calls.
 * @returns {Promise<ResourceCounters>}
 */
export async function readCgroupCounters({ readFile = readCounterFile } = {}) {
  const read = async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return undefined;
    }
  };
  const cpu = async () => {
    const stat = await read("/sys/fs/cgroup/cpu.stat");
    const micros = integer(stat?.match(/^usage_usec\s+(\d+)\s*$/m)?.[1]);
    if (micros !== undefined && validCounter(micros * 1000))
      return micros * 1000;
    return integer(await read("/sys/fs/cgroup/cpuacct/cpuacct.usage"));
  };
  const memory = async () =>
    integer(await read("/sys/fs/cgroup/memory.current")) ??
    integer(await read("/sys/fs/cgroup/memory/memory.usage_in_bytes"));
  const [cpuUsageNs, memoryUsedBytes] = await Promise.all([cpu(), memory()]);
  return {
    ...(cpuUsageNs === undefined ? {} : { cpuUsageNs }),
    ...(memoryUsedBytes === undefined ? {} : { memoryUsedBytes }),
  };
}
/** Latest-only monotonic sampler. Never rejects; one read can remain pending
 * without blocking media. The start timestamp conservatively ages delayed IO.
 * reset invalidates old completions and clears the epoch's sequence/baseline,
 * while retaining its pending-read guard until the old read actually settles.
 * @param {{allocation:import('./worker-allocation.mjs').WorkerAllocation,readCounters:()=>Promise<ResourceCounters>,clock:()=>number}} options
 */
export function createResourceSampler({ allocation, readCounters, clock }) {
  const cores = parseAllocation(allocation).cpuUnits / 1024;
  let generation = 0,
    sequence = 0,
    pending;
  let baseline, observation;
  function latest() {
    if (!observation) return undefined;
    const age = clock() - observation.at;
    if (!Number.isFinite(age) || age < 0) return undefined;
    return { ...observation.snapshot, sampleAgeMs: age };
  }
  function sample() {
    if (pending) return pending;
    const captured = generation,
      at = clock();
    pending = Promise.resolve()
      .then(readCounters)
      .then((counters) => {
        if (captured !== generation || !Number.isFinite(at)) return;
        const cpu = validCounter(counters?.cpuUsageNs)
          ? counters.cpuUsageNs
          : undefined;
        const memory = validCounter(counters?.memoryUsedBytes)
          ? counters.memoryUsedBytes
          : undefined;
        const measuredAt = clock();
        if (!Number.isFinite(measuredAt)) return;
        const elapsed = baseline ? measuredAt - baseline.at : 0;
        const delta =
          cpu !== undefined && baseline ? cpu - baseline.cpu : undefined;
        const usage =
          delta !== undefined && delta >= 0 && elapsed > 0
            ? (delta / (elapsed * 1e6) / cores) * 100
            : undefined;
        baseline = cpu === undefined ? undefined : { cpu, at: measuredAt };
        if (memory === undefined && usage === undefined && cpu === undefined)
          return;
        observation = {
          at,
          snapshot: {
            sampleSequence: ++sequence,
            windowMs: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0,
            ...(Number.isFinite(usage) ? { cpuUsagePercent: usage } : {}),
            ...(memory === undefined ? {} : { memoryUsedBytes: memory }),
          },
        };
      })
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  return {
    sample,
    latest,
    reset() {
      generation++;
      sequence = 0;
      baseline = undefined;
      observation = undefined;
    },
  };
}
