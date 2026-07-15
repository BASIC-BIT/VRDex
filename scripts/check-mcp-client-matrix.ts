import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
type HostedReadinessStatus = "fail" | "pass" | "pending";
type SmokeSurface =
  | "hosted_http_anonymous"
  | "hosted_http_diagnostic"
  | "hosted_http_oauth"
  | "local_stdio";

type SmokeCheck = {
  environment?: string;
  id: string;
  lastRunAt?: string;
  manualEvidence?: string;
  manualStatus: ManualStatus;
  notes?: string;
  repoEvidence?: string;
  requiredForExternalReadiness: boolean;
  surface: SmokeSurface;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

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
  clients: ClientEntry[];
  hostedReadiness?: {
    checks: HostedReadinessCheck[];
  };
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

type CheckOptions = {
  requireReady: boolean;
};

const matrixPath = process.env.VRDEX_MCP_CLIENT_MATRIX_PATH?.trim()
  || "docs/developers/mcp-client-smoke-results.json";
const compatibilityDocPath = process.env.VRDEX_MCP_CLIENT_COMPATIBILITY_DOC_PATH?.trim()
  || "docs/developers/mcp-client-compatibility.md";

const requiredClientChecks = new Map<string, string[]>([
  ["claude-desktop", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["claude-code", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["gemini-cli", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["vscode", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["cursor", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["openai-chatgpt", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["devin-windsurf", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["mcp-inspector", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
]);

const allowedSurfaces = new Set<SmokeSurface>([
  "hosted_http_anonymous",
  "hosted_http_diagnostic",
  "hosted_http_oauth",
  "local_stdio",
]);

const allowedManualStatuses = new Set<ManualStatus>(["fail", "not_applicable", "pass", "pending"]);
const allowedHostedReadinessStatuses = new Set<HostedReadinessStatus>(["fail", "pass", "pending"]);
const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern = /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed)\b/i;
const placeholderPattern = /<[^>]+>/;
const sensitiveEvidencePattern =
  /\b(authorization\s*:\s*bearer|bearer\s+[a-z0-9._~+/-]{12,}|client_secret\s*[=:]|vrdex_(?:api|mcp)?_?token\s*[=:]|secret\s*[=:]\s*[a-z0-9._~+/-]{12,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/i;
const hostedDataBackedEvidenceTerms = ["vrdex_search", "search", "fetch"];
const requiredHostedReadinessChecks = new Map<string, string>([
  ["hosted-data-backed-anonymous-read", "data-backed anonymous hosted MCP public read"],
  ["hosted-dynamic-client-registration", "hosted OAuth Dynamic Client Registration"],
  ["hosted-client-id-metadata-document", "hosted OAuth Client ID Metadata Document"],
]);

const minimumLaunchClientsBySurface = new Map<SmokeSurface, number>([
  ["local_stdio", 2],
  ["hosted_http_anonymous", 2],
  ["hosted_http_oauth", 1],
]);

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function parseArgs(argv: string[]): CheckOptions {
  const options: CheckOptions = {
    requireReady: envFlag("VRDEX_MCP_CLIENT_MATRIX_REQUIRE_READY"),
  };

  for (const arg of argv) {
    switch (arg) {
      case "--":
        break;
      case "--require-ready":
        options.requireReady = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function assertString(value: unknown, label: string) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.notEqual((value as string).trim(), "", `${label} must not be empty`);
}

function assertOptionalString(value: unknown, label: string) {
  if (value !== undefined) {
    assertString(value, label);
  }
}

function assertConcreteValue(value: string, label: string) {
  assert.doesNotMatch(value, placeholderPattern, `${label} must be concrete and must not contain <placeholder> text`);
}

function assertSanitizedEvidence(value: string, label: string) {
  assertConcreteValue(value, label);
  assert.doesNotMatch(value, sensitiveEvidencePattern, `${label} appears to contain a token, secret, or authorization header`);
}

function assertHostedDataBackedEvidence(value: string, label: string) {
  for (const term of hostedDataBackedEvidenceTerms) {
    assert.match(
      value,
      new RegExp(`\\b${term}\\b`, "i"),
      `${label} must mention ${term} evidence from the hosted data-backed smoke`,
    );
  }
}

function parseSmokeMatrix(raw: string): SmokeMatrix {
  const parsed = JSON.parse(raw) as SmokeMatrix;

  assert.equal(parsed.schemaVersion, 1, "schemaVersion must be 1");
  assertString(parsed.lastReviewed, "lastReviewed");
  assertString(parsed.readinessMode, "readinessMode");
  assert.equal(
    parsed.targetEnvironment === null || typeof parsed.targetEnvironment === "string",
    true,
    "targetEnvironment must be null or a string",
  );
  assert.equal(Array.isArray(parsed.clients), true, "clients must be an array");

  return parsed;
}

function validateSmokeCheck(clientId: string, check: SmokeCheck, matrix: SmokeMatrix) {
  assertString(check.id, `${clientId} check id`);
  assert.equal(allowedSurfaces.has(check.surface), true, `${clientId}/${check.id} has unsupported surface`);
  assert.equal(
    allowedManualStatuses.has(check.manualStatus),
    true,
    `${clientId}/${check.id} has unsupported manualStatus`,
  );
  assert.equal(
    typeof check.requiredForExternalReadiness,
    "boolean",
    `${clientId}/${check.id} requiredForExternalReadiness must be a boolean`,
  );
  assertOptionalString(check.repoEvidence, `${clientId}/${check.id} repoEvidence`);
  assertOptionalString(check.manualEvidence, `${clientId}/${check.id} manualEvidence`);
  assertOptionalString(check.environment, `${clientId}/${check.id} environment`);
  assertOptionalString(check.lastRunAt, `${clientId}/${check.id} lastRunAt`);
  assertOptionalString(check.notes, `${clientId}/${check.id} notes`);

  if (check.requiredForExternalReadiness) {
    assert.notEqual(
      check.manualStatus,
      "not_applicable",
      `${clientId}/${check.id} cannot be not_applicable when required for external readiness`,
    );
  }

  if (check.manualStatus === "not_applicable") {
    assertString(check.notes, `${clientId}/${check.id} notes`);
  }

  if (check.manualStatus === "pass" || check.manualStatus === "fail") {
    assertString(check.lastRunAt, `${clientId}/${check.id} lastRunAt`);
    assertString(check.environment, `${clientId}/${check.id} environment`);
    assertString(check.manualEvidence, `${clientId}/${check.id} manualEvidence`);
    assertConcreteValue(check.environment, `${clientId}/${check.id} environment`);
    assertSanitizedEvidence(check.manualEvidence, `${clientId}/${check.id} manualEvidence`);
  }

  if (check.manualStatus === "pass" && check.requiredForExternalReadiness && check.surface.startsWith("hosted_http")) {
    assertString(matrix.targetEnvironment, "targetEnvironment");
    assertConcreteValue(matrix.targetEnvironment, "targetEnvironment");
    assert.match(
      matrix.targetEnvironment,
      hostedEvidenceTargetPattern,
      `${clientId}/${check.id} hosted pass targetEnvironment must name a same-branch, staging, production-like, or production target`,
    );
    assert.doesNotMatch(
      matrix.targetEnvironment,
      pendingHostedEvidencePattern,
      `${clientId}/${check.id} hosted pass targetEnvironment must not describe pending, skipped, unavailable, or non-data-backed evidence`,
    );
  }
}

function validateSmokeMatrix(matrix: SmokeMatrix) {
  const seenClients = new Set<string>();
  const blockers: string[] = [];
  const launchClientsBySurface = new Map<SmokeSurface, Set<string>>();

  assert.equal(
    matrix.clients.length,
    requiredClientChecks.size,
    `matrix must contain ${requiredClientChecks.size} client rows`,
  );

  for (const client of matrix.clients) {
    assertString(client.id, "client id");
    assertString(client.name, `${client.id} name`);
    assert.equal(requiredClientChecks.has(client.id), true, `unknown client ${client.id}`);
    assert.equal(seenClients.has(client.id), false, `duplicate client ${client.id}`);
    assert.equal(Array.isArray(client.checks), true, `${client.id} checks must be an array`);
    seenClients.add(client.id);

    const requiredChecks = requiredClientChecks.get(client.id) ?? [];
    const seenChecks = new Set<string>();

    for (const check of client.checks) {
      validateSmokeCheck(client.id, check, matrix);
      assert.equal(seenChecks.has(check.id), false, `duplicate check ${client.id}/${check.id}`);
      seenChecks.add(check.id);

      if (check.requiredForExternalReadiness && check.manualStatus !== "pass") {
        blockers.push(`${client.name}: ${check.id} is ${check.manualStatus}`);
      }

      if (check.requiredForExternalReadiness) {
        const clientIds = launchClientsBySurface.get(check.surface) ?? new Set<string>();
        clientIds.add(client.id);
        launchClientsBySurface.set(check.surface, clientIds);
      }
    }

    for (const checkId of requiredChecks) {
      assert.equal(seenChecks.has(checkId), true, `${client.id} is missing ${checkId}`);
    }
  }

  for (const clientId of requiredClientChecks.keys()) {
    assert.equal(seenClients.has(clientId), true, `matrix is missing ${clientId}`);
  }

  for (const [surface, minimumClients] of minimumLaunchClientsBySurface) {
    const selectedClients = launchClientsBySurface.get(surface)?.size ?? 0;

    assert.ok(
      selectedClients >= minimumClients,
      `matrix must keep at least ${minimumClients} launch-gating client rows for ${surface}; found ${selectedClients}`,
    );
  }

  const hostedBlockers = validateHostedReadiness(matrix);

  blockers.push(...hostedBlockers);

  return blockers;
}

function validateHostedReadinessCheck(check: HostedReadinessCheck, matrix: SmokeMatrix) {
  assertString(check.id, `hostedReadiness/${check.id} id`);
  assert.equal(
    typeof check.requiredForExternalReadiness,
    "boolean",
    `hostedReadiness/${check.id} requiredForExternalReadiness must be a boolean`,
  );
  assert.equal(
    allowedHostedReadinessStatuses.has(check.status),
    true,
    `hostedReadiness/${check.id} has unsupported status`,
  );
  assertOptionalString(check.environment, `hostedReadiness/${check.id} environment`);
  assertOptionalString(check.evidence, `hostedReadiness/${check.id} evidence`);
  assertOptionalString(check.lastRunAt, `hostedReadiness/${check.id} lastRunAt`);
  assertOptionalString(check.notes, `hostedReadiness/${check.id} notes`);

  if (check.status === "pass" || check.status === "fail") {
    assertString(check.lastRunAt, `hostedReadiness/${check.id} lastRunAt`);
    assertString(check.environment, `hostedReadiness/${check.id} environment`);
    assertString(check.evidence, `hostedReadiness/${check.id} evidence`);
    assertConcreteValue(check.environment, `hostedReadiness/${check.id} environment`);
    assertSanitizedEvidence(check.evidence, `hostedReadiness/${check.id} evidence`);
  }

  if (check.id === "hosted-data-backed-anonymous-read" && check.status === "pass") {
    assertHostedDataBackedEvidence(check.evidence ?? "", `hostedReadiness/${check.id} evidence`);
  }

  if (check.status === "pass" && check.requiredForExternalReadiness) {
    assertString(matrix.targetEnvironment, "targetEnvironment");
    assertConcreteValue(matrix.targetEnvironment, "targetEnvironment");
    assert.match(
      matrix.targetEnvironment,
      hostedEvidenceTargetPattern,
      `hostedReadiness/${check.id} pass targetEnvironment must name a same-branch, staging, production-like, or production target`,
    );
    assert.doesNotMatch(
      matrix.targetEnvironment,
      pendingHostedEvidencePattern,
      `hostedReadiness/${check.id} pass targetEnvironment must not describe pending, skipped, unavailable, or non-data-backed evidence`,
    );
  }
}

function validateHostedReadiness(matrix: SmokeMatrix) {
  const blockers: string[] = [];
  const checks = matrix.hostedReadiness?.checks;

  assert.equal(Array.isArray(checks), true, "hostedReadiness.checks must be an array");

  const seenChecks = new Set<string>();

  for (const check of checks ?? []) {
    validateHostedReadinessCheck(check, matrix);
    assert.equal(seenChecks.has(check.id), false, `duplicate hostedReadiness check ${check.id}`);
    seenChecks.add(check.id);

    if (check.requiredForExternalReadiness && check.status !== "pass") {
      blockers.push(`Hosted MCP ${requiredHostedReadinessChecks.get(check.id) ?? check.id}: ${check.status}`);
    }
  }

  for (const [checkId, label] of requiredHostedReadinessChecks) {
    if (!seenChecks.has(checkId)) {
      blockers.push(`Hosted MCP ${label}: missing`);
    }
  }

  return blockers;
}

function summarize(matrix: SmokeMatrix) {
  console.log("| Client | Launch-gating checks | Launch status | Nonblocking follow-up |");
  console.log("| --- | ---: | --- | --- |");

  for (const client of matrix.clients) {
    const requiredChecks = client.checks.filter((check) => check.requiredForExternalReadiness);
    const statuses = requiredChecks
      .map((check) => `${check.id}: ${check.manualStatus}`)
      .join(", ");
    const followUp = client.checks
      .filter((check) => !check.requiredForExternalReadiness && check.manualStatus !== "pass" && check.manualStatus !== "not_applicable")
      .map((check) => `${check.id}: ${check.manualStatus}`)
      .join(", ");

    console.log(`| ${client.name} | ${requiredChecks.length} | ${statuses || "not selected"} | ${followUp || "none"} |`);
  }

  console.log("");
  console.log("| Hosted readiness check | Required | Status |");
  console.log("| --- | --- | --- |");

  for (const check of matrix.hostedReadiness?.checks ?? []) {
    console.log(`| ${check.id} | ${check.requiredForExternalReadiness ? "yes" : "no"} | ${check.status} |`);
  }
}

async function validateCompatibilityDocReviewDate(matrix: SmokeMatrix) {
  const doc = await readFile(compatibilityDocPath, "utf8");

  assert.match(
    doc,
    new RegExp(`^Last reviewed: ${matrix.lastReviewed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`, "m"),
    `MCP client compatibility doc Last reviewed date must match matrix lastReviewed (${matrix.lastReviewed})`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = parseSmokeMatrix(await readFile(matrixPath, "utf8"));
  const blockers = validateSmokeMatrix(matrix);
  await validateCompatibilityDocReviewDate(matrix);

  summarize(matrix);

  if (options.requireReady && blockers.length > 0) {
    throw new Error(`Representative MCP client evidence is not ready:\n${blockers.join("\n")}`);
  }

  if (blockers.length > 0) {
    console.log(
      [
        "",
        "Representative MCP client evidence is not externally ready.",
        "Run pnpm check:mcp-client-matrix -- --require-ready to make pending or failed required rows fail this check.",
      ].join("\n"),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
