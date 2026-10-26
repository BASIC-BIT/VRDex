import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
export async function processTable() {
  const rows = [];
  for (const id of await readdir("/proc")) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const s = await readFile(`/proc/${id}/stat`, "utf8");
      const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      rows.push({
        pid: Number(id),
        parent: Number(f[1]),
        group: Number(f[2]),
        live: !["Z", "X"].includes(f[0]),
      });
    } catch (e) {
      if (!["ENOENT", "ESRCH"].includes(e.code)) throw e;
    }
  }
  return rows;
}
export function createProcessOwner() {
  const children = new Set();
  function start(command, args, options = {}) {
    const child = spawn(command, args, { ...options, detached: true });
    children.add(child);
    child.closed = new Promise((resolve) => {
      child.once("close", (code) => resolve(code));
      child.once("error", () => resolve(1));
    });
    child.on("error", () => {});
    return child;
  }
  async function close() {
    for (const c of children) signal(c, "SIGTERM");
    await sleep(500);
    for (const c of children) signal(c, "SIGKILL");
    const deadline = performance.now() + 5000;
    for (;;) {
      const rows = await processTable();
      const groups = rows.filter(
        (r) => r.live && [...children].some((c) => r.group === c.pid),
      );
      if (!groups.length) break;
      if (performance.now() > deadline)
        throw Error("Orphan proof process group");
      await sleep(20);
    }
    await Promise.race([
      Promise.all([...children].map((c) => c.closed)),
      sleep(1000).then(() => {
        throw Error("Missing child close receipt");
      }),
    ]);
    return {
      closed: true,
      liveChildren: 0,
      liveGroups: 0,
      children: children.size,
    };
  }
  function signal(c, s) {
    try {
      process.kill(-c.pid, s);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  async function run(
    command,
    args,
    { timeoutMs = 30000, maxBytes = 1048576, ...options } = {},
  ) {
    const c = start(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = [],
      bytes = 0,
      stderrBytes = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      signal(c, "SIGKILL");
    }, timeoutMs);
    c.stdout.on("data", (b) => {
      bytes += b.length;
      if (bytes > maxBytes) {
        failed = true;
        signal(c, "SIGKILL");
      } else stdout.push(b);
    });
    c.stderr.on("data", (b) => {
      stderrBytes += b.length;
      if (stderrBytes > maxBytes) {
        failed = true;
        signal(c, "SIGKILL");
      }
    });
    const code = await c.closed;
    clearTimeout(timer);
    if (code !== 0 || failed) throw Error("Bounded proof subprocess failed");
    return Buffer.concat(stdout);
  }
  return { start, run, close, children };
}
