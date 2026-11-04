import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { convexTargetEnv, convexCliPath } from "./convex-target.ts";

const version = "community-telemetry-v2";
export function parseRepairArgs(argv) {
  const allowed = new Set([
    "--target",
    "--integration",
    "--start",
    "--end",
    "--mode",
    "--inventory",
  ]);
  const options = {};
  for (let n = 0; n < argv.length; n += 2) {
    if (!allowed.has(argv[n])) throw new Error(`Unknown option ${argv[n]}`);
    if (
      !argv[n + 1] ||
      argv[n + 1].startsWith("--") ||
      options[argv[n].slice(2)] !== undefined
    )
      throw new Error(`Missing or duplicate option ${argv[n]}`);
    options[argv[n].slice(2)] = argv[n + 1];
  }
  if (!["local", "dev", "prod"].includes(options.target))
    throw new Error("An explicit --target local|dev|prod is required.");
  if (!["inventory", "dry-run", "status", "apply"].includes(options.mode))
    throw new Error("Choose --mode inventory|dry-run|status|apply.");
  if (!options.inventory) throw new Error("An --inventory path is required.");
  if (
    ["inventory", "dry-run"].includes(options.mode) &&
    (!options.integration || !options.start || !options.end)
  )
    throw new Error("Inventory requires --integration, --start and --end.");
  return options;
}
export function validateRepairManifest(m, deployment) {
  if (!m || m.deployment !== deployment)
    throw new Error("Inventory deployment does not match the selected target.");
  if (m.version !== version || !m.previewed)
    throw new Error("A current calculation-version dry run is required.");
  if (
    !m.inventoryId ||
    !m.integrationId ||
    !Number.isSafeInteger(m.startAt) ||
    !Number.isSafeInteger(m.endAt) ||
    m.endAt <= m.startAt ||
    m.endAt - m.startAt > 93 * 86400000
  )
    throw new Error("Invalid inventory scope.");
  if (
    !Array.isArray(m.targets) ||
    !m.targets.length ||
    m.targets.length > 100000
  )
    throw new Error("Invalid inventory targets.");
  const identities = new Set();
  for (const t of m.targets) {
    if (t.status !== "ready")
      throw new Error("Inventory contains blocked or unreviewed targets.");
    if (
      !["hour", "day", "event"].includes(t.grain) ||
      !Number.isSafeInteger(t.bucketStartAt) ||
      !Number.isSafeInteger(t.bucketEndAt) ||
      t.bucketStartAt < m.startAt ||
      t.bucketEndAt > m.endAt ||
      t.bucketEndAt <= t.bucketStartAt
    )
      throw new Error("Target exceeds inventory scope.");
    const identity = `${t.grain}:${t.bucketStartAt}:${t.eventId ?? ""}`;
    if (identities.has(identity))
      throw new Error("Inventory contains duplicate target identities.");
    identities.add(identity);
  }
  return m;
}
export async function main(argv) {
  const options = parseRepairArgs(argv);
  const target = convexTargetEnv(options.target);
  if (!target.ok) throw new Error(target.error);
  console.error(
    `Statistics repair: ${target.label} (${target.deployment}), mode ${options.mode}`,
  );
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const call = (name, args) => {
    const r = spawnSync(
      process.execPath,
      [convexCliPath, "run", name, JSON.stringify(args)],
      {
        cwd: root,
        env: target.env,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (r.status !== 0)
      throw new Error(
        `Convex operation ${name} failed; inspect the operator CLI output locally.`,
      );
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw new Error(`Invalid response from ${name}`);
    }
  };
  const save = (m) =>
    writeFileSync(options.inventory, JSON.stringify(m, null, 2) + "\n");
  if (["inventory", "dry-run"].includes(options.mode)) {
    if (
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(options.start) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(options.end)
    )
      throw new Error("Use explicit timezone offsets.");
    const startAt = Date.parse(options.start),
      endAt = Date.parse(options.end);
    if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt))
      throw new Error("Use ISO dates with explicit timezone offsets.");
    const manifest = {
      inventoryId: randomUUID(),
      deployment: target.deployment,
      integrationId: options.integration,
      startAt,
      endAt,
      version,
      previewed: options.mode === "dry-run",
      createdAt: new Date().toISOString(),
      targets: [],
    };
    for (const [grain, legacy] of [
      ["hour", false],
      ["day", false],
      ["event", false],
      ["hour", true],
      ["day", true],
    ]) {
      let cursor = null;
      do {
        const page = call("communityTelemetryRepair:inventory", {
          integrationId: options.integration,
          startAt,
          endAt,
          grain,
          legacy,
          paginationOpts: { numItems: 50, cursor },
        });
        for (const row of page.page) {
          const preview =
            options.mode === "dry-run"
              ? call(
                  row.grain === "event"
                    ? "communityTelemetryRepair:previewEvent"
                    : "communityTelemetryRepair:preview",
                  { integrationId: options.integration, ...row },
                )
              : { status: "inventoried" };
          manifest.targets.push({ ...row, ...preview });
        }
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
    }
    const unique = new Map();
    for (const t of manifest.targets)
      unique.set(`${t.grain}:${t.bucketStartAt}:${t.eventId ?? ""}`, t);
    manifest.targets = [...unique.values()];
    save(manifest);
    console.log(
      JSON.stringify({
        targets: manifest.targets.length,
        blocked: manifest.targets.filter((t) => t.status === "blocked").length,
        inventory: options.inventory,
      }),
    );
    return;
  }
  const manifest = validateRepairManifest(
    JSON.parse(readFileSync(options.inventory, "utf8")),
    target.deployment,
  );
  if (options.integration && options.integration !== manifest.integrationId)
    throw new Error("Integration differs from reviewed inventory scope.");
  if (
    (options.start && Date.parse(options.start) !== manifest.startAt) ||
    (options.end && Date.parse(options.end) !== manifest.endAt)
  )
    throw new Error("Date range differs from reviewed inventory scope.");
  if (options.mode === "apply") {
    const runId = call("communityTelemetryRepair:begin", {
      integrationId: manifest.integrationId,
      startAt: manifest.startAt,
      endAt: manifest.endAt,
      inventoryId: manifest.inventoryId,
      expectedTargets: manifest.targets.length,
    });
    manifest.runId = runId;
    save(manifest);
    const run = call("communityTelemetryRepair:getRun", { runId });
    if (run.state === "assembling") {
      for (let n = 0; n < manifest.targets.length; n += 50)
        call("communityTelemetryRepair:append", {
          runId,
          targets: manifest.targets
            .slice(n, n + 50)
            .map((t) => ({
              grain: t.grain,
              bucketStartAt: t.bucketStartAt,
              bucketEndAt: t.bucketEndAt,
              ...(t.eventId ? { eventId: t.eventId } : {}),
            })),
        });
      call("communityTelemetryRepair:seal", { runId });
    }
    if (run.state !== "complete")
      call("migrations:runRepairCommunityStatisticsV2", { reset: true });
  }
  if (!manifest.runId)
    throw new Error("Inventory has no applied run to inspect.");
  let cursor;
  const totals = { pending: 0, corrected: 0, failed: 0, blocked: 0 };
  let complete = false;
  do {
    const page = call("communityTelemetryRepair:refresh", {
      runId: manifest.runId,
      ...(cursor ? { cursor } : {}),
    });
    for (const state of Object.keys(totals)) totals[state] += page[state];
    complete = page.complete;
    cursor = page.isDone ? undefined : page.continueCursor;
  } while (cursor);
  console.log(JSON.stringify({ runId: manifest.runId, ...totals, complete }));
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
