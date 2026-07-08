import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

type HostedReadinessStatus = "fail" | "pass" | "pending";

type HostedReadinessCheck = {
  environment?: string;
  evidence?: string;
  id: string;
  lastRunAt?: string;
  notes?: string;
  requiredForExternalReadiness: boolean;
  status: HostedReadinessStatus;
};

type SmokeMatrix = {
  hostedReadiness?: {
    checks: HostedReadinessCheck[];
  };
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

type RecordOptions = {
  checkId: string;
  dryRun: boolean;
  environment?: string;
  evidence?: string;
  lastRunAt: string;
  matrixPath: string;
  notes?: string;
  readinessMode?: string;
  status: HostedReadinessStatus;
  targetEnvironment?: string | null;
};

const allowedStatuses = new Set<HostedReadinessStatus>(["fail", "pass", "pending"]);
const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern = /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed)\b/i;
const placeholderPattern = /<[^>]+>/;
const sensitiveEvidencePattern =
  /\b(authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+/-]{12,}|client_secret\s*[=:]|vrdex_(?:api|mcp)?_?token\s*[=:]|secret\s*[=:]\s*[a-z0-9._~+/-]{12,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/i;
const knownHostedChecks = new Set([
  "hosted-data-backed-anonymous-read",
  "hosted-dynamic-client-registration",
  "hosted-client-id-metadata-document",
]);

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function assertConcreteValue(value: string, label: string) {
  assert.doesNotMatch(value, placeholderPattern, `${label} must be concrete and must not contain <placeholder> text.`);
}

function assertSanitizedEvidence(value: string, label: string) {
  assertConcreteValue(value, label);
  assert.doesNotMatch(value, sensitiveEvidencePattern, `${label} appears to contain a token, secret, or authorization header.`);
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function parseArgs(argv: string[]): RecordOptions {
  const options: Partial<RecordOptions> = {
    dryRun: false,
    lastRunAt: todayUtc(),
    matrixPath: process.env.VRDEX_MCP_CLIENT_MATRIX_PATH?.trim()
      || "docs/developers/mcp-client-smoke-results.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--check":
        options.checkId = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--environment":
        options.environment = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--evidence":
        options.evidence = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--last-run-at":
        options.lastRunAt = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--matrix":
        options.matrixPath = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--notes":
        options.notes = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--readiness-mode":
        options.readinessMode = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--status": {
        const status = takeValue(argv, index, arg);

        assert.equal(allowedStatuses.has(status as HostedReadinessStatus), true, `Unsupported status: ${status}`);
        options.status = status as HostedReadinessStatus;
        index += 1;
        break;
      }
      case "--target-environment": {
        const value = takeValue(argv, index, arg);

        options.targetEnvironment = value === "null" ? null : value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.equal(typeof options.checkId, "string", "--check is required.");
  assert.equal(typeof options.status, "string", "--status is required.");
  assert.equal(typeof options.matrixPath, "string", "--matrix or VRDEX_MCP_CLIENT_MATRIX_PATH is required.");
  assert.equal(typeof options.lastRunAt, "string", "--last-run-at must be a string.");

  return options as RecordOptions;
}

function validateStatusUpdate(options: RecordOptions) {
  assert.equal(knownHostedChecks.has(options.checkId), true, `Unknown hosted MCP evidence check: ${options.checkId}`);

  if (options.status === "pass" || options.status === "fail") {
    const environment = nonEmpty(options.environment);
    const evidence = nonEmpty(options.evidence);

    assert.ok(environment, "--environment is required for pass or fail.");
    assert.ok(evidence, "--evidence is required for pass or fail.");
    assertConcreteValue(environment, "--environment");
    assertSanitizedEvidence(evidence, "--evidence");
  }

  if (options.status === "pass") {
    assert.ok(
      options.targetEnvironment !== undefined,
      "--target-environment is required when recording hosted MCP evidence as pass.",
    );

    const target = nonEmpty(options.targetEnvironment ?? undefined) ?? "";

    assertConcreteValue(target, "--target-environment");
    assert.match(
      target,
      hostedEvidenceTargetPattern,
      "--target-environment for a hosted pass must name a same-branch, staging, production-like, or production target.",
    );
    assert.doesNotMatch(
      target,
      pendingHostedEvidencePattern,
      "--target-environment for a hosted pass must not describe pending, skipped, unavailable, or non-data-backed evidence.",
    );
  }
}

function applyStatusUpdate(matrix: SmokeMatrix, options: RecordOptions) {
  validateStatusUpdate(options);

  const hostedReadiness = matrix.hostedReadiness;

  assert.ok(hostedReadiness, "Matrix is missing hostedReadiness.");
  assert.equal(Array.isArray(hostedReadiness.checks), true, "Matrix hostedReadiness.checks must be an array.");

  const check = hostedReadiness.checks.find((entry) => entry.id === options.checkId);

  assert.ok(check, `Unknown hosted MCP evidence check in matrix: ${options.checkId}`);

  check.status = options.status;

  if (options.status === "pass" || options.status === "fail") {
    check.environment = nonEmpty(options.environment);
    check.evidence = nonEmpty(options.evidence);
    check.lastRunAt = nonEmpty(options.lastRunAt);
  } else {
    delete check.environment;
    delete check.evidence;
    delete check.lastRunAt;
  }

  const notes = nonEmpty(options.notes);
  if (notes !== undefined) {
    check.notes = notes;
  }

  if (options.targetEnvironment !== undefined) {
    matrix.targetEnvironment = options.targetEnvironment === null ? null : nonEmpty(options.targetEnvironment) ?? null;
  }

  if (options.readinessMode !== undefined) {
    const readinessMode = nonEmpty(options.readinessMode);

    assert.ok(readinessMode, "--readiness-mode must not be empty.");
    matrix.readinessMode = readinessMode;
  }

  matrix.lastReviewed = todayUtc();

  return check;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.matrixPath, "utf8");
  const matrix = JSON.parse(raw) as SmokeMatrix;
  const check = applyStatusUpdate(matrix, options);
  const output = `${JSON.stringify(matrix, null, 2)}\n`;

  if (options.dryRun) {
    process.stdout.write(output);
  } else {
    await writeFile(options.matrixPath, output, "utf8");
  }

  console.log(
    [
      `Recorded hosted MCP evidence ${check.id}: ${check.status}`,
      `Matrix: ${options.matrixPath}`,
      options.dryRun ? "Dry run only; no file was written." : "File updated.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
