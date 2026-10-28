import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createSourceRelay } from "../../../workers/restream/source-relay.mjs";
import { parseSourceDescriptor } from "../src/contracts";
import { createPackager } from "../src/worker/packager";
const run = promisify(execFile);
export const source = parseSourceDescriptor({
  streamKey: "vrcdn/DJ_Case/1",
  streamId: "DJ_Case",
  inputFormat: "vrcdn_fmp4",
  packagingVersion: 1,
});
export async function fixture(
  codec = "libx264",
  broken: "partial" | "timestamps" | "playlist" | null = null,
  captureChild = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "vrdex-packager-"));
  const input = join(directory, "input.mp4");
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=128x72:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "22",
      "-c:v",
      codec,
      "-g",
      "50",
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      input,
    ],
    { timeout: 15000 },
  );
  const original = await readFile(input);
  let data =
    broken === "partial"
      ? original.subarray(0, 2000)
      : broken === "timestamps"
        ? Buffer.concat([original, original])
        : original;
  let acquisitions = 0,
    active = 0,
    maximum = 0;
  const provider = createServer((_req, res) => {
    acquisitions++;
    if (_req.url === "/nested.ts") {
      res.writeHead(403).end();
      return;
    }
    active++;
    maximum = Math.max(active, maximum);
    res.once("close", () => active--);
    res.writeHead(200, { "Content-Type": "video/mp4" });
    let offset = 0;
    const timer = setInterval(() => {
      res.write(data.subarray(offset, offset + 4096));
      offset += 4096;
      if (offset >= data.length) {
        clearInterval(timer);
        if (broken === "partial" || broken === "playlist") res.end();
      }
    }, 30);
    res.once("close", () => clearInterval(timer));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  assert(address && typeof address !== "string");
  if (broken === "playlist")
    data = Buffer.from(`#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2,
http://127.0.0.1:${address.port}/nested.ts
#EXT-X-ENDLIST
`);
  const wrapper = join(directory, "ffmpeg-test");
  if (captureChild) {
    await writeFile(
      wrapper,
      `#!/bin/sh\nprintf '%s' "$$" > '${directory}/child.pid'\nexec ffmpeg "$@"\n`,
    );
    await chmod(wrapper, 0o700);
  }
  const start = createPackager({
    ...(captureChild ? { ffmpegPath: wrapper } : {}),
    createRelay: () =>
      createSourceRelay({
        inputFormat: "vrcdn_fmp4",
        resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
        requestSource: (
          url: URL,
          _options: unknown,
          cb: (res: IncomingMessage) => void,
        ) => {
          assert.equal(
            url.href,
            "https://stream.vrcdn.live/live/DJ_Case.live.mp4",
          );
          return request(`http://127.0.0.1:${address.port}`, cb);
        },
      }),
  });
  return {
    directory,
    start,
    childPid: async () =>
      Number(await readFile(join(directory, "child.pid"), "utf8")),
    disconnect: () => provider.closeAllConnections(),
    counts: () => ({ acquisitions, active, maximum }),
    async close() {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function until(condition: () => boolean) {
  for (let i = 0; i < 150 && !condition(); i++) await delay(50);
  assert(condition(), "expected condition within 7.5 seconds");
}
