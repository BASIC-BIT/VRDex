// Static phone experiment. No live relay, backend or credentials.
import { spawn } from "node:child_process";
import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv.includes("--standalone") ? path.join(here, "dist") : path.resolve(here, "../../../apps/web/playwright-artifacts/mobile-media-static");
let ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
if (!process.env.FFMPEG_PATH) {
  try { ffmpeg = createRequire(import.meta.url)("ffmpeg-static"); } catch { /* Local system FFmpeg. */ }
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "media"), { recursive: true });
for (const file of ["index.html", "client.js", "vercel.json"]) await copyFile(path.join(here, file), path.join(output, file));
// Owner's public VRDex profile image. Preserve the original PNG bytes.
const artwork = await fetch("https://vrdex.net/api/v0/profiles/basicbit/assets/ph7655gnxqkh55h6w2mysagt9n8djr7w/file?download=1", { signal: AbortSignal.timeout(15000) });
if (!artwork.ok) throw new Error(`Artwork fetch failed: ${artwork.status}`);
const image = new Uint8Array(await artwork.arrayBuffer());
if (image.length > 5_000_000 || ![137,80,78,71,13,10,26,10].every((byte, i) => image[i] === byte)) throw new Error("Expected a bounded PNG profile image");
await writeFile(path.join(output, "dj-artwork.png"), image);
for (const audioOnly of [false, true]) {
  const name = audioOnly ? "audio" : "video";
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x263446:s=320x180:r=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=32000,volume=0.15", "-t", "2100",
    ...(audioOnly ? ["-map", "1:a", "-vn"] : ["-map", "0:v", "-map", "1:a", "-vf", "drawtext=text='Phone playback test %{pts\\:hms}':fontcolor=white:fontsize=16:x=(w-tw)/2:y=(h-th)/2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", "-g", "120", "-sc_threshold", "0"]),
    "-c:a", "aac", "-ac", "1", "-b:a", "24k", "-f", "hls", "-hls_time", "60", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", path.join(output, "media", name + "-%03d.ts"), path.join(output, "media", name + ".m3u8")];
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Media generation exited ${code}`)));
  });
}
await writeFile(path.join(output, "experiment.json"), JSON.stringify({ kind: "prerecorded-synthetic-hls", durationSeconds: 2100, generatedAt: new Date().toISOString(), liveVrcdn: false }, null, 2));
console.log(output);
