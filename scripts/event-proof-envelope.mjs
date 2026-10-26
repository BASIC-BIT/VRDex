import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, stat, readdir, mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createProcessOwner, processTable } from "./event-proof-processes.mjs";
export const PRIVATE_PROOF_ROOT =
  "s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks";
/** No raw logs or recursive directory uploads. Recordings are split, hashed and
 * completely manifested; oversize/missing/failed-upload evidence cannot pass.
 */
export async function runProofEnvelope({
  kind,
  args,
  directory,
  timeoutMs,
  byteCap,
  env = process.env,
}) {
  if (
    !["capacity", "twitch"].includes(kind) ||
    !/^task6-[a-zA-Z0-9_-]{1,80}$/.test(env.VRDEX_PROOF_RUN_ID ?? "") ||
    env.VRDEX_RESTREAM_ARTIFACT_S3_URI !== PRIVATE_PROOF_ROOT
  )
    throw Error("Invalid private proof namespace");
  const owner = createProcessOwner(),
    groups = new Set();
  let interrupted = false,
    timedOut = false,
    exitCode = 1,
    cleanup,
    uploadComplete = false,
    receipt;
  const child = owner.start(
    process.execPath,
    [
      `scripts/event-${kind === "capacity" ? "broadcast-capacity" : "twitch-input-proof"}.mjs`,
      ...args,
    ],
    {
      env: { ...env, VRDEX_PROOF_INNER: kind },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let bytes = 0;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1048576) terminate();
    });
  async function discover() {
    const rows = await processTable();
    const descendants = new Set([child.pid]);
    for (let i = 0; i < rows.length; i++) {
      let added = false;
      for (const row of rows)
        if (descendants.has(row.parent) && !descendants.has(row.pid)) {
          descendants.add(row.pid);
          added = true;
        }
      if (!added) break;
    }
    for (const row of rows)
      if (descendants.has(row.pid) && row.group !== process.pid)
        groups.add(row.group);
  }
  const kill = () => {
    for (const pid of groups) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
  };
  let escalation;
  function terminate() {
    interrupted = true;
    for (const pid of groups) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}
    }
    escalation ??= setTimeout(kill, 500);
  }
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  const poll = setInterval(() => void discover().catch(terminate), 100);
  groups.add(child.pid);
  const deadline = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  // Independent hard stop includes finalization, so upload/library hangs cannot
  // turn the task into an unbounded meter. Root still owns an outer ECS deadline.
  const hard = setTimeout(() => {
    kill();
    process.exit(124);
  }, timeoutMs + 180000);
  const manifest = [];
  try {
    exitCode = await child.closed;
    clearTimeout(deadline);
    clearInterval(poll);
    await discover();
    kill();
    cleanup = await owner.close();
    const remaining = (await processTable()).filter(
      (r) => r.live && groups.has(r.group),
    );
    if (remaining.length) throw Error("Live proof descendant");
    receipt = JSON.parse(await readFile(`${directory}/receipt.json`, "utf8"));
    if (
      !receipt.terminal ||
      !receipt.cleanup?.closed ||
      receipt.passed !== true ||
      exitCode !== 0 ||
      interrupted
    )
      exitCode = 1;
    let total = 0;
    const names = (await readdir(directory)).filter((name) =>
      /^(program|vrcdn|twitch)\.ts$|^(receipt\.json|samples\.ndjson|transport-receipt\.json)$/.test(
        name,
      ),
    );
    if (!names.includes("receipt.json"))
      throw Error("Missing terminal receipt");
    await mkdir(`${directory}/upload`, { recursive: true });
    for (const name of names) {
      const info = await stat(`${directory}/${name}`);
      total += info.size;
      if (
        total > byteCap ||
        !info.isFile() ||
        (!name.endsWith(".ts") && info.size > 8 * 1048576)
      )
        throw Error("Evidence byte cap exceeded");
      if (name.endsWith(".ts") && info.size === 0)
        throw Error("Empty required recording");
      const parts = [];
      const chunkSize = 32 * 1048576;
      for (let offset = 0; offset < info.size; offset += chunkSize) {
        const partName = `${name}.part-${String(parts.length).padStart(4, "0")}`,
          file = `${directory}/upload/${partName}`;
        const hash = createHash("sha256");
        const source = createReadStream(`${directory}/${name}`, {
          start: offset,
          end: Math.min(info.size, offset + chunkSize) - 1,
        });
        source.on("data", (b) => hash.update(b));
        await pipeline(
          source,
          createWriteStream(file, { flags: "wx", mode: 0o600 }),
        );
        const part = {
          name: partName,
          bytes: Math.min(chunkSize, info.size - offset),
          sha256: hash.digest("hex"),
        };
        parts.push(part);
        await owner.run(
          "aws",
          [
            "s3",
            "cp",
            file,
            `${PRIVATE_PROOF_ROOT}/${env.VRDEX_PROOF_RUN_ID}/${partName}`,
            "--region",
            "us-east-1",
            "--sse",
            "AES256",
            "--only-show-errors",
            "--cli-connect-timeout",
            "2",
            "--cli-read-timeout",
            "10",
          ],
          { timeoutMs: 60000, maxBytes: 16384 },
        );
      }
      manifest.push({
        name,
        bytes: info.size,
        complete: parts.reduce((sum, p) => sum + p.bytes, 0) === info.size,
        parts,
      });
    }
    uploadComplete = true;
  } catch {
    exitCode = 1;
  } finally {
    clearTimeout(deadline);
    clearInterval(poll);
    clearTimeout(escalation);
    process.removeListener("SIGTERM", terminate);
    process.removeListener("SIGINT", terminate);
    kill();
    try {
      cleanup = await owner.close();
    } catch {
      cleanup = { closed: false };
      exitCode = 1;
    }
    const terminal = {
      schemaVersion: 1,
      kind,
      runId: env.VRDEX_PROOF_RUN_ID,
      passed:
        exitCode === 0 && uploadComplete && cleanup.closed && !interrupted,
      terminal: true,
      timedOut,
      interrupted,
      cleanup,
      uploadComplete,
      manifest,
      finishedAt: new Date().toISOString(),
    };
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        `${directory}/terminal.json`,
        JSON.stringify(terminal, null, 2) + "\n",
        { mode: 0o600 },
      );
      await owner.run(
        "aws",
        [
          "s3",
          "cp",
          `${directory}/terminal.json`,
          `${PRIVATE_PROOF_ROOT}/${env.VRDEX_PROOF_RUN_ID}/terminal.json`,
          "--region",
          "us-east-1",
          "--sse",
          "AES256",
          "--only-show-errors",
          "--cli-connect-timeout",
          "2",
          "--cli-read-timeout",
          "5",
        ],
        { timeoutMs: 12000, maxBytes: 16384 },
      );
    } catch {
      exitCode = 1;
    }
    await owner.close();
    clearTimeout(hard);
  }
  if (exitCode !== 0 || !uploadComplete || interrupted)
    throw Error("Proof or evidence delivery failed");
}
