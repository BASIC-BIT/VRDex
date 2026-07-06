import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
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

type SmokeMatrix = {
  clients: ClientEntry[];
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

const matrixPath = "docs/developers/mcp-client-smoke-results.json";

const requiredClientChecks = new Map<string, string[]>([
  ["claude-desktop", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
  ["claude-code", ["local-stdio", "hosted-anonymous-read", "hosted-oauth"]],
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

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
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

function validateSmokeCheck(clientId: string, check: SmokeCheck) {
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
  }
}

function validateSmokeMatrix(matrix: SmokeMatrix) {
  const seenClients = new Set<string>();
  const blockers: string[] = [];

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
      validateSmokeCheck(client.id, check);
      assert.equal(seenChecks.has(check.id), false, `duplicate check ${client.id}/${check.id}`);
      seenChecks.add(check.id);

      if (check.requiredForExternalReadiness && check.manualStatus !== "pass") {
        blockers.push(`${client.name}: ${check.id} is ${check.manualStatus}`);
      }
    }

    for (const checkId of requiredChecks) {
      assert.equal(seenChecks.has(checkId), true, `${client.id} is missing ${checkId}`);
    }
  }

  for (const clientId of requiredClientChecks.keys()) {
    assert.equal(seenClients.has(clientId), true, `matrix is missing ${clientId}`);
  }

  return blockers;
}

function summarize(matrix: SmokeMatrix) {
  console.log("| Client | Required checks | Manual status |");
  console.log("| --- | ---: | --- |");

  for (const client of matrix.clients) {
    const requiredChecks = client.checks.filter((check) => check.requiredForExternalReadiness);
    const statuses = requiredChecks
      .map((check) => `${check.id}: ${check.manualStatus}`)
      .join(", ");

    console.log(`| ${client.name} | ${requiredChecks.length} | ${statuses} |`);
  }
}

async function main() {
  const matrix = parseSmokeMatrix(await readFile(matrixPath, "utf8"));
  const blockers = validateSmokeMatrix(matrix);

  summarize(matrix);

  if (envFlag("VRDEX_MCP_CLIENT_MATRIX_REQUIRE_READY") && blockers.length > 0) {
    throw new Error(`Manual MCP client smokes are not ready:\n${blockers.join("\n")}`);
  }

  if (blockers.length > 0) {
    console.log(
      [
        "",
        "Manual MCP client smokes are still pending.",
        "Set VRDEX_MCP_CLIENT_MATRIX_REQUIRE_READY=1 to make pending or failed required rows fail this check.",
      ].join("\n"),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
