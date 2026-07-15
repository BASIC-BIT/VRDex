import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

type ConvexAdminHttpClient = ConvexHttpClient & {
  query: (query: unknown, args: Record<string, number>) => Promise<unknown>;
  setAdminAuth: (token: string) => void;
};

type Options = {
  since?: number;
  windowMs?: number;
};

const summaryQuery = makeFunctionReference("apiPlatformObservability:summary");

function requiredEnv(name: string, aliases: string[] = []) {
  for (const candidate of [name, ...aliases]) {
    const value = process.env[candidate]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error([name, ...aliases].join(" or ") + " is required.");
}

function parseFiniteNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return parsed;
}

function parseTimestamp(value: string) {
  const asNumber = Number(value);

  if (Number.isFinite(asNumber)) {
    return Math.floor(asNumber);
  }

  const asDate = Date.parse(value);

  if (!Number.isFinite(asDate)) {
    throw new Error("--since must be a millisecond timestamp or ISO date.");
  }

  return asDate;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--since") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--since requires a value.");
      }
      options.since = parseTimestamp(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--since=")) {
      options.since = parseTimestamp(arg.slice("--since=".length));
      continue;
    }

    if (arg === "--window-ms") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--window-ms requires a value.");
      }
      options.windowMs = parseFiniteNumber(value, "--window-ms");
      index += 1;
      continue;
    }

    if (arg.startsWith("--window-ms=")) {
      options.windowMs = parseFiniteNumber(arg.slice("--window-ms=".length), "--window-ms");
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.windowMs === undefined && process.env.VRDEX_API_OBSERVABILITY_WINDOW_MS?.trim()) {
    options.windowMs = parseFiniteNumber(
      process.env.VRDEX_API_OBSERVABILITY_WINDOW_MS.trim(),
      "VRDEX_API_OBSERVABILITY_WINDOW_MS",
    );
  }

  return options;
}

async function main() {
  const convexUrl = requiredEnv("CONVEX_URL", ["NEXT_PUBLIC_CONVEX_URL"]);
  const adminToken = requiredEnv("CONVEX_ADMIN_TOKEN", [
    "CONVEX_DEPLOY_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
  ]);
  const args = parseArgs(process.argv.slice(2));
  const client = new ConvexHttpClient(convexUrl) as ConvexAdminHttpClient;

  client.setAdminAuth(adminToken);

  const summary = await client.query(summaryQuery, args);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
