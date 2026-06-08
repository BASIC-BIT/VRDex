const REQUIRED_GATE = "1080p60";

function requiredEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function optionalIntegerEnv(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function main() {
  const qualityGate = requiredEnv("VRDEX_RESTREAM_QUALITY_GATE");

  if (qualityGate !== REQUIRED_GATE) {
    throw new Error(`Hosted restream workers must run behind the ${REQUIRED_GATE} gate.`);
  }

  optionalIntegerEnv("VRDEX_RESTREAM_MAX_SESSION_SECONDS", 43_200);
  optionalIntegerEnv("VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS", 10);

  console.log(JSON.stringify({ event: "restream_worker_configuration_validated", qualityGate: REQUIRED_GATE }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
