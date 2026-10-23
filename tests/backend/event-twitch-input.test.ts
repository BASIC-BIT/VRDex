import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createTwitchInput } from "../../workers/restream/twitch-input.mjs";

function fakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", 0);
    return true;
  };
  return child;
}
const source = { kind: "twitch", channel: "basic_bit" };
const settings = { videoPreset: "720p30", audioBitrateKbps: 320 };
test("returns handle immediately and retains normalized bytes before transport readiness", async () => {
  const child = fakeChild();
  const events: any[] = [];
  const handle = createTwitchInput({
    source,
    settings,
    onState: (e: any) => events.push(e),
    spawnProcess: () => child,
  });
  assert.equal(typeof handle.dispose, "function");
  let ready = false;
  handle.transportReady.then(() => {
    ready = true;
  });
  child.stderr.write('{"kind":"transport_ready"}\n');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ready, false);
  child.stdout.write(Buffer.alloc(188 * 5, 0x47));
  const { url } = await handle.transportReady;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const bad = await fetch(url, { method: "POST" });
  assert.equal(bad.status, 405);
  const hidden = await fetch(new URL("/wrong", url));
  assert.equal(hidden.status, 404);
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const { value } = await response.body!.getReader().read();
  assert.ok(value!.length >= 188);
  controller.abort();
  await handle.dispose();
});
test("already aborted never spawns and disposal is idempotent", async () => {
  const controller = new AbortController();
  controller.abort();
  let spawns = 0;
  const handle = createTwitchInput({
    source,
    settings,
    signal: controller.signal,
    spawnProcess: () => {
      spawns++;
      return fakeChild();
    },
  });
  await assert.rejects(handle.transportReady);
  const a = handle.dispose(),
    b = handle.dispose();
  assert.equal(a, b);
  await a;
  assert.equal(spawns, 0);
});
test("stderr rejects raw diagnostics and oversized/incomplete events without blocking control", async () => {
  const child = fakeChild();
  const events: any[] = [];
  const handle = createTwitchInput({
    source,
    settings,
    onState: (e: any) => events.push(e),
    spawnProcess: () => child,
  });
  handle.transportReady.catch(() => {});
  child.stderr.write("secret signed https://video.ttvnw.net/?token=SECRET\n");
  child.stderr.write("x".repeat(500000));
  child.stderr.write('\n{"kind":"unavailable","reason":"https://secret"}\n');
  child.stderr.write('{"kind":"warming","url":"SECRET"}\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!JSON.stringify(events).includes("SECRET"));
  assert.ok(!JSON.stringify(events).includes("https://secret"));
  await handle.dispose();
});

import { spawn as realSpawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { TWITCH_RECONNECT_MS } from "../../workers/restream/twitch-input.mjs";
async function liveGroup(pgid: number) {
  const result: number[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid && fields[0] !== "Z")
        result.push(Number(name));
    } catch {}
  }
  return result;
}
test("group cancellation kills a TERM-ignoring descendant after the leader exits", async (t) => {
  let pgid = 0;
  let childClosed = false;
  let markStarted!: () => void;
  const startedChild = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const handle = createTwitchInput({
    source,
    settings,
    spawnProcess: (_command: any, _args: any, options: any) => {
      const child = realSpawn(
        process.execPath,
        [
          "-e",
          `
      const {spawn}=require('node:child_process');
      spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});process.stderr.write("started");setInterval(()=>{},1000)'],{stdio:'inherit'});
      process.on('SIGTERM',()=>process.exit(0));
      setInterval(()=>{},1000);
    `,
        ],
        options,
      );
      pgid = child.pid!;
      child.stderr!.once("data", markStarted);
      child.once("close", () => {
        childClosed = true;
      });
      return child;
    },
  });
  handle.transportReady.catch(() => {});
  t.after(() => handle.dispose());
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      startedChild,
      new Promise((_, reject) => {
        startTimer = setTimeout(
          () => reject(Error("fixture_start_timeout")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(startTimer);
  }
  assert.ok((await liveGroup(pgid)).length >= 2);
  const started = performance.now();
  const cleanup = handle.dispose();
  let ticks = 0;
  const tick = setInterval(() => {
    ticks++;
  }, 10);
  await cleanup;
  clearInterval(tick);
  assert.equal(childClosed, true, "disposal must observe process/pipe closure");
  const cleanupMs = Math.round(performance.now() - started);
  assert.ok(performance.now() - started < 1100);
  assert.ok(ticks >= 20);
  const survivors = await liveGroup(pgid);
  assert.deepEqual(survivors, []);
  t.diagnostic(
    JSON.stringify({
      cleanupMs,
      controlTicks: ticks,
      survivingGroupMembers: survivors.length,
    }),
  );
});
test("original preparation expiry cannot renew on retry or takeover", async () => {
  let calls = 0;
  const started = Date.now();
  const handle = createTwitchInput({
    source,
    settings,
    preparationExpiresAt: started + 100,
    spawnProcess: () => {
      calls++;
      return fakeChild();
    },
  });
  await assert.rejects(handle.transportReady, /preparation_timeout/);
  await handle.dispose();
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 400);
});
test("fresh process per reconnect with bounded exponential delays", async () => {
  const times: number[] = [];
  const handle = createTwitchInput({
    source,
    settings,
    spawnProcess: () => {
      const child = fakeChild();
      times.push(Date.now());
      setTimeout(() => child.emit("exit", 3), 10);
      return child;
    },
  });
  handle.transportReady.catch(() => {});
  await new Promise((r) => setTimeout(r, 3200));
  await handle.dispose();
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 1000);
  assert.ok(times[2] - times[1] >= 2000);
  assert.deepEqual(TWITCH_RECONNECT_MS, [1000, 2000, 4000, 8000, 10000]);
});
test("retained no-consumer backlog backpressures and readiness events are bounded", async () => {
  const child = fakeChild();
  const events: any[] = [];
  const handle = createTwitchInput({
    source,
    settings,
    onState: (event: any) => events.push(event),
    spawnProcess: () => child,
  });
  child.stderr.write('{"kind":"transport_ready"}\n');
  child.stdout.write(Buffer.alloc(32768, 0x47));
  await handle.transportReady;
  for (let i = 0; i < 7; i++) child.stdout.write(Buffer.alloc(32768, 0x47));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(child.stdout.isPaused(), true);
  assert.equal(events.filter((e) => e.kind === "transport_ready").length, 1);
  const evidence = events.find((e) => e.kind === "transport_ready");
  assert.ok(evidence.compressedBufferUpperBoundBytes <= 4 * 1024 * 1024);
  await handle.dispose();
});
test("disposal terminates the current retry rather than reusing a completed cleanup", async () => {
  let spawned = 0,
    secondKilled = 0;
  const handle = createTwitchInput({
    source,
    settings,
    spawnProcess: () => {
      const child = fakeChild();
      spawned++;
      if (spawned === 1) setTimeout(() => child.emit("exit", 3), 1);
      else
        child.kill = () => {
          secondKilled++;
          child.emit("exit", 0);
          return true;
        };
      return child;
    },
  });
  handle.transportReady.catch(() => {});
  await new Promise((r) => setTimeout(r, 1100));
  await handle.dispose();
  assert.equal(spawned, 2);
  assert.equal(secondKilled, 1);
});

test("failed cleanup rejects disposal, stays occupied, and never retries after exit or abort", async () => {
  for (const trigger of ["exit", "abort"] as const) {
    const child = fakeChild();
    child.kill = () => {
      throw new Error("raw provider SECRET");
    };
    const controller = new AbortController();
    const events: any[] = [];
    let spawns = 0;
    const handle = createTwitchInput({
      source,
      settings,
      signal: controller.signal,
      onState: (event: any) => events.push(event),
      spawnProcess: () => {
        spawns++;
        return child;
      },
    });
    if (trigger === "exit") child.emit("exit", 1);
    else controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cleanup = handle.dispose();
    await assert.rejects(cleanup, /^Error: process_failed$/);
    assert.equal(handle.dispose(), cleanup);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(spawns, 1);
    assert.ok(
      events.some(
        (event) =>
          event.kind === "unavailable" && event.reason === "process_failed",
      ),
    );
    assert.ok(!JSON.stringify(events).includes("SECRET"));
    child.stdout.destroy();
    child.stderr.destroy();
  }
});
