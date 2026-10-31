import { chmod, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

type Identity = { pid: number; start: string };
type Process = Identity & { state: string; parent: number; group: number };
async function inspect(pid: number): Promise<Process | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, start: fields[19]!, state: fields[0]!, parent: Number(fields[1]), group: Number(fields[2]) };
  } catch { return null; }
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Explicit media roots, distinct from the proof's loader/runtime process tree. */
export async function createProcessOwnership(directory: string) {
  const records = join(directory, "media-processes");
  await writeFile(records, "");
  const identities = new Map<string, Identity>();
  async function executable(command: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(command)) throw Error("Invalid proof executable");
    const path = join(directory, `owned-${command}`);
    // These fixed wrapper names contain no spaces. exec preserves PID/start ticks.
    // Record before exec so even a short-lived probe cannot be missed by sampling.
    await writeFile(path, `#!/bin/sh\nawk '{print $1 " " $22}' /proc/$$/stat >> ${quote(records)} || exit 1\nexec ${quote(command)} "$@"\n`);
    await chmod(path, 0o755);
    return path;
  }
  async function scan(): Promise<Process[]> {
    if ((await stat(records)).size > 1024 * 1024) throw Error("Proof ownership ledger exceeded bound");
    for (const line of (await readFile(records, "utf8")).trim().split("\n")) {
      if (!line) continue;
      const match = /^([1-9][0-9]*) ([0-9]+)$/.exec(line);
      if (!match) throw Error("Invalid proof ownership record");
      identities.set(`${match[1]}:${match[2]}`, {pid:Number(match[1]),start:match[2]!});
      if (identities.size > 10000) throw Error("Proof process inventory exceeded bound");
    }
    // /proc/<pid>/task/<tid>/children is absent on some supported kernels.
    // Build the parent graph from stat; only recorded root identities confer ownership.
    const processes = new Map<number, Process>();
    for (const name of await readdir("/proc")) {
      if (!/^[0-9]+$/.test(name)) continue;
      const process = await inspect(Number(name));
      if (process) processes.set(process.pid, process);
    }
    const todo = [...identities.values()], seen = new Set<string>(), alive: Process[] = [];
    while (todo.length) {
      const identity = todo.pop()!, key = `${identity.pid}:${identity.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const process = processes.get(identity.pid);
      if (!process || process.start !== identity.start) continue;
      alive.push(process);
      for (const child of processes.values()) {
        if (child.parent !== process.pid || BigInt(child.start) < BigInt(process.start)) continue;
        identities.set(`${child.pid}:${child.start}`, child);
        if (identities.size > 10000) throw Error("Proof process inventory exceeded bound");
        todo.push(child);
      }
    }
    return alive;
  }
  return { executable, scan };
}

/** Capture authority only from a live direct child that is its own detached group leader. */
export async function captureOwnedProcessGroup(child: import("node:child_process").ChildProcess) {
  const leader = child.pid ? await inspect(child.pid) : null;
  if (!leader || leader.parent !== process.pid || leader.group !== leader.pid)
    throw Error("Cannot establish detached proof group ownership");
  return {
    async settle(deadline: number) {
      if (child.exitCode === null && child.signalCode === null)
        throw Error("Proof leader must exit before group settlement");
      const { setTimeout: delay } = await import("node:timers/promises");
      let signaled = false, killAt = Infinity;
      while (true) {
        const currentLeader = await inspect(leader.pid);
        if (currentLeader && currentLeader.start !== leader.start)
          throw Error("Proof group leader identity changed");
        let executing = false;
        for (const name of await readdir("/proc")) {
          if (Date.now() >= deadline) throw Error("Proof process group scan exceeded cleanup deadline");
          if (!/^[0-9]+$/.test(name)) continue;
          const member = await inspect(Number(name));
          if (member?.group === leader.group && member.state !== "Z" && member.state !== "X") executing = true;
        }
        // A zombie already exited; only its parent can wait/reap it. Never count
        // an exited loader helper as a running media process or kill unrelated PIDs.
        if (!executing) return;
        const now = Date.now();
        if (now >= deadline) throw Error("Proof process group did not exit within cleanup deadline");
        if (!signaled || now >= killAt) {
          try { process.kill(-leader.group, signaled ? "SIGKILL" : "SIGTERM"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
          if (!signaled) { signaled = true; killAt = now + 1000; }
          else killAt = Infinity;
        }
        await delay(Math.min(25, deadline - now));
      }
    },
  };
}
