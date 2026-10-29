import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { runLocalProof } from "../packages/media-relay/src/verification/local";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export type ProofOptions = {
  target: "local" | "hosted";
  sources: number;
  bitrate: number;
  duration: number;
  deadline: number;
  keyframe: number;
  output: string;
};
export function parseProofArgs(argv: string[]): ProofOptions {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (
      !argv[i]?.startsWith("--") ||
      !key ||
      ![
        "target",
        "sources",
        "bitrate",
        "duration",
        "deadline",
        "keyframe",
        "output",
      ].includes(key) ||
      values[key] !== undefined ||
      !value ||
      value.startsWith("--")
    )
      throw Error("Invalid proof option");
    values[key] = value;
  }
  const target = values.target ?? "local";
  if (target !== "local" && target !== "hosted")
    throw Error("Explicit target must be local or hosted");
  const bound = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(values[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw Error(`Invalid ${key} bound`);
    return n;
  };
  const result = {
    target,
    sources: bound("sources", 2, 1, 8),
    bitrate: bound("bitrate", 3000000, 64000, 8000000),
    duration: bound("duration", 30, 12, 120),
    deadline: bound("deadline", 45, 1, 180),
    keyframe: bound("keyframe", 2, 2, 120),
    output: resolve(values.output ?? "/tmp/vrdex-media-relay-proof"),
  };
  if (
    (result.sources * result.bitrate * result.duration) / 8 >
    256 * 1024 * 1024
  )
    throw Error("Aggregate synthetic byte budget exceeded");
  return { ...result, target };
}
export async function runProof(options: ProofOptions) {
  // Revalidate programmatic callers before any files, sockets or provider imports.
  const checked = parseProofArgs(
    Object.entries(options).flatMap(([key, value]) => [
      `--${key}`,
      String(value),
    ]),
  );
  if (checked.target !== "local")
    throw Error(
      "Hosted proof requires separately approved resource selection and a reviewed hosted harness; none is authorized",
    );
  // Separate process avoids inherited loader conditions and gives this proof an owned process group.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL(
          "../packages/media-relay/src/verification/main.ts",
          import.meta.url,
        ),
      ),
      JSON.stringify(checked),
    ],
    { stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-4096);
  });
  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid) { try { process.kill(-child.pid, signal); } catch {} }
  };
  let interrupted = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    signalGroup("SIGTERM");
    escalation = setTimeout(() => signalGroup("SIGKILL"), 5000);
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await new Promise<void>((resolve, reject) => {
      let expired = false;
      const timeout = setTimeout(() => {
        expired = true;
        signalGroup("SIGKILL");
      }, (checked.deadline + 8) * 1000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (expired) reject(Error("Proof cleanup deadline exceeded"));
        else if (code !== 0) reject(Error(`Local proof process failed: ${errors}`));
        else resolve();
      });
    });
  } finally {
    if (escalation) clearTimeout(escalation);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  return JSON.parse(
    await readFile(join(checked.output, "evidence.json"), "utf8"),
  ) as Awaited<ReturnType<typeof runLocalProof>>;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runProof(parseProofArgs(process.argv.slice(2))).then(
    (e) => {
      console.log(JSON.stringify(e, null, 2));
      if (e.failures.length) process.exitCode = 1;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : "Proof failed");
      process.exitCode = 1;
    },
  );
}
