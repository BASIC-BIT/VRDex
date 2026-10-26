import { readFile } from "node:fs/promises";
export async function readCgroupCounters() {
  try {
    const [cpu, memory] = await Promise.all([
      readFile("/sys/fs/cgroup/cpu.stat", "utf8"),
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
    ]);
    const usage = cpu.match(/^usage_usec (\d+)$/m);
    if (!usage) throw Error("Missing cgroup CPU");
    return {
      cpuNs: Number(usage[1]) * 1000,
      memoryBytes: Number(memory),
      at: performance.now(),
    };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const [cpu, memory] = await Promise.all([
    readFile("/sys/fs/cgroup/cpuacct/cpuacct.usage", "utf8"),
    readFile("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8"),
  ]);
  return {
    cpuNs: Number(cpu),
    memoryBytes: Number(memory),
    at: performance.now(),
  };
}
export function resourceInterval(previous, next, cpuUnits) {
  const elapsedMs = next.at - previous.at,
    delta = next.cpuNs - previous.cpuNs;
  if (
    !(elapsedMs > 0) ||
    !Number.isFinite(delta) ||
    delta < 0 ||
    !Number.isFinite(next.memoryBytes) ||
    next.memoryBytes <= 0
  )
    throw Error("Invalid cgroup sample");
  return {
    elapsedMs,
    cpuPercent: (delta / (elapsedMs * 1e6) / (cpuUnits / 1024)) * 100,
    memoryBytes: next.memoryBytes,
  };
}

/** Keep absolute cadence until real counter timestamps cover the requested window.
 * Injected clock/wait/counter/health callbacks make endpoint races testable without
 * media or child processes. Never manufacture a timestamp or a catch-up sample. */
export async function sampleResourceWindow({
  first,
  durationMs,
  clock,
  wait,
  readCounters,
  checkHealthy,
  onSample,
}) {
  if (
    !Number.isFinite(first?.at) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  )
    throw Error("Invalid resource sample window");
  let previous = first,
    samples = 0;
  while (previous.at - first.at < durationMs) {
    await wait(Math.max(0, first.at + (samples + 1) * 1000 - clock()));
    const at = clock();
    checkHealthy();
    const next = await readCounters();
    const health = checkHealthy();
    if (!Number.isFinite(next?.at) || next.at <= previous.at)
      throw Error("Invalid cgroup sample timestamp");
    await onSample(previous, next, { at, health });
    previous = next;
    samples++;
  }
  return { last: previous, samples };
}
