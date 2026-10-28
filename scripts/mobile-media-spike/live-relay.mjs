// Bounded experiment. Fixed public basicbit input; no arbitrary URL forwarding.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, stat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "vrcdn-live-hls-"));
const playlist = path.join(directory, "index.m3u8");
const expiresAt = Date.now() + 110 * 60_000;
let child;
let stopped = false;
let retry;
let attempts = 0;
async function health() {
  try {
    const info = await stat(playlist);
    const text = await readFile(playlist, "utf8");
    const ageSeconds = (Date.now() - info.mtimeMs) / 1000;
    const segments = (text.match(/^part-.*\.ts$/gm) ?? []).length;
    return { ready: ageSeconds < 20 && segments >= 2, ageSeconds, segments, expiresAt: new Date(expiresAt).toISOString() };
  } catch { return { ready: false, segments: 0, expiresAt: new Date(expiresAt).toISOString() }; }
}
function connect() {
  if (stopped || attempts++ >= 120) return;
  child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "warning", "-rw_timeout", "8000000", "-fflags", "+genpts+discardcorrupt", "-i", "https://stream.vrcdn.live/live/basicbit.live.mp4", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-f", "hls", "-hls_time", "2", "-hls_list_size", "8", "-hls_delete_threshold", "8", "-hls_start_number_source", "epoch", "-hls_flags", "delete_segments+temp_file+omit_endlist+discont_start+program_date_time", "-hls_segment_filename", path.join(directory, "part-%d.ts"), "-y", playlist], { stdio: ["ignore", "ignore", "inherit"] });
  child.once("error", error => console.error(error.message));
  child.once("close", () => { if (!stopped) retry = setTimeout(connect, 5000); });
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/health.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await health())); return; }
  if (pathname !== "/index.m3u8" && !/^\/part-\d+\.ts$/.test(pathname)) { res.writeHead(404).end(); return; }
  if (!(await health()).ready) { res.writeHead(503, { "Retry-After": "3" }).end("Relay is waiting for live media"); return; }
  const file = path.join(directory, path.basename(pathname));
  try {
    const info = await stat(file);
    res.writeHead(200, { "Content-Type": pathname.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t", "Content-Length": info.size });
    const stream = createReadStream(file); stream.on("error", () => res.destroy()); stream.pipe(res); res.once("close", () => stream.destroy());
  } catch { res.writeHead(404).end(); }
});
let deadline;
async function close() {
  if (stopped) return;
  stopped = true; clearTimeout(retry); clearTimeout(deadline);
  const exit = child && child.exitCode === null && child.signalCode === null ? new Promise(resolve => { child.once("close", resolve); child.kill("SIGTERM"); }) : Promise.resolve();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await exit;
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void close());
server.listen(8080, "0.0.0.0", () => { console.log(JSON.stringify({ serving: 8080, expiresAt: new Date(expiresAt).toISOString() })); connect(); });
deadline = setTimeout(() => void close(), expiresAt - Date.now());
