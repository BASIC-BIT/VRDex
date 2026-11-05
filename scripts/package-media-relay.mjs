import { build } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  utimes,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const out = resolve(process.argv[2] ?? "dist/media-relay");
await mkdir(out, { recursive: true });
const files = {
  worker: "packages/media-relay/src/worker/entrypoint.ts",
  gateway: "packages/media-relay/src/gateway/entrypoint.ts",
};
const hashes = {};
for (const [name, entry] of Object.entries(files)) {
  const result = await build({
    entryPoints: [entry],
    outfile: `${out}/${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    metafile: true,
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some((p) => /renderer|hosted-worker|twitch|python/i.test(p)))
    throw Error("Event dependency in relay bundle");
  hashes[name] = {
    sha256: createHash("sha256")
      .update(await readFile(`${out}/${name}.mjs`))
      .digest("hex"),
    sources: Object.fromEntries(
      await Promise.all(
        inputs.map(async (p) => [
          p,
          createHash("sha256")
            .update(await readFile(p))
            .digest("hex"),
        ]),
      ),
    ),
  };
  await writeFile(
    `${out}/${name}.meta.json`,
    JSON.stringify(result.metafile, null, 2),
  );
}
await chmod(`${out}/worker.mjs`, 0o644);
await chmod(`${out}/gateway.mjs`, 0o644);
await utimes(
  `${out}/gateway.mjs`,
  new Date("1980-01-01T00:00:00Z"),
  new Date("1980-01-01T00:00:00Z"),
);
await rm(`${out}/gateway.zip`, { force: true });
execFileSync("zip", ["-q", "-X", "gateway.zip", "gateway.mjs"], { cwd: out });
hashes.gatewayZip = {
  sha256: createHash("sha256")
    .update(await readFile(`${out}/gateway.zip`))
    .digest("base64"),
};
await writeFile(`${out}/manifest.json`, JSON.stringify(hashes, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    out,
    worker: hashes.worker.sha256,
    gateway: hashes.gateway.sha256,
    gatewayZip: hashes.gatewayZip.sha256,
  }) + "\n",
);
