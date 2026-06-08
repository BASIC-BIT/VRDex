import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const cases = [
  { label: "overlay-fade-1080p60-veryfast", qualityGate: "1080p60", controlMode: "overlay-alpha-volume-fade", x264Preset: "veryfast" },
  { label: "hard-switch-1080p60-veryfast", qualityGate: "1080p60", controlMode: "hard-switch", x264Preset: "veryfast" },
  { label: "hard-switch-1080p60-ultrafast", qualityGate: "1080p60", controlMode: "hard-switch", x264Preset: "ultrafast" },
  { label: "hard-switch-1080p30-ultrafast", qualityGate: "1080p30", controlMode: "hard-switch", x264Preset: "ultrafast" },
  { label: "hard-switch-720p60-ultrafast", qualityGate: "720p60", controlMode: "hard-switch", x264Preset: "ultrafast" },
  { label: "hard-switch-720p30-ultrafast", qualityGate: "720p30", controlMode: "hard-switch", x264Preset: "ultrafast" },
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runCase(rootDir, benchmarkCase) {
  const artifactRoot = join(rootDir, benchmarkCase.label);

  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/run-restream-worker-benchmark.mjs",
        "live-control",
        benchmarkCase.controlMode,
        benchmarkCase.x264Preset,
        benchmarkCase.qualityGate,
      ],
      {
        env: {
          ...process.env,
          VRDEX_RESTREAM_ARTIFACT_ROOT: artifactRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      const event = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return undefined;
          }
        })
        .find((entry) => entry?.event === "restream_worker_benchmark_completed");

      resolvePromise({ ...benchmarkCase, code, event, stderr: stderr.trim() });
    });
  });
}

function writeMarkdownSummary(summaryPath, results) {
  const rows = results
    .map((result) => {
      const realtimeFactor = result.event?.realtimeFactor ?? "failed";
      const commandCount = result.event?.commandCount ?? "failed";
      const artifact = result.event?.artifact ?? "n/a";

      return `| ${result.label} | ${result.qualityGate} | ${result.controlMode} | ${result.x264Preset} | ${realtimeFactor} | ${commandCount} | ${result.code} | ${artifact} |`;
    })
    .join("\n");

  writeFileSync(
    summaryPath,
    `# Restream Worker Benchmark Matrix\n\n| Case | Quality | Control mode | x264 preset | Realtime factor | Commands | Exit | Artifact |\n| --- | --- | --- | --- | ---: | ---: | ---: | --- |\n${rows}\n`,
  );
}

const rootDir = resolve("artifacts/restream-worker-benchmark-matrix", timestamp());
mkdirSync(rootDir, { recursive: true });

const results = [];

for (const benchmarkCase of cases) {
  console.log(JSON.stringify({ event: "restream_worker_benchmark_matrix_case_started", ...benchmarkCase }));
  results.push(await runCase(rootDir, benchmarkCase));
}

writeFileSync(join(rootDir, "matrix-summary.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
writeMarkdownSummary(join(rootDir, "matrix-summary.md"), results);

console.log(JSON.stringify({ event: "restream_worker_benchmark_matrix_completed", artifact: rootDir, caseCount: results.length }));

if (results.some((result) => result.code !== 0)) {
  process.exitCode = 1;
}
