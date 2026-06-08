const REQUIRED_GATE = "1080p60";
const ALLOWED_BENCHMARK_MODES = new Set(["dry-run", "ecs-fargate"]);

function requiredEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function requiredIntegerEnv(name) {
  const value = requiredEnv(name);

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function requiredUrlEnv(name) {
  const value = requiredEnv(name);

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`${name} must use http or https.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${name} must`)) {
      throw error;
    }

    throw new Error(`${name} must be a valid URL.`);
  }

  return value;
}

function requiredListEnv(name) {
  const value = requiredEnv(name);
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error(`${name} must include at least one reference name.`);
  }

  return entries;
}

function main() {
  const qualityGate = requiredEnv("VRDEX_RESTREAM_QUALITY_GATE");

  if (qualityGate !== REQUIRED_GATE) {
    throw new Error(`Hosted restream workers must run behind the ${REQUIRED_GATE} gate.`);
  }

  const benchmarkMode = requiredEnv("VRDEX_RESTREAM_BENCHMARK_MODE");

  if (!ALLOWED_BENCHMARK_MODES.has(benchmarkMode)) {
    throw new Error("VRDEX_RESTREAM_BENCHMARK_MODE must be dry-run or ecs-fargate.");
  }

  requiredUrlEnv("CONVEX_URL");
  requiredEnv("VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER");
  requiredListEnv("VRDEX_RESTREAM_SECRET_REF_NAMES");
  requiredIntegerEnv("VRDEX_RESTREAM_MAX_SESSION_SECONDS");
  requiredIntegerEnv("VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS");

  console.log(
    JSON.stringify({ event: "restream_worker_configuration_validated", benchmarkMode, qualityGate: REQUIRED_GATE }),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
