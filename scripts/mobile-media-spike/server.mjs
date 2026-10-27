// Local-only, throwaway experiment: no hosted relay or production settings.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, get } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startProofServer } from "../event-playback-proof.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { build, stop: stopBuildService } = createRequire(require.resolve("tsx"))("esbuild");
const media = await mkdtemp(path.join(tmpdir(), "vrdex-mobile-media-"));
const children = [];
let fixture;
let server;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const exits = children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("close", resolve); child.kill();
  }));
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await Promise.all(exits);
  await fixture?.close();
  await rm(media, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void close());
try {
  await build({ entryPoints: [path.join(directory, "client.ts")], nodePaths: [path.resolve(directory, "../../apps/web/node_modules")], bundle: true, platform: "browser", outfile: path.join(media, "client.js") }).finally(() => stopBuildService());
  fixture = await startProofServer({ lifetimeMs: null });
  for (const audioOnly of [false, true]) {
    const name = audioOnly ? "audio" : "video";
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      ...(audioOnly ? ["-map", "1:a", "-vn"] : ["-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "50", "-sc_threshold", "0"]),
      "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments+independent_segments+temp_file", "-hls_segment_filename", path.join(media, name + "-%06d.ts"), path.join(media, name + ".m3u8")], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", error => { console.error(error.message); void close(); });
    children.push(child);
  }
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/") {
        res.writeHead(302, { Location: "/index.html" }).end(); return;
      }
      if (pathname === "/transport") {
        const upstream = get(fixture.url + "/audible.live.ts", response => {
          res.writeHead(response.statusCode ?? 502, { "Content-Type": "video/mp2t", "Cache-Control": "no-store" });
          response.on("error", () => res.destroy()); response.pipe(res);
        });
        upstream.on("error", () => res.destroy());
        res.once("close", () => upstream.destroy()); return;
      }
      let file;
      if (pathname === "/index.html") file = path.join(directory, "index.html");
      else if (pathname === "/client.js") file = path.join(media, "client.js");
      else if (/^\/media\/(?:audio|video)(?:-\d{6}\.ts|\.m3u8)$/.test(pathname)) file = path.join(media, path.basename(pathname));
      else { res.writeHead(404).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : file.endsWith(".ts") ? "video/mp2t" : file.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "no-store" });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.MOBILE_MEDIA_PORT ?? 4320), "127.0.0.1", resolve); });
  console.log(`Throwaway harness: http://127.0.0.1:${server.address().port}`);
  console.log(`HLS artifacts: ${media}`);
} catch (error) { await close(); throw error; }
