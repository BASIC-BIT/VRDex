import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseMediaSettings } from "./broadcast-profiles.mjs";

export const TWITCH_BACKLOG_LIMIT = 256 * 1024;
export const TWITCH_NODE_BUFFER_BOUND = 512 * 1024;
export const TWITCH_RECONNECT_MS = Object.freeze([
  1000, 2000, 4000, 8000, 10000,
]);
const reasons = new Set([
  "destination_denied",
  "dns_denied",
  "dns_timeout",
  "proxy_denied",
  "credentials_denied",
  "tls_denied",
  "http_timeout",
  "response_limit",
  "dependency_mismatch",
  "unsupported_media",
  "provider_unavailable",
  "media_timeout",
  "preparation_timeout",
  "cancelled",
  "process_failed",
]);
const kinds = new Set([
  "acquiring",
  "warming",
  "transport_ready",
  "ad_wait",
  "unavailable",
  "cancelled",
  "buffer",
]);
const numericFields = [
  "warmupMs",
  "reservoirHighWaterBytes",
  "stagingHighWaterBytes",
  "pythonBufferUpperBoundBytes",
  "remuxInputPipeBytes",
  "remuxOutputPipeBytes",
];

/** Immediate acquisition handle; transport readiness is not decoder readiness.
 * preparationExpiresAt is the original persisted worker receipt deadline. The
 * caller must also retain that deadline through decoder preparation/promotion.
 */
