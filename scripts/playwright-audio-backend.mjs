import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// CI-only prerequisite. A private runtime directory is the capability to stop
// only the daemon this job created; a preexisting audio server is never stopped.
const root = process.env.RUNNER_TEMP;
if (!root) throw Error("RUNNER_TEMP is required");
const marker = path.join(root, "vrdex-playwright-audio.json");
function command(name, args, env = process.env) {
  return spawnSync(name, args, { env, encoding: "utf8", timeout: 5000 });
}
function inspect(env) {
  const info = command("pactl", ["info"], env);
  const sinks = command("pactl", ["list", "short", "sinks"], env);
  // Server status and sink names/formats are useful; no cookie contents/logged env.
  console.log(JSON.stringify({ phase: "audio-backend", infoStatus: info.status, sinksStatus: sinks.status,
    info: info.stdout?.split("\n").filter(line => /^(Server Name|Server Version|Default Sink|Server String):/.test(line)),
    sinks: sinks.stdout?.trim().split("\n").filter(Boolean),
    error: info.status === 0 ? undefined : info.stderr?.trim().slice(0, 400) }));
  return info.status === 0 && sinks.status === 0 && Boolean(sinks.stdout.trim());
}
function ownedEnvironment(directory) {
  if (path.dirname(directory) !== root || !path.basename(directory).startsWith("vrdex-pulse-")) throw Error("Invalid owned audio runtime");
  return { ...process.env, PULSE_RUNTIME_PATH: directory, PULSE_SERVER: `unix:${directory}/native`, PULSE_COOKIE: `${directory}/cookie` };
}
function cleanup() {
  if (!existsSync(marker)) return;
  const { directory } = JSON.parse(readFileSync(marker, "utf8"));
  const env = ownedEnvironment(directory);
  const stop = command("pulseaudio", ["--kill"], env);
  if (stop.status !== 0 && existsSync(path.join(directory, "pid"))) throw Error(`Owned audio daemon stop failed: ${stop.stderr}`);
  const deadline = Date.now() + 5000;
  while (existsSync(path.join(directory, "pid")) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (existsSync(path.join(directory, "pid"))) throw Error("Owned audio daemon did not settle");
  rmSync(directory, { recursive: true, force: true });
  rmSync(marker);
  console.log("Stopped only the job-owned audio backend");
}
if (process.argv[2] === "cleanup") cleanup();
else if (process.argv[2] === "prepare") {
  if (inspect(process.env)) console.log("Reusing existing usable audio backend");
  else {
    if (!process.env.GITHUB_ENV) throw Error("GITHUB_ENV is required for job-local audio setup");
    if (existsSync(marker)) throw Error("Owned audio marker already exists; cleanup before preparing again");
    const directory = mkdtempSync(path.join(root, "vrdex-pulse-"));
    chmodSync(directory, 0o700);
    const env = ownedEnvironment(directory);
    writeFileSync(env.PULSE_COOKIE, randomBytes(256), { mode: 0o600 });
    const config = path.join(directory, "default.pa");
    writeFileSync(config, [
      `load-module module-native-protocol-unix socket=${directory}/native auth-cookie=${directory}/cookie`,
      "load-module module-null-sink sink_name=vrdex_ci_media",
      "set-default-sink vrdex_ci_media",
    ].join("\n") + "\n", { mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ directory }), { mode: 0o600 });
    try {
      const start = command("pulseaudio", ["-n", `--file=${config}`, "--daemonize=yes", "--use-pid-file=yes", "--exit-idle-time=-1", `--log-target=file:${directory}/daemon.log`], env);
      if (start.status !== 0) throw Error(`Job audio backend failed to start: ${start.stderr}`);
      if (!inspect(env)) throw Error("Job audio backend has no usable sink");
      appendFileSync(process.env.GITHUB_ENV, `PULSE_RUNTIME_PATH=${directory}\nPULSE_SERVER=${env.PULSE_SERVER}\nPULSE_COOKIE=${env.PULSE_COOKIE}\nPULSE_SINK=vrdex_ci_media\n`);
      console.log("Prepared private Unix-socket audio backend and null sink");
    } catch (error) { cleanup(); throw error; }
  }
} else throw Error("Expected prepare or cleanup");
