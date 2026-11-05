import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTargetEnv, convexCliPath } from "./convex-target";
export function controlCommand(argv: string[]) {
  const [flag, target, command, workerId, ...extra] = argv;
  if (
    flag !== "--target" ||
    !["local", "dev", "prod"].includes(target ?? "") ||
    extra.length ||
    !["disable", "enable", "drain"].includes(command ?? "") ||
    (command === "drain"
      ? !/^[a-zA-Z0-9_-]{1,128}$/.test(workerId ?? "")
      : workerId !== undefined)
  )
    throw Error(
      "Use --target local|dev|prod disable|enable|drain [workerId]; no other arguments accepted",
    );
  return {
    target: target!,
    fn: `mediaRelayOperations:${command === "drain" ? "drainWorker" : "setRelayEnabled"}`,
    args:
      command === "drain"
        ? { workerId: workerId! }
        : { enabled: command === "enable" },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = controlCommand(process.argv.slice(2));
    const target = convexTargetEnv(command.target);
    if (!target.ok) throw Error(target.error);
    console.error(
      `Relay operator target: ${target.label} (${target.deployment})`,
    );
    const result = spawnSync(
      process.execPath,
      [convexCliPath, "run", command.fn, JSON.stringify(command.args)],
      { env: target.env, stdio: "inherit", timeout: 30000 },
    );
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Operator command failed",
    );
    process.exitCode = 1;
  }
}