export function createTwitchInput({
  source,
  settings,
  signal,
  onState = () => {},
  spawnProcess = spawn,
  preparationExpiresAt = Date.now() + 15000,
  sessionExpiresAt = Date.now() + 12 * 60 * 60 * 1000,
}) {
  const receivedAt = Date.now();
  const expiry = Math.min(preparationExpiresAt, receivedAt + 15000);
  const lifetime = Math.min(sessionExpiresAt, receivedAt + 12 * 60 * 60 * 1000);
  let resolveReady, rejectReady;
  const transportReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A caller can attach after the synchronous return, including pre-aborted work.
  transportReady.catch(() => {});
  let disposed = false,
    disposePromise,
    child,
    childCleanup,
    client,
    url,
    ready = false;
  let announced = false;
  let attempt = 0,
    retryTimer,
    prepareTimer,
    lifetimeTimer,
    providerReady = false;
  let backlog = [],
    backlogBytes = 0,
    backlogHighWater = 0,
    pythonUpperBound = 2818048;
  let stderrCarry = "",
    droppingLine = false,
    eventWindow = 0,
    eventCount = 0;
  const sockets = new Set();
  const path = "/" + randomBytes(24).toString("hex");
  const state = (event) => {
    try {
      onState(Object.freeze(event));
    } catch {}
  };
  const failReady = (reason) => rejectReady(new Error(reason));
  const terminations = new WeakMap();
  const closures = new WeakMap();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function groupAlive(pid) {
    try {
      globalThis.process.kill(-pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
    // An orphaned zombie can remain until PID 1 reaps it. It owns no live
    // resources. Inspect bounded batches so process-table size cannot exhaust
    // file descriptors, and fail closed if the group cannot be observed.
    const names = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
    for (let offset = 0; offset < names.length; offset += 64) {
      const alive = await Promise.all(
        names.slice(offset, offset + 64).map(async (name) => {
          try {
            const stat = await readFile(`/proc/${name}/stat`, "utf8");
            const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            return Number(fields[2]) === pid && !["Z", "X"].includes(fields[0]);
          } catch (error) {
            if (["ENOENT", "ESRCH"].includes(error.code)) return false;
            throw error;
          }
        }),
      );
      if (alive.some(Boolean)) return true;
    }
    return false;
  }
  function terminate(process) {
    if (!process) return Promise.resolve();
    if (terminations.has(process)) return terminations.get(process);
    const cleanup = Promise.resolve()
      .then(async () => {
        if (!Number.isInteger(process.pid) || process.pid <= 1) {
          process.kill?.("SIGTERM");
          return;
        }
        const pid = process.pid;
        const groupSignal = (sig) => {
          try {
            globalThis.process.kill(-pid, sig);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
        };
        groupSignal("SIGTERM");
        // Always signal the original group, even when its leader exits. Half the
        // one-second budget remains for scheduling under concurrent media load.
        await delay(500);
        groupSignal("SIGKILL");
        const deadline = Date.now() + 5000;
        let quiet = 0;
        while (quiet < 2) {
          if (Date.now() >= deadline) throw Error();
          quiet = (await groupAlive(pid)) ? 0 : quiet + 1;
          if (quiet < 2) await delay(10);
        }
        // Close our pipe ends only after confirming physical group termination.
        // A fulfilled disposal is the capacity owner's proof it may free a slot.
        process.stdout?.destroy();
        process.stderr?.destroy();
        let timeout;
        try {
          await Promise.race([
            closures.get(process),
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(Error()),
                Math.max(0, deadline - Date.now()),
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      })
      .catch(() => {
        throw new Error("process_failed");
      });
    terminations.set(process, cleanup);
    return cleanup;
  }
  function flush() {
    if (!client || client.destroyed) return;
    while (backlog.length) {
      const bytes = backlog.shift();
      backlogBytes -= bytes.length;
      if (!client.write(bytes)) {
        child?.stdout?.pause();
        return;
      }
    }
    child?.stdout?.resume();
  }
  function announceReady() {
    if (!url || !providerReady || !backlogBytes || disposed || announced)
      return;
    announced = true;
    clearTimeout(prepareTimer);
    if (!ready) {
      ready = true;
      resolveReady({ url });
    }
    state({
      kind: "transport_ready",
      nodeBufferHighWaterBytes: backlogHighWater,
      compressedBufferUpperBoundBytes:
        pythonUpperBound + TWITCH_NODE_BUFFER_BOUND,
    });
    flush();
  }
  const server = http.createServer(
    { highWaterMark: 16 * 1024, maxHeaderSize: 4096 },
    (request, response) => {
      if (request.url !== path) {
        response.writeHead(404).end();
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      if (disposed || !announced) {
        response.writeHead(503).end();
        return;
      }
      if (client && !client.destroyed) {
        response.writeHead(409).end();
        return;
      }
      client = response;
      response.writeHead(200, {
        "Content-Type": "video/mp2t",
        "Cache-Control": "no-store",
        Connection: "close",
      });
      response.on("drain", flush);
      response.on("close", () => {
        if (client === response) client = undefined;
      });
      flush();
    },
  );
  server.maxConnections = 4;
  server.headersTimeout = 2000;
  server.requestTimeout = 2000;
  server.keepAliveTimeout = 1000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("error", () => {
    failReady("process_failed");
    void dispose();
  });
  function acceptLine(line) {
    const now = Date.now();
    if (now - eventWindow >= 1000) {
      eventWindow = now;
      eventCount = 0;
    }
    if (++eventCount > 10) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value || !kinds.has(value.kind)) return;
    const clean = { kind: value.kind };
    if (value.kind === "unavailable")
      clean.reason = reasons.has(value.reason)
        ? value.reason
        : "provider_unavailable";
    for (const field of numericFields)
      if (
        Number.isSafeInteger(value[field]) &&
        value[field] >= 0 &&
        value[field] <= 4 * 1024 * 1024
      )
        clean[field] = value[field];
    if (value.kind === "buffer") {
      pythonUpperBound = clean.pythonBufferUpperBoundBytes ?? pythonUpperBound;
      clean.nodeBufferHighWaterBytes = backlogHighWater;
      clean.compressedBufferUpperBoundBytes =
        pythonUpperBound + TWITCH_NODE_BUFFER_BOUND;
    }
    if (value.kind === "transport_ready") {
      providerReady = true;
      announceReady();
      return;
    }
    state(clean);
  }
  function stderr(bytes) {
    // Iterate bounded chunks; never concatenate a potentially giant child line.
    for (let offset = 0; offset < bytes.length; offset++) {
      const byte = bytes[offset];
      if (byte === 10) {
        if (!droppingLine) acceptLine(stderrCarry);
        stderrCarry = "";
        droppingLine = false;
      } else if (!droppingLine) {
        if (stderrCarry.length >= 2048) {
          stderrCarry = "";
          droppingLine = true;
        } else stderrCarry += String.fromCharCode(byte);
      }
    }
  }
  function start() {
    if (disposed) return;
    if ((!ready && Date.now() >= expiry) || Date.now() >= lifetime) {
      failReady("preparation_timeout");
      void dispose();
      return;
    }
    childCleanup = undefined;
    providerReady = false;
    announced = false;
    stderrCarry = "";
    droppingLine = false;
    backlog = [];
    backlogBytes = 0;
    state({ kind: "acquiring" });
    let next;
    try {
      next = spawnProcess(
        "python3",
        [
          "-m",
          "workers.restream.twitch_input",
          "--channel",
          source.channel,
          "--video-preset",
          settings.videoPreset,
        ],
        {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      failReady("process_failed");
      void dispose();
      return;
    }
    child = next;
    closures.set(next, new Promise((resolve) => next.once("close", resolve)));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      next.stdout?.pause();
      providerReady = false;
      client?.destroy();
      client = undefined;
      backlog = [];
      backlogBytes = 0;
      childCleanup = terminate(next);
      childCleanup.then(
        () => {
          if (child === next) child = undefined;
          if (disposed) return;
          state({ kind: "unavailable", reason: "provider_unavailable" });
          retryTimer = setTimeout(
            start,
            TWITCH_RECONNECT_MS[
              Math.min(attempt++, TWITCH_RECONNECT_MS.length - 1)
            ],
          );
        },
        () => {
          failReady("process_failed");
          void dispose();
        },
      );
    };
    next.on("error", end);
    next.on("exit", end);
    next.stderr.on("data", (bytes) => {
      if (child === next && !ended && !disposed) stderr(bytes);
    });
    next.stdout.on("data", (bytes) => {
      if (disposed || ended) return;
      if (
        bytes.length > 64 * 1024 ||
        backlogBytes + bytes.length > TWITCH_BACKLOG_LIMIT
      ) {
        end();
        return;
      }
      backlog.push(bytes);
      backlogBytes += bytes.length;
      backlogHighWater = Math.max(backlogHighWater, backlogBytes);
      if (backlogBytes >= TWITCH_BACKLOG_LIMIT - 64 * 1024) next.stdout.pause();
      announceReady();
      flush();
    });
  }
  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    clearTimeout(retryTimer);
    clearTimeout(prepareTimer);
    clearTimeout(lifetimeTimer);
    signal?.removeEventListener("abort", abort);
    failReady("cancelled");
    for (const socket of sockets) socket.destroy();
    server.close();
    backlog = [];
    backlogBytes = 0;
    // Set promise before signaling: fake and real children may emit synchronously.
    disposePromise = Promise.resolve()
      .then(() => childCleanup ?? terminate(child))
      .then(() => {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        state({ kind: "cancelled" });
      });
    // Abort and timer callers intentionally do not await. Mark the rejection
    // handled while preserving it for the capacity owner awaiting dispose().
    disposePromise.catch(() => {
      state({ kind: "unavailable", reason: "process_failed" });
    });
    return disposePromise;
  }
  const abort = () => {
    void dispose();
  };
  try {
    settings = parseMediaSettings(settings);
    if (
      source?.kind !== "twitch" ||
      !/^[a-z0-9_]{3,25}$/.test(source.channel) ||
      [
        "directory",
        "downloads",
        "jobs",
        "p",
        "settings",
        "subscriptions",
        "turbo",
        "videos",
      ].includes(source.channel) ||
      !Number.isFinite(expiry) ||
      !Number.isFinite(lifetime)
    )
      throw Error();
    source = { kind: "twitch", channel: source.channel };
  } catch {
    failReady("destination_denied");
    void dispose();
    return { transportReady, dispose };
  }
  if (signal?.aborted) {
    void dispose();
    return { transportReady, dispose };
  }
  signal?.addEventListener("abort", abort, { once: true });
  prepareTimer = setTimeout(
    () => {
      failReady("preparation_timeout");
      void dispose();
    },
    Math.max(0, expiry - Date.now()),
  );
  lifetimeTimer = setTimeout(
    () => {
      void dispose();
    },
    Math.max(0, lifetime - Date.now()),
  );
  server.listen(0, "127.0.0.1", () => {
    if (disposed) {
      server.close();
      return;
    }
    url = `http://127.0.0.1:${server.address().port}${path}`;
    announceReady();
  });
  start();
  return { transportReady, dispose };
}
