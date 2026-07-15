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
  checkId?: string;
  clientId?: string;
  dryRun: boolean;
  environment?: string;
  evidence?: string;
  evidenceFile?: string;
  lastRunAt: string;
  matrixPath: string;
  notes?: string;
  readinessMode?: string;
  status?: ManualStatus;
  targetEnvironment?: string | null;
};

type ResolvedRecordOptions = RecordOptions & {
  checkId: string;
  clientId: string;
  status: ManualStatus;
};

const allowedStatuses = new Set<ManualStatus>(["fail", "not_applicable", "pass", "pending"]);
const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern = /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed)\b/i;
const placeholderPattern = /<[^>]+>/;
const generatedEvidenceSummaryPattern = /^replace this paragraph\b/i;
const sensitiveEvidencePattern =
  /\b(authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+/-]{12,}|client_secret\s*[=:]|vrdex_(?:api|mcp)?_?token\s*[=:]|secret\s*[=:]\s*[a-z0-9._~+/-]{12,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/i;

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
      case "--evidence-file":
        options.evidenceFile = takeValue(argv, index, arg);
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

  assert.equal(typeof options.matrixPath, "string", "--matrix or VRDEX_MCP_CLIENT_MATRIX_PATH is required.");
  assert.equal(typeof options.lastRunAt, "string", "--last-run-at must be a string.");

  return options as RecordOptions;
}

function fieldLine(raw: string, label: string) {
  const prefix = `${label}:`;
  const line = raw
    .split(/\r?\n/)
    .find((candidate) => candidate.toLowerCase().startsWith(prefix.toLowerCase()));

  return nonEmpty(line?.slice(prefix.length));
}

function normalizeEvidenceStatus(value: string | undefined, filePath: string) {
  if (value === undefined) {
    throw new Error(`${filePath} is missing a Status line.`);
  }

  if (/^pass\b/i.test(value)) {
    return "pass" as const;
  }

  if (/^fail\b/i.test(value)) {
    return "fail" as const;
  }

  if (/^pending\b/i.test(value)) {
    return "pending" as const;
  }

  if (/^not[_ -]?applicable\b/i.test(value)) {
    return "not_applicable" as const;
  }

  throw new Error(`${filePath} has unsupported Status value: ${value}`);
}

function sectionText(raw: string, heading: string) {
  const lines = raw.split(/\r?\n/);
  const headingLine = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === headingLine);

  if (start === -1) {
    return undefined;
  }

  const body: string[] = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^##\s+/.test(line)) {
      break;
    }

    body.push(line);
  }

  return nonEmpty(body.join("\n"));
}

function compactEvidenceSummary(value: string, filePath: string) {
  const summary = value
    .replaceAll(/\r?\n/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  assert.ok(summary, `${filePath} Sanitized Evidence Summary must not be empty.`);
  assert.doesNotMatch(
    summary,
    generatedEvidenceSummaryPattern,
    `${filePath} Sanitized Evidence Summary still contains the generated placeholder text.`,
  );
  assertConcreteValue(summary, `${filePath} Sanitized Evidence Summary`);
  assert.doesNotMatch(
    summary,
    sensitiveEvidencePattern,
    `${filePath} Sanitized Evidence Summary appears to contain a token, secret, or authorization header.`,
  );

  return summary;
}

async function applyEvidenceFile(options: RecordOptions) {
  if (options.evidenceFile === undefined) {
    return options;
  }

  const raw = await readFile(options.evidenceFile, "utf8");
  const status = normalizeEvidenceStatus(fieldLine(raw, "Status"), options.evidenceFile);
  const row = fieldLine(raw, "Matrix row");
  const environment = fieldLine(raw, "Environment");
  const targetEnvironment = fieldLine(raw, "Target environment");
  const evidence = sectionText(raw, "Sanitized Evidence Summary");

  assert.ok(row, `${options.evidenceFile} is missing Matrix row.`);

  const rowMatch = /^([^/]+)\/(.+)$/.exec(row);

  assert.ok(rowMatch, `${options.evidenceFile} Matrix row must be formatted as client/check.`);

  if (options.clientId !== undefined) {
    assert.equal(options.clientId, rowMatch[1], "--client does not match evidence file Matrix row.");
  }

  if (options.checkId !== undefined) {
    assert.equal(options.checkId, rowMatch[2], "--check does not match evidence file Matrix row.");
  }

  if (options.status !== undefined) {
    assert.equal(options.status, status, "--status does not match evidence file Status.");
  }

  if (status === "pending") {
    throw new Error(`${options.evidenceFile} is still pending; update Status after running the real client smoke.`);
  }

  if (status === "pass" || status === "fail") {
    assert.ok(environment, `${options.evidenceFile} is missing Environment.`);
    assert.ok(evidence, `${options.evidenceFile} is missing Sanitized Evidence Summary.`);
  }

  const evidenceSummary = evidence === undefined ? undefined : compactEvidenceSummary(evidence, options.evidenceFile);
  const resolved: RecordOptions = {
    ...options,
    checkId: options.checkId ?? rowMatch[2],
    clientId: options.clientId ?? rowMatch[1],
    environment: options.environment ?? environment,
    evidence: options.evidence ?? evidenceSummary,
    status: options.status ?? status,
  };

  if (
    options.targetEnvironment === undefined
    && targetEnvironment !== undefined
    && !/^not applicable\b/i.test(targetEnvironment)
  ) {
    resolved.targetEnvironment = targetEnvironment;
  }

  return resolved;
}

function resolveOptions(options: RecordOptions): ResolvedRecordOptions {
  assert.equal(typeof options.clientId, "string", "--client or --evidence-file Matrix row is required.");
  assert.equal(typeof options.checkId, "string", "--check or --evidence-file Matrix row is required.");
  assert.equal(typeof options.status, "string", "--status or --evidence-file Status is required.");

  return options as ResolvedRecordOptions;
}

function validateStatusUpdate(check: SmokeCheck, options: ResolvedRecordOptions) {
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

function applyStatusUpdate(matrix: SmokeMatrix, options: ResolvedRecordOptions) {
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
  const options = resolveOptions(await applyEvidenceFile(parseArgs(process.argv.slice(2))));
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
