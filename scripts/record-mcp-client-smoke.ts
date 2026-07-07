import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";

type SmokeCheck = {
  environment?: string;
  id: string;
  lastRunAt?: string;
  manualEvidence?: string;
  manualStatus: ManualStatus;
  notes?: string;
  repoEvidence?: string;
  requiredForExternalReadiness: boolean;
  surface: string;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

type RecordOptions = {
  checkId: string;
  clientId: string;
  dryRun: boolean;
  environment?: string;
  evidence?: string;
  lastRunAt: string;
  matrixPath: string;
  notes?: string;
  readinessMode?: string;
  status: ManualStatus;
  targetEnvironment?: string | null;
};

const allowedStatuses = new Set<ManualStatus>(["fail", "not_applicable", "pass", "pending"]);
const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern = /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed)\b/i;
const placeholderPattern = /<[^>]+>/;

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
      case "--client":
        options.clientId = takeValue(argv, index, arg);
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

        assert.equal(allowedStatuses.has(status as ManualStatus), true, `Unsupported status: ${status}`);
        options.status = status as ManualStatus;
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

  assert.equal(typeof options.clientId, "string", "--client is required.");
  assert.equal(typeof options.checkId, "string", "--check is required.");
  assert.equal(typeof options.status, "string", "--status is required.");
  assert.equal(typeof options.matrixPath, "string", "--matrix or VRDEX_MCP_CLIENT_MATRIX_PATH is required.");
  assert.equal(typeof options.lastRunAt, "string", "--last-run-at must be a string.");

  return options as RecordOptions;
}

function validateStatusUpdate(check: SmokeCheck, options: RecordOptions) {
  if (check.requiredForExternalReadiness) {
    assert.notEqual(
      options.status,
      "not_applicable",
      `${options.clientId}/${options.checkId} cannot be not_applicable when required for external readiness.`,
    );
  }

  if (options.status === "pass" || options.status === "fail") {
    const environment = nonEmpty(options.environment);
    const evidence = nonEmpty(options.evidence);

    assert.ok(environment, "--environment is required for pass or fail.");
    assert.ok(evidence, "--evidence is required for pass or fail.");
    assertConcreteValue(environment, "--environment");
    assertConcreteValue(evidence, "--evidence");
  }

  if (
    options.status === "pass" &&
    check.requiredForExternalReadiness &&
    check.surface.startsWith("hosted_http")
  ) {
    assert.ok(
      options.targetEnvironment !== undefined,
      "--target-environment is required when recording a required hosted MCP row as pass.",
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

  if (options.status === "not_applicable") {
    assert.ok(nonEmpty(options.notes), "--notes is required for not_applicable.");
  }
}

function applyStatusUpdate(matrix: SmokeMatrix, options: RecordOptions) {
  const client = matrix.clients.find((entry) => entry.id === options.clientId);
  assert.ok(client, `Unknown client: ${options.clientId}`);

  const check = client.checks.find((entry) => entry.id === options.checkId);
  assert.ok(check, `Unknown check for ${options.clientId}: ${options.checkId}`);
  validateStatusUpdate(check, options);

  check.manualStatus = options.status;

  if (options.status === "pass" || options.status === "fail") {
    check.environment = nonEmpty(options.environment);
    check.manualEvidence = nonEmpty(options.evidence);
    check.lastRunAt = nonEmpty(options.lastRunAt);
  } else {
    delete check.environment;
    delete check.manualEvidence;
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

  return { check, client };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.matrixPath, "utf8");
  const matrix = JSON.parse(raw) as SmokeMatrix;
  const { check, client } = applyStatusUpdate(matrix, options);
  const output = `${JSON.stringify(matrix, null, 2)}\n`;

  if (options.dryRun) {
    process.stdout.write(output);
  } else {
    await writeFile(options.matrixPath, output, "utf8");
  }

  console.log(
    [
      `Recorded ${client.name} / ${check.id}: ${check.manualStatus}`,
      `Matrix: ${options.matrixPath}`,
      options.dryRun ? "Dry run only; no file was written." : "File updated.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
