/** Local-only MPEG-TS transport. Media stays in the ignored Playwright artifacts tree. */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mediaDir = path.join(root, "apps/web/playwright-artifacts/event-playback-proof");
const ffmpeg = process.env.FFMPEG_PATH || (process.platform === "win32" ? "C:/ProgramData/chocolatey/bin/ffmpeg.exe" : "ffmpeg");
const expressions = {
  audible: "sine=frequency=440:sample_rate=48000",
  silent: "anullsrc=r=48000:cl=stereo",
  quiet: "sine=frequency=440:sample_rate=48000,volume=0.001",
  break: "sine=frequency=440:sample_rate=48000,volume=enable='between(t,2,2.6)+between(t,5,7)':volume=0",
};

export async function startProofServer({ port = 0 } = {}) {
  await mkdir(mediaDir, { recursive: true });
  const children = new Set();
  const sessions = new Map();
  const offline = new Set();
  const timers = new Set();
  const interruptions = [];
  let cleanEofs = 0;
  let highWater = 0;
  let opened = 0;
  let denied = 0;
  let stopped = false;
  const run = (args) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  };
  try {
    for (const [kind, input] of Object.entries(expressions)) {
      await new Promise((resolve, reject) => {
        const child = run(["-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=25", "-f", "lavfi", "-i", input, "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-g", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mpegts", path.join(mediaDir, `${kind}.mpegts`)]);
        let error = "";
        child.stderr.on("data", chunk => { error += chunk; });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Fixture generation failed: ${error}`)));
      });
    }
  } catch (error) {
    for (const child of children) child.kill();
    throw error;
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    // Bound to loopback; reject browser requests from any other origin.
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      res.writeHead(403).end(); return;
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/stats") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ active: sessions.size, highWater, opened, denied, children: children.size, interruptions, cleanEofs })); return;
    }
    if (url.pathname === "/control" && req.method === "POST") {
      const id = url.searchParams.get("id");
      const state = url.searchParams.get("state");
      if (state === "short-drop") {
        for (const [response, session] of sessions) if (session.id === id) {
          const interruption = { startedAt: performance.now(), resumedAt: null };
          interruptions.push(interruption);
          session.child.stdout.unpipe(response);
          session.child.stdout.pause();
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (!response.destroyed) session.child.stdout.pipe(response);
            interruption.resumedAt = performance.now();
          }, 600);
          timers.add(timer);
        }
      } else if (state === "eof") {
        for (const [response, session] of sessions) if (session.id === id) {
          session.child.stdout.unpipe(response);
          response.end();
          session.child.kill();
          cleanEofs++;
        }
      } else if (state === "offline") {
        offline.add(id);
        for (const [response, session] of sessions) if (session.id === id) response.destroy();
      } else offline.delete(id);
      res.end("ok"); return;
    }
    const kind = url.pathname.slice(1).replace(/\.live\.ts$/, "");
    const id = url.searchParams.get("id") || kind;
    if (!Object.hasOwn(expressions, kind)) { res.writeHead(404).end(); return; }
    if (offline.has(id)) { res.writeHead(503).end("offline"); return; }
    if (sessions.size >= 2) { denied++; res.writeHead(429).end("proof connection limit"); return; }
    res.writeHead(200, { "Content-Type": "video/mp2t" });
    const child = run(["-re", "-stream_loop", "-1", "-i", path.join(mediaDir, `${kind}.mpegts`), "-c", "copy", "-f", "mpegts", "-flush_packets", "1", "pipe:1"]);
    sessions.set(res, { child, id });
    opened++;
    highWater = Math.max(highWater, sessions.size);
    child.stdout.pipe(res);
    child.stderr.resume();
    child.once("error", () => res.destroy());
    child.once("exit", () => res.end());
    res.once("close", () => { sessions.delete(res); child.kill(); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const close = async () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const response of sessions.keys()) response.destroy();
    const exits = [...children].map(child => new Promise(resolve => { child.once("exit", resolve); child.kill(); }));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.all(exits);
  };
  const deadline = setTimeout(() => void close(), 10 * 60_000);
  deadline.unref();
  return { url: `http://127.0.0.1:${server.address().port}`, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startProofServer({ port: Number(process.env.PROOF_PORT || 4319) }).then(fixture => {
  console.log(fixture.url);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void fixture.close());
  });
}
